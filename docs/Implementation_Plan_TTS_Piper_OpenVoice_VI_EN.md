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

## 7. Pre-deployment: Model Download & Preparation

⚠️ **QUAN TRỌNG**: Phải tải và chuẩn bị model trước khi build image hoặc deploy service!

### 7.0 Quick Start Checklist

- [ ] **Step 1**: Tải Piper models (VI + EN) - ~130MB total
- [ ] **Step 2**: (Optional) Tải/convert OpenVoice v2 cho voice cloning - ~500MB (có thể bỏ qua cho MVP)
- [ ] **Step 3**: Package models vào tarball hoặc copy vào Docker build context
- [ ] **Step 4**: Build Docker image `jbcalling-tts-piper`
- [ ] **Step 5**: Push image lên Docker Registry
- [ ] **Step 6**: Deploy stack hoặc update service

### 7.1 Download Piper Models (Direct Links)

**Vietnamese Model:**
```bash
mkdir -p /tmp/tts-models/piper
cd /tmp/tts-models/piper

# Download Vietnamese ONNX model (vais1000-medium, ~63MB)
wget -O vi_VN-vais1000-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx"

# Download config JSON
wget -O vi_VN-vais1000-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json"
```

**English Model:**
```bash
# Download English ONNX model (lessac-medium, ~63MB)
wget -O en_US-lessac-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"

# Download config JSON
wget -O en_US-lessac-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"
```

**Verify downloads:**
```bash
ls -lh /tmp/tts-models/piper/
# Expected output:
# vi_VN-vais1000-medium.onnx      (~63MB)
# vi_VN-vais1000-medium.onnx.json (~1KB)
# en_US-lessac-medium.onnx        (~63MB)
# en_US-lessac-medium.onnx.json   (~1KB)
```

### 7.2 OpenVoice v2 Model Preparation

**Option 1: Download Pre-converted OpenVINO IR (Recommended)**
```bash
mkdir -p /tmp/tts-models/openvoice/{base,tcc}

# Clone OpenVoice repo for conversion scripts
git clone https://github.com/myshell-ai/OpenVoice /tmp/OpenVoice
cd /tmp/OpenVoice

# Download checkpoints from Hugging Face
git lfs install
git clone https://huggingface.co/myshell-ai/OpenVoiceV2 /tmp/OpenVoiceV2

# Convert to OpenVINO IR (requires openvino-dev)
# Follow: https://github.com/openvinotoolkit/openvino_notebooks/blob/main/notebooks/284-openvoice/284-openvoice.ipynb
python convert_to_openvino.py \
  --checkpoint /tmp/OpenVoiceV2 \
  --output /tmp/tts-models/openvoice/
```

**Option 2: Skip Voice Cloning for MVP**
```bash
# Để triển khai nhanh, có thể bỏ qua OpenVoice v2 trong phase đầu
# Chỉ dùng Piper (mode=generic), sau đó thêm voice cloning sau
# Comment out OpenVoice env vars trong stack-hybrid.yml
```

### 7.3 Package Models for Docker Build

**Create tarball:**
```bash
cd /tmp/tts-models
tar -czf tts-models.tar.gz piper/ openvoice/

# Copy to services/tts-piper/
cp tts-models.tar.gz /path/to/services/tts-piper/
```

**Update Dockerfile to extract:**
```dockerfile
# In services/tts-piper/Dockerfile
COPY tts-models.tar.gz /tmp/
RUN tar -xzf /tmp/tts-models.tar.gz -C /models/ && \
    rm /tmp/tts-models.tar.gz
```

## 8. Verification plan

### 8.1 Local smoke test (VI/EN)

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

### 8.2 Swarm + E2E với Gateway

- Deploy: `docker stack deploy -c infrastructure/swarm/stack-hybrid.yml translation`
- Check: `docker service ls | grep tts`, `docker service logs -f translation_tts-piper`
- E2E call VI↔EN:
  - `tts_lang` theo ngôn ngữ sau MT.
  - Test `mode=generic`, sau đó `mode=clone` để kiểm tra voice cloning đa ngôn ngữ.
- Theo dõi CPU/RAM trên translation02/03; nếu cao, tăng limit RAM lên 2.5–3 GB hoặc giảm replicas để đo lại.

## 9. Deployment Workflow (Step-by-step)

### 9.1 Tải Models trên translation02 (đang SSH)

```bash
# Step 1: Tạo thư mục và tải Piper models
mkdir -p /tmp/tts-models/piper
cd /tmp/tts-models/piper

# Vietnamese model (~63MB)
wget -O vi_VN-vais1000-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx"

wget -O vi_VN-vais1000-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx.json"

# English model (~63MB)
wget -O en_US-lessac-medium.onnx \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx"

wget -O en_US-lessac-medium.onnx.json \
  "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json"

# Step 2: Verify downloads
ls -lh /tmp/tts-models/piper/
# Expected: 4 files, ~130MB total

# Step 3: (Optional MVP) Bỏ qua OpenVoice cho deployment đầu tiên
# Chỉ test với mode=generic, sau đó bổ sung voice cloning
```

### 9.2 Build và Push Image

⚠️ **LƯU Ý**: Cần tạo service `services/tts-piper` với Dockerfile và main.py trước!

