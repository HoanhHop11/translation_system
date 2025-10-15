# Services Directory

Thư mục này chứa tất cả các microservices của hệ thống.

## Cấu trúc

```
services/
├── api/                # API Gateway (FastAPI)
├── transcription/      # Speech-to-text service (Whisper)
├── translation/        # Translation service (NLLB)
├── voice-cloning/      # Voice synthesis (XTTS)
├── diarization/        # Speaker diarization (PyAnnote)
├── gateway/            # WebRTC gateway (MediaSoup)
├── frontend/           # React frontend (Next.js)
└── monitoring/         # Monitoring stack (Prometheus, Grafana, ELK)
```

## Trạng thái

| Service | Status | Documentation |
|---------|--------|---------------|
| api | 📋 Planned | [04-SERVICES.md](../docs/04-SERVICES.md) |
| transcription | 📋 Planned | [05-AI-MODELS.md](../docs/05-AI-MODELS.md) |
| translation | 📋 Planned | [05-AI-MODELS.md](../docs/05-AI-MODELS.md) |
| voice-cloning | 📋 Planned | [05-AI-MODELS.md](../docs/05-AI-MODELS.md) |
| diarization | 📋 Planned | [05-AI-MODELS.md](../docs/05-AI-MODELS.md) |
| gateway | 📋 Planned | [06-WEBRTC.md](../docs/06-WEBRTC.md) |
| frontend | 📋 Planned | [04-SERVICES.md](../docs/04-SERVICES.md) |
| monitoring | 📋 Planned | [09-MONITORING.md](../docs/09-MONITORING.md) |

## Development Timeline

Xem [11-ROADMAP.md](../docs/11-ROADMAP.md) cho timeline chi tiết:

- **Week 6-7**: API Gateway
- **Week 8-9**: Transcription Service
- **Week 10-11**: Translation Service
- **Week 12-13**: Voice Cloning + Diarization
- **Week 14-15**: WebRTC Gateway
- **Week 16-18**: Frontend

## Standards

Mỗi service PHẢI có:

### File Structure
```
service-name/
├── Dockerfile              # Multi-stage build
├── docker-compose.yml      # Local development
├── requirements.txt        # Python dependencies (nếu Python)
├── package.json           # Node dependencies (nếu Node.js)
├── README.md              # Service documentation
├── .env.example           # Environment variables template
├── src/                   # Source code
│   ├── main.py/app.js    # Entry point
│   ├── config.py/config.js # Configuration
│   ├── models/            # Data models
│   ├── routes/            # API routes (nếu có)
│   ├── services/          # Business logic
│   └── utils/             # Utilities
├── tests/                 # Tests
│   ├── unit/
│   ├── integration/
│   └── conftest.py
└── scripts/               # Helper scripts
    ├── start.sh
    ├── test.sh
    └── build.sh
```

### Documentation Requirements
- README.md với:
  - Mô tả service
  - Dependencies
  - Environment variables
  - API endpoints (nếu có)
  - How to run
  - How to test
  - Troubleshooting

### Code Standards
- Python: PEP 8, type hints, docstrings tiếng Việt
- JavaScript: ESLint + Prettier, JSDoc
- Tests: Coverage >80%
- Logging: Structured logging (JSON)
- Metrics: Prometheus metrics endpoint
- Health check: `/health` endpoint

### Docker Standards
- Multi-stage builds
- Non-root user
- Health checks
- Resource limits
- Environment variables
- Secrets via Docker secrets

## Next Steps

1. **Week 6**: Tạo API Gateway service
2. **Week 8**: Tạo Transcription service
3. **Week 10**: Tạo Translation service
4. **Week 12**: Tạo Voice Cloning + Diarization
5. **Week 14**: Tạo WebRTC Gateway
6. **Week 16**: Tạo Frontend

Xem chi tiết trong [11-ROADMAP.md](../docs/11-ROADMAP.md)

## Related Documentation

- [01-ARCHITECTURE.md](../docs/01-ARCHITECTURE.md) - Kiến trúc tổng thể
- [04-SERVICES.md](../docs/04-SERVICES.md) - Chi tiết implementation
- [05-AI-MODELS.md](../docs/05-AI-MODELS.md) - AI services specifics
- [06-WEBRTC.md](../docs/06-WEBRTC.md) - WebRTC gateway details
