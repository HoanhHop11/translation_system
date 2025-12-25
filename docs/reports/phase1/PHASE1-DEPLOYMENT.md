# 🚀 PHASE 1 DEPLOYMENT GUIDE

## Tổng Quan

**Phase 1: Infrastructure Setup** thiết lập nền tảng cho toàn bộ hệ thống:
- ✅ Docker Engine trên 3 instances
- ✅ Docker Swarm cluster (1 manager + 2 workers)
- ✅ Overlay networks (backend, frontend, monitoring)
- ✅ Docker secrets (passwords, keys, tokens)
- ✅ Base services (PostgreSQL, Redis)

**Thời gian**: 30-60 phút (tự động) hoặc 2-3 giờ (thủ công)

---

## 🎯 Hai Cách Triển Khai

### Cách 1: TỰ ĐỘNG (Khuyến Nghị) ⚡

Chạy một script duy nhất để deploy toàn bộ Phase 1:

```bash
cd /home/hopboy2003/jbcalling_translation_realtime

# Chạy master deployment script
./scripts/phase1/deploy-phase1.sh
```

Script này sẽ tự động:
1. ✅ Copy tất cả scripts lên 3 instances
2. ✅ Cài Docker trên cả 3 instances
3. ✅ Khởi tạo Swarm trên translation01
4. ✅ Join translation02 và translation03 vào swarm
5. ✅ Gắn labels cho các nodes
6. ✅ Copy .env và tạo secrets
7. ✅ Deploy PostgreSQL và Redis
8. ✅ Verify deployment

**Ưu điểm**:
- Nhanh chóng (30-60 phút)
- Ít lỗi
- Tự động retry
- Full logging

**Nhược điểm**:
- Khó debug nếu có lỗi
- Cần gcloud CLI cấu hình đúng

---

### Cách 2: THỦ CÔNG (Chi Tiết) 🔧

Thực hiện từng bước một để hiểu rõ quy trình. Xem [README.md](./README.md) để có hướng dẫn chi tiết.

---

## ⚠️ YÊU CẦU TRƯỚC KHI BẮT ĐẦU

### 1. Kiểm tra File .env

```bash
# Verify .env file tồn tại và có đầy đủ thông tin
cat .env | grep -E "INSTANCE_|PASSWORD|SECRET|HF_TOKEN"
```

Đảm bảo các trường sau **KHÔNG trống**:
- ✅ `INSTANCE_01_IP`, `INSTANCE_02_IP`, `INSTANCE_03_IP`
- ✅ `POSTGRES_PASSWORD`
- ✅ `REDIS_PASSWORD`
- ✅ `JWT_SECRET_KEY`
- ✅ `SESSION_SECRET_KEY`
- ✅ `ENCRYPTION_KEY`
- ✅ `HF_TOKEN`
- ✅ `GRAFANA_ADMIN_PASSWORD`

### 2. Kiểm tra SSH Access

```bash
# Test SSH vào cả 3 instances
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="hostname"
gcloud compute ssh translation02 --zone=asia-southeast1-b --command="hostname"
gcloud compute ssh translation03 --zone=asia-southeast1-b --command="hostname"
```

Phải thấy output:
```
translation01
translation02
translation03
```

### 3. Kiểm tra gcloud CLI

```bash
# Verify gcloud đã đăng nhập
gcloud auth list

# Verify project được set đúng
gcloud config get-value project
```

### 4. Kiểm tra Firewall Rules

Ports cần mở giữa các instances:
- `2377/tcp` - Cluster management
- `7946/tcp` - Node communication
- `7946/udp` - Node communication
- `4789/udp` - Overlay network

```bash
# List firewall rules
gcloud compute firewall-rules list --filter="name:docker-swarm OR name:translation"
```

Nếu chưa có, tạo rule:

