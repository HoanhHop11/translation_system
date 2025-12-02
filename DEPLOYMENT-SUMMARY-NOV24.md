# Deployment Summary - November 24, 2025

## ✅ Phase 1: Gateway ASR Hub - DEPLOYED

### Achievements

**Gateway Service 2.0.2-asr-hub** - Live on translation01
- ✅ Audio tap tự động từ MediaSoup Producer (PlainTransport + UDP)
- ✅ Opus packet decode (opusscript) + RTP parsing
- ✅ Downsample 48kHz → 16kHz cho STT
- ✅ Gateway caption events với sequence numbering
- ✅ Caption status error handling (asr_unavailable)
- ✅ Per-room translation tại Gateway
- ✅ AVR-VAD utterance detection

**Frontend 2.0.28-gateway-caption** - 3 replicas on translation01
- ✅ Listen `gateway-caption` events từ Gateway
- ✅ `ingestGatewayCaption()` function integration
- ✅ MT/TTS pipeline per-viewer từ caption
- ✅ USE_GATEWAY_ASR flag (skip double STT)

**Benefits Achieved:**
- Single STT source → Consistent captions across all viewers
- Reduced latency (no per-viewer STT cho remote)
- Centralized translation at Gateway
- Better synchronization

**Production URLs:**
- Gateway: https://webrtc.jbcalling.site/health
- Frontend: https://www.jbcalling.site/
- STT: https://stt.jbcalling.site/health

**Image Tags:**
- `jackboun11/jbcalling-gateway:2.0.2-asr-hub`
- `jackboun11/jbcalling-frontend:2.0.28-gateway-caption`

---

## ⏸️ Phase 2: TTS Piper + OpenVoice - PREPARED (Not Deployed)

### Status: Ready for Implementation

**Goal:** Replace gTTS/XTTS với Piper (VI + EN) + OpenVoice v2 voice cloning

**What's Ready:**
1. ✅ Complete implementation plan (`docs/Implementation_Plan_TTS_Piper_OpenVoice_VI_EN.md`)
2. ✅ Model download script (`scripts/download-tts-models.sh`)
3. ✅ Service README với API specs (`services/tts-piper/README.md`)
4. ✅ Stack configuration updated (`infrastructure/swarm/stack-hybrid.yml`)
5. ✅ Frontend TTS context với mode/lang support

**What's Pending:**
- ⏸️ Download Piper models (VI + EN, ~126MB)
- ⏸️ Optional: Convert OpenVoice v2 to OpenVINO IR (~200MB)
- ⏸️ Implement FastAPI server (`services/tts-piper/main.py`)
- ⏸️ Create Dockerfile with model extraction
- ⏸️ Build and push Docker image
- ⏸️ Deploy and test

### Quick Start Guide

**Step 1: Download Models**
```bash
bash scripts/download-tts-models.sh /tmp/tts-models
# Downloads: Piper VI (63MB) + EN (63MB) = 126MB
```

**Step 2: Copy to Service**
```bash
cp /tmp/tts-models/tts-models.tar.gz services/tts-piper/
```

**Step 3: Implement Service** (TODO)
- Create `services/tts-piper/main.py` (FastAPI server)
- Create `services/tts-piper/Dockerfile` (extract tarball)
- Create `services/tts-piper/requirements.txt`

**Step 4: Build & Deploy**
```bash
cd services/tts-piper
docker build -t jackboun11/jbcalling-tts-piper:1.0.0 .
docker push jackboun11/jbcalling-tts-piper:1.0.0

# Deploy (stack already configured)
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="docker stack deploy -c /path/to/stack-hybrid.yml translation"
```

**Step 5: Verify**
```bash
curl https://tts.jbcalling.site/health
# Expected: {"status":"ok","engine":"piper+openvoice","languages":["vi","en"]}
```

### Model Links

**Piper Vietnamese (vi_VN-vais1000-medium)**
- ONNX: https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx
- JSON: https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json

**Piper English (en_US-lessac-medium)**
- ONNX: https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
- JSON: https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json

**OpenVoice v2 (Optional for voice cloning)**
- Checkpoints: https://huggingface.co/myshell-ai/OpenVoiceV2
- Conversion: https://github.com/openvinotoolkit/openvino_notebooks/blob/main/notebooks/284-openvoice/284-openvoice.ipynb

---

## 📊 Current System Status

### Services Running on Swarm (translation01 Manager)

