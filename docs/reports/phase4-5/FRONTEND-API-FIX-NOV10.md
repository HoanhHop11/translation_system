# Frontend API Fix - November 10, 2025

**Ngày**: November 10, 2025  
**Issue**: Frontend event names không khớp với Gateway backend  
**Status**: ✅ FIXED

---

## 🔍 VẤN ĐỀ

Frontend Room.jsx sử dụng **camelCase event names** nhưng Gateway backend sử dụng **kebab-case event names** (chuẩn của MediaSoup community).

### Các Event Không Khớp:

| Frontend (OLD) | Backend (Expected) | Fixed? |
|----------------|-------------------|--------|
| `getRouterRtpCapabilities` | `get-router-rtp-capabilities` | ✅ |
| `createWebRtcTransport` | `create-webrtc-transport` | ✅ |
| `connectWebRtcTransport` | `connect-webrtc-transport` | ✅ |
| `produce` | `produce` | ✅ (unchanged) |
| `consume` | `consume` | ✅ (unchanged) |
| `resumeConsumer` | `resume-consumer` | ✅ |
| `newProducer` | `new-producer` | ✅ |
| `producerClosed` | `producer-closed` | ✅ |

### Payload Không Khớp:

**join-room:**
```javascript
// OLD (Frontend)
{
  roomId: string,
  userId: string,  // ❌
  username: string // ❌
}

// NEW (Backend expected)
{
  roomId: string,
  name: string     // ✅
}
// Backend có callback để set mapping
```

**create-webrtc-transport:**
```javascript
// OLD (Frontend)
{
  roomId: string,
  userId: string,  // ❌ Không cần
  forceTcp: boolean,
  producing: boolean,
  consuming: boolean
}

// NEW (Backend expected)
{
  roomId: string,
  forceTcp: boolean,
  producing: boolean,
  consuming: boolean
}
```

**connect-webrtc-transport:**
```javascript
// OLD (Frontend)
{
  roomId: string,     // ❌ Không cần
  transportId: string,
  dtlsParameters: object
}

// NEW (Backend expected)
{
  transportId: string,
  dtlsParameters: object
}
```

**consume:**
```javascript
// OLD (Frontend)
{
  roomId: string,       // ❌ Không cần
  transportId: string,
  producerId: string,
  rtpCapabilities: object
}

// NEW (Backend expected)
{
  transportId: string,
  producerId: string,
  rtpCapabilities: object
}
```

**resume-consumer:**
```javascript
// OLD (Frontend)
{
  roomId: string,    // ❌ Không cần
  consumerId: string
}

// NEW (Backend expected)
{
  consumerId: string
}
// Backend có callback confirmation
```

---

## ✅ THAY ĐỔI ĐÃ THỰC HIỆN

### 1. Join Room Event
```javascript
// Before
newSocket.emit('join-room', {
  roomId,
  userId,
  username
})

// After ✅
newSocket.emit('join-room', {
  roomId,
  name: username  // Backend expects 'name', not 'username'
}, (response) => {
  if (response && response.error) {
    console.error('❌ Failed to join room:', response.error)
    setConnectionState('failed')
  } else {
    console.log('✅ Room joined successfully:', response)
  }
})
```

### 2. Get Router RTP Capabilities
```javascript
// Before: getRouterRtpCapabilities
// After: get-router-rtp-capabilities ✅
socket.emit('get-router-rtp-capabilities', { roomId }, (response) => {
  if (response.error) {
    reject(new Error(response.error))
  } else {
    resolve(response.rtpCapabilities)
  }
})
```

### 3. Create WebRTC Transport
```javascript
// Before: createWebRtcTransport + userId
// After: create-webrtc-transport (no userId) ✅
socket.emit('create-webrtc-transport', {
  roomId,
  // userId removed ❌
  forceTcp: false,
  producing: true,
  consuming: false
}, (response) => { ... })
```

### 4. Connect WebRTC Transport
```javascript
// Before: connectWebRtcTransport + roomId
// After: connect-webrtc-transport (no roomId) ✅
socket.emit('connect-webrtc-transport', {
  // roomId removed ❌
  transportId: sendTrans.id,
  dtlsParameters
}, (response) => { ... })
```

### 5. Consume Media
```javascript
// Before: consume + roomId
// After: consume (no roomId) ✅
socket.emit('consume', {
  // roomId removed ❌
  transportId: recvTransport.id,
  producerId,
  rtpCapabilities: mediasoupDevice.rtpCapabilities
}, (response) => { ... })
```

### 6. Resume Consumer
```javascript
// Before: resumeConsumer + roomId
// After: resume-consumer (no roomId, with callback) ✅
socket.emit('resume-consumer', {
  // roomId removed ❌
  consumerId: consumer.id
}, (response) => {
  if (response && response.error) {
    console.error('Failed to resume consumer:', response.error)
  } else {
    console.log('✅ Consumer resumed:', consumer.id)
  }
})
```

