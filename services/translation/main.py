"""
Translation Service - Multilingual Translation sử dụng NLLB-200

Service này cung cấp API để dịch text giữa 200+ ngôn ngữ với độ trễ thấp,
tối ưu hóa cho CPU.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict
import uvicorn
import time
import os
import logging
import hashlib
from contextlib import asynccontextmanager
import json

from transformers import AutoModelForSeq2SeqLM, AutoTokenizer, pipeline
import torch
from optimum.quanto import quantize, freeze, qint8
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
TRANSLATION_COUNTER = Counter(
    'translation_requests_total',
    'Total number of translation requests',
    ['src_lang', 'tgt_lang', 'status']
)
TRANSLATION_DURATION = Histogram(
    'translation_duration_seconds',
    'Time spent translating',
    buckets=[0.05, 0.1, 0.2, 0.5, 1.0, 2.0]
)
TEXT_LENGTH_HISTOGRAM = Histogram(
    'translation_text_length_chars',
    'Length of text translated',
    buckets=[10, 50, 100, 200, 500, 1000, 2000]
)
CACHE_HIT_COUNTER = Counter(
    'translation_cache_hits_total',
    'Total number of cache hits',
    ['cache_type']  # 'redis' or 'memory'
)
CACHE_MISS_COUNTER = Counter(
    'translation_cache_misses_total',
    'Total number of cache misses'
)

# Global model, tokenizer, and Redis connection
model = None
tokenizer = None
redis_client = None
redis_pool = None
translation_cache: Dict[str, str] = {}  # Fallback in-memory cache

# NLLB-200 language codes mapping
LANGUAGE_CODES = {
    "en": "eng_Latn",  # English
    "vi": "vie_Latn",  # Vietnamese
    "zh": "zho_Hans",  # Chinese (Simplified)
    "ja": "jpn_Jpan",  # Japanese
    "ko": "kor_Hang",  # Korean
    "fr": "fra_Latn",  # French
    "de": "deu_Latn",  # German
    "es": "spa_Latn",  # Spanish
    "it": "ita_Latn",  # Italian
    "pt": "por_Latn",  # Portuguese
    "ru": "rus_Cyrl",  # Russian
    "ar": "arb_Arab",  # Arabic
    "hi": "hin_Deva",  # Hindi
    "th": "tha_Thai",  # Thai
    "id": "ind_Latn",  # Indonesian
}


# Pydantic Models
class TranslationRequest(BaseModel):
    """Request model cho translation"""
    text: str = Field(..., description="Text to translate", min_length=1, max_length=5000)
    src_lang: str = Field(..., description="Source language code (e.g., 'en', 'vi')")
    tgt_lang: str = Field(..., description="Target language code (e.g., 'en', 'vi')")
    use_cache: bool = Field(True, description="Use translation cache if available")
    

class TranslationResponse(BaseModel):
    """Response model cho translation result"""
    translated_text: str = Field(..., description="Translated text")
    src_lang: str = Field(..., description="Source language")
    tgt_lang: str = Field(..., description="Target language")
    src_lang_flores: str = Field(..., description="FLORES-200 source language code")
    tgt_lang_flores: str = Field(..., description="FLORES-200 target language code")
    processing_time: float = Field(..., description="Time taken to translate (seconds)")
    cached: bool = Field(False, description="Whether result was from cache")
    

class BatchTranslationRequest(BaseModel):
    """Request model cho batch translation"""
    texts: List[str] = Field(..., description="List of texts to translate", max_length=10)
    src_lang: str
    tgt_lang: str
    

class BatchTranslationResponse(BaseModel):
    """Response model cho batch translation"""
    translations: List[str]
    src_lang: str
    tgt_lang: str
    processing_time: float
    

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    model_loaded: bool
    model_info: dict


def get_cache_key(text: str, src_lang: str, tgt_lang: str) -> str:
    """Generate cache key từ text và language pair"""
    content = f"{text}|{src_lang}|{tgt_lang}"
    return f"translation:{hashlib.md5(content.encode()).hexdigest()}"


async def init_redis():
    """Initialize Redis connection với connection pool"""
    global redis_client, redis_pool
    
    redis_host = os.getenv("REDIS_HOST", "redis")
    redis_port = int(os.getenv("REDIS_PORT", "6379"))
    redis_db = int(os.getenv("REDIS_DB", "0"))
    redis_password = os.getenv("REDIS_PASSWORD", None)
    
    try:
        redis_pool = ConnectionPool(
            host=redis_host,
            port=redis_port,
            db=redis_db,
            password=redis_password,
            decode_responses=True,
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
        logger.warning(f"Redis connection failed: {e}. Falling back to in-memory cache.")
        redis_client = None
        redis_pool = None
        return False


async def get_cached_translation(cache_key: str) -> Optional[str]:
    """
    Get cached translation từ Redis hoặc in-memory cache
    
    Returns:
        Cached translation text or None
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
    
    # Fallback to in-memory
    if cache_key in translation_cache:
        CACHE_HIT_COUNTER.labels(cache_type='memory').inc()
        return translation_cache[cache_key]
    
    # Cache miss
    CACHE_MISS_COUNTER.inc()
    return None


