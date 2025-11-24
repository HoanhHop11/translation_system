# Dockerfile for STT Service using Sherpa-ONNX (CPU-only)
FROM python:3.11-slim

LABEL maintainer="hopboy2003@gmail.com"
LABEL description="STT Service using Sherpa-ONNX (Vietnamese + English streaming)"
LABEL version="2.0.0-sherpa"

WORKDIR /app

# System dependencies (minimal)
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    bzip2 \
    ca-certificates \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

# CPU performance env vars
ENV OMP_NUM_THREADS=0 \
    OMP_WAIT_POLICY=ACTIVE \
    OMP_DYNAMIC=FALSE \
    OMP_PROC_BIND=CLOSE \
    MKL_NUM_THREADS=0 \
    ORT_ENABLE_ALL=1 \
    ORT_DISABLE_ALL_EXECUTION_PROVIDERS=0 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# Install Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download Sherpa-ONNX models (Vietnamese + English INT8 only)
RUN mkdir -p /app/models/vi /app/models/en

# Vietnamese model INT8 (74MB archive)
RUN wget -q https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-zipformer-vi-int8-2025-04-20.tar.bz2 \
    && tar -xf sherpa-onnx-zipformer-vi-int8-2025-04-20.tar.bz2 \
    && mv sherpa-onnx-zipformer-vi-int8-2025-04-20/* /app/models/vi/ \
    && rm -rf sherpa-onnx-zipformer-vi-int8-2025-04-20*

# English model INT8 files only (download trực tiếp từ HuggingFace, ~10MB total thay vì 296MB)
RUN cd /app/models/en && \
    wget -q https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/encoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx && \
    wget -q https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/decoder-epoch-99-avg-1-chunk-16-left-64.int8.onnx && \
    wget -q https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/joiner-epoch-99-avg-1-chunk-16-left-64.int8.onnx && \
    wget -q https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/tokens.txt && \
    wget -q https://huggingface.co/csukuangfj/sherpa-onnx-streaming-zipformer-en-2023-06-26/resolve/main/bpe.model

# Copy application code
COPY . .

# Create non-root user
RUN useradd -m -u 1000 stt && chown -R stt:stt /app
USER stt

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Start application
CMD ["uvicorn", "sherpa_main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "2"]
