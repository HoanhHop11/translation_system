# Cấu hình Firewall Rules - Google Cloud Platform

**Ngày cập nhật**: December 2, 2025  
**Network**: `translation-network`  
**Subnet**: `10.200.0.0/24`

---

## 📋 Tổng quan

Tài liệu này mô tả đầy đủ các Firewall Rules cần thiết cho hệ thống JBCalling Translation. Các rules này đảm bảo:
- Docker Swarm cluster hoạt động ổn định
- WebRTC connectivity cho video call
- AI services communication
- Load balancer health checks
- SSH access cho quản trị

---

## 🔥 Danh sách Firewall Rules

### 1. Docker Swarm - Critical Rules

#### `allow-swarm-full` ⭐ QUAN TRỌNG NHẤT
> Rule này PHẢI có để Docker Swarm overlay network hoạt động đúng

| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-swarm-full` |
| **Priority** | `900` (cao hơn các rule khác) |
| **Direction** | INGRESS |
| **Source** | `10.200.0.0/24` |
| **Protocols** | `tcp:2377`, `tcp:7946`, `udp:7946`, `udp:4789`, `esp` |

**Mục đích các port:**
- `tcp:2377` - Docker Swarm cluster management
- `tcp:7946` - Container network discovery (TCP)
- `udp:7946` - Container network discovery (UDP)
- `udp:4789` - Overlay network traffic (VXLAN)
- `esp` - IP Protocol 50 - Encryption cho overlay network

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-swarm-full \
  --network=translation-network \
  --priority=900 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=10.200.0.0/24 \
  --rules=tcp:2377,tcp:7946,udp:7946,udp:4789,esp \
  --description="Docker Swarm full connectivity - cluster management, node communication, overlay network (VXLAN), and ESP encryption"
```

⚠️ **LƯU Ý**: Nếu thiếu rule này (đặc biệt là `esp` protocol), các container trên worker nodes sẽ KHÔNG thể giao tiếp với nhau qua overlay network!

---

#### `allow-swarm` (Backup rule)
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-swarm` |
| **Priority** | `1000` |
| **Source** | `10.200.0.0/24` |
| **Protocols** | `tcp:2377`, `tcp:7946`, `udp:7946`, `udp:4789` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-swarm \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=10.200.0.0/24 \
  --rules=tcp:2377,tcp:7946,udp:7946,udp:4789 \
  --description="Docker Swarm basic ports"
```

---

### 2. Internal Communication

#### `allow-internal`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-internal` |
| **Priority** | `1000` |
| **Source** | `10.200.0.0/24` |
| **Protocols** | `tcp`, `udp`, `icmp` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-internal \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=10.200.0.0/24 \
  --rules=tcp,udp,icmp \
  --description="Allow all internal traffic between nodes"
```

---

#### `allow-ai-services`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-ai-services` |
| **Priority** | `1000` |
| **Source** | `10.200.0.0/24` |
| **Protocols** | `tcp:8002`, `tcp:8003`, `tcp:8004`, `tcp:8005`, `tcp:6379` |

**Mục đích các port:**
- `tcp:8002` - STT Service (Speech-to-Text)
- `tcp:8003` - Translation Service
- `tcp:8004` - TTS Service (Text-to-Speech)
- `tcp:8005` - Reserved
- `tcp:6379` - Redis

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-ai-services \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=10.200.0.0/24 \
  --rules=tcp:8002,tcp:8003,tcp:8004,tcp:8005,tcp:6379 \
  --description="AI services internal communication"
```

---

### 3. Web Traffic

#### `allow-http-https`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-http-https` |
| **Priority** | `1000` |
| **Source** | `0.0.0.0/0` |
| **Protocols** | `tcp:80`, `tcp:443` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-http-https \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:80,tcp:443 \
  --description="Allow HTTP and HTTPS traffic"
```

---

#### `allow-gateway-http`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-gateway-http` |
| **Priority** | `1000` |
| **Source** | `0.0.0.0/0` |
| **Protocols** | `tcp:3000` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-gateway-http \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:3000 \
  --description="Gateway service HTTP port"
```

---

### 4. WebRTC Traffic

#### `allow-webrtc`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-webrtc` |
| **Priority** | `1000` |
| **Source** | `0.0.0.0/0` |
| **Protocols** | `udp:40000-40100`, `tcp:40000-40100`, `tcp:3478`, `udp:3478`, `tcp:5349` |

**Mục đích các port:**
- `40000-40100` - RTP/RTCP media ports
- `3478` - STUN/TURN (UDP & TCP)
- `5349` - TURN over TLS

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-webrtc \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=udp:40000-40100,tcp:40000-40100,tcp:3478,udp:3478,tcp:5349 \
  --description="WebRTC media and STUN/TURN ports"
```

---

#### `allow-turn-relay`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-turn-relay` |
| **Priority** | `1000` |
| **Source** | `0.0.0.0/0` |
| **Protocols** | `udp:49152-49156` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-turn-relay \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=udp:49152-49156 \
  --description="TURN relay ports"
