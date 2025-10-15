# Kiến trúc Hệ thống - Videocall Dịch Thuật Real-time

**Version**: 2.0 (Revised based on Feasibility Study)  
**Last Updated**: 2025-10-04  
**Status**: ✅ Architecture validated with performance benchmarks

## 🎯 Tổng quan Kiến trúc

Hệ thống được thiết kế theo kiến trúc microservices với Docker Swarm orchestration, tối ưu hóa cho môi trường **CPU-only** (không có GPU).

### ⚠️ Key Changes từ Version 1.0
1. **Voice Cloning**: Chuyển từ real-time sang **async/premium** feature
2. **Diarization**: Từ always-on sang **optional** (opt-in)
3. **Latency Target**: Từ < 1s sang **1.3-1.5s** (realistic, validated)
4. **TTS Strategy**: **Tiered approach** (gTTS + XTTS async)
5. **Capacity**: **3-5 concurrent rooms** per instance (with scaling path)

### 📊 Performance Expectations (Validated)
- **STT Latency**: 500-800ms (faster-whisper small-int8, 7.8x realtime)
- **Translation**: 150-300ms (NLLB-200-600M-int8)
- **TTS (Quick)**: 200-300ms (gTTS)
- **TTS (Clone)**: 30s async (XTTS v2, premium only)
- **End-to-End**: 1.3-1.5s (text + quick audio)
- **Accuracy**: 85-95% STT, 85-90% translation

## Sơ đồ Kiến trúc Tổng thể (v2.0 - Revised)

```
┌─────────────────────────────────────────────────────────────────┐
│                         Load Balancer                            │
│                    (Traefik + Let's Encrypt)                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
        ┌─────────────┴─────────────┐
        │                           │
        ▼                           ▼
┌──────────────────┐        ┌──────────────────┐
│  Frontend (React)│        │   API Gateway    │
│  + WebSocket     │◄──────►│    (FastAPI)     │
│  + Next.js SSR   │        │   + Rate Limit   │
└──────────────────┘        └─────────┬────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
          ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
          │   WebRTC     │  │ Auth Service │  │Room Manager  │
          │   Gateway    │  │   + JWT      │  │  + Capacity  │
          │ (MediaSoup)  │  │              │  │   Tracking   │
          └──────┬───────┘  └──────────────┘  └──────┬───────┘
                 │                                    │
                 │          ┌─────────────────────────┤
                 │          │                         │
                 ▼          ▼                         ▼
          ┌──────────────────┐            ┌──────────────────┐
          │   Redis Queue    │            │   PostgreSQL     │
          │  (Message Bus)   │            │  + pgvector      │
          │  + Cache Layer   │◄──────────►│   (Metadata)     │
          └─────────┬────────┘            └──────────────────┘
                    │
      ┌─────────────┼─────────────┬─────────────┬──────────────┐
      │             │             │             │              │
      ▼             ▼             ▼             ▼              ▼
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────┐
│Transcribe│ │Translate │ │Quick TTS │ │Voice Cloning │ │Diarization│
│ Service  │ │ Service  │ │ Service  │ │   (Async)    │ │ (Optional)│
│(Whisper) │ │ (NLLB)   │ │  (gTTS)  │ │   (XTTS)     │ │(PyAnnote) │
│+ PhoW.   │ │+ Cache   │ │+ pyttsx3 │ │   Premium    │ │CPU-heavy │
└────┬─────┘ └────┬─────┘ └────┬─────┘ └──────┬───────┘ └────┬─────┘
     │            │            │               │              │
     └────────────┴────────────┴───────────────┴──────────────┘
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
          ┌──────────────────┐  ┌──────────────────┐
          │  Result Aggregator│  │  Celery Workers  │
          │    + WebSocket    │  │ (Background Jobs)│
          └──────────────────┘  └──────────────────┘
                    │
                    ▼
          ┌──────────────────┐
          │  Frontend Client │
          │ (Progressive UI) │
          │  Text → Audio    │
          │  → Voice Clone   │
          └──────────────────┘

┌─────────────────────────────────────────────────────────┐
│              Monitoring & Logging                       │
│  Prometheus + Grafana + ELK Stack (Lightweight)        │
│  + Custom Dashboards (Latency, Quality, Capacity)      │
└─────────────────────────────────────────────────────────┘
```

## Phân bổ Services trên Instances (v2.0 - Optimized)

