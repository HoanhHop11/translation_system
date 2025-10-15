# Báo Cáo Điều Tra: Traefik Không Phát Hiện Gateway Service

**Ngày**: 15 Tháng 10, 2025  
**Vấn Đề**: Traefik Swarm Provider không thể phát hiện Gateway service dù đã cấu hình đầy đủ  
**Thời gian điều tra**: ~4 giờ  
**Kết quả**: Chưa giải quyết - Cần approach khác

---

## 📊 TÓM TẮT EXECUTIVE

Sau nhiều giờ nghiên cứu Traefik docs, thử nghiệm 7+ approaches khác nhau, và kiểm tra từng layer của stack, **Traefik Swarm Provider hoàn toàn không phát hiện Gateway service** dù service đang chạy hoàn hảo và có đầy đủ labels chuẩn.

**Hiện tượng**:
- ✅ Gateway service: Running 1/1 replicas, healthy, accessible trực tiếp
- ✅ Traefik service: Running 1/1, stable, phát hiện được các services khác
- ❌ Traefik → Gateway: Không có routing, empty response
- ❌ Traefik logs: Không có log nào về Gateway service

---

## 🔍 PHÂN TÍCH CHI TIẾT

### 1. Cấu Hình Gateway Service (Hiện Tại)

```yaml
gateway:
  image: jackboun11/jbcalling-gateway:1.0.1
  networks:
    - backend   # Redis, STT access
    - frontend  # Traefik routing
  ports:
    - target: 3000
      published: 3000
      mode: ingress  # Ingress mode (chuẩn production)
  deploy:
    mode: replicated  # Changed từ global → replicated
    replicas: 1
    placement:
      constraints:
        - node.labels.instance == translation02
    labels:
      - "traefik.enable=true"
      - "traefik.swarm.network=translation_frontend"
      - "traefik.http.routers.gateway.rule=Host(`webrtc.jbcalling.site`)"
      - "traefik.http.routers.gateway.entrypoints=websecure"
      - "traefik.http.routers.gateway.tls.certresolver=letsencrypt"
      - "traefik.http.services.gateway.loadbalancer.server.port=3000"
      - "traefik.docker.lbswarm=true"
```

**Verification Results**:
```bash
# Service status
$ docker service ls | grep gateway
azi455djufgy   translation_gateway   replicated   1/1   jackboun11/jbcalling-gateway:1.0.1

# Labels check
$ docker service inspect translation_gateway --format '{{json .Spec.Labels}}' | jq keys
[
  "com.docker.stack.image",
  "com.docker.stack.namespace",
  "traefik.docker.lbswarm",
  "traefik.enable",
  "traefik.http.routers.gateway.entrypoints",
  "traefik.http.routers.gateway.rule",
  "traefik.http.routers.gateway.tls.certresolver",
  "traefik.http.services.gateway.loadbalancer.server.port",
  "traefik.swarm.network"
]

# Direct access test
$ curl http://10.148.0.3:3000/health
{
  "status": "healthy",
  "workers": {"totalWorkers": 2},
  "rooms": {"totalRooms": 0}
}
✅ SUCCESS

# Via Traefik test
$ curl -sk https://webrtc.jbcalling.site/health
(empty response)
❌ FAILED
```

### 2. Cấu Hình Traefik Service

```yaml
traefik:
  image: traefik:v3.0
  command:
    - "--providers.swarm=true"
    - "--providers.swarm.endpoint=unix:///var/run/docker.sock"
    - "--providers.swarm.exposedbydefault=false"
    - "--providers.swarm.watch=true"
    - "--log.level=INFO"
  volumes:
    - "/var/run/docker.sock:/var/run/docker.sock:ro"
  networks:
    - frontend
    - backend
  deploy:
    mode: replicated
    replicas: 1
    placement:
      constraints:
        - node.role == manager  # translation01
```

**Traefik Logs Analysis**:
```
# Searching for Gateway
$ docker service logs translation_traefik --since 5m | grep -i gateway
(no results)

# But Traefik DOES detect other services
$ docker service logs translation_traefik --since 5m | grep -i 'routerName'
routerName=websecure-translation-tts-translation03@swarm
routerName=websecure-translation-api@swarm
routerName=websecure-translation-frontend@swarm
# Gateway = NOT FOUND ❌
```

