# 🚀 Kế Hoạch Chuyển Giao Hệ Thống Sang Tài Khoản Google Cloud Mới

**Ngày tạo**: December 2, 2025  
**Status**: 📋 Draft  
**Phiên bản**: 1.0  

---

## 📋 Mục Lục

1. [Tổng Quan](#1-tổng-quan)
2. [Pre-Migration Checklist](#2-pre-migration-checklist)
3. [Phương Pháp Migration](#3-phương-pháp-migration)
4. [Giai Đoạn 1: Chuẩn Bị](#4-giai-đoạn-1-chuẩn-bị)
5. [Giai Đoạn 2: Export Từ Tài Khoản Cũ](#5-giai-đoạn-2-export-từ-tài-khoản-cũ)
6. [Giai Đoạn 3: Tạo Hạ Tầng Mới](#6-giai-đoạn-3-tạo-hạ-tầng-mới)
7. [Giai Đoạn 4: Import và Deploy](#7-giai-đoạn-4-import-và-deploy)
8. [Giai Đoạn 5: Cập Nhật DNS và Cutover](#8-giai-đoạn-5-cập-nhật-dns-và-cutover)
9. [Giai Đoạn 6: Verification và Cleanup](#9-giai-đoạn-6-verification-và-cleanup)
10. [Timeline Dự Kiến](#10-timeline-dự-kiến)
11. [Rollback Plan](#11-rollback-plan)
12. [Checklist Thực Hiện](#12-checklist-thực-hiện)

---

## 1. Tổng Quan

### 1.1 Hệ Thống Hiện Tại

| Instance | Vai Trò | Specs | External IP | Zone |
|----------|---------|-------|-------------|------|
| translation01 | Manager Node + Core Services | c4d-standard-4 (4 vCPUs, 30GB RAM) | 34.143.235.114 | asia-southeast1-a |
| translation02 | Worker Node + AI Services | c2d-highcpu-8 (8 vCPUs, 16GB RAM) | 34.142.190.250 | asia-southeast1-b |
| translation03 | Worker Node + Monitoring | c2d-highcpu-4 (4 vCPUs, 8GB RAM) | 34.126.138.3 | asia-southeast1-b |

### 1.2 Services Đang Chạy

```
✅ Traefik (Reverse Proxy + SSL)
✅ Frontend (React App)
✅ Gateway (MediaSoup SFU + Socket.IO)
✅ STT (Speech-to-Text - PhoWhisper)
✅ Translation (VinAI Translation)
✅ TTS (Piper + OpenVoice)
✅ Redis (Cache + Message Queue)
✅ Coturn (TURN Server)
✅ Prometheus + Grafana (Monitoring)
✅ Loki (Logging)
```

### 1.3 Docker Images (Docker Hub)

Tất cả images đã được push lên Docker Hub với prefix `jackboun11/jbcalling-*`:
- `jackboun11/jbcalling-gateway:2.0.2-asr-hub`
- `jackboun11/jbcalling-frontend:latest`
- `jackboun11/jbcalling-stt:2.0.4-utterance-endpoint`
- `jackboun11/jbcalling-translation-vinai:1.0.3`
- `jackboun11/jbcalling-coturn:1.0.0`
- Và các images khác...

### 1.4 Domains

- `jbcalling.site` - Frontend
- `webrtc.jbcalling.site` - Gateway
- `stt.jbcalling.site` - STT Service
- `translation.jbcalling.site` - Translation Service
- `tts.jbcalling.site` - TTS Service
- `grafana.jbcalling.site` - Monitoring

---

## 2. Pre-Migration Checklist

### ⚠️ THÔNG TIN CẦN CHUẨN BỊ TỪ TÀI KHOẢN MỚI

Trước khi bắt đầu, bạn cần cung cấp:

#### 2.1 Thông Tin Tài Khoản GCP Mới
- [ ] **Project ID** của tài khoản mới
- [ ] **Billing Account** đã được liên kết
- [ ] **Region/Zone** mong muốn (khuyến nghị: `asia-southeast1`)
- [ ] **IAM permissions** đủ để tạo VM, VPC, Firewall rules

#### 2.2 Thông Tin Network
- [ ] **VPC Network** name hoặc tạo mới
- [ ] **Subnet CIDR** (ví dụ: 10.200.0.0/24)
- [ ] **External IPs** - Reserved static IPs hoặc ephemeral

#### 2.3 Thông Tin Domain (Nếu Giữ Nguyên)
- [ ] Access vào DNS provider để update A records
- [ ] Quyết định: **Giữ domain cũ** hay **dùng domain mới**?

#### 2.4 Thông Tin Secrets/Credentials
- [ ] **Hugging Face Token** (giữ nguyên hoặc tạo mới)
- [ ] **JWT Secret** (sẽ generate mới)
- [ ] **SSL Certificates** (Let's Encrypt sẽ tự động generate)
- [ ] **TURN credentials** (có thể giữ nguyên)

---

## 3. Phương Pháp Migration

### 3.1 So Sánh Các Phương Pháp

| Phương Pháp | Ưu Điểm | Nhược Điểm | Thời Gian | Khuyến Nghị |
|-------------|---------|------------|-----------|-------------|
| **A. Clone Disk Images** | Giữ nguyên config, nhanh | Cần xử lý IP/network | 2-4h | ⚠️ Phức tạp |
| **B. Export/Import Images** | Full backup | Tốn storage, chậm | 4-8h | 🔄 Backup |
| **C. Fresh Deploy (Khuyến nghị)** | Clean, cập nhật | Cần redeploy | 4-6h | ✅ **Khuyến nghị** |
| **D. Hybrid** | Linh hoạt | Phức tạp | 3-5h | 🔄 Tùy chọn |

### 3.2 Phương Pháp Khuyến Nghị: **Fresh Deploy từ Docker Images**

**Lý do:**
1. ✅ Tất cả Docker images đã có sẵn trên Docker Hub
2. ✅ Stack config (`stack-hybrid.yml`) đã hoàn chỉnh
3. ✅ Clean setup, không mang theo "legacy issues"
4. ✅ Cơ hội tối ưu lại cấu hình
5. ✅ Dễ troubleshoot nếu có vấn đề

**Dữ liệu cần migrate:**
- Redis data (nếu cần giữ sessions)
- Grafana dashboards (export JSON)
- SSL certificates (hoặc để Let's Encrypt tạo mới)
- TTS models (download lại hoặc copy)

---

## 4. Giai Đoạn 1: Chuẩn Bị

### 4.1 Trên Tài Khoản CŨ - Export Configs và Data

#### A. Backup Stack Configuration
```bash
# SSH vào translation01 (Manager Node cũ)
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Copy stack file
mkdir -p ~/migration-backup
cp /path/to/stack-hybrid.yml ~/migration-backup/

# Export Docker secrets (metadata only)
docker secret ls > ~/migration-backup/secrets-list.txt

# Export Docker configs
docker config ls > ~/migration-backup/configs-list.txt

# Export node labels
docker node inspect translation01 --format '{{.Spec.Labels}}' > ~/migration-backup/node-labels-01.txt
docker node inspect translation02 --format '{{.Spec.Labels}}' > ~/migration-backup/node-labels-02.txt
docker node inspect translation03 --format '{{.Spec.Labels}}' > ~/migration-backup/node-labels-03.txt
```

#### B. Backup Traefik SSL Certificates
```bash
# Trên translation01
# Copy acme.json (Let's Encrypt certs)
docker cp $(docker ps -q -f name=traefik):/letsencrypt/acme.json ~/migration-backup/

# Hoặc export từ volume
docker run --rm -v traefik_certs:/data -v ~/migration-backup:/backup alpine cp /data/acme.json /backup/
```

#### C. Export Grafana Dashboards
```bash
# Trên translation01 hoặc qua API
curl -H "Authorization: Bearer <GRAFANA_API_KEY>" \
  https://grafana.jbcalling.site/api/dashboards/db/<dashboard-uid> \
  > ~/migration-backup/grafana-dashboard.json
```

#### D. Backup Redis Data (Optional)
```bash
# Nếu cần giữ session data
docker exec $(docker ps -q -f name=redis) redis-cli BGSAVE
docker cp $(docker ps -q -f name=redis):/data/dump.rdb ~/migration-backup/
```

#### E. Tải Migration Backup về Local
```bash
# Trên máy local
gcloud compute scp translation01:~/migration-backup/* ./migration-backup/ --zone=asia-southeast1-a
```

### 4.2 Chuẩn Bị Repository

```bash
# Ensure repo đã được commit và push
cd ~/jbcalling_translation_realtime
git add .
git commit -m "chore: backup before migration to new GCP account"
git push origin main
```

---

## 5. Giai Đoạn 2: Export Từ Tài Khoản Cũ

### 5.1 Tạo Disk Snapshots (Backup)

```bash
# Trên Google Cloud Console hoặc gcloud CLI
# Tạo snapshots cho tất cả disks (dự phòng rollback)

# translation01 boot disk
gcloud compute snapshots create translation01-snapshot-dec2025 \
  --source-disk=translation01 \
  --source-disk-zone=asia-southeast1-a \
  --project=<OLD_PROJECT_ID>

# translation02 boot disk
gcloud compute snapshots create translation02-snapshot-dec2025 \
  --source-disk=translation02 \
  --source-disk-zone=asia-southeast1-b \
  --project=<OLD_PROJECT_ID>

# translation03 boot disk
gcloud compute snapshots create translation03-snapshot-dec2025 \
  --source-disk=translation03 \
  --source-disk-zone=asia-southeast1-b \
  --project=<OLD_PROJECT_ID>
```

### 5.2 Export Images Sang Cloud Storage (Optional)

Nếu muốn copy images sang tài khoản mới:

```bash
# Tạo bucket chung để share
gsutil mb -l asia-southeast1 gs://<SHARED_BUCKET_NAME>/

# Export images
gcloud compute images export \
  --destination-uri=gs://<SHARED_BUCKET_NAME>/translation01-image.tar.gz \
  --image=translation01-image \
  --project=<OLD_PROJECT_ID>
```

---

## 6. Giai Đoạn 3: Tạo Hạ Tầng Mới

### 6.1 Thiết Lập Project Mới

```bash
# Set project mới
gcloud config set project <NEW_PROJECT_ID>

# Enable required APIs
gcloud services enable compute.googleapis.com
gcloud services enable containerregistry.googleapis.com
gcloud services enable dns.googleapis.com
```

### 6.2 Tạo VPC Network

```bash
# Tạo VPC network
gcloud compute networks create translation-network \
  --subnet-mode=custom

# Tạo subnet
gcloud compute networks subnets create translation-subnet \
  --network=translation-network \
  --region=asia-southeast1 \
  --range=10.200.0.0/24 \
  --enable-private-ip-google-access
```

### 6.3 Tạo Firewall Rules

```bash
# Allow internal communication
gcloud compute firewall-rules create allow-internal \
  --network=translation-network \
  --allow=tcp,udp,icmp \
  --source-ranges=10.200.0.0/24

# Allow SSH
gcloud compute firewall-rules create allow-ssh \
  --network=translation-network \
  --allow=tcp:22 \
  --source-ranges=0.0.0.0/0

# Allow HTTP/HTTPS
gcloud compute firewall-rules create allow-http-https \
  --network=translation-network \
  --allow=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0

# Allow Docker Swarm
gcloud compute firewall-rules create allow-swarm \
  --network=translation-network \
  --allow=tcp:2377,tcp:7946,udp:7946,udp:4789 \
  --source-ranges=10.200.0.0/24

# Allow WebRTC (UDP ports)
gcloud compute firewall-rules create allow-webrtc \
  --network=translation-network \
  --allow=udp:40000-40019,tcp:3478,udp:3478,tcp:5349 \
  --source-ranges=0.0.0.0/0

# Allow TURN relay ports
gcloud compute firewall-rules create allow-turn-relay \
  --network=translation-network \
  --allow=udp:49152-49156 \
  --source-ranges=0.0.0.0/0

# Allow Grafana (optional - có thể qua Traefik)
gcloud compute firewall-rules create allow-monitoring \
  --network=translation-network \
  --allow=tcp:3000,tcp:9090 \
  --source-ranges=0.0.0.0/0
```

### 6.4 Reserve Static External IPs

```bash
# Reserve 3 static IPs
gcloud compute addresses create translation01-ip \
  --region=asia-southeast1

gcloud compute addresses create translation02-ip \
  --region=asia-southeast1

gcloud compute addresses create translation03-ip \
  --region=asia-southeast1

# Lấy IP addresses
gcloud compute addresses list --filter="region:asia-southeast1"
```

⚠️ **GHI LẠI CÁC IP NÀY** - Sẽ dùng để cập nhật DNS và config.

### 6.5 Tạo VM Instances

```bash
# translation01 - Manager Node (4 vCPUs, 30GB RAM)
gcloud compute instances create translation01-new \
  --zone=asia-southeast1-a \
  --machine-type=c4d-standard-4 \
  --network=translation-network \
  --subnet=translation-subnet \
  --private-network-ip=10.200.0.2 \
  --address=translation01-ip \
  --boot-disk-size=100GB \
  --boot-disk-type=pd-balanced \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server,https-server,swarm-manager

# translation02 - Worker Node (8 vCPUs, 16GB RAM)
gcloud compute instances create translation02-new \
  --zone=asia-southeast1-b \
  --machine-type=c2d-highcpu-8 \
  --network=translation-network \
  --subnet=translation-subnet \
  --private-network-ip=10.200.0.3 \
  --address=translation02-ip \
  --boot-disk-size=100GB \
  --boot-disk-type=pd-ssd \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server,https-server,swarm-worker,webrtc

# translation03 - Worker Node (4 vCPUs, 8GB RAM)
gcloud compute instances create translation03-new \
  --zone=asia-southeast1-b \
  --machine-type=c2d-highcpu-4 \
  --network=translation-network \
  --subnet=translation-subnet \
  --private-network-ip=10.200.0.4 \
  --address=translation03-ip \
  --boot-disk-size=50GB \
  --boot-disk-type=pd-ssd \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --tags=http-server,https-server,swarm-worker
```

### 6.6 Cài Đặt Docker Trên Tất Cả VMs

```bash
# Script chạy trên mỗi VM
DOCKER_INSTALL_SCRIPT='
#!/bin/bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

sudo usermod -aG docker $USER
sudo systemctl enable docker
sudo systemctl start docker
'

# Chạy trên từng VM
gcloud compute ssh translation01-new --zone=asia-southeast1-a --command="$DOCKER_INSTALL_SCRIPT"
gcloud compute ssh translation02-new --zone=asia-southeast1-b --command="$DOCKER_INSTALL_SCRIPT"
gcloud compute ssh translation03-new --zone=asia-southeast1-b --command="$DOCKER_INSTALL_SCRIPT"
```

---

## 7. Giai Đoạn 4: Import và Deploy

### 7.1 Thiết Lập Docker Swarm

```bash
# SSH vào translation01-new (sẽ là Manager)
gcloud compute ssh translation01-new --zone=asia-southeast1-a

# Initialize Swarm
docker swarm init --advertise-addr 10.200.0.2

# ⚠️ GHI LẠI join token!
# Output: docker swarm join --token SWMTKN-1-xxxxx 10.200.0.2:2377
```

```bash
# SSH vào translation02-new, join swarm
gcloud compute ssh translation02-new --zone=asia-southeast1-b
docker swarm join --token SWMTKN-1-xxxxx 10.200.0.2:2377

# SSH vào translation03-new, join swarm
gcloud compute ssh translation03-new --zone=asia-southeast1-b
docker swarm join --token SWMTKN-1-xxxxx 10.200.0.2:2377
```

### 7.2 Label Nodes

```bash
# Trên Manager (translation01-new)
docker node update --label-add instance=translation01 translation01-new
docker node update --label-add instance=translation02 translation02-new
docker node update --label-add instance=translation03 translation03-new
```

### 7.3 Clone Repository

```bash
# Trên translation01-new
gcloud compute ssh translation01-new --zone=asia-southeast1-a

cd ~
git clone https://github.com/HoanhHop11/translation_system.git jbcalling_translation_realtime
cd jbcalling_translation_realtime
```

### 7.4 Cập Nhật Stack Config

⚠️ **QUAN TRỌNG**: Cần cập nhật các IP addresses trong `stack-hybrid.yml`:

```yaml
# infrastructure/swarm/stack-hybrid.yml
# Thay đổi:

gateway:
  environment:
    - ANNOUNCED_IP=<NEW_TRANSLATION01_EXTERNAL_IP>  # IP mới của translation01
    - "ANNOUNCED_IPV6=<NEW_IPV6_IF_AVAILABLE>"
    
frontend:
  environment:
    - REACT_APP_GATEWAY_URL=https://webrtc.jbcalling.site  # Giữ nguyên nếu dùng domain cũ
```

### 7.5 Deploy Stack

```bash
# Trên translation01-new
cd ~/jbcalling_translation_realtime

# Deploy
docker stack deploy -c infrastructure/swarm/stack-hybrid.yml translation

# Monitor
watch docker service ls
```

### 7.6 Verify Services

```bash
# Kiểm tra tất cả services
docker service ls

# Expected output:
# NAME                      MODE         REPLICAS   IMAGE
# translation_traefik       replicated   1/1        traefik:v2.10
# translation_frontend      replicated   3/3        jackboun11/jbcalling-frontend:latest
# translation_gateway       replicated   1/1        jackboun11/jbcalling-gateway:2.0.2-asr-hub
# translation_stt           replicated   1/1        jackboun11/jbcalling-stt:2.0.4-utterance-endpoint
# translation_translation   replicated   1/1        jackboun11/jbcalling-translation-vinai:1.0.3
# ... và các services khác
```

---

## 8. Giai Đoạn 5: Cập Nhật DNS và Cutover

### 8.1 Cập Nhật DNS Records

Truy cập DNS provider (Cloudflare, Route53, Google Cloud DNS, etc.):

```
# Cập nhật các A records với IP mới:

jbcalling.site          → <NEW_TRANSLATION01_IP>
www.jbcalling.site      → <NEW_TRANSLATION01_IP>
webrtc.jbcalling.site   → <NEW_TRANSLATION01_IP>
stt.jbcalling.site      → <NEW_TRANSLATION01_IP>
translation.jbcalling.site → <NEW_TRANSLATION01_IP>
tts.jbcalling.site      → <NEW_TRANSLATION01_IP>
grafana.jbcalling.site  → <NEW_TRANSLATION01_IP>
media.jbcalling.site    → <NEW_TRANSLATION02_IP>  # TURN server
```

### 8.2 Chờ DNS Propagation

```bash
# Kiểm tra DNS propagation
dig jbcalling.site +short
dig webrtc.jbcalling.site +short

# Hoặc dùng công cụ online
# https://www.whatsmydns.net/
```

⏱️ **DNS propagation có thể mất 5 phút - 48 giờ**, tùy TTL settings.

### 8.3 SSL Certificate Renewal

Let's Encrypt sẽ tự động xin certificate mới khi traffic đến qua Traefik:

```bash
# Kiểm tra Traefik logs
docker service logs translation_traefik --tail 50

# Xem certificate
curl -vI https://jbcalling.site 2>&1 | grep -A 5 "Server certificate"
```

---

## 9. Giai Đoạn 6: Verification và Cleanup

### 9.1 Testing Checklist

| Test | Command/Action | Expected |
|------|---------------|----------|
| Frontend loads | `curl -I https://jbcalling.site` | 200 OK |
| Gateway health | `curl https://webrtc.jbcalling.site/health` | `{"status":"ok"}` |
| STT health | `curl https://stt.jbcalling.site/health` | 200 OK |
| Translation health | `curl https://translation.jbcalling.site/health` | 200 OK |
| WebRTC connection | Open browser, test video call | ✅ Video working |
| SSL valid | Check certificate expiry | Valid cert |
| Grafana | `https://grafana.jbcalling.site` | Dashboard loads |

### 9.2 End-to-End Test

1. Mở trình duyệt, truy cập `https://jbcalling.site`
2. Đăng nhập hoặc tạo room mới
3. Test video call giữa 2 users
4. Test speech-to-text
5. Test translation
6. Kiểm tra captions hiển thị

### 9.3 Cleanup Tài Khoản Cũ

⚠️ **CHỈ THỰC HIỆN SAU KHI XÁC NHẬN HỆ THỐNG MỚI HOẠT ĐỘNG ỔN ĐỊNH (24-48h)**

```bash
# Trên tài khoản CŨ

# Stop services
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="docker stack rm translation"

# Stop VMs (không xóa ngay để có thể rollback)
gcloud compute instances stop translation01 --zone=asia-southeast1-a
gcloud compute instances stop translation02 --zone=asia-southeast1-b
gcloud compute instances stop translation03 --zone=asia-southeast1-b

# Sau 1-2 tuần nếu ổn định, có thể xóa:
# gcloud compute instances delete translation01 --zone=asia-southeast1-a
# gcloud compute instances delete translation02 --zone=asia-southeast1-b
# gcloud compute instances delete translation03 --zone=asia-southeast1-b
```

---

## 10. Timeline Dự Kiến

| Giai Đoạn | Công Việc | Thời Gian |
|-----------|-----------|-----------|
| 1 | Chuẩn bị & Backup | 1-2 giờ |
| 2 | Export từ tài khoản cũ | 30 phút |
| 3 | Tạo hạ tầng mới | 1-2 giờ |
| 4 | Deploy Docker Swarm + Services | 1-2 giờ |
| 5 | DNS cutover | 30 phút + propagation |
| 6 | Verification | 1 giờ |
| **Tổng** | **Migration** | **~4-6 giờ** |
| | DNS Propagation | 5 phút - 48 giờ |
| | Monitoring trước cleanup | 24-48 giờ |

### Best Practices:
- ⏰ Thực hiện vào **thời điểm ít traffic** (đêm/sáng sớm)
- 👥 Thông báo cho users về maintenance window
- 📱 Có sẵn kênh communication để xử lý issues
- 🔄 Giữ hệ thống cũ running trong 24-48h để rollback nếu cần

---

## 11. Rollback Plan

### Nếu Migration Thất Bại:

#### Scenario A: DNS Chưa Update
```bash
# Không cần làm gì - hệ thống cũ vẫn hoạt động
```

#### Scenario B: DNS Đã Update, Services Mới Lỗi
```bash
# Revert DNS records về IP cũ
# Hệ thống cũ vẫn running → traffic sẽ quay lại

# Nếu đã stop VMs cũ:
gcloud compute instances start translation01 --zone=asia-southeast1-a --project=<OLD_PROJECT>
gcloud compute instances start translation02 --zone=asia-southeast1-b --project=<OLD_PROJECT>
gcloud compute instances start translation03 --zone=asia-southeast1-b --project=<OLD_PROJECT>

# Redeploy stack nếu cần
gcloud compute ssh translation01 --zone=asia-southeast1-a --project=<OLD_PROJECT>
docker stack deploy -c stack-hybrid.yml translation
```

#### Scenario C: Cần Khôi Phục Từ Snapshot
```bash
# Tạo disk từ snapshot
gcloud compute disks create translation01-recovered \
  --source-snapshot=translation01-snapshot-dec2025 \
  --zone=asia-southeast1-a \
  --project=<OLD_PROJECT>

# Tạo VM từ disk
gcloud compute instances create translation01-recovered \
  --disk=name=translation01-recovered,boot=yes \
  --zone=asia-southeast1-a \
  --project=<OLD_PROJECT>
```

---

## 12. Checklist Thực Hiện

### Pre-Migration
- [ ] Có đủ thông tin tài khoản GCP mới
- [ ] Billing đã setup
- [ ] DNS access sẵn sàng
- [ ] Thông báo maintenance cho users
- [ ] Backup tất cả configs
- [ ] Test rollback plan

### Giai Đoạn 1-2: Export
- [ ] Backup stack-hybrid.yml
- [ ] Export Grafana dashboards
- [ ] Backup Redis data (nếu cần)
- [ ] Tạo disk snapshots
- [ ] Download backup về local

### Giai Đoạn 3: Hạ Tầng Mới
- [ ] Tạo VPC network
- [ ] Tạo firewall rules
- [ ] Reserve static IPs
- [ ] Tạo 3 VMs
- [ ] Install Docker

### Giai Đoạn 4: Deploy
- [ ] Init Docker Swarm
- [ ] Join worker nodes
- [ ] Label nodes
- [ ] Clone repository
- [ ] Update configs với IP mới
- [ ] Deploy stack
- [ ] Verify tất cả services running

### Giai Đoạn 5: Cutover
- [ ] Update DNS records
- [ ] Verify DNS propagation
- [ ] Verify SSL certificates
- [ ] Test endpoints

### Giai Đoạn 6: Verification
- [ ] Test frontend
- [ ] Test WebRTC call
- [ ] Test STT/Translation
- [ ] Verify Grafana metrics
- [ ] Monitor 24-48h
- [ ] Cleanup tài khoản cũ

---

## 📞 Thông Tin Liên Hệ Khi Cần Hỗ Trợ

- **Google Cloud Support**: https://cloud.google.com/support
- **Docker Swarm Docs**: https://docs.docker.com/engine/swarm/
- **Traefik Docs**: https://doc.traefik.io/traefik/

---

**Document Version**: 1.0  
**Last Updated**: December 2, 2025  
**Author**: GitHub Copilot  

---

## ⚠️ LƯU Ý QUAN TRỌNG

Trước khi thực hiện, vui lòng cung cấp:

1. **Project ID** của tài khoản Google Cloud mới
2. **Region/Zone** mong muốn
3. **Quyết định về domain** (giữ nguyên hay đổi mới?)
4. **Thời điểm dự kiến** thực hiện migration

Tôi sẽ hỗ trợ cập nhật kế hoạch và thực hiện từng bước cùng bạn.