### Instance 1: translation01 (8 vCPU, 16GB RAM) - Manager Node
**Vai trò**: Orchestration + STT + Translation + Data
```yaml
Services:
- Docker Swarm Manager
- PostgreSQL 15 + pgvector
  - CPU: 1 core
  - RAM: 2GB
  - Storage: 50GB
  
- Redis 7 (Queue + Cache)
  - CPU: 0.5 core
  - RAM: 2GB
  - Persistence: RDB + AOF
  
- Transcription Service (faster-whisper small-int8)
  - Replicas: 2
  - CPU: 2 cores per replica (40-60% utilization)
  - RAM: 2GB per replica (1.5GB model + overhead)
  - Models:
    - Primary: faster-whisper small-int8
    - Vietnamese: PhoWhisper-large (optional)
  - VAD: Silero (included)
  - Cache: Common phrases in Redis
  
- Translation Service (NLLB-200-distilled-600M-int8)
  - Replicas: 2
  - CPU: 1.5 cores per replica (30-50% utilization)
  - RAM: 2.5GB per replica (2GB model + overhead)
  - Features:
    - Batch processing (4-8 sentences)
    - Redis caching (30-40% hit rate)
    - Fallback: LibreTranslate API
  
Total Capacity:
  - 2-3 concurrent STT streams
  - 3-4 concurrent translation streams
  - Bottleneck: STT (CPU-intensive)
  - Expected rooms: 2-3 concurrent
```

### Instance 2: translation02 (8 vCPU, 16GB RAM) - Worker Node
**Vai trò**: WebRTC + Frontend + Quick TTS
```yaml
Services:
- Load Balancer (Traefik 2.x)
  - CPU: 0.5 core
  - RAM: 512MB
  - Features: Auto SSL, rate limiting
  
- API Gateway (FastAPI)
  - Replicas: 2
  - CPU: 1 core per replica
  - RAM: 1GB per replica
  - Features:
    - JWT authentication
    - Rate limiting (per user/IP)
    - Request validation
  
- WebRTC Gateway (MediaSoup 3.x)
  - Workers: 6 (1 per core, 2 cores reserved)
  - CPU: 6 cores total
  - RAM: 6GB total (1GB per worker)
  - Capacity:
    - ~500 consumers per worker
    - 6 workers × 500 = 3000 consumers
    - Realistic: ~2000 consumers
    - 4-person rooms: ~80 concurrent rooms
  - Features:
    - Simulcast (VP9, H264)
    - SVC support
    - Bandwidth estimation
  
- Frontend (React + Next.js 14)
  - Replicas: 2
  - CPU: 0.5 core per replica
  - RAM: 1GB per replica
  - SSR: Enabled
  - CDN: Cloudflare (optional)
  
- Quick TTS Service (gTTS + pyttsx3)
  - Replicas: 2
  - CPU: 0.5 core per replica
  - RAM: 512MB per replica
  - Latency: 200-300ms
  - Quality: Fair (acceptable)
  - Languages: 100+
  
Total Capacity:
  - WebRTC: 80+ concurrent rooms (bottleneck elsewhere)
  - TTS: Very fast, not a bottleneck
  - Expected: Limited by Instance 1 (STT/Translation)
```

### Instance 3: translation03 (4 vCPU, 8GB RAM) - Worker Node
**Vai trò**: Monitoring + Background Services
```yaml
Services:
- Prometheus (metrics collection)
  - CPU: 0.5 core
  - RAM: 1.5GB
  - Retention: 15 days
  - Scrape interval: 15s
  
- Grafana (visualization)
  - CPU: 0.5 core
  - RAM: 1GB
  - Dashboards:
    - Latency monitoring (p50, p95, p99)
    - Quality metrics (WER, BLEU)
    - Capacity tracking
    - Cost per request
  
- Elasticsearch (lightweight, single node)
  - CPU: 1 core
  - RAM: 2GB
  - Retention: 7 days
  
- Logstash
  - CPU: 0.5 core
  - RAM: 1GB
  
- Kibana
  - CPU: 0.5 core
  - RAM: 1GB
  
- Voice Cloning Service (XTTS v2) **ASYNC/PREMIUM**
  - Replicas: 1
  - CPU: 4 cores (100% when active)
  - RAM: 3GB
  - Processing time: 30-60s per request
  - Priority: Low (background job)
  - Queue: Celery + Redis
  - Features:
    - Pre-computed embeddings (cached)
    - Premium users only
    - Progressive enhancement
  
- Speaker Diarization Service (PyAnnote 3.1) **OPTIONAL**
  - Replicas: 1
  - CPU: 1 core
  - RAM: 2GB
  - Rate limit: 1 concurrent per instance
  - Processing: 3-5s for 30s audio
  - Default: OFF (user opt-in)
  - Pro/Enterprise only
  
Total Capacity:
  - Monitoring: Always-on
  - Voice Clone: 1-2 requests per minute (async)
  - Diarization: 1 concurrent request
  - Expected: Background/premium services
```

