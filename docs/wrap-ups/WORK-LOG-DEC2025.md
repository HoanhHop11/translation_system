# 📋 NHẬT KÝ LÀM VIỆC - THÁNG 12/2025

## Tổng quan Hệ thống
**Dự án:** Hệ thống Videocall Dịch Thuật Real-time Đa Ngôn Ngữ (JBCalling)
**Công nghệ:** Docker Swarm, MediaSoup SFU, FastAPI, React, Piper TTS
**Infrastructure:** 3 GCP instances (translation01/02/03)

---

## 📅 NGÀY 7 THÁNG 12, 2025

### Phiên làm việc 1: Sáng (05:00 - 06:00 UTC)

#### 🔧 Fix VAD Crosstalk Issue
**Vấn đề:** Caption bị gán nhầm người nói trong cuộc gọi 2 người - khi A nói thì caption hiện cho B và ngược lại.

**Nguyên nhân gốc:** Shared `SileroVADProcessor` instance cho TẤT CẢ participants trong Gateway AudioProcessor.ts

**Giải pháp:** Per-participant VAD - mỗi participant có VAD processor riêng

**Files đã sửa:**
- `services/gateway/src/types/index.ts` - Thêm `vadProcessor` field vào ParticipantAudioState
- `services/gateway/src/mediasoup/AudioProcessor.ts` - Tạo VAD instance riêng cho mỗi participant

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-gateway | 2.0.4-per-participant-vad | 2025-12-07T05:05:12 |
| jbcalling-frontend | 2.0.7-vad-fix | 2025-12-07T05:05:18 |

---

### Phiên làm việc 2: Sáng (05:30 - 06:30 UTC)

#### 🔧 Fix Opus Decode Errors + Video/Audio Lag
**Vấn đề:** Khi nói, video bị lag và console báo nhiều lỗi "Invalid packet" từ Opus decoder

**Nguyên nhân:** Gateway đang cố decode các packet không phải audio:
- RTCP packets
- DTX (Discontinuous Transmission) / Comfort Noise packets
- RTP padding packets

**Giải pháp:**
1. Filter RTCP packets (byte đầu 200-204)
2. Skip DTX/comfort noise packets (payload ≤ 3 bytes)
3. Handle RTP padding
4. Rate-limited error logging
5. VAD model pre-warming

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-gateway | 2.0.5-opus-fix | 2025-12-07T05:27:51 |

---

### Phiên làm việc 3: Sáng (10:30 - 11:30 UTC)

#### 🔧 VAD Parameter Tuning cho English Speech
**Vấn đề:** Sau fix per-participant VAD, tiếng Anh không được nhận diện - VAD liên tục báo "No speech detected"

**Nguyên nhân:** VAD parameters quá strict cho English speech patterns

**Giải pháp - Tuning SileroVAD.ts:**
| Parameter | Cũ | Mới |
|-----------|-----|-----|
| POSITIVE_THRESHOLD | 0.5 | 0.4 |
| NEGATIVE_THRESHOLD | 0.35 | 0.25 |
| REDEMPTION_FRAMES | 8 | 12 |
| MIN_SPEECH_FRAMES | 3 | 2 |
| PRE_SPEECH_PAD_FRAMES | 2 | 3 |

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-gateway | 2.0.6-vad-tuned | 2025-12-07T10:41:29 |

---

### Phiên làm việc 4: Trưa (10:57 - 12:30 UTC)

#### 🔧 TTS Mute Logic Fix
**Vấn đề:** Khi bật Live Translation (TTS), không nghe được gì cả - cả tiếng gốc lẫn TTS

**Nguyên nhân:** Logic mute sai - mute remote audio NGAY khi có caption, không phải khi TTS thực sự phát

**Giải pháp:**
- Bật TTS → Mute TẤT CẢ remote audio ngay lập tức
- Tắt TTS → Unmute TẤT CẢ remote audio
- Bỏ logic mute per-caption

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-frontend | 2.0.8-tts-mute-fix | 2025-12-07T10:57:38 |
| jbcalling-frontend | 2.0.9-simple-mute | 2025-12-07T11:32:43 |

---

### Phiên làm việc 5: Trưa (11:00 - 12:30 UTC)

#### 🚀 Setup Piper TTS với Vietnamese & English voices
**Vấn đề:** TTS đang dùng gTTS (Google) - cần chuyển sang Piper cho offline, low-latency

**Thực hiện:**
1. Download Piper models:
   - `vi_VN-vais1000-medium.onnx` (61MB) - Vietnamese
   - `en_US-lessac-medium.onnx` (61MB) - English
