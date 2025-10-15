# Dockerfile cho TTS Service sử dụng gTTS + XTTS v2
FROM python:3.11-slim

# Metadata
LABEL maintainer="hopboy2003@gmail.com"
LABEL description="TTS Service using gTTS for fast synthesis and XTTS v2 for voice cloning"
LABEL version="1.0.0"

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    wget \
    curl \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Create directories for voice samples and cache
RUN mkdir -p /app/voice_samples /app/cache && \
    chmod 777 /app/voice_samples /app/cache

# Note: Running as root for now to avoid permission issues
# TODO: Fix permissions properly in production

# Expose port
EXPOSE 8004

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8004/health || exit 1

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TTS_ENGINE=gtts \
    CACHE_DIR=/app/cache

# Start application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004", "--workers", "2"]
