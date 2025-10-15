"""
TTS Service - Text-to-Speech sử dụng gTTS và XTTS v2

Service này cung cấp 2 modes:
1. Fast mode: gTTS cho synthesis nhanh (~200-300ms)
2. Voice cloning mode: XTTS v2 cho voice cloning chất lượng cao (async, ~30-60s)
"""

from fastapi import FastAPI, HTTPException, UploadFile, File, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import uvicorn
import time
import os
import io
import logging
import hashlib
import base64
from contextlib import asynccontextmanager
from pathlib import Path

from gtts import gTTS
import soundfile as sf
import numpy as np
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
import redis.asyncio as redis
from redis.asyncio import ConnectionPool

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Prometheus metrics
TTS_COUNTER = Counter(
    'tts_synthesis_total',
    'Total number of TTS synthesis requests',
    ['engine', 'language', 'status']
)
TTS_DURATION = Histogram(
    'tts_synthesis_duration_seconds',
    'Time spent synthesizing speech',
    buckets=[0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0, 60.0]
)
TEXT_LENGTH_HISTOGRAM = Histogram(
    'tts_text_length_chars',
    'Length of text synthesized',
    buckets=[10, 50, 100, 200, 500, 1000]
)
CACHE_HIT_COUNTER = Counter(
    'tts_cache_hits_total',
    'Total number of cache hits',
    ['cache_type']  # 'redis' or 'file'
)
CACHE_MISS_COUNTER = Counter(
    'tts_cache_misses_total',
    'Total number of cache misses'
)

# Redis client
redis_client = None
redis_pool = None

# Cache directories
CACHE_DIR = Path(os.getenv("CACHE_DIR", "/app/cache"))
VOICE_SAMPLES_DIR = Path("/app/voice_samples")
CACHE_DIR.mkdir(exist_ok=True, parents=True)
VOICE_SAMPLES_DIR.mkdir(exist_ok=True, parents=True)

# gTTS supported languages
GTTS_LANGUAGES = {
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
}


# Pydantic Models
class TTSRequest(BaseModel):
    """Request model cho TTS synthesis"""
    text: str = Field(..., description="Text to synthesize", min_length=1, max_length=1000)
    language: str = Field("en", description="Language code (e.g., 'en', 'vi')")
    engine: str = Field("gtts", description="TTS engine: 'gtts' (fast) or 'xtts' (voice clone)")
    speaker_wav: Optional[str] = Field(None, description="Base64 encoded speaker WAV for voice cloning")
    use_cache: bool = Field(True, description="Use synthesis cache if available")
    

class TTSResponse(BaseModel):
    """Response model cho TTS synthesis"""
    audio_base64: str = Field(..., description="Synthesized audio in base64 format")
    language: str
    engine: str
    duration: float = Field(..., description="Audio duration in seconds")
    processing_time: float
    cached: bool = Field(False, description="Whether result was from cache")
    sample_rate: int = Field(24000, description="Audio sample rate in Hz")
    

class VoiceCloneRequest(BaseModel):
    """Request model cho voice cloning (XTTS v2)"""
    text: str
    language: str = "en"
    speaker_id: Optional[str] = None  # ID of saved speaker voice
    

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    engines: dict
    cache_size: int
    

def get_cache_key(text: str, language: str, engine: str, speaker_id: Optional[str] = None) -> str:
    """Generate cache key - không dùng dấu : trong filename"""
    content = f"{text}|{language}|{engine}|{speaker_id or ''}"
    return f"tts_{hashlib.md5(content.encode()).hexdigest()}"


async def init_redis():
    """Initialize Redis connection với connection pool"""
    global redis_client, redis_pool
    
    redis_host = os.getenv("REDIS_HOST", "redis")
    redis_port = int(os.getenv("REDIS_PORT", "6379"))
    redis_db = int(os.getenv("REDIS_DB", "1"))  # DB 1 for TTS (DB 0 for translation)
    redis_password = os.getenv("REDIS_PASSWORD", None)
    
    try:
        redis_pool = ConnectionPool(
            host=redis_host,
            port=redis_port,
            db=redis_db,
            password=redis_password,
            decode_responses=False,  # Store binary audio data
            max_connections=10,
            socket_connect_timeout=5,
            socket_timeout=5
        )
        redis_client = redis.Redis(connection_pool=redis_pool)
        
        # Test connection
        await redis_client.ping()
        logger.info(f"Redis connected: {redis_host}:{redis_port}")
        return True
    except Exception as e:
        logger.warning(f"Redis connection failed: {e}. Falling back to file cache.")
        redis_client = None
        redis_pool = None
        return False


