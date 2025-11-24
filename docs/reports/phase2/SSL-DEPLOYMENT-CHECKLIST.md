# ✅ SSL DEPLOYMENT CHECKLIST

## 📅 Ngày triển khai: _____________

## ⏱️ Thời gian bắt đầu: _____________

---

## PHASE 1: CHUẨN BỊ (5 phút)

- [ ] Đã đọc hướng dẫn trong `docs/SSL-DEPLOYMENT-GUIDE.md`
- [ ] Đã có tài khoản Hostinger với domain `jbcalling.site`
- [ ] Đã có email `hopboy2003@gmail.com` để nhận thông báo Let's Encrypt
- [ ] Files đã được copy lên server:
  - [ ] `stack-with-ssl.yml`
  - [ ] `deploy-ssl.sh`

---

## PHASE 2: CẤU HÌNH DNS (10 phút)

### Thêm DNS Records trên Hostinger

- [ ] Truy cập: https://hpanel.hostinger.com/domain/jbcalling.site/dns
- [ ] Thêm record: `A` | `@` → `34.142.190.250` | TTL: 3600
- [ ] Thêm record: `A` | `www` → `34.142.190.250` | TTL: 3600
- [ ] Thêm record: `A` | `api` → `34.142.190.250` | TTL: 3600
- [ ] Thêm record: `A` | `webrtc` → `34.142.190.250` | TTL: 3600
- [ ] Thêm record: `A` | `monitoring` → `34.142.190.250` | TTL: 3600
- [ ] Thêm record: `A` | `traefik` → `34.142.190.250` | TTL: 3600

### Kiểm tra Nameservers

- [ ] Kiểm tra xem có dùng `ns1.dns-parking.com` không
- [ ] Nếu có → Click "Thay đổi máy chủ tên miền"
- [ ] Chọn "Sử dụng máy chủ tên miền mặc định của Hostinger"
- [ ] Save changes

### Chờ DNS Propagate

- [ ] Chờ 5-10 phút
- [ ] Test: `nslookup jbcalling.site 8.8.8.8`
- [ ] Kết quả: `Address: 34.142.190.250` ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 3: KIỂM TRA FIREWALL (2 phút)

- [ ] Kiểm tra port 80 đã mở
- [ ] Kiểm tra port 443 đã mở
- [ ] Kiểm tra port 8001 đã mở (WebSocket)

```bash
gcloud compute firewall-rules list --filter="name~jbcalling"
```

**Kết quả:**
- [ ] `jbcalling-http` (port 80) exists ✅
- [ ] `jbcalling-https` (port 443) exists ✅
- [ ] `jbcalling-websocket` (port 8001) exists ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 4: DEPLOY STACK (5 phút)

### SSH vào Manager Node

```bash
gcloud compute ssh translation01 --zone=asia-southeast1-a
```

- [ ] Đã SSH thành công

### Chạy Deploy Script

```bash
cd ~/jbcalling_translation_realtime
chmod +x deploy-ssl.sh
./deploy-ssl.sh
```

- [ ] Script bắt đầu chạy
- [ ] DNS check passed ✅
- [ ] Firewall check passed ✅
- [ ] Backup created ✅
- [ ] Old stack removed ✅
- [ ] New stack deployed ✅
- [ ] Services starting...

### Chờ Services Ready

- [ ] Traefik: 1/1 replicas ✅
- [ ] PostgreSQL: 1/1 replicas ✅
- [ ] Redis: 1/1 replicas ✅
- [ ] API: 2/2 replicas ✅
- [ ] Signaling: 2/2 replicas ✅
- [ ] Frontend: 2/2 replicas ✅
- [ ] Grafana: 1/1 replicas ✅
- [ ] Prometheus: 1/1 replicas ✅
- [ ] Loki: 1/1 replicas ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 5: XÁC MINH SSL CERTIFICATES (3 phút)

### Kiểm tra Traefik Logs

```bash
sudo docker service logs translation_traefik --tail 50 | grep -i "certificate\|acme"
```

**Kết quả mong đợi:**
- [ ] `Generating ACME Account...` ✅
- [ ] `Certificates obtained for domains [jbcalling.site]` ✅
- [ ] `Certificates obtained for domains [api.jbcalling.site]` ✅
- [ ] `Certificates obtained for domains [monitoring.jbcalling.site]` ✅

### Test HTTPS Endpoints

```bash
# Test frontend
curl -I https://jbcalling.site

# Test API
curl https://api.jbcalling.site/health
```

- [ ] Frontend: Status `200` hoặc `301` ✅
- [ ] API: Status `200` ✅
- [ ] Response có `{"status":"ok"}` ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 6: KIỂM TRA TRÊN BROWSER (5 phút)

### Frontend

- [ ] Mở: https://jbcalling.site
- [ ] Trang load thành công ✅
- [ ] Có icon khóa xanh (SSL valid) 🔒 ✅
- [ ] Không có warning SSL ✅

### API Documentation

- [ ] Mở: https://api.jbcalling.site/docs
- [ ] Swagger UI hiển thị ✅
- [ ] Có thể thử API endpoints ✅
- [ ] SSL valid 🔒 ✅

### Monitoring

- [ ] Mở: https://monitoring.jbcalling.site
- [ ] Grafana login page hiển thị ✅
- [ ] Login với credentials từ `.env` ✅
- [ ] Dashboard accessible ✅
- [ ] SSL valid 🔒 ✅

### Traefik Dashboard

- [ ] Mở: https://traefik.jbcalling.site
- [ ] Basic auth popup hiển thị ✅
- [ ] Login: `admin` / `admin` ✅
- [ ] Dashboard hiển thị routers và services ✅
- [ ] Thấy tất cả certificates ✅
- [ ] SSL valid 🔒 ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 7: KIỂM TRA SSL RATING (5 phút)