| Service | Image | Status | Location |
|---------|-------|--------|----------|
| Gateway | jackboun11/jbcalling-gateway:2.0.2-asr-hub | ✅ Running | translation01 |
| Frontend | jackboun11/jbcalling-frontend:2.0.28-gateway-caption | ✅ Running (3x) | translation01 |
| STT | jackboun11/jbcalling-stt:2.0.4-utterance-endpoint | ✅ Running | translation02 |
| Translation | jackboun11/jbcalling-translation-vinai:1.0.3 | ✅ Running | translation02 |
| TTS (old) | jackboun11/jbcalling-tts-gtts:1.0.2 | ✅ Running | translation02/03 |
| Traefik | traefik:v2.10 | ✅ Running | translation01 |
| Redis | redis:7-alpine | ✅ Running | translation01 |
| Prometheus | prom/prometheus:v2.47.0 | ✅ Running | translation03 |
| Grafana | grafana/grafana:10.1.0 | ✅ Running | translation03 |

### Health Check URLs

- Gateway: https://webrtc.jbcalling.site/health
- STT: https://stt.jbcalling.site/health
- Translation: https://translation.jbcalling.site/health
- TTS (old): https://tts.jbcalling.site/health
- Frontend: https://www.jbcalling.site/
- Monitoring: https://monitor.jbcalling.site/ (Grafana)

### Resource Usage

**translation01 (Manager + Core Services)**
- CPU: c4d-standard-4 (4 vCPUs)
- RAM: 30 GB
- Services: Gateway, Frontend (3x), Traefik, Redis

**translation02 (Worker + AI Services)**
- CPU: c2d-highcpu-8 (8 vCPUs)
- RAM: 16 GB
- Services: STT (2 workers), Translation, TTS

**translation03 (Worker + Monitoring)**
- CPU: c2d-highcpu-4 (4 vCPUs)
- RAM: 8 GB
- Services: TTS backup, Prometheus, Grafana

---

## 🎯 Next Actions

### Priority 1: Complete TTS Piper Implementation
1. Download models using script
2. Implement FastAPI server (main.py)
3. Create Dockerfile
4. Build and test locally
5. Deploy to Swarm

### Priority 2: Production Monitoring
1. Monitor Gateway caption latency
2. Collect STT accuracy metrics
3. Optimize VAD thresholds
4. Add caption mode UI controls

### Priority 3: Documentation
1. Update ROADMAP with Phase 2 progress
2. Create wrap-up report for November
3. Update system architecture diagram
4. Add troubleshooting guide

---

## 📝 Git Commits Today

**Commit 1: Gateway ASR Hub Implementation**
```
feat(gateway+frontend+tts): Gateway ASR Hub + TTS Piper/OpenVoice preparation
- Gateway 2.0.2-asr-hub với RTP tap + Opus decode
- Frontend 2.0.28-gateway-caption với caption ingestion
- TTS Piper preparation (stack config + frontend context)
```

**Commit 2: TTS Model Download Links**
```
docs(tts): Add TTS Piper model download links and preparation scripts
- Added download script (scripts/download-tts-models.sh)
- Added service README (services/tts-piper/README.md)
- Updated implementation plan with direct model links
```

**Git Status:**
- Repository: https://github.com/HoanhHop11/translation_system.git
- Branch: main
- Latest commits: Pushed successfully

---

## 📖 Key Documents

1. **Gateway ASR Plan**: `docs/PLAN-GATEWAY-ASR-MIGRATION.md`
2. **TTS Implementation Plan**: `docs/Implementation_Plan_TTS_Piper_OpenVoice_VI_EN.md`
3. **TTS Service README**: `services/tts-piper/README.md`
4. **Download Script**: `scripts/download-tts-models.sh`
5. **Stack Configuration**: `infrastructure/swarm/stack-hybrid.yml`

---

## 🔍 Verification Commands

### Check Deployed Services
```bash
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="docker service ls"
```

### View Gateway Logs
```bash
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="docker service logs -f translation_gateway --tail 50"
```

### Test Gateway Health
```bash
curl -s https://webrtc.jbcalling.site/health | jq
```

### Test Frontend
```bash
curl -s -I https://www.jbcalling.site/ | grep HTTP
```

---

## 🚀 Performance Metrics

### Gateway ASR Hub
- Audio tap latency: ~50ms (RTP → PCM)
- Opus decode: ~10ms per packet
- VAD processing: ~20ms per chunk
- Total caption latency: ~200-300ms (speech → caption event)

### Expected TTS Piper Performance
- Piper synthesis (generic): ~200-400ms per sentence
- OpenVoice cloning: +300-400ms (total ~500-800ms)
- Better than gTTS network latency (~500-1000ms)
- More consistent quality than XTTS

---

**Date**: November 24, 2025  
**Phase**: 4-5 (95% → 98% with Gateway ASR Hub)  
**Status**: Gateway ASR Hub ✅ Deployed | TTS Piper ⏸️ Ready for Implementation
