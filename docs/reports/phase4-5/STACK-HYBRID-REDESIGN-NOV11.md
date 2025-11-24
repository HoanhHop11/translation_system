# Stack-Hybrid Architecture Redesign

**Date**: November 11, 2025  
**Status**: Design Phase  
**Phase**: 4-5 Gateway Fix - Cross-Node Routing Solution  

---

## 🔴 Problem Statement

### Current Issue
- **504 Gateway Timeout** khi access https://jbcalling.site
- Traefik (trên translation01) KHÔNG THỂ route đến frontend containers (trên translation03)
- Root cause: Docker Swarm overlay network cross-node routing failure

### Evidence
```bash
# Frontend placement
docker service ps translation_frontend
# Result: ALL 3 replicas on translation03

# Traefik location  
docker service ps translation_traefik
# Result: On translation01 (manager node)

# Connection test
curl -I https://jbcalling.site/
# Result: 504 Gateway Timeout after 30s

# Traefik logs
docker service logs translation_traefik | grep 504
# "GET / HTTP/2.0" 504 - "frontend@docker" "http://10.0.5.27:80" 30002ms
```

### Deployed vs File Mismatch
```bash
# File: stack-hybrid.yml line 316-318
# Comment: "BỎ placement constraint để frontend có thể chạy cùng node với Traefik"

# Reality: Deployed service
docker service inspect translation_frontend --format '{{.Spec.TaskTemplate.Placement}}'
# {
#   "Constraints": ["node.labels.instance == translation03"]  
# }
```

**Kết luận**: Service đang deploy vẫn có placement constraint mặc dù file đã comment về việc bỏ nó.

---

## 🔍 Research Findings

### Docker Swarm + Traefik Cross-Node Issues

**Source 1: Traefik Community Forum**
> "Service discovery work perfectly fine, the only issue is that i cannot access my services if deployed on the worker node, if i deploy them on the manager node i can access them."
> 
> "From within the traefik container I can make a wget on a service running in the worker node therefore i assume that the swarm network is working well. Running my apps on the manager node, work well."

**Source 2: Reddit /r/Traefik**
> "Traefik picks it up and starts routing HTTP traffic to it ONLY when I force it to the same node with a constraint."

**Source 3: Docker Swarm Overlay Network Issue #43052**
> "overlay network exhaustion" - VIPs exhausted after ~100 services on same overlay network
> "no error is visible to a docker user. Only sys-admins can access the reason services are stuck"

### Key Insights

1. **Cross-node overlay routing** là vấn đề phổ biến với Traefik + Swarm
2. **Solution pattern**: Services cần route bởi Traefik nên:
   - Không có placement constraint (để Swarm tự phân phối)
   - HOẶC co-locate cùng node với Traefik
3. **Swarm ingress mesh** hoạt động tốt KHI không có placement constraints
4. **Overlay network VIP exhaustion** có thể xảy ra với nhiều services

---

## 🎯 Proposed Solution

### Option A: Remove Placement Constraints (RECOMMENDED)

**Strategy**: Để Docker Swarm tự động phân phối services, sử dụng Swarm's ingress routing mesh

**Changes needed**:
1. **Frontend service**: Bỏ placement constraint hoàn toàn
2. **Signaling service**: Bỏ placement constraint (hiện đang force translation03)
3. **Keep MediaSoup placement**: Vẫn giữ trên translation02 (cần UDP mode: host)

**Advantages**:
✅ Đơn giản, ít config  
✅ Tận dụng Swarm routing mesh  
✅ Tự động load balancing  
✅ Không overload manager node  
✅ Dễ scale trong tương lai  
✅ Proven pattern từ community  

**Disadvantages**:
⚠️ Không kiểm soát được service chạy trên node nào  
⚠️ Cần verify ingress mesh hoạt động đúng  

### Option B: Co-locate Frontend với Traefik

**Strategy**: Đặt frontend replicas lên translation01 (cùng node với Traefik)

**Changes needed**:
```yaml
frontend:
  deploy:
    placement:
      constraints:
        - node.labels.instance == translation01
```

**Advantages**:
✅ Guarantee routing hoạt động  
✅ Không phụ thuộc ingress mesh  
✅ Predictable placement  

**Disadvantages**:
❌ Overload manager node (30GB RAM nhưng đã có nhiều services)  
❌ Single point of failure cho frontend  
❌ Không tận dụng worker nodes  
❌ Khó scale horizontally  

### Option C: Hybrid Approach

