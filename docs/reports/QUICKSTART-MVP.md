# 🚀 QUICK START GUIDE - MVP với 4 vCPU Instances

**Date**: Oct 4, 2025  
**Status**: Ready for Phase 1  
**Target**: 1 room, 4-6 users

---

## ⚠️ ĐỌC ĐẦU TIÊN - QUAN TRỌNG!

Cấu hình instances thực tế **KHÁC** so với docs gốc:

| Instance | Docs Gốc | Thực Tế | Impact |
|----------|----------|---------|--------|
| translation01 | 8 vCPU, 16GB | **4 vCPU, 15GB** | Chỉ 1 room |
| translation02 | 8 vCPU, 16GB | **4 vCPU, 16GB** | 2 workers |
| translation03 | 4 vCPU, 8GB | **4 vCPU, 8GB** | OK |

**MVP Target:**
- ✅ 1 concurrent room (an toàn)
- ✅ 4-6 users per room
- ✅ Text captions + gTTS audio
- ❌ Voice cloning (Phase 5)
- ❌ Diarization (Phase 6)

---

## 📝 Bước 1: Chuẩn Bị (10 phút)

### 1.1. Copy .env file

```bash
cd /home/hopboy2003/jbcalling_translation_realtime
cp .env.example .env
```

### 1.2. Điền thông tin vào `.env`

File đã được pre-fill với IPs thực:
- ✅ `INSTANCE_01_IP=34.143.235.114`
- ✅ `INSTANCE_02_IP=34.142.190.250`
- ⚠️ `INSTANCE_03_IP=` **CẦN ĐIỀN**

**Các trường BẮT BUỘC còn lại:**

```bash
# Generate secrets
openssl rand -hex 32  # JWT_SECRET_KEY
openssl rand -hex 32  # SESSION_SECRET_KEY
openssl rand -hex 32  # ENCRYPTION_KEY

# Passwords
POSTGRES_PASSWORD=     # Min 16 chars, mixed
REDIS_PASSWORD=        # Min 16 chars, mixed
GRAFANA_ADMIN_PASSWORD=# Min 12 chars, mixed

# Hugging Face (https://huggingface.co/settings/tokens)
HF_TOKEN=              # Read permission đủ
```

### 1.3. Verify `.env`

```bash
# Check required fields
grep -E "INSTANCE_|PASSWORD|SECRET|HF_TOKEN" .env | grep -v "^#"

# Should see all filled (no empty values)
```

---

## 🔧 Bước 2: Setup Instance 1 (Manager) - 30 phút

SSH vào translation01:

```bash
# Local machine
gcloud compute ssh translation01 --zone=asia-southeast1-a
```

### 2.1. Update system

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget htop
```

### 2.2. Install Docker

```bash
# Install Docker Engine
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Logout & login lại để apply group
exit
# SSH lại
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Verify
docker --version
# Expected: Docker version 24.x or 25.x
```

### 2.3. Clone repository

```bash
cd ~
git clone <YOUR_REPO_URL> jbcalling
cd jbcalling

# Copy .env file từ local (hoặc tạo mới)
nano .env
# Paste nội dung .env đã điền ở Bước 1
```

### 2.4. Download AI Models (⏳ 20-30 phút)

```bash
# Create models directory
mkdir -p models/whisper models/nllb

# Set HF_TOKEN
export HF_TOKEN="hf_xxxxxxxxxxxxx"  # Từ .env

# Download Whisper small-int8 (1.5GB)
docker run --rm -it \
  -v $(pwd)/models:/models \
  -e HF_TOKEN=${HF_TOKEN} \
  python:3.11-slim bash -c "
  pip install huggingface-hub && \
  python -c 'from huggingface_hub import snapshot_download; \
  snapshot_download(\"Systran/faster-whisper-small\", local_dir=\"/models/whisper\", cache_dir=\"/tmp\")'
  "

# Download NLLB-200-distilled (2.5GB)
docker run --rm -it \
  -v $(pwd)/models:/models \
  -e HF_TOKEN=${HF_TOKEN} \
  python:3.11-slim bash -c "
  pip install huggingface-hub && \
  python -c 'from huggingface_hub import snapshot_download; \
  snapshot_download(\"facebook/nllb-200-distilled-600M\", local_dir=\"/models/nllb\", cache_dir=\"/tmp\")'
  "

# Verify
ls -lh models/whisper/
ls -lh models/nllb/
```

### 2.5. Initialize Docker Swarm

```bash
# Get internal IP
INTERNAL_IP=$(hostname -I | awk '{print $1}')
echo "Internal IP: $INTERNAL_IP"
# Expected: 10.148.0.5

# Init Swarm
docker swarm init --advertise-addr ${INTERNAL_IP}

# Save join tokens (sẽ dùng cho instances 2 & 3)
docker swarm join-token worker
# Copy output command, ví dụ:
# docker swarm join --token SWMTKN-1-xxx... 10.148.0.5:2377
```

---

## 🔧 Bước 3: Setup Instance 2 (Worker) - 15 phút

SSH vào translation02:

```bash
# Local machine
gcloud compute ssh translation02 --zone=asia-southeast1-b
```

### 3.1. Install Docker (same as Instance 1)

```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Logout & login
exit
gcloud compute ssh translation02 --zone=asia-southeast1-b