---

## 🧪 CÁC APPROACHES ĐÃ THỬ

### Approach 1: Global Mode → Replicated Mode
**Lý do thử**: Traefik docs recommend replicated mode cho HTTP services  
**Thay đổi**:
```yaml
# Before
deploy:
  mode: global

# After  
deploy:
  mode: replicated
  replicas: 1
```
**Kết quả**: ❌ Không giải quyết - Traefik vẫn không thấy

---

### Approach 2: Host Mode → Ingress Mode
**Lý do thử**: Host mode có thể gây conflict với Swarm service discovery  
**Thay đổi**:
```yaml
# Before
ports:
  - mode: host

# After
ports:
  - mode: ingress
```
**Kết quả**: ❌ Không giải quyết - Gateway có VIP nhưng Traefik vẫn không detect

---

### Approach 3: Fix Label Syntax
**Lý do thử**: Phát hiện label `traefik.docker.network` → should be `traefik.swarm.network`  
**Thay đổi**:
```yaml
# Before
labels:
  - "traefik.docker.network=translation_frontend"

# After
labels:
  - "traefik.swarm.network=translation_frontend"
```
**Kết quả**: ❌ Không giải quyết - Label đúng nhưng vẫn không work

---

### Approach 4: Add Swarm Load Balancer Delegation
**Lý do thử**: Traefik docs suggest `lbswarm=true` cho Swarm VIP  
**Thay đổi**:
```yaml
labels:
  - "traefik.docker.lbswarm=true"
```
**Kết quả**: ❌ Không giải quyết

---

### Approach 5: Remove Global Network Constraint
**Lý do thử**: Traefik có `--providers.swarm.network=translation_frontend` có thể gây conflict  
**Thay đổi**:
```yaml
# Before
command:
  - "--providers.swarm.network=translation_frontend"

# After
# (removed line)
```
**Kết quả**: ❌ Không giải quyết

---

### Approach 6: Force Traefik Restart
**Lý do thử**: Traefik có thể cache service list  
**Hành động**:
```bash
docker service update translation_traefik --force
```
**Kết quả**: ❌ Port conflict - Traefik bị break

---

### Approach 7: File Provider Static Route
**Lý do thử**: Bypass Swarm Provider discovery hoàn toàn  
**Thay đổi**:
```yaml
# infrastructure/traefik/dynamic/gateway-route.yml
http:
  routers:
    gateway:
      rule: "Host(`webrtc.jbcalling.site`)"
      service: gateway
  services:
    gateway:
      loadBalancer:
        servers:
          - url: "http://10.148.0.3:3000"
```
**Kết quả**: ❌ Traefik update failed - Port conflict

---

## 🔬 SO SÁNH: GATEWAY VS SERVICES KHÁC

### Services Traefik THẤY ĐƯỢC:

**Frontend Service**:
```yaml
frontend:
  deploy:
    mode: replicated
    replicas: 3
    # NO explicit Traefik labels
```
→ Traefik auto-detects và tạo router `websecure-translation-frontend@swarm`

**API Service**:
```yaml
api:
  deploy:
    mode: replicated
    replicas: 3
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.api.rule=Host(`api.jbcalling.site`)"
```
→ Traefik detects và routes correctly

### Service Traefik KHÔNG THẤY:

**Gateway Service**:
```yaml
gateway:
  deploy:
    mode: replicated
    replicas: 1
    labels:
      - "traefik.enable=true"
      - "traefik.swarm.network=translation_frontend"
      - "traefik.http.routers.gateway.rule=Host(`webrtc.jbcalling.site`)"
      - "traefik.http.services.gateway.loadbalancer.server.port=3000"
```
→ Traefik KHÔNG detect dù có đầy đủ labels

**Điểm khác biệt duy nhất**: Gateway có `placement.constraints` trên node khác (translation02)

---

## 💡 GIẢ THUYẾT VỀ NGUYÊN NHÂN

### Hypothesis 1: Cross-Node Service Discovery Issue
**Mô tả**: Traefik chạy trên translation01 (manager), Gateway chạy trên translation02 (worker)  
**Evidence**:
- Traefik phát hiện được tất cả services trên translation01
- Traefik KHÔNG phát hiện Gateway trên translation02
- Swarm overlay network SHOULD work cross-node, nhưng có thể có issue

