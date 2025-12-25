import os
import io
import time
import logging
import base64
import wave
from typing import Optional, List
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, JSONResponse
from pydantic import BaseModel
from piper import PiperVoice

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger("tts-piper")

app = FastAPI(title="JB Calling TTS Piper Service")

# CORS middleware - Allow all origins for API access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration from Environment Variables
PIPER_MODEL_VI = os.getenv("PIPER_MODEL_VI", "/models/piper/vi_VN-vais1000-medium.onnx")
PIPER_MODEL_EN = os.getenv("PIPER_MODEL_EN", "/models/piper/en_US-lessac-medium.onnx")
# Config paths are usually inferred from model paths by appending .json, but we respect env vars if set
PIPER_CONFIG_VI = os.getenv("PIPER_CONFIG_VI", PIPER_MODEL_VI + ".json")
PIPER_CONFIG_EN = os.getenv("PIPER_CONFIG_EN", PIPER_MODEL_EN + ".json")

# Global voice cache
voices = {}

def load_voice(lang: str, model_path: str, config_path: str):
    """Load Piper voice model."""
    try:
        if not os.path.exists(model_path):
            logger.error(f"Model not found: {model_path}")
            return None
        
        if not os.path.exists(config_path):
            logger.error(f"Config not found: {config_path}")
            return None

        logger.info(f"Loading voice for {lang} from {model_path}")
        # PiperVoice automatically handles .onnx.json config loading if provided or inferred
        voice = PiperVoice.load(model_path, config_path=config_path)
        return voice
    except Exception as e:
        logger.error(f"Failed to load voice for {lang}: {e}")
        return None

@app.on_event("startup")
async def startup_event():
    """Initialize models on startup."""
    logger.info("Initializing TTS Piper Service...")
    
    # Load Vietnamese Model
    voices["vi"] = load_voice("vi", PIPER_MODEL_VI, PIPER_CONFIG_VI)
    
    # Load English Model
    voices["en"] = load_voice("en", PIPER_MODEL_EN, PIPER_CONFIG_EN)
    
    logger.info(f"Loaded voices: {list(voices.keys())}")

class SynthesizeRequest(BaseModel):
    text: str
    lang: Optional[str] = "vi"
    mode: Optional[str] = "generic"  # generic | clone
    reference_id: Optional[str] = None
    # Legacy fields for backward compatibility
    language: Optional[str] = None 

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    status = "healthy" if voices else "degraded"
    if not voices:
        status = "unhealthy"
    
    return {
        "status": status,
        "engine": "piper",
        "languages": list(voices.keys()),
        "modes": ["generic"], # Clone not implemented in MVP
        "loaded_models": {
            "vi": bool(voices.get("vi")),
            "en": bool(voices.get("en"))
        }
    }

@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    """
    Synthesize text to speech.
    Supports backward compatibility with legacy 'language' field.
    Returns JSON with 'audio_base64' (legacy) and raw audio bytes support (future).
    """
    st = time.time()
    
    # Normalize language
    # Prioritize 'lang', fallback to 'language', default to 'vi'
    lang = request.lang or request.language or "vi"
    lang = lang.lower()
    
    # Basic mapping for legacy language codes if needed (e.g., 'vi-VN' -> 'vi')
    if "vi" in lang:
        target_lang = "vi"
    elif "en" in lang:
        target_lang = "en"
    else:
        target_lang = "en" # Default fallback
        
    text = request.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text is empty")

    voice = voices.get(target_lang)
    if not voice:
        # Fallback to English if requested lang not found, or error?
        # Let's try fallback to English if VI not available, or vice versa
        voice = voices.get("en") or voices.get("vi")
        if not voice:
             raise HTTPException(status_code=503, detail=f"No TTS models loaded for {target_lang}")
        logger.warning(f"Requested language {target_lang} not found, using fallback.")

    try:
        # Piper synthesis
        # Output to a BytesIO buffer
        # Piper expects text to be passed. synthesize_stream_raw returns raw PCM samples
        # synthesize() writes to a WAV file-like object
        
        wav_buffer = io.BytesIO()
        with wave.open(wav_buffer, "wb") as wav_file:
             voice.synthesize(text, wav_file)
        
        wav_bytes = wav_buffer.getvalue()
        
        # Convert to base64 for legacy frontend compatibility
        audio_base64 = base64.b64encode(wav_bytes).decode("utf-8")
        
        process_time = time.time() - st
        logger.info(f"Synthesized {len(text)} chars in {process_time:.3f}s for lang={target_lang}")
        
        return JSONResponse({
            "audio_base64": audio_base64,
            "lang": target_lang,
            "mode": request.mode,
            "duration": process_time # Approximate
        })

    except Exception as e:
        logger.error(f"Synthesis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/synthesize-clone")
async def synthesize_clone(
    text: str = Form(...),
    lang: str = Form("vi"),
    reference_audio: UploadFile = File(...)
):
    """
    Placeholder for Voice Cloning (OpenVoice).
    Currently just returns Generic TTS.
    """
    # MVP: Just use Generic TTS
    # In future: Parse reference_audio -> OpenVoice TCC
    
    req = SynthesizeRequest(text=text, lang=lang, mode="clone")
    return await synthesize(req)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)


