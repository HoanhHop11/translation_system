import base64
import io
import logging
import time
from typing import Dict, Optional

import numpy as np
import soundfile as sf
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import JSONResponse, Response

from config.sherpa_config import ENGLISH_MODEL, VIETNAMESE_MODEL, get_model_config
from utils.audio_processor import AudioProcessor

import sherpa_onnx

logger = logging.getLogger("sherpa-stt")
logging.basicConfig(
  level=logging.INFO,
  format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)


# Metrics
TRANSCRIPTION_COUNTER = Counter(
  "stt_transcriptions_total", "Total transcription requests", ["status", "language"]
)
TRANSCRIPTION_DURATION = Histogram(
  "stt_transcription_duration_seconds",
  "Time spent transcribing audio",
  buckets=[0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0],
)

audio_processor = AudioProcessor(target_sample_rate=16000)


# Load Sherpa-ONNX models
def load_offline_vi():
  cfg = VIETNAMESE_MODEL
  return sherpa_onnx.OfflineRecognizer.from_transducer(
    tokens=f"{cfg.model_dir}/{cfg.tokens_path}",
    encoder=f"{cfg.model_dir}/{cfg.encoder_path}",
    decoder=f"{cfg.model_dir}/{cfg.decoder_path}",
    joiner=f"{cfg.model_dir}/{cfg.joiner_path}",
    num_threads=cfg.num_threads,
    provider=cfg.provider,
    decoding_method=cfg.decoding_method,
    max_active_paths=cfg.max_active_paths,
  )


def load_online_en():
  cfg = ENGLISH_MODEL
  return sherpa_onnx.OnlineRecognizer.from_transducer(
    tokens=f"{cfg.model_dir}/{cfg.tokens_path}",
    encoder=f"{cfg.model_dir}/{cfg.encoder_path}",
    decoder=f"{cfg.model_dir}/{cfg.decoder_path}",
    joiner=f"{cfg.model_dir}/{cfg.joiner_path}",
    num_threads=cfg.num_threads,
    provider=cfg.provider,
    enable_endpoint_detection=cfg.enable_endpoint,
    rule1_min_trailing_silence=cfg.rule1_min_trailing_silence,
    rule2_min_trailing_silence=cfg.rule2_min_trailing_silence,
    rule3_min_utterance_length=cfg.rule3_min_utterance_length,
    decoding_method=cfg.decoding_method,
    max_active_paths=cfg.max_active_paths,
  )


offline_vi_recognizer = load_offline_vi()
online_en_recognizer = load_online_en()


class StreamingAudioRequest(BaseModel):
  participant_id: str = Field(..., description="Unique ID của participant")
  audio_data: str = Field(..., description="Base64-encoded audio data (PCM16)")
  sample_rate: int = Field(48000, description="Sample rate (Hz)")
  channels: int = Field(1, description="Number of audio channels (1=mono, 2=stereo)")
  format: str = Field("pcm16", description="Audio format")
  language: Optional[str] = Field(None, description="Language code ('vi' or 'en')")


class StreamSessionRequest(BaseModel):
  """Request model for stream-start and stream-end endpoints"""
  participant_id: str = Field(..., description="Unique ID của participant")
  language: Optional[str] = Field(None, description="Language code ('vi' or 'en')")
  # Optional fields from Gateway
  room_id: Optional[str] = Field(None, description="Room ID (optional)")
  sample_rate: Optional[int] = Field(None, description="Sample rate (optional)")
  channels: Optional[int] = Field(None, description="Channels (optional)")


class StreamingTranscriptionResponse(BaseModel):
  participant_id: str
  text: str
  language: str
  confidence: float
  is_final: bool
  timestamp: float
  chunk_id: int
  model_used: str


class UtteranceTranscriptionRequest(BaseModel):
  """Request cho utterance-based Vietnamese transcription (offline model)."""
  participant_id: str = Field(..., description="Unique ID của participant")
  audio_data: str = Field(..., description="Base64-encoded audio data (PCM16)")
  sample_rate: int = Field(16000, description="Sample rate (Hz)")
  channels: int = Field(1, description="Number of audio channels (1=mono, 2=stereo)")
  format: str = Field("pcm16", description="Audio format")
  language: Optional[str] = Field("vi", description="Language code, must be 'vi'")


class TranscriptionResponse(BaseModel):
  text: str
  language: str
  language_probability: float
  duration: float
  segments: list
  sentences: Optional[list]
  processing_time: float
  model_used: str


class StreamingSession:
  def __init__(self, participant_id: str, language: str):
    self.participant_id = participant_id
    self.language = language or "vi"
    self.overlap: Optional[np.ndarray] = None
    self.buffer = []
    self.chunk_count = 0
    self.stream = (
      online_en_recognizer.create_stream() if self.language != "vi" else None
    )


