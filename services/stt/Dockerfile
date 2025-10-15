# Dockerfile cho STT Service sử dụng PhoWhisper-small (Vietnamese-optimized)
FROM python:3.11-slim

# Metadata
LABEL maintainer="hopboy2003@gmail.com"
LABEL description="STT Service using PhoWhisper-small - Vietnamese-optimized Whisper model"
LABEL version="1.2.1"
LABEL model="vinai/PhoWhisper-small + faster-whisper-small"

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    libsndfile1 \
    wget \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better layer caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Download PhoWhisper-small model during build (Vietnamese-specialized)
# Note: PhoWhisper uses Transformers, not faster-whisper
# We'll keep faster-whisper for fallback/comparison
RUN python -c "from transformers import AutoModelForSpeechSeq2Seq, AutoProcessor; \
    model = AutoModelForSpeechSeq2Seq.from_pretrained('vinai/PhoWhisper-small'); \
    processor = AutoProcessor.from_pretrained('vinai/PhoWhisper-small')"

# Download faster-whisper SMALL for lower resource usage (multilingual)
# Model: Systran/faster-whisper-small (lighter than medium, ~250MB)
RUN python -c "from faster_whisper import WhisperModel; \
    WhisperModel('small', device='cpu', compute_type='int8')"

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 stt && chown -R stt:stt /app
USER stt

# Expose port
EXPOSE 8002

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    OMP_NUM_THREADS=4 \
    PRIMARY_MODEL=phowhisper-small \
    FALLBACK_MODEL=faster-whisper-small \
    COMPUTE_TYPE=int8 \
    DEVICE=cpu

# Start application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "2"]

