# SYSTEM ARCHITECTURE & TECHNICAL DESIGN (SATD)
# JBCALLING TRANSLATION REALTIME - CPU OPTIMIZED

**Version:** 2.0 (CPU-Optimized Pipeline)
**Date:** 19/11/2025
**Status:** Active Development

---

## 1. SYSTEM OVERVIEW

### 1.1. Design Philosophy
Hệ thống JBCalling v2.0 được thiết kế lại hoàn toàn để tối ưu hóa cho môi trường CPU (Commodity Hardware), loại bỏ sự phụ thuộc vào GPU đắt đỏ mà vẫn đảm bảo độ trễ thời gian thực (Real-time latency).

**Nguyên lý cốt lõi:**
- **Quantization:** Sử dụng mô hình INT8 thay vì FP32/FP16 để giảm kích thước và tăng tốc độ tính toán.
- **Streaming First:** Xử lý dữ liệu dạng luồng (chunk-based) thay vì đợi toàn bộ câu.
- **Specialized Models:** Sử dụng các model chuyên biệt (VinAI cho Vi-En, Piper cho TTS) thay vì các model đa năng nhưng nặng nề (như NLLB-200, XTTS).

### 1.2. High-Level Architecture

```mermaid
graph TD
    User[User Client] <-->|WebSocket/WebRTC| Gateway[Gateway Service]
    
    subgraph "Media Layer"
        Gateway <-->|RTP| MediaSoup[MediaSoup SFU]
    end
    
    subgraph "AI Pipeline (CPU Optimized)"
        Gateway -->|WS Audio Stream| STT[STT Service\n(Sherpa-ONNX)]
        STT -->|Text Stream| Translation[Translation Service\n(VinAI + CTranslate2)]
        Translation -->|Translated Text| TTS[TTS Service\n(Piper ONNX)]
        TTS -->|Audio Stream| Gateway
    end
    
    subgraph "Infrastructure"
        Gateway -->|Auth/Room| Redis[Redis Cache]
        Gateway -->|Persist| Postgres[PostgreSQL]
    end
```

---

## 2. COMPONENT DESIGN

### 2.1. STT Service (Speech-to-Text)
Chuyển đổi từ PhoWhisper (nặng, chậm) sang **Sherpa-ONNX** (nhẹ, streaming).

- **Technology:** Sherpa-ONNX (Next-gen Kaldi with ONNX Runtime).
- **Models:**
  - Vietnamese: `hynt/Zipformer-30M-RNNT-6000h` (30M params, VLSP 2025 Winner).
  - English: `sherpa-onnx-streaming-zipformer-en-2023-06-26`.
- **Protocol:** WebSocket.
- **Key Features:**
  - **Streaming ASR:** Trả về kết quả từng phần (partial) ngay khi người dùng đang nói.
  - **VAD (Voice Activity Detection):** Silero VAD tích hợp sẵn (<1ms latency).
  - **Endpointing:** Tự động ngắt câu dựa trên khoảng lặng (silence).
  - **Hotwords:** Hỗ trợ tăng trọng số cho tên riêng (Contextual Biasing).

**WebSocket Message Flow:**
1. **Client -> Server:** Binary Audio Chunk (16kHz, 16-bit PCM, Mono).
2. **Server -> Client:** JSON Result.
   ```json
   {
     "text": "Xin chào mọi người",
     "segment": 1,
     "is_final": false
   }
   ```

### 2.2. Translation Service (Machine Translation)
Chuyển đổi từ NLLB-200 (OOM, crash) sang **VinAI Translate v2 + CTranslate2**.

- **Technology:** CTranslate2 (Inference Engine for Transformer models).
- **Models:** `vinai/vinai-translate-vi2en-v2` & `vinai/vinai-translate-en2vi-v2`.
- **Optimization:** INT8 Quantization.
- **Performance:**
  - Latency: < 100ms/sentence (so với > 1s hoặc crash của NLLB).
  - RAM Usage: ~800MB (so với 5GB+ của NLLB).
- **API Endpoint:** REST API (FastAPI).
  - `POST /translate`: Input text, output text.

### 2.3. TTS Service (Text-to-Speech)
Chuyển đổi từ XTTS (chậm, cần GPU) sang **Piper TTS**.