## Luồng Dữ liệu Chi tiết (v2.0 - With Tiered TTS)

### 1. User Join Room
```
User → Frontend → API Gateway → Auth Service (JWT verify)
                               ↓
                         Room Manager
                         - Check capacity (max 3-5 concurrent rooms)
                         - Create/join room
                         - Assign to MediaSoup worker
                               ↓
                         WebRTC Gateway (establish connection)
                         - Create transport
                         - Setup producers/consumers
                               ↓
                         Return WebRTC session info
                               ↓
                         User ← Frontend (WebRTC connected)
```

### 2. Real-time Translation Pipeline (Text Mode - Fastest)
```
Audio Stream (WebRTC) - Continuous
    ↓
WebRTC Gateway
- Receive audio chunks (PCM 16kHz)
- Buffer: 2-5 seconds (VAD-based)
    ↓
Redis Queue (pub/sub) → {audio_chunk, user_id, room_id, lang}
    ↓
Transcription Service (Priority: HIGH)
- VAD detection (Silero)
- Whisper small-int8 inference
- Confidence scoring
- Hallucination filtering
- Latency: 500-800ms
    ↓
Redis Cache Check (common phrases)
- Hit: Return cached translation (50ms)
- Miss: Continue to translation
    ↓
Translation Service (Priority: HIGH)
- NLLB-200-600M-int8
- Batch if multiple pending (4-8 sentences)
- Language pair optimization
- Latency: 150-300ms
    ↓
WebSocket Push → Frontend
- Display translated TEXT immediately
- Total latency: 400-900ms ✅
    ↓
User sees translated text (< 1s)
```

### 3. Audio Mode - Standard (gTTS)
```
[... Same as Text Mode until Translation ...]
    ↓
Translation Service → Result
    ↓
    ├─→ WebSocket Push (Text) → Frontend (immediate)
    │
    └─→ Quick TTS Service (Priority: MEDIUM)
        - gTTS synthesis
        - Language-specific voice
        - Latency: 200-300ms
        - Quality: Fair
          ↓
        Audio chunk (MP3/WAV)
          ↓
        WebSocket/WebRTC → Frontend
          ↓
        User hears audio (1.3-1.5s total) ✅
```

### 4. Voice Clone Mode - Premium (XTTS Async)
```
[... Same as Standard Mode ...]
    ↓
gTTS audio delivered (1.5s)
    ↓
Background Job (Priority: LOW, Celery)
    ├─→ Check: User is premium?
    ├─→ Check: Voice embedding exists?
    │   - No: Skip
    │   - Yes: Continue
    │
    └─→ Voice Cloning Service (Instance 3)
        - XTTS v2 inference
        - Use pre-computed embedding
        - CPU-intensive: 30-60s
        - Quality: Excellent
          ↓
        Cloned audio (WAV 24kHz)
          ↓
        Store in object storage/cache
          ↓
        WebSocket notification → Frontend
          ↓
        Frontend replaces audio seamlessly
        User hears cloned voice (30s after text) ⭐
```

### 5. Diarization Mode - Optional (Pro/Enterprise)
```
Audio Stream (WebRTC)
    ↓
    ├─→ [Standard Pipeline] → Quick results
    │
    └─→ Background: Diarization Service (if enabled)
        - Buffer: 30-60 seconds
        - PyAnnote 3.1 inference
        - Rate limit: 1 per instance
        - Latency: 3-5s per 30s audio
          ↓
        Speaker labels {speaker_id, start, end}
          ↓
        Associate with transcriptions
          ↓
        WebSocket update → Frontend
          ↓
        UI shows "Speaker 1:", "Speaker 2:", etc.
```
Transcription Service (Whisper)
    ├─ Input: 30-second audio chunks (16kHz, mono)
    ├─ Processing: faster-whisper với INT8 quantization
    ├─ Output: Text + timestamps + language + confidence
    └─ Latency target: <500ms
    ↓
Redis (temporary storage)
    ↓
    ├──→ Speaker Diarization Service (parallel)
    │    ├─ Identify speakers
    │    └─ Output: Speaker labels + timestamps
    │
    └──→ Translation Service
         ├─ Input: Transcribed text + detected language
         ├─ Context: User-uploaded documents (if available)
         ├─ Processing: NLLB-200 distilled model
         ├─ Output: Translated text in target language(s)
         └─ Latency target: <200ms
         ↓
    Result Aggregator
         ├─ Merge: transcription + diarization + translation
         ├─ Format: JSON với timestamps
         └─ Cache: Redis (cho voice cloning)
         ↓
    WebSocket → Frontend
         ↓
    Live Caption Display
         ├─ Original text (với speaker label)
         └─ Translated text (với speaker label)
