# 🔑 HƯỚNG DẪN SETUP SSH KEYS - JB CALLING SWARM CLUSTER

**Ngày**: October 6, 2025  
**Mục đích**: Setup SSH keys để các instances có thể SSH vào nhau

---

## 📋 BƯỚC 1: COPY PUBLIC KEY

SSH Public Key đã được tạo trên **translation02**:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGNwZRpAG5OROx4Ajqzn9SbKYtFm+UT3tB52+uK2OHji hopboy2003@jbcalling-swarm
```

**⚠️ QUAN TRỌNG**: Copy dòng trên (bao gồm cả `ssh-ed25519` và `hopboy2003@jbcalling-swarm`)

---

## 🌐 BƯỚC 2: THÊM VÀO GOOGLE CLOUD METADATA

### Cách 1: Project-wide SSH Keys (KHUYẾN NGHỊ - Áp dụng cho tất cả instances)

1. **Mở Google Cloud Console**: https://console.cloud.google.com

2. **Đi tới Compute Engine → Metadata**:
   - Menu bên trái: Click "Compute Engine"
   - Click "Metadata" (ở menu con)
   - Hoặc: https://console.cloud.google.com/compute/metadata

3. **Tab SSH Keys**:
   - Click tab "SSH Keys" (ở đầu trang)

4. **Add SSH Key**:
   - Click button "Edit" (góc trên)
   - Click "Add item"
   - Paste public key vào ô trống:
     ```
     ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGNwZRpAG5OROx4Ajqzn9SbKYtFm+UT3tB52+uK2OHji hopboy2003@jbcalling-swarm
     ```
   - Click "Save" (ở cuối trang)

5. **Đợi 1-2 phút** để key được propagate tới tất cả instances

### Cách 2: Per-Instance SSH Keys (Nếu cách 1 không work)

Lặp lại cho **3 instances** (translation01, 02, 03):

1. **Mở Compute Engine → VM Instances**:
   - https://console.cloud.google.com/compute/instances

2. **Click vào instance** (ví dụ: translation01)

3. **Click "Edit"** (ở đầu trang)

4. **Scroll xuống "SSH Keys"**:
   - Click "Show and edit"
   - Click "Add item"
   - Paste public key vào ô

5. **Click "Save"** (ở cuối trang)

6. **Lặp lại** cho translation02 và translation03

---

## ✅ BƯỚC 3: VERIFY TRÊN GOOGLE CLOUD

Sau khi thêm key, verify bằng cách:

1. **Vào Compute Engine → Metadata → SSH Keys**
2. **Kiểm tra** có dòng:
   ```
   hopboy2003@jbcalling-swarm
   ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGNwZRpAG5OROx4Ajqzn9SbKYtFm+UT3tB52+uK2OHji
   ```

---

## 🔧 BƯỚC 4: TEST CONNECTION (Trên translation02)

Sau khi thêm key vào Google Cloud, test kết nối:

```bash
# Test SSH to translation01 (Manager)
ssh translation01 'hostname && whoami'
# Expected: translation01
#           hopboy2003

# Test SSH to translation03 (Worker)
ssh translation03 'hostname && whoami'
# Expected: translation03
#           hopboy2003

# Test SSH to chính nó (translation02)
ssh translation02 'hostname && whoami'
# Expected: translation02
#           hopboy2003
```

---

## 🚀 BƯỚC 5: SAU KHI SSH WORK

Khi SSH đã work, tôi có thể:

```bash
# SSH vào Manager node từ translation02
ssh translation01

# Trong translation01, kiểm tra Swarm:
sudo docker node ls
sudo docker service ls
sudo docker service ps <service_name>

