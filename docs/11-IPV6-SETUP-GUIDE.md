# IPv6 Setup Guide - WebRTC Gateway Dual-Stack Configuration

**Date**: November 17, 2025  
**Status**: Implementation Guide  
**Phase**: Infrastructure Enhancement  

---

## 📋 Executive Summary

Hướng dẫn này mô tả các bước cấu hình IPv6 cho WebRTC Gateway để hỗ trợ dual-stack (IPv4 + IPv6), đảm bảo tương thích dài hạn với các client chỉ có IPv6.

## 🎯 Lợi ích của IPv6

1. **Tương lai-proof**: Nhiều mạng di động chỉ có IPv6
2. **Kết nối tốt hơn**: Giảm NAT traversal issues
3. **Compliance**: Yêu cầu của một số nhà mạng/quốc gia
4. **Performance**: Ít hop hơn cho IPv6-only clients

---

## 🏗️ Phase 1: Google Cloud Infrastructure Setup

### Bước 1: Enable IPv6 cho VPC Subnet

```bash
# 1. Kiểm tra VPC và subnet hiện tại
gcloud compute networks subnets list --filter="name=default" \
  --format="table(name,region,ipCidrRange,stackType)"

# 2. Enable IPv6 cho subnet (nếu chưa có)
# NOTE: GCP yêu cầu subnet có IPv6 range trước khi gán IPv6 cho VM
gcloud compute networks subnets update default \
  --region=asia-southeast1 \
  --stack-type=IPV4_IPV6 \
  --ipv6-access-type=EXTERNAL

# 3. Verify subnet đã có IPv6
gcloud compute networks subnets describe default \
  --region=asia-southeast1 \
  --format="get(stackType,ipv6CidrRange)"
```

**⚠️ Lưu ý quan trọng**:
- Subnet phải ở `stackType=IPV4_IPV6` trước khi add IPv6 cho VM
- GCP tự động allocate `/96` IPv6 range cho mỗi VM interface
- Không thể chuyển subnet về IPv4-only sau khi enable IPv6

### Bước 2: Gán IPv6 External Address cho translation01

```bash
# 1. Add IPv6 access config cho translation01 (Gateway node)
gcloud compute instances network-interfaces update translation01 \
  --zone=asia-southeast1-b \
  --stack-type=IPV4_IPV6 \
  --ipv6-network-tier=PREMIUM

# 2. Lấy IPv6 address được gán
gcloud compute instances describe translation01 \
  --zone=asia-southeast1-b \
  --format="get(networkInterfaces[0].ipv6AccessConfigs[0].externalIpv6)"

# Output example: 2600:1900:4020:xxxx::/96
# Địa chỉ đầu tiên trong range (::1) là địa chỉ chính
```

**📝 Ghi chú IPv6 Address**:
```
translation01 IPv6: ________________________________
Format: 2600:1900:4020:xxxx::1 (hoặc tương tự)
```

### Bước 3: Configure Firewall Rules cho IPv6

**⚠️ Quan trọng**: Kiểm tra network tags của VM trước:
```bash
# Kiểm tra tags hiện tại
gcloud compute instances describe translation01 \
  --zone=asia-southeast1-b \
  --format="value(tags.items)"

# Nếu chưa có tag, thêm tag (thay YOUR_EXISTING_TAGS bằng tags hiện có)
gcloud compute instances add-tags translation01 \
  --zone=asia-southeast1-b \
  --tags=translation-webrtc
```

```bash
# 1. Tạo firewall rule cho WebRTC media ports (IPv6)
# Port range: 40000-40100 (khớp với stack-hybrid.yml)
gcloud compute firewall-rules create allow-webrtc-ipv6 \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=udp:40000-40100,tcp:40000-40100 \
  --source-ranges=::/0 \
  --target-tags=translation-webrtc \
  --description="Allow WebRTC media traffic over IPv6 (ports 40000-40100)"

# 2. Tạo firewall rule cho Gateway HTTP/HTTPS (IPv6)
gcloud compute firewall-rules create allow-gateway-https-ipv6 \
  --network=default \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443,tcp:80 \
  --source-ranges=::/0 \
  --target-tags=translation-webrtc \
  --description="Allow HTTPS traffic over IPv6"

# 3. Verify firewall rules
gcloud compute firewall-rules list --filter="name~ipv6" \
  --format="table(name,direction,sourceRanges,allowed)"
```