### 7. Producer Events (Incoming)
```javascript
// Before: newProducer, producerClosed
// After: new-producer, producer-closed ✅

newSocket.on('new-producer', async (data) => {
  const { producerId, producerSocketId, kind } = data
  // Note: producerSocketId thay vì producerUserId
  if (producerSocketId === newSocket.id) {
    return // Skip own producer
  }
  await consumeMedia(producerId, producerSocketId, kind)
})

newSocket.on('producer-closed', (data) => {
  const { producerId } = data
  // Handle consumer cleanup
})
```

---

## 🧪 TESTING

### 1. WebSocket Connection Test
```bash
# Check WebSocket handshake
curl -I -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: test" \
  https://webrtc.jbcalling.site/socket.io/

# Expected: 101 Switching Protocols
```

### 2. Browser DevTools Test
```javascript
// Open DevTools Console on https://jbcalling.site/room/test123

// 1. Check WebSocket connection
// Network tab → Filter: WS
// Should see: wss://webrtc.jbcalling.site/socket.io/?EIO=4&transport=websocket
// Status: 101 Switching Protocols

// 2. Monitor Socket.IO events
// Console should show:
// ✅ Connected to signaling server
// ✅ Got router RTP capabilities
// ✅ MediaSoup device loaded
// ✅ Got send transport params
// ✅ Got recv transport params
// ✅ Send transport connected
// ✅ Recv transport connected
// ✅ Audio producer created: <id>
// ✅ Video producer created: <id>
```

### 3. Multi-User Test
```
1. User A: Join room 'test123'
   → Should see local video

2. User B: Join same room 'test123'
   → User A should see User B
   → User B should see User A

3. Both users: Toggle mic/camera
   → Icons should update on both sides

4. User A: Share screen
   → User B should see screen share

5. Chat test
   → Messages should appear on both sides
```

---

## 📝 BACKEND EXPECTATIONS

Backend Gateway service (TypeScript) expects:

### Socket.IO Event Handlers:

```typescript
// join-room
socket.on('join-room', async ({ roomId, name }, callback) => {
  // Backend sets mapping: socket.id → { roomId, name }
  callback({ success: true })
})

// get-router-rtp-capabilities
socket.on('get-router-rtp-capabilities', async ({ roomId }, callback) => {
  callback({ rtpCapabilities: router.rtpCapabilities })
})

// create-webrtc-transport
socket.on('create-webrtc-transport', async ({ 
  roomId, forceTcp, producing, consuming 
}, callback) => {
  // roomId from socket mapping (not from payload)
  callback({ 
    id, iceParameters, iceCandidates, dtlsParameters, sctpParameters 
  })
})

// connect-webrtc-transport
socket.on('connect-webrtc-transport', async ({ 
  transportId, dtlsParameters 
}, callback) => {
  // roomId from socket mapping
  await transport.connect({ dtlsParameters })
  callback({ success: true })
})

// produce
socket.on('produce', async ({ 
  transportId, kind, rtpParameters, appData 
}, callback) => {
  const producer = await transport.produce({ kind, rtpParameters, appData })
  
  // Notify other peers
  socket.to(roomId).emit('new-producer', {
    producerId: producer.id,
    producerSocketId: socket.id,
    kind
  })
  
  callback({ id: producer.id })
})

// consume
socket.on('consume', async ({ 
  transportId, producerId, rtpCapabilities 
}, callback) => {
  const consumer = await transport.consume({
    producerId,
    rtpCapabilities,
    paused: true
  })
  
  callback({ 
    id: consumer.id, 
    producerId, 
    kind: consumer.kind,
    rtpParameters: consumer.rtpParameters 
  })
})

// resume-consumer
socket.on('resume-consumer', async ({ consumerId }, callback) => {
  await consumer.resume()
  callback({ success: true })
})
```

---

## 🚀 DEPLOYMENT

### 1. Rebuild Frontend
```bash
cd /home/hopboy2003/jbcalling_translation_realtime/services/frontend

# Build new version
docker build -t frontend:1.0.10 .

# Tag for registry (if using)
docker tag frontend:1.0.10 YOUR_REGISTRY/frontend:1.0.10
```

### 2. Update Stack File
```yaml
# infrastructure/swarm/stack-optimized.yml
services:
  frontend:
    image: frontend:1.0.10  # Update version
    # ... rest of config
```

### 3. Redeploy
```bash
# On Manager Node (translation01)
ssh translation01
cd /home/hopboy2003/jbcalling_translation_realtime

# Deploy
docker stack deploy -c infrastructure/swarm/stack-optimized.yml translation

# Check frontend update
docker service ps translation_frontend

# Check logs
docker service logs translation_frontend -f
```