- **Technology:** Piper (Neural TTS using VITS architecture, ONNX export).
- **Model:** `vi_VN-vais1000-medium` (Giọng miền Bắc tự nhiên).
- **Performance:**
  - Real-time Factor (RTF): > 10x (Tạo 10s âm thanh trong < 1s).
  - RAM Usage: ~150MB.
- **API Endpoint:** REST API / Streaming Response.
  - `POST /synthesize`: Input text, output Audio Stream (WAV).

---

## 3. DEPLOYMENT VIEW (DOCKER SWARM)

### 3.1. Service Distribution
Hệ thống được triển khai trên 3 node vật lý (Worker Nodes):

| Node Name | Role | Services Running | Specs (Min) |
| :--- | :--- | :--- | :--- |
| **manager01** | DB & Core | PostgreSQL, Redis, Traefik | 2 vCPU, 4GB RAM |
| **worker01** | Media & Gateway | MediaSoup, Gateway Service, Frontend | 4 vCPU, 8GB RAM |
| **worker02** | AI Pipeline | STT Service, Translation Service, TTS Service | 4 vCPU, 8GB RAM |

### 3.2. Docker Stack Configuration
File cấu hình: `infrastructure/swarm/stack-hybrid.yml`

```yaml
services:
  stt-sherpa:
    image: jbcalling-stt-sherpa:latest
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 500M
    ports:
      - "8002:8002"

  translation-vinai:
    image: jbcalling-translation-vinai:latest
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 1G
    ports:
      - "8004:8004"

  tts-piper:
    image: jbcalling-tts-piper:latest
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 300M
    ports:
      - "8003:8003"
```

---

## 4. PERFORMANCE BENCHMARKS

### 4.1. Resource Usage (Comparison)

| Component | Old Pipeline (v1.0) | New Pipeline (v2.0) | Improvement |
| :--- | :--- | :--- | :--- |
| **STT RAM** | 1.7 GB (PhoWhisper) | **~400 MB** (Sherpa) | **76% Less** |
| **Translation RAM** | > 5 GB (NLLB - Crash) | **~800 MB** (VinAI) | **Stable** |
| **TTS RAM** | 1.5 GB (XTTS) | **~150 MB** (Piper) | **90% Less** |
| **Docker Image Size** | 23.5 GB Total | **~2.1 GB Total** | **91% Smaller** |

### 4.2. Latency Targets

| Metric | Target | Description |
| :--- | :--- | :--- |
| **E2E Latency** | < 2000ms | Từ lúc nói xong đến lúc nghe tiếng dịch. |
| **STT Latency** | < 300ms | Độ trễ hiển thị text khi đang nói. |
| **Translation Time** | < 100ms | Thời gian dịch 1 câu trung bình. |
| **TTS Synthesis** | < 200ms | Thời gian tạo audio cho câu ngắn. |

---

## 5. TECHNICAL STACK SUMMARY

### 5.1. Frontend
- **Framework:** ReactJS 18, Next.js 14.
- **State Management:** Zustand.
- **Realtime:** Socket.IO Client, MediaSoup Client.
- **UI Library:** TailwindCSS, Radix UI.

### 5.2. Backend (Gateway)
- **Runtime:** Node.js 20 (Alpine).
- **Web Framework:** Fastify / Express.
- **WebRTC:** MediaSoup v3.
- **Database:** PostgreSQL 16.
- **Cache/Queue:** Redis 7.

### 5.3. AI Services (Python)
- **Runtime:** Python 3.11 (Slim).
- **Serving:** FastAPI, Uvicorn.
- **Inference Engines:**
  - **ONNX Runtime** (STT, TTS).
  - **CTranslate2** (Translation).

---

## 6. SECURITY DESIGN

### 6.1. Transport Security
- **HTTPS/WSS:** Bắt buộc cho mọi kết nối Signaling và API.
- **DTLS-SRTP:** Mã hóa luồng Video/Audio WebRTC (End-to-Hop encryption).

### 6.2. Network Isolation
- Các AI Services (`stt`, `translation`, `tts`) chỉ expose port trong nội bộ Docker Overlay Network (`webrtc-ipv6-network`).
- Chỉ `Gateway` và `Traefik` mới được public ra internet.

### 6.3. Data Privacy
- **Ephemeral Processing:** Audio và Text chỉ được xử lý trong RAM và bị hủy ngay sau khi phiên kết thúc. Không lưu trữ logs nội dung cuộc gọi.

