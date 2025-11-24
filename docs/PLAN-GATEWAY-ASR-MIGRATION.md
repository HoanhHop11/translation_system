# Kế hoạch triển khai Gateway ASR Hub + Caption Hub (MVP rút gọn)

**Mục tiêu tổng**: Loại bỏ STT per-viewer trên client, chuyển sang một nguồn STT duy nhất tại Gateway, broadcast caption cho toàn bộ phòng; MT/TTS chạy per-viewer trên client dựa trên preference. Đảm bảo có fallback và quan sát được pipeline end-to-end.

**Phạm vi**: Gateway (MediaSoup + Caption Hub), STT service, Frontend (Socket.IO caption, TranslationContext), hạ tầng Swarm (cấu hình services).  
**Ngoài phạm vi**: Nâng cấp model mới, tối ưu chi phí cloud, voice cloning async.

## Tình trạng hiện tại (baseline)
- Gateway 2.0.1 có `AudioProcessor` + VAD (AVR-VAD), đã emit `transcription` nhưng audio tap RTP còn TODO (chưa decode Opus→PCM, event bị comment).
- STT service `jbcalling-stt:2.0.4-utterance-endpoint`: `/api/v1/transcribe-stream` (EN streaming), `/api/v1/transcribe-vi-utterance` (VI utterance), Prometheus metrics.
- Frontend 2.0.27: TranslationContext vẫn đẩy audio remote lên STT trực tiếp (double STT), CaptionsOverlay/TranslationControls đã có UI.
- Swarm stack-hybrid: Gateway/Frontend/STT/Translation/TTS đang chạy; STT/Translation expose qua Traefik cho client-side.

## Kiến trúc đích (MVP)
1. **Audio tap tại Gateway**: MediaSoup audio producer → RtpObserver/PlainTransport → decode Opus → PCM16 16k → VAD → STT (Sherpa) → caption event.
2. **Caption Hub** (trong Gateway/SignalingServer): Chuẩn hóa event `gateway-caption` với seq, isFinal, text, timestamps; phát cho toàn bộ room.
3. **Client**: Nhận `gateway-caption` làm nguồn duy nhất cho remote; MT/TTS per-viewer (TranslationContext) chỉ chạy từ caption, không gửi audio remote lên STT. STT local chỉ dùng nếu cần cho mic của chính user.
4. **Fallback**: Khi STT lỗi → emit `caption-status: asr_unavailable`, client hiển thị thông báo, call không crash.

## Roadmap triển khai chi tiết

### P0 – Chuẩn bị & safety
- [ ] Giữ nguyên backup stack hiện tại (đã có).
- [ ] Thêm feature flag `USE_GATEWAY_ASR` (frontend) và `ENABLE_AUDIO_PROCESSING` (gateway đã có) để rollback nhanh.
- [ ] Kiểm tra tài nguyên node `translation01/02`: Gateway decode Opus + VAD cần thêm CPU (~0.5–1 core).

### P1 – Audio tap & STT tại Gateway (đường dữ liệu vào)
- [x] **Chọn cơ chế tap**: PlainTransport + UDP socket local + Opus decode (opusscript) để nhận RTP audio từ producer và chuyển thành PCM16 16k.  
  - Hook tại `startStreaming(roomId, participantId, producer)`: tạo PlainTransport, connect observer, nhận RTP payload.
- [ ] **Giải mã Opus → PCM16 16k**:  
  - Thêm decoder (libopus/opus-decoder npm native hoặc gói Node wasm); convert mono 48k → 16k.  
  - Bỏ giả định “PCM sẵn” trong `processAudioBuffers`.
- [ ] **VAD & utterance**: Giữ `SileroVADProcessor`; chunk 100 ms, gom utterance, tối ưu silence (500–800 ms) để giảm spam/hallucination.
- [ ] **Gọi STT service**:  
  - `/api/v1/transcribe-vi-utterance` cho VI, `/api/v1/transcribe-stream` cho EN.  
  - Gửi `roomId, participantId` để log, timeout 5s, retry nhẹ (<=1).  
  - Log latency: rtp→pcm, pcm→vad, vad→stt (per utterance).
