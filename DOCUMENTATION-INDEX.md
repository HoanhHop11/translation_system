# 📚 Documentation Index - December 7, 2025

**Cấu trúc documentation đã được tổ chức lại để dễ quản lý và tìm kiếm.**

> 🆕 **Cập nhật mới nhất (Dec 7, 2025):**
> - **Piper TTS 2.0.1** - Vietnamese + English voices với CORS support
> - **Gateway 2.0.6** - Per-participant VAD, Opus decode fixes, VAD tuning
> - **Frontend 2.0.16** - Auto-TTS, LocalVAD tuning, declarative mute sync
> - **Work Log**: `docs/wrap-ups/WORK-LOG-DEC2025.md` - Nhật ký làm việc chi tiết
>
> **Cập nhật trước (Dec 2, 2025):**
> - Thêm `docs/FIREWALL-CONFIGURATION.md` - Hướng dẫn cấu hình Firewall Rules
> - Thêm `scripts/setup-firewall-rules.sh` - Script tự động tạo firewall rules
> - TTS Services đã chuyển sang Docker Hub image
> - **Reorganized**: Di chuyển các file vào đúng thư mục (reports/, investigations/, tdd/)

---

## 🎯 Files Quan Trọng Nhất (Root Level)

### ⭐ Essential Documentation
1. **[README.md](./README.md)** - Project overview, current status
2. **[ROADMAP-UPDATED-OCT2025.md](./ROADMAP-UPDATED-OCT2025.md)** - Project timeline & progress
3. **This file** - Documentation navigation guide

---

## 📂 Cấu Trúc Thư Mục Mới

```
jbcalling_translation_realtime/
│
├── 📄 README.md                          ⭐ START HERE
├── 📄 ROADMAP-UPDATED-OCT2025.md         ⭐ PROJECT ROADMAP
├── 📄 DOCUMENTATION-INDEX.md             ⭐ THIS FILE
│
├── 📁 docs/                              # Technical documentation
│   ├── 01-ARCHITECTURE.md                # System architecture
│   ├── 02-SETUP-GUIDE.md                 # GCP & Swarm setup
│   ├── 03-DOCKER-SWARM.md                # Swarm management
│   ├── 04-SERVICES.md                    # Service configs
│   ├── 05-AI-MODELS.md                   # STT/Translation/TTS
│   ├── 06-WEBRTC.md                      # WebRTC & MediaSoup
│   ├── 07-API-REFERENCES.md              # API endpoints
│   ├── 08-DEPLOYMENT.md                  # Deployment guide
│   ├── 09-MONITORING.md                  # Monitoring setup
│   ├── 10-TROUBLESHOOTING.md             # Common issues
│   ├── 11-IPV6-SETUP-GUIDE.md            # IPv6 setup
│   ├── 12-FEASIBILITY-ANALYSIS.md        # Feasibility study
│   ├── FIREWALL-CONFIGURATION.md         # 🆕 GCP Firewall Rules
│   ├── INTEGRATION-GUIDE.md              # Integration guide
│   ├── IPV6-QUICK-START.md               # IPv6 quick start
│   ├── LICENSE-COMPLIANCE.md             # License info
│   ├── MIGRATION-PLAN-DEC2025.md         # Migration plan
│   ├── SSH-SETUP-GUIDE.md                # SSH setup
│   ├── SSL-DEPLOYMENT-GUIDE.md           # SSL/TLS setup
│   ├── SYSTEM-ARCHITECTURE-DESIGN-SAD.md # SAD with diagrams
│   │
│   ├── 📁 wrap-ups/                      # Session wrap-up reports
│   │   ├── WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md
│   │   ├── WRAP-UP-NOV11-FINAL.md
│   │   └── WRAP-UP-OCT15.md
│   │
│   ├── 📁 reports/                       # All reports & summaries
│   │   ├── 📁 phase1/                    # Phase 1 deployment
│   │   ├── 📁 phase2/                    # Phase 2 SSL/HTTPS
│   │   ├── 📁 phase3/                    # Phase 3 AI Services
│   │   ├── 📁 phase4-5/                  # Phase 4-5 WebRTC
│   │   ├── 📁 hotfixes/                  # Hotfix reports
│   │   ├── 📁 investigations/            # 🆕 Research & Analysis
│   │   │   ├── AI-OPTIMIZATION-RESEARCH.md
│   │   │   ├── CPU-OPTIMIZED-PIPELINE-RESEARCH.md
│   │   │   ├── STT-HALLUCINATION-SHERPA-ONNX.md
│   │   │   ├── VIETNAMESE-OFFLINE-STREAMING-OPTIMIZATION.md
│   │   │   └── ...
│   │   ├── 📁 tdd/                       # 🆕 Test Design Documents
│   │   │   ├── TDD-JBCALLING-COMPLETE.md
│   │   │   ├── TDD-UNIFIED-REPORT.md
│   │   │   └── ...
│   │   ├── SYSTEM-STATUS-*.md            # Status reports
│   │   ├── DEPLOYMENT-SUMMARY-*.md       # Deployment summaries
│   │   └── ...
│   │
│   ├── 📁 commit-messages/               # Git commit messages
│   └── 📁 pipeline/                      # Pipeline docs
│
├── 📁 infrastructure/                    # Infrastructure configs
│   ├── 📁 swarm/
│   │   └── stack-hybrid.yml              # Main production stack
│   └── 📁 traefik/                       # Traefik configs
│
├── 📁 services/                          # Service source code
│   ├── gateway/                          # MediaSoup SFU Gateway
│   ├── frontend/                         # React Frontend
│   ├── transcription/                    # STT Service
│   ├── translation/                      # Translation Service
│   ├── tts/                              # TTS Service
│   └── ...
│
├── 📁 demos/                             # Demo applications
│   └── 📁 html/                          # HTML demo files
│
├── 📁 scripts/                           # Automation scripts
│   ├── setup-firewall-rules.sh           # 🆕 Firewall setup
│   ├── deploy-*.sh                       # Deployment scripts
│   └── ...
│
├── 📁 shared/                            # Shared utilities
└── 📁 tests/                             # Test files
```

