"""
STT Service - Speech-to-Text sử dụng PhoWhisper (Vietnamese-specialized) hoặc faster-whisper

Service này cung cấp API để chuyển đổi audio thành text với độ trễ thấp,
tối ưu hóa cho CPU sử dụng INT8 quantization.

Model Strategy:
- PhoWhisper-small: Vietnamese-specialized với độ chính xác cao cho tiếng Việt
- faster-whisper small: Fallback cho các ngôn ngữ khác
"""

from fastapi import FastAPI, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Union, Dict
import uvicorn
import time
import os
import io
import logging
from contextlib import asynccontextmanager
import re
import base64

# Configure logging FIRST (before conditional imports)
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Whisper models (imported after logger is defined)
try:
    from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor
    import torch
    TRANSFORMERS_AVAILABLE = True
    logger.info("✅ transformers library available")
except ImportError:
    TRANSFORMERS_AVAILABLE = False
    logger.warning("⚠️ transformers not available, PhoWhisper will be disabled")

try:
    from faster_whisper import WhisperModel
    FASTER_WHISPER_AVAILABLE = True
    logger.info("✅ faster-whisper library available")
except ImportError:
    FASTER_WHISPER_AVAILABLE = False
    logger.warning("⚠️ faster-whisper not available")

import soundfile as sf
import numpy as np
import subprocess
import tempfile
import re
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response


# ==================== PUNCTUATION RESTORATION ====================
def restore_vietnamese_punctuation(text: str) -> str:
    """
    Thêm dấu câu cơ bản cho text tiếng Việt sử dụng rule-based approach.
    
    RULES:
    1. Thêm dấu phẩy (,) sau các từ nối: "và", "nhưng", "nên", "thì", "mà"
    2. Thêm dấu chấm (.) ở cuối câu
    3. Viết hoa chữ cái đầu câu
    4. Thêm dấu hỏi (?) cho câu hỏi: "gì", "sao", "như thế nào", "không"
    
    Args:
        text: Raw transcription text không dấu câu
        
    Returns:
        Text đã có dấu câu
        
    Note: Đây là rule-based approach đơn giản. Để chính xác hơn,
    cần dùng ML model như vinai/VietnamesePunctuation
    """
    if not text or len(text.strip()) == 0:
        return text
    
    # Lowercase để dễ xử lý
    text = text.strip()
    
    # Pattern 1: Thêm dấu phẩy sau từ nối (nếu chưa có)
    conjunctions = [
        (r'\b(và)\b(?!\s*[,.])', r'\1,'),
        (r'\b(nhưng)\b(?!\s*[,.])', r'\1,'),
        (r'\b(nên)\b(?!\s*[,.])', r'\1,'),
        (r'\b(thì)\b(?!\s*[,.])', r'\1,'),
        (r'\b(mà)\b(?!\s*[,.])', r'\1,'),
        (r'\b(nếu)\b(?!\s*[,.])', r'\1,'),
        (r'\b(bởi vì)\b(?!\s*[,.])', r'\1,'),
    ]
    
    for pattern, replacement in conjunctions:
        text = re.sub(pattern, replacement, text, flags=re.IGNORECASE)
    
    # Pattern 2: Thêm dấu hỏi cho câu hỏi
    question_markers = [
        r'\b(không)\s*$',  # "... không" ở cuối
        r'\b(sao)\b',
        r'\b(gì)\b',
        r'\b(như thế nào)\b',
        r'\b(tại sao)\b',
        r'\b(khi nào)\b',
        r'\b(ở đâu)\b',
        r'\b(ai)\b\s+',
    ]
    
    is_question = any(re.search(pattern, text, re.IGNORECASE) for pattern in question_markers)
    
    # Pattern 3: Thêm dấu chấm/hỏi cuối câu
    if not re.search(r'[.!?]$', text):
        text = text + ('?' if is_question else '.')
    
    # Pattern 4: Viết hoa chữ cái đầu câu
    text = text[0].upper() + text[1:] if len(text) > 0 else text
    
    # Pattern 5: Viết hoa sau dấu chấm
    text = re.sub(r'([.!?])\s+(\w)', lambda m: m.group(1) + ' ' + m.group(2).upper(), text)
    
    return text


# ==================== END PUNCTUATION RESTORATION ====================