- [ ] **Tiêu chí hoàn thành P1**: Một speaker nói → Gateway nhận text (final) ổn định, latency trung bình <1.3s, không crash khi STT down (chỉ log lỗi).

### P2 – Caption Hub & broadcast (đường dữ liệu ra)
- [ ] Tạo module CaptionHub (hoặc lớp nhỏ trong `SignalingServer`) gán seq per `(roomId, participantId)`, `timestamp`, `isFinal`, `text`, `language`.
- [x] Event Socket.IO chuẩn: `gateway-caption` `{roomId, speakerId, seq, text, language, isFinal, timestamp}`.
- [x] Fallback: emit `caption-status` khi STT lỗi/timeout; stop gửi text cho đến khi recover.
- [ ] Tiêu chí: Client (console) thấy `gateway-caption` mỗi lần nói, khi tắt STT server client nhận `caption-status` và không crash.

### P3 – Frontend chuyển nguồn caption (remove double STT)
- [ ] `WebRTCContext`/`RoomMeet`: lắng nghe `gateway-caption` → map thành `transcriptions`/`visibleCaptions` (giữ tối đa 3–10 bubble).  
- [ ] `TranslationContext`:  
  - Thêm `ingestGatewayCaption(caption)` để MT/TTS per-viewer.  
  - Khi `USE_GATEWAY_ASR=true`: stop `audioExtractionService` cho remote; không POST `/transcribe-stream` cho remote.  
  - STT local (mic) giữ tùy chọn; gắn `sourceType` để UI phân biệt.  
- [ ] UI/State machine: `translationEnabled` bật mới cho phép `target|bilingual`; `translationEnabled=false` → chỉ source caption, TTS tắt.  
- [ ] Feature flag rollback: `USE_GATEWAY_ASR=false` → giữ flow cũ tạm thời.
- [ ] Tiêu chí: 2 người nói → tất cả viewer thấy cùng caption; network tab không còn POST STT từ remote; translation/TTS vẫn hoạt động dựa trên caption.

### P4 – QA nhanh & rollout
- [ ] Test case:  
  - 2 user, caption on: nhận `gateway-caption` đồng bộ.  
  - STT down: nhận `caption-status`, UI không crash.  
  - Bật translation: MT/TTS chạy, STT chỉ 1 lần tại Gateway.  
  - Late join: vẫn thấy caption seq tăng đều.  
- [ ] Monitoring: thêm metric Gateway (count stream, utterance, latency p50/p95, STT error) vào Prometheus/Grafana hiện có.
- [ ] Cập nhật `stack-hybrid.yml` nếu cần tăng CPU/replicas cho STT; đảm bảo ports và env không đổi.

### P5 – Dọn dẹp & tài liệu
- [ ] Xóa/disable code STT remote cũ (sau khi ổn định); giữ doc rollback.  
- [ ] Vẽ sequence diagram mới: Client → Gateway → STT → Caption Hub → Client → MT/TTS.  
- [ ] Ghi chép vào wrap-up/report (KLTN) cùng latency đo được.

## Rủi ro & giảm thiểu
- **Decode Opus trên Gateway**: tốn CPU; đo profiling, nếu cao tăng replicas Gateway hoặc tách worker.  
- **VAD sai**: tune silence 500–800 ms; nếu vẫn drop từ, giảm threshold hoặc tạm bỏ VAD cho debug.  
- **MT/TTS chậm**: client-side có cache translation; giới hạn câu quá dài (10–12s) để giữ latency.  
- **Fallback cần thiết**: luôn giữ flag `USE_GATEWAY_ASR` và `translationEnabled` để rollback.

## Checklist chấp nhận MVP
- [ ] Caption của một speaker hiển thị giống nhau trên mọi viewer, không phụ thuộc STT client.  
- [ ] Dừng STT service → client thấy thông báo, call không crash.  
- [ ] Translation/TTS hoạt động dựa trên caption, không có thêm request STT từ browser cho remote.  
- [ ] Latency end-to-end (speech→caption) < ~1.3s cho câu ngắn; log được các mốc thời gian.  
- [ ] Tài liệu/diagram cập nhật và kèm hướng dẫn rollback.
