# Hướng dẫn Setup - Triển khai Hệ thống

## ⚠️ THÔNG TIN QUAN TRỌNG CẦN CHUẨN BỊ

Trước khi bắt đầu setup, bạn CẦN chuẩn bị các thông tin sau:

### 1. Google Cloud Instances
- [x] 3 instances đã tạo (translation01, translation02, translation03)
- [ ] External IP addresses của cả 3 instances
- [ ] SSH keys để truy cập instances

### 2. Domain và SSL (Recommended)
- [ ] Domain name (ví dụ: translation.yourdomain.com)
- [ ] DNS records pointing đến load balancer IP
- [ ] SSL certificate hoặc dùng Let's Encrypt

### 3. API Keys và Tokens
- [ ] **Hugging Face Token** (REQUIRED cho speaker diarization)
  - Đăng ký: https://huggingface.co/join
  - Accept license: https://huggingface.co/pyannote/speaker-diarization-3.1
  - Tạo token: https://huggingface.co/settings/tokens
  - Format: `hf_xxxxxxxxxxxxxxxxxxxxx`

- [ ] **JWT Secret Key** (tự generate)
  ```bash
  openssl rand -hex 32
  ```

- [ ] **Database Passwords**
  - PostgreSQL password
  - Redis password (optional nhưng recommended)

### 4. Container Registry (Optional)
- [ ] Docker Hub account hoặc Google Container Registry
- [ ] Registry credentials nếu push private images

---

## Phần 1: Chuẩn bị Instances

### 1.1 Cấu hình SSH

Trên máy local của bạn:

```bash
# Tạo SSH config file
nano ~/.ssh/config
```

Thêm vào:

```
Host translation01
    HostName <EXTERNAL_IP_TRANSLATION01>
    User <YOUR_USERNAME>
    IdentityFile ~/.ssh/google_compute_engine
    
Host translation02
    HostName <EXTERNAL_IP_TRANSLATION02>
    User <YOUR_USERNAME>
    IdentityFile ~/.ssh/google_compute_engine
    
Host translation03
    HostName <EXTERNAL_IP_TRANSLATION03>
    User <YOUR_USERNAME>
    IdentityFile ~/.ssh/google_compute_engine
```

⚠️ **THAY THẾ**:
- `<EXTERNAL_IP_TRANSLATION0X>`: IP thực của instances
- `<YOUR_USERNAME>`: Username của bạn trên GCP

Test SSH:
```bash
ssh translation01
ssh translation02
ssh translation03
```

### 1.2 Cài đặt Docker trên Tất cả Instances

Script cài đặt Docker (chạy trên TỪNG instance):

```bash
# Update system
sudo apt-get update
sudo apt-get upgrade -y

# Install dependencies
sudo apt-get install -y \
    apt-transport-https \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Set up repository
echo \
  "deb [arch=amd64 signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io

# Add user to docker group
sudo usermod -aG docker $USER

# Start and enable Docker
sudo systemctl start docker
sudo systemctl enable docker

# Verify installation
docker --version
```

Logout và login lại để group changes có hiệu lực:
```bash
exit
ssh translation01  # (hoặc 02, 03)
```

Test Docker:
```bash
docker run hello-world
```

### 1.3 Cấu hình System Limits

Trên TẤT CẢ instances:

```bash
# Tăng file descriptors limit
sudo nano /etc/sysctl.conf
```

Thêm vào cuối file:
```
fs.file-max = 2097152
fs.nr_open = 2097152
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 8192
vm.max_map_count = 262144
```

Apply changes:
```bash
sudo sysctl -p
```

Edit limits:
```bash
sudo nano /etc/security/limits.conf
```

Thêm:
```
* soft nofile 1048576
* hard nofile 1048576
* soft nproc 1048576
* hard nproc 1048576
```

## Phần 2: Thiết lập Docker Swarm

### 2.1 Initialize Swarm trên Manager Node (translation01)

```bash
ssh translation01

# Initialize Swarm
docker swarm init --advertise-addr <INTERNAL_IP_TRANSLATION01>
```