```

### 3. Voice Cloning Pipeline
```
Voice Sample Collection
    ├─ Active: User uploads 10-30s sample
    └─ Passive: Auto-collect during conversation
    ↓
Voice Cloning Service (XTTS v2)
    ├─ Training: Extract voice embedding
    ├─ Storage: Redis cache (embedding)
    └─ Latency: 5-10s for initial training
    ↓
Translation Output
    ↓
Voice Synthesis
    ├─ Input: Translated text + voice embedding
    ├─ Processing: XTTS v2 inference
    ├─ Output: Synthesized audio (wav)
    └─ Latency target: <1s for 5s audio
    ↓
Audio Stream (WebRTC)
    ↓
User hears translated voice with original speaker's voice
```

### 4. Document Context Pipeline
```
User Upload Document
    ↓
API Gateway (file validation)
    ├─ Supported: PDF, DOCX, TXT
    └─ Max size: 10MB
    ↓
Document Processing Service
    ├─ Extract text
    ├─ Chunking (512 tokens)
    └─ Generate embeddings (sentence-transformers)
    ↓
PostgreSQL (vector storage via pgvector)
    ↓
Translation Service Query
    ├─ Semantic search for relevant chunks
    ├─ Use context for better translation
    └─ Improve domain-specific accuracy
```

## Component Details

### 1. WebRTC Gateway (MediaSoup)
**Lý do chọn**: CPU-friendly, scalable, mature
```javascript
Responsibilities:
- Manage peer connections
- Handle signaling
- Audio/video routing
- SFU (Selective Forwarding Unit) mode
- Bandwidth adaptation

Configuration:
- Workers: 6 per instance (1 per core, 2 cores reserved cho OS/overhead)
- Max rooms per worker: ~13 (500 consumers / ~40 per room)
- Max participants per room: 4-6 optimal, max 10
- Realistic concurrent rooms: 3-5 per instance (STT bottleneck)
- Audio codec: Opus
- Video codec: VP8/VP9
```

### 2. Transcription Service (faster-whisper)
**Lý do chọn**: 7.8x faster than realtime, CPU-optimized
```python
Model: whisper-small-int8
Quantization: INT8 (1477MB RAM, 5-8% WER)
VAD: silero-vad (Voice Activity Detection)
Languages: Auto-detect hoặc user-specified
Chunk size: 5 seconds (low-latency, không dùng 30s)
Overlap: 0.5 seconds (để tránh mất từ ở boundary)

Optimizations:
- Batch processing khi có thể
- Model caching in memory
- Pre-warming (load model at startup)
```

### 3. Translation Service (NLLB-200)
**Lý do chọn**: 200 languages, good quality, CPU-compatible
```python
Model: nllb-200-distilled-600M
Quantization: INT8
Cache: Redis (cho câu đã dịch)
Context window: 512 tokens
Supported languages: 200+

Optimizations:
- Sentence-level caching
- Batch translation
- Context injection từ documents
- Fallback: LibreTranslate API (self-hosted, free)
```

### 4. Voice Cloning Service (XTTS v2)
**Lý do chọn**: High quality, multilingual, CPU-compatible
```python
Model: XTTS v2
Voice sample: 10-30 seconds
Languages: 16 (including Vietnamese, English, Chinese)
Output: 22kHz audio

Optimizations:
- Voice embedding caching
- Lazy loading
- Pre-generated samples for common phrases
- Fallback: gTTS (Google Text-to-Speech)
```

### 5. Speaker Diarization (PyAnnote.audio)
**Lý do chọn**: State-of-the-art, Python-native
```python
Model: pyannote/speaker-diarization-3.1
Min speaker duration: 1 second
Max speakers: 10 per room
Embedding: speechbrain

Optimizations:
- Process in parallel với transcription
- Cache speaker embeddings
- Incremental diarization
```

## Scaling Strategy

### Horizontal Scaling Rules
```yaml
Transcription Service:
  min_replicas: 2
  max_replicas: 4
  scale_up_when: CPU > 80% hoặc queue depth > 10
  scale_down_when: CPU < 30% và queue depth < 3

Translation Service:
  min_replicas: 2
  max_replicas: 4
  scale_up_when: CPU > 75%
  scale_down_when: CPU < 25%

WebRTC Gateway:
  min_replicas: 2
  max_replicas: 6
  scale_up_when: Active rooms > 15
  scale_down_when: Active rooms < 5