# Prometheus metrics
TRANSCRIPTION_COUNTER = Counter(
    'stt_transcriptions_total',
    'Total number of transcription requests',
    ['status', 'language']
)
TRANSCRIPTION_DURATION = Histogram(
    'stt_transcription_duration_seconds',
    'Time spent transcribing audio',
    buckets=[0.1, 0.5, 1.0, 2.0, 5.0, 10.0]
)
PROCESSING_TIME_HISTOGRAM = Histogram(
    'stt_processing_time_seconds',
    'Processing time for transcription (including streaming)',
    buckets=[0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0]
)
AUDIO_LENGTH_HISTOGRAM = Histogram(
    'stt_audio_length_seconds',
    'Length of audio files processed',
    buckets=[1, 5, 10, 30, 60, 120, 300]
)

# Global model instances
phowhisper_model = None
phowhisper_processor = None
faster_whisper_model = None

# ==================== STREAMING SESSION TRACKING ====================
# Dictionary để track streaming sessions: {participant_id: {buffer, language, chunk_count}}
streaming_sessions: Dict[str, dict] = {}

def get_or_create_session(participant_id: str, language: Optional[str] = None) -> dict:
    """
    Get hoặc create streaming session cho participant
    
    Args:
        participant_id: Unique participant ID
        language: Preferred language (None = auto-detect)
        
    Returns:
        Session dict với buffer, language, chunk_count
    """
    if participant_id not in streaming_sessions:
        streaming_sessions[participant_id] = {
            'buffer': [],  # Buffer để lưu audio chunks
            'language': language,
            'chunk_count': 0,
            'created_at': time.time(),
            'last_activity': time.time()
        }
        logger.info(f"✅ Created streaming session for participant {participant_id}")
    else:
        streaming_sessions[participant_id]['last_activity'] = time.time()
    
    return streaming_sessions[participant_id]

def cleanup_session(participant_id: str):
    """
    Cleanup streaming session
    
    Args:
        participant_id: Unique participant ID
    """
    if participant_id in streaming_sessions:
        del streaming_sessions[participant_id]
        logger.info(f"🧹 Cleaned up streaming session for participant {participant_id}")



class SentenceSegmenter:
    """
    Intelligent sentence segmenter sử dụng word timestamps và punctuation.
    Xử lý sentence boundaries để tránh translation errors.
    """
    
    def __init__(self, pause_threshold: float = 0.5):
        """
        Args:
            pause_threshold: Threshold (seconds) để detect sentence boundary
        """
        self.pause_threshold = pause_threshold
        self.sentence_end_punctuation = {'.', '!', '?', '。', '！', '？'}
    
    def segment_by_timestamps(self, segments: List[dict]) -> List[dict]:
        """
        Segment sentences dựa trên timestamps và pauses
        
        Args:
            segments: List of segments with words and timestamps
            
        Returns:
            List of segmented sentences với boundaries rõ ràng
        """
        if not segments:
            return []
        
        sentences = []
        current_sentence = {
            'text': '',
            'words': [],
            'start': None,
            'end': None
        }
        
        for segment in segments:
            if 'words' not in segment or not segment['words']:
                # No word timestamps, use segment as-is
                if current_sentence['text']:
                    sentences.append(current_sentence)
                sentences.append({
                    'text': segment['text'],
                    'start': segment['start'],
                    'end': segment['end'],
                    'words': []
                })
                current_sentence = {'text': '', 'words': [], 'start': None, 'end': None}
                continue
            
            for i, word_info in enumerate(segment['words']):
                word = word_info['word']
                word_start = word_info['start']
                word_end = word_info['end']
                
                # Initialize start time
                if current_sentence['start'] is None:
                    current_sentence['start'] = word_start
                
                # Add word to current sentence
                current_sentence['text'] += word
                current_sentence['words'].append(word_info)
                current_sentence['end'] = word_end
                
                # Check for sentence boundary
                is_sentence_end = False
                
                # 1. Punctuation-based boundary
                if any(p in word for p in self.sentence_end_punctuation):
                    is_sentence_end = True
                
                # 2. Pause-based boundary (if not last word)
                if i < len(segment['words']) - 1:
                    next_word_start = segment['words'][i + 1]['start']
                    pause_duration = next_word_start - word_end
                    if pause_duration >= self.pause_threshold:
                        is_sentence_end = True
                
                # Create new sentence
                if is_sentence_end and current_sentence['text'].strip():
                    sentences.append({
                        'text': current_sentence['text'].strip(),
                        'words': current_sentence['words'],
                        'start': current_sentence['start'],
                        'end': current_sentence['end']
                    })
                    current_sentence = {'text': '', 'words': [], 'start': None, 'end': None}
        
        # Add remaining sentence
        if current_sentence['text'].strip():
            sentences.append(current_sentence)
        
        return sentences


# Pydantic Models
class TranscriptionRequest(BaseModel):
    """Request model cho transcription với base64 audio"""
    audio_base64: str = Field(..., description="Audio data encoded in base64")
    language: Optional[str] = Field(None, description="Source language code (e.g., 'en', 'vi')")
    task: str = Field("transcribe", description="Task: 'transcribe' or 'translate'")
    
