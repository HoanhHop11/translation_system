FROM python:3.11-slim

# Install system dependencies for Piper (espeak-ng is required)
RUN apt-get update && apt-get install -y \
    espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy models (models should be in the build context)
# We copy them to /models inside the container as per the plan
COPY models /models

# Copy application code
COPY main.py .

# Expose port
EXPOSE 8004

# Run the application
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]


