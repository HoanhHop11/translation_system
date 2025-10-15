# AI Models Configuration - Chi tiết Models và Optimization

**Version**: 2.0 (Based on Feasibility Study)  
**Last Updated**: 2025-10-04  
**Status**: ✅ Validated with benchmarks

## 🎯 Tổng quan

Tất cả models được chọn với tiêu chí:
- ✅ **CPU-compatible** (KHÔNG dùng CUDA)
- ✅ **Open-source, free** (Hugging Face, GitHub)
- ✅ **Có sẵn trên Hugging Face** (easy deployment)
- ✅ **Hiệu suất cao với quantization** (INT8)
- ✅ **Hỗ trợ tiếng Việt và đa ngôn ngữ**
- ✅ **Production-tested** (benchmarks available)

### ⚠️ Key Changes từ v1.0
1. **STT**: Thêm PhoWhisper cho Vietnamese
2. **Translation**: Thêm caching strategy
3. **TTS**: **Tiered approach** (gTTS + XTTS)
4. **Diarization**: Optional, not always-on
5. **Performance**: Validated với real benchmarks

## 1. Speech Recognition - Whisper (STT)

### 1.1 Model Selection & Benchmarks

**Primary: faster-whisper (CTranslate2)**
```python
Library: faster-whisper
Repository: https://github.com/systran/faster-whisper
License: MIT
Hugging Face: Automatic download

Performance (CPU - Intel i7-12700K, 8 threads):
Model: small-int8
Audio: 13 minutes
Time: 1m42s (7.8x realtime) ✅
RAM: 1477MB
WER (English): 5-8%
WER (Multilingual avg): 8-12%

Comparison with alternatives:
- openai/whisper small fp32: 6m58s (slower)
- whisper.cpp: 2m05s (faster but less accurate)
- faster-whisper small-int8: 1m42s ✅ BEST BALANCE
```

**Models Available:**
| Model | Params | RAM | Speed (13min) | WER (EN) | Verdict |
|-------|--------|-----|---------------|----------|---------|
| **tiny** | 39M | 600MB | 50s (15x) | 10-15% | Too low accuracy |
| **base** | 74M | 1000MB | 1m10s (11x) | 6-10% | ✅ Good balance |
| **small** | 244M | 1477MB | **1m42s (7.8x)** | **5-8%** | ✅ **RECOMMENDED** |
| **medium** | 769M | 3GB+ | 4m+ (3x) | 3-5% | Too slow for CPU |

**Recommended: small-int8** cho optimal speed/accuracy balance

### 1.2 Vietnamese Enhancement: PhoWhisper

**PhoWhisper (VINAI Research - ICLR 2024)**
```python
Model: vinai/PhoWhisper-large
Repository: https://huggingface.co/vinai/PhoWhisper-large
License: BSD-3-Clause

Training Data:
- 844 hours Vietnamese speech
- Multiple accents and dialects
- State-of-the-art on Vietnamese ASR

Performance:
- WER (Vietnamese): 9.35% (VLSP 2020)
- Accuracy: 90-91%
- Better than vanilla Whisper by 15-20%

Usage:
- Primary for Vietnamese audio
- Fallback to Whisper multilingual for other languages
```

### 1.3 Configuration (Updated)

```python
# services/transcription/config.py
from faster_whisper import WhisperModel

# Primary model for multilingual
WHISPER_CONFIG = {
    "model_size": "small",    # Best balance
    "device": "cpu",
    "compute_type": "int8",   # Quantization INT8 ✅
    "cpu_threads": 4,         # Use 4 threads
    "num_workers": 2,         # 2 concurrent workers
    "download_root": "/models/whisper",
    
    # Inference settings (optimized)
    "beam_size": 5,
    "best_of": 5,
    "temperature": [0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    "compression_ratio_threshold": 2.4,
    "log_prob_threshold": -1.0,
    "no_speech_threshold": 0.6,
    
    # VAD settings (critical for quality) ⭐
    "vad_filter": True,       # Enable Voice Activity Detection
    "vad_parameters": {
        "threshold": 0.5,
        "min_speech_duration_ms": 250,
        "max_speech_duration_s": 30,
        "min_silence_duration_ms": 500,  # Reduce hallucinations
        "window_size_samples": 512,
        "speech_pad_ms": 400,
    },
    
    # VAD settings
    "vad_filter": True,
    "vad_parameters": {
        "threshold": 0.5,
        "min_speech_duration_ms": 250,
        "max_speech_duration_s": 30,
        "min_silence_duration_ms": 500,
        "window_size_samples": 1024,
        "speech_pad_ms": 400
    }
}

# Example usage
model = WhisperModel(
    MODEL_CONFIG["model_size"],
    device=MODEL_CONFIG["device"],
    compute_type=MODEL_CONFIG["compute_type"]
)
```

### Optimization Strategies

