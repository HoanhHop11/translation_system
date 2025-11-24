# Giải Pháp Gateway Production-Ready

**Date**: November 10, 2025  
**Status**: Active - Production Architecture Design  
**Phase**: Gateway Fix & Optimization  
**Related**: TRAEFIK-GATEWAY-INVESTIGATION-OCT15.md, WRAP-UP-OCT15.md

---

## 🎯 Executive Summary

Hệ thống hiện tại gặp vấn đề với **MediaSoup Gateway không start HTTP/Socket.IO server** sau khi validate config. Qua nghiên cứu Socket.IO, MediaSoup, và Docker Swarm documentation, tôi đề xuất **3 giải pháp production-ready** với trade-offs rõ ràng.

**Current Issues:**
- ❌ Gateway service logs dừng sau config validation
- ❌ Không có "Server listening on port 3000" 
- ❌ Redis connection fail (đã fix: `redis_gateway` → `translation_redis_gateway`)
- ❌ HTTP/WebSocket requests timeout
- ❌ Frontend không kết nối được Socket.IO

---

## 📊 Architecture Analysis

### Current Stack (95% Complete)

```
┌─────────────────────────────────────────────────────────┐
│ EXTERNAL                                                │
│  ↓ DNS: *.jbcalling.site → 34.143.235.114             │
└─────────────────────────────────────────────────────────┘
         │
         ↓
┌─────────────────────────────────────────────────────────┐
│ translation01 (Manager Node) - 4 vCPU, 30GB RAM        │
│  ├─ Traefik (Port 80/443)                             │
│  ├─ Redis Main                                          │
│  └─ Core Services                                       │
└─────────────────────────────────────────────────────────┘
         │
    ┌────┴──────┐
    ↓           ↓
┌──────────────────┐           ┌──────────────────────────┐
│ translation02    │           │ translation03            │
│ Worker Node      │           │ Worker Node              │
│ 8 vCPU, 16GB RAM │           │ 4 vCPU, 8GB RAM          │
│                  │           │                          │
│ ❌ Gateway (3000)│           │ ✅ Signaling (8001)      │
│ ✅ STT (8002)    │           │ ✅ Frontend (80)         │
│ ✅ TTS (8003)    │           │ ✅ Translation (8004)    │
│ ✅ Redis Gateway │           │ ✅ TTS Replica (8003)    │
└──────────────────┘           └──────────────────────────┘
```

### Problem Identification

**Gateway Service Issue:**
```yaml
# Stack Config (Correct)
environment:
  - REDIS_HOST=translation_redis_gateway  # ✅ Fixed
  - PORT=3000
  - WORKER_COUNT=2

# Expected Logs:
✅ Configuration validated successfully
✅ Workers: 2
✅ RTC Ports: 40000-40100
✅ Audio Streaming: Enabled
⚠️ Server listening on port 3000          # ← MISSING!
⚠️ Socket.IO initialized                  # ← MISSING!
⚠️ MediaSoup workers created              # ← MISSING!

# Actual Logs: STOPS after config validation
```

**Root Causes:**
1. **Application Code Issue**: Gateway không start HTTP server sau config
2. **Dependency Missing**: Có thể thiếu critical dependency hoặc environment variable
3. **Silent Crash**: Application crash nhưng không log error

---

## ✅ Giải Pháp 1: Hybrid Architecture (RECOMMENDED)

### Concept

Sử dụng **Signaling service** (FastAPI + Socket.IO) cho signaling + **standalone MediaSoup workers** cho media routing.

### Architecture

```
Frontend (Browser)
    │
    │ wss://api.jbcalling.site/socket.io/
    ↓
Signaling Service (FastAPI + Socket.IO)
  - Room management
  - User authentication  
  - Socket.IO events (join-room, leave-room)
  - WebRTC signaling only (SDP exchange)
    │
    │ HTTP REST
    ↓
MediaSoup Service (Pure Node.js Worker)
  - MediaSoup Router management
  - Transport creation (WebRtcTransport)
  - Producer/Consumer management
  - RTP packet routing
  - NO HTTP server (internal only)
```

### Implementation