⚠️ **THAY THẾ**: `<INTERNAL_IP_TRANSLATION01>` với IP nội bộ (10.148.0.2)

Lệnh sẽ output ra join token. **LƯU LẠI** output này!

```
docker swarm join --token SWMTKN-1-xxxxxxxxx <INTERNAL_IP>:2377
```

### 2.2 Join Worker Nodes

Trên translation02:
```bash
ssh translation02

# Join swarm (dùng token từ bước trước)
docker swarm join --token SWMTKN-1-xxxxxxxxx <INTERNAL_IP_TRANSLATION01>:2377
```

Trên translation03:
```bash
ssh translation03

# Join swarm
docker swarm join --token SWMTKN-1-xxxxxxxxx <INTERNAL_IP_TRANSLATION01>:2377
```

### 2.3 Verify Swarm

Trên manager node (translation01):
```bash
docker node ls
```

Expected output:
```
ID                          HOSTNAME        STATUS  AVAILABILITY  MANAGER STATUS
xxx *                       translation01   Ready   Active        Leader
yyy                         translation02   Ready   Active        
zzz                         translation03   Ready   Active        
```

### 2.4 Label Nodes

Gán labels cho nodes để control placement:

```bash
# Trên translation01 (manager)
docker node update --label-add role=manager translation01
docker node update --label-add role=transcription translation01
docker node update --label-add role=translation translation01

docker node update --label-add role=worker translation02
docker node update --label-add role=gateway translation02
docker node update --label-add role=frontend translation02

docker node update --label-add role=worker translation03
docker node update --label-add role=monitoring translation03
docker node update --label-add role=diarization translation03
```

Verify labels:
```bash
docker node inspect translation01 --format '{{.Spec.Labels}}'
docker node inspect translation02 --format '{{.Spec.Labels}}'
docker node inspect translation03 --format '{{.Spec.Labels}}'
```

## Phần 3: Tạo Networks và Volumes

### 3.1 Create Overlay Networks

Trên manager node (translation01):

```bash
# Network cho các services chính
docker network create --driver overlay --attachable app-network

# Network cho monitoring
docker network create --driver overlay --attachable monitoring-network

# Network cho data services (PostgreSQL, Redis)
docker network create --driver overlay --attachable data-network
```

### 3.2 Create Volumes

```bash
# PostgreSQL data
docker volume create postgres-data

# Redis data
docker volume create redis-data

# Models storage (shared across nodes)
docker volume create models-data

# Voice embeddings
docker volume create voice-embeddings

# Elasticsearch data
docker volume create elastic-data

# Prometheus data
docker volume create prometheus-data

# Grafana data
docker volume create grafana-data
```

## Phần 4: Cấu hình Secrets và Configs

### 4.1 Create Docker Secrets

⚠️ **YÊU CẦU**: Bạn phải cung cấp các giá trị THẬT cho secrets

```bash
# ⚠️ THAY THẾ giá trị thực
echo "<YOUR_POSTGRES_PASSWORD>" | docker secret create postgres_password -
echo "<YOUR_REDIS_PASSWORD>" | docker secret create redis_password -
echo "<YOUR_JWT_SECRET>" | docker secret create jwt_secret -
echo "<YOUR_HF_TOKEN>" | docker secret create hf_token -
```

**Cách tạo các giá trị**:

```bash
# PostgreSQL password (random secure password)
openssl rand -base64 32 | docker secret create postgres_password -

# Redis password
openssl rand -base64 32 | docker secret create redis_password -

# JWT secret
openssl rand -hex 32 | docker secret create jwt_secret -

# Hugging Face token (từ https://huggingface.co/settings/tokens)
echo "hf_xxxxxxxxxxxxxxxxxxxxx" | docker secret create hf_token -
```

Verify secrets:
```bash
docker secret ls
```

### 4.2 Create Configs

Tạo file config trên local machine:

```bash
# Tạo thư mục configs
mkdir -p ~/translation-configs
cd ~/translation-configs
```

#### PostgreSQL config
```bash
nano postgres.conf
```