```python
# 1. Model Caching - Load once, reuse
class WhisperService:
    _model = None
    
    @classmethod
    def get_model(cls):
        if cls._model is None:
            cls._model = WhisperModel(**MODEL_CONFIG)
        return cls._model

# 2. Chunking Strategy
CHUNK_LENGTH = 30  # seconds
CHUNK_OVERLAP = 5  # seconds để tránh mất từ

def process_audio_stream(audio_stream):
    chunks = create_chunks(
        audio_stream, 
        chunk_length=CHUNK_LENGTH,
        overlap=CHUNK_OVERLAP
    )
    
    for chunk in chunks:
        segments, info = model.transcribe(
            chunk,
            vad_filter=True,
            language=None  # Auto-detect
        )
        yield segments

# 3. Batch Processing (nếu có queue)
def batch_transcribe(audio_chunks, batch_size=4):
    """Xử lý nhiều chunks cùng lúc nếu CPU có đủ cores"""
    with ThreadPoolExecutor(max_workers=batch_size) as executor:
        futures = [
            executor.submit(transcribe_single, chunk) 
            for chunk in audio_chunks
        ]
        return [f.result() for f in futures]
```

### Language Support

```python
SUPPORTED_LANGUAGES = {
    "vi": "Vietnamese",
    "en": "English",
    "zh": "Chinese",
    "ja": "Japanese",
    "ko": "Korean",
    "th": "Thai",
    "id": "Indonesian",
    "ms": "Malay",
    "fr": "French",
    "de": "German",
    "es": "Spanish",
    "it": "Italian",
    "pt": "Portuguese",
    "ru": "Russian",
    "ar": "Arabic",
    "hi": "Hindi"
    # ... và hơn 80 ngôn ngữ khác
}

# Auto language detection
segments, info = model.transcribe(audio, language=None)
detected_language = info.language
detected_probability = info.language_probability
```

## 2. Translation - NLLB-200

### Model Selection

**Primary: NLLB-200-distilled-600M**
```python
Model: facebook/nllb-200-distilled-600M
Size: 600M parameters
RAM: ~2.5GB (INT8 quantized)
Languages: 200+
Hugging Face: facebook/nllb-200-distilled-600M

Alternative (nếu cần nhẹ hơn):
- NLLB-200-distilled-1.3B: Better quality, more RAM
- Opus-MT models: Specific language pairs, faster
```

### Configuration

```python
# services/translation/config.py
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from optimum.bettertransformer import BetterTransformer
import torch

MODEL_CONFIG = {
    "model_name": "facebook/nllb-200-distilled-600M",
    "cache_dir": "/models/nllb",
    "device": "cpu",
    "torch_dtype": torch.int8,
    
    # Generation settings
    "max_length": 512,
    "num_beams": 4,
    "early_stopping": True,
    "no_repeat_ngram_size": 3,
    
    # Batching
    "batch_size": 8,
    "max_batch_size": 16
}

# Load model với optimizations
def load_translation_model():
    tokenizer = AutoTokenizer.from_pretrained(
        MODEL_CONFIG["model_name"],
        cache_dir=MODEL_CONFIG["cache_dir"]
    )
    
    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_CONFIG["model_name"],
        cache_dir=MODEL_CONFIG["cache_dir"],
        torch_dtype=torch.float32  # Load as float32 first
    )
    
    # Apply BetterTransformer for CPU optimization
    model = BetterTransformer.transform(model)
    
    # Dynamic quantization
    model = torch.quantization.quantize_dynamic(
        model, 
        {torch.nn.Linear}, 
        dtype=torch.qint8
    )
    
    return tokenizer, model
```

### Language Codes (NLLB)

```python
# services/translation/language_codes.py
NLLB_LANGUAGE_CODES = {
    "vi": "vie_Latn",  # Vietnamese
    "en": "eng_Latn",  # English
    "zh": "zho_Hans",  # Chinese (Simplified)
    "zh-TW": "zho_Hant",  # Chinese (Traditional)
    "ja": "jpn_Jpan",  # Japanese
    "ko": "kor_Hang",  # Korean
    "th": "tha_Thai",  # Thai
    "id": "ind_Latn",  # Indonesian
    "ms": "zsm_Latn",  # Malay
    "tl": "tgl_Latn",  # Tagalog
    "lo": "lao_Laoo",  # Lao
    "my": "mya_Mymr",  # Burmese
    "km": "khm_Khmr",  # Khmer
    "fr": "fra_Latn",  # French
    "de": "deu_Latn",  # German
    "es": "spa_Latn",  # Spanish
    "it": "ita_Latn",  # Italian
    "pt": "por_Latn",  # Portuguese
    "ru": "rus_Cyrl",  # Russian
    "ar": "arb_Arab",  # Arabic
    "hi": "hin_Deva",  # Hindi
}

def get_nllb_code(lang_code: str) -> str:
    """Convert ISO code to NLLB code"""
    return NLLB_LANGUAGE_CODES.get(lang_code, "eng_Latn")
```

### Translation Service Implementation