class TranscriptionResponse(BaseModel):
    """Response model cho transcription result"""
    text: str = Field(..., description="Transcribed text")
    language: str = Field(..., description="Detected or specified language")
    language_probability: float = Field(..., description="Confidence score for language detection")
    duration: float = Field(..., description="Audio duration in seconds")
    segments: List[dict] = Field(..., description="Detailed segments with timestamps")
    sentences: Optional[List[dict]] = Field(None, description="Intelligently segmented sentences (if word_timestamps=True)")
    processing_time: float = Field(..., description="Time taken to process (seconds)")
    model_used: str = Field(..., description="Model used for transcription (phowhisper or faster-whisper)")

# ==================== STREAMING MODELS ====================
class StreamingAudioRequest(BaseModel):
    """Request model cho streaming transcription"""
    participant_id: str = Field(..., description="Unique ID của participant")
    audio_data: str = Field(..., description="Base64-encoded audio data (PCM16 hoặc Opus)")
    sample_rate: int = Field(48000, description="Sample rate (Hz)")
    channels: int = Field(1, description="Number of audio channels (1=mono, 2=stereo)")
    format: str = Field("pcm16", description="Audio format: pcm16, opus, wav")
    language: Optional[str] = Field(None, description="Language code (e.g., 'vi', 'en'). None = auto-detect")
    
class StreamingTranscriptionResponse(BaseModel):
    """Response model cho streaming transcription (interim results)"""
    participant_id: str = Field(..., description="Unique ID của participant")
    text: str = Field(..., description="Transcribed text (interim hoặc final)")
    language: str = Field(..., description="Detected language")
    confidence: float = Field(..., description="Confidence score (0-1)")
    is_final: bool = Field(..., description="True nếu là final result, False nếu interim")
    timestamp: float = Field(..., description="Timestamp khi xử lý (seconds)")
    chunk_id: int = Field(..., description="ID của audio chunk")
    model_used: str = Field(..., description="Model used (phowhisper/faster-whisper)")

class StreamStartRequest(BaseModel):
    """Request để bắt đầu streaming session"""
    participant_id: str = Field(..., description="Unique ID của participant")
    language: Optional[str] = Field(None, description="Preferred language (None = auto-detect)")
    
class StreamEndRequest(BaseModel):
    """Request để kết thúc streaming session"""
    participant_id: str = Field(..., description="Unique ID của participant")
    
class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    model_loaded: bool
    model_info: dict


