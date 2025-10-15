# 🚀 Phase 1: Infrastructure Setup Scripts

## Tổng quan

Phase 1 thiết lập hạ tầng cơ bản cho hệ thống:
- Cài đặt Docker trên 3 instances
- Khởi tạo Docker Swarm cluster
- Cấu hình networks và labels
- Tạo Docker secrets
- Deploy base services (PostgreSQL, Redis)

**Thời gian ước tính**: 2-3 giờ

---

## 📋 Checklist

- [ ] Đã có file `.env` với thông tin đầy đủ
- [ ] Có quyền SSH vào 3 instances
- [ ] Đã verify IP addresses
- [ ] Đã có Hugging Face token

---

## 🎯 Thứ tự Thực hiện

### Bước 1: Cài Docker trên Translation01 (Manager)

```bash
# SSH vào translation01
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Copy script
# (Từ máy local)
gcloud compute scp scripts/phase1/01-install-docker.sh translation01:~ --zone=asia-southeast1-a

# Chạy script
chmod +x 01-install-docker.sh
./01-install-docker.sh

# Logout và login lại
exit
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Verify
docker --version
docker ps
```

### Bước 2: Cài Docker trên Translation02 (Worker)

```bash
# SSH vào translation02
gcloud compute ssh translation02 --zone=asia-southeast1-b

# Copy script
gcloud compute scp scripts/phase1/01-install-docker.sh translation02:~ --zone=asia-southeast1-b

# Chạy script
chmod +x 01-install-docker.sh
./01-install-docker.sh

# Logout và login lại
exit
gcloud compute ssh translation02 --zone=asia-southeast1-b

# Verify
docker --version
```

### Bước 3: Cài Docker trên Translation03 (Worker)

```bash
# SSH vào translation03
gcloud compute ssh translation03 --zone=asia-southeast1-b

# Copy script
gcloud compute scp scripts/phase1/01-install-docker.sh translation03:~ --zone=asia-southeast1-b

# Chạy script
chmod +x 01-install-docker.sh
./01-install-docker.sh

# Logout và login lại
exit
gcloud compute ssh translation03 --zone=asia-southeast1-b

# Verify
docker --version
```

### Bước 4: Khởi tạo Swarm trên Translation01

```bash
# SSH vào translation01
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Copy script
gcloud compute scp scripts/phase1/02-init-swarm-manager.sh translation01:~ --zone=asia-southeast1-a

# Chạy script
chmod +x 02-init-swarm-manager.sh
./02-init-swarm-manager.sh

# Lưu join command
cat ~/swarm-tokens/worker-join-command.sh
```

### Bước 5: Join Translation02 vào Swarm

```bash
# Copy join script và token
gcloud compute scp scripts/phase1/03-join-swarm-worker.sh translation02:~ --zone=asia-southeast1-b

# SSH vào translation02
gcloud compute ssh translation02 --zone=asia-southeast1-b

# Lấy token từ translation01
# Cách 1: Copy manual từ output ở bước 4
# Cách 2: Copy file token
# gcloud compute scp translation01:~/swarm-tokens/worker-join-command.sh . --zone=asia-southeast1-a

# Chạy join script
chmod +x 03-join-swarm-worker.sh
# Thay <TOKEN> và <MANAGER_IP> bằng giá trị thực
./03-join-swarm-worker.sh "<WORKER_TOKEN>" "10.148.0.5"
```

### Bước 6: Join Translation03 vào Swarm

```bash
# Copy join script
gcloud compute scp scripts/phase1/03-join-swarm-worker.sh translation03:~ --zone=asia-southeast1-b

# SSH vào translation03
gcloud compute ssh translation03 --zone=asia-southeast1-b

# Chạy join script (dùng token từ bước 4)
chmod +x 03-join-swarm-worker.sh
./03-join-swarm-worker.sh "<WORKER_TOKEN>" "10.148.0.5"
```

### Bước 7: Gắn Labels cho Nodes

```bash
# Trên translation01
gcloud compute scp scripts/phase1/04-label-nodes.sh translation01:~ --zone=asia-southeast1-a

# SSH vào translation01
gcloud compute ssh translation01 --zone=asia-southeast1-a

chmod +x 04-label-nodes.sh
./04-label-nodes.sh

# Verify
docker node ls
```

