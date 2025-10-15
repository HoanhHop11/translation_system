# STT Service - Speech-to-Text

Service dịch audio thành text sử dụng faster-whisper với CPU optimization.

## Tính Năng

- ✅ **CPU-Optimized**: Sử dụng INT8 quantization cho faster-whisper
- ✅ **Multi-language**: Support 15+ languages với auto-detection
- ✅ **Low Latency**: ~500-800ms cho audio 5s
- ✅ **VAD Filter**: Tự động loại bỏ silence
- ✅ **Word Timestamps**: Timestamps chính xác đến từng từ
- ✅ **Prometheus Metrics**: Monitoring đầy đủ

## API Endpoints

### POST /transcribe
Transcribe audio file thành text.

**Request**:
```bash
curl -X POST "http://localhost:8002/transcribe" \
  -F "audio=@audio.wav" \
  -F "language=vi" \
  -F "word_timestamps=true"
```

**Response**:
```json
{
  "text": "Xin chào, đây là test audio",
  "language": "vi",
  "language_probability": 0.95,
  "duration": 3.5,
  "segments": [
    {
      "start": 0.0,
      "end": 3.5,
      "text": "Xin chào, đây là test audio"
    }
  ],
  "processing_time": 0.82
}
```

### GET /health
Health check endpoint.

### GET /metrics
Prometheus metrics.

### GET /models
List các models khả dụng.

### GET /languages
List các languages được support.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MODEL_SIZE` | `small` | Whisper model size (tiny, base, small, medium, large-v3) |
| `COMPUTE_TYPE` | `int8` | Compute type (int8, float16, float32) |
| `DEVICE` | `cpu` | Device (cpu hoặc cuda) |
| `OMP_NUM_THREADS` | `4` | Number of CPU threads |

## Performance

**Model**: `small` (INT8)  
**Hardware**: 4 CPU cores, 4GB RAM

| Audio Length | Processing Time | RTF* |
|-------------|----------------|------|
| 5s | ~0.5-0.8s | 0.10-0.16 |
| 10s | ~1.0-1.5s | 0.10-0.15 |
| 30s | ~3.0-4.5s | 0.10-0.15 |
| 60s | ~6.0-9.0s | 0.10-0.15 |

*RTF (Real-Time Factor) = Processing Time / Audio Length. Lower is better.

## Docker Build

```bash
docker build -t jbcalling-stt:1.0.0 .
```

## Docker Run

```bash
docker run -d \
  --name stt-service \
  -p 8002:8002 \
  -e MODEL_SIZE=small \
  -e COMPUTE_TYPE=int8 \
  -e OMP_NUM_THREADS=4 \
  jbcalling-stt:1.0.0
```

## Development

```bash
# Install dependencies
pip install -r requirements.txt

# Run locally
python main.py

# Test
curl -X POST "http://localhost:8002/transcribe" \
  -F "audio=@test_audio.wav"
```

## Supported Languages

English, Vietnamese, Chinese, Japanese, Korean, French, German, Spanish, Italian, Portuguese, Russian, Arabic, Hindi, Thai, Indonesian, và nhiều ngôn ngữ khác.

## Metrics

- `stt_transcriptions_total`: Total transcription requests
- `stt_transcription_duration_seconds`: Processing time histogram
- `stt_audio_length_seconds`: Audio length histogram

## Notes

- Model `small` được download automatically khi build Docker image
- Để cải thiện performance, tăng `OMP_NUM_THREADS` theo số CPU cores
- VAD filter giúp giảm processing time bằng cách skip silence
