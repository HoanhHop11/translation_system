# 🗑️ Deprecated Services - November 17, 2025

**Status**: Services removed from production stack  
**Reason**: Architecture consolidation (Phase 5 complete)  
**Date**: November 17, 2025

---

## ⚠️ Services Removed

### 1. `signaling` (Python Socket.IO P2P Signaling)
**Image**: `jackboun11/jbcalling-signaling:2.5.3`  
**Purpose**: P2P WebRTC signaling với Socket.IO  
**Deprecated**: November 17, 2025  
**Replacement**: `gateway` service (NodeJS + Socket.IO + MediaSoup SFU)

#### Why Removed:
- ❌ **Architecture mismatch**: P2P signaling không phù hợp với SFU architecture
- ❌ **Maintenance overhead**: Duplicate Socket.IO logic giữa signaling và gateway
- ❌ **Resource waste**: 3 replicas consuming 1.5GB RAM không được sử dụng
- ❌ **Complexity**: Hai signaling systems gây confusion

#### Migration Path:
```yaml
# Old (P2P):
VITE_SIGNALING_URL=https://api.jbcalling.site  # Python signaling service

# New (SFU):
VITE_GATEWAY_URL=https://webrtc.jbcalling.site  # NodeJS Gateway with MediaSoup
```

**Frontend changes**: None required (already using Gateway since Frontend 1.0.34)

---

### 2. `mediasoup` (Separate MediaSoup Worker Service)
**Image**: `jackboun11/jbcalling-mediasoup:1.1.x`  
**Purpose**: MediaSoup workers tách riêng khỏi signaling  
**Deprecated**: November 10, 2025  
**Replacement**: MediaSoup workers integrated into `gateway` service

#### Why Removed:
- ❌ **RTP capabilities mismatch**: Separate workers caused compatibility issues
- ❌ **Network complexity**: Cross-service communication overhead
- ❌ **Deployment complexity**: Separate deployment, scaling, monitoring
- ✅ **Better architecture**: All-in-one Gateway với MediaSoup workers integrated

#### Migration Path:
```yaml
# Old (Separate):
mediasoup:
  image: jackboun11/jbcalling-mediasoup:1.1.x
  environment:
    - WORKER_COUNT=2

# New (Integrated):
gateway:
  image: jackboun11/jbcalling-gateway:1.0.7
  environment:
    - WORKER_COUNT=2  # MediaSoup workers inside Gateway
    - RTC_MIN_PORT=40000
    - RTC_MAX_PORT=40100
```

**API changes**: None - Gateway exposes same MediaSoup API

---

## ✅ Current Architecture (Phase 5)

### Video Calling Stack
```
Frontend (React + MediaSoup Client)
  ↓ Socket.IO (WSS)
Gateway (NodeJS + Socket.IO + MediaSoup SFU)
  ↓ RTP/SRTP (UDP 40000-40100)
MediaSoup Workers (Integrated in Gateway)
  ↓ ICE/TURN fallback
Coturn (TURN Server for NAT traversal)
```

### Services Count
- **Before**: 14 services (with signaling)
- **After**: 13 services (consolidated)
- **Resource savings**: ~1.5GB RAM (3 signaling replicas removed)

### Active Services
| Service | Purpose | Status |
|---------|---------|--------|
| gateway | Socket.IO + MediaSoup SFU | ✅ Active |
| coturn | TURN server (NAT traversal) | ✅ Active |
| frontend | React UI | ✅ Active |
| stt | Speech-to-text | ✅ Active |
| translation | Translation service | ✅ Active |
| tts_* | Text-to-speech | ✅ Active |
| redis | Cache & session | ✅ Active |
| traefik | Reverse proxy | ✅ Active |
| monitoring | Prometheus, Grafana, Loki | ✅ Active |

---

## 🔄 Rollback Procedure (If Needed)

### If Gateway SFU Issues Found

#### Step 1: Restore signaling service
```bash
# Use backup stack with signaling
cd /home/hopboy2003/jbcalling_translation_realtime/infrastructure/swarm
scp stack-hybrid-with-signaling.yml.backup translation01:/tmp/stack-with-signaling.yml

# Deploy
ssh translation01 "docker stack deploy -c /tmp/stack-with-signaling.yml translation"
```

#### Step 2: Update Frontend environment
```bash
# Change frontend to use signaling instead of gateway
ssh translation01 "docker service update translation_frontend \
  --env-add REACT_APP_SIGNALING_URL=https://api.jbcalling.site \
  --env-rm REACT_APP_GATEWAY_URL \
  --force"
```