async def set_cached_translation(cache_key: str, translation: str, ttl: int = 86400):
    """
    Set cached translation vào Redis và in-memory cache
    
    Args:
        cache_key: Cache key
        translation: Translated text
        ttl: Time to live in seconds (default 24h)
    """
    # Try Redis first
    if redis_client:
        try:
            await redis_client.setex(cache_key, ttl, translation)
        except Exception as e:
            logger.warning(f"Redis set error: {e}")
    
    # Always store in memory as fallback
    translation_cache[cache_key] = translation
    
    # Limit in-memory cache size
    if len(translation_cache) > 1000:
        # Remove oldest entry (FIFO)
        translation_cache.pop(next(iter(translation_cache)))


def load_model():
    """Load NLLB-200 model vào memory với INT8 quantization"""
    global model, tokenizer
    
    model_name = os.getenv("MODEL_NAME", "facebook/nllb-200-distilled-600M")
    device = os.getenv("DEVICE", "cpu")
    use_quantization = os.getenv("USE_INT8_QUANTIZATION", "true").lower() == "true"
    
    logger.info(f"Loading translation model: {model_name}")
    logger.info(f"INT8 Quantization: {'Enabled' if use_quantization else 'Disabled'}")
    
    try:
        # Load từ cached files only (offline mode)
        tokenizer = AutoTokenizer.from_pretrained(
            model_name,
            local_files_only=True
        )
        model = AutoModelForSeq2SeqLM.from_pretrained(
            model_name,
            local_files_only=True,
            torch_dtype=torch.float32 if device == "cpu" else torch.float16
        )
        
        # Apply INT8 quantization for CPU optimization
        if use_quantization:
            logger.info("Applying INT8 quantization to reduce memory usage...")
            # Quantize weights to INT8 (reduces memory by ~75%)
            quantize(model, weights=qint8)
            # Freeze quantized weights (convert to actual INT8)
            freeze(model)
            logger.info("INT8 quantization applied successfully (memory reduced ~75%)")
        
        if device == "cuda" and torch.cuda.is_available():
            model = model.to(device)
            logger.info("Model loaded on CUDA")
        else:
            logger.info("Model loaded on CPU")
        
        model.eval()  # Set to evaluation mode
        logger.info("Translation model loaded successfully")
        return True
    except Exception as e:
        logger.error(f"Failed to load translation model: {e}")
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle manager cho FastAPI"""
    # Startup
    logger.info("Starting Translation Service...")
    
    # Initialize Redis
    await init_redis()
    
    # Load model
    success = load_model()
    if not success:
        logger.error("Failed to start - model not loaded")
    
    yield
    
    # Shutdown
    logger.info("Shutting down Translation Service...")
    
    # Close Redis connection
    if redis_client:
        await redis_client.aclose()
    if redis_pool:
        await redis_pool.aclose()
    
    # Clear in-memory cache
    translation_cache.clear()


# Initialize FastAPI app
app = FastAPI(
    title="Translation Service",
    description="Multilingual translation service sử dụng NLLB-200",
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
        "service": "Translation Service",
        "version": "1.0.0",
        "model": "NLLB-200-distilled-600M",
        "status": "running",
        "endpoints": {
            "translate": "/translate (POST)",
            "batch_translate": "/batch_translate (POST)",
            "health": "/health (GET)",
            "languages": "/languages (GET)",
            "metrics": "/metrics (GET)"
        }
    }


@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint"""
    model_loaded = model is not None and tokenizer is not None
    
    # Check Redis connection
    redis_status = "disconnected"
    if redis_client:
        try:
            await redis_client.ping()
            redis_status = "connected"
        except:
            redis_status = "error"
    
    model_info = {}
    if model_loaded:
        model_info = {
            "model_name": os.getenv("MODEL_NAME", "facebook/nllb-200-distilled-600M"),
            "device": "cuda" if next(model.parameters()).is_cuda else "cpu",
            "redis_cache": redis_status,
            "memory_cache_size": len(translation_cache),
            "supported_languages": len(LANGUAGE_CODES)
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


@app.post("/translate", response_model=TranslationResponse)
async def translate(request: TranslationRequest):
    """
    Translate text từ source language sang target language
    
    Args:
        request: TranslationRequest với text, src_lang, tgt_lang
    
    Returns:
        TranslationResponse với translated text và metadata
    """
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Validate language codes
    if request.src_lang not in LANGUAGE_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported source language: {request.src_lang}. Use /languages to see supported languages."
        )
    if request.tgt_lang not in LANGUAGE_CODES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported target language: {request.tgt_lang}. Use /languages to see supported languages."
        )
    
    start_time = time.time()
    
    # Convert to FLORES-200 codes
    src_lang_flores = LANGUAGE_CODES[request.src_lang]
    tgt_lang_flores = LANGUAGE_CODES[request.tgt_lang]
    
    # Check cache (Redis + in-memory)
    cached = False
    translated_text = None
    
    if request.use_cache:
        cache_key = get_cache_key(request.text, request.src_lang, request.tgt_lang)
        translated_text = await get_cached_translation(cache_key)
        
        if translated_text:
            cached = True
            logger.info(f"Cache hit for {request.src_lang} -> {request.tgt_lang}")
    
    if not cached:
        try:
            # Tokenize
            tokenizer.src_lang = src_lang_flores
            inputs = tokenizer(
                request.text,
                return_tensors="pt",
                padding=True,
                truncation=True,
                max_length=int(os.getenv("MAX_LENGTH", "512"))
            )
            
            # Move to device if CUDA
            if next(model.parameters()).is_cuda:
                inputs = {k: v.to("cuda") for k, v in inputs.items()}
            
            # Generate translation
            with torch.no_grad():
                translated_tokens = model.generate(
                    **inputs,
                    forced_bos_token_id=tokenizer.convert_tokens_to_ids(tgt_lang_flores),
                    max_length=int(os.getenv("MAX_LENGTH", "512")),
                    num_beams=4,
                    early_stopping=True
                )
            
            # Decode
            translated_text = tokenizer.batch_decode(
                translated_tokens,
                skip_special_tokens=True
            )[0]
            
            # Cache result (Redis + in-memory)
            if request.use_cache:
                cache_key = get_cache_key(request.text, request.src_lang, request.tgt_lang)
                cache_ttl = int(os.getenv("CACHE_TTL", "86400"))  # 24h default
                await set_cached_translation(cache_key, translated_text, ttl=cache_ttl)
            
        except Exception as e:
            logger.error(f"Translation error: {e}", exc_info=True)
            TRANSLATION_COUNTER.labels(
                src_lang=request.src_lang,
                tgt_lang=request.tgt_lang,
                status='error'
            ).inc()
            raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")
    
    processing_time = time.time() - start_time
    
    # Metrics
    if not cached:
        TRANSLATION_DURATION.observe(processing_time)
        TEXT_LENGTH_HISTOGRAM.observe(len(request.text))
    
    TRANSLATION_COUNTER.labels(
        src_lang=request.src_lang,
        tgt_lang=request.tgt_lang,
        status='success'
    ).inc()
    
    logger.info(
        f"Translation: {request.src_lang}->{request.tgt_lang}, "
        f"length={len(request.text)}, time={processing_time:.3f}s, cached={cached}"
    )
    
    return TranslationResponse(
        translated_text=translated_text,
        src_lang=request.src_lang,
        tgt_lang=request.tgt_lang,
        src_lang_flores=src_lang_flores,
        tgt_lang_flores=tgt_lang_flores,
        processing_time=processing_time,
        cached=cached
    )