### Bước 4: Add DNS AAAA Record

**🎯 Your DNS Provider**: Hostinger DNS

#### Thêm AAAA Record trên Hostinger:

1. **Login vào Hostinger control panel**: https://hpanel.hostinger.com
2. **Navigate**: Domains → jbcalling.site → DNS Records
3. **Add new record**:
   - **Type**: AAAA
   - **Name**: webrtc (hoặc @ nếu muốn apex domain)
   - **Points to**: `<IPv6_ADDRESS_FROM_STEP_2>` (ví dụ: 2600:1900:4020:1234::1)
   - **TTL**: 300 (hoặc để mặc định)
4. **Save** changes
5. **Đợi DNS propagate** (thường 5-15 phút)

#### Verify DNS Propagation:

```bash
# Kiểm tra AAAA record
dig AAAA webrtc.jbcalling.site +short

# Hoặc sử dụng nslookup
nslookup -type=AAAA webrtc.jbcalling.site

# Hoặc online tool: https://dnschecker.org
# Search: webrtc.jbcalling.site (Type: AAAA)
```

**📝 Lưu ý**:
- Hostinger DNS thường propagate nhanh (5-15 phút)
- Nếu bạn đang dùng Cloudflare proxy, disable proxy cho record này (DNS only mode)
- Record AAAA độc lập với A record (có thể tồn tại song song cho dual-stack)

---

## 🔧 Phase 2: Gateway Configuration Update

### Bước 1: Cập nhật Environment Variables

Tạo/update file `.env` cho Gateway service:

```bash
# Tạo file environment variables
cat > /tmp/gateway-ipv6.env <<EOF
# IPv4 configuration (existing)
ANNOUNCED_IP=34.143.235.114

# IPv6 configuration (new)
ANNOUNCED_IPV6=<IPv6_ADDRESS_FROM_PHASE1_STEP2>
ENABLE_IPV6=true

# Dual-stack priority (prefer IPv6 nếu có)
IP_PREFERENCE=ipv6
EOF

# Copy to manager node
scp /tmp/gateway-ipv6.env translation01:/tmp/
```

### Bước 2: Update Gateway Config Code

Gateway config (`services/gateway/src/config.ts`) đã được cập nhật tự động để support:
- Dual-stack listenInfos (IPv4 + IPv6)
- Environment variables: `ANNOUNCED_IPV6`, `ENABLE_IPV6`
- Conditional IPv6 activation

**✅ Config đã sẵn sàng**: File `services/gateway/src/config.ts` đã support IPv6!

**Config structure hiện tại**:
```typescript
webRtcTransport: {
  listenInfos: (() => {
    const infos = [
      // IPv4 UDP
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: process.env.ANNOUNCED_IP },
      // IPv4 TCP
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: process.env.ANNOUNCED_IP },
    ];

    // Add IPv6 listeners nếu được enable
    if (process.env.ENABLE_IPV6 === 'true' && process.env.ANNOUNCED_IPV6) {
      infos.push(
        { protocol: 'udp', ip: '::', announcedAddress: process.env.ANNOUNCED_IPV6 },
        { protocol: 'tcp', ip: '::', announcedAddress: process.env.ANNOUNCED_IPV6 }
      );
    }
    return infos;
  })(),
  // Port range: 40000-40100 (đã config trong stack-hybrid.yml)
}
```

**⚠️ Không cần sửa code** - chỉ cần set environment variables!

### Bước 3: Update Docker Swarm Stack

```bash
# Edit stack-hybrid.yml to add IPv6 env vars
ssh translation01

# Backup current stack
cp /tmp/stack-hybrid.yml /tmp/stack-hybrid.yml.backup

# Add IPv6 environment variables to Gateway service
# (Đã được cập nhật tự động trong code)
```

