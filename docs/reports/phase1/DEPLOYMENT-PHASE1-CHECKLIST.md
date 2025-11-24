# ✅ DEPLOYMENT CHECKLIST - Phase 1: Infrastructure Setup

**Date**: October 5, 2025  
**Status**: ✅ READY TO START  
**Duration**: 2-3 ngày  

---

## 📊 TRẠNG THÁI CONFIGURATION

### ✅ HOÀN THÀNH

- [x] **Instance IPs verified**
  - translation01: 34.143.235.114 (Internal: 10.148.0.5)
  - translation02: 34.142.190.250 (Internal: 10.148.0.3)
  - translation03: 34.126.138.3 (Internal: 10.148.0.4)

- [x] **Secrets generated**
  - POSTGRES_PASSWORD: ✅
  - REDIS_PASSWORD: ✅
  - JWT_SECRET_KEY: ✅
  - SESSION_SECRET_KEY: ✅
  - ENCRYPTION_KEY: ✅
  - GRAFANA_ADMIN_PASSWORD: ✅

- [x] **HF Token verified**
  - Token: [REDACTED - See .env file] ✅

- [x] **Environment file created**
  - File: `.env` ✅
  - All required fields filled ✅
  - Security validated ✅

---

## 🚀 PHASE 1: INFRASTRUCTURE SETUP

### Day 1: Docker Installation & Swarm Setup

#### ☐ Task 1.1: Install Docker on All Instances (2 hours)

**Translation01 (Manager)**:
```bash
# SSH vào translation01
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Update system
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget htop net-tools

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Enable Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Logout và login lại
exit
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Verify
docker --version
docker ps
```

**Translation02 (Worker + WebRTC)**:
```bash
# SSH vào translation02
gcloud compute ssh translation02 --zone=asia-southeast1-b

# Update system
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget htop net-tools

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Enable Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Logout và login lại
exit
gcloud compute ssh translation02 --zone=asia-southeast1-b

# Verify
docker --version
docker ps
```

**Translation03 (Worker + Monitoring)**:
```bash
# SSH vào translation03
gcloud compute ssh translation03 --zone=asia-southeast1-b

# Update system
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl wget htop net-tools

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Enable Docker service
sudo systemctl enable docker
sudo systemctl start docker

# Logout và login lại
exit
gcloud compute ssh translation03 --zone=asia-southeast1-b

# Verify
docker --version
docker ps
```

**Verification**:
- [ ] Docker version >= 24.0 trên cả 3 instances
- [ ] User có thể chạy docker commands không cần sudo
- [ ] Docker daemon running

---

#### ☐ Task 1.2: Initialize Docker Swarm (30 minutes)

**On Translation01 (Manager)**:
```bash
# Init Swarm
docker swarm init --advertise-addr 10.148.0.5

# Output sẽ có dạng:
# Swarm initialized: current node (xyz) is now a manager.
# To add a worker to this swarm, run the following command:
#     docker swarm join --token SWMTKN-xxx 10.148.0.5:2377

# Lưu lại token để join workers
docker swarm join-token worker
# Copy lệnh output ra

# Create overlay networks
docker network create --driver overlay --attachable frontend
docker network create --driver overlay --attachable backend
docker network create --driver overlay --attachable monitoring

# Verify networks
docker network ls | grep overlay
```

**On Translation02 & Translation03 (Workers)**:
```bash
# Chạy lệnh join từ output trên (thay token thực)
docker swarm join --token SWMTKN-1-xxx 10.148.0.5:2377

# Verify joined
docker info | grep "Swarm: active"
```

**Back on Translation01 (Manager)**:
```bash
# Verify all nodes joined
docker node ls

# Should see 3 nodes:
# ID         HOSTNAME        STATUS   AVAILABILITY   MANAGER STATUS
# xxx *      translation01   Ready    Active         Leader
# yyy        translation02   Ready    Active         
# zzz        translation03   Ready    Active         

# Label nodes for placement
docker node update --label-add role=manager translation01
docker node update --label-add role=worker translation02
docker node update --label-add role=worker translation03
docker node update --label-add webrtc=true translation02
docker node update --label-add monitoring=true translation03

# Verify labels
docker node inspect translation01 | grep -A 5 Labels
docker node inspect translation02 | grep -A 5 Labels
docker node inspect translation03 | grep -A 5 Labels
```

**Verification**:
- [ ] 3 nodes trong swarm cluster
- [ ] translation01 là Leader
- [ ] Networks created (frontend, backend, monitoring)
- [ ] Node labels applied correctly

---

### Day 2: Core Services Deployment

#### ☐ Task 2.1: Create Docker Secrets (15 minutes)

