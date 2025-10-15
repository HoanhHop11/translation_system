# 07. API References

**Version**: 2.0  
**Status**: 🔄 TODO  
**Last Updated**: 2025-01-04

---

## 📋 TODO

Tài liệu này sẽ bao gồm complete API documentation:

### 1. Authentication
- POST `/api/v1/auth/register`
- POST `/api/v1/auth/login`
- POST `/api/v1/auth/refresh`
- POST `/api/v1/auth/logout`

### 2. Users
- GET `/api/v1/users/me`
- PATCH `/api/v1/users/me`
- POST `/api/v1/users/me/voice-sample` (Premium)

### 3. Rooms
- POST `/api/v1/rooms` - Create room
- GET `/api/v1/rooms/{room_id}` - Get room info
- DELETE `/api/v1/rooms/{room_id}` - Close room
- POST `/api/v1/rooms/{room_id}/join` - Join room
- POST `/api/v1/rooms/{room_id}/leave` - Leave room

### 4. WebRTC
- GET `/api/v1/webrtc/ice-servers` - Get STUN/TURN config
- WS `/ws/signaling/{room_id}` - Signaling WebSocket

### 5. Translation
- POST `/api/v1/translate` - Translate text
- GET `/api/v1/languages` - Supported languages

### 6. TTS
- POST `/api/v1/tts/quick` - Quick TTS (gTTS)
- POST `/api/v1/tts/clone` - Voice clone (XTTS, async)
- GET `/api/v1/tts/status/{job_id}` - Check clone status

### 7. Documents (Pro)
- POST `/api/v1/documents` - Upload context document
- GET `/api/v1/documents/{doc_id}` - Get document
- DELETE `/api/v1/documents/{doc_id}` - Delete document

### 8. Admin
- GET `/api/v1/admin/metrics` - System metrics
- GET `/api/v1/admin/rooms` - All rooms status

### OpenAPI Schema
Auto-generated: `http://localhost:8000/docs`

---

**Xem tạm**: 
- `docs/06-WEBRTC.md` phần Signaling Server
- `docs/05-AI-MODELS.md` phần Implementation