```bash
gcloud compute firewall-rules create docker-swarm-internal \
    --allow tcp:2377,tcp:7946,udp:7946,udp:4789 \
    --source-ranges 10.148.0.0/20 \
    --description "Docker Swarm internal communication"
```

---

## 🚀 DEPLOYMENT - CÁCH 1: TỰ ĐỘNG

### Bước 1: Chạy Master Script

```bash
cd /home/hopboy2003/jbcalling_translation_realtime

# Dry run (kiểm tra không thực thi)
# DRY_RUN=1 ./scripts/phase1/deploy-phase1.sh

# Thực tế deployment
./scripts/phase1/deploy-phase1.sh
```

### Bước 2: Theo dõi Progress

Script sẽ hiển thị progress qua 11 steps:

```
[STEP 1/11] 📦 Copy scripts
[STEP 2/11] 🐳 Install Docker on Manager
[STEP 3/11] 🐳 Install Docker on Worker 1
[STEP 4/11] 🐳 Install Docker on Worker 2
[STEP 5/11] 🎯 Initialize Swarm Manager
[STEP 6/11] 🔗 Join Worker 1 to Swarm
[STEP 7/11] 🔗 Join Worker 2 to Swarm
[STEP 8/11] 🏷️  Label Nodes
[STEP 9/11] 🔒 Create Secrets
[STEP 10/11] 🚀 Deploy Base Services
[STEP 11/11] ✅ Verify Deployment
```

### Bước 3: Xem Kết Quả

Sau khi script hoàn thành, bạn sẽ thấy summary:

```
========================================
🎉 PHASE 1 DEPLOYMENT COMPLETE!
========================================

📊 Quick Status Check:
=== Nodes ===
ID              HOSTNAME        STATUS    AVAILABILITY    MANAGER STATUS
abc123def456 *  translation01   Ready     Active          Leader
xyz789ghi012    translation02   Ready     Active          
mno345pqr678    translation03   Ready     Active          

=== Networks ===
backend      overlay
frontend     overlay
monitoring   overlay

=== Services ===
NAME       REPLICAS    IMAGE
postgres   1/1         postgres:15-alpine
redis      1/1         redis:7-alpine

=== Secrets ===
(10+ secrets listed)
```

---

## 🔍 VERIFICATION

### 1. Kiểm tra Nodes

```bash
# SSH vào manager
gcloud compute ssh translation01 --zone=asia-southeast1-a

# List nodes
docker node ls
```

Expected output:
```
ID              HOSTNAME        STATUS    AVAILABILITY    MANAGER STATUS
abc123def456 *  translation01   Ready     Active          Leader
xyz789ghi012    translation02   Ready     Active          
mno345pqr678    translation03   Ready     Active          
```

### 2. Kiểm tra Networks

```bash
docker network ls | grep overlay
```

Expected: 3 networks (backend, frontend, monitoring)

### 3. Kiểm tra Secrets

```bash
docker secret ls
```

Expected: 10+ secrets

### 4. Kiểm tra Services

```bash
docker service ls
```

Expected:
```
NAME       MODE         REPLICAS   IMAGE
postgres   replicated   1/1        postgres:15-alpine
redis      replicated   1/1        redis:7-alpine
```

### 5. Test PostgreSQL

```bash
# Get postgres container ID
POSTGRES_CONTAINER=$(docker ps --filter "name=postgres" --format "{{.ID}}")

# Connect to postgres
docker exec -it $POSTGRES_CONTAINER psql -U postgres -d translation_db

# Test query
\l
\q
```

### 6. Test Redis

```bash
# Get redis container ID
REDIS_CONTAINER=$(docker ps --filter "name=redis" --format "{{.ID}}")

# Connect to redis
docker exec -it $REDIS_CONTAINER redis-cli

# Authenticate (sẽ hỏi password từ secret)
AUTH <password từ .env>

# Test command
PING
# Should return PONG

# Exit
EXIT
```

### 7. Chạy Verification Script

```bash
./verify-phase1.sh
```