**On Translation01 (Manager)**:
```bash
# Navigate to project directory
cd ~/jbcalling_translation_realtime

# Source .env file
source .env

# Create PostgreSQL secret
echo "$POSTGRES_PASSWORD" | docker secret create postgres_password -

# Create Redis secret
echo "$REDIS_PASSWORD" | docker secret create redis_password -

# Create JWT secret
echo "$JWT_SECRET_KEY" | docker secret create jwt_secret -

# Create HF Token secret
echo "$HF_TOKEN" | docker secret create hf_token -

# Verify secrets created
docker secret ls

# Should see:
# ID           NAME                CREATED        UPDATED
# xxx          postgres_password   X seconds ago  X seconds ago
# yyy          redis_password      X seconds ago  X seconds ago
# zzz          jwt_secret          X seconds ago  X seconds ago
# aaa          hf_token            X seconds ago  X seconds ago
```

**Verification**:
- [ ] 4 secrets created
- [ ] Secret names match stack.yml references

---

#### ☐ Task 2.2: Deploy PostgreSQL (30 minutes)

**Create simple stack file for core services**:
```bash
cd ~/jbcalling_translation_realtime

cat > infrastructure/swarm/core-stack.yml << 'EOF'
version: '3.8'

networks:
  backend:
    external: true

volumes:
  postgres_data:
  redis_data:

secrets:
  postgres_password:
    external: true
  redis_password:
    external: true

services:
  postgres:
    image: postgres:15-alpine
    networks:
      - backend
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: jbcalling_db
      POSTGRES_USER: jbcalling
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets:
      - postgres_password
    deploy:
      placement:
        constraints:
          - node.labels.role == manager
      resources:
        limits:
          cpus: '1.0'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 1G
      restart_policy:
        condition: on-failure
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U jbcalling"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    networks:
      - backend
    volumes:
      - redis_data:/data
    command: >
      sh -c "redis-server
      --requirepass $$(cat /run/secrets/redis_password)
      --maxmemory 2gb
      --maxmemory-policy allkeys-lru
      --appendonly yes"
    secrets:
      - redis_password
    deploy:
      placement:
        constraints:
          - node.labels.role == manager
      resources:
        limits:
          cpus: '0.5'
          memory: 2G
        reservations:
          cpus: '0.25'
          memory: 1G
      restart_policy:
        condition: on-failure
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 3s
      retries: 5
EOF

# Deploy core services
docker stack deploy -c infrastructure/swarm/core-stack.yml core

# Watch services start
watch docker stack ps core
# Press Ctrl+C when all services running

# Check logs
docker service logs core_postgres
docker service logs core_redis
```

**Test connections**:
```bash
# Test PostgreSQL
docker exec -it $(docker ps -q -f name=core_postgres) \
  psql -U jbcalling -d jbcalling_db -c "SELECT version();"

# Test Redis (need password from secret)
docker exec -it $(docker ps -q -f name=core_redis) \
  redis-cli -a "DjDu1tvKxXw6pyV+W9XEN31TySQFx6ofXVti0cvO5xA=" ping
```

**Verification**:
- [ ] PostgreSQL service running (1/1)
- [ ] Redis service running (1/1)
- [ ] Can connect to PostgreSQL
- [ ] Can connect to Redis
- [ ] Health checks passing

---

#### ☐ Task 2.3: Deploy Monitoring Stack (1 hour)

**Create monitoring stack file**:
```bash
cat > infrastructure/swarm/monitoring-stack.yml << 'EOF'
version: '3.8'

networks:
  monitoring:
    external: true
  backend:
    external: true

volumes:
  prometheus_data:
  grafana_data:
  loki_data:

services:
  prometheus:
    image: prom/prometheus:latest
    networks:
      - monitoring
      - backend
    volumes:
      - prometheus_data:/prometheus
      - /home/hopboy2003/jbcalling_translation_realtime/infrastructure/configs/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=15d'
      - '--web.enable-lifecycle'
    deploy:
      placement:
        constraints:
          - node.labels.monitoring == true
      resources:
        limits:
          cpus: '0.5'
          memory: 1G
    ports:
      - "9090:9090"

  grafana:
    image: grafana/grafana:latest
    networks:
      - monitoring
    volumes:
      - grafana_data:/var/lib/grafana
    environment:
      - GF_SECURITY_ADMIN_USER=admin
      - GF_SECURITY_ADMIN_PASSWORD=1z5c3XEf+dKTvM8KvujWww==
      - GF_SERVER_ROOT_URL=http://34.126.138.3:3000
      - GF_INSTALL_PLUGINS=
    deploy:
      placement:
        constraints:
          - node.labels.monitoring == true
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
    ports:
      - "3000:3000"

  node-exporter:
    image: prom/node-exporter:latest
    networks:
      - monitoring
    command:
      - '--path.procfs=/host/proc'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    deploy:
      mode: global
      resources:
        limits:
          cpus: '0.1'
          memory: 128M

  cadvisor:
    image: gcr.io/cadvisor/cadvisor:latest
    networks:
      - monitoring
    volumes:
      - /:/rootfs:ro
      - /var/run:/var/run:ro
      - /sys:/sys:ro
      - /var/lib/docker/:/var/lib/docker:ro
    deploy:
      mode: global
      resources:
        limits:
          cpus: '0.2'
          memory: 256M
EOF

# Create Prometheus config
mkdir -p infrastructure/configs

cat > infrastructure/configs/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'
    dns_sd_configs:
      - names:
          - 'tasks.node-exporter'
        type: 'A'
        port: 9100

  - job_name: 'cadvisor'
    dns_sd_configs:
      - names:
          - 'tasks.cadvisor'
        type: 'A'
        port: 8080
EOF

# Deploy monitoring stack
docker stack deploy -c infrastructure/swarm/monitoring-stack.yml monitoring

# Watch services start
watch docker stack ps monitoring
# Press Ctrl+C when all running

# Check Grafana
echo "Grafana URL: http://34.126.138.3:3000"
echo "Username: admin"
echo "Password: 1z5c3XEf+dKTvM8KvujWww=="
```

