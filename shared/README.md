# Shared Directory

Thư mục này chứa code được share giữa các microservices.

## Cấu trúc

```
shared/
├── models/             # Data models (Pydantic, SQLAlchemy)
│   ├── __init__.py
│   ├── user.py
│   ├── room.py
│   ├── transcription.py
│   └── translation.py
├── utils/              # Utility functions
│   ├── __init__.py
│   ├── logger.py
│   ├── redis_client.py
│   ├── db_client.py
│   ├── audio_utils.py
│   └── text_utils.py
├── config/             # Shared configurations
│   ├── __init__.py
│   ├── base.py
│   ├── database.py
│   └── redis.py
├── middleware/         # Middleware components
│   ├── __init__.py
│   ├── auth.py
│   ├── rate_limit.py
│   └── logging.py
├── exceptions/         # Custom exceptions
│   ├── __init__.py
│   ├── base.py
│   └── errors.py
└── types/              # Custom types
    ├── __init__.py
    └── common.py
```

## Models

### User Models
```python
# shared/models/user.py
from pydantic import BaseModel, EmailStr
from sqlalchemy import Column, Integer, String
from typing import Optional

class UserBase(BaseModel):
    """Base user model cho validation"""
    email: EmailStr
    name: str
    
class UserCreate(UserBase):
    """Model cho user creation"""
    password: str
    
class UserResponse(UserBase):
    """Model cho API response"""
    id: int
    created_at: datetime
    
    class Config:
        orm_mode = True
```

### Room Models
```python
# shared/models/room.py
class Room(BaseModel):
    """Room model"""
    id: str
    name: str
    max_participants: int
    created_by: int
    settings: RoomSettings
```

### Transcription Models
```python
# shared/models/transcription.py
class TranscriptionSegment(BaseModel):
    """Single transcription segment"""
    start: float
    end: float
    text: str
    language: str
    confidence: float
    speaker: Optional[str] = None
```

## Utils

### Logger
```python
# shared/utils/logger.py
import logging
import json
from datetime import datetime

def get_logger(name: str) -> logging.Logger:
    """
    Tạo structured logger.
    
    Args:
        name: Tên của logger (usually __name__)
        
    Returns:
        Configured logger instance
    """
    logger = logging.getLogger(name)
    # Configuration...
    return logger
```

### Redis Client
```python
# shared/utils/redis_client.py
import redis
from typing import Optional

class RedisClient:
    """Shared Redis client với connection pooling"""
    
    _instance: Optional[redis.Redis] = None
    
    @classmethod
    def get_instance(cls) -> redis.Redis:
        """Get singleton Redis instance"""
        if cls._instance is None:
            cls._instance = redis.Redis(
                host='redis',
                port=6379,
                decode_responses=True
            )
        return cls._instance
```

### Audio Utils
```python
# shared/utils/audio_utils.py
import numpy as np
import librosa

def resample_audio(
    audio: np.ndarray,
    orig_sr: int,
    target_sr: int
) -> np.ndarray:
    """
    Resample audio to target sample rate.
    
    Args:
        audio: Audio data
        orig_sr: Original sample rate
        target_sr: Target sample rate
        
    Returns:
        Resampled audio
    """
    return librosa.resample(audio, orig_sr, target_sr)
```

## Config

### Base Config
```python
# shared/config/base.py
from pydantic import BaseSettings

class Settings(BaseSettings):
    """Base settings cho tất cả services"""
    
    # Environment
    ENV: str = "development"
    DEBUG: bool = False
    
    # API
    API_HOST: str = "0.0.0.0"
    API_PORT: int = 8000
    
    # JWT
    JWT_SECRET: str
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_MINUTES: int = 1440
    
    # Database
    DATABASE_URL: str
    
    # Redis
    REDIS_URL: str
    
    class Config:
        env_file = ".env"
```

## Middleware