def load_model():
    """Load Whisper models vào memory (PhoWhisper + faster-whisper fallback)"""
    global phowhisper_model, phowhisper_processor, faster_whisper_model
    
    use_phowhisper = os.getenv("USE_PHOWHISPER", "true").lower() == "true"
    use_faster_whisper = os.getenv("USE_FASTER_WHISPER", "true").lower() == "true"
    
    success = False
    
    # Try loading PhoWhisper (Vietnamese-specialized)
    if use_phowhisper and TRANSFORMERS_AVAILABLE:
        try:
            logger.info("Loading PhoWhisper-small (Vietnamese-specialized)...")
            phowhisper_processor = AutoProcessor.from_pretrained("vinai/PhoWhisper-small")
            phowhisper_model = AutoModelForSpeechSeq2Seq.from_pretrained(
                "vinai/PhoWhisper-small",
                torch_dtype=torch.float32,  # CPU requires float32
                low_cpu_mem_usage=True
            )
            phowhisper_model.eval()  # Set to evaluation mode
            logger.info("✅ PhoWhisper-small loaded successfully")
            success = True
        except Exception as e:
            logger.error(f"❌ Failed to load PhoWhisper: {e}")
    
    # Try loading faster-whisper (multilingual fallback)
    if use_faster_whisper and FASTER_WHISPER_AVAILABLE:
        model_size = os.getenv("MODEL_SIZE", "small")  # Use small for lower resource usage
        compute_type = os.getenv("COMPUTE_TYPE", "int8")
        device = os.getenv("DEVICE", "cpu")
        num_threads = int(os.getenv("OMP_NUM_THREADS", "4"))
        
        logger.info(f"Loading faster-whisper: {model_size}, compute_type: {compute_type}, device: {device}")
        
        try:
            faster_whisper_model = WhisperModel(
                model_size,
                device=device,
                compute_type=compute_type,
                cpu_threads=num_threads,
                num_workers=1
            )
            logger.info("✅ faster-whisper loaded successfully")
            success = True
        except Exception as e:
            logger.error(f"❌ Failed to load faster-whisper: {e}")
    
    if not success:
        logger.error("❌ No models loaded! STT service will not work")
    
    return success


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager cho FastAPI"""
    # Startup
    logger.info("Starting STT Service...")
    success = load_model()
    if not success:
        logger.error("Failed to start - model not loaded")
    yield
    # Shutdown
    logger.info("Shutting down STT Service...")


# Initialize FastAPI app
app = FastAPI(
    title="STT Service",
    description="Speech-to-Text service sử dụng faster-whisper với CPU optimization",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Trong production nên giới hạn origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_model=dict)
async def root():
    """Root endpoint - service info và available endpoints"""
    return {
        "service": "STT Service",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "transcribe": "/transcribe (POST)",
            "models": "/models (GET)",
            "languages": "/languages (GET)",
            "health": "/health (GET)",
            "metrics": "/metrics (GET)"
        }
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    model_loaded = (phowhisper_model is not None) or (faster_whisper_model is not None)
    
    model_info = {}
    if model_loaded:
        model_info = {
            "phowhisper_available": phowhisper_model is not None,
            "faster_whisper_available": faster_whisper_model is not None,
            "model_size": os.getenv("MODEL_SIZE", "small"),
            "compute_type": os.getenv("COMPUTE_TYPE", "int8"),
            "device": os.getenv("DEVICE", "cpu"),
            "num_threads": int(os.getenv("OMP_NUM_THREADS", "4"))
        }
    
    return HealthResponse(
        status="healthy" if model_loaded else "unhealthy",
        model_loaded=model_loaded,
        model_info=model_info
    )


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
    audio: UploadFile = File(..., description="Audio file (WAV, MP3, OGG, etc.)"),
    language: Optional[str] = None,
    task: str = "transcribe",
    beam_size: int = 5,
    word_timestamps: bool = True,
    segment_sentences: bool = True,
    prefer_model: Optional[str] = None  # "phowhisper" hoặc "faster-whisper" để ưu tiên model cụ thể
):
    """
    Transcribe audio file thành text với intelligent sentence segmentation
    
    Args:
        audio: File audio (supports WAV, MP3, OGG, FLAC, etc.)
        language: Source language code (optional, auto-detect if None). Use 'vi' for Vietnamese
        task: 'transcribe' hoặc 'translate' (translate to English)
        beam_size: Beam size cho decoding (5 là default, higher = better quality but slower)
        word_timestamps: Include word-level timestamps (required for sentence segmentation)
        segment_sentences: Enable intelligent sentence segmentation (requires word_timestamps)
        prefer_model: Model preference - "phowhisper" or "faster-whisper" (optional, auto-select if None)
    
    Returns:
        TranscriptionResponse với text, segments, sentences, và metadata
    """
    # Check if any model is loaded
    if phowhisper_model is None and faster_whisper_model is None:
        raise HTTPException(status_code=503, detail="No models loaded")
    
    start_time = time.time()
    model_used = "unknown"
    
    try:
        # Read audio file
        audio_bytes = await audio.read()
        
        # Try to read with soundfile first
        try:
            audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes))
            # Ensure float32 (soundfile may return float64 on some systems)
            audio_data = audio_data.astype(np.float32)
            
            # Convert stereo to mono if needed
            if len(audio_data.shape) > 1:
                audio_data = audio_data.mean(axis=1)
            
            # Normalize audio to [-1, 1] range (critical for Whisper accuracy)
            audio_max = np.abs(audio_data).max()
            if audio_max > 0:
                audio_data = audio_data / audio_max
                
        except Exception as sf_error:
            # If soundfile fails, try using ffmpeg to convert to WAV first
            logger.warning(f"soundfile failed ({sf_error}), trying ffmpeg conversion...")
            
            import subprocess
            import tempfile
            
            # Save audio bytes to temp file
            with tempfile.NamedTemporaryFile(suffix='.input', delete=False) as input_file:
                input_file.write(audio_bytes)
                input_path = input_file.name
            
            # Output WAV file
            output_path = input_path.replace('.input', '.wav')
            
            try:
                # Convert to WAV using ffmpeg
                subprocess.run([
                    'ffmpeg', '-i', input_path,
                    '-ar', '16000',  # Resample to 16kHz
                    '-ac', '1',      # Convert to mono
                    '-f', 'wav',
                    output_path
                ], check=True, capture_output=True)
                
                # Read converted file
                audio_data, sample_rate = sf.read(output_path)
                # Ensure float32 after ffmpeg conversion
                audio_data = audio_data.astype(np.float32)
                
                # Convert stereo to mono if needed
                if len(audio_data.shape) > 1:
                    audio_data = audio_data.mean(axis=1)
                
                # Normalize audio to [-1, 1] range
                audio_max = np.abs(audio_data).max()
                if audio_max > 0:
                    audio_data = audio_data / audio_max
                    
                logger.info(f"✅ Successfully converted audio using ffmpeg")
                
            finally:
                # Cleanup temp files
                import os
                if os.path.exists(input_path):
                    os.remove(input_path)
                if os.path.exists(output_path):
                    os.remove(output_path)
        
        # Calculate audio duration
        audio_duration = len(audio_data) / sample_rate
        AUDIO_LENGTH_HISTOGRAM.observe(audio_duration)
        
        logger.info(f"Processing audio: duration={audio_duration:.2f}s, sample_rate={sample_rate}Hz, language={language}, prefer_model={prefer_model}")
        
        # Choose model based on prefer_model or language
        # Strategy:
        # 1. If prefer_model is specified, use that model (if available)
        # 2. Otherwise, auto-select: language="vi" → PhoWhisper, else → faster-whisper
        use_phowhisper = False
        
        if prefer_model == "phowhisper" and phowhisper_model is not None:
            # User explicitly requested PhoWhisper
            use_phowhisper = True
            logger.info("Using PhoWhisper (user preference)")
        elif prefer_model == "faster-whisper" and faster_whisper_model is not None:
            # User explicitly requested faster-whisper
            use_phowhisper = False
            logger.info("Using faster-whisper (user preference)")
        elif phowhisper_model is not None and language == "vi":
            # Auto-select PhoWhisper for Vietnamese (no preference specified)
            use_phowhisper = True
            logger.info("Using PhoWhisper (auto-detected Vietnamese)")
        
        if use_phowhisper:
            # Use PhoWhisper (Vietnamese-only, high accuracy for pure Vietnamese)
            model_used = "phowhisper-small"
            result = await transcribe_with_phowhisper(
                audio_data, sample_rate, language, word_timestamps
            )
        elif faster_whisper_model is not None:
            # Use faster-whisper (multilingual fallback or default)
            model_used = "faster-whisper-small"
            result = transcribe_with_faster_whisper(
                audio_data, language, task, beam_size, word_timestamps
            )
        else:
            raise HTTPException(status_code=503, detail="No suitable model available")
        
        processing_time = time.time() - start_time
        
        # Intelligent sentence segmentation (if enabled and word timestamps available)
        sentences = None
        if segment_sentences and word_timestamps and result['segments']:
            segmenter = SentenceSegmenter(pause_threshold=0.5)
            sentences = segmenter.segment_by_timestamps(result['segments'])
            logger.info(f"Segmented into {len(sentences)} sentences")
        
        # Metrics
        TRANSCRIPTION_DURATION.observe(processing_time)
        TRANSCRIPTION_COUNTER.labels(
            status='success',
            language=result['language']
        ).inc()
        
        logger.info(
            f"✅ Transcription completed: model={model_used}, language={result['language']}, "
            f"duration={audio_duration:.2f}s, processing_time={processing_time:.2f}s, "
            f"RTF={processing_time/audio_duration:.2f}"
        )
        
        return TranscriptionResponse(
            text=result['text'],
            language=result['language'],
            language_probability=result['language_probability'],
            duration=audio_duration,
            segments=result['segments'],
            sentences=sentences,
            processing_time=processing_time,
            model_used=model_used
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Transcription error: {e}", exc_info=True)
        TRANSCRIPTION_COUNTER.labels(status='error', language='unknown').inc()
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


async def transcribe_with_phowhisper(
    audio_data: np.ndarray,
    sample_rate: int,
    language: Optional[str],
    word_timestamps: bool
) -> Dict:
    """
    Transcribe using PhoWhisper (Vietnamese-specialized)
    
    Returns:
        Dict with text, language, language_probability, segments
    """
    logger.info("Using PhoWhisper for transcription")
    
    # Resample if needed (PhoWhisper expects 16kHz)
    if sample_rate != 16000:
        # Simple resampling (for production, use librosa or torchaudio)
        from scipy import signal
        audio_data = signal.resample(
            audio_data, 
            int(len(audio_data) * 16000 / sample_rate)
        )
        sample_rate = 16000
    
    # CRITICAL: Ensure float32 (scipy.resample returns float64, causing ONNX error)
    audio_data = audio_data.astype(np.float32)
    
    # Re-normalize after resampling (scipy.resample can change amplitude)
    audio_max = np.abs(audio_data).max()
    if audio_max > 0:
        audio_data = audio_data / audio_max
    
    # Process audio
    inputs = phowhisper_processor(
        audio_data,
        sampling_rate=sample_rate,
        return_tensors="pt"
    )
    
    # Generate with timestamps
    with torch.no_grad():
        if word_timestamps:
            predicted_ids = phowhisper_model.generate(
                inputs.input_features,
                return_timestamps=True,
                max_length=448
            )
        else:
            predicted_ids = phowhisper_model.generate(
                inputs.input_features,
                max_length=448
            )
    
    # Decode
    transcription = phowhisper_processor.batch_decode(
        predicted_ids,
        skip_special_tokens=True
    )
    
    # Extract segments (PhoWhisper returns timestamps in the text)
    full_text = transcription[0]
    segments_list = []
    
    if word_timestamps:
        # Parse timestamps from output (format: <|0.00|> word <|1.50|>)
        # For now, create a single segment
        # TODO: Implement proper timestamp parsing
        segments_list.append({
            "start": 0.0,
            "end": len(audio_data) / sample_rate,
            "text": full_text,
            "words": []  # PhoWhisper timestamp parsing to be implemented
        })
    else:
        segments_list.append({
            "start": 0.0,
            "end": len(audio_data) / sample_rate,
            "text": full_text
        })
    
    # Detect language (PhoWhisper is primarily Vietnamese but supports others)
    detected_language = language if language else "vi"
    
    # Apply punctuation restoration for Vietnamese
    punctuated_text = restore_vietnamese_punctuation(full_text) if detected_language == "vi" else full_text
    
    return {
        'text': punctuated_text,  # Text with punctuation
        'text_raw': full_text,     # Original text without punctuation
        'language': detected_language,
        'language_probability': 0.95 if detected_language == "vi" else 0.85,
        'segments': segments_list
    }


def transcribe_with_faster_whisper(
    audio_data: np.ndarray,
    language: Optional[str],
    task: str,
    beam_size: int,
    word_timestamps: bool
) -> Dict:
    """
    Transcribe using faster-whisper (multilingual with auto language detection)
    
    FEATURES:
    - Multilingual: 99 languages supported
    - Auto language detection
    - VAD filtering for noise removal
    - Word-level timestamps
    
    Returns:
        Dict with text, language, language_probability, segments
    """
    logger.info("Using faster-whisper for transcription")
    
    # Transcribe với parameters theo Whisper paper & faster-whisper best practices
    # Reference: https://cdn.openai.com/papers/whisper.pdf (Section 3.8)
    segments_generator, info = faster_whisper_model.transcribe(
        audio_data,
        language=language,  # None = auto-detect, "vi" = force Vietnamese
        task=task,          # "transcribe" or "translate"
        beam_size=beam_size,
        word_timestamps=word_timestamps,
        
        # VAD (Voice Activity Detection) - Silero VAD model
        vad_filter=True,
        vad_parameters=dict(
            min_silence_duration_ms=500  # 500ms silence = câu mới (default, đã test tốt)
        ),
        
        # Conditioning & Quality Control (Whisper paper recommendations)
        condition_on_previous_text=True,     # Context từ segment trước → giảm lỗi nhận diện
        compression_ratio_threshold=1.35,    # Anti-repetition (paper recommend, giảm từ 2.4)
        log_prob_threshold=-1.0,             # Fallback temperature nếu low confidence
        no_speech_threshold=0.6,             # Skip segment nếu >60% probability of silence
        
        # Temperature fallback cho segments khó (paper section 3.7)
        temperature=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0]  # Progressive sampling nếu beam search fail
    )
    
    # Convert generator to list và extract data
    segments_list = []
    full_text = []
    
    for segment in segments_generator:
        segment_dict = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip()
        }
        
        if word_timestamps and hasattr(segment, 'words'):
            segment_dict["words"] = [
                {
                    "word": word.word,
                    "start": word.start,
                    "end": word.end,
                    "probability": word.probability
                }
                for word in segment.words
            ]
        
        segments_list.append(segment_dict)
        full_text.append(segment.text.strip())
    
    # Join segments into full text
    raw_text = " ".join(full_text)
    
    # Apply punctuation restoration for Vietnamese
    punctuated_text = restore_vietnamese_punctuation(raw_text) if info.language == "vi" else raw_text
    
    return {
        'text': punctuated_text,  # Text with punctuation
        'text_raw': raw_text,      # Original text without punctuation
        'language': info.language,
        'language_probability': info.language_probability,
        'segments': segments_list
    }


# ==================== STREAMING ENDPOINTS ====================

@app.post("/api/v1/stream-start")
async def start_streaming_session(request: StreamStartRequest):
    """
    Bắt đầu streaming session cho participant
    
    Args:
        request: StreamStartRequest với participant_id và language
        
    Returns:
        Success message với session info
    """
    try:
        session = get_or_create_session(request.participant_id, request.language)
        return {
            "status": "success",
            "message": f"Streaming session started for {request.participant_id}",
            "participant_id": request.participant_id,
            "language": session['language'] or "auto-detect",
            "created_at": session['created_at']
        }
    except Exception as e:
        logger.error(f"❌ Error starting streaming session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to start session: {str(e)}")


@app.post("/api/v1/stream-end")
async def end_streaming_session(request: StreamEndRequest):
    """
    Kết thúc streaming session cho participant
    
    Args:
        request: StreamEndRequest với participant_id
        
    Returns:
        Success message với session stats
    """
    try:
        if request.participant_id not in streaming_sessions:
            logger.warning(f"⚠️ No session found for {request.participant_id}")
            return {
                "status": "warning",
                "message": f"No active session for {request.participant_id}"
            }
        
        session = streaming_sessions[request.participant_id]
        chunk_count = session['chunk_count']
        duration = time.time() - session['created_at']
        
        cleanup_session(request.participant_id)
        
        return {
            "status": "success",
            "message": f"Streaming session ended for {request.participant_id}",
            "participant_id": request.participant_id,
            "chunks_processed": chunk_count,
            "duration_seconds": round(duration, 2)
        }
    except Exception as e:
        logger.error(f"❌ Error ending streaming session: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to end session: {str(e)}")


@app.post("/api/v1/transcribe-stream", response_model=StreamingTranscriptionResponse)
async def transcribe_stream(request: StreamingAudioRequest):
    """
    Transcribe streaming audio chunk (real-time processing)
    
    Args:
        request: StreamingAudioRequest với audio_data (base64), sample_rate, format, etc.
        
    Returns:
        StreamingTranscriptionResponse với interim hoặc final transcription
        
    Note:
        - Accepts 100ms audio chunks từ Gateway AudioProcessor
        - Returns interim results nhanh (<200ms target)
        - Accumulates buffer để improve accuracy
    """
    start_time = time.time()
    
    # Check if any model is loaded
    if phowhisper_model is None and faster_whisper_model is None:
        raise HTTPException(status_code=503, detail="No models loaded")
    
    try:
        # Get or create session
        session = get_or_create_session(request.participant_id, request.language)
        session['chunk_count'] += 1
        chunk_id = session['chunk_count']
        
        # Decode base64 audio
        try:
            audio_bytes = base64.b64decode(request.audio_data)
        except Exception as e:
            logger.error(f"❌ Failed to decode base64 audio: {e}")
            raise HTTPException(status_code=400, detail=f"Invalid base64 audio data: {str(e)}")
        
        # Convert bytes to numpy array (assume PCM16 little-endian)
        if request.format == "pcm16":
            # PCM16: 2 bytes per sample, little-endian signed integer
            audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
            # Normalize to [-1, 1]
            audio_data = audio_data / 32768.0
        elif request.format == "wav":
            # Parse WAV file
            audio_data, sample_rate_wav = sf.read(io.BytesIO(audio_bytes))
            audio_data = audio_data.astype(np.float32)
            # Override sample rate from WAV header
            request.sample_rate = sample_rate_wav
        elif request.format == "opus":
            # TODO: Decode Opus to PCM (requires opuslib or ffmpeg)
            # For now, return error
            raise HTTPException(
                status_code=400,
                detail="Opus format not yet supported. Use pcm16 or wav format. Gateway should include Opus decoder."
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported audio format: {request.format}")
        
        # Handle stereo to mono conversion
        if request.channels == 2 and len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)
        
        # Add to session buffer (accumulate cho better accuracy)
        session['buffer'].append(audio_data)
        
        # Strategy: Process khi buffer đủ lớn (500ms - 1s) hoặc chunk thứ 5
        # Balance giữa latency và accuracy
        MIN_BUFFER_SIZE = int(request.sample_rate * 0.5)  # 500ms
        should_process = (
            len(np.concatenate(session['buffer'])) >= MIN_BUFFER_SIZE or
            chunk_id % 5 == 0  # Process mỗi 5 chunks (500ms nếu chunk 100ms)
        )
        
        if not should_process:
            # Return empty interim result (chờ accumulate thêm)
            return StreamingTranscriptionResponse(
                participant_id=request.participant_id,
                text="",
                language=session['language'] or "vi",
                confidence=0.0,
                is_final=False,
                timestamp=time.time(),
                chunk_id=chunk_id,
                model_used="pending"
            )
        
        # Concatenate buffer
        full_audio = np.concatenate(session['buffer'])
        
        # Clear buffer sau khi process (hoặc giữ lại 200ms overlap để tránh cut words)
        overlap_samples = int(request.sample_rate * 0.2)  # 200ms overlap
        if len(full_audio) > overlap_samples:
            session['buffer'] = [full_audio[-overlap_samples:]]
        else:
            session['buffer'] = []
        
        # Detect language if not specified
        language = session['language'] or request.language or "vi"
        
        # Select model
        model_used = "unknown"
        result_text = ""
        detected_language = language
        confidence = 0.0
        
        # Use PhoWhisper for Vietnamese, faster-whisper for others
        if language == "vi" and phowhisper_model is not None:
            model_used = "phowhisper"
            result = await transcribe_with_phowhisper(
                full_audio,
                request.sample_rate,
                language,
                word_timestamps=False  # Skip timestamps cho streaming (faster)
            )
            result_text = result['text']
            detected_language = result['language']
            confidence = result['language_probability']
            
        elif faster_whisper_model is not None:
            model_used = "faster-whisper"
            result = await transcribe_with_faster_whisper(
                full_audio,
                request.sample_rate,
                language,
                word_timestamps=False,
                beam_size=1  # Beam=1 cho streaming (fastest)
            )
            result_text = result['text']
            detected_language = result['language']
            confidence = result['language_probability']
        else:
            raise HTTPException(status_code=503, detail="No suitable model available")
        
        # Update session language if detected
        if session['language'] is None:
            session['language'] = detected_language
        
        processing_time = time.time() - start_time
        
        # Log performance
        logger.info(
            f"✅ Streaming transcription [{model_used}] - "
            f"Participant: {request.participant_id}, "
            f"Chunk: {chunk_id}, "
            f"Text: '{result_text[:50]}...', "
            f"Time: {processing_time*1000:.0f}ms"
        )
        
        # Update metrics
        TRANSCRIPTION_COUNTER.labels(status='success', language=detected_language).inc()
        PROCESSING_TIME_HISTOGRAM.observe(processing_time)
        
        # Return interim result (is_final=True mỗi 10 chunks hoặc khi có punctuation)
        is_final_result = (
            chunk_id % 10 == 0 or
            any(p in result_text for p in ['.', '!', '?', '。', '！', '？'])
        )
        
        return StreamingTranscriptionResponse(
            participant_id=request.participant_id,
            text=result_text,
            language=detected_language,
            confidence=confidence,
            is_final=is_final_result,
            timestamp=time.time(),
            chunk_id=chunk_id,
            model_used=model_used
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Streaming transcription error: {e}", exc_info=True)
        TRANSCRIPTION_COUNTER.labels(status='error', language='unknown').inc()
        raise HTTPException(status_code=500, detail=f"Streaming transcription failed: {str(e)}")


@app.get("/models")
async def list_models():
    """List các models khả dụng"""
    return {
        "loaded_models": {
            "phowhisper": phowhisper_model is not None,
            "faster_whisper": faster_whisper_model is not None
        },
        "phowhisper_info": {
            "name": "vinai/PhoWhisper-small",
            "specialized_for": "Vietnamese",
            "accuracy_improvement": "+20% for Vietnamese vs general Whisper",
            "features": ["word_timestamps", "automatic_punctuation", "multilingual_support"],
            "languages": ["vi", "en", "zh", "ja", "ko", "fr", "de", "es", "it", "pt", "ru", "ar", "hi", "th", "id"]
        },
        "faster_whisper_info": {
            "current_model": os.getenv("MODEL_SIZE", "small"),
            "available_models": ["tiny", "tiny.en", "base", "base.en", "small", "small.en", "medium", "medium.en", "large-v2", "large-v3"],
            "compute_types": ["int8", "float16", "float32"],
            "note": "Larger models require more RAM and CPU. For CPU inference, int8 is recommended."
        },
        "recommendation": "Use language='vi' to explicitly use PhoWhisper for Vietnamese audio. Auto-detection will prefer PhoWhisper for better accuracy."
    }


@app.get("/languages")
async def list_languages():
    """List các languages được support"""
    return {
        "supported_languages": {
            "en": "English",
            "vi": "Vietnamese",
            "zh": "Chinese",
            "ja": "Japanese",
            "ko": "Korean",
            "fr": "French",
            "de": "German",
            "es": "Spanish",
            "it": "Italian",
            "pt": "Portuguese",
            "ru": "Russian",
            "ar": "Arabic",
            "hi": "Hindi",
            "th": "Thai",
            "id": "Indonesian"
        },
        "note": "Auto-detection is available by not specifying a language"
    }


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8002,
        workers=2,
        log_level="info"
    )
