# MediaSoup Service

Service chuyên xử lý WebRTC media routing sử dụng MediaSoup SFU.

## Mục đích

- Tạo và quản lý MediaSoup Routers cho mỗi room
- Tạo WebRTC Transports (send/receive)
- Quản lý Producers (media senders) và Consumers (media receivers)
- Routing RTP packets giữa các peers

## API Endpoints

### GET /health
Health check endpoint

### GET /router/:roomId/capabilities
Lấy RTP capabilities của router cho room

**Response:**
```json
{
  "rtpCapabilities": { ... }
}
```

### POST /transport/create
Tạo WebRTC Transport

**Request:**
```json
{
  "roomId": "room123",
  "type": "send" // or "receive"
}
```

**Response:**
```json
{
  "id": "transport-id",
  "iceParameters": { ... },
  "iceCandidates": [ ... ],
  "dtlsParameters": { ... }
}
```

### POST /transport/connect
Kết nối WebRTC Transport

**Request:**
```json
{
  "roomId": "room123",
  "transportId": "transport-id",
  "dtlsParameters": { ... }
}
```

### POST /producer/create
Tạo Producer

**Request:**
```json
{
  "roomId": "room123",
  "transportId": "transport-id",
  "kind": "audio", // or "video"
  "rtpParameters": { ... }
}
```

**Response:**
```json
{
  "id": "producer-id"
}
```

### POST /consumer/create
Tạo Consumer

**Request:**
```json
{
  "roomId": "room123",
  "transportId": "transport-id",
  "producerId": "producer-id",
  "rtpCapabilities": { ... }
}
```

**Response:**
```json
{
  "id": "consumer-id",
  "producerId": "producer-id",
  "kind": "audio",
  "rtpParameters": { ... }
}
```

### POST /consumer/:consumerId/resume
Resume consumer (start receiving media)

**Request:**
```json
{
  "roomId": "room123"
}
```

### DELETE /room/:roomId
Xóa room và cleanup tất cả resources

### GET /stats
Lấy statistics của service

## Environment Variables

- `PORT`: Port cho HTTP API (default: 4000)
- `WORKER_COUNT`: Số MediaSoup workers (default: 2)
- `RTC_MIN_PORT`: Min RTP port (default: 40000)
- `RTC_MAX_PORT`: Max RTP port (default: 40100)
- `ANNOUNCED_IP`: Public IP cho ICE candidates (required)
- `LOG_LEVEL`: MediaSoup log level (default: warn)

## Build & Run

```bash
# Development
npm install
npm run dev

# Production
npm run build
npm start

# Docker
docker build -t jbcalling-mediasoup:1.0.0 .
docker run -p 4000:4000 -p 40000-40100:40000-40100/udp \
  -e ANNOUNCED_IP=your-public-ip \
  jbcalling-mediasoup:1.0.0
```

## Architecture Integration

MediaSoup Service hoạt động như **internal microservice**, không expose trực tiếp ra internet. Signaling Service sẽ gọi các REST API endpoints để:

1. Tạo router khi room được tạo
2. Tạo transports khi peer join
3. Tạo producers/consumers cho media streaming
4. Cleanup khi peer leave hoặc room close

```
Frontend <--WebSocket--> Signaling Service <--HTTP--> MediaSoup Service
                         (Socket.IO)              (REST API)
```