### Auth Middleware
```python
# shared/middleware/auth.py
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt

security = HTTPBearer()

async def verify_token(
    credentials: HTTPAuthorizationCredentials = Security(security)
) -> dict:
    """
    Verify JWT token.
    
    Args:
        credentials: Bearer token
        
    Returns:
        Token payload
        
    Raises:
        HTTPException: Nếu token invalid
    """
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.JWT_SECRET,
            algorithms=[settings.JWT_ALGORITHM]
        )
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.JWTError:
        raise HTTPException(401, "Invalid token")
```

### Rate Limit Middleware
```python
# shared/middleware/rate_limit.py
from fastapi import HTTPException, Request
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

@limiter.limit("60/minute")
async def rate_limit_endpoint(request: Request):
    """Rate limit middleware - 60 requests per minute"""
    pass
```

## Exceptions

### Base Exception
```python
# shared/exceptions/base.py
class TranslationException(Exception):
    """Base exception cho hệ thống"""
    def __init__(self, message: str, code: str):
        self.message = message
        self.code = code
        super().__init__(self.message)
```

### Specific Exceptions
```python
# shared/exceptions/errors.py
class TranscriptionError(TranslationException):
    """Lỗi khi transcribe audio"""
    pass

class TranslationError(TranslationException):
    """Lỗi khi dịch text"""
    pass

class VoiceCloneError(TranslationException):
    """Lỗi khi clone voice"""
    pass
```

## Types

### Common Types
```python
# shared/types/common.py
from typing import TypedDict, List
from enum import Enum

class LanguageCode(str, Enum):
    """Supported language codes"""
    VI = "vi"
    EN = "en"
    ZH = "zh"
    JA = "ja"
    KO = "ko"
    
class AudioFormat(str, Enum):
    """Supported audio formats"""
    WAV = "wav"
    MP3 = "mp3"
    OGG = "ogg"
    OPUS = "opus"
```

## Usage

### In Services
```python
# services/transcription/main.py
from shared.models.transcription import TranscriptionSegment
from shared.utils.logger import get_logger
from shared.config.base import Settings
from shared.exceptions.errors import TranscriptionError

logger = get_logger(__name__)
settings = Settings()

def transcribe(audio: bytes) -> List[TranscriptionSegment]:
    try:
        # Process audio
        segments = process_audio(audio)
        return segments
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise TranscriptionError("Failed to transcribe", "TRANSCRIPTION_FAILED")
```

## Installation

Shared code được install như package:

```bash
# Install in editable mode
pip install -e shared/

# Hoặc add vào requirements.txt
-e file:shared
```

## Testing

```bash
# Test shared code
pytest shared/tests/

# Coverage
pytest --cov=shared shared/tests/
```

## Documentation

Each module PHẢI có:
- Module docstring
- Function/class docstrings
- Type hints
- Examples

Example:
```python
"""
shared.utils.audio_utils
~~~~~~~~~~~~~~~~~~~~~~~~~

Audio processing utilities.

Example:
    >>> from shared.utils.audio_utils import resample_audio
    >>> audio = load_audio("file.wav")
    >>> resampled = resample_audio(audio, 44100, 16000)
"""
```

## Standards

- **Naming**: snake_case cho functions/variables, PascalCase cho classes
- **Type hints**: Bắt buộc cho all functions
- **Docstrings**: Google style, tiếng Việt
- **Imports**: Organized (stdlib → third-party → local)
- **Constants**: UPPERCASE
- **Private**: Prefix với underscore `_`

## Next Steps

Shared code sẽ được develop song song với services:
- **Week 6**: Base models và utils
- **Week 7**: Middleware và exceptions
- **Week 8**: Audio/text utils
- **Week 10**: Advanced utilities

Xem [11-ROADMAP.md](../docs/11-ROADMAP.md) cho chi tiết.

## Related Documentation

- [04-SERVICES.md](../docs/04-SERVICES.md) - Service implementation
- [07-API-REFERENCES.md](../docs/07-API-REFERENCES.md) - API schemas
- [.github/copilot-instructions.md](../.github/copilot-instructions.md) - Coding standards