2. Build Piper TTS service với models embedded
3. Add CORS middleware để Frontend gọi được
4. Deploy lên Docker Swarm

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-tts-piper | 2.0.0 | 2025-12-07T11:07:43 |
| jbcalling-tts-piper | 2.0.1-cors | 2025-12-07T12:20:09 |

---

### Phiên làm việc 6: Chiều (12:28 - 13:30 UTC)

#### 🔧 TTS Language Output Fix
**Vấn đề:** User (myLanguage=vi, targetLanguage=en), remote nói tiếng Anh → TTS phát tiếng Anh thay vì tiếng Việt

**Nguyên nhân:** TTS đang dùng `targetLanguage` để synthesize, nhưng đúng ra phải dùng `myLanguage` (ngôn ngữ của user)

**Giải pháp:**
- Translate: `sourceLanguage` → `myLanguage`
- TTS: Synthesize bằng `myLanguage`

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-frontend | 2.0.11-tts-lang-fix | 2025-12-07T12:28:59 |

---

### Phiên làm việc 7: Chiều (12:45 - 13:30 UTC)

#### 🔧 LocalVAD Sensitivity + Auto-TTS Logic
**Vấn đề 1:** Barge-In (LocalVAD) quá nhạy - trigger bởi tiếng xe chạy ngang, ngắt TTS sai

**Giải pháp - Tuning LocalVADService.js:**
| Parameter | Cũ | Mới |
|-----------|-----|-----|
| volumeThreshold | 0.02 | 0.06 |
| minSpeechDuration | 100ms | 150ms |
| silenceDebounce | 300ms | 400ms |

**Vấn đề 2:** TTS không tự động bật/tắt theo language pair

**Giải pháp - Auto-TTS Logic:**
- Cùng ngôn ngữ (vi-vi, en-en) → TTS tự động TẮT
- Khác ngôn ngữ (vi-en) → TTS tự động BẬT
- Manual override: User toggle thủ công sẽ disable auto logic
- Reset khi rời room

**Docker Images:**
| Image | Tag | Thời gian (UTC) |
|-------|-----|-----------------|
| jbcalling-frontend | 2.0.12-auto-tts | 2025-12-07T12:45:59 |
| jbcalling-frontend | 2.0.13-mute-fix | 2025-12-07T12:54:57 |
| jbcalling-frontend | 2.0.14-debug | 2025-12-07T13:05:22 |
| jbcalling-frontend | 2.0.15-auto-mute | 2025-12-07T13:16:33 |
| jbcalling-frontend | 2.0.16-sync-mute | 2025-12-07T13:27:43 |

#### 🔧 Remote Audio Mute Sync Issue
**Vấn đề:** Auto-TTS toggle đúng nhưng không mute remote audio - chỉ manual toggle mới mute

**Nguyên nhân:** Race condition - Auto-TTS chạy trước khi remote stream được consume xong, nên mute stream cũ/rỗng

**Giải pháp - Declarative Mute Pattern:**
```javascript
// useEffect đảm bảo trạng thái mute LUÔN đúng theo ttsEnabled
useEffect(() => {
  const desiredTrackEnabled = !ttsEnabled;
  // ttsEnabled=true => track.enabled=false (muted)
  // ttsEnabled=false => track.enabled=true (unmuted)
  
  for (const [pid, stream] of remoteStreams.entries()) {
    for (const track of stream.getAudioTracks()) {
      if (track.enabled !== desiredTrackEnabled) {
        track.enabled = desiredTrackEnabled;
      }
    }
  }
}, [remoteStreams, ttsEnabled]);
```

---

## 📅 NGÀY 6 THÁNG 12, 2025

### Docker Images Released

| Service | Tag | Mô tả |
|---------|-----|-------|
| jbcalling-frontend | 2.0.10-fix-producer-pause | Fix producer pause issue |
| jbcalling-frontend | 2.0.9-debug-audio | Debug audio issues |
| jbcalling-frontend | 2.0.8-server-translations | Server-side translations |
| jbcalling-frontend | 1.0.9-logo | Logo update |
| jbcalling-gateway | 2.0.8-fix-audio-quality | Audio quality improvements |
| jbcalling-gateway | 2.0.7-fix-duplicate | Fix duplicate captions |
| jbcalling-gateway | 2.0.6-lang-response | Language in response |

---

## 📅 NGÀY 5 THÁNG 12, 2025

### Docker Images Released

| Service | Tag | Mô tả |
|---------|-----|-------|
| jbcalling-frontend | 2.0.7-language-fix | Language settings fix |
| jbcalling-frontend | 2.0.6-barge-in | Barge-In feature |
| jbcalling-gateway | 2.0.4-api-fix | API response fix |
| jbcalling-gateway | 2.0.3-vad-tuned | VAD parameter tuning |

