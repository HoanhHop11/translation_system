# Stack-Hybrid Routing Fix - Placement Constraint Removal

**Date**: November 11, 2025  
**Status**: ✅ **RESOLVED - Frontend Accessible**  
**Phase**: 4-5 Gateway Fix Complete (100%)  

---

## 🎯 Problem Summary

### Issue
- **504 Gateway Timeout** khi access https://jbcalling.site  
- Traefik (translation01) không thể route đến frontend containers (translation03)
- Root cause: Docker Swarm overlay network cross-node routing failure

### Evidence Before Fix
```bash
# Frontend placement - ALL on translation03
docker service ps translation_frontend
NAME                    NODE            CURRENT STATE
translation_frontend.1  translation03   Running
translation_frontend.2  translation03   Running
translation_frontend.3  translation03   Running

# Traefik location
docker service ps translation_traefik
translation_traefik.1   translation01   Running

# Test result
curl -I https://jbcalling.site/
HTTP/2 504 Gateway Timeout  ❌
```

### Architectural Flaw
```
translation01 (Manager):
  - Traefik ← CANNOT REACH

translation02 (Worker):
  - MediaSoup ✅

translation03 (Worker):
  - Frontend (ALL 3 replicas) ← UNREACHABLE
  - Signaling (ALL 3 replicas) ← UNREACHABLE
```

**Problem**: Placement constraints forced all frontend/signaling replicas to translation03, away from Traefik on translation01. Overlay network failed to route traffic cross-node.

---

## 🔍 Research Findings

### Docker Swarm + Traefik Cross-Node Issues

**Source 1: Traefik Community Forum**
> "Service discovery work perfectly fine, the only issue is that i cannot access my services if deployed on the worker node, if i deploy them on the manager node i can access them."

**Source 2: Reddit /r/Traefik**
> "Traefik picks it up and starts routing HTTP traffic to it ONLY when I force it to the same node with a constraint."

**Key Insight**: Services routed by Traefik should either:
1. **Remove placement constraints** → Let Swarm distribute (use ingress mesh)
2. **Co-locate with Traefik** → Guarantee routing works

We chose **Option 1** (remove constraints) for better HA and resource utilization.

---

## ✅ Solution Implemented

### Changes Made

**File**: `infrastructure/swarm/stack-hybrid.yml`

**1. Frontend Service** (line ~85-95):
```yaml
# BEFORE
frontend:
  deploy:
    replicas: 3
    placement:
      constraints:
        - node.labels.instance == translation03  ❌

# AFTER
frontend:
  deploy:
    replicas: 3
    # ⚠️ BỎ placement constraint - Để Swarm tự phân phối cho HA và routing
    # Traefik cần có thể route đến frontend replicas
    # Cross-node overlay routing có issue → remove constraint
```

**2. Signaling Service** (line ~87-91):
```yaml
# BEFORE
signaling:
  deploy:
    replicas: 3
    placement:
      constraints:
        - node.labels.instance == translation03  ❌

# AFTER
signaling:
  deploy:
    replicas: 3
    # ⚠️ BỎ placement constraint - Để Swarm phân phối, cải thiện HA
```

**3. MediaSoup Service** (KEEP placement - cần UDP mode: host):
```yaml
mediasoup:
  deploy:
    replicas: 1
    placement:
      constraints:
        - node.labels.instance == translation02  ✅ KEEP THIS
    # Reason: UDP mode: host cần fixed node
```

### Deployment Commands

```bash
# Step 1: Update stack-hybrid.yml
vi infrastructure/swarm/stack-hybrid.yml
# (Removed placement constraints for frontend + signaling)

# Step 2: Copy to manager node
scp infrastructure/swarm/stack-hybrid.yml translation01:/tmp/

# Step 3: Deploy updated stack
ssh translation01 "docker stack deploy -c /tmp/stack-hybrid.yml translation"

# Step 4: Force update để Swarm reschedule tasks
ssh translation01 "docker service update --force translation_frontend"
ssh translation01 "docker service update --force translation_signaling"
```

**Note**: `docker stack deploy` chỉ update config, KHÔNG reschedule existing tasks. Cần `--force` update để Swarm reschedule.

---

## 📊 Results After Fix

### Service Distribution (BALANCED)

**Frontend** (3 replicas - DISTRIBUTED):
```
translation_frontend.1  translation02  ✅ Running
translation_frontend.2  translation03  ✅ Running
translation_frontend.3  translation01  ✅ Running (CÙNG NODE VỚI TRAEFIK!)
```

**Signaling** (3 replicas - DISTRIBUTED):
```
translation_signaling.1  translation01  ✅ Running (CÙNG NODE VỚI TRAEFIK!)
translation_signaling.2  translation03  ✅ Running
translation_signaling.3  translation02  ✅ Running
```

**MediaSoup** (1 replica - FIXED):
```
translation_mediasoup.1  translation02  ✅ Running (UDP mode: host)
```

### Accessibility Test

```bash
# Test HTTPS access
curl -I -L https://jbcalling.site/

HTTP/2 200 ✅
accept-ranges: bytes
content-type: text/html
date: Mon, 17 Nov 2025 13:26:10 GMT
server: nginx/1.29.3
content-length: 604
```

**Result**: ✅ **200 OK** - Frontend hoàn toàn accessible!

### Traefik Logs (After Fix)
```
# Before: 504 errors
"GET / HTTP/2.0" 504 15 "frontend@docker" "http://10.0.5.27:80" 30002ms ❌

# After: 200 success
(No 504 errors in logs, requests routing successfully) ✅
```

---