---

## 🚀 Phase 3: Deployment & Testing

### Deployment Steps

```bash
# 1. Build Gateway image mới với IPv6 support
cd services/gateway
docker build -t jackboun11/jbcalling-gateway:1.0.5-ipv6 .
docker push jackboun11/jbcalling-gateway:1.0.5-ipv6

# 2. Update stack với env vars
# Edit infrastructure/swarm/stack-hybrid.yml
# Add to gateway service:
#   environment:
#     - ANNOUNCED_IPV6=<your_ipv6_address>
#     - ENABLE_IPV6=true

# 3. Deploy
scp infrastructure/swarm/stack-hybrid.yml translation01:/tmp/
ssh translation01 'docker stack deploy -c /tmp/stack-hybrid.yml translation'

# 4. Verify Gateway logs
ssh translation01 'docker service logs translation_gateway --tail 50 | grep -i ipv6'
```

### Testing & Validation

#### Test 1: Verify IPv6 Connectivity

```bash
# Từ client có IPv6 (hoặc online tool)
# Test TCP connectivity
telnet -6 <IPv6_ADDRESS> 443

# Test UDP connectivity  
nc -6 -u <IPv6_ADDRESS> 40000

# Test DNS resolution
dig AAAA webrtc.jbcalling.site +short
```

#### Test 2: WebRTC Connection Test

```javascript
// Browser console - Force IPv6
const pc = new RTCPeerConnection({
  iceServers: [],
  iceTransportPolicy: 'all'
});

// Check ICE candidates - should see IPv6 candidates
pc.onicecandidate = (e) => {
  if (e.candidate) {
    console.log('Candidate:', e.candidate.candidate);
    // Look for candidates with IPv6 addresses (format: [2600:xxxx::])
  }
};
```

#### Test 3: E2E Dual-Stack Test

1. **IPv4 client** → **IPv6 Gateway**: Should work (dual-stack)
2. **IPv6 client** → **IPv6 Gateway**: Should work (native IPv6)
3. **IPv4 client** ↔️ **IPv6 client**: Should work (gateway bridges)

```bash
# Monitor connections
ssh translation01 'watch -n 2 "docker service logs translation_gateway --tail 20 | grep -E \"IPv6|IPv4|ICE\""'
```

---

## 📊 Monitoring & Troubleshooting

### Check IPv6 Status

```bash
# 1. Verify VM có IPv6
ssh translation01 'ip -6 addr show'

# 2. Check firewall rules
gcloud compute firewall-rules list --filter="direction=INGRESS AND destinationRanges::/0"

# 3. Test IPv6 reachability
ping6 <IPv6_ADDRESS>

# 4. Check Gateway listening ports
ssh translation01 'docker exec $(docker ps -q -f name=translation_gateway) netstat -tuln | grep "::"'
```

### Common Issues

#### Issue 1: "Cannot assign requested address" khi bind IPv6

**Nguyên nhân**: VM chưa có IPv6 interface configured

**Giải pháp**:
```bash
# Verify IPv6 interface
ip -6 addr show

# Nếu không có IPv6, kiểm tra:
# 1. Subnet có stackType=IPV4_IPV6?
# 2. VM có ipv6AccessConfigs?
# 3. Restart network interface
sudo systemctl restart networking
```

#### Issue 2: ICE candidates chỉ có IPv4

**Nguyên nhân**: Browser/client không có IPv6, hoặc Gateway chưa announce IPv6

**Giải pháp**:
```bash
# 1. Check Gateway logs
docker service logs translation_gateway | grep "announcedAddress"

# 2. Verify ANNOUNCED_IPV6 env var
docker service inspect translation_gateway --format '{{.Spec.TaskTemplate.ContainerSpec.Env}}'

# 3. Test client IPv6
# Truy cập: https://test-ipv6.com
```

#### Issue 3: Firewall blocking IPv6 traffic

**Nguyên nhân**: GCP firewall rules chưa có cho IPv6