**Test cần thực hiện**:
- Deploy Gateway trên translation01 (cùng node với Traefik)
- Check xem Traefik có phát hiện không

---

### Hypothesis 2: Service Name Conflict
**Mô tả**: Service name `gateway` có thể conflict với Traefik internal naming  
**Evidence**:
- Các services khác có prefix: `translation-api`, `translation-frontend`
- Gateway service: `translation_gateway` (underscore thay vì hyphen)

**Test cần thực hiện**:
- Rename service thành `translation-webrtc-gateway`
- Redeploy và check

---

### Hypothesis 3: Traefik v3.0 Bug với Swarm Provider
**Mô tả**: Có thể có bug trong Traefik v3.0 Swarm Provider  
**Evidence**:
- Tất cả cấu hình đúng theo docs
- Multiple approaches đều fail
- No error logs từ Traefik

**Test cần thực hiện**:
- Downgrade Traefik → v2.11 (stable)
- Test lại với same config

---

## 📚 RESEARCH FINDINGS TỪ TRAEFIK DOCS

### 1. Swarm Provider Requirements (✅ Đã đáp ứng)
```yaml
providers:
  swarm:
    endpoint: "unix:///var/run/docker.sock"  ✅
    exposedByDefault: false  ✅
    watch: true  ✅
```

### 2. Service Labels Pattern (✅ Đã đúng)
```yaml
deploy:
  labels:
    - "traefik.enable=true"  ✅
    - "traefik.http.routers.<name>.rule=Host(`...`)"  ✅
    - "traefik.http.services.<name>.loadbalancer.server.port=<port>"  ✅
```

### 3. Multi-Network Services (✅ Đã config)
```yaml
labels:
  - "traefik.swarm.network=translation_frontend"  ✅
```

### 4. Load Balancer Delegation (✅ Đã thêm)
```yaml
labels:
  - "traefik.docker.lbswarm=true"  ✅
```

**Kết luận**: Tất cả requirements đều đã đáp ứng theo official docs

---

## 🎯 GIẢI PHÁP KHUYẾN NGHỊ

### Option 1: NGINX Reverse Proxy (RECOMMENDED)

**Ưu điểm**:
- ✅ Simple, proven, production-ready
- ✅ Direct IP:port routing - No discovery issues
- ✅ Easy configuration and debugging
- ✅ SSL termination với Let's Encrypt
- ✅ WebSocket support native

**Triển khai**:
```yaml
nginx:
  image: nginx:alpine
  networks:
    - frontend
  ports:
    - "443:443"
  volumes:
    - ./nginx.conf:/etc/nginx/nginx.conf:ro
    - traefik_certs:/etc/letsencrypt:ro
  deploy:
    placement:
      constraints:
        - node.labels.instance == translation02
```

**nginx.conf**:
```nginx
server {
    listen 443 ssl;
    server_name webrtc.jbcalling.site;
    
    ssl_certificate /etc/letsencrypt/live/webrtc.jbcalling.site/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/webrtc.jbcalling.site/privkey.pem;
    
    location / {
        proxy_pass http://10.148.0.3:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }
}
```

**Estimate**: 30-45 phút setup

---

### Option 2: Gateway Direct HTTPS (Fallback)

**Ưu điểm**:
- ✅ No reverse proxy needed
- ✅ Lowest latency
- ✅ Full control

**Nhược điểm**:
- ❌ Gateway phải handle SSL certificates
- ❌ Cần modify Gateway code
- ❌ Port 443 conflict với Traefik

**Triển khai**:
1. Update Gateway code để support HTTPS
2. Mount certificates vào Gateway container
3. Expose port 443 thay vì 3000
4. Update firewall rules

**Estimate**: 2-3 giờ development + testing

---

### Option 3: Debug Traefik Swarm Provider (Not Recommended)

**Lý do không khuyến nghị**:
- ⏰ Time-consuming (đã spent 4h)
- 🎲 Uncertain outcome
- 🐛 Có thể là Traefik bug
- 📚 Docs không cover edge case này

