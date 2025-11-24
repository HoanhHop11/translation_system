# Implementation Plan – Thay thế TTS bằng Piper + OpenVoice v2 (VI + EN, giữ port 8004)

## 1. Goal

Thay thế toàn bộ stack TTS hiện tại (gTTS/XTTS) bằng một stack **TTS + voice cloning chạy CPU** hỗ trợ **cả tiếng Việt và tiếng Anh**, dựa trên:

- **Baseline TTS (VI)**: Piper với model `vi_VN-vais1000-medium` (22.05 kHz, 1 giọng, chất lượng medium).
- **Baseline TTS (EN)**: Piper với model `en_US-lessac-medium` (22.05 kHz, 1 giọng nữ Mỹ, medium – cân bằng chất lượng và tài nguyên).
- **Lớp voice cloning**: OpenVoice v2 Tone Color Converter (TCC), chạy qua OpenVINO trên CPU, cho phép clone tone color/timbre từ một đoạn audio tham chiếu ngắn.

Yêu cầu:

- Giữ trải nghiệm **voice cloning đa ngôn ngữ** như trong pipeline `vi-en-realtime-pipeline.md`:
  - `text(vi) → Piper(vi) → TCC → Opus`
  - `text(en) → Piper(en) → TCC → Opus`
- Tối ưu cho **CPU**, giảm phụ thuộc GPU.
- **Giữ nguyên port TTS hiện tại (8004)** để các service khác không cần đổi config/URL.
- Cho phép chọn ngôn ngữ qua param `lang` (`"vi"` | `"en"`), và chế độ:
  - `mode = "generic"`: chỉ TTS giọng hệ thống (Piper).
  - `mode = "clone"`: TTS + voice cloning (Piper + OpenVoice).

## 2. Models & nguồn tải

### 2.1 Piper – Vietnamese: `vi_VN-vais1000-medium`

- Language: `vi_VN`, 1 speaker, quality `medium`, sample rate 22,050 Hz.
- Hugging Face repo: `https://huggingface.co/rhasspy/piper-voices`
- Model: `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx?download=true`
- Config: `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json?download=true`

### 2.2 Piper – English: `en_US-lessac-medium`

- Language: `en_US`, 1 female voice, quality `medium`, sample rate 22,050 Hz.
- Hugging Face repo: `https://huggingface.co/rhasspy/piper-voices`
- Model: `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx?download=true`
- Config: `https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json?download=true`
- Tuỳ chọn sau: `en_US-libritts-high` nếu cần nhiều voice/chất lượng cao hơn.

### 2.3 OpenVoice v2 – Tone Color Converter (TCC)

- Instant voice cloning đa ngôn ngữ, cần audio tham chiếu ngắn.
- Base TTS = Piper (VI/EN), TCC = OpenVoice.
- GitHub: `https://github.com/myshell-ai/OpenVoice`
- Checkpoint: `https://huggingface.co/myshell-ai/OpenVoiceV2`
- Research: `https://research.myshell.ai/open-voice`
- Paper: `https://arxiv.org/abs/2312.01479`
- OpenVINO tutorial (convert/chạy CPU):
  - `https://docs.openvino.ai/2024/notebooks/openvoice-with-output.html`
  - `https://github.com/openvinotoolkit/openvino_notebooks/blob/main/notebooks/284-openvoice/284-openvoice.ipynb`

## 3. Thiết kế kiến trúc TTS đa ngôn ngữ

### 3.1 Luồng logic tổng quát

```
Input:
  text (đã chuẩn hoá)
  lang ∈ { "vi", "en" }
  mode ∈ { "generic", "clone" }
  reference_id hoặc reference_audio (khi clone)

Pipeline:
  text, lang
    └─> Chọn Piper model (vi/en) → waveform 22.05 kHz
          ├─ mode=generic → trả về waveform
          └─ mode=clone   → OpenVoice TCC với reference → cloned waveform
                └─> encode Opus 20ms → Gateway/WebRTC
```

### 3.2 Backward-compat API
- `/synthesize` chấp nhận payload cũ: `{ text, language }` → default `lang=language||en`, `mode=generic`.
- Payload mới khuyến nghị: `{ text, lang, mode, reference_id?, engine? }`.
- Trả về giữ field cũ `audio_base64` (WAV/PCM) để frontend hiện tại không đổi code; nếu trả Opus, thêm field mới nhưng vẫn giữ `audio_base64`.

## 4. Thay đổi services

### 4.1 Service mới: `services/tts-piper` (đa ngôn ngữ, thay TTS cũ, giữ port 8004)

```
services/
  tts-piper/
    Dockerfile
    main.py
    models/
      piper/
        vi_VN-vais1000-medium.onnx
        vi_VN-vais1000-medium.onnx.json
        en_US-lessac-medium.onnx
        en_US-lessac-medium.onnx.json
      openvoice/
        base/...
        tcc/...
```

Trách nhiệm:

- Expose HTTP API port 8004.
- Cache Piper VI/EN và OpenVoice v2 (encoder + TCC, OpenVINO IR).
- Cho phép `mode=generic` (Piper) và `mode=clone` (Piper + TCC).

### 4.2 Dockerfile (phác thảo)

- Base: `python:3.11-slim`
- Lib web: `fastapi`, `uvicorn[standard]`
- Runtime: `openvino-dev` (ưu tiên dùng chung cho Piper ONNX + OpenVoice IR) hoặc `onnxruntime` cho Piper + `openvino-dev` cho OpenVoice.
- Audio utils: `numpy`, `scipy`, `soundfile`, `librosa` (nếu cần).
- Bước build tải model:

```
mkdir -p /models/piper
# Vietnamese
wget -O /models/piper/vi_VN-vais1000-medium.onnx "<link vi onnx>"
wget -O /models/piper/vi_VN-vais1000-medium.onnx.json "<link vi json>"
# English
wget -O /models/piper/en_US-lessac-medium.onnx "<link en onnx>"
wget -O /models/piper/en_US-lessac-medium.onnx.json "<link en json>"
# OpenVoice checkpoint convert → /models/openvoice/{base,tcc} (theo notebook OpenVINO 284-openvoice: tải ckpt, convert sang IR, copy vào image)
```

- Expose & CMD:

```
EXPOSE 8004
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8004"]
```

### 4.3 main.py (API đa ngôn ngữ)

- `GET /health` → `status`, `engine`, `languages`, `modes`.
- `POST /synthesize` (JSON):
  - Body: `text`, `lang` ("vi"/"en"), `mode` ("generic"/"clone"), `reference_id` (optional), `options` (speed/volume).
  - Flow: chọn Piper theo lang → synth base → nếu clone: lấy embedding reference → TCC → trả waveform (WAV/PCM).
- `POST /synthesize-clone` (multipart):
  - Fields: `text`, `lang`, `reference_audio` (WAV).
  - Flow one-shot: enrol + clone + trả audio.

## 5. Thay đổi hạ tầng Swarm

### 5.1 `infrastructure/swarm/stack-hybrid.yml`

- Gỡ các TTS cũ (tts_translation02, tts_translation03) dùng 8004.
- Thêm service mới, giữ port 8004 (healthcheck + Traefik labels):

```
services:
  tts-piper:
    image: ${DOCKER_REGISTRY}/jbcalling-tts-piper:latest
    deploy:
      replicas: 2
      placement:
        constraints:
          - node.labels.instance == translation02
          - node.labels.instance == translation03
      resources:
        limits:
          cpus: "1.5"
          memory: 2000M
    ports:
      - "8004:8004"
    environment:
      - PIPER_MODEL_VI=/models/piper/vi_VN-vais1000-medium.onnx
      - PIPER_CONFIG_VI=/models/piper/vi_VN-vais1000-medium.onnx.json
      - PIPER_MODEL_EN=/models/piper/en_US-lessac-medium.onnx
      - PIPER_CONFIG_EN=/models/piper/en_US-lessac-medium.onnx.json
      - OPENVOICE_BASE_DIR=/models/openvoice/base
      - OPENVOICE_TCC_DIR=/models/openvoice/tcc
    volumes:
      - tts_models:/models
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:8004/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
    labels:
      - "traefik.enable=true"
      - "traefik.docker.network=translation_frontend"
      - "traefik.http.routers.tts.rule=Host(`tts.jbcalling.site`)"
      - "traefik.http.routers.tts.entrypoints=websecure"
      - "traefik.http.routers.tts.tls.certresolver=letsencrypt"
      - "traefik.http.services.tts.loadbalancer.server.port=8004"
```

Port 8004 giữ nguyên → Gateway/API không cần đổi host/port, chỉ thêm params `lang`, `mode`.

## 6. Tích hợp Gateway / Translation Pipeline

- Thêm field: `tts_lang`, `tts_mode`, `tts_reference_id`.
- Mapping:
  - Nói tiếng Việt, đọc tiếng Việt: `tts_lang="vi"`, `mode` theo lựa chọn clone/generic.
  - Nói tiếng Việt, đọc tiếng Anh (sau MT): `tts_lang="en"`.
  - Clone: `tts_mode="clone"` + `tts_reference_id`.
- Frontend: thêm toggle “Giọng hệ thống” vs “Giọng giống tôi (clone)” và chọn ngôn ngữ TTS (auto theo hướng dịch, cho phép override).

## 7. Verification plan

### 7.1 Local smoke test (VI/EN)

```
docker build -t jbcalling-tts-piper:test services/tts-piper
docker run -d -p 8004:8004 --name tts-test jbcalling-tts-piper:test
curl http://localhost:8004/health
```

- Generic VI:

```
curl -X POST http://localhost:8004/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Xin chào, đây là kiểm thử tiếng Việt.","lang":"vi","mode":"generic"}' \
  --output test_vi_generic.wav
```

- Generic EN:

```
curl -X POST http://localhost:8004/synthesize \
  -H "Content-Type: application/json" \
  -d '{"text":"Hello, this is an English TTS test.","lang":"en","mode":"generic"}' \
  --output test_en_generic.wav
```

- Clone VI:

```
curl -X POST http://localhost:8004/synthesize-clone \
  -F "text=Xin chào, đây là kiểm thử clone tiếng Việt." \
  -F "lang=vi" \
  -F "reference_audio=@ref_vi.wav" \
  --output test_vi_clone.wav
```

- Clone EN:

```
curl -X POST http://localhost:8004/synthesize-clone \
  -F "text=Hello, this is an English cloned voice test." \
  -F "lang=en" \
  -F "reference_audio=@ref_en.wav" \
  --output test_en_clone.wav
```

### 7.2 Swarm + E2E với Gateway

- Deploy: `docker stack deploy -c infrastructure/swarm/stack-hybrid.yml translation`
- Check: `docker service ls | grep tts`, `docker service logs -f translation_tts-piper`
- E2E call VI↔EN:
  - `tts_lang` theo ngôn ngữ sau MT.
  - Test `mode=generic`, sau đó `mode=clone` để kiểm tra voice cloning đa ngôn ngữ.
- Theo dõi CPU/RAM trên translation02/03; nếu cao, tăng limit RAM lên 2.5–3 GB hoặc giảm replicas để đo lại.
