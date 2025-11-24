# SOFTWARE REQUIREMENTS SPECIFICATION (SRS)
# JBCALLING TRANSLATION REALTIME SYSTEM

**Phiên bản:** 2.0
**Ngày ban hành:** 19/11/2025
**Tiêu chuẩn áp dụng:** IEEE 830-1998 / ISO/IEC/IEEE 29148:2018

---

## 1. GIỚI THIỆU (INTRODUCTION)

### 1.1. Mục đích (Purpose)
Tài liệu này mô tả chi tiết các yêu cầu chức năng và phi chức năng cho hệ thống **JBCalling**. Mục đích của tài liệu là cung cấp một cơ sở thống nhất cho đội ngũ phát triển (Development Team), đội ngũ vận hành (DevOps), và các bên liên quan (Stakeholders) để xây dựng, kiểm thử và nghiệm thu hệ thống gọi video tích hợp dịch thuật thời gian thực.

### 1.2. Phạm vi (Scope)
Hệ thống JBCalling là một nền tảng giao tiếp trực tuyến dựa trên Web (Web-based Application) với các khả năng chính:
-   Gọi video đa điểm (Multi-party Video Conferencing) sử dụng kiến trúc SFU.
-   Chuyển đổi giọng nói thành văn bản (Speech-to-Text - STT) theo luồng (Streaming).
-   Dịch thuật văn bản (Machine Translation - MT) chuyên biệt cho cặp ngôn ngữ Tiếng Việt ↔ Tiếng Anh.
-   Tổng hợp giọng nói (Text-to-Speech - TTS) để lồng tiếng tự động (Audio Dubbing).
-   Hệ thống hoạt động trên hạ tầng Docker Swarm, tối ưu hóa cho CPU (không yêu cầu GPU).

### 1.3. Định nghĩa và Thuật ngữ (Definitions and Acronyms)
| Thuật ngữ | Định nghĩa |
| :--- | :--- |
| **SFU** | Selective Forwarding Unit (Mô hình định tuyến media trung gian). |
| **ASR** | Automatic Speech Recognition (Nhận dạng giọng nói tự động). |
| **NMT** | Neural Machine Translation (Dịch máy nơ-ron). |
| **VAD** | Voice Activity Detection (Phát hiện giọng nói). |
| **WER** | Word Error Rate (Tỷ lệ lỗi từ - Đánh giá độ chính xác STT). |
| **RTF** | Real Time Factor (Hệ số thời gian thực - Đánh giá tốc độ xử lý). |
| **Sherpa-ONNX** | Framework ASR streaming tối ưu hóa. |
| **ONNX** | Open Neural Network Exchange (Định dạng mô hình AI tối ưu). |

---

## 2. MÔ TẢ TỔNG QUAN (OVERALL DESCRIPTION)

### 2.1. Bối cảnh sản phẩm (Product Perspective)
JBCalling là một hệ thống phân tán bao gồm các microservices:
-   **Frontend:** ReactJS App.
-   **Gateway:** Node.js Server quản lý Signaling và MediaSoup.
-   **AI Pipeline:** Các container Python chạy model AI (Sherpa, VinAI, Piper).
-   **Infrastructure:** Traefik Load Balancer, Coturn Server.

### 2.2. Chức năng sản phẩm (Product Functions)
1.  **Quản lý phiên gọi:** Tạo phòng, tham gia phòng, quản lý trạng thái người dùng (Mute/Unmute/Video).
2.  **Xử lý Media:** Truyền tải Video/Audio realtime, tối ưu băng thông (Simulcast).
3.  **Dịch thuật trực tiếp:**
    *   Nghe audio từ người nói → Chuyển thành text (Source Language).
    *   Dịch text sang ngôn ngữ đích (Target Language).
    *   Đọc text đích thành audio (Target Audio) và phát cho người nghe.
4.  **Phụ đề trực tiếp:** Hiển thị phụ đề song ngữ trên giao diện người dùng.

### 2.3. Đặc điểm người dùng (User Characteristics)
-   **Người dùng phổ thông:** Không yêu cầu kiến thức kỹ thuật, cần giao diện đơn giản, độ trễ thấp để giao tiếp tự nhiên.
-   **Quản trị viên hệ thống:** Cần giám sát tài nguyên (CPU/RAM) và trạng thái các services.

