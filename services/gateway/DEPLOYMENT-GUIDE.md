# 🚀 Gateway Service - Deployment Guide

## 📋 Tổng Quan

Gateway Service là **MediaSoup SFU (Selective Forwarding Unit)** cho video conferencing với:
- ✅ **LIVE STREAMING mode** - Audio streaming tự động cho STT (KHÔNG CẦN BẤM NÚT)
- ✅ **Low-latency** - <200ms audio tap, <500ms E2E transcription
- ✅ **Production-ready** - Worker pool, auto-restart, Redis coordination
- ✅ **Scalable** - 2 replicas, CPU-optimized cho c2d-highcpu-8
- ✅ **STREAMING ARCHITECTURE** - Tất cả luồng là streaming, không có mock/demo

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────────────────────┐
│                     STREAMING FLOW                              │
└────────────────────────────────────────────────────────────────┘

Client Browser                Gateway (translation02)           Backend Services
      │                              │                                  │
      ├─► WebSocket Connect ────────►│                                  │
      │   (Socket.IO signaling)      │                                  │
      │                              │                                  │
      │◄── join-room ────────────────┤                                  │
      │                              │                                  │
      ├─► create-webrtc-transport ──►│                                  │
      │                              │                                  │
      │◄── ICE/DTLS params ──────────┤                                  │
      │                              │                                  │
      ├══► produce (audio/video) ═══►│                                  │
      │   ║ RTP STREAMING             │                                  │
      │   ║ (continuous)              │                                  │
      │   ║                           │──► Audio Tap (automatic)          │
      │   ║                           │         │                        │
      │   ║                           │         └──► Convert to PCM      │
      │   ║                           │                   │              │
      │   ║                           │                   └──► Stream ──►│ STT Service
      │   ║                           │                                  │ (faster-whisper)
      │   ║                           │                                  │      │
      │   ║                           │◄────────────── transcription ────┤      │
      │   ║                           │                                  │      │
      │◄══╬═══════════════════════════┤                                  │      │
      │   ║ Forward to other clients  │                                  │      │
      │   ║ (SFU routing)             │                                  │      │
```

---

## 📦 Pre-deployment Steps

### 1. Build Docker Image

```bash
# Navigate to gateway directory
cd services/gateway

# Install dependencies
npm install

# Build TypeScript
npm run build

# Build Docker image
docker build -t jackboun11/jbcalling-gateway:1.0.0 .

# Test locally (optional)
docker run -p 3000:3000 \
  -e ANNOUNCED_IP=127.0.0.1 \
  -e REDIS_HOST=localhost \
  jackboun11/jbcalling-gateway:1.0.0

# Push to Docker Hub
docker push jackboun11/jbcalling-gateway:1.0.0
```

### 2. Verify Infrastructure

```bash
# Check firewall rules (should be already done)
gcloud compute firewall-rules list | grep webrtc

# Should see:
# - allow-webrtc-udp: udp:40000-40100
# - allow-webrtc-tcp: tcp:40000-40100

# Check translation02 resources
ssh translation01 "docker node ls"
# translation02 should be Ready/Active
```

### 3. Update Environment Variables

Create `.env` file với:

```bash
# Domain
DOMAIN=jbcalling.site
WEBRTC_DOMAIN=webrtc.jbcalling.site

# Redis
REDIS_PASSWORD=your_secure_redis_password_here

# Other existing vars...
```

---

## 🚀 Deployment

### Option 1: Deploy Full Stack (Recommended)

```bash
# Deploy toàn bộ stack including gateway
cd infrastructure/swarm
docker stack deploy -c stack-with-ssl.yml translation

# Check gateway service
docker service ls | grep gateway
docker service logs translation_gateway -f
```

### Option 2: Deploy Only Gateway (Update)

```bash
# Update chỉ gateway service
docker service update \
  --image jackboun11/jbcalling-gateway:1.0.0 \
  translation_gateway

# Monitor rollout
watch docker service ps translation_gateway
```

---

## ✅ Verification

### 1. Check Service Status

```bash
# Service running
docker service ps translation_gateway

# Should see 2 replicas RUNNING on translation02

# Logs
docker service logs translation_gateway --tail 100

# Should see:
# ✅ Gateway Service started on 0.0.0.0:3000
# ✅ WorkerManager initialized với X workers
# ✅ RoomManager initialized
# ✅ AudioProcessor initialized
# ✅ SignalingServer initialized
```

### 2. Health Check

```bash
# Direct health check
curl http://webrtc.jbcalling.site/health

# Should return:
{
  "status": "healthy",
  "timestamp": "2025-10-14T...",
  "uptime": 123.45,
  "workers": { "totalWorkers": 4, ... },
  "rooms": { "totalRooms": 0, ... },
  "audioStreaming": { "activeStreams": 0, ... }
}
```

### 3. WebSocket Connection Test

```bash
# Test WebSocket endpoint
websocat wss://webrtc.jbcalling.site/socket.io/?EIO=4&transport=websocket

# Should receive:
# 0{"socketId":"..."}  (connected event)
```

### 4. Metrics Check

```bash
# Prometheus metrics
curl http://webrtc.jbcalling.site/metrics

# Should see:
# gateway_workers_total 4
# gateway_rooms_total 0
# gateway_audio_streams_total 0
```

---

## 🔧 Configuration

### MediaSoup Workers

Gateway tự động tạo worker pool theo CPU count:

```typescript
// For translation02 (c2d-highcpu-8 = 8 cores)
numWorkers = Math.max(1, os.cpus().length - 1) = 7 workers