```

---

#### `allow-nginx-webrtc`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-nginx-webrtc` |
| **Priority** | `1000` |
| **Source** | `0.0.0.0/0` |
| **Protocols** | `tcp:8443`, `tcp:8080` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-nginx-webrtc \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:8443,tcp:8080 \
  --description="Nginx WebRTC proxy ports"
```

---

### 5. SSH Access

#### `allow-ssh`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `allow-ssh` |
| **Priority** | `1000` |
| **Source** | `0.0.0.0/0` |
| **Protocols** | `tcp:22` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create allow-ssh \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:22 \
  --description="SSH access"
```

---

### 6. Health Checks (Google Cloud Load Balancer)

#### `translation-network-allow-health-check`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `translation-network-allow-health-check` |
| **Priority** | `1000` |
| **Source** | `35.191.0.0/16`, `130.211.0.0/22`, `209.85.152.0/22`, `209.85.204.0/22` |
| **Protocols** | `tcp` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create translation-network-allow-health-check \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=35.191.0.0/16,130.211.0.0/22,209.85.152.0/22,209.85.204.0/22 \
  --rules=tcp \
  --description="Google Cloud health check probes"
```

---

#### `translation-network-allow-health-check-ipv6`
| Thuộc tính | Giá trị |
|------------|---------|
| **Tên** | `translation-network-allow-health-check-ipv6` |
| **Priority** | `1000` |
| **Source** | `2600:1901:8001::/48`, `2600:2d00:1:b029::/64` |
| **Protocols** | `tcp` |

**Lệnh tạo:**
```bash
gcloud compute firewall-rules create translation-network-allow-health-check-ipv6 \
  --network=translation-network \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=2600:1901:8001::/48,2600:2d00:1:b029::/64 \
  --rules=tcp \
  --description="Google Cloud health check probes (IPv6)"
```

---

## 🔧 Script Tạo Tất Cả Rules

Lưu script sau và chạy để tạo tất cả firewall rules:

```bash
#!/bin/bash
# File: scripts/setup-firewall-rules.sh
# Tạo tất cả firewall rules cho JBCalling Translation System

NETWORK="translation-network"
SUBNET="10.200.0.0/24"

echo "🔥 Tạo Firewall Rules cho $NETWORK..."

# 1. Docker Swarm Full (QUAN TRỌNG NHẤT)
echo "Creating allow-swarm-full..."
gcloud compute firewall-rules create allow-swarm-full \
  --network=$NETWORK \
  --priority=900 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=$SUBNET \
  --rules=tcp:2377,tcp:7946,udp:7946,udp:4789,esp \
  --description="Docker Swarm full connectivity" || echo "Rule exists"

# 2. Docker Swarm Basic
echo "Creating allow-swarm..."
gcloud compute firewall-rules create allow-swarm \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=$SUBNET \
  --rules=tcp:2377,tcp:7946,udp:7946,udp:4789 \
  --description="Docker Swarm basic ports" || echo "Rule exists"

# 3. Internal Communication
echo "Creating allow-internal..."
gcloud compute firewall-rules create allow-internal \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=$SUBNET \
  --rules=tcp,udp,icmp \
  --description="Internal traffic between nodes" || echo "Rule exists"

# 4. AI Services
echo "Creating allow-ai-services..."
gcloud compute firewall-rules create allow-ai-services \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=$SUBNET \
  --rules=tcp:8002,tcp:8003,tcp:8004,tcp:8005,tcp:6379 \
  --description="AI services internal communication" || echo "Rule exists"

# 5. HTTP/HTTPS
echo "Creating allow-http-https..."
gcloud compute firewall-rules create allow-http-https \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:80,tcp:443 \
  --description="HTTP and HTTPS traffic" || echo "Rule exists"

# 6. Gateway HTTP
echo "Creating allow-gateway-http..."
gcloud compute firewall-rules create allow-gateway-http \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:3000 \
  --description="Gateway service HTTP port" || echo "Rule exists"

# 7. WebRTC
echo "Creating allow-webrtc..."
gcloud compute firewall-rules create allow-webrtc \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=udp:40000-40100,tcp:40000-40100,tcp:3478,udp:3478,tcp:5349 \
  --description="WebRTC media and STUN/TURN ports" || echo "Rule exists"

# 8. TURN Relay
echo "Creating allow-turn-relay..."
gcloud compute firewall-rules create allow-turn-relay \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=udp:49152-49156 \
  --description="TURN relay ports" || echo "Rule exists"

# 9. Nginx WebRTC
echo "Creating allow-nginx-webrtc..."
gcloud compute firewall-rules create allow-nginx-webrtc \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:8443,tcp:8080 \
  --description="Nginx WebRTC proxy ports" || echo "Rule exists"

# 10. SSH
echo "Creating allow-ssh..."
gcloud compute firewall-rules create allow-ssh \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=0.0.0.0/0 \
  --rules=tcp:22 \
  --description="SSH access" || echo "Rule exists"