# Verify
docker --version
```

### 3.2. Join Swarm

```bash
# Use command from Instance 1 (Step 2.5)
docker swarm join --token SWMTKN-1-xxx... 10.148.0.5:2377
```

### 3.3. Configure Firewall (WebRTC ports)

```bash
# On local machine
gcloud compute firewall-rules create mediasoup-rtc \
  --allow=udp:40000-49999 \
  --target-tags=http-server \
  --source-ranges=0.0.0.0/0 \
  --description="MediaSoup RTC ports"

# Verify
gcloud compute firewall-rules list | grep mediasoup
```

---

## 🔧 Bước 4: Setup Instance 3 (Worker) - 15 phút

SSH vào translation03:

```bash
gcloud compute ssh translation03 --zone=<ZONE_OF_INSTANCE_03>
```

### 4.1. Install Docker & Join Swarm

```bash
# Same as Instance 2
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
exit

# Login lại và join
gcloud compute ssh translation03 --zone=<ZONE>
docker swarm join --token SWMTKN-1-xxx... 10.148.0.5:2377
```

---

## 🚀 Bước 5: Deploy Services (On Manager) - 20 phút

Back to translation01:

### 5.1. Verify Swarm

```bash
docker node ls
# Expected: 3 nodes (1 Manager, 2 Workers)
```

### 5.2. Create Docker secrets

```bash
cd ~/jbcalling

# Postgres password
echo "YOUR_POSTGRES_PASSWORD" | docker secret create postgres_password -

# Redis password
echo "YOUR_REDIS_PASSWORD" | docker secret create redis_password -

# JWT secret
echo "YOUR_JWT_SECRET" | docker secret create jwt_secret -

# Verify
docker secret ls
```

### 5.3. Deploy Stack (MVP - Monitoring Only)

```bash
# Phase 1: Deploy monitoring stack first
docker stack deploy -c infrastructure/swarm/monitoring-stack.yml monitoring

# Wait 2 minutes
sleep 120

# Check services
docker service ls
# Expected: prometheus, grafana, loki, promtail

# Check logs
docker service logs -f monitoring_grafana
```

### 5.4. Access Grafana

```bash
# Open browser
http://34.126.138.3:3000

# Login
Username: admin
Password: <GRAFANA_ADMIN_PASSWORD from .env>

# Import dashboards từ infrastructure/grafana/dashboards/
```

---

## 📊 Bước 6: Deploy Database & Cache - 10 phút

```bash
cd ~/jbcalling

# Deploy database stack
docker stack deploy -c infrastructure/swarm/data-stack.yml data

# Wait for services
sleep 60

# Verify
docker service ls | grep data_
# Expected: data_postgres, data_redis

# Test connections
docker exec -it $(docker ps -q -f name=data_postgres) \
  psql -U jbcalling -d jbcalling_db -c "SELECT version();"

docker exec -it $(docker ps -q -f name=data_redis) \
  redis-cli -a YOUR_REDIS_PASSWORD ping
# Expected: PONG
```

---

## 🎯 Bước 7: Deploy AI Services (MVP) - 15 phút

```bash
# Deploy AI stack (STT + Translation only)
docker stack deploy -c infrastructure/swarm/ai-stack-mvp.yml ai

# Wait for models to load (⏳ 3-5 minutes)
sleep 300

# Check logs
docker service logs -f ai_transcription
docker service logs -f ai_translation

# Verify models loaded
curl http://localhost:8001/health
# Expected: {"status": "healthy", "model": "whisper-small-int8"}

curl http://localhost:8002/health
# Expected: {"status": "healthy", "model": "nllb-200"}
```

---

## 🌐 Bước 8: Deploy WebRTC & API - 15 phút

```bash
# Deploy WebRTC stack
docker stack deploy -c infrastructure/swarm/webrtc-stack.yml webrtc

# Deploy API stack
docker stack deploy -c infrastructure/swarm/api-stack.yml api

# Wait
sleep 120

# Verify all services
docker service ls
# Expected: ~15-20 services running

# Check API health
curl http://34.143.235.114:8000/api/v1/health
# Expected: {"status": "ok", "version": "2.0.0"}
```

---

## 🎉 Bước 9: Deploy Frontend - 10 phút

```bash
# Deploy frontend
docker stack deploy -c infrastructure/swarm/frontend-stack.yml frontend

# Wait
sleep 60

# Access application
# Open browser: http://34.143.235.114:3001
```

---

## ✅ Bước 10: Smoke Test - 10 phút

### 10.1. Test Authentication

```bash
# Register user
curl -X POST http://34.143.235.114:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123456!"}'

# Login
curl -X POST http://34.143.235.114:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "Test123456!"}'
# Save token
```

### 10.2. Test Room Creation

```bash
TOKEN="your_jwt_token"