```bash
# Step 4: Copy models vào build context (nếu dùng COPY trong Dockerfile)
cd /home/hopboy2003/jbcalling_translation_realtime
mkdir -p services/tts-piper/models/piper
cp /tmp/tts-models/piper/* services/tts-piper/models/piper/

# Step 5: Build image
docker build -t jackboun11/jbcalling-tts-piper:1.0.0-piper-only \
  services/tts-piper

# Step 6: Push to Docker Hub
docker push jackboun11/jbcalling-tts-piper:1.0.0-piper-only

# Tag as latest
docker tag jackboun11/jbcalling-tts-piper:1.0.0-piper-only \
  jackboun11/jbcalling-tts-piper:latest
docker push jackboun11/jbcalling-tts-piper:latest
```

### 9.3 Deploy Stack

```bash
# Step 7: Copy stack file sang Manager Node
gcloud compute scp \
  /home/hopboy2003/jbcalling_translation_realtime/infrastructure/swarm/stack-hybrid.yml \
  hopboy2003@translation01:/tmp/stack-hybrid.yml \
  --zone=asia-southeast1-a

# Step 8: Deploy trên Manager Node
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="docker stack deploy -c /tmp/stack-hybrid.yml translation"

# Step 9: Verify deployment
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="docker service ls | grep tts"

# Expected output:
# translation_tts_translation02  1/1  jackboun11/jbcalling-tts-piper:latest
# translation_tts_translation03  1/1  jackboun11/jbcalling-tts-piper:latest
```

### 9.4 Health Check & Testing

```bash
# Step 10: Check service logs
gcloud compute ssh translation01 --zone=asia-southeast1-a \
  --command="docker service logs translation_tts_translation02 --tail 20"

# Step 11: Test health endpoint
curl -s https://tts.jbcalling.site/health | python3 -m json.tool

# Expected response:
# {
#   "status": "healthy",
#   "engine": "piper",
#   "languages": ["vi", "en"],
#   "modes": ["generic"]
# }

# Step 12: Test TTS endpoint (Vietnamese)
curl -X POST https://tts.jbcalling.site/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Xin chào, đây là kiểm thử tiếng Việt.",
    "lang": "vi",
    "mode": "generic"
  }' \
  --output /tmp/test_vi.wav

# Step 13: Test TTS endpoint (English)
curl -X POST https://tts.jbcalling.site/synthesize \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Hello, this is an English TTS test.",
    "lang": "en",
    "mode": "generic"
  }' \
  --output /tmp/test_en.wav

# Step 14: Play audio để verify
# aplay /tmp/test_vi.wav (Linux)
# afplay /tmp/test_vi.wav (Mac)
```

## 10. Troubleshooting Common Issues

### 10.1 Model không tải được

**Lỗi**: `FileNotFoundError: /models/piper/vi_VN-vais1000-medium.onnx`

**Giải pháp**:
- Kiểm tra models đã copy vào build context chưa
- Verify Dockerfile có bước `COPY models/ /models/` hoặc `RUN wget ...`
- Check volume mount trong stack: `tts_models:/models`

### 10.2 Service không start

**Lỗi**: `Health check failed` hoặc service restart liên tục

**Giải pháp**:
```bash
# Check logs chi tiết
docker service logs translation_tts_translation02 --tail 50

# Common issues:
# 1. Model path sai → Check env vars PIPER_MODEL_VI/EN
# 2. Port 8004 conflict → Check stack ports mapping
# 3. Out of memory → Tăng memory limit lên 2.5G
```

### 10.3 TTS không trả về audio

**Lỗi**: Response 500 hoặc empty audio

**Giải pháp**:
- Check payload format: `{"text": "...", "lang": "vi", "mode": "generic"}`
- Verify backward-compat: payload cũ `{"text": "...", "language": "vi"}` vẫn hoạt động
- Check logs: `UnicodeDecodeError` → text encoding issue
- Model inference error → verify ONNX runtime installed

### 10.4 OpenVoice không hoạt động (khi bật voice cloning)

**Lỗi**: `mode=clone` trả về 500 hoặc giọng không khớp reference

**Giải pháp**:
- Verify OpenVoice IR models đã convert và mount đúng
- Check reference_audio format: WAV, 16kHz, mono
- Reference audio quá ngắn (<3s) hoặc quá dài (>30s) → clip về 5-10s
- CPU quá chậm → tăng timeout hoặc dùng mode=generic trước

## 11. Roadmap & Future Enhancements

### Phase 1 (Current - MVP): Piper Generic TTS
- ✅ Piper VI + EN models
- ✅ API backward-compatible
- ✅ Port 8004 giữ nguyên
- ✅ mode=generic working

### Phase 2: OpenVoice Voice Cloning
- [ ] Convert OpenVoice v2 sang OpenVINO IR
- [ ] Integrate TCC pipeline
- [ ] mode=clone working
- [ ] Reference audio storage/cache

### Phase 3: Quality & Performance
- [ ] Model quantization (INT8)
- [ ] Streaming TTS (chunked output)
- [ ] Prosody/emotion control
- [ ] Multi-voice support (libritts-high)

### Phase 4: Advanced Features
- [ ] Real-time voice conversion (Piper + TCC trong <200ms)
- [ ] Voice library management
- [ ] A/B testing Piper vs XTTS quality
- [ ] Auto language detection
