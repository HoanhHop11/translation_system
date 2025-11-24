# Hybrid Architecture Deployment Guide

**Date**: November 10, 2025  
**Phase**: Gateway Fix - Socket.IO + MediaSoup Separation  
**Estimated Time**: 30-45 minutes total

---

## 🎯 Overview

This deployment implements **Solution 1: Hybrid Architecture** từ GATEWAY-PRODUCTION-SOLUTION-NOV10.md:

- **Signaling Service** (v2.0.0): Python FastAPI + Socket.IO server
- **MediaSoup Service** (v1.0.0): Node.js Express + MediaSoup workers (internal only)
- **Frontend** (v1.0.11): React + Vite (no changes needed)

### Architecture Flow

```
Browser
  ↓ Socket.IO (wss://api.jbcalling.site/socket.io/)
Signaling Service (3 replicas on translation03)
  ↓ HTTP REST (http://mediasoup:4000)
MediaSoup Service (1 replica on translation02)
  ↓ RTP/UDP (40000-40100)
Browser (via WebRTC DataChannel)
```

---

## ✅ Pre-Deployment Checklist

### Images Built & Pushed

- [x] `jackboun11/jbcalling-signaling:2.0.0` ✅ **PUSHED**
- [ ] `jackboun11/jbcalling-mediasoup:1.0.0` ⏳ **BUILDING** (step 6/9)
- [x] `jackboun11/jbcalling-frontend:1.0.11` ✅ Already deployed

### Stack File Ready

- [x] `infrastructure/swarm/stack-hybrid.yml` created
- [x] Signaling service config với Socket.IO labels
- [x] MediaSoup service config với host mode RTP ports
- [x] Sticky sessions enabled cho Socket.IO (cookie: `io`)
- [x] REDIS_HOST fixed: `translation_redis` (main) và `translation_redis_gateway`

### DNS Verified

- [x] `jbcalling.site` → 34.143.235.114 ✅
- [x] `api.jbcalling.site` → 34.143.235.114 ✅  
- [x] `webrtc.jbcalling.site` → 34.143.235.114 ✅ (not used in hybrid)

---

## 📋 Deployment Steps

### Step 1: Push MediaSoup Image

```bash
# After build completes
docker push jackboun11/jbcalling-mediasoup:1.0.0

# Verify push
docker images | grep mediasoup
```

**Expected Output:**
```
jackboun11/jbcalling-mediasoup   1.0.0   <hash>   X minutes ago   XXX MB
```

### Step 2: Copy Stack File to Manager Node

```bash
# From translation02, SSH to translation01
ssh hopboy2003@translation01

# Create infrastructure directory if not exists
mkdir -p ~/jbcalling_translation_realtime/infrastructure/swarm

# Exit and copy from translation02
exit

# Copy stack file
scp /home/hopboy2003/jbcalling_translation_realtime/infrastructure/swarm/stack-hybrid.yml \
    hopboy2003@translation01:~/jbcalling_translation_realtime/infrastructure/swarm/
```

### Step 3: Deploy Stack (từ translation01)

```bash
# SSH to translation01 (Manager Node)
ssh hopboy2003@translation01

cd ~/jbcalling_translation_realtime/infrastructure/swarm

# Deploy stack
docker stack deploy -c stack-hybrid.yml translation

# Expected output:
# Creating network translation_frontend
# Creating network translation_backend
# Creating service translation_signaling
# Creating service translation_mediasoup
# Updating service translation_frontend (no changes)
# Updating service translation_redis
# ... etc
```

### Step 4: Monitor Service Startup

```bash
# Watch services converge
watch -n 2 'docker service ls | grep translation'

# Expected:
# NAME                        REPLICAS   IMAGE
# translation_signaling       3/3        jackboun11/jbcalling-signaling:2.0.0
# translation_mediasoup       1/1        jackboun11/jbcalling-mediasoup:1.0.0
# translation_frontend        2/2        jackboun11/jbcalling-frontend:1.0.11
```

**Wait for**: All services show `X/X` (đầy đủ replicas)

### Step 5: Check Logs

#### Signaling Service Logs

```bash
docker service logs -f --tail 50 translation_signaling
```

**Expected Output:**
```
✅ Connected to Redis at translation_redis:6379
✅ Socket.IO server initialized
✅ ASGI application started
✅ MediaSoup service available at http://mediasoup:4000
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8001
```

#### MediaSoup Service Logs

```bash
docker service logs -f --tail 50 translation_mediasoup
```

**Expected Output:**
```
✅ MediaSoup worker 0 created (PID: XXXX)
✅ MediaSoup worker 1 created (PID: XXXX)
✅ REST API listening on port 4000
✅ RTC ports: 40000-40100 (UDP)
✅ Announced IP: 34.142.190.250
```

### Step 6: Verify Traefik Routing

```bash
# Check Traefik router for Signaling
curl -sk https://traefik.jbcalling.site/api/http/routers | \
    jq '.[] | select(.name | contains("signaling"))'
```

**Expected:**
```json
{
  "name": "signaling@swarm",
  "service": "signaling",
  "rule": "Host(`api.jbcalling.site`)",
  "entryPoints": ["websecure"],
  "tls": {
    "certResolver": "letsencrypt"
  }
}
```

---

## 🧪 Testing

### Test 1: Socket.IO Handshake

```bash
# From any terminal
curl -sk 'https://api.jbcalling.site/socket.io/?EIO=4&transport=polling'
```

**Expected Response:**
```json
{"sid":"<session_id>","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000}
```

**If fails**: Check Signaling service logs, verify Socket.IO server started

### Test 2: Health Checks