sessions: Dict[str, StreamingSession] = {}

app = FastAPI(title="STT Service - Sherpa-ONNX", version="2.0.0")

app.add_middleware(
  CORSMiddleware,
  allow_origins=["*"],
  allow_credentials=True,
  allow_methods=["*"],
  allow_headers=["*"],
)


def get_language(lang: Optional[str]) -> str:
  if lang and lang.lower() in ("vi", "en"):
    return lang.lower()
  return "vi"


@app.get("/health")
async def health():
  return {"status": "ok", "models": ["vi", "en"], "engine": "sherpa-onnx"}


@app.get("/models")
async def models():
  return {
    "loaded_models": {
      "vi": True,
      "en": True,
    },
    "details": [VIETNAMESE_MODEL.__dict__, ENGLISH_MODEL.__dict__],
  }


@app.get("/languages")
async def languages():
  return {"languages": ["vi", "en"]}


@app.get("/metrics")
async def metrics():
  return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/transcribe", response_model=TranscriptionResponse)
async def transcribe_audio(
  audio: UploadFile = File(..., description="Audio file (WAV, MP3, etc.)"),
  language: Optional[str] = None,
):
  lang = get_language(language)
  start = time.time()

  try:
    audio_bytes = await audio.read()
    data, sample_rate = sf.read(io.BytesIO(audio_bytes), dtype="float32")
    if len(data.shape) > 1:
      channels = data.shape[1]
    else:
      channels = 1
    processed_audio, _ = audio_processor.process_for_sherpa(
      data, sample_rate, channels=channels, previous_overlap=None, overlap_ms=0
    )

    if lang == "vi":
      stream = offline_vi_recognizer.create_stream()
      stream.accept_waveform(16000, processed_audio)
      offline_vi_recognizer.decode_stream(stream)
      result = stream.result
      text = result.text
      model_used = VIETNAMESE_MODEL.name
    else:
      stream = online_en_recognizer.create_stream()
      stream.accept_waveform(16000, processed_audio)
      stream.input_finished()
      online_en_recognizer.decode_stream(stream)
      result = online_en_recognizer.get_result(stream)
      text = result.text
      model_used = ENGLISH_MODEL.name

    duration = len(processed_audio) / 16000.0
    processing_time = time.time() - start
    TRANSCRIPTION_COUNTER.labels(status="success", language=lang).inc()
    TRANSCRIPTION_DURATION.observe(processing_time)

    return TranscriptionResponse(
      text=text or "",
      language=lang,
      language_probability=1.0,
      duration=duration,
      segments=[],
      sentences=None,
      processing_time=processing_time,
      model_used=model_used,
    )
  except Exception as exc:  # noqa: BLE001
    logger.exception("Transcription failed")
    TRANSCRIPTION_COUNTER.labels(status="error", language=lang).inc()
    raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/stream-start")
async def stream_start(req: StreamSessionRequest):
  lang = get_language(req.language)
  sessions[req.participant_id] = StreamingSession(req.participant_id, lang)
  logger.info(f"Stream started for {req.participant_id}, language: {lang}")
  return {"status": "started", "participant_id": req.participant_id, "language": lang}


@app.post("/api/v1/stream-end")
async def stream_end(req: StreamSessionRequest):
  sessions.pop(req.participant_id, None)
  logger.info(f"Stream ended for {req.participant_id}")
  return {"status": "ended", "participant_id": req.participant_id}


