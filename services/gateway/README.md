# MediaSoup Gateway Service

WebRTC SFU (Selective Forwarding Unit) cho JB Calling Translation System sử dụng MediaSoup.

## 🎯 Tính năng

- ✅ Multi-party video conferencing (1-16 participants)
- ✅ Selective Forwarding Unit (SFU) architecture
- ✅ Audio extraction cho STT pipeline
- ✅ Room management với Redis
- ✅ WebSocket signaling với Socket.IO
- ✅ CPU-optimized (không cần GPU)
- ✅ Docker Swarm ready

## 🛠️ Tech Stack

- **MediaSoup v3**: WebRTC SFU engine
- **Node.js + TypeScript**: Backend runtime
- **Socket.IO v4**: Real-time signaling
- **Redis**: Room state & presence
- **Winston**: Logging

## 📋 Requirements

- Node.js >= 18.0.0
- Redis >= 7.0
- UDP ports 40000-40100 (configured)
- TCP ports 40000-40100 (configured)

## 🚀 Quick Start

### Development

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env

# Update .env với thông tin thực:
# - ANNOUNCED_IP=34.142.190.250
# - RTC_MIN_PORT=40000
# - RTC_MAX_PORT=40100

# Run development server
npm run dev
```

### Production

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

### Docker

```bash
# Build image
docker build -t jackboun11/jbcalling-gateway:1.0.0 .

# Run container
docker run -d \
  --name gateway \
  -p 3000:3000 \
  -p 40000-40100:40000-40100/udp \
  -p 40000-40100:40000-40100/tcp \
  -e ANNOUNCED_IP=34.142.190.250 \
  jackboun11/jbcalling-gateway:1.0.0
```

## 🔧 Configuration

Các environment variables quan trọng:

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `PORT` | HTTP server port | 3000 | No |
| `ANNOUNCED_IP` | Public IP cho WebRTC | - | **Yes** |
| `RTC_MIN_PORT` | Min RTC port range | 40000 | No |
| `RTC_MAX_PORT` | Max RTC port range | 40100 | No |
| `REDIS_HOST` | Redis hostname | localhost | No |
| `REDIS_PORT` | Redis port | 6379 | No |
| `WORKER_COUNT` | Số MediaSoup workers | CPU count | No |

## 📡 API Endpoints

### WebSocket Events

#### Client → Server

- `join-room`: Tham gia room
- `leave-room`: Rời room
- `get-router-rtp-capabilities`: Lấy router capabilities
- `create-webrtc-transport`: Tạo transport
- `connect-webrtc-transport`: Connect transport
- `produce`: Produce media
- `consume`: Consume media

#### Server → Client

- `room-participants`: Danh sách participants
- `new-producer`: Producer mới
- `producer-closed`: Producer đóng
- `consumer-closed`: Consumer đóng

### HTTP Endpoints

- `GET /health`: Health check
- `GET /stats`: MediaSoup statistics

## 🏗️ Architecture

```
Client (Browser)
    ↓ WebSocket
Socket.IO Server
    ↓
MediaSoup Router
    ↓
┌─────────────┬─────────────┬─────────────┐
│  Worker 1   │  Worker 2   │  Worker 3   │
│  (Router)   │  (Router)   │  (Router)   │
└─────────────┴─────────────┴─────────────┘
    ↓
Audio Tap → STT Service (Phase 6)
```

## 📝 Development

```bash
# Install dependencies
npm install

# Lint code
npm run lint

# Run tests
npm test

# Watch mode
npm run dev
```

## 🐳 Docker Deployment

Service này được deploy trên Docker Swarm với configuration:

- **Node**: translation02 (Worker)
- **Replicas**: 2
- **Resources**: 2 CPUs, 4GB RAM
- **Network**: frontend (Traefik)
- **Ports**: 40000-40100/udp, 40000-40100/tcp

## 📊 Monitoring

Service expose metrics cho Prometheus:

- Active rooms
- Active participants
- CPU usage per worker
- Memory usage
- Transport statistics

## 🔍 Troubleshooting

### WebRTC Connection Failed

1. Kiểm tra `ANNOUNCED_IP` đúng chưa
2. Verify firewall rules cho UDP/TCP ports
3. Check browser console for ICE errors

### High CPU Usage

1. Giảm `WORKER_COUNT`
2. Limit số participants per room
3. Reduce video resolution/bitrate

### Audio Not Working

1. Check `ENABLE_AUDIO_PROCESSING=true`
2. Verify audio codec trong router config
3. Check STT service connectivity

## 📚 Tài liệu tham khảo

- [MediaSoup Documentation](https://mediasoup.org/documentation/v3/)
- [Socket.IO Documentation](https://socket.io/docs/v4/)
- [WebRTC Best Practices](https://webrtc.org/getting-started/overview)

## 🤝 Contributing

1. Fork repository
2. Create feature branch
3. Make changes
4. Submit pull request

## 📄 License

MIT License - see LICENSE file