### 2.4. Giả định và Ràng buộc (Assumptions and Dependencies)
-   **Phần cứng:** Hệ thống chạy trên các node CPU thông thường (ví dụ: Google Cloud c2d-standard), không có GPU.
-   **Mạng:** Người dùng cần kết nối Internet ổn định (băng thông tối thiểu 2Mbps cho Video HD).
-   **Trình duyệt:** Hỗ trợ WebRTC (Chrome 80+, Firefox 80+, Safari 15+).

---

## 3. YÊU CẦU CỤ THỂ (SPECIFIC REQUIREMENTS)

### 3.1. Yêu cầu Chức năng (Functional Requirements)

#### 3.1.1. Phân hệ Video Call (Core)
*   **REQ-VC-001:** Hệ thống phải cho phép người dùng tạo phòng họp mới và nhận được ID phòng duy nhất.
*   **REQ-VC-002:** Hệ thống phải cho phép người dùng tham gia phòng thông qua ID phòng.
*   **REQ-VC-003:** Hệ thống phải sử dụng kiến trúc SFU (MediaSoup) để chuyển tiếp các luồng Video và Audio giữa các người tham gia (Mesh/N-N communication).
*   **REQ-VC-004:** Hệ thống phải hỗ trợ người dùng Bật/Tắt Camera và Microphone trong khi gọi.

#### 3.1.2. Phân hệ Speech-to-Text (ASR Pipeline)
*   **REQ-STT-001:** Hệ thống phải thu nhận luồng Audio input từ người dùng qua WebSocket.
*   **REQ-STT-002:** Hệ thống phải sử dụng **Sherpa-ONNX** engine để nhận dạng giọng nói.
    *   Model Tiếng Việt: `hynt/Zipformer-30M-RNNT-6000h` (hoặc tương đương).
    *   Model Tiếng Anh: `sherpa-onnx-streaming-zipformer-en`.
*   **REQ-STT-003:** Hệ thống phải trả về kết quả nhận dạng dạng luồng (Streaming partial results) để hiển thị ngay lập tức, và kết quả cuối cùng (Final results) khi ngắt câu.
*   **REQ-STT-004:** Hệ thống phải tích hợp VAD (Voice Activity Detection) để loại bỏ khoảng lặng và tiếng ồn nền.
*   **REQ-STT-005:** Hệ thống phải hỗ trợ "Hotwords" để tăng độ chính xác cho các tên riêng hoặc thuật ngữ chuyên ngành được định nghĩa trước.

#### 3.1.3. Phân hệ Machine Translation (MT Pipeline)
*   **REQ-MT-001:** Hệ thống phải tiếp nhận văn bản từ module STT và thực hiện dịch thuật ngay lập tức.
*   **REQ-MT-002:** Hệ thống phải sử dụng model **VinAI Translate v2** đã được lượng tử hóa (Quantization INT8) chạy trên **CTranslate2**.
*   **REQ-MT-003:** Hệ thống phải hỗ trợ dịch hai chiều: Tiếng Việt ↔ Tiếng Anh.
*   **REQ-MT-004:** Hệ thống phải duy trì ngữ cảnh (Context) của câu để đảm bảo chất lượng dịch.

#### 3.1.4. Phân hệ Text-to-Speech (TTS Pipeline)
*   **REQ-TTS-001:** Hệ thống phải chuyển đổi văn bản dịch thành file âm thanh (WAV/PCM).
*   **REQ-TTS-002:** Hệ thống phải sử dụng engine **Piper TTS** với định dạng model ONNX.
*   **REQ-TTS-003:** Hệ thống phải sử dụng giọng đọc `vi_VN-vais1000-medium` cho đầu ra Tiếng Việt.
*   **REQ-TTS-004:** Hệ thống phải hỗ trợ streaming audio output để giảm thời gian chờ (TTFB - Time To First Byte).

#### 3.1.5. Giao diện Người dùng (User Interface)
*   **REQ-UI-001:** Giao diện phải được thiết kế theo phong cách Glassmorphism.
*   **REQ-UI-002:** Hệ thống phải hiển thị Live Captions ở phía dưới màn hình, phân biệt màu sắc theo người nói.
*   **REQ-UI-003:** Hệ thống phải cung cấp menu cài đặt để người dùng chọn cặp ngôn ngữ (Nói/Nghe).

---

### 3.2. Yêu cầu Phi chức năng (Non-functional Requirements)

