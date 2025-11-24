# TTS Piper Service - Vietnamese + English Text-to-Speech

CPU-optimized TTS service với Piper + OpenVoice v2 voice cloning.

## Features

- **Baseline TTS**: Piper ONNX models
  - Vietnamese: `vi_VN-vais1000-medium` (22.05 kHz, medium quality)
  - English: `en_US-lessac-medium` (22.05 kHz, female voice)
- **Voice Cloning** (optional): OpenVoice v2 Tone Color Converter
- **CPU-optimized**: ONNX Runtime + OpenVINO
- **Backward-compatible**: Same port 8004, supports old `/synthesize` API

## API Endpoints

### Health Check
```bash
GET /health
Response: {"status":"ok","engine":"piper+openvoice","languages":["vi","en"],"modes":["generic","clone"]}
```

### Synthesize (Generic Mode - Piper Only)
```bash
POST /synthesize
Content-Type: application/json

{
  "text": "Xin chào",
  "lang": "vi",
  "mode": "generic"
}

Response: {"audio_base64": "...", "sample_rate": 22050}
```

### Synthesize with Voice Cloning
```bash
POST /synthesize-clone
Content-Type: multipart/form-data

Fields:
- text: "Hello world"
- lang: "en"
- reference_audio: (WAV file, 3-10 seconds)

Response: {"audio_base64": "...", "sample_rate": 22050}
```

## Build Instructions

### 1. Download Models

```bash
# Run download script
bash scripts/download-tts-models.sh /tmp/tts-models

# Verify tarball created
ls -lh /tmp/tts-models/tts-models.tar.gz
```

### 2. Copy Models to Service

```bash
cp /tmp/tts-models/tts-models.tar.gz services/tts-piper/
```

### 3. Build Docker Image

```bash
cd services/tts-piper
docker build -t jackboun11/jbcalling-tts-piper:1.0.0 .
```

### 4. Test Locally

```bash
# Start container
docker run -d -p 8004:8004 --name tts-test \
  jackboun11/jbcalling-tts-piper:1.0.0

# Check health
curl http://localhost:8004/health

# Test Vietnamese TTS
curl -X POST http://localhost:8004/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Xin chào, đây là kiểm thử tiếng Việt","lang":"vi","mode":"generic"}' \
  --output test_vi.wav

# Test English TTS
curl -X POST http://localhost:8004/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, this is an English test","lang":"en","mode":"generic"}' \
  --output test_en.wav

# Play audio to verify
ffplay test_vi.wav
ffplay test_en.wav
```

## Deployment to Swarm

### 1. Push Image

```bash
docker push jackboun11/jbcalling-tts-piper:1.0.0
```

### 2. Update Stack

```bash
# stack-hybrid.yml already configured with tts_translation02/03
# Just deploy:
docker stack deploy -c infrastructure/swarm/stack-hybrid.yml translation
```

### 3. Verify

```bash
# Check service status
docker service ls | grep tts

# Check logs
docker service logs -f translation_tts_translation02

# Test via Traefik
curl https://tts.jbcalling.site/health
```

## Model Sizes

- Piper Vietnamese: ~63MB
- Piper English: ~63MB
- OpenVoice v2 (optional): ~200MB
- Total (without OpenVoice): ~126MB
- Total (with OpenVoice): ~326MB

## Resource Requirements

- CPU: 1.5 cores (generic mode), 2.0 cores (clone mode)
- RAM: 1.5GB (generic mode), 2.5GB (clone mode)
- Disk: 400MB (with all models)

## Environment Variables

```bash
PIPER_MODEL_VI=/models/piper/vi_VN-vais1000-medium.onnx
PIPER_CONFIG_VI=/models/piper/vi_VN-vais1000-medium.onnx.json
PIPER_MODEL_EN=/models/piper/en_US-lessac-medium.onnx
PIPER_CONFIG_EN=/models/piper/en_US-lessac-medium.onnx.json
OPENVOICE_BASE_DIR=/models/openvoice/base  # Optional
OPENVOICE_TCC_DIR=/models/openvoice/tcc    # Optional
```

## Performance

### Latency (CPU - c4d-standard-4)
- Generic mode (Piper only): ~200-400ms per sentence
- Clone mode (Piper + TCC): ~500-800ms per sentence

### Quality
- Vietnamese: Medium quality, clear pronunciation
- English: Medium quality, natural female voice
- Clone mode: Preserves tone color, may lose some prosody

## Troubleshooting

### Service won't start
```bash
# Check logs
docker service logs translation_tts_translation02

# Common issues:
# - Models not downloaded → Run download-tts-models.sh
# - Out of memory → Increase memory limit in stack-hybrid.yml
# - Port conflict → Check port 8004 not used
```

### Audio quality poor
```bash
# For Vietnamese: Try high quality model (larger, slower)
# For English: Try libritts-high model
# See Piper voices: https://huggingface.co/rhasspy/piper-voices
```

### Clone mode not working
```bash
# Check OpenVoice models converted
ls /models/openvoice/base/
ls /models/openvoice/tcc/

# If missing, follow OpenVINO conversion guide:
# https://github.com/openvinotoolkit/openvino_notebooks/blob/main/notebooks/284-openvoice/284-openvoice.ipynb
```

## References

- Piper TTS: https://github.com/rhasspy/piper
- Piper Voices: https://huggingface.co/rhasspy/piper-voices
- OpenVoice v2: https://github.com/myshell-ai/OpenVoice
- OpenVoice Checkpoints: https://huggingface.co/myshell-ai/OpenVoiceV2
- OpenVINO Tutorial: https://docs.openvino.ai/2024/notebooks/openvoice-with-output.html