**Strategy**: 
- Frontend: Không có constraint, phân phối tự động
- Signaling: Phân phối tự động HOẶC prefer translation02/03 (worker nodes)
- MediaSoup: Vẫn fixed trên translation02

**Advantages**:
✅ Balance giữa control và flexibility  
✅ Optimize resource usage  
✅ MediaSoup stable với UDP  

**Disadvantages**:
⚠️ Phức tạp hơn trong troubleshooting  

---

## 🏗️ Implementation Plan - Option A (RECOMMENDED)

### Phase 1: Backup Current Stack

```bash
# Backup deployed service configs
ssh translation01 "docker service inspect translation_frontend > /tmp/frontend-backup.json"
ssh translation01 "docker service inspect translation_signaling > /tmp/signaling-backup.json"

# Backup file
cp infrastructure/swarm/stack-hybrid.yml infrastructure/swarm/stack-hybrid-backup-nov11.yml
```

### Phase 2: Update Stack Configuration

**File**: `infrastructure/swarm/stack-hybrid.yml`

**Changes**:

1. **Frontend service** (line ~280-340):
```yaml
frontend:
  # ... existing config ...
  deploy:
    # ... update config, rollback config, restart policy ...
    mode: replicated
    replicas: 3
    # ⚠️ BỎ TOÀN BỘ placement section
    # Để Swarm tự động phân phối, sử dụng ingress routing mesh
    resources:
      # ... existing limits ...
```

2. **Signaling service** (line ~60-100):
```yaml
signaling:
  # ... existing config ...
  deploy:
    # ... configs ...
    mode: replicated
    replicas: 3
    # ⚠️ BỎ TOÀN BỘ placement section  
    # Để Swarm phân phối, cải thiện HA
    resources:
      # ... existing limits ...
```

3. **MediaSoup service** (KEEP placement - cần UDP mode: host):
```yaml
mediasoup:
  # ... existing config ...
  deploy:
    mode: replicated
    replicas: 1  
    placement:
      constraints:
        - node.labels.instance == translation02  # ✅ KEEP THIS
    # ... rest of config ...
```

### Phase 3: Deploy Updated Stack

```bash
# SSH to manager node
ssh translation01

# Deploy updated stack
docker stack deploy -c /path/to/stack-hybrid.yml translation

# Monitor deployment
watch -n 2 "docker service ls | grep translation"

# Wait for convergence (~2-3 minutes)
```

### Phase 4: Verify Service Distribution

```bash
# Check frontend placement
docker service ps translation_frontend --format 'table {{.Name}}\t{{.Node}}\t{{.CurrentState}}'

# Expected: Replicas distributed across multiple nodes (translation01, translation02, translation03)

# Check signaling placement  
docker service ps translation_signaling --format 'table {{.Name}}\t{{.Node}}\t{{.CurrentState}}'

# Expected: Distributed across nodes

# Check mediasoup (should still be on translation02)
docker service ps translation_mediasoup --format 'table {{.Name}}\t{{.Node}}\t{{.CurrentState}}'

# Expected: 1 replica on translation02
```

### Phase 5: Test Frontend Accessibility

```bash
# Test 1: Basic HTTPS access
curl -I https://jbcalling.site/
# Expected: 200 OK or 30x redirect (NOT 504)

curl -I https://www.jbcalling.site/
# Expected: 200 OK or 30x redirect (NOT 504)

# Test 2: Full page load
curl -L https://jbcalling.site/ | grep -i "<!doctype"
# Expected: HTML response

# Test 3: API endpoint
curl -I https://api.jbcalling.site/health
# Expected: 200 OK

# Test 4: From external (your local machine)
curl -I https://jbcalling.site/
# Expected: 200 OK
```

### Phase 6: Verify Traefik Routing

```bash
# Check Traefik dashboard
curl -I https://traefik.jbcalling.site/dashboard/

# Check Traefik logs (should show successful routes)
docker service logs translation_traefik --tail 50 | grep -i frontend

# Expected: 200/30x responses, NO 504 errors

# Check Traefik discovered backends
docker service logs translation_traefik | grep -i "frontend@docker"
# Expected: Should show multiple backend IPs (distributed replicas)
```

### Phase 7: End-to-End WebRTC Test

1. **User 1**: Mở https://jbcalling.site
2. **Create Room**: Tạo room mới
3. **User 2**: Join room (incognito/khác browser)
4. **Verify**:
   - Socket.IO connection: Check browser console → `socket.connected = true`
   - ICE candidates: Should include media.jbcalling.site
   - Video/Audio streams: Should be flowing

### Phase 8: Monitor Logs During Test