# Hoặc chạy từ xa:
ssh translation01 "sudo docker node ls"
ssh translation01 "sudo docker service ls"
```

---

## 📝 FILES ĐÃ TẠO

### Trên translation02:
1. **SSH Keys**:
   - Private key: `~/.ssh/id_ed25519_swarm` (đã tạo)
   - Public key: `~/.ssh/id_ed25519_swarm.pub` (đã tạo)

2. **SSH Config**:
   - File: `~/.ssh/config` (đã tạo)
   - Cho phép: `ssh translation01`, `ssh translation02`, `ssh translation03`

3. **Scripts & Templates**:
   - `scripts/setup-ssh-keys.sh` - Script setup tự động
   - `ssh-config-template` - Template SSH config

---

## 🔄 SETUP TRÊN INSTANCES KHÁC (Optional)

Nếu bạn muốn SSH từ translation01 hoặc translation03:

### Trên translation01:
```bash
# SSH vào translation01 từ máy local
gcloud compute ssh translation01 --zone=asia-southeast1-a

# Tạo SSH key
ssh-keygen -t ed25519 -C "hopboy2003@jbcalling-swarm" -f ~/.ssh/id_ed25519_swarm -N ""

# Copy public key và thêm vào Google Cloud (như bước 1-2)
cat ~/.ssh/id_ed25519_swarm.pub

# Copy SSH config
cat > ~/.ssh/config << 'EOF'
Host translation01
    HostName 10.148.0.5
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no

Host translation02
    HostName 10.148.0.3
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no

Host translation03
    HostName 10.148.0.4
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
EOF

chmod 600 ~/.ssh/config
```

### Tương tự cho translation03

---

## ⚠️ TROUBLESHOOTING

### Issue 1: "Permission denied (publickey)"
**Nguyên nhân**: Public key chưa được thêm vào Google Cloud hoặc chưa propagate

**Giải pháp**:
1. Verify key đã thêm vào Google Cloud Metadata
2. Đợi 2-3 phút để propagate
3. Restart instance nếu cần: `sudo reboot`

### Issue 2: "Host key verification failed"
**Giải pháp**:
```bash
ssh-keygen -R translation01
ssh-keygen -R 10.148.0.5
```

### Issue 3: SSH config không work
**Giải pháp**:
```bash
# Check SSH config syntax
cat ~/.ssh/config

# Check file permissions
ls -la ~/.ssh/
# config should be: -rw------- (600)

# Fix permissions:
chmod 700 ~/.ssh
chmod 600 ~/.ssh/config
chmod 600 ~/.ssh/id_ed25519_swarm
chmod 644 ~/.ssh/id_ed25519_swarm.pub
```

---

## ✅ CHECKLIST

Trước khi tiếp tục:

- [ ] Public key đã copy chính xác (bao gồm `ssh-ed25519` và comment)
- [ ] Đã thêm key vào Google Cloud Metadata
- [ ] Đợi 2-3 phút cho key propagate
- [ ] Test SSH: `ssh translation01 hostname` → return `translation01`
- [ ] Test SSH: `ssh translation03 hostname` → return `translation03`

Sau khi checklist hoàn tất, tôi có thể:
- ✅ SSH vào translation01 (Manager node)
- ✅ Chạy `docker node ls` để xem toàn bộ cluster
- ✅ Chạy `docker service ls` để xem tất cả services
- ✅ Kiểm tra placement và logs của services

---

## 🎯 NEXT STEPS

**SAU KHI SSH WORK:**

1. **SSH vào Manager node**:
   ```bash
   ssh translation01
   ```

2. **Kiểm tra Swarm cluster**:
   ```bash
   sudo docker node ls
   sudo docker service ls
   sudo docker network ls | grep translation
   ```

3. **Kiểm tra service placement**:
   ```bash
   sudo docker service ps translation_stt
   sudo docker service ps translation_translation
   sudo docker service ps translation_traefik
   sudo docker service ps translation_api
   ```

4. **Tạo báo cáo chính xác** về trạng thái hệ thống dựa trên thông tin thực tế

---

**Tạo bởi**: GitHub Copilot Agent  
**Ngày**: October 6, 2025  
**Status**: ⏳ WAITING FOR SSH KEY SETUP