Expected: Tất cả tests PASS ✅

---

## 🐛 TROUBLESHOOTING

### Lỗi: SSH Connection Failed

```bash
# Reset SSH connection
gcloud compute config-ssh

# Test again
gcloud compute ssh translation01 --zone=asia-southeast1-a
```

### Lỗi: Docker Installation Failed

```bash
# SSH manually và install
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Update and retry
sudo apt update
curl -fsSL https://get.docker.com | sudo sh
```

### Lỗi: Cannot Join Swarm

```bash
# Check firewall
gcloud compute firewall-rules list

# Create rule if missing
gcloud compute firewall-rules create docker-swarm-internal \
    --allow tcp:2377,tcp:7946,udp:7946,udp:4789 \
    --source-ranges 10.148.0.0/20
```

### Lỗi: Service Not Starting

```bash
# Check logs
docker service logs postgres
docker service logs redis

# Check constraints
docker service inspect postgres

# Check node resources
docker node inspect translation01
```

### Lỗi: Secret Creation Failed

```bash
# Check manager status
docker info | grep "Is Manager"

# Remove and recreate
docker secret rm postgres_password
echo "new_password" | docker secret create postgres_password -
```

---

## 📊 EXPECTED RESOURCE USAGE

Sau Phase 1, resource usage trên mỗi instance:

### Translation01 (Manager)
- CPU: ~15-20% (idle)
- Memory: ~3-4 GB (PostgreSQL + Redis + Swarm)
- Disk: ~5 GB

### Translation02 (Worker 1)
- CPU: ~5% (idle)
- Memory: ~500 MB (Swarm agent)
- Disk: ~2 GB

### Translation03 (Worker 2)
- CPU: ~5% (idle)
- Memory: ~500 MB (Swarm agent)
- Disk: ~2 GB

---

## ✅ COMPLETION CHECKLIST

Phase 1 được coi là hoàn thành khi:

- [ ] Docker installed trên cả 3 instances
- [ ] Swarm cluster active với 1 manager + 2 workers
- [ ] 3 overlay networks created
- [ ] 10+ secrets created
- [ ] Node labels configured
- [ ] PostgreSQL running (1/1 replicas)
- [ ] Redis running (1/1 replicas)
- [ ] Verification script pass 100%
- [ ] Có thể connect vào PostgreSQL
- [ ] Có thể connect vào Redis

---

## 📝 POST-DEPLOYMENT TASKS

### 1. Backup Swarm Tokens

```bash
# Trên translation01
mkdir -p ~/backups
cp -r ~/swarm-tokens ~/backups/swarm-tokens-$(date +%Y%m%d)
```

### 2. Document Current State

```bash
# Save node info
docker node ls > ~/backups/nodes-$(date +%Y%m%d).txt
docker node inspect $(docker node ls -q) > ~/backups/nodes-detail-$(date +%Y%m%d).json

# Save service info
docker service ls > ~/backups/services-$(date +%Y%m%d).txt

# Save network info
docker network ls > ~/backups/networks-$(date +%Y%m%d).txt
```

### 3. Setup Monitoring (Optional)

```bash
# Watch services
watch docker service ls

# Monitor logs
docker service logs -f postgres
docker service logs -f redis
```

---

## 🎯 NEXT STEPS: PHASE 2

Sau khi Phase 1 hoàn thành thành công, bạn sẵn sàng cho:

**Phase 2: Core Services**
- API Gateway
- Authentication Service
- WebSocket Signaling Server
- Frontend Application

Ước tính thời gian: 3-4 ngày

---

## 📞 SUPPORT

Nếu gặp vấn đề:

1. Check logs: `docker service logs <service_name>`
2. Check troubleshooting section above
3. Rerun verification: `./verify-phase1.sh`
4. Contact team với logs và error messages

---

**Last Updated**: October 5, 2025  
**Status**: Production Ready ✅
