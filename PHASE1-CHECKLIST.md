# ✅ PHASE 1 - PRE-DEPLOYMENT CHECKLIST

**Date**: October 5, 2025  
**Phase**: Infrastructure Setup  
**Duration**: 30-60 phút (tự động) | 2-3 giờ (thủ công)

---

## 🎯 MỤC TIÊU PHASE 1

- [ ] Docker Engine cài đặt trên 3 instances
- [ ] Docker Swarm cluster (1 manager + 2 workers)
- [ ] Overlay networks (backend, frontend, monitoring)
- [ ] Docker secrets (10+ secrets)
- [ ] PostgreSQL service running
- [ ] Redis service running

---

## ☑️ PRE-DEPLOYMENT CHECKLIST

### 1. Environment Configuration

- [ ] File `.env` tồn tại tại `/home/hopboy2003/jbcalling_translation_realtime/.env`
- [ ] Tất cả biến môi trường đã được điền (không có giá trị trống)
- [ ] Instance IPs đã được verify:
- [ ] `INSTANCE_01_IP=34.143.235.114` ✓
- [ ] `INSTANCE_02_IP=34.142.190.250` ✓
- [ ] `INSTANCE_03_IP=34.126.138.3` ✓
- [ ] Passwords đã được generate (minimum 16 characters):
  - [ ] `POSTGRES_PASSWORD` ✓
  - [ ] `REDIS_PASSWORD` ✓
  - [ ] `GRAFANA_ADMIN_PASSWORD` ✓
- [ ] Security keys đã được generate:
  - [ ] `JWT_SECRET_KEY` (64 chars) ✓
  - [ ] `SESSION_SECRET_KEY` (64 chars) ✓
  - [ ] `ENCRYPTION_KEY` (64 chars) ✓
- [ ] API tokens:
  - [ ] `HF_TOKEN=YOUR_HF_TOKEN_HERE` ✓

**Verification Command**:
```bash
cd /home/hopboy2003/jbcalling_translation_realtime
grep -E "INSTANCE_|PASSWORD|SECRET|HF_TOKEN" .env | grep -v "^#" | grep "="
```

Expected: Tất cả dòng phải có giá trị sau dấu `=`

---

### 2. Access & Permissions

- [ ] gcloud CLI đã được cài đặt và cấu hình
- [ ] Đã đăng nhập vào gcloud: `gcloud auth list`
- [ ] Project đã được set: `gcloud config get-value project`
- [ ] SSH keys đã được cấu hình: `gcloud compute config-ssh`
- [ ] Có thể SSH vào translation01:
  ```bash
  gcloud compute ssh translation01 --zone=asia-southeast1-a --command="hostname"
  ```
  Expected output: `translation01`
  
- [ ] Có thể SSH vào translation02:
  ```bash
  gcloud compute ssh translation02 --zone=asia-southeast1-b --command="hostname"
  ```
  Expected output: `translation02`
  
- [ ] Có thể SSH vào translation03:
  ```bash
  gcloud compute ssh translation03 --zone=asia-southeast1-b --command="hostname"
  ```
  Expected output: `translation03`

---

### 3. Network & Firewall

- [ ] Firewall rule cho Docker Swarm tồn tại hoặc sẽ được tạo
- [ ] Kiểm tra firewall rules:
  ```bash
  gcloud compute firewall-rules list --filter="name:docker-swarm"
  ```

- [ ] Nếu chưa có, tạo rule:
  ```bash
  gcloud compute firewall-rules create docker-swarm-internal \
      --allow tcp:2377,tcp:7946,udp:7946,udp:4789 \
      --source-ranges 10.148.0.0/20 \
      --description "Docker Swarm internal communication"
  ```

**Required Ports**:
- `2377/tcp` - Cluster management
- `7946/tcp` - Node communication
- `7946/udp` - Node communication  
- `4789/udp` - Overlay network traffic

---

### 4. Instance Status

- [ ] translation01 đang chạy (Status: RUNNING)
  ```bash
  gcloud compute instances describe translation01 --zone=asia-southeast1-a --format="get(status)"
  ```
  
- [ ] translation02 đang chạy (Status: RUNNING)
  ```bash
  gcloud compute instances describe translation02 --zone=asia-southeast1-b --format="get(status)"
  ```
  
- [ ] translation03 đang chạy (Status: RUNNING)
  ```bash
  gcloud compute instances describe translation03 --zone=asia-southeast1-b --format="get(status)"
  ```

---

### 5. Scripts & Files

- [ ] Thư mục `scripts/phase1/` tồn tại
- [ ] Tất cả scripts có quyền executable:
  ```bash
  ls -lh scripts/phase1/*.sh
  ```
  Expected: Tất cả file có `x` permission