// Set explicit count via env:
WORKER_COUNT=4  // Recommended for c2d-highcpu-8
```

### RTC Port Range

```yaml
RTC_MIN_PORT=40000
RTC_MAX_PORT=40100
# Total: 101 ports
# Per worker: ~14-25 ports (depending on worker count)
```

### Audio Streaming Settings

```yaml
ENABLE_AUDIO_PROCESSING=true
AUDIO_SAMPLE_RATE=48000    # MediaSoup default
AUDIO_CHANNELS=1            # Mono cho STT
```

---

## 📊 Monitoring

### Prometheus Metrics

Gateway exposes `/metrics` endpoint với:

```
gateway_workers_total          # Total MediaSoup workers
gateway_rooms_total            # Active rooms
gateway_audio_streams_total    # Active audio streams to STT
```

Add to Prometheus `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: 'gateway'
    static_configs:
      - targets: ['gateway:3000']
```

### Grafana Dashboard

Key metrics to monitor:

- **Worker Health**: All workers alive, no "died" events
- **Room Count**: Active video call sessions
- **Audio Streaming**: Participants with audio streaming to STT
- **Latency**: Audio tap to STT response time (<200ms target)
- **CPU Usage**: Should stay <80% under load
- **Memory Usage**: Should stay <3GB (4GB limit)

---

## 🐛 Troubleshooting

### Issue 1: WebRTC Connection Failed

**Symptoms:**
- ICE connection timeout
- Cannot produce/consume media

**Solutions:**

```bash
# 1. Check announced IP
docker service inspect translation_gateway | grep ANNOUNCED_IP
# Should be: 34.142.190.250

# 2. Verify firewall rules
gcloud compute firewall-rules list | grep webrtc

# 3. Test UDP connectivity
nc -u -z 34.142.190.250 40000
```

### Issue 2: Audio Streaming Not Working

**Symptoms:**
- No transcriptions received
- AudioProcessor errors in logs

**Solutions:**

```bash
# 1. Check STT service connectivity
docker service logs translation_gateway | grep STT

# 2. Verify STT service is running
docker service ps translation_stt

# 3. Test STT endpoint
curl http://stt:8001/health
```

### Issue 3: Worker Died

**Symptoms:**
- "Worker died unexpectedly" in logs
- Service degradation

**Solutions:**

```bash
# 1. Check worker logs
docker service logs translation_gateway | grep "Worker #"

# 2. Check resource limits
docker service ps translation_gateway
# Verify no OOMKilled status

# 3. Increase memory if needed
docker service update \
  --limit-memory 6G \
  translation_gateway
```

### Issue 4: High CPU Usage

**Solutions:**

```bash
# 1. Reduce worker count
docker service update \
  --env-add WORKER_COUNT=3 \
  translation_gateway

# 2. Check for room leaks
curl http://webrtc.jbcalling.site/stats
# Verify rooms close properly

# 3. Scale horizontally
docker service scale translation_gateway=3
```

---

## 🔐 Security Checklist

- ✅ DTLS-SRTP enabled (MediaSoup default)
- ✅ WebSocket over HTTPS (via Traefik)
- ✅ Redis authentication (REDIS_PASSWORD)
- ✅ CORS restricted to specific domains
- ✅ Firewall rules limited to necessary ports
- ✅ No plaintext credentials in logs
- ✅ Health endpoint doesn't expose sensitive data

---

## 📈 Performance Tuning

### Low-Latency Optimization

```typescript
// Audio buffer size (in AudioProcessor.ts)
BUFFER_SIZE_MS = 100  // 100ms chunks (default)
// Lower = less latency, higher CPU
// Higher = more latency, lower CPU

// Socket.IO settings
pingInterval: 10000    // 10s (default)
pingTimeout: 20000     // 20s (default)
```

### Scale Guidelines

| Concurrent Calls | Workers | Replicas | CPU per Replica | Memory per Replica |
|------------------|---------|----------|-----------------|-------------------|
| 10-20            | 4       | 2        | 2 cores         | 4GB               |
| 20-40            | 6       | 2        | 3 cores         | 6GB               |
| 40-60            | 8       | 3        | 4 cores         | 8GB               |

---

## 📝 Next Steps

1. ✅ **Test End-to-End Flow**:
   - Create room
   - Join with 2+ clients
   - Start audio/video
   - Verify transcriptions appear

2. ✅ **Load Testing**:
   ```bash
   # Use k6 or Artillery for load testing
   k6 run tests/load-test-gateway.js
   ```

3. ✅ **Setup Monitoring Alerts**:
   - Worker died
   - High CPU (>90%)
   - High memory (>3.5GB)
   - STT service unavailable

4. ✅ **Frontend Integration**:
   - Update WebSocket endpoint to `wss://webrtc.jbcalling.site`
   - Implement MediaSoup client
   - Display real-time captions

---

## 📞 Support

**Logs Location:**
- Gateway: `docker service logs translation_gateway`
- Traefik: `docker service logs translation_traefik`
- STT: `docker service logs translation_stt`

**Common Commands:**
```bash
# Restart gateway
docker service update --force translation_gateway

# Scale up
docker service scale translation_gateway=3

# Update image
docker service update --image jackboun11/jbcalling-gateway:1.0.1 translation_gateway

# Rollback
docker service rollback translation_gateway
```

---

**Status:** ✅ Production Ready
**Version:** 1.0.0
**Last Updated:** October 14, 2025
