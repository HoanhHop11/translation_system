"""
VinAI Translation Service với CTranslate2 INT8 Optimization

Service này cung cấp API dịch thuật chuyên biệt cho cặp ngôn ngữ Việt-Anh
sử dụng VinAI models với CTranslate2 INT8 quantization để tối ưu cho CPU.

Performance targets:
- Latency: <100ms per sentence
- Memory: <1GB RAM
- BLEU score: >40 (Vi↔En)
"""

import os
import time
import hashlib
import logging
from contextlib import asynccontextmanager
from typing import Optional, List
from functools import partial
import asyncio

import ctranslate2
import sentencepiece as spm
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from prometheus_client import Counter, Histogram, generate_latest, CONTENT_TYPE_LATEST
from starlette.responses import Response
import redis.asyncio as redis

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ==============================================================================
# PROMETHEUS METRICS
# ==============================================================================
translation_requests = Counter(
    'translation_requests_total',
    'Total translation requests',
    ['direction', 'status']
)

translation_latency = Histogram(
    'translation_latency_seconds',
    'Translation latency in seconds',
    ['direction']
)

cache_hits = Counter(
    'cache_hits_total',
    'Total cache hits',
    ['direction']
)

# ==============================================================================
# GLOBAL STATE - Lazy loaded
# ==============================================================================
translator_vi2en: Optional[ctranslate2.Translator] = None
translator_en2vi: Optional[ctranslate2.Translator] = None
sp_vi2en: Optional[spm.SentencePieceProcessor] = None
sp_en2vi: Optional[spm.SentencePieceProcessor] = None
redis_client: Optional[redis.Redis] = None

# ==============================================================================
# CONFIGURATION
# ==============================================================================
class Config:
    """Service configuration"""
    DEVICE = os.getenv("DEVICE", "cpu")
    COMPUTE_TYPE = os.getenv("COMPUTE_TYPE", "int8")
    MAX_LENGTH = int(os.getenv("MAX_LENGTH", "512"))
    BEAM_SIZE = int(os.getenv("BEAM_SIZE", "1"))  # beam=1 for speed
    REDIS_HOST = os.getenv("REDIS_HOST", "redis")
    REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
    REDIS_DB = int(os.getenv("REDIS_DB", "1"))
    CACHE_TTL = int(os.getenv("CACHE_TTL", "86400"))  # 24 hours
    
    MODEL_VI2EN_PATH = "/app/models/ct2-vi2en"
    MODEL_EN2VI_PATH = "/app/models/ct2-en2vi"
    TOKENIZER_VI2EN_PATH = "/app/models/vi2en-tokenizer"
    TOKENIZER_EN2VI_PATH = "/app/models/en2vi-tokenizer"

config = Config()

# ==============================================================================
# PYDANTIC MODELS
# ==============================================================================
class TranslateRequest(BaseModel):
    """Translation request model"""
    text: str = Field(..., min_length=1, max_length=5000, description="Text to translate")
    direction: str = Field(..., pattern="^(vi2en|en2vi)$", description="Translation direction")

class TranslateResponse(BaseModel):
    """Translation response model"""
    text: str = Field(..., description="Translated text")
    direction: str = Field(..., description="Translation direction")
    cached: bool = Field(..., description="Whether result was cached")
    latency_ms: float = Field(..., description="Translation latency in milliseconds")

class HealthResponse(BaseModel):
    """Health check response"""
    status: str
    models_loaded: bool
    redis_connected: bool

