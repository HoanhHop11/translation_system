# 🔒 HƯỚNG DẪN CÀI ĐẶT DOMAIN & SSL CHO JB CALLING

## ✅ Tổng quan

Chúng ta sẽ sử dụng **Traefik v3** làm reverse proxy với **Let's Encrypt** để tự động:
- Request SSL certificates cho tất cả domains
- Renew certificates trước 30 ngày hết hạn
- Redirect HTTP → HTTPS
- Load balance giữa các replicas

## 📋 Prerequisites

- ✅ Docker Swarm đã setup (3 nodes)
- ✅ Domain: `jbcalling.site` (Hostinger)
- ✅ Email: `hopboy2003@gmail.com` (Let's Encrypt notifications)
- ✅ Firewall đã mở ports: 80, 443

---

## BƯỚC 1: CẤU HÌNH DNS RECORDS

### 1.1. Truy cập DNS Management trên Hostinger

Vào: https://hpanel.hostinger.com/domain/jbcalling.site/dns

### 1.2. Thêm các DNS A Records

| Type | Name       | Value (IP)      | TTL  | Mô tả                          |
|------|------------|-----------------|------|--------------------------------|
| A    | @          | 34.142.190.250  | 3600 | jbcalling.site → Manager       |
| A    | www        | 34.142.190.250  | 3600 | www.jbcalling.site             |
| A    | api        | 34.142.190.250  | 3600 | api.jbcalling.site → API       |
| A    | webrtc     | 34.142.190.250  | 3600 | webrtc.jbcalling.site → WS     |
| A    | monitoring | 34.142.190.250  | 3600 | monitoring.jbcalling.site      |
| A    | traefik    | 34.142.190.250  | 3600 | traefik.jbcalling.site         |

### 1.3. Xóa nameservers của Hostinger (nếu có)

Nếu bạn thấy nameservers `ns1.dns-parking.com` và `ns2.dns-parking.com`, click **"Thay đổi máy chủ tên miền"** và chuyển về Hostinger nameservers mặc định.

### 1.4. Chờ DNS propagate (5-10 phút)

Kiểm tra bằng lệnh:
```bash
# Kiểm tra từ local machine
nslookup jbcalling.site
nslookup api.jbcalling.site
nslookup webrtc.jbcalling.site

# Hoặc dùng online tool
# https://dnschecker.org/#A/jbcalling.site
```

**Kết quả mong đợi:**
```
Name:   jbcalling.site
Address: 34.142.190.250
```

---

## BƯỚC 2: MỞ FIREWALL PORTS

### 2.1. Kiểm tra firewall hiện tại

```bash
gcloud compute firewall-rules list --filter="name~jbcalling" --format="table(name,allowed,sourceRanges)"
```

### 2.2. Mở ports 80 và 443 (nếu chưa mở)

```bash
# HTTP (port 80)
gcloud compute firewall-rules create jbcalling-http \
  --allow tcp:80 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow HTTP traffic for Let's Encrypt" \
  --target-tags=jbcalling

# HTTPS (port 443)
gcloud compute firewall-rules create jbcalling-https \
  --allow tcp:443 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow HTTPS traffic" \
  --target-tags=jbcalling

# WebSocket (port 8001)
gcloud compute firewall-rules create jbcalling-websocket \
  --allow tcp:8001 \
  --source-ranges 0.0.0.0/0 \
  --description "Allow WebSocket signaling" \
  --target-tags=jbcalling
```

### 2.3. Apply tags cho instances

```bash
# Instance 1 - Manager
gcloud compute instances add-tags translation01 \
  --zone=asia-southeast1-a \
  --tags=jbcalling

# Instance 2 - Worker
gcloud compute instances add-tags translation02 \
  --zone=asia-southeast1-b \
  --tags=jbcalling

# Instance 3 - Worker
gcloud compute instances add-tags translation03 \
  --zone=asia-southeast1-b \
  --tags=jbcalling
```

---

## BƯỚC 3: COPY FILES LÊN SERVER

### 3.1. Copy stack-with-ssl.yml

```bash
cd ~/jbcalling_translation_realtime

# Copy lên Manager node
gcloud compute scp infrastructure/swarm/stack-with-ssl.yml \
  translation01:~/jbcalling_translation_realtime/stack-with-ssl.yml \
  --zone=asia-southeast1-a
```

### 3.2. Verify file

```bash
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="ls -lh ~/jbcalling_translation_realtime/stack-with-ssl.yml"
```

---

## BƯỚC 4: DEPLOY STACK VỚI SSL

### 4.1. Remove stack cũ (nếu đang chạy)

```bash
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
  cd ~/jbcalling_translation_realtime && \
  source .env && \
  sudo -E docker stack rm translation && \
  echo 'Waiting for services to stop...' && \
  sleep 20
"
```

### 4.2. Deploy stack mới với SSL

```bash
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
  cd ~/jbcalling_translation_realtime && \
  source .env && \
  sudo -E docker stack deploy -c stack-with-ssl.yml translation && \
  echo '' && \
  echo '⏳ Waiting 60 seconds for services to start...' && \
  sleep 60 && \
  echo '' && \
  sudo docker stack services translation
"
```

### 4.3. Kiểm tra status

```bash
# Xem tất cả services
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="sudo docker stack services translation"

# Xem logs của Traefik
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="sudo docker service logs translation_traefik --tail 50"

# Xem logs của API
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="sudo docker service logs translation_api --tail 30"
```

---

## BƯỚC 5: XÁC MINH SSL CERTIFICATES

### 5.1. Chờ Let's Encrypt issue certificates

Traefik sẽ tự động request certificates khi có request đầu tiên. Quá trình này mất khoảng 30-60 giây.

```bash
# Xem logs của Traefik để theo dõi quá trình issue cert
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="sudo docker service logs translation_traefik -f | grep -i 'certificate\|acme'"
```

**Kết quả mong đợi:**
```
traefik    | time="..." level=info msg="Generating ACME Account..."
traefik    | time="..." level=info msg="The key type is empty. Use default key type 4096."
traefik    | time="..." level=info msg="Certificates obtained for domains [jbcalling.site]"
```

### 5.2. Test HTTPS endpoints

```bash
# Test frontend
curl -I https://jbcalling.site

# Test API
curl https://api.jbcalling.site/health

# Test với browser
# https://jbcalling.site
# https://api.jbcalling.site/docs
# https://monitoring.jbcalling.site
```

### 5.3. Kiểm tra SSL certificate details

```bash
# Xem certificate info
echo | openssl s_client -connect jbcalling.site:443 -servername jbcalling.site 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates

# Hoặc dùng online tool
# https://www.ssllabs.com/ssltest/analyze.html?d=jbcalling.site
```

**Kết quả mong đợi:**
```
subject=CN = jbcalling.site
issuer=C = US, O = Let's Encrypt, CN = R3
notBefore=Oct  5 10:00:00 2025 GMT
notAfter=Jan  3 10:00:00 2026 GMT
```

---

## BƯỚC 6: CẬP NHẬT FRONTEND ĐỂ SỬ DỤNG HTTPS

Hiện tại frontend đang hardcode API URLs. Chúng ta cần rebuild với biến môi trường đúng.

### 6.1. Kiểm tra .env

File `.env` đã có:
```properties
DOMAIN_NAME=jbcalling.site
API_DOMAIN=api.jbcalling.site
WEBRTC_DOMAIN=webrtc.jbcalling.site
```

### 6.2. Frontend sẽ tự động sử dụng HTTPS

Trong `stack-with-ssl.yml`, frontend đã được cấu hình:
```yaml
environment:
  - VITE_API_URL=https://${API_DOMAIN}
  - VITE_WS_URL=wss://${WEBRTC_DOMAIN}
```

Nginx sẽ inject các biến này vào runtime.

---

## BƯỚC 7: TRUY CẬP ỨNG DỤNG

### 7.1. Các URLs có sẵn

| Service           | URL                                    | Credentials           |
|-------------------|----------------------------------------|-----------------------|
| **Frontend**      | https://jbcalling.site                 | -                     |
| **API Docs**      | https://api.jbcalling.site/docs        | -                     |
| **API Health**    | https://api.jbcalling.site/health      | -                     |
| **Grafana**       | https://monitoring.jbcalling.site      | admin / (from .env)   |
| **Traefik**       | https://traefik.jbcalling.site         | admin / admin         |

### 7.2. Test WebSocket connection

Mở browser console tại https://jbcalling.site và chạy:

```javascript
const ws = new WebSocket('wss://webrtc.jbcalling.site');
ws.onopen = () => console.log('✅ WebSocket connected!');
ws.onerror = (e) => console.error('❌ WebSocket error:', e);
ws.onclose = () => console.log('WebSocket closed');
```

---

## BƯỚC 8: TỰ ĐỘNG RENEW CERTIFICATES

### 8.1. Traefik tự động renew

Traefik sẽ tự động:
- Check certificates mỗi ngày
- Renew khi còn dưới 30 ngày
- Zero downtime renew

### 8.2. Verify auto-renew

```bash
# Xem ACME storage
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
  sudo docker exec \$(sudo docker ps -q -f name=translation_traefik) cat /letsencrypt/acme.json | jq '.letsencrypt.Certificates[] | {domain: .domain.main, notAfter}'
"
```

---

## 🔍 TROUBLESHOOTING

### Issue 1: DNS chưa propagate

**Triệu chứng:**
```
curl: (6) Could not resolve host: jbcalling.site
```

**Giải pháp:**
- Chờ 5-10 phút
- Kiểm tra DNS với: `dig jbcalling.site @8.8.8.8`
- Clear DNS cache: `sudo systemd-resolve --flush-caches`

---

### Issue 2: Let's Encrypt rate limit

**Triệu chứng:**
```
acme: error: 429 :: too many requests
```

**Giải pháp:**
- Let's Encrypt có limit: 5 certificates/domain/week
- Sử dụng staging environment để test:
  
Uncomment dòng này trong stack-with-ssl.yml:
```yaml
# - "--certificatesresolvers.letsencrypt.acme.caserver=https://acme-staging-v02.api.letsencrypt.org/directory"
```

Sau khi test xong, comment lại và redeploy.

---

### Issue 3: Certificate validation failed

**Triệu chứng:**
```
acme: error: 403 :: urn:ietf:params:acme:error:unauthorized
```

**Giải pháp:**
- Kiểm tra port 80 có mở: `sudo netstat -tulpn | grep :80`
- Kiểm tra firewall: `gcloud compute firewall-rules list | grep 80`
- Kiểm tra DNS trỏ đúng IP

---

### Issue 4: Traefik không start

**Triệu chứng:**
```
translation_traefik replicated 0/1
```

**Giải pháp:**
```bash
# Xem logs
sudo docker service logs translation_traefik --tail 50

# Check placement constraints
sudo docker service inspect translation_traefik --format '{{.Spec.TaskTemplate.Placement}}'

# Verify manager node
sudo docker node ls | grep Leader
```

---

### Issue 5: Services không accessible qua domain

**Triệu chứng:**
- Frontend accessible qua IP nhưng không qua domain
- 404 Not Found khi access domain

**Giải pháp:**
```bash
# Kiểm tra Traefik có thấy services không
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
  sudo docker exec \$(sudo docker ps -q -f name=translation_traefik) \
    wget -qO- http://localhost:8080/api/http/routers | jq
"

# Kiểm tra labels của services
sudo docker service inspect translation_api --format '{{json .Spec.Labels}}' | jq

# Restart Traefik
sudo docker service update --force translation_traefik
```

---

## 📊 MONITORING

### Kiểm tra service health

```bash
# All services status
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="sudo docker stack services translation"

# Detailed service info
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="sudo docker service ps translation_api --no-trunc"
```

### Xem Traefik Dashboard

1. Truy cập: https://traefik.jbcalling.site
2. Login: `admin` / `admin` (ĐỔI PASSWORD TRONG PRODUCTION!)
3. Xem routers, services, middlewares

### Xem Grafana Monitoring

1. Truy cập: https://monitoring.jbcalling.site
2. Login với credentials từ `.env`
3. Import dashboard cho Traefik metrics

---

## ✅ CHECKLIST

- [ ] DNS records đã thêm và propagate
- [ ] Firewall ports 80, 443, 8001 đã mở
- [ ] Stack đã deploy thành công
- [ ] Tất cả services đang chạy (replicas OK)
- [ ] Traefik đã issue SSL certificates
- [ ] Frontend accessible qua https://jbcalling.site
- [ ] API accessible qua https://api.jbcalling.site
- [ ] WebSocket kết nối qua wss://webrtc.jbcalling.site
- [ ] Grafana accessible qua https://monitoring.jbcalling.site
- [ ] HTTP tự động redirect sang HTTPS
- [ ] SSL certificates hợp lệ (check với SSLLabs)

---

## 🔐 SECURITY CHECKLIST

- [ ] ĐỔI password Traefik dashboard (không dùng admin/admin)
- [ ] ĐỔI password Grafana
- [ ] Setup firewall rules chặn IP không cần thiết
- [ ] Enable rate limiting trong Traefik
- [ ] Setup backup cho acme.json (chứa certificates)
- [ ] Monitor certificate expiry alerts

---

## 🎉 KẾT QUẢ MONG ĐỢI

Sau khi hoàn thành:

✅ **Frontend**: https://jbcalling.site với SSL A+ rating
✅ **API**: https://api.jbcalling.site/docs với Swagger UI
✅ **WebSocket**: wss://webrtc.jbcalling.site với secure connection
✅ **Monitoring**: https://monitoring.jbcalling.site
✅ **Auto SSL renewal**: Certificates tự động renew mỗi 60 ngày

---

## 📞 HỖ TRỢ

Nếu gặp vấn đề, kiểm tra logs:

```bash
# Traefik logs
sudo docker service logs translation_traefik -f

# API logs
sudo docker service logs translation_api -f

# Frontend logs
sudo docker service logs translation_frontend -f
```

Hoặc hỏi tôi! 😊