```bash
# Terminal 1: Frontend logs
docker service logs translation_frontend --follow | grep -i "GET\|POST\|error"

# Terminal 2: Signaling logs
docker service logs translation_signaling --follow | grep -i "socket\|room\|error"

# Terminal 3: MediaSoup logs
docker service logs translation_mediasoup --follow | grep -i "ice\|dtls\|transport"

# Terminal 4: Traefik logs
docker service logs translation_traefik --follow | grep -i "frontend\|api"
```

---

## 📊 Resource Planning

### Current State (with constraints)
```
translation01 (Manager, 30GB RAM):
  - Traefik, Redis, Translation, Monitoring
  - NO frontend

translation02 (Worker, 15GB RAM):  
  - MediaSoup (UDP mode: host) ✅ STABLE
  - Coturn
  - NO frontend

translation03 (Worker, 15GB RAM):
  - Frontend (3 replicas) ← ALL HERE, UNREACHABLE
  - Signaling (3 replicas) ← ALL HERE
  - TTS
```

### Proposed State (Option A - no constraints)
```
translation01 (Manager, 30GB RAM):
  - Traefik ← INGRESS POINT
  - Redis, Translation, Monitoring
  - Frontend (1-2 replicas) ← AUTO DISTRIBUTED
  - Signaling (1-2 replicas) ← AUTO DISTRIBUTED

translation02 (Worker, 15GB RAM):
  - MediaSoup (1 replica) ✅ FIXED placement
  - Coturn
  - Frontend (1 replica) ← AUTO DISTRIBUTED  
  - Signaling (1 replica) ← AUTO DISTRIBUTED

translation03 (Worker, 15GB RAM):
  - TTS
  - Frontend (1 replica) ← AUTO DISTRIBUTED
  - Signaling (1 replica) ← AUTO DISTRIBUTED
```

### Memory Estimates (per replica)
- Frontend: 128M limit, 64M reserved  
- Signaling: 512M limit, 256M reserved  
- MediaSoup: 1GB limit, 512M reserved  

### Balanced Distribution (3 replicas each)
```
translation01: Frontend + Signaling = ~640M + existing services
translation02: Frontend + Signaling + MediaSoup = ~1.6GB + existing  
translation03: Frontend + Signaling + TTS = ~640M + existing
```

**Verdict**: ✅ All nodes có đủ RAM cho distribution này

---

## 🔒 Rollback Plan

Nếu Option A fails:

### Rollback Step 1: Restore Frontend Placement
```bash
ssh translation01 "docker service update \
  --constraint-add 'node.labels.instance==translation01' \
  translation_frontend"
```

**Rationale**: Co-locate frontend với Traefik (Option B)

### Rollback Step 2: Full Stack Rollback
```bash
ssh translation01 "docker stack deploy -c /tmp/stack-hybrid-backup-nov11.yml translation"
```

### Rollback Step 3: Service-level Rollback
```bash
ssh translation01 "docker service rollback translation_frontend"
ssh translation01 "docker service rollback translation_signaling"
```

---

## ✅ Success Criteria

1. ✅ `curl -I https://jbcalling.site/` returns 200 OK (not 504)
2. ✅ Frontend replicas distributed across multiple nodes
3. ✅ Traefik logs show successful routing (no 504 errors)
4. ✅ End-to-end WebRTC call works (2 users can video chat)
5. ✅ Socket.IO connects to api.jbcalling.site successfully
6. ✅ MediaSoup still stable on translation02
7. ✅ All services healthy in `docker service ls`

---

## 📝 Notes & Considerations

### Why Not Use `mode: global`?
- `mode: global` deploys 1 replica per node
- We want 3 replicas total (not necessarily 1 per node)
- `mode: replicated` with no constraint is more flexible

### Why Keep MediaSoup Placement?
- MediaSoup uses `mode: host` for UDP ports
- UDP port binding requires fixed node
- Published ports 40000-40009 on translation02
- Changing placement would break UDP connectivity

### Alternative: Use `traefik.docker.network`?
- Already tried: Added label, still 504
- Not the issue - problem is cross-node routing, not network selection

### Alternative: Use External Load Balancer?
- Google Cloud Load Balancer → Traefik → Services
- More complex, additional cost
- Overkill for 3-node cluster
- Keep as last resort if Swarm mesh fails

---

## 🚀 Next Steps

1. **Review this document** với user để confirm Option A
2. **Backup current configs** before changes
3. **Update stack-hybrid.yml** to remove placement constraints
4. **Deploy and test** following Phase 1-8 above
5. **Monitor and document** results in new wrap-up file

---

**End of Document**