# ==============================================================================
# MODEL LOADING
# ==============================================================================
def load_models():
    """
    Load CTranslate2 models và sentencepiece tokenizers vào memory.
    Gọi lần đầu khi có request (lazy loading).
    """
    global translator_vi2en, translator_en2vi, sp_vi2en, sp_en2vi
    
    if translator_vi2en is not None:
        return  # Already loaded
    
    logger.info("Loading VinAI translation models...")
    start_time = time.time()
    
    try:
        # Load CTranslate2 translators
        logger.info(f"Loading Vi→En translator from {config.MODEL_VI2EN_PATH}")
        translator_vi2en = ctranslate2.Translator(
            config.MODEL_VI2EN_PATH,
            device=config.DEVICE,
            compute_type=config.COMPUTE_TYPE,
            inter_threads=2,  # CPU optimization
            intra_threads=2
        )
        
        logger.info(f"Loading En→Vi translator from {config.MODEL_EN2VI_PATH}")
        translator_en2vi = ctranslate2.Translator(
            config.MODEL_EN2VI_PATH,
            device=config.DEVICE,
            compute_type=config.COMPUTE_TYPE,
            inter_threads=2,
            intra_threads=2
        )
        
        # Load sentencepiece tokenizers
        logger.info("Loading sentencepiece tokenizers...")
        sp_vi2en = spm.SentencePieceProcessor()
        sp_vi2en.load(f"{config.TOKENIZER_VI2EN_PATH}/sentencepiece.bpe.model")
        
        sp_en2vi = spm.SentencePieceProcessor()
        sp_en2vi.load(f"{config.TOKENIZER_EN2VI_PATH}/sentencepiece.bpe.model")
        
        elapsed = time.time() - start_time
        logger.info(f"✅ Models loaded successfully in {elapsed:.2f}s")
        
    except Exception as e:
        logger.error(f"❌ Failed to load models: {e}")
        raise

async def init_redis():
    """Initialize Redis connection pool"""
    global redis_client
    
    try:
        redis_client = redis.Redis(
            host=config.REDIS_HOST,
            port=config.REDIS_PORT,
            db=config.REDIS_DB,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_keepalive=True,
            health_check_interval=30
        )
        # Test connection
        await redis_client.ping()
        logger.info("✅ Redis connection established")
    except Exception as e:
        logger.warning(f"⚠️ Redis connection failed: {e}. Caching disabled.")
        redis_client = None

async def close_redis():
    """Close Redis connection"""
    global redis_client
    if redis_client:
        await redis_client.close()
        logger.info("Redis connection closed")

# ==============================================================================
# LIFESPAN CONTEXT MANAGER
# ==============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage application lifecycle"""
    # Startup
    logger.info("🚀 Starting VinAI Translation Service...")
    await init_redis()
    # Models loaded lazily on first request
    yield
    # Shutdown
    logger.info("🛑 Shutting down...")
    await close_redis()

