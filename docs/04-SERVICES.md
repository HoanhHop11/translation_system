# 04. Services Specification

**Version**: 2.0  
**Status**: 🔄 TODO  
**Last Updated**: 2025-01-04

---

## 📋 TODO

Tài liệu này sẽ bao gồm chi tiết từng service:

### 1. API Service (FastAPI)
- Endpoints specification
- Authentication flow
- Rate limiting
- Request/response schemas
- Error handling

### 2. WebRTC Gateway (MediaSoup)
- Worker configuration
- Room management
- Peer connection handling
- Signaling protocol

### 3. Transcription Service (faster-whisper)
- Model loading
- Audio streaming
- VAD integration
- Chunking strategy
- Performance tuning

### 4. Translation Service (NLLB-200)
- Model configuration
- Language pairs
- Batching
- Caching strategy

### 5. TTS Services
- **QuickTTS** (gTTS)
- **VoiceClonerAsync** (XTTS v2)
- **FallbackTTS** (pyttsx3)
- TTSOrchestrator routing logic

### 6. Background Jobs (Celery)
- Task definitions
- Queue configuration
- Priority handling
- Retry logic

### 7. Database (PostgreSQL)
- Schema design
- Migrations
- Indexing
- Backup strategy

### 8. Cache/Queue (Redis)
- Cache keys structure
- TTL policies
- Pub/Sub channels
- Eviction policies

### 9. Monitoring Stack
- Prometheus scrape configs
- Grafana dashboards
- Alerting rules
- Loki log aggregation

---

**Xem tạm**: `docs/01-ARCHITECTURE.md` phần Component Details