@app.post("/api/v1/transcribe-vi-utterance", response_model=StreamingTranscriptionResponse)
async def transcribe_vi_utterance(req: UtteranceTranscriptionRequest):
  """
  Transcribe một utterance tiếng Việt (offline model).
  - Expect: PCM16 base64, sample_rate ~16k (resample nếu cần).
  - Không giữ trạng thái streaming; mỗi request là một câu độc lập.
  """
  lang = get_language(req.language)
  if lang != "vi":
    raise HTTPException(status_code=400, detail="Only Vietnamese is supported for this endpoint")

  try:
    audio_bytes = base64.b64decode(req.audio_data)
    if req.format != "pcm16":
      raise HTTPException(status_code=400, detail="Unsupported audio format")

    audio_np = np.frombuffer(audio_bytes, dtype=np.int16)
    processed_audio, _ = audio_processor.process_for_sherpa(
      audio_np,
      sample_rate=req.sample_rate,
      channels=req.channels,
      previous_overlap=None,
      overlap_ms=0,
    )

    duration_sec = len(processed_audio) / 16000.0
    if duration_sec < 0.35:
      # Quá ngắn → coi như silence, trả về rỗng
      return StreamingTranscriptionResponse(
        participant_id=req.participant_id,
        text="",
        language=lang,
        confidence=0.0,
        is_final=True,
        timestamp=time.time(),
        chunk_id=0,
        model_used=VIETNAMESE_MODEL.name,
      )

    stream = offline_vi_recognizer.create_stream()
    stream.accept_waveform(16000, processed_audio)
    offline_vi_recognizer.decode_stream(stream)
    result = stream.result
    text = result.text or ""

    logger.info(
      f"📝 [VI-OFFLINE] Utterance (participant={req.participant_id}, duration={duration_sec:.2f}s): '{text}'"
    )

    TRANSCRIPTION_COUNTER.labels(status="success", language=lang).inc()

    return StreamingTranscriptionResponse(
      participant_id=req.participant_id,
      text=text,
      language=lang,
      confidence=1.0 if text else 0.0,
      is_final=True,
      timestamp=time.time(),
      chunk_id=0,
      model_used=VIETNAMESE_MODEL.name,
    )
  except HTTPException:
    TRANSCRIPTION_COUNTER.labels(status="error", language="vi").inc()
    raise
  except Exception as exc:  # noqa: BLE001
    logger.exception("Utterance transcription failed")
    TRANSCRIPTION_COUNTER.labels(status="error", language="vi").inc()
    raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.post("/api/v1/transcribe-stream", response_model=StreamingTranscriptionResponse)
async def transcribe_stream(req: StreamingAudioRequest):
  lang = get_language(req.language)
  session = sessions.get(req.participant_id)
  if session is None:
    session = StreamingSession(req.participant_id, lang)
    sessions[req.participant_id] = session

  try:
    audio_bytes = base64.b64decode(req.audio_data)
    if req.format != "pcm16":
      raise HTTPException(status_code=400, detail="Unsupported audio format")

    audio_np = np.frombuffer(audio_bytes, dtype=np.int16)
    processed_audio, next_overlap = audio_processor.process_for_sherpa(
      audio_np,
      sample_rate=req.sample_rate,
      channels=req.channels,
      previous_overlap=session.overlap,
      overlap_ms=100,
    )
    session.overlap = next_overlap
    session.chunk_count += 1

    text = ""
    is_final = False
    model_used = VIETNAMESE_MODEL.name if lang == "vi" else ENGLISH_MODEL.name

    # Vietnamese: use offline recognizer with adaptive buffer strategy
    if lang == "vi":
      # Utterance mode: mỗi request được coi như 1 câu độc lập (đã VAD từ client/gateway)
      duration_sec = len(processed_audio) / 16000.0
      if duration_sec < 0.35:
        text = ""
        is_final = True
      else:
        stream = offline_vi_recognizer.create_stream()
        stream.accept_waveform(16000, processed_audio)
        offline_vi_recognizer.decode_stream(stream)
        result = stream.result
        text = result.text
        is_final = True
        logger.info(
          f"📝 [VI-OFFLINE] Streaming endpoint (utterance mode) participant={req.participant_id}, "
          f"duration={duration_sec:.2f}s: '{text}'"
        )
    else:
      # English streaming (unchanged - uses Online Recognizer)
      stream = session.stream or online_en_recognizer.create_stream()
      session.stream = stream
      stream.accept_waveform(16000, processed_audio)
      online_en_recognizer.decode_stream(stream)
      result = online_en_recognizer.get_result(stream)
      text = result.text
      is_final = (
        online_en_recognizer.is_endpoint(stream)
        if ENGLISH_MODEL.enable_endpoint
        else False
      )
      
      # Log transcription result for debugging
      if text:  # Only log non-empty results
        logger.info(f"📝 [EN] Transcribed (participant={req.participant_id}, "
                   f"chunk={session.chunk_count}, is_final={is_final}): '{text}'")
      
      if is_final:
        online_en_recognizer.reset(stream)

    TRANSCRIPTION_COUNTER.labels(status="success", language=lang).inc()

    return StreamingTranscriptionResponse(
      participant_id=req.participant_id,
      text=text or "",
      language=lang,
      confidence=1.0 if text else 0.0,
      is_final=is_final,
      timestamp=time.time(),
      chunk_id=session.chunk_count,
      model_used=model_used,
    )
  except HTTPException:
    TRANSCRIPTION_COUNTER.labels(status="error", language=lang).inc()
    raise
  except Exception as exc:  # noqa: BLE001
    logger.exception("Streaming transcription failed")
    TRANSCRIPTION_COUNTER.labels(status="error", language=lang).inc()
    raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/")
async def root():
  return {"service": "stt-sherpa-onnx", "version": "2.0.0", "languages": ["vi", "en"]}