#### Step 1: Tạo MediaSoup Service Mới

```typescript
// services/mediasoup/src/worker.ts
import * as mediasoup from 'mediasoup';
import express from 'express';

const app = express();
app.use(express.json());

// MediaSoup Router Map
const routers = new Map();

// Initialize MediaSoup Workers
async function initMediaSoup() {
  const workers = [];
  const workerCount = parseInt(process.env.WORKER_COUNT || '2');
  
  for (let i = 0; i < workerCount; i++) {
    const worker = await mediasoup.createWorker({
      logLevel: 'warn',
      rtcMinPort: 40000,
      rtcMaxPort: 40100,
    });
    workers.push(worker);
    console.log(`✅ MediaSoup worker ${i} created (PID: ${worker.pid})`);
  }
  
  return workers;
}

// REST API Endpoints
app.post('/router/create', async (req, res) => {
  const { roomId } = req.body;
  // Create router for room
  const router = await workers[0].createRouter({
    mediaCodecs: [
      { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
      { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }
    ]
  });
  routers.set(roomId, router);
  res.json({ rtpCapabilities: router.rtpCapabilities });
});

app.post('/transport/create', async (req, res) => {
  const { roomId, type } = req.body;
  const router = routers.get(roomId);
  
  const transport = await router.createWebRtcTransport({
    listenIps: [{ ip: '0.0.0.0', announcedIp: process.env.ANNOUNCED_IP }],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
  });
  
  res.json({
    id: transport.id,
    iceParameters: transport.iceParameters,
    iceCandidates: transport.iceCandidates,
    dtlsParameters: transport.dtlsParameters
  });
});

// Start internal API server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ MediaSoup service listening on port ${PORT}`);
});

initMediaSoup();
```

#### Step 2: Update Signaling Service

```python
# services/api/signaling.py (FastAPI + Socket.IO)
from fastapi import FastAPI
import socketio
import httpx

app = FastAPI()
sio = socketio.AsyncServer(async_mode='asgi', cors_allowed_origins='*')
socket_app = socketio.ASGIApp(sio, app)

# MediaSoup service client
mediasoup_client = httpx.AsyncClient(base_url='http://mediasoup:4000')

@sio.on('join-room')
async def join_room(sid, data):
    room_id = data['roomId']
    
    # Create MediaSoup router
    response = await mediasoup_client.post('/router/create', json={'roomId': room_id})
    rtp_capabilities = response.json()['rtpCapabilities']
    
    await sio.emit('room-joined', {
        'rtpCapabilities': rtp_capabilities
    }, room=sid)

@sio.on('create-transport')
async def create_transport(sid, data):
    room_id = data['roomId']
    transport_type = data['type']
    
    # Request transport from MediaSoup service
    response = await mediasoup_client.post('/transport/create', json={
        'roomId': room_id,
        'type': transport_type
    })
    transport_params = response.json()
    
    await sio.emit('transport-created', transport_params, room=sid)
```

#### Step 3: Stack Configuration

```yaml
# infrastructure/swarm/stack-optimized.yml

services:
  signaling:
    image: jackboun11/jbcalling-api:1.0.1
    networks:
      - backend
      - frontend
    environment:
      - MEDIASOUP_SERVICE_URL=http://mediasoup:4000
    deploy:
      replicas: 3
      placement:
        constraints:
          - node.labels.instance == translation03
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.signaling.rule=Host(`api.jbcalling.site`)"
        - "traefik.http.routers.signaling.entrypoints=websecure"
        - "traefik.http.routers.signaling.tls=true"
        - "traefik.http.services.signaling.loadbalancer.server.port=8001"
        # ✅ Socket.IO sticky sessions
        - "traefik.http.services.signaling.loadbalancer.sticky.cookie=true"
        - "traefik.http.services.signaling.loadbalancer.sticky.cookie.name=signaling_affinity"

  mediasoup:
    image: jackboun11/jbcalling-mediasoup:1.0.0
    networks:
      - backend
    ports:
      - target: 40000-40100
        published: 40000-40100
        protocol: udp
        mode: host  # ⚠️ CRITICAL: host mode cho RTP
    environment:
      - PORT=4000
      - WORKER_COUNT=2
      - ANNOUNCED_IP=34.142.190.250  # translation02 IP
    deploy:
      mode: replicated
      replicas: 1
      placement:
        constraints:
          - node.labels.instance == translation02
      resources:
        limits:
          cpus: '2.0'
          memory: 3G
