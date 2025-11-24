# JBCalling Technical Documentation

**Platform**: Real-time Video Calling with AI Translation  
**Version**: 1.0 (November 2025)  
**Status**: Production-Ready ✅

---

## 📚 Documentation Structure

### Core Technical Documents

#### 1. **Technical Design Document (TDD)** - Complete System Design
The TDD is split into 5 parts (~10,300 lines total) covering the entire system architecture:

- **[Part 1: Executive Summary & System Overview](./TDD-JBCALLING-COMPLETE.md)**
  - High-level architecture
  - Technology stack decisions
  - Design philosophy
  - Migration benefits (PhoWhisper → Sherpa, NLLB → VinAI)
  - ~1,500 lines

- **[Part 2: Network & Docker Swarm Architecture](./TDD-PART2-NETWORK-SWARM.md)**  
  - Network topology (VPC, overlay networks, firewalls)
  - Docker Swarm orchestration (workers, placement, scaling)
  - Service deployment strategies
  - ~1,800 lines

- **[Part 3: AI Services Deep Dive](./TDD-PART3-AI-SERVICES.md)**
  - STT: Sherpa-ONNX (Vietnamese + English)
  - Translation: VinAI CTranslate2 (INT8)
  - TTS: gTTS + Redis caching
  - End-to-end performance analysis
  - Future improvements roadmap
  - ~2,500 lines

- **[Part 4: WebRTC & Gateway Architecture](./TDD-PART4-WEBRTC-GATEWAY.md)**
  - MediaSoup SFU architecture
  - WorkerManager, RoomManager, SignalingServer
  - AudioProcessor integration (STT pipeline)
  - Client-side mediasoup-client
  - ~2,000 lines

- **[Part 5: Deployment & Operations](./TDD-PART5-DEPLOYMENT-OPERATIONS.md)**
  - Docker Swarm deployment procedures
  - CI/CD pipeline (GitHub Actions)
  - Monitoring & alerting (Prometheus, Grafana)
  - Troubleshooting runbook
  - Maintenance procedures
  - ~2,000 lines

### Service-Specific Documentation

#### 2. **[STT Service Deployment Checklist](../services/stt-sherpa/DEPLOYMENT_CHECKLIST.md)**
- Sherpa-ONNX setup guide
- Model selection and performance benchmarks
- Migration guide from PhoWhisper
- ~425 lines

---

## 🎯 Quick Start Guide

### For New Team Members

1. **Start Here**: Read [TDD Part 1](./TDD-JBCALLING-COMPLETE.md) for system overview
2. **Understand Infrastructure**: Read [TDD Part 2](./TDD-PART2-NETWORK-SWARM.md) for network & Swarm
3. **Learn AI Pipeline**: Read [TDD Part 3](./TDD-PART3-AI-SERVICES.md) for STT/Translation/TTS
4. **WebRTC Deep Dive**: Read [TDD Part 4](./TDD-PART4-WEBRTC-GATEWAY.md) for media handling
5. **Deploy & Operate**: Read [TDD Part 5](./TDD-PART5-DEPLOYMENT-OPERATIONS.md) for operations

### For Developers

**Working on AI Services?**
- Focus on [TDD Part 3](./TDD-PART3-AI-SERVICES.md)
- Check service-specific docs in `services/*/`

**Working on WebRTC/Gateway?**
- Focus on [TDD Part 4](./TDD-PART4-WEBRTC-GATEWAY.md)
- Review `services/gateway/src/` code

**Working on DevOps/Infrastructure?**
- Focus on [TDD Part 2](./TDD-PART2-NETWORK-SWARM.md) and [Part 5](./TDD-PART5-DEPLOYMENT-OPERATIONS.md)
- Check `infrastructure/swarm/` configs

### For Operations Team