@app.post("/batch_translate", response_model=BatchTranslationResponse)
async def batch_translate(request: BatchTranslationRequest):
    """
    Translate multiple texts cùng lúc (batch processing)
    
    Args:
        request: BatchTranslationRequest với list of texts
    
    Returns:
        BatchTranslationResponse với list of translations
    """
    if model is None or tokenizer is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    if len(request.texts) == 0:
        raise HTTPException(status_code=400, detail="Empty texts list")
    
    if len(request.texts) > 10:
        raise HTTPException(status_code=400, detail="Maximum 10 texts per batch")
    
    start_time = time.time()
    translations = []
    
    # Translate each text (could be optimized with true batch processing)
    for text in request.texts:
        translation_req = TranslationRequest(
            text=text,
            src_lang=request.src_lang,
            tgt_lang=request.tgt_lang,
            use_cache=True
        )
        result = await translate(translation_req)
        translations.append(result.translated_text)
    
    processing_time = time.time() - start_time
    
    return BatchTranslationResponse(
        translations=translations,
        src_lang=request.src_lang,
        tgt_lang=request.tgt_lang,
        processing_time=processing_time
    )


@app.get("/languages")
async def list_languages():
    """List các languages được support"""
    return {
        "supported_languages": {
            code: {
                "name": name,
                "flores_code": flores
            }
            for code, flores in LANGUAGE_CODES.items()
            for name in [_get_language_name(code)]
        },
        "total": len(LANGUAGE_CODES),
        "note": "NLLB-200 supports 200+ languages. This API exposes the most common ones."
    }


def _get_language_name(code: str) -> str:
    """Get language name from code"""
    names = {
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
    return names.get(code, "Unknown")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8003,
        workers=2,
        log_level="info"
    )