---

## 📅 NGÀY 2 THÁNG 12, 2025

### Git Commit
```
7b3b8f6 2025-12-02 13:30 feat: Migration chuẩn bị - cập nhật tất cả services và config mới nhất
```

### Nội dung:
- Cập nhật `.github/copilot-instructions.md` với IP addresses mới
- Tạo `docs/MIGRATION-PLAN-DEC2025.md` cho kế hoạch migration
- Cleanup các file documentation cũ/trùng lặp
- Cập nhật `DOCUMENTATION-INDEX.md`

### Docker Images Released
| Service | Tag | Mô tả |
|---------|-----|-------|
| jbcalling-tts-piper | latest | TTS Piper base image |

---

## 📅 NGÀY 24 THÁNG 11, 2025

### Git Commits
```
61e98ea 2025-11-24 13:35 docs(tts): Add TTS Piper model download links and preparation scripts
8b09662 2025-11-24 13:33 feat(gateway+frontend+tts): Gateway ASR Hub + TTS Piper/OpenVoice preparation
453f6bd 2025-11-24 13:32 feat(gateway+frontend): Gateway ASR Hub implementation with Opus decode + Caption broadcast
ebbd997 2025-11-24 11:52 evolution of live transltion
```

### Achievements:
- ✅ Gateway ASR Hub - Centralized STT tại Gateway
- ✅ Opus packet decode từ MediaSoup Producer
- ✅ Caption broadcast qua Socket.io
- ✅ Frontend gateway-caption integration
- ✅ TTS Piper preparation (scripts, docs)

### Docker Images Released
| Service | Tag | Mô tả |
|---------|-----|-------|
| jbcalling-gateway | 2.0.2-asr-hub | Gateway ASR Hub |
| jbcalling-frontend | 2.0.28-gateway-caption | Gateway caption support |

---

## 🏗️ KIẾN TRÚC HIỆN TẠI

### Production Stack (Dec 7, 2025)

```
┌─────────────────────────────────────────────────────────────────┐
│                        FRONTEND                                  │
│  jackboun11/jbcalling-frontend:2.0.16-sync-mute                 │
│  - React + WebRTC                                                │
│  - LocalVAD (Barge-In) tuned                                     │
│  - Auto-TTS based on language pair                               │
│  - Declarative remote audio mute sync                            │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        GATEWAY                                   │
│  jackboun11/jbcalling-gateway:2.0.6-vad-tuned                   │
│  - MediaSoup SFU                                                 │
│  - Per-participant SileroVAD                                     │
│  - Opus decode + STT forwarding                                  │
│  - Caption broadcast                                             │
└─────────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
┌──────────────────────────┐  ┌──────────────────────────┐
│          STT             │  │          TTS             │
│  (Sherpa-ONNX)           │  │  jackboun11/jbcalling-   │
│  - Vietnamese            │  │  tts-piper:2.0.1-cors    │
│  - English               │  │  - Piper VI + EN         │
│  - Streaming ASR         │  │  - ONNX models           │
└──────────────────────────┘  └──────────────────────────┘
```

---

## 📊 METRICS

### Docker Images Count (Dec 7, 2025)
| Service | Total Tags |
|---------|------------|
| jbcalling-frontend | 30+ |
| jbcalling-gateway | 30+ |
| jbcalling-tts-piper | 3 |

### Issues Fixed Today (Dec 7)
- ✅ VAD crosstalk (per-participant VAD)
- ✅ Opus decode errors (packet filtering)
- ✅ English speech detection (VAD tuning)
- ✅ TTS mute logic (declarative pattern)
- ✅ Piper TTS setup (VI + EN)
- ✅ TTS language output
- ✅ LocalVAD sensitivity
- ✅ Auto-TTS language pair
- ✅ Remote audio mute sync

---

## 📝 NOTES

### Best Practices Learned
1. **Per-participant state**: Không share processors/buffers giữa participants
2. **Declarative React patterns**: useEffect sync state thay vì imperative mute/unmute
3. **VAD tuning**: English speech cần thresholds thấp hơn Vietnamese
4. **Race conditions**: Remote streams có thể chưa ready khi toggle TTS

### Known Issues (To Fix)
- [ ] TTS latency có thể cao khi network chậm
- [ ] Barge-In có thể vẫn trigger với tiếng ồn lớn (threshold 0.06)

---

*Cập nhật lần cuối: 2025-12-07 13:30 UTC*
