# 06. WebRTC Implementation Guide

**Version**: 2.0  
**Status**: 🔄 In Progress  
**Last Updated**: 2025-01-04

---

## 📋 Mục Lục

1. [Tổng Quan](#tổng-quan)
2. [MediaSoup Architecture](#mediasoup-architecture)
3. [STUN/TURN Server Setup](#stunturn-server-setup)
4. [NAT Traversal & ICE](#nat-traversal--ice)
5. [Signaling Server](#signaling-server)
6. [Client Implementation](#client-implementation)
7. [Performance Optimization](#performance-optimization)
8. [Monitoring & Troubleshooting](#monitoring--troubleshooting)

---

## 🎯 Tổng Quan

### WebRTC Components

```
┌─────────────────────────────────────────────────────────────┐
│                      WebRTC Stack                            │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────┐      ┌──────────┐      ┌──────────────┐      │
│  │  Client  │◄────►│ Signaling│◄────►│  MediaSoup   │      │
│  │  (Web)   │      │  Server  │      │   SFU        │      │
│  └──────────┘      │ (FastAPI)│      │ (Instance 2) │      │
│                     └──────────┘      └──────────────┘      │
│       │                                      │               │
│       │                                      │               │
│       │            ┌──────────────┐          │               │
│       └───────────►│ STUN/TURN    │◄─────────┘               │
│                    │   Server     │                          │
│                    │ (coturn)     │                          │
│                    └──────────────┘                          │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Vai Trò Các Components

| Component | Vai Trò | Port | Protocol |
|-----------|---------|------|----------|
| **STUN Server** | Public IP discovery | 3478 | UDP/TCP |
| **TURN Server** | Relay khi P2P fail | 3478, 49152-65535 | UDP/TCP |
| **Signaling** | Exchange SDP/ICE | 8000 | WebSocket |
| **MediaSoup** | SFU media routing | 40000-49999 | UDP |

---

## 🏗️ MediaSoup Architecture

### Instance 2 Configuration

```yaml
Instance: translation02 (c2d-highcpu-8)
  vCPUs: 8
  RAM: 16GB
  Role: WebRTC Gateway

MediaSoup Workers:
  Count: 6 workers (1 per core, 2 cores reserved)
  CPU per worker: 1 core
  RAM per worker: 1GB
  Port range: 40000-49999

Capacity per Worker:
  Max consumers: ~500
  Realistic: ~400 consumers safe
  
Total Capacity:
  Max consumers: 6 × 500 = 3000
  Realistic: 6 × 400 = 2400 consumers
  
Room Capacity:
  4-person room: 4 × 3 streams × 3 peers = ~36 consumers
  6-person room: 6 × 3 streams × 5 peers = ~90 consumers
  
Concurrent Rooms (Theory):
  4-person: 2400 / 36 = ~66 rooms
  6-person: 2400 / 90 = ~26 rooms
  
Concurrent Rooms (Practice - Limited by STT):
  Realistic: 3-5 rooms per instance
  Bottleneck: CPU cho STT processing, không phải WebRTC
```

### MediaSoup Worker Configuration

```javascript
// services/gateway/src/config/mediasoup.config.js
module.exports = {
  // Số lượng workers
  numWorkers: process.env.MEDIASOUP_NUM_WORKERS || 6,
  
  worker: {
    rtcMinPort: parseInt(process.env.MEDIASOUP_RTC_MIN_PORT) || 40000,
    rtcMaxPort: parseInt(process.env.MEDIASOUP_RTC_MAX_PORT) || 49999,
    logLevel: 'warn',
    logTags: [
      'info',
      'ice',
      'dtls',
      'rtp',
      'srtp',
      'rtcp',
    ],
  },
  
  router: {
    mediaCodecs: [
      {
        kind: 'audio',
        mimeType: 'audio/opus',
        clockRate: 48000,
        channels: 2,
        parameters: {
          useinbandfec: 1,
          usedtx: 1,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/VP8',
        clockRate: 90000,
        parameters: {
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/VP9',
        clockRate: 90000,
        parameters: {
          'profile-id': 2,
          'x-google-start-bitrate': 1000,
        },
      },
      {
        kind: 'video',
        mimeType: 'video/H264',
        clockRate: 90000,
        parameters: {
          'packetization-mode': 1,
          'profile-level-id': '42e01f',
          'level-asymmetry-allowed': 1,
        },
      },
    ],
  },
  
  webRtcTransport: {
    listenIps: [
      {
        ip: '0.0.0.0',
        announcedIp: process.env.MEDIASOUP_ANNOUNCED_IP, // Public IP
      },
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true,
    maxIncomingBitrate: 2000000, // 2 Mbps
    initialAvailableOutgoingBitrate: 1000000, // 1 Mbps
  },
};
```

---

## 🌐 STUN/TURN Server Setup

### Tại Sao Cần STUN/TURN?

**Vấn đề NAT Traversal:**
- Clients thường ở sau NAT/Firewall (home router, corporate network)
- Không thể kết nối trực tiếp P2P
- Cần STUN để discover public IP
- Cần TURN để relay khi STUN fail (~15-20% cases)

**Khi nào dùng:**
- ✅ **STUN**: Client cần biết public IP của mình
- ✅ **TURN**: Symmetric NAT, corporate firewall, P2P fail
- ⚠️ **Bandwidth**: TURN relay tốn băng thông (plan accordingly)

### Option 1: Public STUN (Free, Chỉ Cho Development)

```javascript
// Frontend: src/config/webrtc.js
const iceServers = [
  {
    urls: 'stun:stun.l.google.com:19302',
  },
  {
    urls: 'stun:stun1.l.google.com:19302',
  },
];
```

**Limitations:**
- ❌ Không có TURN relay
- ❌ Không stable cho production
- ❌ Tỷ lệ fail cao (~15-20% users)

### Option 2: Self-hosted Coturn (Recommended)

#### Installation (Ubuntu 22.04)

```bash
# Install coturn
sudo apt update
sudo apt install -y coturn

# Enable coturn service
sudo sed -i 's/#TURNSERVER_ENABLED=1/TURNSERVER_ENABLED=1/' /etc/default/coturn
```

#### Configuration

```bash
# File: /etc/turnserver.conf
sudo tee /etc/turnserver.conf > /dev/null <<EOF
# Listening IPs
listening-ip=0.0.0.0
listening-port=3478
relay-ip=${INSTANCE_02_IP}  # Internal IP của instance 2

# External IP (public)
external-ip=${INSTANCE_02_PUBLIC_IP}

# Relay ports
min-port=49152
max-port=65535

# Authentication
lt-cred-mech
use-auth-secret
static-auth-secret=${COTURN_SECRET}  # Từ .env
realm=jbcalling.com

# Logging
log-file=/var/log/turnserver.log
verbose

# Performance
max-bps=1000000  # 1 Mbps per allocation
user-quota=12    # Max 12 allocations per user
total-quota=1200 # Max 1200 total allocations

# Security
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1

# Protocols
no-stun
fingerprint
EOF
```

#### Firewall Rules (Google Cloud)

```bash
# STUN/TURN TCP/UDP
gcloud compute firewall-rules create coturn-stun-turn \
  --allow=tcp:3478,udp:3478 \
  --target-tags=translation02 \
  --source-ranges=0.0.0.0/0 \
  --description="TURN/STUN server"

# TURN relay ports
gcloud compute firewall-rules create coturn-relay \
  --allow=udp:49152-65535 \
  --target-tags=translation02 \
  --source-ranges=0.0.0.0/0 \
  --description="TURN relay ports"
```

#### Start & Enable

```bash
# Start coturn
sudo systemctl start coturn
sudo systemctl enable coturn

# Check status
sudo systemctl status coturn

# Check logs
sudo tail -f /var/log/turnserver.log
```

#### Generate TURN Credentials (Time-Limited)

```python
# Backend: shared/utils/turn_credentials.py
import hmac
import hashlib
import time
from base64 import b64encode

def generate_turn_credentials(
    username: str,
    secret: str,
    ttl: int = 86400  # 24 hours
) -> dict:
    """
    Tạo TURN credentials tạm thời (time-limited).
    
    Args:
        username: User ID hoặc room ID
        secret: COTURN_SECRET từ .env
        ttl: Time-to-live in seconds
        
    Returns:
        dict: {username, credential, ttl}
    """
    timestamp = int(time.time()) + ttl
    turn_username = f"{timestamp}:{username}"
    
    # HMAC-SHA1
    credential = b64encode(
        hmac.new(
            secret.encode(),
            turn_username.encode(),
            hashlib.sha1
        ).digest()
    ).decode()
    
    return {
        "username": turn_username,
        "credential": credential,
        "ttl": ttl,
    }

# Usage
turn_creds = generate_turn_credentials(
    username="user123",
    secret=os.getenv("COTURN_SECRET")
)
```

#### Frontend ICE Configuration

```javascript
// Frontend: src/hooks/useWebRTC.js
import { useEffect, useState } from 'react';

const useWebRTC = () => {
  const [iceServers, setIceServers] = useState([]);
  
  useEffect(() => {
    // Fetch ICE servers từ backend
    fetch('/api/v1/webrtc/ice-servers')
      .then(res => res.json())
      .then(data => {
        setIceServers([
          // STUN (public, free)
          { urls: 'stun:stun.l.google.com:19302' },
          
          // TURN (self-hosted)
          {
            urls: `turn:${data.turnServerUrl}`,
            username: data.turnUsername,
            credential: data.turnCredential,
          },
        ]);
      });
  }, []);
  
  return { iceServers };
};

export default useWebRTC;
```

#### Backend API Endpoint

```python
# Backend: services/api/routes/webrtc.py
from fastapi import APIRouter, Depends
from shared.utils.turn_credentials import generate_turn_credentials
from shared.utils.auth import get_current_user
import os

router = APIRouter(prefix="/webrtc", tags=["WebRTC"])

@router.get("/ice-servers")
async def get_ice_servers(current_user = Depends(get_current_user)):
    """
    Trả về ICE servers configuration cho client.
    Includes STUN và TURN với credentials tạm thời.
    """
    coturn_secret = os.getenv("COTURN_SECRET")
    turn_server_url = os.getenv("TURN_SERVER_URL")
    
    if not coturn_secret or not turn_server_url:
        # Fallback: chỉ STUN
        return {
            "iceServers": [
                {"urls": "stun:stun.l.google.com:19302"}
            ]
        }
    
    # Generate time-limited TURN credentials
    turn_creds = generate_turn_credentials(
        username=current_user.id,
        secret=coturn_secret,
        ttl=86400  # 24 hours
    )
    
    return {
        "turnServerUrl": turn_server_url,
        "turnUsername": turn_creds["username"],
        "turnCredential": turn_creds["credential"],
        "iceServers": [
            # STUN
            {"urls": "stun:stun.l.google.com:19302"},
            
            # TURN
            {
                "urls": f"turn:{turn_server_url}",
                "username": turn_creds["username"],
                "credential": turn_creds["credential"],
            },
        ],
    }
```

### Option 3: Managed TURN Service (Commercial)

**Pros:**
- ✅ Zero maintenance
- ✅ Global edge locations
- ✅ Auto-scaling
- ✅ DDoS protection

**Cons:**
- ❌ Costly (~$0.10-0.50 per GB relay)
- ❌ Vendor lock-in

**Providers:**
- [Twilio TURN](https://www.twilio.com/stun-turn) - $0.40/GB
- [Xirsys](https://xirsys.com/) - $10-100/month
- [Metered.ca](https://www.metered.ca/) - $0.10/GB

---

## 🔄 NAT Traversal & ICE

### ICE (Interactive Connectivity Establishment)

```
┌─────────────────────────────────────────────────────┐
│             ICE Candidate Gathering                  │
├─────────────────────────────────────────────────────┤
│                                                       │
│  1. Host Candidates (Local IP)                       │
│     192.168.1.100:54321                              │
│                                                       │
│  2. Server Reflexive (STUN - Public IP)             │
│     STUN → 34.123.45.67:54321                        │
│                                                       │
│  3. Relay Candidates (TURN)                          │
│     TURN → 35.234.56.78:60000 (relayed)             │
│                                                       │
│  Priority: Host > Reflexive > Relay                  │
│  Try all, use best one                               │
│                                                       │
└─────────────────────────────────────────────────────┘
```

### Connection Flow

```
Client A                  Signaling               Client B
   │                         │                        │
   ├─► Gather ICE            │                        │
   │   candidates            │                        │
   │                         │                        │
   ├─► Create Offer ─────────┼───────────────────────►│
   │   (SDP + ICE)           │                        │
   │                         │      Gather ICE ◄──────┤
   │                         │      candidates        │
   │                         │                        │
   │◄──────────────────────────────── Create Answer ─┤
   │                         │      (SDP + ICE)       │
   │                         │                        │
   ├─► Try ICE candidates ◄──┼──► Try ICE candidates │
   │                         │                        │
   │◄────────────────── Direct P2P or via TURN ──────►│
   │                         │                        │
   │                  Media flowing                   │
   │◄─────────────────────────────────────────────────►│
```

### Troubleshooting ICE

```javascript
// Frontend: Monitor ICE connection state
peerConnection.oniceconnectionstatechange = () => {
  console.log('ICE State:', peerConnection.iceConnectionState);
  
  switch (peerConnection.iceConnectionState) {
    case 'checking':
      console.log('🔍 Checking ICE candidates...');
      break;
    case 'connected':
      console.log('✅ ICE connected');
      break;
    case 'completed':
      console.log('✅ ICE completed');
      break;
    case 'failed':
      console.error('❌ ICE failed - check TURN config');
      // Fallback logic here
      break;
    case 'disconnected':
      console.warn('⚠️ ICE disconnected - attempting reconnect');
      break;
    case 'closed':
      console.log('🔒 ICE closed');
      break;
  }
};

// Log ICE candidates
peerConnection.onicecandidate = (event) => {
  if (event.candidate) {
    console.log('ICE Candidate:', {
      type: event.candidate.type,
      protocol: event.candidate.protocol,
      address: event.candidate.address,
      port: event.candidate.port,
    });
  }
};
```

---

## 📡 Signaling Server

### WebSocket API (FastAPI)

```python
# Backend: services/api/routes/signaling.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Set
import json
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# In-memory storage (use Redis trong production)
rooms: Dict[str, Set[WebSocket]] = {}

@router.websocket("/ws/signaling/{room_id}")
async def websocket_signaling(websocket: WebSocket, room_id: str):
    """
    WebSocket endpoint cho signaling.
    
    Messages:
    - join: Join room
    - offer: SDP offer
    - answer: SDP answer
    - ice-candidate: ICE candidate
    - leave: Leave room
    """
    await websocket.accept()
    
    # Add to room
    if room_id not in rooms:
        rooms[room_id] = set()
    rooms[room_id].add(websocket)
    
    logger.info(f"Client joined room {room_id}. Total: {len(rooms[room_id])}")
    
    try:
        while True:
            # Receive message
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Broadcast to others in room (except sender)
            for client in rooms[room_id]:
                if client != websocket:
                    await client.send_text(data)
    
    except WebSocketDisconnect:
        # Remove from room
        rooms[room_id].discard(websocket)
        logger.info(f"Client left room {room_id}. Remaining: {len(rooms[room_id])}")
        
        # Clean up empty rooms
        if not rooms[room_id]:
            del rooms[room_id]
```

### Frontend Signaling Client

```javascript
// Frontend: src/services/SignalingService.js
class SignalingService {
  constructor(roomId) {
    this.roomId = roomId;
    this.ws = null;
    this.handlers = {};
  }
  
  connect() {
    const wsUrl = `ws://localhost:8000/ws/signaling/${this.roomId}`;
    this.ws = new WebSocket(wsUrl);
    
    this.ws.onopen = () => {
      console.log('✅ Signaling connected');
      this.send({ type: 'join', roomId: this.roomId });
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const handler = this.handlers[message.type];
      if (handler) {
        handler(message);
      }
    };
    
    this.ws.onerror = (error) => {
      console.error('❌ Signaling error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('🔒 Signaling closed');
      // Auto-reconnect logic
      setTimeout(() => this.connect(), 3000);
    };
  }
  
  on(type, handler) {
    this.handlers[type] = handler;
  }
  
  send(message) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }
  
  disconnect() {
    if (this.ws) {
      this.send({ type: 'leave' });
      this.ws.close();
    }
  }
}

export default SignalingService;
```

---

## 💻 Client Implementation

Xem chi tiết implementation trong **docs/07-API-REFERENCES.md** (TODO).

---

## ⚡ Performance Optimization

### 1. Bandwidth Optimization

```javascript
// Adaptive bitrate
const constraints = {
  video: {
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 30, max: 30 },
    // Simulcast cho adaptive quality
    encodings: [
      { rid: 'h', maxBitrate: 900000 },  // High
      { rid: 'm', maxBitrate: 300000, scaleResolutionDownBy: 2 },  // Medium
      { rid: 'l', maxBitrate: 100000, scaleResolutionDownBy: 4 },  // Low
    ],
  },
  audio: {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  },
};
```

### 2. CPU Optimization

```javascript
// Disable video khi không cần (audio-only mode)
const muteVideo = () => {
  const videoTrack = localStream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.enabled = false;
    // Hoặc stop hoàn toàn
    videoTrack.stop();
  }
};
```

### 3. Network Monitoring

```javascript
// Monitor connection quality
peerConnection.getStats().then(stats => {
  stats.forEach(report => {
    if (report.type === 'inbound-rtp' && report.kind === 'video') {
      console.log('Bitrate:', report.bytesReceived);
      console.log('Packet Loss:', report.packetsLost);
      console.log('Jitter:', report.jitter);
    }
  });
});
```

---

## 📊 Monitoring & Troubleshooting

### Metrics to Track

```yaml
WebRTC Metrics:
  - ICE connection state
  - DTLS connection state
  - Packet loss rate
  - RTT (Round Trip Time)
  - Jitter
  - Bandwidth usage

MediaSoup Metrics:
  - Active workers
  - Active routers
  - Active transports
  - Active producers/consumers
  - CPU usage per worker
  - Memory usage per worker

TURN Metrics:
  - Active allocations
  - Relay bandwidth usage
  - Success rate
  - Average session duration
```

### Prometheus Exporters

```yaml
# Coturn metrics
- job_name: 'coturn'
  static_configs:
    - targets: ['${INSTANCE_02_IP}:9641']

# MediaSoup metrics (custom exporter)
- job_name: 'mediasoup'
  static_configs:
    - targets: ['${INSTANCE_02_IP}:9100']
```

### Common Issues

| Issue | Symptom | Solution |
|-------|---------|----------|
| **No audio/video** | Black screen, no sound | Check permissions, firewall |
| **ICE failed** | Cannot connect | Configure TURN, check firewall |
| **High latency** | Delay >500ms | Check bandwidth, use TURN TCP |
| **Packet loss** | Choppy audio/video | Reduce bitrate, check network |
| **CPU maxed** | Lag, freezing | Reduce workers, lower resolution |

---

## 📚 References

- [MediaSoup Documentation](https://mediasoup.org/)
- [WebRTC for Curious](https://webrtcforthecurious.com/)
- [Coturn Documentation](https://github.com/coturn/coturn)
- [RFC 5389: STUN](https://datatracker.ietf.org/doc/html/rfc5389)
- [RFC 8656: TURN](https://datatracker.ietf.org/doc/html/rfc8656)

---

**Next**: [07. API References](./07-API-REFERENCES.md)