async def get_cached_audio(cache_key: str) -> Optional[bytes]:
    """
    Get cached audio từ Redis hoặc file cache
    
    Returns:
        Cached audio bytes or None
    """
    # Try Redis first
    if redis_client:
        try:
            cached = await redis_client.get(cache_key)
            if cached:
                CACHE_HIT_COUNTER.labels(cache_type='redis').inc()
                return cached
        except Exception as e:
            logger.warning(f"Redis get error: {e}")
    
    # Fallback to file cache
    cache_file = CACHE_DIR / f"{cache_key}.wav"
    if cache_file.exists():
        CACHE_HIT_COUNTER.labels(cache_type='file').inc()
        return cache_file.read_bytes()
    
    # Cache miss
    CACHE_MISS_COUNTER.inc()
    return None


async def save_to_cache(cache_key: str, audio_bytes: bytes, ttl: int = 86400):
    """
    Save audio to Redis và file cache
    
    Args:
        cache_key: Cache key
        audio_bytes: Audio data
        ttl: Time to live in seconds (default 24h)
    """
    # Try Redis first
    if redis_client:
        try:
            await redis_client.setex(cache_key, ttl, audio_bytes)
        except Exception as e:
            logger.warning(f"Redis set error: {e}")
    
    # Always store in file cache as backup
    cache_file = CACHE_DIR / f"{cache_key}.wav"
    cache_file.write_bytes(audio_bytes)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager cho FastAPI"""
    # Startup
    logger.info("Starting TTS Service...")
    logger.info(f"Cache directory: {CACHE_DIR}")
    logger.info(f"Voice samples directory: {VOICE_SAMPLES_DIR}")
    
    # Initialize Redis
    await init_redis()
    
    yield
    
    # Shutdown
    logger.info("Shutting down TTS Service...")
    
    # Close Redis connection
    if redis_client:
        await redis_client.aclose()
    if redis_pool:
        await redis_pool.aclose()


# Initialize FastAPI app
app = FastAPI(
    title="TTS Service",
    description="Text-to-Speech service với gTTS (fast) và XTTS v2 (voice cloning)",
    version="1.0.0",
    lifespan=lifespan
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/", response_model=dict)
async def root():
    """Root endpoint"""
    return {
        "service": "TTS Service",
        "version": "1.0.0",
        "engines": {
            "gtts": "Fast synthesis (~200-300ms)",
            "xtts": "Voice cloning (XTTS v2, ~30-60s)"
        },
        "status": "running",
        "endpoints": {
            "synthesize": "/synthesize (POST)",
            "clone_voice": "/clone_voice (POST)",
            "health": "/health (GET)",
            "languages": "/languages (GET)",
            "metrics": "/metrics (GET)"
        }
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    # Count cache files
    cache_files = list(CACHE_DIR.glob("*.wav"))
    
    # Check Redis connection
    redis_status = "disconnected"
    if redis_client:
        try:
            await redis_client.ping()
            redis_status = "connected"
        except:
            redis_status = "error"
    
    return HealthResponse(
        status="healthy",
        engines={
            "gtts": "available",
            "xtts": "available (requires speaker sample)",
            "redis_cache": redis_status
        },
        cache_size=len(cache_files)
    )


@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/synthesize", response_model=TTSResponse)
async def synthesize(request: TTSRequest):
    """
    Synthesize text thành audio
    
    Args:
        request: TTSRequest với text, language, engine
    
    Returns:
        TTSResponse với audio data (base64) và metadata
    """
    start_time = time.time()
    
    # Validate language
    if request.language not in GTTS_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language: {request.language}. Use /languages to see supported languages."
        )
    
    # Check cache (Redis + file)
    cached = False
    cache_key = get_cache_key(request.text, request.language, request.engine)
    
    if request.use_cache:
        cached_audio = await get_cached_audio(cache_key)
        if cached_audio:
            # Read audio info
            audio_data, sample_rate = sf.read(io.BytesIO(cached_audio))
            duration = len(audio_data) / sample_rate
            audio_base64 = base64.b64encode(cached_audio).decode('utf-8')
            cached = True
            logger.info(f"Cache hit for {request.language} ({request.engine})")
        else:
            cached = False
    
    if not cached:
        try:
            if request.engine == "gtts":
                # Fast synthesis với gTTS
                tts = gTTS(text=request.text, lang=request.language, slow=False)
                
                # Save to bytes buffer
                audio_buffer = io.BytesIO()
                tts.write_to_fp(audio_buffer)
                audio_buffer.seek(0)
                
                # Convert to WAV format
                audio_bytes = audio_buffer.getvalue()
                
                # gTTS produces MP3, need to convert to WAV for consistency
                # For now, just save as is and let client handle
                # TODO: Add MP3 to WAV conversion if needed
                
                # Read audio info (approximate)
                sample_rate = 24000  # gTTS default
                duration = len(request.text) / 15  # Rough estimate: 15 chars/sec
                
            elif request.engine == "xtts":
                # XTTS v2 voice cloning (not implemented yet - requires more setup)
                raise HTTPException(
                    status_code=501,
                    detail="XTTS v2 engine not yet implemented. Use 'gtts' for now."
                )
            else:
                raise HTTPException(status_code=400, detail=f"Unknown engine: {request.engine}")
            
            # Convert to base64
            audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
            
            # Cache result (Redis + file)
            if request.use_cache:
                cache_ttl = int(os.getenv("CACHE_TTL", "86400"))  # 24h default
                await save_to_cache(cache_key, audio_bytes, ttl=cache_ttl)
            
        except Exception as e:
            logger.error(f"TTS synthesis error: {e}", exc_info=True)
            TTS_COUNTER.labels(
                engine=request.engine,
                language=request.language,
                status='error'
            ).inc()
            raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {str(e)}")
    
    processing_time = time.time() - start_time
    
    # Metrics
    if not cached:
        TTS_DURATION.observe(processing_time)
        TEXT_LENGTH_HISTOGRAM.observe(len(request.text))
    
    TTS_COUNTER.labels(
        engine=request.engine,
        language=request.language,
        status='success'
    ).inc()
    
    logger.info(
        f"TTS: engine={request.engine}, lang={request.language}, "
        f"length={len(request.text)}, time={processing_time:.3f}s, cached={cached}"
    )
    
    return TTSResponse(
        audio_base64=audio_base64,
        language=request.language,
        engine=request.engine,
        duration=duration,
        processing_time=processing_time,
        cached=cached,
        sample_rate=sample_rate
    )


@app.post("/clone_voice")
async def clone_voice(
    background_tasks: BackgroundTasks,
    text: str,
    language: str = "en",
    audio: UploadFile = File(...)
):
    """
    Voice cloning với XTTS v2 (async operation)
    
    Args:
        text: Text to synthesize
        language: Target language
        audio: Speaker reference audio file
    
    Returns:
        Task ID để track progress
    """
    # This is a placeholder - actual XTTS v2 implementation would go here
    raise HTTPException(
        status_code=501,
        detail="Voice cloning with XTTS v2 not yet implemented. Coming in next version."
    )


@app.get("/languages")
async def list_languages():
    """List các languages được support"""
    return {
        "supported_languages": GTTS_LANGUAGES,
        "total": len(GTTS_LANGUAGES),
        "engines": {
            "gtts": "Supports all listed languages",
            "xtts": "Supports 17 languages (when implemented)"
        }
    }


@app.get("/voices")
async def list_voices():
    """List các saved voice samples cho cloning"""
    voice_files = list(VOICE_SAMPLES_DIR.glob("*.wav"))
    return {
        "saved_voices": [f.stem for f in voice_files],
        "total": len(voice_files),
        "note": "Upload speaker samples to /upload_voice endpoint to add more voices"
    }


@app.post("/upload_voice")
async def upload_voice(
    speaker_id: str,
    audio: UploadFile = File(...)
):
    """
    Upload speaker voice sample cho voice cloning
    
    Args:
        speaker_id: Unique ID cho speaker
        audio: Speaker audio sample (10-30 seconds recommended)
    """
    # Save voice sample
    voice_file = VOICE_SAMPLES_DIR / f"{speaker_id}.wav"
    
    try:
        audio_bytes = await audio.read()
        voice_file.write_bytes(audio_bytes)
        
        # Validate audio
        audio_data, sample_rate = sf.read(io.BytesIO(audio_bytes))
        duration = len(audio_data) / sample_rate
        
        return {
            "status": "success",
            "speaker_id": speaker_id,
            "duration": duration,
            "sample_rate": sample_rate,
            "message": f"Voice sample saved. Use speaker_id='{speaker_id}' for voice cloning."
        }
    except Exception as e:
        logger.error(f"Failed to save voice sample: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to save voice sample: {str(e)}")


@app.delete("/clear_cache")
async def clear_cache():
    """Clear synthesis cache"""
    try:
        cache_files = list(CACHE_DIR.glob("*.wav"))
        for cache_file in cache_files:
            cache_file.unlink()
        
        return {
            "status": "success",
            "message": f"Cleared {len(cache_files)} cached files"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to clear cache: {str(e)}")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8004,
        workers=2,
        log_level="info"
    )
