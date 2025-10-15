# Dockerfile cho Translation Service sử dụng NLLB-200 với INT8 Quantization
FROM python:3.11-slim

# Metadata
LABEL maintainer="hopboy2003@gmail.com"
LABEL description="Translation Service using NLLB-200 with INT8 quantization for CPU optimization"
LABEL version="1.1.3-int8"

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Download NLLB-200 model during build (distilled-600M for CPU)
# Force new download by adding timestamp comment: 2025-10-06-17:45
RUN python -c "from transformers import AutoModelForSeq2SeqLM, AutoTokenizer; \
    model_name = 'facebook/nllb-200-distilled-600M'; \
    print('Downloading tokenizer...'); \
    AutoTokenizer.from_pretrained(model_name); \
    print('Downloading model...'); \
    AutoModelForSeq2SeqLM.from_pretrained(model_name); \
    print('Model download complete!')"

# Copy application code
COPY . .

# Create non-root user và copy model cache
RUN useradd -m -u 1000 translation && \
    mkdir -p /home/translation/.cache/huggingface && \
    cp -r /root/.cache/huggingface/* /home/translation/.cache/huggingface/ && \
    chown -R translation:translation /app /home/translation/.cache
USER translation

# Set HuggingFace cache location cho user translation
ENV HF_HOME=/home/translation/.cache/huggingface

# Expose port
EXPOSE 8003

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:8003/health || exit 1

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    MODEL_NAME=facebook/nllb-200-distilled-600M \
    DEVICE=cpu \
    MAX_LENGTH=512 \
    USE_INT8_QUANTIZATION=true \
    OMP_NUM_THREADS=4

# Start application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8003", "--workers", "1"]