### Bước 8: Tạo Docker Secrets

```bash
# Copy .env file lên translation01
gcloud compute scp .env translation01:~/jbcalling_translation_realtime/.env --zone=asia-southeast1-a

# Copy script
gcloud compute scp scripts/phase1/05-create-secrets.sh translation01:~ --zone=asia-southeast1-a

# Chạy script
chmod +x 05-create-secrets.sh
./05-create-secrets.sh

# Verify
docker secret ls
```

### Bước 9: Deploy Base Services

```bash
# Copy script
gcloud compute scp scripts/phase1/06-deploy-base-services.sh translation01:~ --zone=asia-southeast1-a

# Chạy script
chmod +x 06-deploy-base-services.sh
./06-deploy-base-services.sh

# Monitor deployment
watch docker service ls

# Check logs
docker service logs postgres
docker service logs redis
```

### Bước 10: Verify Phase 1

```bash
# Copy verification script
gcloud compute scp scripts/phase1/verify-phase1.sh translation01:~ --zone=asia-southeast1-a

# Chạy verification
chmod +x verify-phase1.sh
./verify-phase1.sh
```

---

## 📊 Expected Results

Sau khi hoàn thành Phase 1, bạn sẽ có:

### ✅ Docker Swarm Cluster
```
ID              HOSTNAME        STATUS    AVAILABILITY    MANAGER STATUS
abc123def456 *  translation01   Ready     Active          Leader
xyz789ghi012    translation02   Ready     Active          
mno345pqr678    translation03   Ready     Active          
```

### ✅ Networks
```
backend      (overlay)
frontend     (overlay)
monitoring   (overlay)
```

### ✅ Secrets (10+)
```
postgres_password
postgres_user
postgres_db
redis_password
jwt_secret_key
session_secret_key
encryption_key
hf_token
grafana_admin_password
```

### ✅ Running Services
```
NAME       REPLICAS    IMAGE                  
postgres   1/1         postgres:15-alpine     
redis      1/1         redis:7-alpine         
```

### ✅ Node Labels
- translation01: `role=manager`, `type=processing`, `ai=true`
- translation02: `role=worker`, `type=gateway`, `webrtc=true`
- translation03: `role=worker`, `type=monitoring`, `monitor=true`

---

## 🐛 Troubleshooting

### Lỗi: Cannot join swarm
```bash
# Check firewall - port 2377 phải mở
sudo ufw status
sudo ufw allow 2377/tcp

# Check kết nối
ping <MANAGER_IP>
telnet <MANAGER_IP> 2377
```

### Lỗi: Service không start
```bash
# Check logs
docker service logs <service_name>

# Check constraints
docker service inspect <service_name> | grep -A 5 Constraints

# Check resources
docker node inspect <node_id> | grep -A 10 Resources
```

### Lỗi: Secret không tạo được
```bash
# Check manager status
docker info | grep "Is Manager"

# Xóa secret cũ nếu conflict
docker secret rm <secret_name>

# Tạo lại
echo "value" | docker secret create <secret_name> -
```

---

## 📝 Notes

1. **Manager IP**: Internal IP `10.148.0.5` được dùng cho Swarm communication
2. **Firewall**: Ports 2377, 7946, 4789 cần được mở giữa các instances
3. **Resources**: Services có limits để tránh OOM
4. **Persistence**: Volumes được tạo tự động cho PostgreSQL và Redis
5. **Security**: Secrets được encrypt và chỉ accessible bởi assigned services

---

## ✅ Completion Criteria

Phase 1 được coi là hoàn thành khi:

- [ ] 3 instances có Docker installed và running
- [ ] Swarm cluster với 1 manager + 2 workers
- [ ] 3 overlay networks created
- [ ] Tất cả secrets created (10+)
- [ ] Node labels configured đúng
- [ ] PostgreSQL service running (1/1 replicas)
- [ ] Redis service running (1/1 replicas)
- [ ] Verification script pass 100%

---

**Next**: [Phase 2 - Core Services](../../docs/PHASE2-GUIDE.md)