```bash
# Signaling health
curl -sk https://api.jbcalling.site/health

# Expected: {"status":"ok","service":"signaling","version":"2.0.0"}

# MediaSoup health (internal - from Signaling container)
docker exec -it $(docker ps -q -f name=translation_signaling) \
    curl -s http://mediasoup:4000/health

# Expected: {"status":"ok","workers":2,"ports":"40000-40100"}
```

### Test 3: Frontend WebSocket Connection

```bash
# Open browser
google-chrome https://jbcalling.site

# DevTools → Network tab → WS filter
# Should see: wss://api.jbcalling.site/socket.io/?EIO=4&transport=websocket
# Status: 101 Switching Protocols
```

**If 101 shown**: ✅ WebSocket connected!  
**If 404/502**: Check Traefik labels, verify Signaling service running

### Test 4: Join Room Flow

1. Open https://jbcalling.site
2. Enter room: `test-room-001`
3. DevTools Console should show:
   ```
   ✅ Socket.IO connected
   ✅ Room joined: test-room-001
   ✅ RTP capabilities received
   ```

4. Check Signaling logs:
   ```bash
   docker service logs --tail 20 translation_signaling | grep "join-room"
   ```

**Expected:**
```
Socket.IO event: join-room, data: {'roomId': 'test-room-001', 'name': 'User123'}
MediaSoup router created for room: test-room-001
```

---

## 🚨 Troubleshooting

### Issue 1: Socket.IO 404 Not Found

**Symptoms:**
```bash
curl https://api.jbcalling.site/socket.io/
# Returns: 404 Not Found
```

**Causes & Fixes:**
1. Signaling service not started
   ```bash
   docker service ps translation_signaling
   # Check for errors in Current State
   ```

2. Traefik labels not applied
   ```bash
   docker service inspect translation_signaling --pretty | grep -A 10 Labels
   ```

3. Socket.IO server not initialized in Python
   ```bash
   docker service logs translation_signaling | grep "Socket.IO"
   # Should see: ✅ Socket.IO server initialized
   ```

### Issue 2: MediaSoup Service Unreachable

**Symptoms:**
```bash
docker exec -it <signaling_container> curl http://mediasoup:4000/health
# Timeout or connection refused
```

**Causes & Fixes:**
1. MediaSoup service not running
   ```bash
   docker service ps translation_mediasoup
   ```

2. Network issue (backend overlay)
   ```bash
   docker network inspect translation_backend
   # Verify mediasoup and signaling both in network
   ```

3. MediaSoup workers not started
   ```bash
   docker service logs translation_mediasoup
   # Look for: ✅ MediaSoup worker created
   ```

### Issue 3: WebSocket Sticky Sessions Not Working

**Symptoms:**
- Socket.IO connects but disconnects randomly
- Multiple session IDs created

**Causes & Fixes:**
1. Cookie not set
   ```bash
   curl -v 'https://api.jbcalling.site/socket.io/?EIO=4&transport=polling'
   # Look for: Set-Cookie: io=<value>
   ```

2. Traefik sticky session labels missing
   ```bash
   docker service inspect translation_signaling | \
       jq '.Spec.TaskTemplate.ContainerSpec.Labels' | \
       grep sticky
   ```

### Issue 4: RTP Ports Not Accessible

**Symptoms:**
- WebRTC ICE connection fails
- Browser console: "Failed to connect to peer"

**Causes & Fixes:**
1. Verify host mode enabled
   ```bash
   docker service inspect translation_mediasoup | grep '"Mode": "host"'
   ```

2. Check firewall rules on translation02
   ```bash
   ssh hopboy2003@translation02
   sudo iptables -L -n | grep 40000
   ```

3. Verify ANNOUNCED_IP correct
   ```bash
   docker service inspect translation_mediasoup | grep ANNOUNCED_IP
   # Should be: 34.142.190.250 (translation02 public IP)
   ```

---

## 📊 Success Criteria

Deployment thành công khi:

- [x] **Signaling Service**: 3/3 replicas running
- [x] **MediaSoup Service**: 1/1 replica running  
- [x] **Socket.IO Handshake**: Returns session ID
- [x] **WebSocket Upgrade**: 101 Switching Protocols
- [x] **Room Join**: Callback returns RTP capabilities
- [x] **Logs Clean**: No errors in Signaling or MediaSoup logs

---

## 🔄 Rollback Plan

Nếu deployment fails:

```bash
# Rollback to previous stack (optimized)
cd ~/jbcalling_translation_realtime/infrastructure/swarm
docker stack deploy -c stack-optimized.yml translation

# Or remove hybrid stack entirely
docker stack rm translation

# Wait for cleanup (30-60 seconds)
docker network prune -f
docker volume prune -f

# Redeploy optimized
docker stack deploy -c stack-optimized.yml translation
```

---

## 📈 Next Steps After Deployment

1. **Monitor Performance**
   - Grafana: https://grafana.jbcalling.site
   - Check Signaling CPU/RAM usage
   - Check MediaSoup worker load

2. **Test Load**
   - Create 5-10 concurrent rooms
   - Monitor service scaling
   - Check Redis connection pooling

3. **Optimize**
   - Tune Socket.IO ping intervals
   - Adjust MediaSoup worker count
   - Enable Redis persistence if needed

4. **Documentation**
   - Update SYSTEM-STATUS-NOV10-2025.md
   - Create WRAP-UP-NOV10.md
   - Document lessons learned

---

## 📝 Notes

- **Build Time**: MediaSoup image build ~5-7 minutes (native modules)
- **Deploy Time**: Stack deployment ~2-3 minutes
- **Service Startup**: Signaling ~10s, MediaSoup ~20-30s
- **Total Downtime**: ~30-60 seconds (rolling update)

**Estimated Total Time**: 30-45 minutes from start to finish
