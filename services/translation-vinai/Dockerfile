# ==============================================================================
# VinAI Translation Service với CTranslate2 INT8 Optimization
# ==============================================================================
# Multi-stage build để giảm image size xuống ~1.5GB (vs 15GB NLLB)
# Stage 1: Download models và convert sang CTranslate2 INT8
# Stage 2: Runtime với chỉ converted models và minimal dependencies
# ==============================================================================

# ==============================================================================
# STAGE 1: Model Builder - Download và Convert Models
# ==============================================================================
FROM python:3.11-slim AS model-builder

LABEL maintainer="hopboy2003@gmail.com"
LABEL stage="builder"
LABEL description="Download VinAI models và convert sang CTranslate2 INT8"

WORKDIR /build

# Install build dependencies
RUN apt-get update && apt-get install -y \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

    # Install Python dependencies for conversion
    # Install torch first with specific index
    RUN pip install --no-cache-dir torch==2.1.0 --index-url https://download.pytorch.org/whl/cpu
    
    # Then install other packages from PyPI
    RUN pip install --no-cache-dir \
        'numpy<2.0' \
        protobuf==4.25.1 \
        ctranslate2==4.0.0 \
        transformers==4.36.0 \
        sentencepiece==0.1.99 \
        huggingface-hub==0.20.0
    
    # Download VinAI models (Vi→En và En→Vi)
    RUN echo "Downloading VinAI Translate models..." && \
        python3 -c "from huggingface_hub import snapshot_download; \
                    print('Downloading vinai-translate-vi2en-v2...'); \
                    snapshot_download('vinai/vinai-translate-vi2en-v2', local_dir='/build/vinai-vi2en-v2'); \
                    print('Downloading vinai-translate-en2vi-v2...'); \
                    snapshot_download('vinai/vinai-translate-en2vi-v2', local_dir='/build/vinai-en2vi-v2'); \
                    print('Download complete!')"
    
    # Convert models sang CTranslate2 INT8 format
    # Set GLIBC_TUNABLES để bypass glibc 2.41 executable stack restriction
    ENV GLIBC_TUNABLES=glibc.rtld.execstack=2
    
    RUN echo "Converting Vi→En model to CTranslate2 INT8..." && \
        ct2-transformers-converter \
          --model /build/vinai-vi2en-v2 \
          --output_dir /build/ct2-vi2en \
          --quantization int8 \
          --force && \
        echo "Converting En→Vi model to CTranslate2 INT8..." && \
        ct2-transformers-converter \
          --model /build/vinai-en2vi-v2 \
          --output_dir /build/ct2-en2vi \
          --quantization int8 \
          --force
    
    # Verify converted models
RUN echo "Verifying converted models..." && \
    ls -lh /build/ct2-vi2en/ && \
    ls -lh /build/ct2-en2vi/ && \
    du -sh /build/ct2-*

# ==============================================================================
# STAGE 2: Runtime - Minimal image với converted models
# ==============================================================================
FROM python:3.11-slim

LABEL maintainer="hopboy2003@gmail.com"
LABEL version="1.0.0"
LABEL description="VinAI Translation với CTranslate2 INT8 - CPU Optimized"

# Set working directory
WORKDIR /app

# Install minimal system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements trước để tận dụng Docker layer caching
COPY requirements.txt .

# Install runtime Python dependencies (minimal)
RUN pip install --no-cache-dir -r requirements.txt

# Copy converted models từ builder stage
COPY --from=model-builder /build/ct2-vi2en /app/models/ct2-vi2en
COPY --from=model-builder /build/ct2-en2vi /app/models/ct2-en2vi

# Copy sentencepiece tokenizers (VinAI models chỉ cần sentencepiece.bpe.model)
COPY --from=model-builder /build/vinai-vi2en-v2/sentencepiece.bpe.model /app/models/vi2en-tokenizer/
COPY --from=model-builder /build/vinai-en2vi-v2/sentencepiece.bpe.model /app/models/en2vi-tokenizer/

# Verify model sizes
RUN echo "Final model sizes:" && \
    du -sh /app/models/* && \
    echo "Total models size:" && \
    du -sh /app/models

# Copy application code
COPY main.py .

# Create non-root user cho security
RUN useradd -m -u 1000 -s /bin/bash appuser && \
    chown -R appuser:appuser /app

USER appuser

# Environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    DEVICE=cpu \
    COMPUTE_TYPE=int8 \
    MAX_LENGTH=512 \
    BEAM_SIZE=1 \
    PORT=8005 \
    GLIBC_TUNABLES=glibc.rtld.execstack=2

# Health check
HEALTHCHECK --interval=15s --timeout=5s --retries=3 --start-period=60s \
    CMD curl -f http://localhost:8005/health || exit 1

# Expose port
EXPOSE 8005

# Start application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8005", "--workers", "1", "--log-level", "info"]