```python
# services/translation/translator.py
import hashlib
import redis
from typing import List, Optional

class TranslationService:
    def __init__(self):
        self.tokenizer, self.model = load_translation_model()
        self.redis_client = redis.Redis(
            host='redis', 
            port=6379, 
            db=1,
            decode_responses=True
        )
        self.cache_ttl = 86400  # 24 hours
    
    def _get_cache_key(self, text: str, src_lang: str, tgt_lang: str) -> str:
        """Generate cache key cho sentence"""
        content = f"{text}:{src_lang}:{tgt_lang}"
        return f"trans:{hashlib.md5(content.encode()).hexdigest()}"
    
    async def translate(
        self,
        text: str,
        source_lang: str,
        target_lang: str,
        context: Optional[str] = None
    ) -> str:
        """
        Dịch text với caching và context support.
        
        Args:
            text: Text cần dịch
            source_lang: Mã ngôn ngữ nguồn (ISO)
            target_lang: Mã ngôn ngữ đích (ISO)
            context: Ngữ cảnh bổ sung từ documents
            
        Returns:
            str: Translated text
        """
        # Check cache
        cache_key = self._get_cache_key(text, source_lang, target_lang)
        cached = self.redis_client.get(cache_key)
        if cached:
            return cached
        
        # Prepare text với context
        if context:
            input_text = f"Context: {context}\n\nTranslate: {text}"
        else:
            input_text = text
        
        # Get NLLB language codes
        src_code = get_nllb_code(source_lang)
        tgt_code = get_nllb_code(target_lang)
        
        # Tokenize
        self.tokenizer.src_lang = src_code
        inputs = self.tokenizer(
            input_text,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=512
        )
        
        # Generate translation
        translated_tokens = self.model.generate(
            **inputs,
            forced_bos_token_id=self.tokenizer.lang_code_to_id[tgt_code],
            max_length=512,
            num_beams=4,
            early_stopping=True
        )
        
        # Decode
        translation = self.tokenizer.batch_decode(
            translated_tokens, 
            skip_special_tokens=True
        )[0]
        
        # Cache result
        self.redis_client.setex(
            cache_key, 
            self.cache_ttl, 
            translation
        )
        
        return translation
    
    async def translate_batch(
        self,
        texts: List[str],
        source_lang: str,
        target_lang: str
    ) -> List[str]:
        """Batch translation cho performance"""
        # Implementation tương tự nhưng xử lý batch
        pass
```

### Fallback Translation Service

```python
# services/translation/fallback.py
from libretranslate import LibreTranslateAPI

class FallbackTranslator:
    """
    Fallback service sử dụng LibreTranslate (self-hosted, free)
    Hoặc có thể dùng Google Translate API free tier
    """
    def __init__(self):
        self.lt = LibreTranslateAPI("http://libretranslate:5000")
    
    async def translate(self, text: str, source: str, target: str) -> str:
        try:
            result = self.lt.translate(text, source, target)
            return result
        except Exception as e:
            logger.error(f"Fallback translation failed: {e}")
            return text  # Return original nếu thất bại
```

## 3. Text-to-Speech (TTS) - Tiered Approach ⭐ NEW

### 3.1 Strategy Overview (v2.0)

**Problem**: XTTS v2 takes 30-60s on CPU (not real-time)  
**Solution**: Tiered TTS with progressive enhancement

```
Tier 1 (Free): gTTS          → 200-300ms latency ✅
Tier 2 (Premium): XTTS async → 30s background ✅
Tier 3 (Fallback): pyttsx3   → 100ms emergency ✅
```

### 3.2 Tier 1: Quick TTS (gTTS) - Primary

**Google Text-to-Speech (gTTS)**
```python
Library: gTTS
Repository: https://github.com/pndurette/gTTS
License: MIT
Cost: FREE (Google TTS API)

Performance:
- Latency: 200-300ms (network call)
- Quality: Fair (MOS 3.0-3.5)
- Voice: Robotic but clear
- Languages: 100+
- Reliability: Very high (Google infrastructure)

Pros:
✅ Very fast (< 300ms)
✅ 100+ languages
✅ Free and reliable
✅ Good enough for real-time
✅ No local compute needed

Cons:
❌ Robotic voice
❌ No voice cloning
❌ Requires internet
❌ Limited customization
```

**Configuration:**
```python
# services/tts/quick_tts.py
from gtts import gTTS
import io
import asyncio
from functools import lru_cache

class QuickTTS:
    """Fast TTS using gTTS for immediate audio feedback"""
    
    def __init__(self):
        self.redis_client = redis.Redis(host='redis', port=6379, db=3)
        self.cache_ttl = 3600  # 1 hour
    
    @lru_cache(maxsize=1000)
    def _get_cache_key(self, text: str, lang: str) -> str:
        return f"gtts:{lang}:{hashlib.md5(text.encode()).hexdigest()}"
    
    async def synthesize(
        self,
        text: str,
        language: str = "en",
        slow: bool = False
    ) -> bytes:
        """
        Synthesize speech using gTTS (FAST).
        
        Args:
            text: Text to synthesize
            language: Target language code
            slow: Speak slowly (default: False)
            
        Returns:
            bytes: MP3 audio data
        """
        # Check cache
        cache_key = self._get_cache_key(text, language)
        cached = await self.redis_client.get(cache_key)
        if cached:
            return cached
        
        # Generate audio
        try:
            tts = gTTS(text=text, lang=language, slow=slow)
            audio_buffer = io.BytesIO()
            tts.write_to_fp(audio_buffer)
            audio_data = audio_buffer.getvalue()
            
            # Cache result
            await self.redis_client.setex(
                cache_key,
                self.cache_ttl,
                audio_data
            )
            
            return audio_data
            
        except Exception as e:
            logger.error(f"gTTS error: {e}")
            # Fallback to pyttsx3
            return await self.fallback_tts(text, language)
    
    async def fallback_tts(self, text: str, language: str) -> bytes:
        """Emergency fallback using pyttsx3 (offline)"""
        import pyttsx3
        engine = pyttsx3.init()
        
        # Set language-specific voice if available
        voices = engine.getProperty('voices')
        for voice in voices:
            if language in voice.languages:
                engine.setProperty('voice', voice.id)
                break
        
        # Synthesize to file
        temp_file = f"/tmp/tts_{uuid.uuid4()}.wav"
        engine.save_to_file(text, temp_file)
        engine.runAndWait()
        
        with open(temp_file, 'rb') as f:
            audio_data = f.read()
        
        os.remove(temp_file)
        return audio_data

# Usage
quick_tts = QuickTTS()
audio = await quick_tts.synthesize("Hello world", language="en")
# Latency: 200-300ms ✅
```