Nội dung:
```
max_connections = 200
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 512MB
checkpoint_completion_target = 0.9
wal_buffers = 16MB
default_statistics_target = 100
random_page_cost = 1.1
effective_io_concurrency = 200
work_mem = 5242kB
min_wal_size = 1GB
max_wal_size = 4GB
```

Upload to Swarm:
```bash
docker config create postgres_config postgres.conf
```

#### Redis config
```bash
nano redis.conf
```

Nội dung:
```
maxmemory 4gb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
```

Upload:
```bash
docker config create redis_config redis.conf
```

#### Prometheus config
```bash
nano prometheus.yml
```

Nội dung:
```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'node-exporter'
    static_configs:
      - targets: 
        - 'translation01:9100'
        - 'translation02:9100'
        - 'translation03:9100'

  - job_name: 'cadvisor'
    static_configs:
      - targets:
        - 'translation01:8080'
        - 'translation02:8080'
        - 'translation03:8080'

  - job_name: 'api-gateway'
    metrics_path: '/metrics'
    static_configs:
      - targets: ['api:8000']

  - job_name: 'transcription'
    static_configs:
      - targets: ['transcription:8001']

  - job_name: 'translation'
    static_configs:
      - targets: ['translation:8002']
```

Upload:
```bash
docker config create prometheus_config prometheus.yml
```

## Phần 5: Clone Repository và Chuẩn bị Code

### 5.1 Clone trên Manager Node

```bash
ssh translation01
cd ~
git clone <YOUR_REPO_URL> jbcalling_translation_realtime
cd jbcalling_translation_realtime
```

⚠️ **THAY THẾ**: `<YOUR_REPO_URL>` với URL git repository của bạn

### 5.2 Tạo Environment File

```bash
nano .env.production
```

Nội dung:

```bash
# ⚠️ THAY THẾ các giá trị sau

# Database
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_DB=translation_db
POSTGRES_USER=translation_user
# Password sẽ load từ Docker secret

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
# Password sẽ load từ Docker secret

# API Configuration
API_HOST=0.0.0.0
API_PORT=8000
API_WORKERS=4
API_DEBUG=false

# JWT
JWT_ALGORITHM=HS256
JWT_EXPIRE_MINUTES=1440
# Secret sẽ load từ Docker secret

# Models
WHISPER_MODEL=base
WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8

NLLB_MODEL=facebook/nllb-200-distilled-600M
TRANSLATION_DEVICE=cpu

XTTS_MODEL=tts_models/multilingual/multi-dataset/xtts_v2
TTS_DEVICE=cpu

# WebRTC
WEBRTC_LISTEN_IP=0.0.0.0
WEBRTC_ANNOUNCED_IP=<EXTERNAL_IP_TRANSLATION02>  # ⚠️ THAY THẾ
WEBRTC_PORT_RANGE_MIN=40000
WEBRTC_PORT_RANGE_MAX=40100

# Frontend
NEXT_PUBLIC_API_URL=https://<YOUR_DOMAIN>/api  # ⚠️ THAY THẾ
NEXT_PUBLIC_WS_URL=wss://<YOUR_DOMAIN>/ws      # ⚠️ THAY THẾ

# Monitoring
PROMETHEUS_PORT=9090
GRAFANA_PORT=3000
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=<GENERATE_SECURE_PASSWORD>  # ⚠️ THAY THẾ

# Logging
LOG_LEVEL=INFO
LOG_FORMAT=json

# Rate Limiting
RATE_LIMIT_PER_MINUTE=60
RATE_LIMIT_PER_HOUR=1000

# File Upload
MAX_UPLOAD_SIZE=10485760  # 10MB
ALLOWED_EXTENSIONS=pdf,docx,txt

# Voice Cloning
MIN_VOICE_SAMPLE_DURATION=3
MAX_VOICE_SAMPLE_DURATION=30
VOICE_SAMPLE_CACHE_TTL=2592000  # 30 days

# Room Settings
MAX_PARTICIPANTS_PER_ROOM=20
MAX_ROOMS_PER_INSTANCE=10
ROOM_IDLE_TIMEOUT=3600  # 1 hour
```