# ==============================================================================
# FASTAPI APPLICATION
# ==============================================================================
app = FastAPI(
    title="VinAI Translation Service",
    description="CPU-optimized Vietnamese-English translation với CTranslate2 INT8",
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

# ==============================================================================
# HELPER FUNCTIONS
# ==============================================================================
def get_cache_key(text: str, direction: str) -> str:
    """Generate cache key cho translation"""
    content = f"{text}:{direction}"
    return f"trans:vinai:{hashlib.md5(content.encode()).hexdigest()}"

async def get_cached_translation(text: str, direction: str) -> Optional[str]:
    """Get cached translation từ Redis"""
    if not redis_client:
        return None
    
    try:
        cache_key = get_cache_key(text, direction)
        cached = await redis_client.get(cache_key)
        if cached:
            cache_hits.labels(direction=direction).inc()
            return cached
    except Exception as e:
        logger.warning(f"Cache get error: {e}")
    
    return None

async def set_cached_translation(text: str, direction: str, translation: str):
    """Cache translation result vào Redis"""
    if not redis_client:
        return
    
    try:
        cache_key = get_cache_key(text, direction)
        await redis_client.setex(cache_key, config.CACHE_TTL, translation)
    except Exception as e:
        logger.warning(f"Cache set error: {e}")

def translate_text(text: str, direction: str) -> str:
    """
    Translate text sử dụng CTranslate2 với sentencepiece tokenization.
    
    Args:
        text: Text cần dịch
        direction: "vi2en" hoặc "en2vi"
    
    Returns:
        str: Translated text
    """
    # Lazy load models nếu chưa load
    if translator_vi2en is None:
        load_models()
    
    # Select translator và tokenizer based on direction
    if direction == "vi2en":
        translator = translator_vi2en
        sp = sp_vi2en
    else:
        translator = translator_en2vi
        sp = sp_en2vi
    
    # Tokenize với sentencepiece (encode_as_pieces trả về list of subword tokens)
    tokens = sp.encode_as_pieces(text)
    
    # mBART format yêu cầu:
    # Source: X [eos, src_lang] → tokens + "</s>" + src_lang_code
    # Decoder: [tgt_lang] X [eos] → handled by target_prefix
    if direction == "vi2en":
        src_lang = "vi_VN"
        tgt_lang = "en_XX"
    else:
        src_lang = "en_XX"
        tgt_lang = "vi_VN"
    
    # Append EOS + source language code to input tokens
    tokens.append("</s>")
    tokens.append(src_lang)
    
    # Translate với CTranslate2, target_prefix provides decoder start token
    results = translator.translate_batch(
        [tokens],
        target_prefix=[[tgt_lang]],  # Decoder starts with target language
        beam_size=config.BEAM_SIZE,
        max_input_length=config.MAX_LENGTH,
        max_decoding_length=config.MAX_LENGTH
    )
    
    # Output tokens bao gồm target_lang ở đầu, skip nó
    output_tokens = results[0].hypotheses[0]
    if output_tokens and output_tokens[0] == tgt_lang:
        output_tokens = output_tokens[1:]
    
    # Decode về text
    translated = sp.decode_pieces(output_tokens)
    
    return translated.strip()

# ==============================================================================
# API ENDPOINTS
# ==============================================================================
@app.post("/translate", response_model=TranslateResponse)
async def translate(request: TranslateRequest):
    """
    Translate text giữa Vietnamese và English.
    
    - **vi2en**: Vietnamese → English
    - **en2vi**: English → Vietnamese
    """
    start_time = time.time()
    
    try:
        # Check cache trước
        cached_result = await get_cached_translation(request.text, request.direction)
        if cached_result:
            latency = (time.time() - start_time) * 1000
            translation_requests.labels(
                direction=request.direction,
                status="success"
            ).inc()
            return TranslateResponse(
                text=cached_result,
                direction=request.direction,
                cached=True,
                latency_ms=latency
            )
        
        # Translate trong thread pool để không block event loop
        loop = asyncio.get_event_loop()
        with translation_latency.labels(direction=request.direction).time():
            translated = await loop.run_in_executor(
                None,
                translate_text,
                request.text,
                request.direction
            )
        
        # Cache result
        await set_cached_translation(request.text, request.direction, translated)
        
        # Metrics
        latency = (time.time() - start_time) * 1000
        translation_requests.labels(
            direction=request.direction,
            status="success"
        ).inc()
        
        return TranslateResponse(
            text=translated,
            direction=request.direction,
            cached=False,
            latency_ms=latency
        )
        
    except Exception as e:
        logger.error(f"Translation error: {e}", exc_info=True)
        translation_requests.labels(
            direction=request.direction,
            status="error"
        ).inc()
        raise HTTPException(status_code=500, detail=f"Translation failed: {str(e)}")

@app.get("/health", response_model=HealthResponse)
async def health():
    """Health check endpoint"""
    models_loaded = translator_vi2en is not None and translator_en2vi is not None
    redis_connected = False
    
    if redis_client:
        try:
            await redis_client.ping()
            redis_connected = True
        except:
            pass
    
    return HealthResponse(
        status="healthy" if models_loaded else "starting",
        models_loaded=models_loaded,
        redis_connected=redis_connected
    )

@app.get("/metrics")
async def metrics():
    """Prometheus metrics endpoint"""
    return Response(
        content=generate_latest(),
        media_type=CONTENT_TYPE_LATEST
    )

@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "service": "VinAI Translation",
        "version": "1.0.0",
        "status": "running",
        "supported_directions": ["vi2en", "en2vi"]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)