**Verification**:
- [ ] Prometheus running on http://34.126.138.3:9090
- [ ] Grafana running on http://34.126.138.3:3000
- [ ] node-exporter running on all nodes (3 replicas)
- [ ] cadvisor running on all nodes (3 replicas)
- [ ] Can login to Grafana

---

### Day 3: AI Models & Testing

#### ☐ Task 3.1: Clone Repository (10 minutes)

**On Translation01**:
```bash
# Clone if not already done
cd ~
git clone https://github.com/YOUR_USERNAME/jbcalling_translation_realtime.git jbcalling
cd jbcalling

# Copy .env file
# (Already done, but verify)
ls -la .env

# Create models directory
mkdir -p models/{whisper,nllb,xtts}
```

**Verification**:
- [ ] Repository cloned
- [ ] .env file present
- [ ] models directory structure created

---

#### ☐ Task 3.2: Download AI Models (2-3 hours)

**Download Whisper small-int8**:
```bash
cd ~/jbcalling

# Create download script
cat > scripts/download_whisper.sh << 'EOF'
#!/bin/bash
set -e

export HF_TOKEN="YOUR_HF_TOKEN_HERE"

docker run --rm -it \
  -v $(pwd)/models:/models \
  -e HF_TOKEN=${HF_TOKEN} \
  python:3.11-slim bash -c "
  pip install -q huggingface-hub && \
  python -c '
from huggingface_hub import snapshot_download
import os
os.environ[\"HF_TOKEN\"] = \"${HF_TOKEN}\"
print(\"Downloading Whisper small model...\")
snapshot_download(
    \"Systran/faster-whisper-small\",
    local_dir=\"/models/whisper\",
    cache_dir=\"/tmp\"
)
print(\"Download complete!\")
  '
"
EOF

chmod +x scripts/download_whisper.sh
./scripts/download_whisper.sh

# Verify
ls -lh models/whisper/
du -sh models/whisper/
```

**Download NLLB-200-distilled**:
```bash
cat > scripts/download_nllb.sh << 'EOF'
#!/bin/bash
set -e

export HF_TOKEN="YOUR_HF_TOKEN_HERE"

docker run --rm -it \
  -v $(pwd)/models:/models \
  -e HF_TOKEN=${HF_TOKEN} \
  python:3.11-slim bash -c "
  pip install -q huggingface-hub && \
  python -c '
from huggingface_hub import snapshot_download
import os
os.environ[\"HF_TOKEN\"] = \"${HF_TOKEN}\"
print(\"Downloading NLLB-200 model...\")
snapshot_download(
    \"facebook/nllb-200-distilled-600M\",
    local_dir=\"/models/nllb\",
    cache_dir=\"/tmp\"
)
print(\"Download complete!\")
  '
"
EOF

chmod +x scripts/download_nllb.sh
./scripts/download_nllb.sh

# Verify
ls -lh models/nllb/
du -sh models/nllb/
```

