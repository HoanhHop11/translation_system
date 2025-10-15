# 🚀 Next Steps: Phase 3 - AI Pipeline

**Created**: October 5, 2025  
**Phase 2 Status**: ✅ **COMPLETED**  
**Phase 3 Status**: ⏳ **READY TO START**

---

## 📋 Pre-Phase 3 Checklist

### Immediate Security Tasks (CRITICAL - Do First!)

- [ ] **Change Traefik Dashboard Password**
  ```bash
  # Generate new password hash
  echo $(htpasswd -nb admin new_password) | sed -e s/\\$/\\$\\$/g
  
  # Update in stack-with-ssl.yml
  # Redeploy: docker stack deploy -c stack-final.yml translation
  ```

- [ ] **Change Grafana Admin Password**
  ```bash
  # Login to Grafana: https://monitoring.jbcalling.site
  # Go to Profile → Change Password
  # Update docs/00-REQUIRED-INFO.md
  ```

- [ ] **Verify Firewall Rules**
  ```bash
  gcloud compute firewall-rules list --filter="name~translation"
  ```

- [ ] **Setup Backup Strategy**
  - PostgreSQL automated backups
  - Redis persistence configuration
  - Traefik certificate backup

### Optional Improvements

- [ ] **Fix Loki Service** (if logging needed)
  ```bash
  # Debug why Loki is 0/1
  docker service logs translation_loki --tail 50
  ```

- [ ] **Update Frontend Environment**
  - Rebuild with HTTPS API URLs
  - Update VITE_API_URL to https://api.jbcalling.site
  - Tag as v1.0.2

- [ ] **Setup Monitoring Alerts**
  - Certificate expiry alerts
  - Service down alerts
  - High resource usage alerts

---

## 🎯 Phase 3 Overview: AI Translation Pipeline

**Goal**: Implement real-time speech-to-speech translation pipeline

### Architecture

```
User A (Language A)
    ↓ Audio Stream
WebRTC Gateway
    ↓
STT Service (Whisper)
    ↓ Text (Language A)
Translation Service (NLLB-200)
    ↓ Text (Language B)
TTS Service (XTTS/gTTS)
    ↓ Audio Stream
WebRTC Gateway
    ↓
User B (Language B)
```

---

## 📦 Phase 3 Services to Deploy

### 1. STT Service (Speech-to-Text)
**Priority**: HIGH  
**Model**: faster-whisper (INT8 quantized)  
**Resources**: 4 CPU cores, 4GB RAM  
**Replicas**: 2 (on translation02, translation03)

**Tasks**:
- [ ] Create `services/stt/` directory structure
- [ ] Write Dockerfile with faster-whisper
- [ ] Implement FastAPI endpoints:
  - `POST /transcribe` - Accept audio, return text
  - `GET /health` - Health check
  - `GET /models` - List available models
- [ ] Add VAD (Voice Activity Detection)
- [ ] Implement streaming transcription
- [ ] Add to Docker Stack
- [ ] Test with sample audio files

**Estimated Time**: 2-3 days

---

### 2. Translation Service
**Priority**: HIGH  
**Model**: NLLB-200-distilled-600M  
**Resources**: 2 CPU cores, 4GB RAM  
**Replicas**: 2 (distributed)

**Tasks**:
- [ ] Create `services/translation/` directory structure
- [ ] Write Dockerfile with Hugging Face Transformers
- [ ] Implement FastAPI endpoints:
  - `POST /translate` - Translate text
  - `GET /languages` - List supported languages
  - `GET /health` - Health check
- [ ] Add translation caching (Redis)
- [ ] Implement language detection
- [ ] Add to Docker Stack
- [ ] Test with sample sentences

**Estimated Time**: 1-2 days

---

### 3. TTS Service (Text-to-Speech)
**Priority**: MEDIUM  
**Model**: gTTS (simple) + XTTS v2 (advanced)  
**Resources**: 4 CPU cores, 4GB RAM  
**Replicas**: 2