### 3.3 Tier 2: Voice Cloning (XTTS v2) - Premium/Async

**Coqui XTTS v2 (Background Processing)**
```python
Model: coqui/XTTS-v2
Type: Zero-shot voice cloning
Languages: 17 (including vi, en, zh, ja, ko, th, etc.)
RAM: ~3-4GB
Quality: Excellent (MOS 4.0-4.5)
Latency: 30-60 seconds (CPU) ⚠️

Performance Reality (from research):
- CPU-only: 30-60s for paragraph
- Short sentence: 15-30s
- Long paragraph: 60-90s
- Voice similarity: >80%
- Naturalness: Excellent

Strategy:
✅ Async background job (Celery)
✅ Premium users only
✅ Pre-computed embeddings
✅ Progressive enhancement
✅ Non-blocking UI
```

**Configuration (Async):**
```python
# services/voice-cloning/xtts_async.py
from TTS.api import TTS
from celery import Celery
import torch

celery_app = Celery('voice_cloning', broker='redis://redis:6379/4')

MODEL_CONFIG = {
    "model_name": "tts_models/multilingual/multi-dataset/xtts_v2",
    "device": "cpu",
    "use_cuda": False,
    
    # Voice settings
    "sample_rate": 24000,
    "min_reference_length": 6.0,  # seconds
    "max_reference_length": 30.0,
    
    # Generation settings
    "temperature": 0.75,
    "length_penalty": 1.0,
    "repetition_penalty": 5.0,
    "top_k": 50,
    "top_p": 0.85,
}

class VoiceClonerAsync:
    """XTTS v2 for high-quality voice cloning (background)"""
    
    def __init__(self):
        self.tts = TTS(
            model_name=MODEL_CONFIG["model_name"],
            progress_bar=False
        ).to("cpu")
        self.redis_client = redis.Redis(host='redis', port=6379, db=4)
        self.embeddings_dir = Path("/data/voice_embeddings")
    
    async def register_voice_sample(
        self,
        user_id: str,
        audio_sample: bytes,
        language: str = "en"
    ) -> dict:
        """
        Register voice sample for premium user.
        This is done ONCE during setup, takes 5-10s.
        
        Returns:
            dict: {
                "voice_id": str,
                "embedding_path": str,
                "status": "ready"
            }
        """
        # Validate audio (6-30 seconds)
        audio, sr = librosa.load(io.BytesIO(audio_sample), sr=24000)
        duration = librosa.get_duration(y=audio, sr=sr)
        
        if not (6.0 <= duration <= 30.0):
            raise ValueError(f"Audio must be 6-30s, got {duration}s")
        
        # Generate voice ID
        voice_id = f"voice_{user_id}_{uuid.uuid4().hex[:8]}"
        embedding_path = self.embeddings_dir / f"{voice_id}.wav"
        
        # Save reference audio (for XTTS)
        librosa.output.write_wav(str(embedding_path), audio, sr)
        
        # Pre-compute embedding (optional optimization)
        # embedding = self.tts.synthesizer.tts_model.get_conditioning_latents(
        #     audio_path=str(embedding_path)
        # )
        
        # Cache voice info
        voice_info = {
            "user_id": user_id,
            "voice_id": voice_id,
            "embedding_path": str(embedding_path),
            "language": language,
            "duration": duration,
            "status": "ready"
        }
        
        await self.redis_client.setex(
            f"voice:{user_id}",
            86400 * 30,  # 30 days
            json.dumps(voice_info)
        )
        
        return voice_info
    
    @celery_app.task(priority=1)  # Low priority
    def clone_voice_async(
        self,
        text: str,
        user_id: str,
        language: str,
        request_id: str
    ) -> dict:
        """
        Clone voice ASYNCHRONOUSLY (background job).
        Takes 30-60s, doesn't block user experience.
        
        User flow:
        1. User sees text immediately (< 1s)
        2. User hears gTTS audio quickly (1.5s)
        3. Background: This job runs (30-60s)
        4. UI notification: "High-quality voice ready"
        5. Audio replaced seamlessly
        """
        try:
            # Get voice embedding
            voice_info = json.loads(
                self.redis_client.get(f"voice:{user_id}")
            )
            reference_audio = voice_info["embedding_path"]
            
            # Generate speech (THIS TAKES 30-60s)
            output_path = f"/tmp/xtts_{request_id}.wav"
            self.tts.tts_to_file(
                text=text,
                speaker_wav=reference_audio,
                language=language,
                file_path=output_path
            )
            
            # Read generated audio
            with open(output_path, 'rb') as f:
                audio_data = f.read()
            
            # Store result
            result_key = f"xtts_result:{request_id}"
            await self.redis_client.setex(
                result_key,
                3600,  # 1 hour
                audio_data
            )
            
            # Notify frontend via WebSocket
            await notify_client(
                user_id=user_id,
                event="voice_clone_ready",
                data={
                    "request_id": request_id,
                    "audio_url": f"/api/audio/xtts/{request_id}",
                    "duration": duration
                }
            )
            
            # Cleanup
            os.remove(output_path)
            
            return {
                "status": "success",
                "request_id": request_id,
                "latency_seconds": 30-60  # Actual timing
            }
            
        except Exception as e:
            logger.error(f"XTTS async failed: {e}")
            return {"status": "error", "error": str(e)}

# Usage in translation pipeline
async def translate_and_synthesize(text, user, language):
    # 1. Translate (200ms)
    translated = await translate(text, language)
    
    # 2. Quick audio (300ms) - IMMEDIATE
    quick_audio = await quick_tts.synthesize(translated, language)
    
    # Send to user immediately (1.3-1.5s total)
    await send_to_user(text=translated, audio=quick_audio)
    
    # 3. Check if premium user
    if user.is_premium and user.has_voice_sample:
        # Queue background job (non-blocking)
        request_id = str(uuid.uuid4())
        voice_cloner.clone_voice_async.delay(
            text=translated,
            user_id=user.id,
            language=language,
            request_id=request_id
        )
        # User will get notification when ready (30s later)
```