API Gateway:
  min_replicas: 2
  max_replicas: 4
  scale_up_when: Request latency > 200ms
  scale_down_when: Request latency < 50ms
```

### Load Balancing
```
Traefik Configuration:
- Algorithm: Round-robin với sticky sessions
- Health checks: Every 10s
- Timeout: 30s
- Max connections per backend: 100
```

## High Availability

### Data Replication
```yaml
PostgreSQL:
  mode: Single instance với automated backups
  backup: Daily to Google Cloud Storage
  retention: 7 days

Redis:
  mode: Master-replica (nếu có thể)
  persistence: RDB + AOF
  backup: Hourly snapshots
```

### Service Recovery
```yaml
Restart Policy:
  condition: on-failure
  delay: 5s
  max_attempts: 3
  window: 120s

Health Checks:
  interval: 30s
  timeout: 10s
  retries: 3
```

## Security Architecture

### Network Security
```yaml
Layers:
1. Google Cloud Firewall
   - Chỉ mở ports: 80, 443, 22
   - Whitelist IPs cho SSH

2. Docker Network
   - Overlay network cho services
   - Isolated networks per service group

3. Service-to-Service
   - mTLS cho internal communication
   - API keys cho service authentication
```

### Data Security
```yaml
Encryption:
- In-transit: TLS 1.3
- At-rest: Disk encryption (Google Cloud)
- WebRTC: DTLS-SRTP

Authentication:
- Users: JWT tokens
- Services: API keys + mTLS
- Admin: SSH keys only

Secrets Management:
- Docker secrets
- Environment variables (non-sensitive)
- Vault (nếu scale lớn)
```

## Performance Targets (v2.0 - Validated & Realistic)

```yaml
Latency (Based on Benchmarks):
  # STT Service
  - Audio transcription (Whisper small-int8): 500-800ms
    - Faster-whisper: 7.8x realtime
    - VAD detection: included
    - Confidence scoring: enabled
  
  # Translation Service  
  - Translation (NLLB-200-600M-int8): 150-300ms
    - Batch processing: 4-8 sentences
    - Cache hit (Redis): 50ms
    - Cache miss: 200-300ms
  
  # TTS Services
  - Quick TTS (gTTS): 200-300ms
    - Quality: Fair (acceptable)
    - All users: FREE
  - Voice Clone (XTTS v2): 30-60s (ASYNC)
    - Quality: Excellent
    - Premium users only
    - Background processing
  
  # End-to-End (Composite)
  - Text mode: 400-900ms (STT + Translation)
    - p50: 650ms
    - p95: 900ms
    - p99: 1200ms
  
  - Audio mode (gTTS): 1.3-1.5s (Text + TTS)
    - p50: 1.3s
    - p95: 1.5s
    - p99: 2.0s
  
  - Voice clone: 30-60s after text display
    - Progressive enhancement
    - Non-blocking
  
  # Network
  - WebRTC connection setup: <3s
  - WebRTC media latency: 200-500ms (glass-to-glass)

Throughput (Per Instance & Cluster):
  # Instance 1 (STT/Translation)
  - Concurrent STT streams: 2-3
  - Concurrent translation streams: 3-4
  - Bottleneck: STT processing
  - Max rooms: 2-3 concurrent (4-6 person rooms)
  
  # Instance 2 (WebRTC)
  - MediaSoup workers: 6
  - Consumers per worker: ~500
  - Total consumers: 2000-3000
  - Max rooms: 80+ (limited by Instance 1)
  
  # Cluster Total (3 Instances)
  - Concurrent rooms: 3-5 (MVP)
  - Users per room: 4-6 (optimal), max 10
  - Total concurrent users: 15-50
  - Scaling path: Add instances for more rooms

Quality (Validated from Research):
  # Transcription
  - WER (English): 5-8% (Whisper small)
  - WER (Vietnamese): 9-15% (with PhoWhisper)
  - WER (Multilingual): 8-12% (average)
  - Hallucination rate: <5% (with VAD + filtering)
  
  # Translation
  - BLEU score (high-resource pairs): 30-40
    - EN ↔ ES, FR, DE, ZH: Excellent
  - BLEU score (medium-resource): 25-30
    - EN ↔ VI, JA, KO: Good
  - BLEU score (low-resource): 20-25
    - Less common pairs: Fair
  - Accuracy: 85-90% (high-resource), 75-85% (low-resource)
  
  # Voice Synthesis
  - gTTS MOS: 3.0-3.5 (Fair, robotic)
  - XTTS MOS: 4.0-4.5 (Excellent, natural)
  - Voice similarity (XTTS): >80%
  
  # WebRTC
  - Packet loss: <1% (in good network)
  - Video quality: 720p @ 30fps (adaptive)
  - Audio quality: 48kHz stereo

