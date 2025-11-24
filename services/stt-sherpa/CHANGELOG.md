# Changelog

All notable changes to the STT Sherpa-ONNX service will be documented in this file.

## [1.0.1] - 2025-11-19

### ✨ Added
- Chunk-based transcription using OfflineRecognizer
- Dual-language support (Vietnamese + English)
- WebSocket API for real-time communication
- FastAPI health check endpoint
- Comprehensive documentation suite
- Python test client
- Interactive web client example
- Docker Compose configuration
- Build, push, and deployment scripts

### 🔧 Changed
- Switched from OnlineRecognizer to OfflineRecognizer
- Changed approach from streaming to chunk-based processing
- Updated audio processing to handle base64-encoded chunks

### 🐛 Fixed
- Segfault issue with Vietnamese non-streaming model
- WebSocket connection handling and error recovery
- Model loading errors with proper debug logging

### 📚 Documentation
- README.md - Main user guide
- IMPLEMENTATION_SUMMARY.md - Technical details
- COMPLETION_REPORT.md - Project completion report
- DEPLOYMENT_CHECKLIST.md - Production deployment guide
- QUICKSTART.md - Quick start guide
- MIGRATION.md - Migration from Whisper
- SECURITY_ENHANCEMENTS.md - Security guide
- STRUCTURE.md - File structure overview
- CHANGELOG.md - This file

### 🧪 Testing
- Model loading test ✅
- Health check test ✅
- WebSocket transcription test ✅
- Language switching test ✅

### 📦 Docker
- Image: jackboun11/jbcalling-stt-sherpa:v1.0.1
- Base: python:3.11-slim
- Size: ~900MB (includes both models)
- Models pre-bundled in image

### 🎯 Performance
- Vietnamese: WER 7.97%, 40x realtime
- English: WER 5-7%, 10x realtime
- Latency: <300ms per 3-second chunk
- Memory: ~500MB

---

## [1.0.0] - 2025-11-19 (Initial Development)

### 🚀 Initial Release
- First attempt with OnlineRecognizer (failed with Vietnamese model)
- Discovered Vietnamese model is offline-only
- Pivoted to chunk-based approach
- Successfully implemented dual-language support

### Known Issues (Resolved in 1.0.1)
- ~~Vietnamese model segfault with OnlineRecognizer~~ → Fixed by using OfflineRecognizer
- ~~Streaming model compatibility~~ → Fixed with chunk-based approach

---

## Future Versions (Planned)

### [1.1.0] - TBD
- [ ] Add Prometheus metrics endpoint
- [ ] Implement rate limiting
- [ ] Add authentication support
- [ ] Batch processing API

### [1.2.0] - TBD
- [ ] GPU acceleration support
- [ ] Model hot-swapping
- [ ] Custom vocabulary support
- [ ] Confidence scores in output

### [2.0.0] - TBD
- [ ] Multi-speaker support
- [ ] Speaker diarization
- [ ] Punctuation restoration
- [ ] Real-time streaming with VAD

---

**Versioning Scheme**: Semantic Versioning (MAJOR.MINOR.PATCH)
- MAJOR: Breaking API changes
- MINOR: New features, backward compatible
- PATCH: Bug fixes, backward compatible

**Release Notes**: See COMPLETION_REPORT.md for detailed v1.0.1 information