- [ ] Scripts tồn tại:
  - [ ] `01-install-docker.sh` ✓
  - [ ] `02-init-swarm-manager.sh` ✓
  - [ ] `03-join-swarm-worker.sh` ✓
  - [ ] `04-label-nodes.sh` ✓
  - [ ] `05-create-secrets.sh` ✓
  - [ ] `06-deploy-base-services.sh` ✓
  - [ ] `verify-phase1.sh` ✓
  - [ ] `deploy-phase1.sh` ✓ (master script)

---

### 6. Disk Space

- [ ] Đủ disk space trên local machine cho logs (~1GB)
- [ ] Instances có đủ disk space:
  ```bash
  gcloud compute ssh translation01 --zone=asia-southeast1-a --command="df -h"
  ```
  Expected: 
  - translation01: >30GB free (cho PostgreSQL data)
  - translation02: >20GB free
  - translation03: >15GB free

---

### 7. Documentation Review

- [ ] Đã đọc `docs/PHASE1-DEPLOYMENT.md`
- [ ] Đã đọc `scripts/phase1/README.md`
- [ ] Hiểu các bước trong deployment flow
- [ ] Biết cách troubleshoot nếu có lỗi

---

## 🚀 READY TO DEPLOY?

Nếu TẤT CẢ các items trên đã được check ✓, bạn sẵn sàng để deploy!

### Option 1: Auto Deployment (Khuyến nghị)

```bash
cd /home/hopboy2003/jbcalling_translation_realtime
./scripts/quickstart-phase1.sh
```

hoặc

```bash
./scripts/phase1/deploy-phase1.sh
```

### Option 2: Manual Step-by-Step

Làm theo hướng dẫn trong `scripts/phase1/README.md`

---

## ⏱️ TIMELINE

| Step | Task | Duration | Status |
|------|------|----------|--------|
| 1 | Copy scripts | 2 min | ⏳ |
| 2 | Install Docker (Manager) | 5 min | ⏳ |
| 3 | Install Docker (Worker 1) | 5 min | ⏳ |
| 4 | Install Docker (Worker 2) | 5 min | ⏳ |
| 5 | Init Swarm Manager | 2 min | ⏳ |
| 6 | Join Worker 1 | 1 min | ⏳ |
| 7 | Join Worker 2 | 1 min | ⏳ |
| 8 | Label Nodes | 1 min | ⏳ |
| 9 | Create Secrets | 2 min | ⏳ |
| 10 | Deploy Services | 5 min | ⏳ |
| 11 | Verify | 3 min | ⏳ |
| **Total** | | **30-35 min** | |

*Note: Thời gian thực tế có thể lâu hơn 45-60 phút do network latency*

---

## 📊 SUCCESS CRITERIA

Phase 1 thành công khi:

### Swarm Cluster
```bash
docker node ls
# Output: 3 nodes (1 Leader, 2 workers), all Ready
```

### Networks
```bash
docker network ls | grep overlay
# Output: backend, frontend, monitoring
```

### Secrets
```bash
docker secret ls | wc -l
# Output: >= 10
```

### Services
```bash
docker service ls
# Output:
# postgres   1/1   postgres:15-alpine
# redis      1/1   redis:7-alpine
```

### Verification Script
```bash
./verify-phase1.sh
# Output: All tests PASSED ✅
```

---

## 🆘 IF SOMETHING FAILS

1. **Không panic** - Deployment có thể retry
2. **Check logs** - Xem error message cụ thể
3. **Reference troubleshooting** - `docs/PHASE1-DEPLOYMENT.md`
4. **Retry specific step** - Có thể rerun individual scripts
5. **Contact support** - Với logs và error details

---

## 📝 POST-DEPLOYMENT

Sau khi Phase 1 hoàn thành:

- [ ] Chạy verification script: `./verify-phase1.sh`
- [ ] Backup swarm tokens: Copy `~/swarm-tokens/` trên manager
- [ ] Document deployment time và issues (nếu có)
- [ ] Take snapshot của trạng thái hiện tại
- [ ] Review logs cho warnings/errors
- [ ] Update checklist này với actual results

---

## ✅ SIGN-OFF

**Deployed by**: _________________  
**Date/Time**: _________________  
**Duration**: _________ minutes  
**Issues encountered**: _________________  
**Status**: ☐ Success | ☐ Partial | ☐ Failed  

**Notes**:
```
(Ghi chú bất kỳ vấn đề, workaround, hoặc observations)
```

---

**Next Phase**: [Phase 2 - Core Services](./PHASE2-CHECKLIST.md)