### SSL Labs Test

- [ ] Truy cập: https://www.ssllabs.com/ssltest/
- [ ] Nhập: `jbcalling.site`
- [ ] Chạy test (mất 2-3 phút)
- [ ] Kết quả: Grade **A** hoặc **A+** ✅

### Certificate Details

```bash
echo | openssl s_client -connect jbcalling.site:443 -servername jbcalling.site 2>/dev/null | \
  openssl x509 -noout -subject -issuer -dates
```

**Kết quả mong đợi:**
- [ ] `subject=CN = jbcalling.site` ✅
- [ ] `issuer=C = US, O = Let's Encrypt, CN = R3` ✅
- [ ] `notBefore`: hôm nay ✅
- [ ] `notAfter`: +90 ngày ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 8: KIỂM TRA AUTO-REDIRECT HTTP → HTTPS (2 phút)

```bash
# Test HTTP redirect
curl -I http://jbcalling.site
```

**Kết quả mong đợi:**
- [ ] Status: `301 Moved Permanently` ✅
- [ ] `Location: https://jbcalling.site` ✅

```bash
# Test API HTTP redirect
curl -I http://api.jbcalling.site
```

- [ ] Status: `301 Moved Permanently` ✅
- [ ] `Location: https://api.jbcalling.site` ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 9: KIỂM TRA WEBSOCKET (3 phút)

### Browser Console Test

1. Mở: https://jbcalling.site
2. Mở Developer Console (F12)
3. Chạy:

```javascript
const ws = new WebSocket('wss://webrtc.jbcalling.site');
ws.onopen = () => console.log('✅ WebSocket connected!');
ws.onerror = (e) => console.error('❌ WebSocket error:', e);
ws.onmessage = (m) => console.log('📨 Message:', m.data);
```

**Kết quả:**
- [ ] `✅ WebSocket connected!` hiển thị ✅
- [ ] Không có error ✅
- [ ] Connection secure (wss://) 🔒 ✅

**Thời gian hoàn thành:** _____________

---

## PHASE 10: SECURITY HARDENING (10 phút)

### Đổi Traefik Dashboard Password

```bash
# Generate new password hash
echo $(htpasswd -nb admin your_new_password) | sed -e s/\\$/\\$\\$/g
```

- [ ] Copy hash mới
- [ ] Update trong `stack-with-ssl.yml`
- [ ] Redeploy: `sudo docker stack deploy -c stack-with-ssl.yml translation`

### Đổi Grafana Password

- [ ] Login vào Grafana
- [ ] Vào: Profile → Change Password
- [ ] Đổi password mới
- [ ] Update trong `.env`

### Review CORS Settings

- [ ] Kiểm tra `CORS_ORIGINS` trong `.env`
- [ ] Chỉ cho phép domains cần thiết
- [ ] Không có `*` wildcard

**Thời gian hoàn thành:** _____________

---

## PHASE 11: MONITORING SETUP (5 phút)

### Prometheus Targets

- [ ] Vào: https://monitoring.jbcalling.site/datasources
- [ ] Add Prometheus datasource
- [ ] URL: `http://prometheus:9090`
- [ ] Test connection ✅

### Import Traefik Dashboard

- [ ] Vào: Dashboards → Import
- [ ] Dashboard ID: `17346` (Traefik Official)
- [ ] Select Prometheus datasource
- [ ] Import ✅

### Setup Alerts (Optional)

- [ ] Certificate expiry alert (< 30 days)
- [ ] Service down alert
- [ ] High error rate alert

**Thời gian hoàn thành:** _____________

---

## PHASE 12: BACKUP & DOCUMENTATION (5 phút)

### Backup SSL Certificates

```bash
# Backup acme.json
sudo docker exec $(sudo docker ps -q -f name=translation_traefik) \
  cat /letsencrypt/acme.json > ~/backup-acme-$(date +%Y%m%d).json
```

- [ ] File backup tạo thành công ✅
- [ ] Download về local machine ✅

### Update Documentation

- [ ] Update `docs/08-DEPLOYMENT.md` với SSL info
- [ ] Update `README.md` với HTTPS URLs
- [ ] Commit changes
- [ ] Push to repository

**Thời gian hoàn thành:** _____________

---

## 🎉 FINAL CHECKLIST

- [ ] ✅ Tất cả domains accessible qua HTTPS
- [ ] ✅ HTTP tự động redirect sang HTTPS
- [ ] ✅ SSL certificates hợp lệ (Let's Encrypt)
- [ ] ✅ SSL Labs rating: A hoặc A+
- [ ] ✅ WebSocket secure connection (wss://)
- [ ] ✅ Grafana monitoring accessible
- [ ] ✅ Traefik dashboard accessible
- [ ] ✅ Passwords đã đổi (không dùng default)
- [ ] ✅ Monitoring setup với alerts
- [ ] ✅ Backup certificates
- [ ] ✅ Documentation updated

---

## ⏱️ TỔNG THỜI GIAN

- Thời gian bắt đầu: _____________
- Thời gian kết thúc: _____________
- **Tổng cộng:** _____________ phút

---

## 📝 GHI CHÚ & ISSUES

### Issues gặp phải:

1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

### Giải pháp:

1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

---

## ✅ DEPLOYMENT APPROVED BY

- Tên: _______________________
- Ngày: _______________________
- Chữ ký: _______________________

---

## 📞 SUPPORT CONTACTS

- GitHub Issues: https://github.com/your-repo/issues
- Email: hopboy2003@gmail.com
- Slack: #jbcalling-support

---

**🎉 DEPLOYMENT COMPLETED SUCCESSFULLY! 🎉**
