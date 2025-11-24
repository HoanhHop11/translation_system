 # IPv6 Quick Start - TL;DR

**Date**: November 17, 2025  
**Purpose**: Quick reference cho việc enable IPv6 trên production

---

## 🚀 Quick Commands (Copy-Paste)

### Step 1: Enable IPv6 trên GCP

```bash
# Enable IPv6 cho subnet
gcloud compute networks subnets update default \
  --region=asia-southeast1 \
  --stack-type=IPV4_IPV6 \
  --ipv6-access-type=EXTERNAL

# Add IPv6 cho translation01
gcloud compute instances network-interfaces update translation01 \
  --zone=asia-southeast1-b \
  --stack-type=IPV4_IPV6 \
  --ipv6-network-tier=PREMIUM

# Lấy IPv6 address
gcloud compute instances describe translation01 \
  --zone=asia-southeast1-b \
  --format="get(networkInterfaces[0].ipv6AccessConfigs[0].externalIpv6)"
```

### Step 2: Kiểm tra & Add Network Tag

```bash
# Check tags hiện tại
gcloud compute instances describe translation01 \
  --zone=asia-southeast1-b \
  --format="value(tags.items)"

# Add tag nếu chưa có
gcloud compute instances add-tags translation01 \
  --zone=asia-southeast1-b \
  --tags=translation-webrtc
```

### Step 3: Create Firewall Rules

```bash
# WebRTC ports (40000-40100)
gcloud compute firewall-rules create allow-webrtc-ipv6 \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=udp:40000-40100,tcp:40000-40100 \
  --source-ranges=::/0 \
  --target-tags=translation-webrtc \
  --description="WebRTC IPv6 - ports 40000-40100"

# HTTPS/HTTP
gcloud compute firewall-rules create allow-gateway-https-ipv6 \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443,tcp:80 \
  --source-ranges=::/0 \
  --target-tags=translation-webrtc \
  --description="HTTPS IPv6"
```

### Step 4: Update Stack Configuration

```bash
# Edit stack-hybrid.yml
vim infrastructure/swarm/stack-hybrid.yml

# Uncomment và update 2 dòng này trong gateway service:
#   - ANNOUNCED_IPV6=<YOUR_IPV6_FROM_STEP1>
#   - ENABLE_IPV6=true
```

### Step 5: Deploy

```bash
# Build Gateway với IPv6 support
cd services/gateway
docker build -t jackboun11/jbcalling-gateway:1.0.5-ipv6 .
docker push jackboun11/jbcalling-gateway:1.0.5-ipv6

# Update stack
vim infrastructure/swarm/stack-hybrid.yml
# Change: image: jackboun11/jbcalling-gateway:1.0.5-ipv6

# Deploy
scp infrastructure/swarm/stack-hybrid.yml translation01:/tmp/
ssh translation01 'docker stack deploy -c /tmp/stack-hybrid.yml translation'
```

---

## 📝 DNS Configuration (Hostinger)

1. Login: https://hpanel.hostinger.com
2. Domains → jbcalling.site → DNS Records
3. Add AAAA record:
   - Type: **AAAA**
   - Name: **webrtc**
   - Points to: **<YOUR_IPV6>** (from Step 1)
   - TTL: **300**
4. Save & wait 5-15 minutes

Verify:
```bash
dig AAAA webrtc.jbcalling.site +short
```

---

## ✅ Verification Checklist

```bash
# 1. Check VM có IPv6
ssh translation01 'ip -6 addr show | grep inet6'

# 2. Check firewall rules
gcloud compute firewall-rules list --filter="name~ipv6"

# 3. Check Gateway logs
ssh translation01 'docker service logs translation_gateway --tail 50 | grep -i "ipv6\|::"'

# 4. Test connectivity (replace with your IPv6)
ping6 <YOUR_IPV6>
telnet -6 <YOUR_IPV6> 443

# 5. Test WebRTC
# Open browser → https://jbcalling.site/room/test123
# Check chrome://webrtc-internals for IPv6 candidates
```

---

## 🔧 Configuration Summary

**Ports**: 40000-40100 (UDP/TCP) - đã khớp với stack hiện tại

**Environment Variables**:
```yaml
- ANNOUNCED_IPV6=<your_ipv6>  # e.g., 2600:1900:4020:1234::1
- ENABLE_IPV6=true
```

**DNS Records Needed**:
- A record: webrtc.jbcalling.site → 34.143.235.114 (IPv4)
- AAAA record: webrtc.jbcalling.site → <your_ipv6> (IPv6)

**Firewall Tags**: translation-webrtc (must be on translation01)

---

## 🚨 Troubleshooting

### Issue: "Cannot bind to ::"
**Solution**: VM chưa có IPv6 interface, check Step 1

### Issue: Firewall không hoạt động
**Solution**: Check network tag với `gcloud compute instances describe`

### Issue: ICE chỉ có IPv4
**Solution**: 
1. Check ANNOUNCED_IPV6 env var
2. Check Gateway logs: `docker service logs translation_gateway | grep ANNOUNCED_IPV6`
3. Verify DNS AAAA record đã propagate

---

## 📊 Expected Results

Sau khi deploy xong:

**Gateway Logs sẽ hiện**:
```
Listening on 0.0.0.0:3000 (IPv4)
Listening on [::]:3000 (IPv6)
MediaSoup workers configured with dual-stack
```

**ICE Candidates sẽ bao gồm**:
- IPv4: `candidate:... typ host ... 34.143.235.114 40000`
- IPv6: `candidate:... typ host ... [2600:1900:...] 40000`

**WebRTC Connection**:
- IPv4 client → Gateway (IPv4): ✅
- IPv6 client → Gateway (IPv6): ✅
- Dual-stack client: Prefer IPv6 (nếu có)

---

## 📚 Full Documentation

See: `docs/11-IPV6-SETUP-GUIDE.md` for complete details

## 🤖 Automated Setup

Use helper script:
```bash
./scripts/setup-ipv6-gcp.sh [--dry-run]
```

Or test script:
```bash
./scripts/test-ipv6.sh <your_ipv6_address>
```