### 3.4 Tier 3: Fallback TTS (pyttsx3) - Emergency

**pyttsx3 (Offline Backup)**
```python
Library: pyttsx3
Type: Offline TTS engine
Languages: 20+ (system dependent)
Latency: 100-200ms
Quality: Poor (MOS 2.0-2.5)

Use case:
- gTTS internet failure
- Emergency backup
- Offline mode

Configuration:
```python
import pyttsx3

class FallbackTTS:
    def __init__(self):
        self.engine = pyttsx3.init()
        self.engine.setProperty('rate', 150)  # Speed
        self.engine.setProperty('volume', 0.9)
    
    def synthesize(self, text: str, lang: str = "en") -> bytes:
        temp_file = f"/tmp/fallback_{uuid.uuid4()}.wav"
        self.engine.save_to_file(text, temp_file)
        self.engine.runAndWait()
        
        with open(temp_file, 'rb') as f:
            audio = f.read()
        os.remove(temp_file)
        return audio
```

### 3.5 TTS Decision Flow

```python
# services/tts/orchestrator.py

class TTSOrchestrator:
    """Smart TTS routing based on user tier and availability"""
    
    def __init__(self):
        self.quick_tts = QuickTTS()
        self.voice_cloner = VoiceClonerAsync()
        self.fallback_tts = FallbackTTS()
    
    async def synthesize_smart(
        self,
        text: str,
        language: str,
        user: User,
        request_id: str
    ) -> dict:
        """
        Smart TTS routing with progressive enhancement.
        
        Returns immediately with quick audio,
        queues premium audio in background.
        """
        result = {
            "request_id": request_id,
            "text": text,
            "audio_quick": None,
            "audio_premium_queued": False,
            "latency_ms": 0
        }
        
        start_time = time.time()
        
        # 1. Try gTTS (primary, fast)
        try:
            result["audio_quick"] = await self.quick_tts.synthesize(
                text, language
            )
            result["tts_method"] = "gtts"
            
        except Exception as e:
            logger.warning(f"gTTS failed: {e}, using fallback")
            # 2. Fallback to pyttsx3 (offline)
            result["audio_quick"] = self.fallback_tts.synthesize(
                text, language
            )
            result["tts_method"] = "pyttsx3"
        
        result["latency_ms"] = (time.time() - start_time) * 1000
        
        # 3. Queue premium voice clone if applicable
        if user.is_premium and user.has_voice_embedding:
            self.voice_cloner.clone_voice_async.delay(
                text=text,
                user_id=user.id,
                language=language,
                request_id=request_id
            )
            result["audio_premium_queued"] = True
            result["premium_eta_seconds"] = 30-60
        
        return result

# Usage
orchestrator = TTSOrchestrator()

result = await orchestrator.synthesize_smart(
    text="Hello, how are you?",
    language="en",
    user=current_user,
    request_id=str(uuid.uuid4())
)