# 11. Health Check IPv4
echo "Creating translation-network-allow-health-check..."
gcloud compute firewall-rules create translation-network-allow-health-check \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=35.191.0.0/16,130.211.0.0/22,209.85.152.0/22,209.85.204.0/22 \
  --rules=tcp \
  --description="Google Cloud health check probes" || echo "Rule exists"

# 12. Health Check IPv6
echo "Creating translation-network-allow-health-check-ipv6..."
gcloud compute firewall-rules create translation-network-allow-health-check-ipv6 \
  --network=$NETWORK \
  --priority=1000 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=2600:1901:8001::/48,2600:2d00:1:b029::/64 \
  --rules=tcp \
  --description="Google Cloud health check probes (IPv6)" || echo "Rule exists"

echo "✅ Hoàn tất tạo firewall rules!"
echo ""
echo "Kiểm tra lại:"
gcloud compute firewall-rules list --filter="network:$NETWORK" --format="table(name,priority,sourceRanges.list():label=SRC,allowed[].map().firewall_rule().list():label=ALLOW)"
```

---

## 🔍 Troubleshooting

### Vấn đề: Services trên worker nodes không thể giao tiếp

**Triệu chứng:**
- Docker Swarm overlay network không hoạt động
- Container không thể resolve DNS của service khác
- Service replicas 0/1 với lỗi timeout

**Nguyên nhân thường gặp:**
- Thiếu rule `allow-swarm-full` (đặc biệt là `esp` protocol)

**Giải pháp:**
```bash
# Kiểm tra rule đã tồn tại chưa
gcloud compute firewall-rules describe allow-swarm-full

# Nếu chưa có, tạo mới
gcloud compute firewall-rules create allow-swarm-full \
  --network=translation-network \
  --priority=900 \
  --direction=INGRESS \
  --action=ALLOW \
  --source-ranges=10.200.0.0/24 \
  --rules=tcp:2377,tcp:7946,udp:7946,udp:4789,esp \
  --description="Docker Swarm full connectivity"
```

---

### Vấn đề: WebRTC không kết nối được

**Triệu chứng:**
- Video call không thiết lập được
- ICE connection failed

**Giải pháp:**
```bash
# Kiểm tra các rule WebRTC
gcloud compute firewall-rules list --filter="name~webrtc OR name~turn"

# Đảm bảo có đủ các rule:
# - allow-webrtc (ports 40000-40100, 3478, 5349)
# - allow-turn-relay (ports 49152-49156)
# - allow-nginx-webrtc (ports 8443, 8080)
```

---

### Vấn đề: Health check fail

**Triệu chứng:**
- Load balancer báo backend unhealthy
- Services không nhận traffic

**Giải pháp:**
```bash
# Kiểm tra health check rules
gcloud compute firewall-rules list --filter="name~health-check"

# Đảm bảo source ranges bao gồm:
# IPv4: 35.191.0.0/16, 130.211.0.0/22, 209.85.152.0/22, 209.85.204.0/22
# IPv6: 2600:1901:8001::/48, 2600:2d00:1:b029::/64
```

---

## 📊 Tổng kết Rules

| # | Rule Name | Priority | Source | Purpose |
|---|-----------|----------|--------|---------|
| 1 | `allow-swarm-full` | 900 | Internal | Docker Swarm + ESP ⭐ |
| 2 | `allow-swarm` | 1000 | Internal | Docker Swarm basic |
| 3 | `allow-internal` | 1000 | Internal | All internal traffic |
| 4 | `allow-ai-services` | 1000 | Internal | AI services ports |
| 5 | `allow-http-https` | 1000 | Public | Web traffic |
| 6 | `allow-gateway-http` | 1000 | Public | Gateway port 3000 |
| 7 | `allow-webrtc` | 1000 | Public | WebRTC media |
| 8 | `allow-turn-relay` | 1000 | Public | TURN relay |
| 9 | `allow-nginx-webrtc` | 1000 | Public | Nginx proxy |
| 10 | `allow-ssh` | 1000 | Public | SSH access |
| 11 | `health-check` | 1000 | GCP | LB health checks |
| 12 | `health-check-ipv6` | 1000 | GCP | LB health checks IPv6 |

---

## 📝 Checklist Triển Khai Mới

Khi triển khai hệ thống mới, đảm bảo:

- [ ] Network VPC đã tạo với subnet `10.200.0.0/24`
- [ ] **`allow-swarm-full`** đã tạo với priority 900 và bao gồm `esp`
- [ ] Tất cả 12 firewall rules đã tạo
- [ ] Test connectivity giữa các nodes: `nc -zv <IP> 7946`
- [ ] Test Docker Swarm: `docker node ls` (tất cả nodes Ready)
- [ ] Test overlay network: services có thể giao tiếp qua overlay

---

*Tài liệu này được tạo từ cấu hình production của JBCalling Translation System.*