---

## 🚀 Quick Start Guide

### Nếu bạn mới join project:
```
1. Đọc README.md (5 phút)
2. Đọc ROADMAP-UPDATED-OCT2025.md (10 phút)
3. Đọc docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md (30 phút)
4. Đọc docs/01-ARCHITECTURE.md (15 phút)
```

### Nếu bạn tiếp tục session cũ:
```
1. Đọc docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md
   → Phần "Next Steps"
```

### Nếu bạn cần implement feature mới:
```
1. Check ROADMAP-UPDATED-OCT2025.md (current phase)
2. Check docs/wrap-ups/ (latest session)
3. Check docs/ (technical specs cho feature)
```

### Nếu bạn cần debug issue:
```
1. Check docs/10-TROUBLESHOOTING.md
2. Check docs/reports/investigations/ (similar issues)
3. Check docs/wrap-ups/ (recent fixes)
```

---

## 📋 Documentation Categories

### 🆕 Latest Updates (Đọc trước tiên)
- **[docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md](./docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md)** 🔥
  - Phase 5 COMPLETE
  - 8 critical Gateway API fixes
  - Full bidirectional video working
  - Consume existing producers implemented

- **[docs/reports/IPV6-DEPLOYMENT-SUCCESS-NOV17.md](./docs/reports/IPV6-DEPLOYMENT-SUCCESS-NOV17.md)**
  - IPv6 dual-stack deployed
  - Gateway 1.0.6-ipv6

- **[docs/wrap-ups/WRAP-UP-NOV11-FINAL.md](./docs/wrap-ups/WRAP-UP-NOV11-FINAL.md)**
  - Traefik routing fix
  - Service distribution solution

---