#### Step 3: Verify services
```bash
ssh translation01 "docker service ls | grep -E 'signaling|gateway'"
# Should see both running
```

#### Step 4: Test P2P video call
```
1. Open https://jbcalling.site
2. Create room
3. Join from second device
4. Verify P2P connection (check DevTools → Network → WSS to api.jbcalling.site)
```

---

## 📊 Comparison: Old vs New

### Old Architecture (P2P with Separate Services)
```
Pros:
- ✅ P2P direct connection (lower latency)
- ✅ Lower server bandwidth (peer-to-peer media)

Cons:
- ❌ Doesn't scale (N*(N-1)/2 connections)
- ❌ Complex (signaling + mediasoup + gateway)
- ❌ Higher client bandwidth (upload to all peers)
- ❌ No central processing (can't add translation pipeline)
- ❌ RTP capabilities mismatch issues
```

### New Architecture (SFU with Unified Gateway)
```
Pros:
- ✅ Scales better (N uploads, N downloads)
- ✅ Simple (gateway handles everything)
- ✅ Central processing point (translation pipeline ready)
- ✅ Consistent quality (server controls forwarding)
- ✅ Easy monitoring & recording
- ✅ No RTP mismatch issues

Cons:
- ⚠️ Higher server bandwidth (forward all streams)
- ⚠️ Higher server CPU (MediaSoup workers)
```

**Decision**: ✅ SFU chosen for translation pipeline integration capability

---

## 🎯 Lessons Learned

### 1. Architecture Consolidation Benefits
- **Simpler deployment**: One service instead of three (signaling, mediasoup, gateway)
- **Easier debugging**: All WebRTC logic in one place
- **Better performance**: No cross-service communication overhead
- **Lower maintenance**: Single codebase for video calling

### 2. When to Keep Services Separate
Keep separate when:
- Different programming languages/tech stacks
- Independent scaling requirements
- Clear separation of concerns
- Team ownership boundaries

Consolidate when:
- Tight coupling (signaling ↔ media server)
- Frequent communication overhead
- Shared state management
- Deployment complexity outweighs benefits

### 3. P2P vs SFU Trade-offs
**Use P2P when**:
- Small meetings (2-4 participants)
- Direct connection possible (no NAT/firewall)
- Low server resources
- No server-side processing needed

**Use SFU when**:
- Larger meetings (5+ participants)
- Need server-side processing (recording, translation)
- Consistent quality requirements
- Easier monitoring & control

---

## 📝 Updated Documentation

### Files Updated
1. ✅ `infrastructure/swarm/stack-hybrid.yml` - Removed signaling service
2. ✅ `docs/reports/DEPRECATED-SERVICES-NOV17.md` (this file)
3. ⏸️ `DOCUMENTATION-INDEX.md` - Update service count
4. ⏸️ `README.md` - Update architecture diagram
5. ⏸️ `docs/01-ARCHITECTURE.md` - Update WebRTC stack section
6. ⏸️ `docs/06-WEBRTC.md` - Update to reflect Gateway SFU only

### Backup Files Created
- `stack-hybrid-with-signaling.yml.backup` - Full stack with signaling service (Nov 17, 2025)

---

## 🚀 Next Steps

### Phase 6: Translation Pipeline Integration
With simplified architecture, ready to integrate translation:

```
Remote Audio Consumer (MediaSoup)
  ↓
Audio Track Extraction
  ↓
WebSocket → STT Service (PhoWhisper)
  ↓
API → Translation Service (NLLB-200)
  ↓
API → TTS Service (XTTS v2)
  ↓
WebAudio API → Play translated audio
```

**No signaling service conflicts** - clean architecture for AI integration.

---

## 📞 Support

### If Issues After Cleanup
1. Check Gateway logs: `docker service logs translation_gateway --tail 100`
2. Verify Gateway health: `curl https://webrtc.jbcalling.site/health`
3. Test video call: https://jbcalling.site
4. If needed, rollback using procedure above
5. Report issue with logs

### Questions
- **"Why remove working services?"** - Reduce complexity, prepare for Phase 6
- **"Can we add them back?"** - Yes, use backup stack file
- **"Will this break existing calls?"** - No, Gateway already handling all calls since Nov 17
- **"Performance impact?"** - Positive, removed unused services

---

**Deprecated By**: Development Team  
**Date**: November 17, 2025  
**Phase**: 5 (MediaSoup SFU Complete)  
**Related**: See `docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md`