## 🏗️ New Architecture

### Resource Distribution
```
translation01 (Manager, 30GB RAM):
  - Traefik (reverse proxy)
  - Redis, Translation, Monitoring
  - Frontend (1 replica) ← AUTO DISTRIBUTED
  - Signaling (1 replica) ← AUTO DISTRIBUTED
  → Total: ~640MB for frontend+signaling

translation02 (Worker, 15GB RAM):
  - MediaSoup (1 replica) ✅ FIXED placement
  - Coturn
  - Frontend (1 replica) ← AUTO DISTRIBUTED
  - Signaling (1 replica) ← AUTO DISTRIBUTED
  → Total: ~1.6GB with MediaSoup

translation03 (Worker, 15GB RAM):
  - TTS
  - Frontend (1 replica) ← AUTO DISTRIBUTED
  - Signaling (1 replica) ← AUTO DISTRIBUTED
  → Total: ~640MB
```

### Memory Estimates (per replica)
- Frontend: 128M limit, 64M reserved
- Signaling: 512M limit, 256M reserved
- MediaSoup: 1GB limit, 512M reserved

**Verdict**: ✅ Balanced distribution, tất cả nodes có đủ RAM.

---

## ✅ Success Criteria Met

1. ✅ `curl -I https://jbcalling.site/` returns **200 OK** (not 504)
2. ✅ Frontend replicas **distributed across multiple nodes**
3. ✅ Signaling replicas **distributed** (1 on translation01 with Traefik)
4. ✅ Traefik logs show **NO 504 errors** for frontend
5. ✅ MediaSoup vẫn **stable on translation02** (UDP mode: host)
6. ✅ All services **healthy** in `docker service ls`

---

## 📝 Key Learnings

### Docker Swarm Overlay Network Limitations
1. **Cross-node routing** có thể fail với Traefik
2. **Placement constraints** tách biệt services → routing issues
3. **Solution**: Remove constraints để Swarm dùng ingress routing mesh
4. **Alternative**: Co-locate services với Traefik (nhưng overload manager node)

### Best Practices
1. ✅ **Avoid hard placement constraints** trừ khi có technical reason (UDP mode: host, GPU)
2. ✅ **Let Swarm distribute services** cho HA và load balancing
3. ✅ **Use ingress routing mesh** instead of direct overlay network routing
4. ✅ **Force update after config change** để reschedule tasks

### When to Use Placement Constraints
- **UDP/TCP ports với mode: host** (MediaSoup, Coturn)
- **GPU workloads** (specific node has GPU)
- **Disk-bound services** (specific node has SSD/large disk)
- **Manager-only services** (monitoring, secrets management)

### When NOT to Use Placement Constraints
- **HTTP/HTTPS services** behind Traefik
- **Stateless services** (frontend, API)
- **Services needing HA** (signaling, translation)
- **Services with multiple replicas** (auto load balancing)

---

## 🚀 Next Steps

### Phase 5: End-to-End WebRTC Testing

1. **Test frontend loading**:
   ```bash
   curl -L https://jbcalling.site/ | grep -i "<!doctype"
   # Expected: HTML response ✅
   ```

2. **Test API endpoint**:
   ```bash
   curl -I https://api.jbcalling.site/health
   # Expected: 200 OK
   ```

3. **Test WebRTC call**:
   - User 1: Access https://jbcalling.site, create room
   - User 2: Join room (incognito/different browser)
   - Verify: Socket.IO connects to api.jbcalling.site
   - Verify: ICE candidates include media.jbcalling.site
   - Verify: Video/audio streams successfully

4. **Monitor logs**:
   ```bash
   # Frontend logs
   docker service logs translation_frontend --follow | grep -i "GET\|POST\|error"
   
   # Signaling logs
   docker service logs translation_signaling --follow | grep -i "socket\|room\|error"
   
   # MediaSoup logs
   docker service logs translation_mediasoup --follow | grep -i "ice\|dtls\|transport"
   
   # Traefik logs
   docker service logs translation_traefik --follow | grep -i "frontend\|api"
   ```

### Monitoring Checklist
- [ ] Frontend accessible via https://jbcalling.site/ ✅ DONE
- [ ] API accessible via https://api.jbcalling.site/
- [ ] Socket.IO connection establishes
- [ ] WebRTC ICE connection successful
- [ ] DTLS handshake complete
- [ ] Video/audio streaming works
- [ ] Translation pipeline functional

---

## 📚 References

### Community Resources
1. **Traefik Community Forum**: "Services timeout if on a swarm worker node"  
   https://community.traefik.io/t/services-timeout-if-on-a-swarm-worker-node/19951
   
2. **Reddit /r/Traefik**: "Swarm only working as expected when all containers are on same node"  
   https://www.reddit.com/r/Traefik/comments/uhnv0l/swarm_only_working_as_expected_when_all/

3. **Docker GitHub Issues**: "overlay network exhaustion #43052"  
   https://github.com/moby/moby/issues/43052

4. **Traefik Docs**: Docker Swarm Provider  
   https://doc.traefik.io/traefik/providers/swarm/

### Related Documents
- `STACK-HYBRID-REDESIGN-NOV11.md` - Design document
- `infrastructure/swarm/stack-hybrid-backup-nov11-pre-redesign.yml` - Backup before changes
- `TRAEFIK-GATEWAY-INVESTIGATION-OCT15.md` - Original investigation
- `ROADMAP-UPDATED-OCT2025.md` - Phase progress tracking

---

**End of Document**  
**Status**: ✅ Issue RESOLVED - Frontend accessible, services distributed correctly