# User gets quick audio immediately (200-300ms)
# Premium users get notification later (30s)
```

### 3.6 Performance Comparison

| TTS Method | Latency | Quality (MOS) | Languages | Cost | Use Case |
|------------|---------|---------------|-----------|------|----------|
| **gTTS** | 200-300ms | 3.0-3.5 | 100+ | FREE | ✅ Primary (all users) |
| **XTTS v2** | 30-60s | 4.0-4.5 | 17 | Compute | 💎 Premium (async) |
| **pyttsx3** | 100-200ms | 2.0-2.5 | 20+ | FREE | 🔧 Emergency fallback |
| **Azure TTS** | 300-500ms | 4.0-4.5 | 100+ | PAID | ❌ Not used (cost) |
| **ElevenLabs** | 500-800ms | 4.5-5.0 | 20+ | PAID | ❌ Not used (cost) |
            f"voice:{voice_id}",
            86400 * 30,  # 30 days
            json.dumps(voice_info)
        )
        
        return voice_id
    
    async def synthesize(
        self,
        text: str,
        voice_id: str,
        language: str,
        output_path: Optional[str] = None
    ) -> bytes:
        """
        Tổng hợp giọng nói từ text.
        
        Args:
            text: Text cần đọc
            voice_id: ID của voice đã register
            language: Ngôn ngữ output
            output_path: Path để save file (optional)
            
        Returns:
            bytes: Audio data (wav format)
        """
        # Get voice info
        voice_info = json.loads(
            self.redis_client.get(f"voice:{voice_id}")
        )
        reference_path = voice_info["reference_path"]
        
        # Generate speech
        wav = self.tts.tts(
            text=text,
            speaker_wav=reference_path,
            language=language,
            split_sentences=True
        )
        
        # Convert to bytes
        if output_path:
            self.tts.synthesizer.save_wav(wav, output_path)
            with open(output_path, 'rb') as f:
                return f.read()
        else:
            # In-memory conversion
            buffer = io.BytesIO()
            import soundfile as sf
            sf.write(buffer, wav, 22050, format='WAV')
            return buffer.getvalue()
    
    async def auto_collect_sample(
        self,
        user_id: str,
        audio_stream: bytes,
        min_duration: float = 10.0
    ) -> Optional[str]:
        """
        Tự động thu thập voice sample trong conversation.
        
        Args:
            user_id: ID của user
            audio_stream: Audio stream đang thu
            min_duration: Thời gian tối thiểu để register
            
        Returns:
            Optional[str]: Voice ID nếu đã đủ sample
        """
        # Implementation logic để tích lũy audio
        # và tự động register khi đủ điều kiện
        pass
```

### Fallback - gTTS

```python
# services/voice-cloning/fallback.py
from gtts import gTTS
import io

class SimpleTTS:
    """Fallback TTS service dùng gTTS (Google Text-to-Speech)"""
    
    SUPPORTED_LANGUAGES = {
        "vi": "vi",
        "en": "en",
        "zh": "zh-CN",
        "ja": "ja",
        "ko": "ko",
        "th": "th",
        "id": "id"
    }
    
    async def synthesize(
        self,
        text: str,
        language: str,
        slow: bool = False
    ) -> bytes:
        """
        Simple TTS synthesis.
        Không có voice cloning nhưng nhanh và reliable.
        """
        lang_code = self.SUPPORTED_LANGUAGES.get(language, "en")
        
        tts = gTTS(text=text, lang=lang_code, slow=slow)
        
        buffer = io.BytesIO()
        tts.write_to_fp(buffer)
        buffer.seek(0)
        
        return buffer.read()
```

## 4. Speaker Diarization - PyAnnote

### Model Selection

**Primary: pyannote/speaker-diarization-3.1**
```python
Model: pyannote/speaker-diarization-3.1
Pipeline: Segmentation + Embedding + Clustering
RAM: ~2GB
Hugging Face: pyannote/speaker-diarization-3.1

⚠️ YÊU CẦU: Người dùng phải cung cấp Hugging Face token
để download model (do model yêu cầu accept license)
```

### Configuration

```python
# services/diarization/config.py
from pyannote.audio import Pipeline
import torch

# ⚠️ CẦN HUGGING FACE TOKEN
HF_TOKEN = None  # PHẢI được cung cấp bởi người dùng

MODEL_CONFIG = {
    "pipeline": "pyannote/speaker-diarization-3.1",
    "use_auth_token": HF_TOKEN,  # ⚠️ REQUIRED
    "device": torch.device("cpu"),
    
    # Diarization settings
    "min_speakers": 1,
    "max_speakers": 10,
    "min_duration_off": 0.5,  # seconds
    
    # Segmentation
    "segmentation": {
        "min_duration_on": 0.0,
        "min_duration_off": 0.0
    },
    
    # Embedding
    "embedding": {
        "batch_size": 32,
        "window": "whole"
    },
    
    # Clustering
    "clustering": {
        "method": "centroid",
        "min_cluster_size": 15,
        "threshold": 0.7
    }
}

def load_diarization_pipeline():
    """
    ⚠️ QUAN TRỌNG: Hàm này sẽ FAIL nếu HF_TOKEN không được set.
    Người dùng PHẢI:
    1. Đăng ký Hugging Face account
    2. Accept model license tại: https://huggingface.co/pyannote/speaker-diarization-3.1
    3. Tạo token tại: https://huggingface.co/settings/tokens
    4. Set HF_TOKEN trong environment variables
    """
    if HF_TOKEN is None:
        raise ValueError(
            "⚠️ Hugging Face token is required!\n"
            "Please:\n"
            "1. Visit https://huggingface.co/pyannote/speaker-diarization-3.1\n"
            "2. Accept the model license\n"
            "3. Create token at https://huggingface.co/settings/tokens\n"
            "4. Set HF_TOKEN environment variable"
        )
    
    pipeline = Pipeline.from_pretrained(
        MODEL_CONFIG["pipeline"],
        use_auth_token=HF_TOKEN
    )
    pipeline.to(MODEL_CONFIG["device"])
    
    return pipeline
```