### 4. Verify
```bash
# Check frontend version
curl -I https://jbcalling.site

# Check WebSocket routing
curl -sk https://webrtc.jbcalling.site/health
# Expected: {"status":"healthy","workers":2}

# Test WebSocket upgrade
wscat -c wss://webrtc.jbcalling.site/socket.io/?EIO=4&transport=websocket
# Expected: Connected
```

---

## 🐛 TROUBLESHOOTING

### Issue: WebSocket Still Not Connecting

**Symptoms:**
```
DevTools Console:
❌ WebSocket connection failed
❌ net::ERR_CONNECTION_REFUSED
```

**Check:**
```bash
# 1. Gateway service running?
docker service ps translation_gateway

# 2. Gateway health?
curl http://10.148.0.3:3000/health

# 3. Traefik routing?
docker service logs translation_traefik | grep gateway

# 4. WebSocket endpoint accessible?
curl -I -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     https://webrtc.jbcalling.site/socket.io/
```

**Solution:**
- Gateway labels correct? (check stack-optimized.yml)
- Traefik detecting service? (check logs)
- Network overlay correct? (gateway in `frontend` network)
- Router WS configured? (`gateway-ws` router in labels)

---

### Issue: Events Not Received

**Symptoms:**
```
Console:
✅ Connected to signaling server
❌ No response from get-router-rtp-capabilities
Timeout getting router capabilities
```

**Check:**
```javascript
// In Browser DevTools
// 1. Check Socket.IO connection
socket.connected // should be true

// 2. Test event emission
socket.emit('get-router-rtp-capabilities', { roomId: 'test' }, (response) => {
  console.log('Response:', response)
})

// 3. Check backend logs
docker service logs translation_gateway -f
```

**Solution:**
- Event name correct? (kebab-case)
- Callback provided? (backend expects callback)
- roomId correct? (6-character code)
- Backend handler exists? (check Gateway source)

---

### Issue: Consumer Not Created

**Symptoms:**
```
Console:
✅ New producer from remote
❌ Failed to consume new producer: Cannot consume
```

**Check:**
```javascript
// Verify recvTransport ready
console.log('Recv transport:', recvTransport)
console.log('Device:', mediasoupDevice)
console.log('RTP capabilities:', mediasoupDevice.rtpCapabilities)
```

**Solution:**
- recvTransport created? (check transport creation)
- Device loaded? (check MediaSoup device init)
- RTP capabilities valid? (check get-router-rtp-capabilities response)
- Producer ID correct? (check new-producer event data)

---

## 📊 EXPECTED FLOW

### Successful WebRTC Call Flow:

```
1. Frontend loads
   → Initialize Socket.IO connection
   → Connect to wss://webrtc.jbcalling.site
   
2. Socket connects
   → Emit: join-room { roomId, name }
   → Receive: room-joined { participants }
   
3. Initialize MediaSoup
   → Emit: get-router-rtp-capabilities { roomId }
   → Receive: { rtpCapabilities }
   → Load MediaSoup Device
   
4. Create Transports
   → Emit: create-webrtc-transport (send) { roomId, producing: true }
   → Receive: { id, iceParameters, iceCandidates, dtlsParameters }
   → Create sendTransport
   
   → Emit: create-webrtc-transport (recv) { roomId, consuming: true }
   → Receive: { id, iceParameters, ... }
   → Create recvTransport
   
5. Connect Transports (automatic via transport.on('connect'))
   → Emit: connect-webrtc-transport { transportId, dtlsParameters }
   → Transport state: connected
   
6. Produce Media (automatic via transport.on('produce'))
   → Emit: produce { transportId, kind: 'audio', rtpParameters }
   → Receive: { id: producerId }
   → audioProducer created
   
   → Emit: produce { transportId, kind: 'video', rtpParameters }
   → Receive: { id: producerId }
   → videoProducer created
   
7. Remote Producer Notification
   → Receive: new-producer { producerId, producerSocketId, kind }
   → Emit: consume { transportId, producerId, rtpCapabilities }
   → Receive: { id: consumerId, rtpParameters, ... }
   → Create consumer
   
   → Emit: resume-consumer { consumerId }
   → Consumer resumes
   → Remote video/audio plays
   
8. Media Flowing ✅
   → Local: sending audio + video
   → Remote: receiving audio + video
   → Both sides: video + audio working
```

---

## 📚 REFERENCES

- **MediaSoup Documentation**: https://mediasoup.org/documentation/v3/
- **Socket.IO Documentation**: https://socket.io/docs/v4/
- **WebRTC API**: https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API

---

**Fixed By**: GitHub Copilot Agent  
**Date**: November 10, 2025  
**Status**: ✅ READY FOR TESTING  
**Next**: Redeploy Frontend → Test WebRTC call → Verify E2E flow