# Create room
curl -X POST http://34.143.235.114:8000/api/v1/rooms \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Room", "max_participants": 6}'
```

### 10.3. Test Translation

```bash
# Translate text
curl -X POST http://34.143.235.114:8000/api/v1/translate \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, how are you?",
    "source_lang": "eng_Latn",
    "target_lang": "vie_Latn"
  }'
# Expected: {"translation": "Xin chào, bạn khỏe không?"}
```

### 10.4. Test Frontend

1. Open browser: `http://34.143.235.114:3001`
2. Register account
3. Create room
4. Join room với 2 tabs (simulate 2 users)
5. Enable microphone
6. Speak → See captions in real-time
7. Check translation works

---

## 📊 Bước 11: Monitoring Setup - 5 phút

### 11.1. Check Metrics

```bash
# Prometheus
http://34.126.138.3:9090

# Query examples:
- node_cpu_seconds_total
- container_memory_usage_bytes
- mediasoup_workers_total
```

### 11.2. Setup Alerts

Edit `infrastructure/prometheus/alerts.yml`:

```yaml
groups:
  - name: jbcalling
    rules:
      - alert: HighMemoryUsage
        expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1
        for: 5m
        annotations:
          summary: "RAM < 10% on {{ $labels.instance }}"
      
      - alert: ServiceDown
        expr: up == 0
        for: 2m
        annotations:
          summary: "Service {{ $labels.job }} down"
```

### 11.3. Configure Email Alerts (Optional)

Edit `.env`:

```bash
GRAFANA_SMTP_ENABLED=true
GRAFANA_SMTP_HOST=smtp.gmail.com
GRAFANA_SMTP_PORT=587
GRAFANA_SMTP_USER=your-email@gmail.com
GRAFANA_SMTP_PASSWORD=app-password
```

Restart Grafana:

```bash
docker service update --force monitoring_grafana
```

---

## 🎯 Success Criteria

Sau khi hoàn thành, bạn có:

- ✅ 3 instances trong Docker Swarm
- ✅ Monitoring stack (Prometheus, Grafana, Loki)
- ✅ Database (PostgreSQL) + Cache (Redis)
- ✅ AI services (Whisper STT, NLLB Translation)
- ✅ WebRTC gateway (MediaSoup 2 workers)
- ✅ API backend (FastAPI)
- ✅ Frontend (React/Next.js)
- ✅ 1 room test thành công với captions real-time

**Metrics to Verify:**

```bash
# CPU usage < 80%
docker stats --no-stream

# Memory on translation01
free -h
# Available: ~5-6 GB (out of 15GB)

# Services healthy
docker service ls | grep -v "0/"
# All should be "1/1" or "2/2"

# Logs clean (no errors)
docker service logs --tail 50 api_backend | grep ERROR
# Should be empty or minimal
```

---

## 🚨 Common Issues & Solutions

### Issue 1: Service Won't Start

```bash
# Check logs
docker service logs SERVICE_NAME

# Check resources
docker node inspect translation01 | grep -A 10 Resources

# Restart service
docker service update --force SERVICE_NAME
```

### Issue 2: Models Not Loading

```bash
# Check models directory
ls -lh ~/jbcalling/models/whisper/
ls -lh ~/jbcalling/models/nllb/

# Re-download if corrupted
rm -rf models/whisper/* models/nllb/*
# Run download scripts again (Step 2.4)
```

### Issue 3: High Memory Usage

```bash
# Check per-service usage
docker stats --no-stream

# Reduce replicas temporarily
docker service scale ai_transcription=1
docker service scale ai_translation=1

# Monitor
watch -n 2 'free -h'
```

### Issue 4: WebRTC Not Connecting

```bash
# Check firewall
gcloud compute firewall-rules list | grep mediasoup

# Test STUN
curl -X GET http://34.142.190.250:8000/api/v1/webrtc/ice-servers

# Check MediaSoup logs
docker service logs -f webrtc_gateway
```

---

## 📚 Next Steps

### Phase 2: Optimization (Week 3-4)

1. Enable Redis caching
2. Tune Whisper VAD thresholds
3. Implement translation batching
4. Add Nginx reverse proxy
5. Setup SSL với Let's Encrypt

### Phase 3: Advanced Features (Week 5-8)

6. Enable XTTS voice cloning (async)
7. Add PhoWhisper for Vietnamese
8. Implement document context (RAG)
9. Add user tier system
10. Payment integration (Stripe)

### Phase 4: Scale (Week 9-12)

11. Load testing with 10-20 concurrent users
12. Optimize for 2 concurrent rooms
13. Consider upgrading to 8 vCPU instances
14. Add horizontal scaling (translation04, translation05)

---

## 📞 Support

**Issues?**
- Check `docs/10-TROUBLESHOOTING.md`
- Review logs: `docker service logs SERVICE_NAME`
- Monitor Grafana dashboards

**Questions?**
- Read docs in `docs/` folder
- Check `docs/INFRASTRUCTURE-UPDATE-Oct4.md` for capacity limits

---

**Total Setup Time**: ~3-4 hours  
**Difficulty**: Intermediate  
**Prerequisites**: Basic Docker, Linux command line  
**Status**: ✅ Ready to Execute

**Good luck! 🚀**