⚠️ **PHẢI CẬP NHẬT**:
- `WEBRTC_ANNOUNCED_IP`: External IP của translation02
- `NEXT_PUBLIC_API_URL`: Domain của bạn
- `NEXT_PUBLIC_WS_URL`: Domain của bạn
- `GRAFANA_ADMIN_PASSWORD`: Generate password mới

## Phần 6: Download Models

### 6.1 Run Model Download Script

```bash
# Trên translation01
cd ~/jbcalling_translation_realtime

# Set HF token
export HF_TOKEN="<YOUR_HF_TOKEN>"  # ⚠️ THAY THẾ

# Run download script
python3 scripts/setup/download_models.py
```

Script sẽ download:
- Whisper base model (~150MB)
- NLLB-200 distilled (~1.2GB)
- XTTS v2 (~2GB)
- Sentence Transformer (~500MB)
- Speaker Diarization (~1GB) - nếu có HF_TOKEN

**Lưu ý**: Download có thể mất 10-30 phút tùy network speed.

### 6.2 Verify Models

```bash
ls -lh /models/
```

Expected:
```
/models/
├── whisper/
├── nllb/
├── xtts_v2/
├── sentence-transformers/
└── pyannote/
```

## Phần 7: Build Docker Images

### 7.1 Build từng Service

Trên manager node:

```bash
cd ~/jbcalling_translation_realtime

# Build API Gateway
docker build -t translation/api-gateway:latest ./services/api

# Build Transcription Service
docker build -t translation/transcription:latest ./services/transcription

# Build Translation Service
docker build -t translation/translation:latest ./services/translation

# Build Voice Cloning Service
docker build -t translation/voice-cloning:latest ./services/voice-cloning

# Build Speaker Diarization Service
docker build -t translation/diarization:latest ./services/diarization

# Build WebRTC Gateway
docker build -t translation/webrtc-gateway:latest ./services/gateway

# Build Frontend
docker build -t translation/frontend:latest ./services/frontend
```

### 7.2 Tag và Push (Optional)

Nếu bạn muốn push lên registry:

```bash
# Tag images
docker tag translation/api-gateway:latest <YOUR_REGISTRY>/api-gateway:latest
docker tag translation/transcription:latest <YOUR_REGISTRY>/transcription:latest
# ... tương tự cho các services khác

# Login to registry
docker login <YOUR_REGISTRY>

# Push images
docker push <YOUR_REGISTRY>/api-gateway:latest
docker push <YOUR_REGISTRY>/transcription:latest
# ... tương tự
```

⚠️ **KHÔNG BẮT BUỘC**: Nếu build trên manager node và deploy local, không cần push.

## Phần 8: Deploy Stack

### 8.1 Review Stack File

```bash
nano infrastructure/swarm/stack.yml
```

Xem qua và ensure tất cả configs đúng.

### 8.2 Deploy

```bash
docker stack deploy -c infrastructure/swarm/stack.yml translation
```

### 8.3 Monitor Deployment

```bash
# Xem services
docker service ls

# Xem logs của service
docker service logs -f translation_api

# Xem tasks
docker stack ps translation

# Xem chi tiết service
docker service inspect translation_api
```

Wait cho tất cả services reach "Running" state:
```bash
watch docker service ls
```

Expected output (sau vài phút):
```
NAME                        REPLICAS   IMAGE                          
translation_api             2/2        translation/api-gateway:latest
translation_frontend        2/2        translation/frontend:latest
translation_gateway         2/2        translation/webrtc-gateway:latest
translation_postgres        1/1        postgres:15
translation_redis           1/1        redis:7-alpine
translation_transcription   2/2        translation/transcription:latest
translation_translation     2/2        translation/translation:latest
translation_voice-cloning   1/1        translation/voice-cloning:latest
translation_diarization     1/1        translation/diarization:latest
translation_prometheus      1/1        prom/prometheus:latest
translation_grafana         1/1        grafana/grafana:latest
```

## Phần 9: Cấu hình Load Balancer

### 9.1 Cài đặt Traefik

Traefik sẽ handle routing và SSL.

```bash
nano infrastructure/swarm/traefik.yml
```