### Implementation

```python
# services/diarization/diarizer.py
from typing import List, Dict
import numpy as np

class SpeakerDiarizer:
    def __init__(self):
        self.pipeline = load_diarization_pipeline()
        self.redis_client = redis.Redis(host='redis', port=6379, db=3)
    
    async def diarize(
        self,
        audio_file: str,
        num_speakers: Optional[int] = None
    ) -> List[Dict]:
        """
        Phân tích speaker diarization.
        
        Args:
            audio_file: Path đến audio file
            num_speakers: Số speakers (nếu biết trước)
            
        Returns:
            List[Dict]: Danh sách segments với speaker labels
            Format: [
                {"start": 0.5, "end": 3.2, "speaker": "SPEAKER_00"},
                {"start": 3.5, "end": 6.1, "speaker": "SPEAKER_01"},
                ...
            ]
        """
        # Run diarization
        diarization = self.pipeline(
            audio_file,
            num_speakers=num_speakers,
            min_speakers=MODEL_CONFIG["min_speakers"],
            max_speakers=MODEL_CONFIG["max_speakers"]
        )
        
        # Convert to list format
        segments = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            segments.append({
                "start": turn.start,
                "end": turn.end,
                "speaker": speaker,
                "duration": turn.end - turn.start
            })
        
        return segments
    
    async def match_with_transcription(
        self,
        diarization: List[Dict],
        transcription: List[Dict]
    ) -> List[Dict]:
        """
        Kết hợp diarization với transcription.
        
        Args:
            diarization: Output từ diarize()
            transcription: Output từ Whisper
            
        Returns:
            List[Dict]: Transcription có thêm speaker labels
        """
        result = []
        
        for trans_segment in transcription:
            trans_start = trans_segment["start"]
            trans_end = trans_segment["end"]
            trans_mid = (trans_start + trans_end) / 2
            
            # Find overlapping speaker
            speaker = "UNKNOWN"
            max_overlap = 0
            
            for diar_segment in diarization:
                diar_start = diar_segment["start"]
                diar_end = diar_segment["end"]
                
                # Calculate overlap
                overlap_start = max(trans_start, diar_start)
                overlap_end = min(trans_end, diar_end)
                overlap = max(0, overlap_end - overlap_start)
                
                if overlap > max_overlap:
                    max_overlap = overlap
                    speaker = diar_segment["speaker"]
            
            result.append({
                **trans_segment,
                "speaker": speaker
            })
        
        return result
```

## 5. Document Context - Sentence Transformers

### Model Selection

**Primary: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2**
```python
Model: sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
Size: 118M params
Embedding dimension: 384
Languages: 50+ (including Vietnamese)
RAM: ~500MB
```

### Configuration

```python
# services/context/config.py
from sentence_transformers import SentenceTransformer
import faiss
import numpy as np

MODEL_CONFIG = {
    "model_name": "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    "device": "cpu",
    "batch_size": 32,
    
    # Chunking
    "chunk_size": 512,  # tokens
    "chunk_overlap": 50,
    
    # Search
    "top_k": 5,  # Top k relevant chunks
    "similarity_threshold": 0.7
}

# Load model
embedder = SentenceTransformer(
    MODEL_CONFIG["model_name"],
    device=MODEL_CONFIG["device"]
)
```

### Implementation

```python
# services/context/document_processor.py
from typing import List
import PyPDF2
import docx

class DocumentProcessor:
    def __init__(self):
        self.embedder = embedder
        self.index = None  # FAISS index
        self.chunks = []   # Text chunks
    
    async def process_document(
        self,
        file_path: str,
        file_type: str
    ) -> List[str]:
        """Extract và chunk document"""
        
        # Extract text
        if file_type == "pdf":
            text = self._extract_pdf(file_path)
        elif file_type == "docx":
            text = self._extract_docx(file_path)
        else:  # txt
            with open(file_path, 'r', encoding='utf-8') as f:
                text = f.read()
        
        # Chunk text
        chunks = self._chunk_text(text)
        
        # Generate embeddings
        embeddings = self.embedder.encode(
            chunks,
            batch_size=MODEL_CONFIG["batch_size"],
            show_progress_bar=False
        )
        
        # Build FAISS index
        dimension = embeddings.shape[1]
        self.index = faiss.IndexFlatL2(dimension)
        self.index.add(embeddings.astype('float32'))
        self.chunks = chunks
        
        return chunks
    
    async def search_context(
        self,
        query: str,
        top_k: int = 5
    ) -> List[str]:
        """Tìm relevant context cho query"""
        
        # Encode query
        query_embedding = self.embedder.encode([query])[0]
        
        # Search
        distances, indices = self.index.search(
            query_embedding.reshape(1, -1).astype('float32'),
            top_k
        )
        
        # Filter by threshold
        results = []
        for dist, idx in zip(distances[0], indices[0]):
            similarity = 1 / (1 + dist)  # Convert distance to similarity
            if similarity >= MODEL_CONFIG["similarity_threshold"]:
                results.append(self.chunks[idx])
        
        return results
```