```

### Advantages

✅ **Separation of Concerns**: Signaling và Media Routing tách biệt  
✅ **Easier Debugging**: Logs rõ ràng cho từng component  
✅ **Scalable**: Có thể scale Signaling và MediaSoup độc lập  
✅ **Production-Proven**: Pattern này được Socket.IO + MediaSoup recommend  
✅ **Redis Integration**: Signaling có thể dùng Redis Adapter cho multi-instance  

### Disadvantages

⚠️ **More Services**: Thêm 1 service (MediaSoup worker)  
⚠️ **Network Latency**: Extra hop giữa Signaling và MediaSoup (~1-2ms)  
⚠️ **Deployment Complexity**: Cần build thêm 1 Docker image  

---

## ✅ Giải Pháp 2: Socket.IO Cluster với Redis Adapter

### Concept

Deploy multiple **pure Socket.IO + MediaSoup** instances với Redis Adapter cho sticky sessions và message broadcasting.

### Architecture

```
                    Redis Pub/Sub
                         │
        ┌────────────────┼────────────────┐
        │                │                │
   Instance 1       Instance 2       Instance 3
   (translation02)  (translation03)  (translation03)
        │                │                │
        └────────────────┴────────────────┘
                         │
                    Traefik Ingress
              (sticky sessions via cookie)
```

### Implementation

```typescript
// services/gateway/src/cluster-server.ts
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import * as mediasoup from 'mediasoup';

const httpServer = createServer();

// Redis clients
const pubClient = createClient({ url: process.env.REDIS_URL });
const subClient = pubClient.duplicate();

await Promise.all([
  pubClient.connect(),
  subClient.connect(),
]);

// Socket.IO with Redis Adapter
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CORS_ORIGIN,
    credentials: true
  },
  transports: ['websocket', 'polling'],
  adapter: createAdapter(pubClient, subClient)
});

// MediaSoup Workers
const workers = [];
for (let i = 0; i < 2; i++) {
  const worker = await mediasoup.createWorker({
    logLevel: 'warn',
    rtcMinPort: 40000,
    rtcMaxPort: 40100,
  });
  workers.push(worker);
  console.log(`✅ Worker ${i} created (PID: ${worker.pid})`);
}

// Socket.IO Events
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);
  
  socket.on('join-room', async (data, callback) => {
    const { roomId, name } = data;
    
    // Create router for room
    const worker = workers[Math.floor(Math.random() * workers.length)];
    const router = await worker.createRouter({
      mediaCodecs: [
        { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
        { kind: 'video', mimeType: 'video/VP8', clockRate: 90000 }
      ]
    });
    
    // Store router (consider using Redis for persistence)
    socket.data.router = router;
    socket.join(roomId);
    
    callback({ rtpCapabilities: router.rtpCapabilities });
  });
  
  // ... other Socket.IO events
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`✅ Gateway listening on port ${PORT}`);
  console.log(`✅ Socket.IO initialized with Redis adapter`);
});
```

### Stack Configuration

```yaml
services:
  gateway:
    image: jackboun11/jbcalling-gateway:2.0.0  # New version with Redis Adapter
    networks:
      - backend
      - frontend
    environment:
      - PORT=3000
      - REDIS_URL=redis://translation_redis_gateway:6379
      - WORKER_COUNT=2
      - ANNOUNCED_IP=34.142.190.250
    deploy:
      mode: replicated
      replicas: 3  # Scale horizontally
      placement:
        max_replicas_per_node: 1
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.gateway.rule=Host(`webrtc.jbcalling.site`)"
        - "traefik.http.routers.gateway.entrypoints=websecure"
        - "traefik.http.services.gateway.loadbalancer.server.port=3000"
        # ✅ Sticky sessions CRITICAL
        - "traefik.http.services.gateway.loadbalancer.sticky.cookie=true"
        - "traefik.http.services.gateway.loadbalancer.sticky.cookie.name=gateway_affinity"
        - "traefik.http.services.gateway.loadbalancer.sticky.cookie.httpOnly=true"