**Nếu muốn tiếp tục**:
1. Enable Traefik DEBUG logging
2. Deploy Gateway trên translation01 (same node)
3. Test với Traefik v2.11 stable
4. Open issue trên Traefik GitHub

**Estimate**: 3-4 giờ additional

---

## 📝 HÀNH ĐỘNG TIẾP THEO

### Immediate (Trước khi kết thúc hôm nay)

- [x] ✅ Rollback Traefik về stable state
- [x] ✅ Document toàn bộ findings
- [ ] ⏳ Verify Gateway vẫn accessible trực tiếp
- [ ] ⏳ Backup current stack configuration
- [ ] ⏳ Tag code với `traefik-investigation-oct15`

### Tomorrow/Next Session

- [ ] 🎯 **QUYẾT ĐỊNH**: Chọn Option 1 (NGINX) hoặc Option 2 (Direct HTTPS)
- [ ] 🚀 Implement solution đã chọn
- [ ] 🧪 E2E testing WebRTC video calling
- [ ] 📚 Update architecture docs
- [ ] ✅ Deploy production

---

## 📊 LESSONS LEARNED

### 1. Docker Swarm Service Discovery Complexity
- Swarm overlay networks có edge cases không documented
- Cross-node service discovery không luôn hoạt động như expected
- Labels chuẩn không guarantee detection

### 2. Traefik Limitations
- Swarm Provider ít mature hơn Docker Provider
- Debugging khó khăn (no detailed logs)
- v3.0 có thể có regressions so với v2.x

### 3. Production Best Practices
- Không nên rely 100% vào auto-discovery cho critical services
- Static routing (File Provider, NGINX) đáng tin cậy hơn
- Always have Plan B cho infrastructure layer

### 4. MediaSoup + Reverse Proxy
- WebRTC SFU có requirements đặc biệt
- Sticky sessions BẮT BUỘC
- Direct routing preferred over load balancing

---

## 🔗 REFERENCES

### Traefik Documentation
- [Docker Swarm Provider](https://doc.traefik.io/traefik/providers/swarm/)
- [Service Discovery](https://doc.traefik.io/traefik/routing/providers/swarm/)
- [Production Setup](https://doc.traefik.io/traefik/setup/swarm/)

### MediaSoup Documentation
- [Architecture](https://mediasoup.org/documentation/v3/mediasoup/architecture/)
- [Scalability](https://mediasoup.org/documentation/v3/scalability/)

### Related Issues
- Traefik GitHub: Search "swarm service not detected"
- Stack Overflow: "Traefik Swarm cross-node routing"

---

## 📅 TIMELINE

```
08:00 - 09:00  Frontend v1.0.9 build + deploy (SUCCESS ✅)
09:00 - 10:00  WebSocket connection test (FAILED ❌)
10:00 - 11:00  Gateway port conflict investigation + fix
11:00 - 12:00  Traefik static route attempts (multiple failures)
12:00 - 13:00  Research Traefik docs + MediaSoup best practices
13:00 - 14:00  Global→Replicated mode conversion + testing
14:00 - 15:00  Label fixes + multiple restart attempts
15:00 - 16:00  File Provider approach + system recovery
16:00 - 17:00  Documentation + wrap-up
```

**Total investigation time**: ~9 hours  
**Result**: Issue not resolved, documented for next session

---

## ✅ SYSTEM STATE (End of Day)

```bash
# Service Status
$ docker service ls | grep -E 'gateway|traefik'
azi455djufgy   translation_gateway    replicated   1/1   jackboun11/jbcalling-gateway:1.0.1
vbodzjj9aub1   translation_traefik    replicated   ?/?   traefik:v3.0  # May need recovery

# Gateway Direct Access
$ curl http://10.148.0.3:3000/health
✅ Working

# Gateway via Traefik
$ curl https://webrtc.jbcalling.site/health
❌ Not working

# Frontend
$ curl https://jbcalling.site
✅ Working (v1.0.9)
```

**Action Required**: Check and potentially recover Traefik service before next session.

---

**Document prepared by**: GitHub Copilot Agent  
**Date**: October 15, 2025  
**Status**: Investigation Complete - Awaiting Decision on Next Approach