## Model Download & Management

### Automated Download Script

```python
# scripts/setup/download_models.py
"""
Script để download tất cả models cần thiết.
Chạy một lần khi setup hệ thống.
"""

import os
from faster_whisper import WhisperModel
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
from TTS.api import TTS
from sentence_transformers import SentenceTransformer
from pyannote.audio import Pipeline

MODELS_DIR = "/models"
os.makedirs(MODELS_DIR, exist_ok=True)

def download_whisper():
    print("Downloading Whisper...")
    model = WhisperModel(
        "base",
        device="cpu",
        compute_type="int8",
        download_root=f"{MODELS_DIR}/whisper"
    )
    print("✓ Whisper downloaded")

def download_nllb():
    print("Downloading NLLB...")
    tokenizer = AutoTokenizer.from_pretrained(
        "facebook/nllb-200-distilled-600M",
        cache_dir=f"{MODELS_DIR}/nllb"
    )
    model = AutoModelForSeq2SeqLM.from_pretrained(
        "facebook/nllb-200-distilled-600M",
        cache_dir=f"{MODELS_DIR}/nllb"
    )
    print("✓ NLLB downloaded")

def download_xtts():
    print("Downloading XTTS...")
    tts = TTS(
        model_name="tts_models/multilingual/multi-dataset/xtts_v2",
        progress_bar=True
    )
    print("✓ XTTS downloaded")

def download_diarization(hf_token):
    """
    ⚠️ YÊU CẦU: Hugging Face token
    """
    if not hf_token:
        print("⚠️ Skipping diarization model (HF token required)")
        return
    
    print("Downloading speaker diarization...")
    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        use_auth_token=hf_token
    )
    print("✓ Diarization model downloaded")

def download_sentence_transformer():
    print("Downloading sentence transformer...")
    model = SentenceTransformer(
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        cache_folder=f"{MODELS_DIR}/sentence-transformers"
    )
    print("✓ Sentence transformer downloaded")

if __name__ == "__main__":
    print("=== Model Download Script ===")
    print(f"Models will be saved to: {MODELS_DIR}")
    
    # Download models
    download_whisper()
    download_nllb()
    download_xtts()
    download_sentence_transformer()
    
    # Diarization (requires token)
    hf_token = os.getenv("HF_TOKEN")
    if hf_token:
        download_diarization(hf_token)
    else:
        print("\n⚠️ WARNING: HF_TOKEN not found!")
        print("Speaker diarization model was not downloaded.")
        print("To download it:")
        print("1. Get token from https://huggingface.co/settings/tokens")
        print("2. Accept license at https://huggingface.co/pyannote/speaker-diarization-3.1")
        print("3. Set HF_TOKEN and run: python download_models.py")
    
    print("\n✓ Model download complete!")
```

## Performance Benchmarks

```yaml
Expected Performance (per instance):

Whisper (base):
- Processing speed: ~0.3x realtime (10s audio in ~3s)
- Memory: 1.5GB
- Accuracy (WER): 8-12% for Vietnamese

NLLB-200:
- Translation speed: ~50 tokens/second
- Memory: 2.5GB
- Quality (BLEU): 25-35 for vi-en

XTTS v2:
- Synthesis speed: ~0.5x realtime
- Memory: 4GB
- Quality (MOS): 4.0-4.5

Speaker Diarization:
- Processing speed: ~0.2x realtime
- Memory: 2GB
- Accuracy (DER): 5-10%

Total Memory Usage:
- Instance 1: ~10GB (Whisper + NLLB)
- Instance 2: ~8GB (API + WebRTC + XTTS)
- Instance 3: ~6GB (Monitoring + Diarization)
```

## Next Steps

⚠️ **THÔNG TIN CẦN CUNG CẤP**:
1. **Hugging Face Token**: Để download speaker diarization model
   - Đăng ký tại: https://huggingface.co/join
   - Accept license: https://huggingface.co/pyannote/speaker-diarization-3.1
   - Tạo token: https://huggingface.co/settings/tokens
   - Token format: `hf_xxxxxxxxxxxxxxxxxxxxx`

2. **API Keys** (nếu dùng fallback services):
   - Google Cloud Translation API key (optional)
   - Có thể dùng LibreTranslate self-hosted thay thế (free)

Xem thêm:
- [04-SERVICES.md](./04-SERVICES.md) - Implementation chi tiết services
- [06-WEBRTC.md](./06-WEBRTC.md) - WebRTC configuration