Availability:
  - Target uptime: 99.5% (43 minutes downtime/month)
  - Graceful degradation:
    - XTTS down → fallback to gTTS
    - NLLB down → fallback to LibreTranslate
    - Diarization down → continue without speaker labels
  - Health checks: Every 10s
  - Auto-restart: On failure
```

## User Tier Model (v2.0 - Progressive Enhancement)

### Free Tier (Text + Quick Audio)
```yaml
Features:
  - Multi-party video call (4-6 users)
  - Real-time transcription (Whisper small)
  - Text translation (NLLB-200)
  - Quick TTS audio (gTTS)
  - 10+ language pairs
  - Basic UI

Performance:
  - Text latency: 400-900ms
  - Audio latency: 1.3-1.5s
  - Quality: Good (85-90% accuracy)
  - TTS voice: Robotic but clear

Limits:
  - Room duration: 60 minutes
  - Participants: Max 6 per room
  - Concurrent rooms: 2 per user
  - Storage: 7 days history
  - Rate limit: 100 requests/hour

Cost to Serve:
  - CPU: Medium (STT + Translation)
  - Bandwidth: Low
  - Storage: Minimal
  → Sustainable at scale
```

### Premium Tier ($5-10/month) - Voice Clone
```yaml
Features:
  - All Free Tier features
  - Voice cloning (XTTS v2 async)
  - Pre-computed embeddings
  - Progressive audio enhancement
  - Voice sample management
  - Priority queue

Performance:
  - Text latency: 400-900ms (same as free)
  - Quick audio: 1.3-1.5s (same as free)
  - Clone audio: +30s background processing
  - Quality: Excellent (natural voice)
  - TTS voice: Cloned, natural

Limits:
  - Room duration: 180 minutes
  - Participants: Max 10 per room
  - Concurrent rooms: 5 per user
  - Storage: 30 days history
  - Voice samples: 5 per user
  - Rate limit: 500 requests/hour

Cost to Serve:
  - CPU: High (+ XTTS processing)
  - Bandwidth: Medium
  - Storage: Medium (voice embeddings)
  → Need 8-10 premium users to cover 1 instance cost
```

### Pro Tier ($15-20/month) - Full Features
```yaml
Features:
  - All Premium Tier features
  - Speaker diarization (PyAnnote)
  - Document context (RAG)
  - Advanced analytics
  - API access
  - Custom vocabulary
  - Team management

Performance:
  - All latencies same as Premium
  - Diarization: +3-5s (optional processing)
  - Speaker labels: Real-time updates
  - Quality: Excellent across all features

Limits:
  - Room duration: Unlimited
  - Participants: Max 20 per room
  - Concurrent rooms: 10 per user
  - Storage: 90 days history
  - Voice samples: Unlimited
  - Custom vocabulary: 1000 terms
  - Rate limit: 2000 requests/hour

Cost to Serve:
  - CPU: Very High (all features)
  - Bandwidth: High
  - Storage: High
  → Need 3-5 pro users to cover 1 instance cost
```

### Enterprise Tier (Custom Pricing)
```yaml
Features:
  - All Pro Tier features
  - Dedicated instances
  - Custom model fine-tuning
  - On-premise deployment option
  - SLA guarantee (99.9%)
  - Priority support
  - Custom integrations

Performance:
  - Guaranteed resources
  - No rate limits
  - Custom latency targets

Limits:
  - Fully customizable

Cost Model:
  - Base: $500-1000/month
  - + Per-user pricing
  - + Custom features pricing
```

## Scaling Strategy (v2.0 - Horizontal + Vertical)

### Phase 1: MVP (Month 1-3) - Current Architecture
```yaml
Infrastructure:
  - 3 instances (as designed)
  - Total cost: ~$600/month
  
Capacity:
  - 3-5 concurrent rooms
  - 15-30 concurrent users
  - 100-200 registered users
  
Bottleneck:
  - Instance 1 (STT/Translation)
  
Scaling Trigger:
  - CPU > 80% sustained
  - Queue depth > 10
  - Latency p95 > 2s
```

### Phase 2: Early Growth (Month 4-6)
```yaml
Scaling Action:
  - Add Instance 4: Clone of Instance 1
    - Cost: +$175/month
    - Capacity: +3-5 rooms
  
New Capacity:
  - 6-10 concurrent rooms
  - 30-60 concurrent users
  - 500-1000 registered users
  
Load Balancing:
  - Round-robin for STT/Translation
  - Affinity-based for rooms
  