```

### Advantages

✅ **Socket.IO Native**: Dùng Socket.IO Redis Adapter chính thức  
✅ **Horizontal Scaling**: Scale tới N instances  
✅ **Message Broadcasting**: Redis Pub/Sub cho room broadcasts  
✅ **Production-Tested**: Pattern được Socket.IO documentation recommend  

### Disadvantages

⚠️ **Sticky Sessions Required**: MUST có sticky sessions hoặc clients sẽ lose connection  
⚠️ **Redis Dependency**: Single point of failure nếu Redis down  
⚠️ **Complex State Management**: Router/Transport state phải persist hoặc recreate  

---

## ✅ Giải Pháp 3: Debug và Fix Current Gateway

### Concept

Tìm và fix root cause của Gateway service hiện tại không start HTTP server.

### Debugging Steps

#### Step 1: Exec vào Container

```bash
# Find container ID
docker ps --filter "name=translation_gateway"

# Exec into container
docker exec -it <container_id> /bin/sh

# Check if Node.js process running
ps aux | grep node

# Check listening ports
netstat -tuln | grep 3000

# Check logs trong container
tail -f /var/log/*.log
```

#### Step 2: Check Environment Variables

```bash
docker exec <container_id> env | grep -E "REDIS|PORT|WORKER"
```

#### Step 3: Manual Start Test

```bash
# Inside container
cd /app
node src/index.js  # Hoặc entry point của Gateway

# Xem error messages chi tiết
```

#### Step 4: Check Dependencies

```bash
# Inside container
npm list | grep -E "mediasoup|socket\.io|redis"

# Verify MediaSoup binary
ls -la node_modules/mediasoup/worker/out/Release/
```

### Common Issues & Fixes

**Issue 1: Missing Environment Variable**
```yaml
# Add missing vars
environment:
  - NODE_ENV=production
  - DEBUG=mediasoup:*  # Enable debug logs
  - MEDIASOUP_ENABLE_SCTP=true
```

**Issue 2: Permission Issues**
```dockerfile
# Dockerfile fix
RUN chown -R node:node /app
USER node
```

**Issue 3: Port Already in Use**
```yaml
# Check for port conflicts
ports:
  - target: 3000
    published: 3001  # Use different external port
```

**Issue 4: Missing Node Modules**
```dockerfile
# Rebuild with clean install
RUN npm ci --only=production
RUN npm rebuild mediasoup --build-from-source
```

### Advantages

✅ **No Architecture Change**: Keep existing design  
✅ **Root Cause Fix**: Solve underlying problem  
✅ **Learning Opportunity**: Understand the codebase better  

### Disadvantages

⚠️ **Time-Consuming**: May take hours to debug  
⚠️ **Uncertain Success**: Root cause may be hard to find  
⚠️ **Code Quality**: Original Gateway code may have other issues  

---

## 📊 Comparison Matrix

| Criterion | Hybrid (Sol 1) | Cluster (Sol 2) | Debug (Sol 3) |
|-----------|----------------|-----------------|---------------|
| **Implementation Time** | 2-3 days | 1-2 days | 1-4 hours (uncertain) |
| **Production Readiness** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Scalability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Maintainability** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |
| **Debugging Ease** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐ |
| **Resource Usage** | Medium | Medium-High | Low |
| **Network Latency** | +1-2ms | Minimal | Minimal |
| **Failure Isolation** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ |

---

## 🎯 Recommendation: Hybrid Architecture (Solution 1)

### Why?

1. **Best Practices**: Follows microservices principles
2. **Production-Proven**: Used by major platforms (Zoom, Discord patterns)
3. **Easier Debugging**: Clear separation of concerns
4. **Future-Proof**: Can scale Signaling và MediaSoup independently
5. **Socket.IO Compatibility**: Signaling service có thể dùng Redis Adapter
6. **Monitoring**: Easier to monitor and alert on separate services

### Implementation Timeline

**Week 1: Core Development**
- Day 1-2: Build MediaSoup Service (Node.js REST API)
- Day 3-4: Update Signaling Service (FastAPI + Socket.IO)
- Day 5: Integration Testing

**Week 2: Production Deployment**
- Day 1: Build Docker images
- Day 2: Update stack files and deploy to staging
- Day 3: Load testing and optimization
- Day 4: Production deployment
- Day 5: Monitoring and documentation

### Immediate Next Steps

1. **Create MediaSoup Service Repository**
   ```bash
   mkdir services/mediasoup
   cd services/mediasoup
   npm init -y
   npm install mediasoup express
   ```

2. **Update Frontend `.env`** (Keep current workaround)
   ```env
   # Temporarily use api.jbcalling.site
   VITE_GATEWAY_URL=https://api.jbcalling.site
   ```

3. **Implement Basic MediaSoup Service**
   - Router management
   - Transport creation
   - Producer/Consumer handling

4. **Update Signaling Service**
   - Add Socket.IO server
   - Integrate with MediaSoup service
   - Implement WebRTC signaling flow

---

## 🔧 Quick Win: Temporary Workaround

Trong khi implement Solution 1, có thể dùng **pure Signaling service** để test E2E flow:

```python
# services/api/signaling.py - Add Socket.IO
import socketio
from fastapi import FastAPI

app = FastAPI()
sio = socketio.AsyncServer(
    async_mode='asgi',
    cors_allowed_origins='*',
    logger=True,
    engineio_logger=True
)
socket_app = socketio.ASGIApp(sio, app)

@sio.on('connect')
async def connect(sid, environ):
    print(f"✅ Client connected: {sid}")

@sio.on('join-room')
async def join_room(sid, data):
    room_id = data.get('roomId')
    print(f"📥 Join room: {room_id}")
    await sio.enter_room(sid, room_id)
    await sio.emit('room-joined', {'success': True}, room=sid)

# Mount to FastAPI
app.mount('/socket.io', socket_app)
```

**Deploy:**
```bash
# Build
cd services/api
docker build -t jackboun11/jbcalling-api:1.0.2 .
docker push jackboun11/jbcalling-api:1.0.2

# Update service
ssh hopboy2003@translation01 "docker service update --image jackboun11/jbcalling-api:1.0.2 translation_signaling"
```

**Test:**
```bash
curl -sk https://api.jbcalling.site/socket.io/ 
# Should return Socket.IO handshake
```

---

## 📚 References

### Socket.IO Production Deployment
- **Redis Adapter**: https://socket.io/docs/v4/redis-adapter/
- **Cluster Setup**: https://socket.io/docs/v4/using-multiple-nodes/
- **Sticky Sessions**: https://socket.io/docs/v4/load-balancing/

### MediaSoup Best Practices
- **Architecture**: https://mediasoup.org/documentation/v3/mediasoup/design/
- **Docker Deployment**: https://github.com/versatica/mediasoup/blob/v3/doc/Building.md
- **Production Tips**: https://mediasoup.discourse.group/

### Docker Swarm
- **Overlay Networks**: https://docs.docker.com/network/overlay/
- **Service Discovery**: https://docs.docker.com/engine/swarm/networking/
- **Ingress Routing**: https://docs.docker.com/engine/swarm/ingress/

---

## ✅ Success Criteria

Khi hoàn thành, system phải đạt được:

1. **WebSocket Connection**: Frontend connect thành công tới Socket.IO
2. **Room Join**: User có thể join room và receive callback
3. **RTP Capabilities**: MediaSoup router RTP capabilities được trả về
4. **Transport Creation**: WebRTC transports được tạo thành công
5. **Media Flow**: Audio/Video stream giữa peers
6. **Scalability**: System có thể scale tới 10+ concurrent rooms
7. **Monitoring**: Logs rõ ràng cho debugging
8. **Zero Downtime**: Rolling updates không ảnh hưởng active connections

---

**Next Action**: Chọn giải pháp và bắt đầu implementation. Recommend **Solution 1 (Hybrid)** cho production long-term.