**Tasks**:
- [ ] Create `services/tts/` directory structure
- [ ] Write Dockerfile with gTTS and XTTS
- [ ] Implement FastAPI endpoints:
  - `POST /synthesize` - Text to audio
  - `POST /clone-voice` - Voice cloning
  - `GET /voices` - List available voices
  - `GET /health` - Health check
- [ ] Add audio caching (Redis)
- [ ] Implement voice cloning API
- [ ] Add to Docker Stack
- [ ] Test with sample text

**Estimated Time**: 2-3 days

---

### 4. Pipeline Orchestrator
**Priority**: HIGH  
**Resources**: 2 CPU cores, 2GB RAM  
**Replicas**: 2

**Tasks**:
- [ ] Create `services/pipeline/` directory structure
- [ ] Implement orchestration logic:
  - Audio chunking and buffering
  - Sequential API calls (STT → Translation → TTS)
  - Error handling and retry logic
  - Latency optimization
- [ ] WebSocket integration with Signaling Server
- [ ] Add pipeline monitoring metrics
- [ ] Test end-to-end flow
- [ ] Performance optimization

**Estimated Time**: 3-4 days

---

### 5. WebRTC Media Server
**Priority**: HIGH  
**Solution**: MediaSoup (CPU-optimized)  
**Resources**: 4 CPU cores, 4GB RAM  
**Replicas**: 1 per worker node

**Tasks**:
- [ ] Research MediaSoup vs Janus Gateway
- [ ] Create `services/media-server/` directory
- [ ] Implement MediaSoup integration
- [ ] Configure SFU (Selective Forwarding Unit)
- [ ] Add audio processing hooks
- [ ] Integrate with Pipeline Orchestrator
- [ ] Add to Docker Stack
- [ ] Test with 2-4 participants

**Estimated Time**: 4-5 days

---

## 🔧 Infrastructure Updates for Phase 3

### Docker Stack Changes

**New Services**:
```yaml
services/
  stt:                  # Speech-to-Text
  translation:          # Translation
  tts:                  # Text-to-Speech
  pipeline:             # Pipeline Orchestrator
  media-server:         # WebRTC Media Server
```

**Updated Services**:
- `api`: Add pipeline endpoints
- `signaling`: Integrate with media server
- `frontend`: Add translation UI controls

**New Networks**:
- `ai_processing`: Internal network for AI services
- `media`: Network for WebRTC media traffic

---

## 📊 Resource Planning

### Current Usage (Phase 2)
```
translation01 (Manager): ~4GB RAM, ~30% CPU
translation02 (Worker):  ~3GB RAM, ~20% CPU
translation03 (Worker):  ~2GB RAM, ~15% CPU
```

### Projected Usage (Phase 3)
```
translation01 (Manager): ~6GB RAM, ~50% CPU
  - PostgreSQL, Redis, Prometheus, Grafana
  - Traefik, Pipeline Orchestrator

translation02 (Worker):  ~12GB RAM, ~70% CPU
  - API (2), Frontend (1)
  - STT (1), Translation (1)
  - Media Server (1)

translation03 (Worker):  ~6GB RAM, ~50% CPU
  - Signaling (1), Frontend (1)
  - STT (1), TTS (1), Translation (1)
```

⚠️ **Note**: translation02 có thể cần upgrade RAM nếu performance không đủ.

---

## 🧪 Testing Strategy

### Unit Tests
- [ ] STT service accuracy tests (WER < 10%)
- [ ] Translation service quality tests (BLEU score)
- [ ] TTS service voice quality tests
- [ ] Pipeline latency tests (target < 2s)

### Integration Tests
- [ ] STT → Translation flow
- [ ] Translation → TTS flow
- [ ] Full pipeline E2E test
- [ ] WebRTC media flow test

### Load Tests
- [ ] 2 concurrent users
- [ ] 5 concurrent users
- [ ] 10 concurrent users (stress test)

### Acceptance Tests
- [ ] English → Vietnamese translation
- [ ] Vietnamese → English translation
- [ ] Audio quality preservation
- [ ] Latency requirements met

---

## 📈 Success Criteria for Phase 3