Total Cost: ~$775/month
Revenue Target: 50 premium + 10 pro users = $350/month
Burn Rate: -$425/month (acceptable for growth)
```

### Phase 3: Optimization (Month 7-12)
```yaml
Infrastructure Optimization:
  - Implement intelligent batching
  - Add Redis Cluster (3 nodes)
  - Optimize model loading
  - Add CDN for frontend
  
Performance Improvements:
  - Cache hit rate: 20% → 40%
  - Batch efficiency: +30%
  - Latency reduction: 1.5s → 1.2s
  
Capacity Increase (without new instances):
  - 8-12 concurrent rooms (from 6-10)
  - 40-80 concurrent users
  
Cost Impact: +$50/month (Redis cluster)
Total Cost: ~$825/month
Revenue Target: 100 premium + 20 pro users = $800/month
Status: Near breakeven
```

### Phase 4: Scale Out (Month 13-18)
```yaml
Scaling Strategy:
  - Regional deployment (US, EU, Asia)
  - Each region: 3-4 instances
  - Global load balancer
  
Total Infrastructure:
  - 9-12 instances globally
  - Cost: ~$2000-2500/month
  
Capacity:
  - 30-50 concurrent rooms globally
  - 150-300 concurrent users
  - 5000-10000 registered users
  
Revenue Model:
  - 500 premium ($5) = $2500/month
  - 100 pro ($15) = $1500/month
  - Total: $4000/month
  
Profit: $1500-2000/month (sustainable)
```

### Phase 5: Enterprise (Month 18+)
```yaml
Infrastructure:
  - Kubernetes migration (from Swarm)
  - Multi-cloud (GCP + AWS)
  - Dedicated clusters for enterprise
  
Features:
  - Custom model fine-tuning
  - Private instances
  - Advanced analytics
  
Capacity: Unlimited (on-demand scaling)

Revenue Model:
  - 10 enterprise clients @ $1000 = $10,000/month
  - 1000 premium users = $5,000/month
  - 200 pro users = $3,000/month
  - Total: $18,000/month
  
Cost: ~$8,000/month (infrastructure + team)
Profit: $10,000/month (healthy business)
```

## Cost Optimization (v2.0 - Detailed)

### Model Optimization
```yaml
- Quantization: INT8 cho tất cả models
- Model pruning: Nếu có thể
- Lazy loading: Load models chỉ khi cần
- Sharing: Share models giữa replicas (read-only)
```

### Resource Optimization
```yaml
- CPU pinning: Pin services to specific cores
- Memory limits: Strict limits để tránh OOM
- Swap: Disable (để performance predictable)
- Disk I/O: Use tmpfs cho temporary files
```

### Free Services Usage
```yaml
- Models: Hugging Face (free)
- Container Registry: Docker Hub (free tier)
- Monitoring: Prometheus + Grafana (self-hosted)
- Logging: ELK Stack (self-hosted, lightweight)
- Backups: Google Cloud Storage (free tier)
```

## Disaster Recovery

### Backup Strategy
```yaml
Database:
  frequency: Daily full + hourly incremental
  retention: 7 days
  location: Google Cloud Storage

Models:
  storage: Shared volume + backup to GCS
  version control: Git LFS cho model files

Configurations:
  storage: Git repository
  automation: GitOps workflow
```

### Recovery Procedures
```yaml
Service Failure:
  1. Docker Swarm auto-restart (3 attempts)
  2. Alert to monitoring
  3. Manual intervention if needed

Node Failure:
  1. Swarm reschedules containers to healthy nodes
  2. Alert to monitoring
  3. Investigate root cause

Data Loss:
  1. Restore from latest backup
  2. Replay logs if available
  3. Notify affected users
```

## Monitoring Architecture

### Metrics Collection
```yaml
System Metrics:
- CPU, Memory, Disk, Network per node
- Docker metrics per container

Application Metrics:
- Request rate, latency, error rate
- Queue depth, processing time
- Model inference time
- WebRTC quality metrics

Business Metrics:
- Active users, rooms
- Translation accuracy feedback
- Voice cloning usage
```

### Alerting Rules
```yaml
Critical:
- Service down >5 minutes
- CPU >95% for >10 minutes
- Memory >90% for >5 minutes
- Disk >95%
- Error rate >5%
- End-to-end latency >3s (p95)