### 📖 Core Technical Docs
| File | Description | Status |
|------|-------------|--------|
| [docs/01-ARCHITECTURE.md](./docs/01-ARCHITECTURE.md) | System architecture | ✅ Up to date |
| [docs/02-SETUP-GUIDE.md](./docs/02-SETUP-GUIDE.md) | GCP & Swarm setup | ✅ Up to date |
| [docs/03-DOCKER-SWARM.md](./docs/03-DOCKER-SWARM.md) | Swarm management | ✅ Up to date |
| [docs/04-SERVICES.md](./docs/04-SERVICES.md) | Service configs | ✅ Up to date |
| [docs/05-AI-MODELS.md](./docs/05-AI-MODELS.md) | STT/Translation/TTS | ✅ Up to date |
| [docs/06-WEBRTC.md](./docs/06-WEBRTC.md) | WebRTC & MediaSoup | ⚠️ Cần update với SFU |
| [docs/07-API-REFERENCES.md](./docs/07-API-REFERENCES.md) | API endpoints | ✅ Up to date |
| [docs/08-DEPLOYMENT.md](./docs/08-DEPLOYMENT.md) | Deployment guide | ✅ Up to date |
| [docs/09-MONITORING.md](./docs/09-MONITORING.md) | Monitoring setup | ✅ Up to date |
| [docs/10-TROUBLESHOOTING.md](./docs/10-TROUBLESHOOTING.md) | Common issues | ✅ Up to date |
| [docs/11-IPV6-SETUP-GUIDE.md](./docs/11-IPV6-SETUP-GUIDE.md) | IPv6 setup | ✅ Complete |
| [docs/FIREWALL-CONFIGURATION.md](./docs/FIREWALL-CONFIGURATION.md) | GCP Firewall Rules | ✅ Complete 🆕 |
| [docs/SYSTEM-ARCHITECTURE-DESIGN-SAD.md](./docs/SYSTEM-ARCHITECTURE-DESIGN-SAD.md) | SAD với Mermaid diagrams | ✅ Complete |

---

### 📊 Phase Reports

#### Phase 5 (MediaSoup SFU - Nov 2025) - ✅ COMPLETE
- [docs/reports/phase4-5/](./docs/reports/phase4-5/)
  - PHASE4-5-DEPLOYMENT-SUCCESS.md
  - GATEWAY-IMPLEMENTATION-SUMMARY.md
  - FRONTEND-PRODUCTION-COMPLETE.md
  - STACK-HYBRID-ROUTING-FIX-NOV11.md
  - And more...

#### Phase 3 (AI Services - Oct 2025) - ✅ COMPLETE
- [docs/reports/phase3/](./docs/reports/phase3/)
  - PHASE3-DEPLOYMENT-SUCCESS.md
  - PHASE3-BENCHMARK-RESULTS.md
  - PHASE3-MODEL-RESEARCH-SUMMARY.md

#### Phase 2 (SSL/HTTPS - Oct 2025) - ✅ COMPLETE
- [docs/reports/phase2/](./docs/reports/phase2/)
  - PHASE2-COMPLETION-REPORT.md
  - SSL-DEPLOYMENT-SUMMARY.md

#### Phase 1 (Infrastructure - Oct 2025) - ✅ COMPLETE
- [docs/reports/phase1/](./docs/reports/phase1/)
  - PHASE1-DEPLOYMENT-SUMMARY.md
  - PHASE1-COMPLETED.md

---

### 🔧 Hotfixes & Investigations

#### Hotfixes
- [docs/reports/hotfixes/](./docs/reports/hotfixes/)
  - HOTFIX-COMPLETED-OCT6-2025.md
  - STT-FIX-SUMMARY.md
  - TTS-FINAL-FIX-OCT6-2025.md

#### Technical Investigations
- [docs/reports/investigations/](./docs/reports/investigations/)
  - TRAEFIK-GATEWAY-INVESTIGATION-OCT15.md (Routing deep dive)
  - ANALYSIS-WHY-PHOWHISPER-FAILS.md
  - GOOGLE-AI-STUDIO-PRO-STT-ANALYSIS.md

---

## 🎯 Task-Based Navigation

### "Tôi muốn implement Translation Pipeline" (Phase 6)
```bash
# Step 1: Hiểu current state
docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md
  → Section "Phase 6: Translation Pipeline Integration"

# Step 2: Technical specs
docs/05-AI-MODELS.md (STT/Translation/TTS configs)
docs/07-API-REFERENCES.md (API endpoints)

# Step 3: Architecture
docs/01-ARCHITECTURE.md (System flow)
```

### "Tôi muốn test WebRTC E2E"
```bash
# Step 1: Latest implementation
docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md
  → Section "Testing & Validation"

# Step 2: Technical details
docs/06-WEBRTC.md
services/frontend/src/contexts/WebRTCContext.jsx

# Step 3: Troubleshooting
docs/10-TROUBLESHOOTING.md
```

### "Tôi cần deploy changes"
```bash
# Step 1: Deployment guide
docs/08-DEPLOYMENT.md

# Step 2: Swarm commands
docs/03-DOCKER-SWARM.md

# Step 3: Stack config
infrastructure/swarm/stack-hybrid.yml
```

### "Tôi cần setup firewall cho hệ thống mới"
```bash
# Step 1: Đọc hướng dẫn chi tiết
docs/FIREWALL-CONFIGURATION.md

# Step 2: Chạy script tự động
./scripts/setup-firewall-rules.sh

# Step 3: Verify
gcloud compute firewall-rules list --filter="network:translation-network"
```