Deploy Traefik:
```bash
docker stack deploy -c infrastructure/swarm/traefik.yml traefik
```

### 9.2 Configure DNS

Trên DNS provider của bạn:

```
A Record:
  translation.yourdomain.com -> <LOAD_BALANCER_IP>

CNAME Records (optional):
  api.translation.yourdomain.com -> translation.yourdomain.com
  ws.translation.yourdomain.com -> translation.yourdomain.com
  monitor.translation.yourdomain.com -> translation.yourdomain.com
```

⚠️ **THAY THẾ**: 
- `yourdomain.com`: Domain của bạn
- `<LOAD_BALANCER_IP>`: IP của load balancer hoặc translation02

### 9.3 SSL Certificate

Nếu dùng Let's Encrypt (automatic):
```bash
# Traefik sẽ tự động request certificate khi traffic đến
# Chỉ cần ensure DNS records đã point đúng
```

Nếu dùng custom certificate:
```bash
# Upload certificate
docker secret create ssl_cert server.crt
docker secret create ssl_key server.key

# Update traefik.yml để use custom certs
```

## Phần 10: Verification và Testing

### 10.1 Health Checks

```bash
# API health
curl https://<YOUR_DOMAIN>/api/health

# WebSocket test
wscat -c wss://<YOUR_DOMAIN>/ws

# Prometheus
curl http://<MONITORING_IP>:9090/-/healthy

# Grafana
curl http://<MONITORING_IP>:3000/api/health
```

### 10.2 Access Services

```
Frontend:       https://<YOUR_DOMAIN>
API:            https://<YOUR_DOMAIN>/api
API Docs:       https://<YOUR_DOMAIN>/api/docs
WebSocket:      wss://<YOUR_DOMAIN>/ws
Grafana:        http://<MONITORING_IP>:3000
Prometheus:     http://<MONITORING_IP>:9090
```

### 10.3 Create Test User

```bash
# SSH vào manager node
ssh translation01

# Access API container
docker exec -it $(docker ps -q -f name=translation_api) bash

# Create user via CLI
python manage.py create-user \
  --email test@example.com \
  --password TestPass123! \
  --name "Test User"
```

### 10.4 Test Complete Flow

1. Access frontend: `https://<YOUR_DOMAIN>`
2. Login với test user
3. Create room
4. Test video call
5. Test transcription
6. Test translation
7. Check live captions

## Phần 11: Monitoring Setup

### 11.1 Configure Grafana

```bash
# Access Grafana
http://<TRANSLATION03_IP>:3000

# Login
Username: admin
Password: <GRAFANA_ADMIN_PASSWORD>
```

Import dashboards:
1. Go to Dashboards → Import
2. Upload dashboards từ `infrastructure/monitoring/dashboards/`
3. Select Prometheus data source

### 11.2 Setup Alerts

Configure alert channels:
1. Alerting → Notification channels
2. Add channel (Email, Slack, etc.)
3. Test notification

## Troubleshooting

### Services không start

```bash
# Check logs
docker service logs translation_<service_name>

# Check inspect
docker service inspect translation_<service_name>

# Check events
docker events --filter 'type=service'
```

### Models không load

```bash
# Check volume
docker volume inspect models-data

# Re-download models
docker exec -it $(docker ps -q -f name=translation_transcription) bash
python /app/scripts/download_models.py
```

### Network issues

```bash
# Check networks
docker network ls
docker network inspect app-network

# Recreate network
docker network rm app-network
docker network create --driver overlay --attachable app-network
```

### Out of Memory

```bash
# Check memory usage
docker stats

# Scale down replicas
docker service scale translation_transcription=1

# Increase swap (not recommended for production)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Next Steps

✅ Hệ thống đã được deploy!

Xem thêm:
- [09-MONITORING.md](./09-MONITORING.md) - Chi tiết monitoring và metrics
- [10-TROUBLESHOOTING.md](./10-TROUBLESHOOTING.md) - Troubleshooting guide
- [08-DEPLOYMENT.md](./08-DEPLOYMENT.md) - CI/CD và deployment strategies