Warning:
- CPU >80% for >5 minutes
- Memory >80% for >5 minutes
- Latency >2x target (p95)
- Queue depth >10 sustained
- Cache hit rate <20%
- Model inference time >1s
```

## Summary: Architecture v2.0 Changes

### What Changed from v1.0

| Aspect | v1.0 (Original) | v2.0 (Revised) | Reason |
|--------|-----------------|----------------|--------|
| **Voice Cloning** | Real-time (1s) | Async (30s) | CPU can't do real-time |
| **TTS Strategy** | XTTS only | gTTS + XTTS | Need fast fallback |
| **Diarization** | Always-on | Optional | CPU-intensive, opt-in better |
| **Latency Target** | <1s | 1.3-1.5s | Realistic based on benchmarks |
| **Concurrent Rooms** | 10+ | 3-5 (scaling) | Instance 1 bottleneck |
| **User Model** | Single tier | Tiered (Free/Premium/Pro) | Match cost with value |
| **Scaling Plan** | Undefined | 5-phase roadmap | Clear growth path |

### Key Validations from Feasibility Study

1. ✅ **Whisper Performance**: 7.8x realtime (small-int8) - VALIDATED
2. ✅ **NLLB Translation**: 44% better than alternatives - VALIDATED  
3. ✅ **MediaSoup Scale**: 400-600 concurrent users - VALIDATED
4. ⚠️ **XTTS Latency**: 30-60s on CPU - ADJUSTED to async
5. ⚠️ **PyAnnote CPU**: High usage - ADJUSTED to optional
6. ✅ **End-to-End**: 1.5s comparable to SOTA research - ACCEPTABLE

### Architecture Principles (Unchanged)

- ✅ **Microservices**: Independent, scalable services
- ✅ **CPU-only**: No GPU dependency (cost optimization)
- ✅ **Free/Open-source**: All core technologies free
- ✅ **Docker Swarm**: Simple orchestration (vs Kubernetes)
- ✅ **Graceful degradation**: Fallbacks for every critical service
- ✅ **Progressive enhancement**: Better experience for paying users

### Risk Mitigation

| Risk | Mitigation | Status |
|------|------------|--------|
| CPU overload | Auto-scaling, queue system, rate limiting | ✅ Planned |
| High latency | Tiered approach, caching, batching | ✅ Implemented |
| Voice clone slow | Make it async/premium, use gTTS fallback | ✅ Adjusted |
| Low capacity | Start small, scale horizontally | ✅ Planned |
| Cost overrun | Tiered pricing, optimize before scaling | ✅ Calculated |

### Success Metrics (Revised)

```yaml
MVP Success (Month 3):
  Technical:
    - 99.5% uptime
    - 1.5s average latency (audio mode)
    - 85%+ transcription accuracy
    - 3-5 concurrent rooms
  
  Business:
    - 100+ registered users
    - 20+ daily active users
    - 5+ paying users (premium/pro)
    - <$100/month burn rate

Growth Success (Month 12):
  Technical:
    - 99.7% uptime
    - 1.2s average latency (optimized)
    - 90%+ transcription accuracy
    - 20+ concurrent rooms
  
  Business:
    - 1000+ registered users
    - 200+ daily active users
    - 100+ paying users
    - Breakeven or profitable

Scale Success (Month 24):
  Technical:
    - 99.9% uptime
    - <1s average latency (with improvements)
    - 95%+ transcription accuracy
    - 50+ concurrent rooms globally
  
  Business:
    - 10,000+ registered users
    - 1000+ daily active users
    - 500+ paying users
    - $10,000+/month profit
```

## Next Steps

**Immediate Actions:**
1. ✅ Review this revised architecture
2. ⚠️ Fill [00-REQUIRED-INFO.md](./00-REQUIRED-INFO.md) with real credentials
3. 📋 Read [12-FEASIBILITY-ANALYSIS.md](./12-FEASIBILITY-ANALYSIS.md) for details
4. 🚀 Begin Phase 1: Infrastructure Setup

**Related Documents:**
- [02-SETUP-GUIDE.md](./02-SETUP-GUIDE.md) - Hướng dẫn cài đặt chi tiết
- [03-DOCKER-SWARM.md](./03-DOCKER-SWARM.md) - Docker Swarm configuration
- [04-SERVICES.md](./04-SERVICES.md) - Service specifications
- [05-AI-MODELS.md](./05-AI-MODELS.md) - AI model configurations
- [11-ROADMAP.md](./11-ROADMAP.md) - 21-week development roadmap
- [12-FEASIBILITY-ANALYSIS.md](./12-FEASIBILITY-ANALYSIS.md) - ⭐ Feasibility study
- [FEASIBILITY-SUMMARY.md](./FEASIBILITY-SUMMARY.md) - ⭐ Quick summary

---

**Document Version**: 2.0 (Revised based on Feasibility Study)  
**Last Updated**: 2025-10-04  
**Status**: ✅ Validated and ready for implementation