### "Tôi cần fix bug"
```bash
# Step 1: Troubleshooting guide
docs/10-TROUBLESHOOTING.md

# Step 2: Similar issues
docs/reports/investigations/
docs/reports/hotfixes/

# Step 3: Recent fixes
docs/wrap-ups/ (check latest sessions)
```

---

## 📌 Key Locations

### Production Config
```
infrastructure/swarm/stack-hybrid.yml    # Main production stack
```

### Service Source Code
```
services/gateway/                        # MediaSoup SFU Gateway (1.0.7)
services/frontend/                       # React Frontend (1.0.43)
services/transcription/                  # STT Service (PhoWhisper)
services/translation/                    # Translation (NLLB-200)
services/voice-cloning/                  # TTS Service (XTTS v2)
```

### Demo Files
```
demos/html/demo-pipeline.html           # Pipeline demo
demos/html/demo-stt.html                # STT demo
demos/html/test-stt-punctuation.html    # STT punctuation test
```

---

## 🔍 Search Tips

### Tìm theo Phase
```bash
ls docs/reports/phase*/
```

### Tìm theo Date
```bash
ls docs/wrap-ups/WRAP-UP-*
ls docs/reports/*-OCT*.md
ls docs/reports/*-NOV*.md
```

### Tìm theo Topic
```bash
# WebRTC
grep -r "WebRTC" docs/

# Translation
grep -r "Translation" docs/

# IPv6
grep -r "IPv6" docs/
```

---

## ⚡ Quick Commands

### Check System Status
```bash
# Service status
ssh translation01 "docker service ls"

# Gateway logs
ssh translation01 "docker service logs translation_gateway --tail 50"

# Frontend logs
ssh translation01 "docker service logs translation_frontend --tail 50"

# Check Gateway health
curl -I https://webrtc.jbcalling.site/health

# Check Frontend
curl -I https://jbcalling.site
```

### Common Operations
```bash
# Update service
ssh translation01 "docker service update translation_frontend --image jackboun11/jbcalling-frontend:NEW_VERSION --force"

# Scale service
ssh translation01 "docker service scale translation_frontend=5"

# View service details
ssh translation01 "docker service inspect translation_gateway --pretty"
```

---

## 📊 Current Status (Dec 2, 2025)

### System State
- **Phase**: 5 (MediaSoup SFU) - ✅ **100% COMPLETE**
- **Services**: 13/13 running ✅
- **Frontend**: v1.0.43 (Full SFU with consume existing producers)
- **Gateway**: v2.0.2-asr-hub
- **TTS**: `jackboun11/jbcalling-tts-piper:latest` (Docker Hub)
- **Status**: Full bidirectional video working 🎉

### Infrastructure Updates (Dec 2, 2025)
- ✅ Firewall rule `allow-swarm-full` đã thêm (bao gồm ESP protocol)
- ✅ TTS services đã chuyển từ local image sang Docker Hub
- ✅ Tài liệu Firewall Configuration đã tạo

### Next Phase
- **Phase 6**: Translation Pipeline Integration
- **ETA**: TBD
- **Details**: See docs/wrap-ups/WRAP-UP-NOV17-MEDIASOUP-SFU-COMPLETE.md

---

## 🆘 Need Help?

### For Quick Questions
1. Check README.md
2. Check ROADMAP-UPDATED-OCT2025.md
3. Check latest wrap-up in docs/wrap-ups/

### For Technical Issues
1. Check docs/10-TROUBLESHOOTING.md
2. Check docs/reports/investigations/
3. Check docs/wrap-ups/ (recent fixes)

### For Implementation
1. Check docs/ (technical specs)
2. Check docs/reports/phase*/ (similar implementations)
3. Check services/ (source code)

---

**Index Created**: November 17, 2025  
**Last Updated**: December 2, 2025  
**Maintained By**: Development Team  

---

## ✅ Benefits của Cấu Trúc Mới

1. ✅ **Cleaner Root Directory** - Chỉ còn 3 files quan trọng nhất
2. ✅ **Organized Reports** - Theo phase, category, date
3. ✅ **Easy Navigation** - Thư mục rõ ràng, dễ tìm
4. ✅ **Scalable** - Dễ thêm reports mới
5. ✅ **Maintainable** - Structure consistent

**END OF INDEX**