**Deploying the System?**
- Follow [TDD Part 5 - Deployment](./TDD-PART5-DEPLOYMENT-OPERATIONS.md#18-docker-swarm-deployment)

**Troubleshooting Issues?**
- Use [TDD Part 5 - Troubleshooting Runbook](./TDD-PART5-DEPLOYMENT-OPERATIONS.md#21-troubleshooting-runbook)

**Monitoring & Alerts?**
- Reference [TDD Part 5 - Monitoring](./TDD-PART5-DEPLOYMENT-OPERATIONS.md#20-monitoring--alerting)

---

## 📊 Key Metrics & Achievements

### Performance Improvements (Oct → Nov 2025)

| Metric | Before (Oct) | After (Nov) | Improvement |
|--------|--------------|-------------|-------------|
| **STT Image Size** | 7.0 GB | 370 MB | **95% smaller** ✅ |
| **STT RAM Usage** | 1.7 GB | 600 MB | **65% less** ✅ |
| **STT Latency** | 250ms | 75ms | **70% faster** ✅ |
| **Translation RAM** | 5 GB | 800 MB | **84% less** ✅ |
| **Translation Latency** | 300ms | 80ms | **73% faster** ✅ |
| **Pipeline Latency** | 800ms | 510ms | **40% faster** ✅ |
| **Infrastructure Cost** | $730/mo | $410/mo | **44% cheaper** ✅ |
| **OOM Crashes** | Daily | Zero (2 weeks) | **100% reliable** ✅ |

### System Capacity

- **Concurrent Rooms**: 5-7 rooms (with active translation)
- **Participants**: 10-15 total across all rooms
- **Translation Throughput**: 20-30 requests/second
- **Cache Hit Rate**: 40-65% (Translation), 60-80% (TTS)
- **Uptime**: 99.5%+ (target), currently 100% (2 weeks)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      CLIENT (Browser)                        │
│  - React SPA with WebRTC (mediasoup-client)                 │
│  - Video capture, audio streaming                           │
│  - Real-time transcription display                          │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTPS/WSS
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                   EDGE LAYER (Cloudflare)                    │
│  - DNS (*.jbcalling.site)                                   │
│  - DDoS Protection                                          │
│  - CDN (static assets)                                      │
└────────────────────────┬────────────────────────────────────┘
                         │ All traffic → 34.143.235.114
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              LOAD BALANCER (Traefik v2.10)                   │
│  - SSL termination (Let's Encrypt)                          │
│  - Host-based routing                                       │
│  - WebSocket upgrade                                        │
└─────┬───────────┬───────────┬───────────┬───────────────────┘
      │           │           │           │
      ▼           ▼           ▼           ▼
┌──────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────────┐
│ Frontend │ │ Gateway │ │   STT   │ │  Translation   │
│ (React)  │ │(MediaSoup)│ │(Sherpa)│ │   (VinAI)      │
│  3 rep   │ │  1 rep  │ │  1 rep  │ │    1 rep       │
└──────────┘ └────┬────┘ └────┬────┘ └────┬────────────┘
                  │           │           │
                  └───────────┴───────────┴──────┐
                                                  ▼
                                          ┌────────────┐
                                          │   Redis    │
                                          │  (Cache)   │
                                          └────────────┘

Infrastructure: Docker Swarm (3 nodes)
  - translation01 (4 vCPU, 30GB RAM): Manager + Frontend + Gateway
  - translation02 (8 vCPU, 16GB RAM): Worker (AI Services)
  - translation03 (4 vCPU, 8GB RAM):  Worker (Monitoring + TTS replica)
```

---

## 🔧 Technology Stack

### Core Technologies
- **Frontend**: React 18 + TypeScript + Vite
- **Gateway**: Node.js 20 + Express + Socket.IO + MediaSoup 3
- **WebRTC**: MediaSoup SFU (Selective Forwarding Unit)
- **Orchestration**: Docker Swarm (3-node cluster)
- **Load Balancer**: Traefik v2.10 (with Let's Encrypt)
- **Cache**: Redis 7 (dual-layer: in-memory + file)
- **Monitoring**: Prometheus + Grafana + Loki

### AI Services
- **STT**: Sherpa-ONNX (Zipformer-30M Vietnamese + Streaming English)
  - Runtime: ONNX Runtime (CPU optimized)
  - Quantization: INT8 (4x smaller, 3-5x faster)
  
- **Translation**: VinAI Translate v2 (CTranslate2 INT8)
  - Framework: CTranslate2 (CPU optimized)
  - Languages: Vietnamese ↔ English (specialized)
  
- **TTS**: gTTS (Google Text-to-Speech)
  - Engine: Google Cloud TTS wrapper (free)
  - Languages: 15+ supported

### Infrastructure
- **Cloud Provider**: Google Cloud Platform (asia-southeast1)
- **OS**: Ubuntu 22.04 LTS
- **Container Runtime**: Docker 24.0+
- **Network**: VPC (10.200.0.0/24) + Overlay networks
- **DNS**: Cloudflare (with DDoS protection)

---

## 📖 Document Conventions

### Code References
- File paths use absolute paths from repo root: `services/gateway/src/index.ts`
- Code blocks specify language for syntax highlighting
- Configuration examples use YAML format

### Terminology
- **SFU**: Selective Forwarding Unit (MediaSoup architecture)
- **STT**: Speech-to-Text (Sherpa-ONNX)
- **TTS**: Text-to-Speech (gTTS)
- **Gateway**: Node.js server handling WebRTC + Socket.IO
- **Worker**: MediaSoup C++ process OR Docker Swarm worker node (context-dependent)
- **Router**: MediaSoup logical room OR network router (context-dependent)

### Metrics Notation
- Latency: P50 (median), P95 (95th percentile), P99 (99th percentile)
- Throughput: requests/second or rooms/hour
- Resources: vCPU (virtual CPU cores), RAM in GB/MB

---

## 🚀 Next Steps

### Immediate (Q4 2025)
- [x] Complete TDD documentation (this document)
- [ ] Add unit tests for Gateway (Worker/Room managers)
- [ ] Implement AudioProcessor PlainTransport integration
- [ ] Create automated backup scripts

### Short-Term (Q1 2026)
- [ ] XTTS v2 voice cloning (async job queue)
- [ ] Streaming STT (partial results every 100ms)
- [ ] Language auto-detection (Whisper-based)
- [ ] Multi-node Gateway coordination (Redis session store)

### Medium-Term (Q2-Q3 2026)
- [ ] GPU acceleration (NVIDIA T4)
- [ ] Multi-region deployment (Europe, Americas)
- [ ] PostgreSQL integration (persistent user data)
- [ ] Admin dashboard (room management, analytics)

### Long-Term (2027+)
- [ ] On-device AI (WebAssembly + WebGPU)
- [ ] Mobile apps (React Native)
- [ ] Advanced analytics (call quality, user engagement)
- [ ] Enterprise features (SSO, RBAC, audit logs)

---

## 🤝 Contributing

### Documentation Updates
- Follow existing format and structure
- Use clear, concise language (technical but readable)
- Include code examples where helpful
- Add diagrams for complex concepts (ASCII art OK)

### Code Changes
- Reference TDD when implementing features
- Keep documentation in sync with code changes
- Update metrics/benchmarks if performance changes

---

## 📞 Contact & Support

**Maintainer**: Võ Nguyễn Hoành Hợp  
**Email**: hopboy2003@gmail.com  
**GitHub**: https://github.com/yourusername/jbcalling_translation_realtime

**Production Issues**: Use [Troubleshooting Runbook](./TDD-PART5-DEPLOYMENT-OPERATIONS.md#21-troubleshooting-runbook)  
**Feature Requests**: Open GitHub issue  
**Documentation Questions**: Email maintainer

---

**Last Updated**: November 19, 2025  
**Document Version**: 1.0  
**Status**: Production-Ready ✅