#### 3.2.1. Hiệu năng (Performance) - *Critical*
Do hệ thống hoạt động Realtime trên CPU, các chỉ số sau là bắt buộc:
*   **REQ-PERF-001 (E2E Latency):** Tổng độ trễ từ khi Người A dứt lời đến khi Người B nghe thấy tiếng dịch phải **< 2000ms** (2 giây).
*   **REQ-PERF-002 (ASR Speed):** Tốc độ xử lý ASR (Real Time Factor - RTF) phải đạt **< 0.1** (Xử lý 10s âm thanh trong dưới 1s).
*   **REQ-PERF-003 (TTS Speed):** Tốc độ tổng hợp TTS phải đạt **> 10x Realtime** trên CPU.
*   **REQ-PERF-004 (Concurrency):** Hệ thống phải hỗ trợ tối thiểu 50 concurrent streams trên mỗi node worker tiêu chuẩn (4 vCPU, 8GB RAM).

#### 3.2.2. Tài nguyên (Resource Constraints)
*   **REQ-RES-001 (Image Size):** Tổng dung lượng Docker Images cho toàn bộ pipeline AI (STT + MT + TTS) phải **< 2.5 GB**.
*   **REQ-RES-002 (RAM Usage):**
    *   STT Service: < 500MB RAM/replica.
    *   Translation Service: < 1GB RAM/replica.
    *   TTS Service: < 300MB RAM/replica.

#### 3.2.3. Độ tin cậy và Sẵn sàng (Reliability & Availability)
*   **REQ-REL-001:** Các service phải có Healthcheck endpoint. Docker Swarm sẽ tự động khởi động lại container nếu Healthcheck thất bại quá 3 lần.
*   **REQ-REL-002:** Hệ thống phải có cơ chế tự động kết nối lại (Auto-reconnect) WebSocket khi mạng người dùng chập chờn.

#### 3.2.4. Bảo mật (Security)
*   **REQ-SEC-001:** Tất cả kết nối Signaling và API phải được mã hóa qua TLS (HTTPS/WSS).
*   **REQ-SEC-002:** Luồng Media (RTP) phải được mã hóa sử dụng DTLS-SRTP (Chuẩn WebRTC).
*   **REQ-SEC-003:** Không lưu trữ nội dung cuộc gọi (Audio/Video/Text) trên server sau khi phiên kết thúc (Privacy by design).

---

## 4. YÊU CẦU GIAO DIỆN NGOÀI (EXTERNAL INTERFACE REQUIREMENTS)

### 4.1. Giao diện Lập trình Ứng dụng (APIs)

#### 4.1.1. STT WebSocket API
*   **Endpoint:** `wss://<domain>/api/v1/stt/ws`
*   **Protocol:** WebSocket
*   **Data Format:** Binary (Audio Int16) lên, JSON xuống.
*   **Output JSON:**
    ```json
    {
      "type": "partial" | "final",
      "text": "Nội dung nhận dạng",
      "language": "vi" | "en"
    }
    ```

#### 4.1.2. Translation REST API
*   **Endpoint:** `POST /api/v1/translate`
*   **Input:** `application/json`
    ```json
    {
      "text": "Xin chào",
      "source_lang": "vi",
      "target_lang": "en"
    }
    ```
*   **Output:** `application/json`
    ```json
    {
      "translated_text": "Hello",
      "latency_ms": 45
    }
    ```

#### 4.1.3. TTS REST API
*   **Endpoint:** `POST /api/v1/tts/synthesize`
*   **Input:** `application/json`
*   **Output:** Audio Stream (WAV 22050Hz).

---

## 5. PHỤ LỤC (APPENDICES)

### 5.1. Ma trận Truy vết (Traceability Matrix)
*(Phần này sẽ được cập nhật khi có Test Cases)*

### 5.2. Danh sách Mô hình AI (AI Models Inventory)
1.  **ASR Vi:** `hynt/Zipformer-30M-RNNT-6000h` (ONNX).
2.  **ASR En:** `sherpa-onnx-streaming-zipformer-en-2023-06-26` (ONNX).
3.  **MT Vi-En:** `vinai/vinai-translate-vi2en-v2` (CTranslate2 INT8).
4.  **MT En-Vi:** `vinai/vinai-translate-en2vi-v2` (CTranslate2 INT8).
5.  **TTS:** `vi_VN-vais1000-medium` (ONNX).