### Performance Metrics
- ✅ **STT Latency**: < 800ms (per 5s audio chunk)
- ✅ **Translation Latency**: < 200ms
- ✅ **TTS Latency**: < 500ms
- ✅ **End-to-End Latency**: < 1.5s
- ✅ **Transcription Accuracy**: WER < 10% or Accuracy > 90%
- ✅ **Translation Quality**: Human evaluation "good" or better

### Functional Requirements
- ✅ Support 2 languages minimum (English, Vietnamese)
- ✅ Handle 2-4 concurrent video calls
- ✅ Audio/video quality maintained
- ✅ Graceful error handling
- ✅ Real-time captions display

### Operational Requirements
- ✅ All services healthy
- ✅ Monitoring dashboard setup
- ✅ Logging and debugging tools
- ✅ Backup and recovery procedures

---

## 🗓️ Estimated Timeline

### Week 1: STT + Translation Services
- **Days 1-3**: STT Service development and testing
- **Days 4-5**: Translation Service development
- **Days 6-7**: Integration testing and optimization

### Week 2: TTS + Pipeline
- **Days 1-3**: TTS Service development and testing
- **Days 4-5**: Pipeline Orchestrator development
- **Days 6-7**: End-to-end testing

### Week 3: WebRTC Media Server
- **Days 1-4**: Media Server setup and integration
- **Days 5-7**: Load testing and optimization

### Week 4: Polish and Deploy
- **Days 1-2**: Bug fixes and performance tuning
- **Days 3-4**: Documentation updates
- **Days 5**: Final deployment to production
- **Days 6-7**: User acceptance testing

**Total Estimated Time**: 4 weeks (28 days)

---

## 🛠️ Development Environment Setup

### Prerequisites
- Python 3.11+
- Docker 24.0+
- CUDA toolkit (for local GPU testing, optional)
- ffmpeg (for audio processing)

### Local Development
```bash
# Clone repo
git clone https://github.com/your-org/jbcalling_translation_realtime.git
cd jbcalling_translation_realtime

# Create Python virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run STT service locally
cd services/stt
python main.py

# Run in Docker (recommended)
docker-compose -f docker-compose.dev.yml up stt
```

---

## 📚 Resources and Documentation

### AI Models Documentation
- **Whisper**: https://github.com/openai/whisper
- **faster-whisper**: https://github.com/guillaumekln/faster-whisper
- **NLLB-200**: https://huggingface.co/facebook/nllb-200-distilled-600M
- **XTTS v2**: https://docs.coqui.ai/en/latest/models/xtts.html
- **gTTS**: https://github.com/pndurette/gTTS

### WebRTC Resources
- **MediaSoup**: https://mediasoup.org/documentation/v3/
- **WebRTC Basics**: https://webrtc.org/getting-started/overview

### Performance Optimization
- **Model Quantization**: https://huggingface.co/docs/transformers/main/quantization
- **ONNX Runtime**: https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html
- **CPU Optimization**: https://pytorch.org/tutorials/recipes/recipes/tuning_guide.html

---

## 🎯 Next Immediate Actions

**After completing security tasks above, start with**:

1. **Research and Design** (1-2 days)
   - Study faster-whisper API
   - Design STT service architecture
   - Plan audio chunking strategy

2. **Create STT Service** (2-3 days)
   - Setup development environment
   - Implement basic transcription
   - Add Docker container
   - Deploy to staging

3. **Test and Iterate** (1 day)
   - Test with real audio samples
   - Measure latency and accuracy
   - Optimize for CPU usage

---

## ❓ Questions to Resolve

Before starting Phase 3, clarify:

- [ ] **Language Support**: How many languages in MVP? (suggest: 2-3)
- [ ] **Audio Quality**: What bitrate/sample rate? (suggest: 16kHz, 16-bit)
- [ ] **Concurrent Users**: Target how many? (suggest: start with 2-4)
- [ ] **Voice Cloning**: Required for MVP? (suggest: skip for v1.0)
- [ ] **Fallback Strategy**: What if AI services down? (suggest: show original audio only)

---

**Ready to start Phase 3?** Reply with "bắt đầu phase 3" khi bạn đã hoàn thành security tasks và sẵn sàng!