**Giải pháp**:
```bash
# List all firewall rules affecting IPv6
gcloud compute firewall-rules list \
  --filter="sourceRanges::/0 OR destinationRanges::/0" \
  --format="table(name,sourceRanges,allowed,denied)"

# Test connectivity từ bên ngoài
# Sử dụng: https://ipv6.chappell-family.com/ipv6tcptest/
```

---

## 🔐 Security Considerations

### IPv6 Security Best Practices

1. **Firewall Rules**: Không mở `::/0` cho tất cả ports
   ```bash
   # ❌ BAD
   gcloud compute firewall-rules create allow-all-ipv6 \
     --source-ranges=::/0 --allow=all
   
   # ✅ GOOD
   gcloud compute firewall-rules create allow-webrtc-ipv6 \
     --source-ranges=::/0 --allow=udp:40000-40100,tcp:40000-40100
   ```

2. **Rate Limiting**: Apply rate limiting cho IPv6 như IPv4

3. **Logging**: Monitor IPv6 traffic patterns
   ```bash
   # Grafana query for IPv6 connections
   sum(rate(webrtc_connections_total{ip_version="6"}[5m]))
   ```

4. **DDoS Protection**: Enable Cloud Armor nếu cần

---

## 📈 Performance Impact

### Expected Changes

- **Latency**: Tương đương hoặc tốt hơn IPv4 (ít NAT hops)
- **CPU**: +5-10% do xử lý dual-stack
- **Memory**: +50-100MB cho ICE candidates
- **Bandwidth**: Không thay đổi

### Monitoring Metrics

```typescript
// Prometheus metrics to add
webrtc_ipv6_connections_total
webrtc_ipv6_ice_candidates_count
webrtc_ipv6_connection_latency_ms
```

---

## ✅ Validation Checklist

### Infrastructure
- [ ] Subnet có stackType=IPV4_IPV6
- [ ] translation01 có IPv6 external address
- [ ] Firewall rules cho phép UDP/TCP 40000-40100 (IPv6)
- [ ] DNS AAAA record đã propagate

### Code & Configuration
- [ ] Gateway config có listenInfos cho IPv6
- [ ] ANNOUNCED_IPV6 env var được set
- [ ] ENABLE_IPV6=true trong stack
- [ ] Gateway logs show "Listening on [::]"

### Testing
- [ ] IPv6 client có thể kết nối
- [ ] ICE candidates bao gồm IPv6
- [ ] E2E call IPv6↔IPv6 thành công
- [ ] Dual-stack client tự động chọn IPv6 (nếu có)

---

## 📚 References

- [MediaSoup IPv6 Configuration](https://mediasoup.discourse.group/t/ipv6-for-client/517)
- [GCP IPv6 Setup Guide](https://cloud.google.com/compute/docs/ip-addresses/configure-ipv6-address)
- [WebRTC ICE with IPv6](https://webrtc.org/getting-started/peer-connections)
- [Dual-Stack Best Practices](https://datatracker.ietf.org/doc/html/rfc6724)

---

## 🔄 Rollback Plan

Nếu cần revert IPv6:

```bash
# 1. Remove IPv6 from Gateway config
# Set ENABLE_IPV6=false

# 2. Rollback stack
ssh translation01 'docker service update \
  --env-rm ANNOUNCED_IPV6 \
  --env-rm ENABLE_IPV6 \
  translation_gateway'

# 3. (Optional) Remove IPv6 from VM
gcloud compute instances network-interfaces update translation01 \
  --zone=asia-southeast1-b \
  --stack-type=IPV4_ONLY

# 4. Remove DNS AAAA record
# (Via Cloudflare dashboard hoặc gcloud dns)
```

---

**Next Steps**:
1. Execute Phase 1 (Infrastructure) - ~30 minutes
2. Update code & deploy (Phase 2) - ~15 minutes  
3. Test & validate (Phase 3) - ~30 minutes

**Total estimated time**: 1.5 hours

**Risk Level**: Low (dual-stack giữ nguyên IPv4, có thể rollback dễ dàng)