**Download XTTS v2 (optional for MVP)**:
```bash
cat > scripts/download_xtts.sh << 'EOF'
#!/bin/bash
set -e

export HF_TOKEN="YOUR_HF_TOKEN_HERE"

docker run --rm -it \
  -v $(pwd)/models:/models \
  -e HF_TOKEN=${HF_TOKEN} \
  python:3.11-slim bash -c "
  pip install -q huggingface-hub && \
  python -c '
from huggingface_hub import snapshot_download
import os
os.environ[\"HF_TOKEN\"] = \"${HF_TOKEN}\"
print(\"Downloading XTTS v2 model...\")
snapshot_download(
    \"coqui/XTTS-v2\",
    local_dir=\"/models/xtts\",
    cache_dir=\"/tmp\"
)
print(\"Download complete!\")
  '
"
EOF

chmod +x scripts/download_xtts.sh
# Run later when needed
```

**Verification**:
- [ ] Whisper model downloaded (~1.5GB)
- [ ] NLLB model downloaded (~2.5GB)
- [ ] Models readable
- [ ] Total size ~4-5GB

---

#### ☐ Task 3.3: System Health Check (30 minutes)

**Check system resources**:
```bash
# On all 3 instances
# Run: gcloud compute ssh translationXX --zone=asia-southeast1-X

# CPU usage
top -bn1 | head -20

# Memory usage
free -h

# Disk usage
df -h

# Docker stats
docker stats --no-stream

# Swarm status
docker node ls
docker stack ls
docker service ls
```

**Run test queries**:
```bash
# On translation01

# Test PostgreSQL
docker exec -it $(docker ps -q -f name=core_postgres) \
  psql -U jbcalling -d jbcalling_db -c "\l"

# Test Redis
docker exec -it $(docker ps -q -f name=core_redis) \
  redis-cli -a "DjDu1tvKxXw6pyV+W9XEN31TySQFx6ofXVti0cvO5xA=" info stats
```

**Verification**:
- [ ] CPU usage < 50% on all instances
- [ ] Memory available > 5GB on translation01
- [ ] Memory available > 8GB on translation02
- [ ] Memory available > 4GB on translation03
- [ ] Disk usage < 50%
- [ ] All services healthy
- [ ] PostgreSQL responding
- [ ] Redis responding

---

## 📊 FINAL CHECKLIST

### Infrastructure
- [ ] Docker installed on all 3 instances
- [ ] Docker Swarm initialized with 3 nodes
- [ ] Networks created (frontend, backend, monitoring)
- [ ] Node labels applied
- [ ] All nodes healthy

### Security
- [ ] Docker secrets created (4 secrets)
- [ ] .env file secured (not committed to git)
- [ ] Firewall rules configured

### Services
- [ ] PostgreSQL running and accessible
- [ ] Redis running and accessible
- [ ] Prometheus collecting metrics
- [ ] Grafana accessible via browser
- [ ] node-exporter on all nodes
- [ ] cadvisor on all nodes

### Models
- [ ] Whisper model downloaded
- [ ] NLLB model downloaded
- [ ] Models in correct directories
- [ ] HF token working

### Testing
- [ ] Can SSH to all instances
- [ ] Can access Grafana dashboard
- [ ] Database queries work
- [ ] Redis commands work
- [ ] System resources healthy

---

## 📈 NEXT STEPS (Phase 2)

### Week 2-3: API Development
1. Create FastAPI project structure
2. Setup database models (SQLAlchemy)
3. Implement authentication endpoints
4. Create WebSocket server
5. Write unit tests

### Week 4: STT Service
1. Create Whisper wrapper service
2. Setup audio processing pipeline
3. Implement VAD
4. Add Redis queue

---

## 🚨 TROUBLESHOOTING

### Issue: Docker installation fails
```bash
# Remove old Docker
sudo apt remove docker docker-engine docker.io containerd runc

# Try manual installation
sudo apt update
sudo apt install -y apt-transport-https ca-certificates curl gnupg lsb-release
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io
```

### Issue: Can't join Swarm
```bash
# Check firewall
sudo ufw status

# Open required ports
sudo ufw allow 2377/tcp  # Swarm management
sudo ufw allow 7946/tcp  # Node communication
sudo ufw allow 7946/udp  # Node communication
sudo ufw allow 4789/udp  # Overlay network

# Or on GCP
gcloud compute firewall-rules create swarm-management \
  --allow tcp:2377,tcp:7946,udp:7946,udp:4789 \
  --source-ranges 10.148.0.0/20
```

### Issue: Service won't start
```bash
# Check logs
docker service logs SERVICE_NAME

# Check node status
docker node inspect NODE_NAME

# Force update
docker service update --force SERVICE_NAME
```

### Issue: Out of memory
```bash
# Check memory
free -h

# Reduce service resources
docker service update --limit-memory 512M SERVICE_NAME

# Or scale down
docker service scale SERVICE_NAME=0
```

---

**Completion Time**: ~2-3 ngày  
**Status after Phase 1**: ✅ Infrastructure ready for development  
**Next Phase**: Phase 2 - API Development (Week 2-3)
