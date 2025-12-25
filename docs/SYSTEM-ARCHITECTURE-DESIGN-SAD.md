# System Architecture Design (SAD) - JBCalling Translation System

**Date**: December 02, 2025  
**Version**: 1.0  
**Status**: Active  
**Authors**: Hoanh Hop

---

## 1. Executive Summary

Hệ thống JBCalling Translation là một nền tảng videocall với dịch thuật thời gian thực đa ngôn ngữ. Hệ thống được triển khai trên Google Cloud Platform sử dụng Docker Swarm cluster với 3 nodes, không sử dụng GPU.

### Các tính năng chính:
- **WebRTC Videocall**: Sử dụng MediaSoup SFU (TypeScript)
- **Speech-to-Text (STT)**: Sherpa-ONNX với **2 models**:
  - Vietnamese: `sherpa-onnx-zipformer-vi-int8` (Offline mode)
  - English: `sherpa-onnx-streaming-zipformer-en` (Online streaming mode)
- **Translation**: VinAI CTranslate2 INT8 với **2 models**:
  - `vi2en`: Vietnamese → English
  - `en2vi`: English → Vietnamese
- **Text-to-Speech (TTS)**: Piper TTS với **2 voice models**:
  - Vietnamese: `vi_VN-vais1000-medium`
  - English: `en_US-lessac-medium`
- **Real-time Processing**: Socket.IO + Redis pub/sub

---

## 2. System Overview Diagram

```mermaid
flowchart TB
    subgraph Users["👥 Users"]
        direction LR
        UserA["👤 User A<br/>(Vietnamese)"]
        UserB["👤 User B<br/>(English)"]
    end

    subgraph Internet["🌐 Internet"]
        direction TB
        DNS["DNS<br/>jbcalling.site"]
        HTTPS["HTTPS/WSS<br/>Port 443"]
    end

    subgraph GCP["☁️ Google Cloud Platform - asia-southeast1-a"]
        subgraph Swarm["🐳 Docker Swarm Cluster"]
            Manager["🎯 Manager Node<br/>translation01"]
            Worker1["⚙️ Worker Node<br/>translation02"]
            Worker2["⚙️ Worker Node<br/>translation03"]
        end
    end

    Users --> Internet
    Internet --> GCP
    Manager <--> Worker1
    Manager <--> Worker2
    Worker1 <--> Worker2

    classDef users fill:#e1f5fe,stroke:#0288d1,stroke-width:2px
    classDef internet fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef gcp fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef swarm fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class Users users
    class Internet internet
    class GCP gcp
    class Swarm swarm
```

---

## 3. Infrastructure Architecture

### 3.1 Docker Swarm Cluster Topology

```mermaid
flowchart TB
    subgraph Node1["🎯 translation01 - Manager Node"]
        direction TB
        N1_Info["c4d-standard-4<br/>4 vCPUs | 30GB RAM<br/>External: 35.185.191.80<br/>Internal: 10.200.0.5"]
        
        subgraph N1_Services["Services"]
            Traefik["🔀 Traefik v3.6<br/>Reverse Proxy"]
            Gateway["🌐 Gateway<br/>MediaSoup SFU"]
            Frontend["📱 Frontend x3<br/>React App"]
            Redis["💾 Redis<br/>AI Cache"]
            Prometheus["📊 Prometheus<br/>Metrics"]
            Grafana["📈 Grafana<br/>Dashboard"]
            Loki["📝 Loki<br/>Logging"]
        end
    end

    subgraph Node2["⚙️ translation02 - Worker Node"]
        direction TB
        N2_Info["c2d-highcpu-8<br/>8 vCPUs | 16GB RAM<br/>External: 34.142.150.236<br/>Internal: 10.200.0.6"]
        
        subgraph N2_Services["AI Services + TURN"]
            STT["🎤 STT Service<br/>Sherpa-ONNX"]
            Translation["🌍 Translation<br/>VinAI CTranslate2"]
            TTS02["🔊 TTS<br/>Piper"]
            RedisGW["💾 Redis Gateway<br/>Socket.IO Adapter"]
            Coturn["🔄 Coturn<br/>TURN Server"]
        end
    end

    subgraph Node3["⚙️ translation03 - Worker Node"]
        direction TB
        N3_Info["c2d-highcpu-4<br/>4 vCPUs | 8GB RAM<br/>External: 34.143.216.251<br/>Internal: 10.200.0.8"]
        
        subgraph N3_Services["TTS Load Balancing"]
            TTS03["🔊 TTS<br/>Piper"]
        end
    end

    Node1 <-->|"Swarm Overlay<br/>10.200.0.0/24"| Node2
    Node1 <-->|"Swarm Overlay<br/>10.200.0.0/24"| Node3
    Node2 <-->|"Swarm Overlay<br/>10.200.0.0/24"| Node3

    classDef manager fill:#e3f2fd,stroke:#1565c0,stroke-width:3px
    classDef worker fill:#f1f8e9,stroke:#558b2f,stroke-width:2px
    classDef service fill:#fff8e1,stroke:#ff8f00,stroke-width:1px
    classDef ai fill:#fce4ec,stroke:#c2185b,stroke-width:1px
    classDef monitor fill:#f3e5f5,stroke:#7b1fa2,stroke-width:1px

    class Node1 manager
    class Node2,Node3 worker
    class Traefik,Gateway,Frontend,Redis service
    class STT,Translation,TTS02,TTS03 ai
    class Prometheus,Grafana,Loki,RedisGW,Coturn monitor
```

### 3.2 Network Architecture

```mermaid
flowchart LR
    subgraph External["🌐 External Access"]
        Client["Client Browser"]
        Domain1["jbcalling.site"]
        Domain2["api.jbcalling.site"]
        Domain3["webrtc.jbcalling.site"]
    end

    subgraph Traefik["🔀 Traefik Ingress"]
        direction TB
        HTTPS["HTTPS :443<br/>Let's Encrypt"]
        HTTP["HTTP :80<br/>→ Redirect HTTPS"]
    end

    subgraph FrontendNet["📦 Frontend Network"]
        FE_Overlay["translation_frontend<br/>Overlay Network"]
    end

    subgraph BackendNet["🔒 Backend Network"]
        BE_Overlay["translation_backend<br/>Overlay Network"]
    end

    subgraph Services["🎯 Services"]
        FE["Frontend<br/>:80"]
        GW["Gateway<br/>:3000"]
        STT_S["STT<br/>:8002"]
        TRANS_S["Translation<br/>:8005"]
        TTS_S["TTS<br/>:8004"]
        Redis_S["Redis<br/>:6379"]
    end

    Client --> Domain1 & Domain2 & Domain3
    Domain1 --> HTTPS
    Domain2 --> HTTPS
    Domain3 --> HTTPS
    HTTP --> HTTPS
    
    HTTPS --> FE_Overlay
    FE_Overlay --> FE
    FE_Overlay --> GW
    
    GW --> BE_Overlay
    BE_Overlay --> STT_S
    BE_Overlay --> TRANS_S
    BE_Overlay --> TTS_S
    BE_Overlay --> Redis_S

    classDef external fill:#e3f2fd,stroke:#1565c0
    classDef traefik fill:#fff3e0,stroke:#ef6c00
    classDef frontend fill:#e8f5e9,stroke:#388e3c
    classDef backend fill:#fce4ec,stroke:#c2185b
    classDef service fill:#f5f5f5,stroke:#616161

    class External external
    class Traefik traefik
    class FrontendNet frontend
    class BackendNet backend
    class Services service
```

### 3.3 Netflix-Style Microservices Architecture

Sơ đồ kiến trúc microservices theo phong cách Netflix cho hệ thống **JB Calling – Video Call dịch song ngữ tích hợp vào nền tảng Hommy**.

```mermaid
---
config:
  layout: elk
---
flowchart TB
  %% ===== HOMMY PLATFORM (Nền tảng chính - Cho thuê trọ) =====
  subgraph Hommy_Platform["🏠 HOMMY PLATFORM - Nền tảng cho thuê trọ"]
    direction TB
    subgraph Hommy_Users["Người dùng Hommy"]
      direction LR
      Tenant["🏠 Tenant`<br>`(Người thuê)"]
      Landlord["🏢 Landlord`<br>`(Chủ nhà)"]
      Sales["👔 Sales Staff`<br>`(Nhân viên Hommy)"]
    end
    subgraph Hommy_Services["Dịch vụ Hommy"]
      direction LR
      Hommy_Web["🌐 Hommy Web App`<br>`daphongtro.dev (DevTunnel)"]
      Hommy_Mobile["📱 Hommy Mobile`<br>`(coming soon)"]
      Hommy_API["⚡ Hommy API`<br>`Backend Services"]
    end
  end

  %% ===== HOMMY DEV INFRA (daphongtro + DevTunnels) =====
  subgraph Hommy_Dev["🖥️ HOMMY DEV INFRA - VS Code DevTunnels"]
    direction TB
    subgraph DevTunnels["DevTunnel Forwarders (.asse.devtunnels.ms)"]
      Tunnel5173["🔐 {id}-5173 → Vite dev server`<br>`HTTPS proxy :5173"]
      Tunnel5000["🔐 {id}-5000 → Express API + Socket.IO`<br>`HTTPS + WSS proxy :5000"]
    end
    subgraph DevMachine["Máy dev Windows + VS Code"]
      direction TB
      VSCode["VS Code + DevTunnel CLI`<br>`npm run dev & npm start"]
      subgraph Frontend_Dev["Frontend (client/)"]
        direction TB
        Vite["Vite dev server :5173`<br>`React + TanStack Query"]
        MapLeaflet["react-leaflet + Leaflet`<br>`Bản đồ chi tiết tin đăng"]
        ChatWidget["ChatBot component`<br>`Trang chủ Hommy"]
      end
      subgraph Backend_Dev["Backend (server/)"]
        direction TB
        Express["Express REST API + Socket.IO`<br>`Port 5000"]
        Routes["Routes: /api/chu-du-an, /api/chat`<br>`/api/geocode, /api/chatbot"]
        CronJobs["node-cron jobs`<br>`appointment reminders/report"]
        SepaySync["SepaySyncService`<br>`Poll giao dịch 60s"]
      end
      subgraph DataLayer["Tầng dữ liệu nội bộ"]
        MySQL["MySQL (XAMPP)`<br>`Database thue_tro"]
        Uploads["Static /uploads`<br>`Ảnh phòng & tài liệu"]
      end
    end
    subgraph Hommy_External["Dịch vụ ngoài (Hommy)"]
      direction TB
      Sepay["Sepay Banking API`<br>`https://my.sepay.vn"]
      OSMTiles["OpenStreetMap Tiles`<br>`https://{s}.tile.openstreetmap.org"]
      Nominatim["Nominatim Geocoding API`<br>`openstreetmap.org"]
      Groq["Groq Chat Completion API`<br>`llama-3.3-70b-versatile"]
    end
  end

  %% ===== DNS & CDN LAYER =====
  subgraph DNS_CDN["🌐 DNS & CDN LAYER (JB Calling)"]
    direction TB
    subgraph Hostinger_DNS["Hostinger DNS Management"]
      DNS_JB["📍 jbcalling.site DNS`<br>`A + AAAA Records`<br>`(IPv4/IPv6 Dual Stack)"]
      DNS_Subdomains["📍 Subdomains`<br>`webrtc/stt/translation/tts/grafana.jbcalling.site"]
    end
    subgraph Cache_Layer["⚡ Caching Strategy"]
      Nginx_Cache["Nginx Static Cache`<br>`no-store, no-cache`<br>`(Real-time App)"]
      Redis_TTL["Redis TTL Cache`<br>`Translation: 24h`<br>`Session: 1h"]
    end
  end

  %% ===== GOOGLE CLOUD PLATFORM =====
  subgraph GCP["☁️ GOOGLE CLOUD PLATFORM - asia-southeast1-a"]
    direction TB
    subgraph JB_Calling["📞 JB CALLING - Video Call Dịch Song Ngữ"]
      direction TB
      subgraph Gateway_Layer["🔀 API GATEWAY + MONITORING - translation01 (c2d-highmem-4)"]
        direction TB
        Traefik["🚦 Traefik v3.6`<br>`Reverse Proxy + LB`<br>`Let's Encrypt SSL :80/:443"]
        Gateway["🌐 Gateway Service`<br>`TypeScript + Socket.IO`<br>`MediaSoup SFU :3000 + UDP 40000-40019"]
        Frontend["📱 Frontend x3 (VIP LB)`<br>`React + Nginx :80"]
        subgraph Monitoring_Stack["📊 Monitoring Stack"]
          Prometheus["📈 Prometheus :9090"]
          Grafana["📊 Grafana :3000`<br>`grafana.jbcalling.site"]
          Loki["📝 Loki :3100"]
        end
        Redis["💾 Redis Cache :6379`<br>`AI Result Caching"]
      end
      subgraph Media_Layer["📡 WEBRTC MEDIA LAYER - translation02"]
        direction TB
        MediaSoup["📹 MediaSoup SFU`<br>`2 Workers`<br>`UDP 40000-40019"]
        Coturn["🔄 Coturn TURN`<br>`:3478 / :5349`<br>`UDP 49152-49156"]
      end
      subgraph AI_Pipeline["🤖 AI TRANSLATION PIPELINE - translation02 (c2d-highmem-4)"]
        direction TB
        subgraph STT_Service["🎤 STT Service"]
          STT["Sherpa-ONNX :8002"]
          STT_VI["🇻🇳 VI Offline`<br>`zipformer-vi-int8"]
          STT_EN["🇺🇸 EN Streaming`<br>`zipformer-en"]
        end
        subgraph Trans_Service["🌍 Translation Service"]
          Translation["CTranslate2 INT8 :8005"]
          VI2EN["🇻🇳→🇺🇸 vi2en"]
          EN2VI["🇺🇸→🇻🇳 en2vi"]
        end
        TTS02["🔊 TTS Piper :8004"]
        RedisGW["💾 Redis Gateway :6379`<br>`Socket.IO Adapter"]
      end
      subgraph TTS_LB["🔊 TTS LOAD BALANCING - translation03 (c2d-highmem-4)"]
        direction TB
        TTS03["🔊 TTS Piper :8004`<br>`(Standby - 0/1 replicas)"]
        TTS_Note["⚠️ Currently disabled`<br>`Enable for TTS scaling"]
      end
      subgraph TTS_Models["🎵 Voice Models"]
        TTS_VI["🇻🇳 vi_VN-vais1000"]
        TTS_EN["🇺🇸 en_US-lessac"]
      end
    end
  end

  %% ===== CONNECTIONS =====
  Hommy_Users --> Hommy_Services

  %% Hommy Web/App ↔ DevTunnels & Backend cục bộ
  Hommy_Services -->|"HTTPS"| DevTunnel5173
  DevTunnel5173 -->|"Proxy :5173"| Vite
  Vite -->|"REST + Socket.IO client"| DevTunnel5000
  DevTunnel5000 -->|"Proxy :5000"| Express
  Express -->|"CRUD dữ liệu"| MySQL
  Express -->|"Serve static uploads"| Uploads

  %% Geocoding & bản đồ (Hommy)
  Express -->|"Forward /api/geocode"| Nominatim
  MapLeaflet -->|"Tải tile"| OSMTiles

  %% Chatbot (Hommy ↔ Groq)
  ChatWidget -->|"POST /api/chatbot"| Express
  Express -->|"LLM completions"| Groq

  %% Sepay Banking (Hommy)
  SepaySync -->|"GET /userapi/transactions/list"| Sepay
  SepaySync -->|"Ghi ledger"| MySQL

  %% Hommy → JB Calling Integration (iframe/SDK)
  ChatUI["💬 Chat & Video Call UI`<br>`(Hommy Web)"]
  Hommy_Web --> ChatUI
  ChatUI ==>|"Open JB Calling URL`<br>`https://jbcalling.site/room/:roomId?data=..."| DNS_JB
  DNS_JB -->|"DNS Resolve"| Traefik
  DNS_Subdomains -->|"DNS Resolve"| Traefik
  
  %% Load Balancing Flow
  Traefik -.->|"VIP Load Balance (x3)"| Frontend
  Traefik -.->|"WebSocket Sticky"| Gateway
  
  %% Cache Flow
  Frontend -->|"Static (no-cache)"| Nginx_Cache
  Translation -->|"Cache Hit/Miss"| Redis_TTL
  
  Gateway -->|"RTP/SRTP"| MediaSoup
  MediaSoup -->|"ICE Relay"| Coturn
  Gateway ==>|"PCM 48kHz"| STT
  STT --> STT_VI & STT_EN
  STT ==>|"Text"| Translation
  Translation --> VI2EN & EN2VI
  Translation ==>|"Translated"| TTS02
  TTS02 --> TTS_VI & TTS_EN
  TTS02 ==>|"Audio+Caption"| Gateway
  Gateway -->|"Pub/Sub"| RedisGW
  STT -->|"Cache"| Redis
  Translation -->|"Cache"| Redis
  Gateway -.->|"Metrics"| Prometheus
  STT -.->|"Metrics"| Prometheus
  Translation -.->|"Metrics"| Prometheus
  Prometheus --> Grafana
  Gateway -.->|"Logs"| Loki
  Loki --> Grafana

  %% ===== STYLING =====
  classDef hommy fill:#E8F5E9,stroke:#1B5E20,stroke-width:3px
  classDef dns fill:#E3F2FD,stroke:#0D47A1,stroke-width:2px
  classDef cdn fill:#FFF8E1,stroke:#FF6F00,stroke-width:2px
  classDef gcp fill:#FCE4EC,stroke:#880E4F,stroke-width:3px
  classDef jbcalling fill:#F3E5F5,stroke:#4A148C,stroke-width:2px
  classDef gateway fill:#FFF3E0,stroke:#E65100,stroke-width:2px
  classDef media fill:#E0F2F1,stroke:#00695C,stroke-width:2px
  classDef ai fill:#FCE4EC,stroke:#C2185B,stroke-width:2px
  classDef data fill:#EDE7F6,stroke:#512DA8,stroke-width:2px
  classDef model fill:#FFFDE7,stroke:#F9A825,stroke-width:1px
  classDef devinfra fill:#FFF3E0,stroke:#E65100,stroke-width:2px
  classDef externalhommy fill:#FCE4EC,stroke:#C2185B,stroke-width:2px
  classDef standby fill:#FFEBEE,stroke:#C62828,stroke-width:1px,stroke-dasharray:5

  class Hommy_Platform hommy
  class Hommy_Dev,DevTunnels,DevMachine,Frontend_Dev,Backend_Dev devinfra
  class Hommy_External,Sepay,OSMTiles,Nominatim,Groq externalhommy
  class DNS_CDN,Hostinger_DNS dns
  class Cache_Layer cdn
  class GCP gcp
  class JB_Calling jbcalling
  class Gateway_Layer gateway
  class Media_Layer media
  class AI_Pipeline ai
  class TTS_LB standby
  class STT_VI,STT_EN,VI2EN,EN2VI,TTS_VI,TTS_EN model


```

#### Chú thích các thành phần kiến trúc:

| Thành phần | Mô tả | Công nghệ |
|------------|-------|-----------|
| **🏠 Hommy Platform** | Nền tảng cho thuê trọ chính, tích hợp JB Calling qua iframe/SDK | daphongtro.dev |
| **📍 Hostinger DNS** | Quản lý DNS cho domain jbcalling.site và các subdomains | A + AAAA (IPv4/IPv6 Dual Stack) |
| **⚡ Caching Strategy** | Nginx no-cache (real-time), Redis TTL cache (translation 24h) | Nginx 1.29.3 + Redis 7 |
| **☁️ Google Cloud Platform** | Docker Swarm cluster 3 nodes, c2d-highmem-4 (4 vCPUs, 32GB) | asia-southeast1-a |
| **📞 JB Calling** | Hệ thống Video Call dịch song ngữ - Microservices độc lập | Docker Swarm VIP LB |

#### Chú thích các luồng kết nối:

| Kiểu đường | Ý nghĩa | Mô tả |
|------------|---------|-------|
| `==>` (nét đậm đôi) | Integration Flow | Hommy → JB Calling API Integration |
| `-.->` (nét đứt) | Signaling Flow | HTTP/HTTPS/WebSocket - Điều khiển, báo hiệu |
| `-->` (nét liền) | Media/Data Flow | RTP/SRTP, DNS Resolution, Cache |
| `==>` (nét đậm) | AI Pipeline Flow | Dữ liệu qua pipeline STT→Translation→TTS |

#### Load Balancing & Caching:

| Component | Strategy | Configuration |
|-----------|----------|---------------|
| **Frontend** | Docker Swarm VIP (3 replicas) | Round-robin tự động qua overlay network |
| **Gateway WebSocket** | Sticky Session | Redis adapter cho Socket.IO multi-instance |
| **TTS Services** | Manual scaling | TTS02 active, TTS03 standby (0/1) |
| **Static Assets** | No-cache | `cache-control: no-store, no-cache` (real-time app) |
| **Translation Cache** | Redis TTL | 24h TTL cho sentences đã dịch |

#### DNS Records (Hostinger):

| Domain | Type | Value | Mục đích |
|--------|------|-------|----------|
| jbcalling.site | A | `<EXTERNAL_IPV4>` | IPv4 (GCP External) |
| jbcalling.site | AAAA | `<EXTERNAL_IPV6>` | IPv6 Dual Stack |
| webrtc.jbcalling.site | CNAME | jbcalling.site | Gateway WebSocket |
| stt.jbcalling.site | CNAME | jbcalling.site | STT Service API |
| translation.jbcalling.site | CNAME | jbcalling.site | Translation API |
| tts.jbcalling.site | CNAME | jbcalling.site | TTS Service API |
| grafana.jbcalling.site | CNAME | jbcalling.site | Monitoring Dashboard |

#### Chi tiết Node Placement (GCP) - Thực tế:

| Service | Node | Machine Type | Trạng thái |
|---------|------|--------------|------------|
| Traefik, Gateway, Frontend x3, Redis, Prometheus, Grafana, Loki | **translation01** | c2d-highmem-4 (4 vCPUs, 32GB) | ✅ Running |
| STT, Translation, TTS_02, Redis Gateway, Coturn | **translation02** | c2d-highmem-4 (4 vCPUs, 32GB) | ✅ Running |
| TTS_03 (standby) | **translation03** | c2d-highmem-4 (4 vCPUs, 32GB) | ⏸️ 0/1 replicas |

### 3.4 Domain Model per Microservice (Bounded Context)

Sơ đồ này thể hiện **Domain-Driven Design (DDD)** với các Bounded Context cho từng microservice trong hệ thống JBCalling Translation:

```mermaid
flowchart TB
    %% ===== SIGNALING & ROOM MANAGEMENT =====
    subgraph SignalingContext["📡 Signaling & Room Management"]
        direction TB
        style SignalingContext fill:#1565C0,stroke:#0D47A1,stroke-width:3px,color:#fff
        
        subgraph SignalingEntities[" "]
            style SignalingEntities fill:#1976D2,stroke:#1565C0
            Rooms["🏠 Rooms"]
            Participants["👥 Participants"]
            Connections["🔗 Connections"]
        end
        
        subgraph SignalingEntities2[" "]
            style SignalingEntities2 fill:#1976D2,stroke:#1565C0
            Sessions["📋 Sessions"]
            SocketEvents["⚡ Socket Events"]
        end
    end

    %% ===== MEDIA STREAMING =====
    subgraph MediaContext["📹 Media Streaming & WebRTC"]
        direction TB
        style MediaContext fill:#2E7D32,stroke:#1B5E20,stroke-width:3px,color:#fff
        
        subgraph MediaEntities[" "]
            style MediaEntities fill:#388E3C,stroke:#2E7D32
            Transports["🚛 Transports"]
            Producers["📤 Producers"]
            Consumers["📥 Consumers"]
        end
        
        subgraph MediaEntities2[" "]
            style MediaEntities2 fill:#388E3C,stroke:#2E7D32
            Routers["🔀 Routers"]
            MediaStreams["🎬 MediaStreams"]
            ICECandidates["🧊 ICE Candidates"]
        end
    end

    %% ===== SPEECH RECOGNITION =====
    subgraph STTContext["🎤 Speech Recognition (STT)"]
        direction TB
        style STTContext fill:#C62828,stroke:#B71C1C,stroke-width:3px,color:#fff
        
        subgraph STTEntities[" "]
            style STTEntities fill:#D32F2F,stroke:#C62828
            AudioChunks["🔊 AudioChunks"]
            Transcriptions["📝 Transcriptions"]
        end
        
        subgraph STTEntities2[" "]
            style STTEntities2 fill:#D32F2F,stroke:#C62828
            LanguageModels["🗣️ Language Models<br/>(VI/EN)"]
            VoiceSegments["🎵 Voice Segments"]
        end
    end

    %% ===== TRANSLATION =====
    subgraph TranslationContext["🌍 Translation"]
        direction TB
        style TranslationContext fill:#6A1B9A,stroke:#4A148C,stroke-width:3px,color:#fff
        
        subgraph TransEntities[" "]
            style TransEntities fill:#7B1FA2,stroke:#6A1B9A
            SourceText["📄 SourceText"]
            TranslatedText["📑 TranslatedText"]
        end
        
        subgraph TransEntities2[" "]
            style TransEntities2 fill:#7B1FA2,stroke:#6A1B9A
            TransModels["🔄 Translation Models<br/>(vi2en / en2vi)"]
            TransCache["💾 Translation Cache"]
            Tokenizers["🔤 Tokenizers"]
        end
    end

    %% ===== TEXT-TO-SPEECH =====
    subgraph TTSContext["🔊 Text-to-Speech (TTS)"]
        direction TB
        style TTSContext fill:#E65100,stroke:#BF360C,stroke-width:3px,color:#fff
        
        subgraph TTSEntities[" "]
            style TTSEntities fill:#EF6C00,stroke:#E65100
            InputText["📝 InputText"]
            SynthesizedAudio["🎧 Synthesized Audio"]
        end
        
        subgraph TTSEntities2[" "]
            style TTSEntities2 fill:#EF6C00,stroke:#E65100
            VoiceModels["🗣️ Voice Models<br/>(VI/EN)"]
            AudioBuffer["📀 Audio Buffer"]
        end
    end

    %% ===== USER EXPERIENCE =====
    subgraph UserContext["👤 User Experience"]
        direction TB
        style UserContext fill:#F9A825,stroke:#F57F17,stroke-width:3px,color:#000
        
        subgraph UserEntities[" "]
            style UserEntities fill:#FBC02D,stroke:#F9A825
            Users["👥 Users"]
            Preferences["⚙️ Preferences"]
        end
        
        subgraph UserEntities2[" "]
            style UserEntities2 fill:#FBC02D,stroke:#F9A825
            Subtitles["💬 Subtitles"]
            LanguageSelection["🌐 Language Selection"]
        end
    end

    %% ===== CONNECTIONS BETWEEN BOUNDED CONTEXTS =====
    SignalingContext -.->|"Room & Participant Events"| MediaContext
    MediaContext -.->|"Audio Stream"| STTContext
    STTContext -.->|"Transcribed Text"| TranslationContext
    TranslationContext -.->|"Translated Text"| TTSContext
    TTSContext -.->|"Synthesized Audio"| MediaContext
    TranslationContext -.->|"Captions"| UserContext
    SignalingContext -.->|"Session State"| UserContext
```

#### Giải thích các Bounded Context:

| Bounded Context | Microservice | Domain Entities | Trách nhiệm |
|-----------------|--------------|-----------------|-------------|
| **📡 Signaling & Room** | Gateway Service | Rooms, Participants, Sessions, Connections, Socket Events | Quản lý phòng họp, người tham gia, kết nối Socket.IO |
| **📹 Media Streaming** | Gateway + MediaSoup | Transports, Producers, Consumers, Routers, MediaStreams, ICE | Xử lý WebRTC media, SFU routing |
| **🎤 Speech Recognition** | STT Service | AudioChunks, Transcriptions, LanguageModels, VoiceSegments | Chuyển audio thành text (VI/EN) |
| **🌍 Translation** | Translation Service | SourceText, TranslatedText, TransModels, Cache, Tokenizers | Dịch vi↔en với cache |
| **🔊 Text-to-Speech** | TTS Service | InputText, SynthesizedAudio, VoiceModels, AudioBuffer | Tổng hợp giọng nói (VI/EN) |
| **👤 User Experience** | Frontend | Users, Preferences, Subtitles, LanguageSelection | Hiển thị UI, phụ đề, cài đặt |

#### Nguyên tắc Bounded Context:

1. **Loose Coupling**: Mỗi context giao tiếp qua API/Events, không phụ thuộc trực tiếp
2. **High Cohesion**: Các entity trong cùng context có liên quan chặt chẽ
3. **Single Responsibility**: Mỗi context chịu trách nhiệm một domain cụ thể
4. **Ubiquitous Language**: Thuật ngữ nhất quán trong mỗi context (AudioChunk, Transcription, Translation...)

### 3.5 API Gateway Pattern

Sơ đồ thể hiện pattern **API Gateway** trong hệ thống JBCalling Translation, nơi Traefik đóng vai trò là điểm vào duy nhất cho tất cả requests:

```mermaid
flowchart LR
    %% ===== CLIENT =====
    subgraph ClientLayer["Client"]
        Client["Browser Client<br/>React App<br/>mediasoup-client"]
    end

    %% ===== API GATEWAY =====
    subgraph APIGateway["API Gateway<br/>Traefik v3.6"]
        direction TB
        
        GW_Aggregation["Aggregation<br/>- Combine multiple<br/>  service responses<br/>- WebSocket multiplexing"]
        GW_Offloading["Offloading<br/>- SSL/TLS Termination<br/>- Let's Encrypt Auto<br/>- HTTP/2 Support"]
        GW_Routing["Routing<br/>- Path-based routing<br/>- Host-based routing<br/>- WebSocket upgrade"]
        GW_Transform["Transformation<br/>- Header injection<br/>- Request/Response<br/>  modification"]
        GW_Security["Security<br/>- Rate limiting<br/>- CORS headers<br/>- IP whitelist"]
    end

    %% ===== MICROSERVICES =====
    subgraph Services["Backend Microservices"]
        direction TB
        
        subgraph CoreServices["Core Services - translation01"]
            SVC_Frontend["Frontend Service<br/>React SPA<br/>:80"]
            SVC_Gateway["Gateway Service<br/>MediaSoup SFU<br/>Socket.IO<br/>:3000"]
        end
        
        subgraph AIServices["AI Services - translation02"]
            SVC_STT["STT Service<br/>Sherpa-ONNX<br/>FastAPI<br/>:8002"]
            SVC_Translation["Translation Service<br/>VinAI CTranslate2<br/>FastAPI<br/>:8005"]
            SVC_TTS["TTS Service<br/>Piper<br/>FastAPI<br/>:8004"]
        end
        
        subgraph SupportServices["Support Services"]
            SVC_Redis["Redis<br/>Cache + Pub/Sub<br/>:6379"]
            SVC_Coturn["Coturn<br/>TURN Server<br/>:3478"]
        end
        
        subgraph MonitorServices["Monitoring - translation03"]
            SVC_Grafana["Grafana<br/>Dashboard<br/>:3000"]
            SVC_Prometheus["Prometheus<br/>Metrics<br/>:9090"]
        end
    end

    %% ===== CONNECTIONS =====
    Client -->|"HTTPS/WSS<br/>:443"| APIGateway
    
    APIGateway -->|"jbcalling.site/"| SVC_Frontend
    APIGateway -->|"jbcalling.site/socket.io"| SVC_Gateway
    APIGateway -->|"stt.jbcalling.site"| SVC_STT
    APIGateway -->|"translation.jbcalling.site"| SVC_Translation
    APIGateway -->|"tts.jbcalling.site"| SVC_TTS
    APIGateway -->|"grafana.jbcalling.site"| SVC_Grafana
    
    SVC_Gateway -->|"Internal HTTP"| SVC_STT
    SVC_Gateway -->|"Internal HTTP"| SVC_Translation
    SVC_Gateway -->|"Internal HTTP"| SVC_TTS
    SVC_Gateway -->|"Pub/Sub"| SVC_Redis
    SVC_STT -->|"Cache"| SVC_Redis
    SVC_Translation -->|"Cache"| SVC_Redis

    %% ===== STYLING =====
    classDef client fill:#E3F2FD,stroke:#1565C0,stroke-width:2px
    classDef gateway fill:#C8E6C9,stroke:#2E7D32,stroke-width:3px
    classDef core fill:#FFF3E0,stroke:#EF6C00,stroke-width:2px
    classDef ai fill:#FCE4EC,stroke:#C2185B,stroke-width:2px
    classDef support fill:#F3E5F5,stroke:#7B1FA2,stroke-width:2px
    classDef monitor fill:#FFFDE7,stroke:#F9A825,stroke-width:2px

    class ClientLayer client
    class APIGateway gateway
    class CoreServices core
    class AIServices ai
    class SupportServices support
    class MonitorServices monitor
```

#### Chức năng của API Gateway (Traefik):

| Chức năng | Mô tả | Implementation |
|-----------|-------|----------------|
| **Aggregation** | Gộp responses từ nhiều services, multiplexing WebSocket | Socket.IO routing tới Gateway |
| **Offloading** | SSL/TLS termination, giảm tải crypto cho backend | Let's Encrypt auto-renewal |
| **Routing** | Điều hướng request dựa trên path/host | Path rules, Host rules |
| **Transformation** | Thay đổi headers, rewrite URLs | Middleware chain |
| **Security** | Rate limiting, CORS, authentication | Traefik middlewares |

#### Routing Rules:

| Domain/Path | Target Service | Port | Protocol |
|-------------|----------------|------|----------|
| `jbcalling.site/` | frontend | 80 | HTTP |
| `jbcalling.site/socket.io` | gateway | 3000 | WebSocket |
| `stt.jbcalling.site/*` | stt | 8002 | HTTP |
| `translation.jbcalling.site/*` | translation | 8005 | HTTP |
| `tts.jbcalling.site/*` | tts | 8004 | HTTP |
| `grafana.jbcalling.site/*` | grafana | 3000 | HTTP |

#### Lợi ích của API Gateway Pattern:

1. **Single Entry Point**: Client chỉ cần biết một endpoint duy nhất
2. **SSL Termination**: Chỉ cần quản lý SSL ở gateway, internal traffic có thể dùng HTTP
3. **Cross-cutting Concerns**: Logging, metrics, rate limiting tập trung tại một điểm
4. **Service Discovery**: Gateway tự động phát hiện services qua Docker Swarm DNS
5. **Load Balancing**: Phân tải tự động cho các replicas

---

## 4. Service Communication Diagram

### 4.1 Request Flow

```mermaid
flowchart TB
    subgraph Client["📱 Client (Browser)"]
        Browser["React App<br/>mediasoup-client"]
    end

    subgraph EdgeLayer["🔀 Edge Layer (translation01)"]
        Traefik["Traefik v3.6<br/>Reverse Proxy<br/>Let's Encrypt SSL"]
    end

    subgraph ApplicationLayer["📦 Application Layer"]
        subgraph FrontendService["Frontend Service"]
            FE["React Frontend x3<br/>Nginx Static Server<br/>:80 internal"]
        end
        
        subgraph GatewayService["Gateway Service"]
            GWService["MediaSoup SFU<br/>Socket.IO Server<br/>:3000 internal"]
            GWWorker["MediaSoup Workers<br/>UDP 40000-40019"]
        end
    end

    subgraph AILayer["🤖 AI Processing Layer (translation02)"]
        STT["STT Service<br/>Sherpa-ONNX (VI/EN)<br/>FastAPI :8002"]
        Trans["Translation Service<br/>VinAI vi2en/en2vi<br/>FastAPI :8005"]
    end

    subgraph CacheLayer["💾 Cache Layer"]
        Redis["Redis<br/>Session + Cache<br/>:6379"]
        RedisGW["Redis Gateway<br/>Socket.IO Adapter<br/>:6380"]
    end

    subgraph MediaLayer["📞 Media Layer"]
        Coturn["Coturn TURN Server<br/>UDP/TCP 3478<br/>UDP 49152-65535"]
    end

    Browser -->|"HTTPS<br/>jbcalling.site"| Traefik
    Browser -->|"WSS<br/>api.jbcalling.site"| Traefik
    Browser <-->|"WebRTC<br/>DTLS-SRTP"| Coturn
    
    Traefik -->|"/"| FE
    Traefik -->|"/socket.io"| GWService
    
    GWService <-->|"Internal API"| STT
    GWService <-->|"Internal API"| Trans
    GWService <-->|"Pub/Sub"| RedisGW
    
    STT <-->|"Cache"| Redis
    Trans <-->|"Cache"| Redis
    
    GWService <--> GWWorker
    GWWorker <-->|"RTP/RTCP"| Coturn

    classDef client fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef edge fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef app fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef ai fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef cache fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef media fill:#fff8e1,stroke:#ff8f00,stroke-width:2px

    class Client client
    class EdgeLayer edge
    class ApplicationLayer app
    class AILayer ai
    class CacheLayer cache
    class MediaLayer media
```

### 4.2 Domain Routing

```mermaid
flowchart LR
    subgraph Domains["🌐 Public Domains"]
        D1["jbcalling.site"]
        D2["api.jbcalling.site"]
        D3["webrtc.jbcalling.site"]
        D4["grafana.jbcalling.site"]
        D5["stt.jbcalling.site"]
        D6["translation.jbcalling.site"]
        D7["tts.jbcalling.site"]
    end

    subgraph Traefik["🔀 Traefik Router"]
        R1["Router: frontend"]
        R2["Router: gateway"]
        R3["Router: gateway-ws"]
        R4["Router: grafana"]
        R5["Router: stt"]
        R6["Router: translation"]
        R7["Router: tts"]
    end

    subgraph Services["🎯 Backend Services"]
        S1["frontend:80"]
        S2["gateway:3000"]
        S3["gateway:3000"]
        S4["grafana:3000"]
        S5["stt:8002"]
        S6["translation:8005"]
        S7["tts_translation02:8004"]
    end

    D1 --> R1 --> S1
    D2 --> R2 --> S2
    D3 --> R3 --> S3
    D4 --> R4 --> S4
    D5 --> R5 --> S5
    D6 --> R6 --> S6
    D7 --> R7 --> S7

    classDef domain fill:#e3f2fd,stroke:#1565c0
    classDef router fill:#fff3e0,stroke:#ef6c00
    classDef service fill:#e8f5e9,stroke:#388e3c

    class Domains domain
    class Traefik router
    class Services service
```

---

## 5. Data Flow Architecture

### 5.1 Bidirectional Translation Flow

Hệ thống hỗ trợ dịch **hai chiều** giữa Tiếng Việt và Tiếng Anh:

```mermaid
flowchart LR
    subgraph UserA["👤 User A"]
        UA_Speak["🎤 Speaks Vietnamese"]
        UA_Hear["🔊 Hears Vietnamese"]
    end

    subgraph UserB["👤 User B"]
        UB_Speak["🎤 Speaks English"]
        UB_Hear["🔊 Hears English"]
    end

    subgraph Pipeline_A2B["🔄 Pipeline: Vietnamese → English"]
        direction TB
        STT_VI["STT<br/>Sherpa-ONNX VI (Offline)<br/>→ Vietnamese Text"]
        Trans_VI2EN["Translation<br/>vi2en model<br/>→ English Text"]
        TTS_EN["TTS<br/>en_US-lessac<br/>→ English Audio"]
    end

    subgraph Pipeline_B2A["🔄 Pipeline: English → Vietnamese"]
        direction TB
        STT_EN["STT<br/>Sherpa-ONNX EN (Streaming)<br/>→ English Text"]
        Trans_EN2VI["Translation<br/>en2vi model<br/>→ Vietnamese Text"]
        TTS_VI["TTS<br/>vi_VN-vais1000<br/>→ Vietnamese Audio"]
    end

    UA_Speak -->|"Audio"| STT_VI --> Trans_VI2EN --> TTS_EN -->|"Audio"| UB_Hear
    UB_Speak -->|"Audio"| STT_EN --> Trans_EN2VI --> TTS_VI -->|"Audio"| UA_Hear

    classDef userA fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef userB fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef pipelineA fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef pipelineB fill:#fce4ec,stroke:#c2185b,stroke-width:2px

    class UserA userA
    class UserB userB
    class Pipeline_A2B pipelineA
    class Pipeline_B2A pipelineB
```

### 5.2 Real-time Translation Pipeline

```mermaid
flowchart TB
    subgraph UserA["👤 User A (Vietnamese Speaker)"]
        MicA["🎤 Microphone"]
        SpeakerA["🔊 Speaker"]
    end

    subgraph UserB["👤 User B (English Speaker)"]
        MicB["🎤 Microphone"]
        SpeakerB["🔊 Speaker"]
    end

    subgraph Browser["📱 Browser (React + MediaSoup Client)"]
        WebRTC["WebRTC<br/>MediaStream API"]
        AudioCtx["AudioContext<br/>Audio Processing"]
        SocketIO["Socket.IO Client<br/>Real-time Events"]
    end

    subgraph Gateway["🌐 Gateway (MediaSoup SFU)"]
        Router["MediaSoup Router"]
        Producer["Audio Producer"]
        Consumer["Audio Consumer"]
        SIO_Server["Socket.IO Server"]
    end

    subgraph Pipeline["🔄 Translation Pipeline"]
        direction LR
        STT["🎤 STT Service<br/>Sherpa-ONNX VI/EN<br/><500ms"]
        Trans["🌍 Translation<br/>vi2en or en2vi<br/><500ms"]
        TTS["🔊 TTS Service<br/>Piper VI/EN<br/><400ms"]
    end

    subgraph Cache["💾 Cache Layer"]
        RedisCache["Redis Cache<br/>Translated Sentences"]
    end

    %% User A Flow
    MicA -->|"Audio Stream"| WebRTC
    WebRTC -->|"MediaStream"| AudioCtx
    AudioCtx -->|"Chunks"| SocketIO
    SocketIO -->|"WSS"| SIO_Server
    
    %% Gateway Processing
    SIO_Server -->|"Audio Chunks"| STT
    STT -->|"Vietnamese Text"| Trans
    Trans -->|"English Text"| TTS
    TTS -->|"Synthesized Audio"| SIO_Server
    
    %% Caching
    Trans <-->|"Cache Lookup"| RedisCache
    
    %% User B Receives
    SIO_Server -->|"WSS"| SocketIO
    SocketIO -->|"Audio Buffer"| AudioCtx
    AudioCtx --> SpeakerB
    
    %% Return path (User B to User A)
    MicB -.->|"Reverse Flow"| SpeakerA

    classDef user fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef browser fill:#e8f5e9,stroke:#388e3c,stroke-width:2px
    classDef gateway fill:#fff3e0,stroke:#ef6c00,stroke-width:2px
    classDef pipeline fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef cache fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px

    class UserA,UserB user
    class Browser browser
    class Gateway gateway
    class Pipeline pipeline
    class Cache cache
```

### 5.3 Sequence Diagram - Translation Flow

```mermaid
sequenceDiagram
    autonumber
    participant UA as User A (Vietnamese)
    participant FE as Frontend
    participant GW as Gateway (MediaSoup)
    participant STT as STT Service
    participant TRS as Translation Service
    participant TTS as TTS Service
    participant UB as User B (English)

    Note over UA,UB: 🔐 WebSocket Connection Established

    UA->>FE: 🎤 Speak Vietnamese
    FE->>FE: AudioContext Process
    FE->>GW: Socket.IO: audio_chunk
    
    GW->>STT: POST /transcribe {audio_base64, language}
    Note right of STT: Sherpa-ONNX<br/>VI: Offline Zipformer<br/>EN: Streaming Zipformer<br/>~200-500ms
    STT-->>GW: {text: "Xin chào", language: "vi"}
    
    GW->>TRS: POST /translate {text, direction: "vi2en"}
    Note right of TRS: VinAI ct2-vi2en<br/>CTranslate2 INT8<br/>~100-500ms
    TRS-->>GW: {text: "Hello", cached: false}
    
    GW->>TTS: POST /synthesize {text, lang: "en"}
    Note right of TTS: Piper en_US-lessac<br/>~200-400ms
    TTS-->>GW: {audio_base64: "..."}
    
    GW->>FE: Socket.IO: translated_audio
    FE->>UB: 🔊 Play "Hello"

    Note over UA,UB: ⏱️ Total Latency: ~0.9-1.5s
```

---

## 6. Component Architecture

### 6.1 Frontend Architecture (React)

```mermaid
flowchart TB
    subgraph ReactApp["📱 React Application"]
        App["App.tsx<br/>Main Component"]
        
        subgraph Contexts["Context Providers"]
            WebRTCCtx["WebRTCContext<br/>MediaSoup Client"]
            SocketCtx["SocketContext<br/>Socket.IO"]
            AuthCtx["AuthContext<br/>User State"]
        end
        
        subgraph Components["UI Components"]
            VideoCall["VideoCall<br/>Video Grid"]
            Controls["Controls<br/>Mute/Unmute"]
            Subtitles["Subtitles<br/>Translation Display"]
            Settings["Settings<br/>Language Select"]
        end
        
        subgraph Hooks["Custom Hooks"]
            useWebRTC["useWebRTC"]
            useSocket["useSocket"]
            useAudio["useAudioProcessor"]
        end
    end

    subgraph MediaSoupClient["📦 MediaSoup Client"]
        Device["Device<br/>Capabilities"]
        Transport["Transport<br/>Send/Recv"]
        Producer["Producer<br/>Audio/Video"]
        Consumer["Consumer<br/>Remote Streams"]
    end

    App --> Contexts
    Contexts --> Components
    Components --> Hooks
    Hooks --> MediaSoupClient

    classDef app fill:#e3f2fd,stroke:#1565c0
    classDef context fill:#e8f5e9,stroke:#388e3c
    classDef component fill:#fff3e0,stroke:#ef6c00
    classDef hook fill:#fce4ec,stroke:#c2185b
    classDef mediasoup fill:#f3e5f5,stroke:#7b1fa2

    class ReactApp app
    class Contexts context
    class Components component
    class Hooks hook
    class MediaSoupClient mediasoup
```

### 6.2 Gateway Architecture (MediaSoup SFU)

```mermaid
flowchart TB
    subgraph GatewayApp["🌐 Gateway Application (TypeScript)"]
        Express["Express.js<br/>HTTP Server"]
        SocketIO["Socket.IO<br/>WebSocket Server"]
        
        subgraph MediaSoup["MediaSoup Core"]
            WorkerManager["WorkerManager<br/>Worker Pool"]
            RoomManager["RoomManager<br/>Room Lifecycle"]
            AudioProcessor["AudioProcessor<br/>Audio Extraction"]
        end
        
        subgraph Handlers["Socket Event Handlers"]
            SignalingServer["SignalingServer<br/>Socket.IO Events"]
            RoomEvents["Room Events<br/>join/leave/produce/consume"]
        end
        
        subgraph Integration["AI Service Integration"]
            STTClient["STT Client<br/>POST /transcribe"]
            TransClient["Translation Client<br/>POST /translate"]
            TTSClient["TTS Client<br/>POST /synthesize"]
        end
    end

    Express --> SocketIO
    SocketIO --> SignalingServer
    SignalingServer --> RoomEvents
    RoomEvents --> WorkerManager & RoomManager
    AudioProcessor --> STTClient
    STTClient --> TransClient --> TTSClient

    classDef server fill:#e3f2fd,stroke:#1565c0
    classDef mediasoup fill:#e8f5e9,stroke:#388e3c
    classDef handler fill:#fff3e0,stroke:#ef6c00
    classDef integration fill:#fce4ec,stroke:#c2185b

    class GatewayApp server
    class MediaSoup mediasoup
    class Handlers handler
    class Integration integration
```

### 6.3 AI Services Architecture

```mermaid
flowchart TB
    subgraph STTService["🎤 STT Service (Port 8002)"]
        STT_API["FastAPI<br/>REST Endpoints"]
        subgraph STT_Models["Sherpa-ONNX Dual Model"]
            SherpaVI["sherpa-onnx-zipformer-vi-int8<br/>Vietnamese Offline"]
            SherpaEN["sherpa-onnx-streaming-zipformer-en<br/>English Streaming"]
        end
        AudioProc["AudioProcessor<br/>Resample to 16kHz"]
        EndpointDetect["Endpoint Detection<br/>Utterance Segmentation"]
    end

    subgraph TransService["🌍 Translation Service (Port 8005)"]
        Trans_API["FastAPI<br/>REST Endpoints"]
        subgraph Trans_Models["Bidirectional Models"]
            Vi2En["ct2-vi2en<br/>Vietnamese → English"]
            En2Vi["ct2-en2vi<br/>English → Vietnamese"]
        end
        SP_Tokenizer["SentencePiece<br/>Tokenizer (mBART)"]
        Trans_Cache["Redis Cache<br/>24h TTL"]
    end

    subgraph TTSService["🔊 TTS Service (Port 8004)"]
        TTS_API["FastAPI<br/>REST Endpoints"]
        subgraph TTS_Voices["Piper Voice Models"]
            Voice_VI["vi_VN-vais1000-medium<br/>Vietnamese Voice"]
            Voice_EN["en_US-lessac-medium<br/>English Voice"]
        end
        TTS_Buffer["WAV Buffer<br/>Base64 Output"]
    end

    subgraph Shared["📦 Shared Resources"]
        Redis["Redis Gateway<br/>Cache + Pub/Sub"]
        ModelStore["Model Storage<br/>/models volume"]
    end

    STT_API --> AudioProc
    AudioProc -->|"lang=vi"| SherpaVI
    AudioProc -->|"lang=en"| SherpaEN
    SherpaVI & SherpaEN --> EndpointDetect
    
    Trans_API --> Trans_Cache
    Trans_Cache -->|"Cache Miss vi2en"| Vi2En
    Trans_Cache -->|"Cache Miss en2vi"| En2Vi
    Vi2En & En2Vi --> SP_Tokenizer
    
    TTS_API -->|"lang=vi"| Voice_VI
    TTS_API -->|"lang=en"| Voice_EN
    Voice_VI & Voice_EN --> TTS_Buffer

    Trans_Cache --> Redis
    SherpaVI & SherpaEN --> ModelStore
    Vi2En & En2Vi --> ModelStore
    Voice_VI & Voice_EN --> ModelStore

    classDef stt fill:#e3f2fd,stroke:#1565c0
    classDef trans fill:#e8f5e9,stroke:#388e3c
    classDef tts fill:#fff3e0,stroke:#ef6c00
    classDef shared fill:#f3e5f5,stroke:#7b1fa2

    class STTService stt
    class TransService trans
    class TTSService tts
    class Shared shared
```

---

## 7. Deployment Architecture

### 7.1 Docker Stack Deployment

```mermaid
flowchart TB
    subgraph DockerSwarm["🐳 Docker Swarm Stack: translation"]
        subgraph CoreServices["Core Services"]
            T["traefik<br/>mode: global"]
            G["gateway<br/>replicas: 1"]
            F["frontend<br/>replicas: 3"]
        end
        
        subgraph AIServices["AI Services"]
            S["stt<br/>replicas: 1"]
            TR["translation<br/>replicas: 1"]
            TTS1["tts_translation02<br/>replicas: 1"]
            TTS2["tts_translation03<br/>replicas: 1"]
        end
        
        subgraph SupportServices["Support Services"]
            R["redis<br/>replicas: 1"]
            RG["redis_gateway<br/>replicas: 1"]
            C["coturn<br/>replicas: 1"]
        end
        
        subgraph Monitoring["Monitoring Stack"]
            P["prometheus<br/>replicas: 1"]
            GR["grafana<br/>replicas: 1"]
            L["loki<br/>replicas: 1"]
        end
    end

    subgraph Networks["📡 Overlay Networks"]
        FN["frontend<br/>attachable: true"]
        BN["backend<br/>attachable: true"]
        MN["monitoring<br/>internal: true"]
    end

    subgraph Volumes["💾 Persistent Volumes"]
        V1["redis_data"]
        V2["prometheus_data"]
        V3["grafana_data"]
        V4["loki_data"]
        V5["traefik_certs"]
    end

    CoreServices --> FN
    AIServices --> BN
    SupportServices --> FN & BN
    Monitoring --> MN

    R --> V1
    P --> V2
    GR --> V3
    L --> V4
    T --> V5

    classDef core fill:#e3f2fd,stroke:#1565c0
    classDef ai fill:#fce4ec,stroke:#c2185b
    classDef support fill:#e8f5e9,stroke:#388e3c
    classDef monitor fill:#fff3e0,stroke:#ef6c00
    classDef network fill:#f3e5f5,stroke:#7b1fa2
    classDef volume fill:#f5f5f5,stroke:#616161

    class CoreServices core
    class AIServices ai
    class SupportServices support
    class Monitoring monitor
    class Networks network
    class Volumes volume
```

### 7.2 Node Placement Constraints

```mermaid
flowchart LR
    subgraph Translation01["translation01 (Manager)"]
        direction TB
        T01["traefik<br/>constraint: manager"]
        G01["gateway<br/>constraint: manager"]
        F01["frontend x3<br/>spread: node.id"]
        R01["redis<br/>constraint: manager"]
        RG01["redis_gateway<br/>constraint: manager"]
        C01["coturn<br/>constraint: manager"]
    end

    subgraph Translation02["translation02 (Worker)"]
        direction TB
        S02["stt<br/>constraint: translation02"]
        TR02["translation<br/>constraint: translation02"]
    end

    subgraph Translation03["translation03 (Worker)"]
        direction TB
        P03["prometheus<br/>constraint: translation03"]
        G03["grafana<br/>constraint: translation03"]
        L03["loki<br/>constraint: translation03"]
    end

    classDef manager fill:#e3f2fd,stroke:#1565c0,stroke-width:2px
    classDef ai fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef monitor fill:#fff3e0,stroke:#ef6c00,stroke-width:2px

    class Translation01 manager
    class Translation02 ai
    class Translation03 monitor
```

---

## 8. Security Architecture

```mermaid
flowchart TB
    subgraph External["🌐 External Layer"]
        Client["Client Browser"]
        Attacker["🚫 Attacker"]
    end

    subgraph EdgeSecurity["🛡️ Edge Security"]
        Firewall["GCP Firewall<br/>Allow: 80, 443, 3478"]
        TLS["TLS 1.3<br/>Let's Encrypt"]
        RateLimit["Rate Limiting<br/>Traefik Middleware"]
    end

    subgraph AppSecurity["🔒 Application Security"]
        CORS["CORS Policy<br/>Whitelist Origins"]
        JWT["JWT Auth<br/>Token Validation"]
        Sanitize["Input Sanitization<br/>XSS Prevention"]
    end

    subgraph MediaSecurity["📞 Media Security"]
        DTLS["DTLS-SRTP<br/>Media Encryption"]
        TURN_Auth["TURN Auth<br/>Time-limited Credentials"]
        ICE["ICE Candidates<br/>Trickle ICE"]
    end

    subgraph InternalSecurity["🔐 Internal Security"]
        Overlay["Overlay Networks<br/>Service Isolation"]
        Secrets["Docker Secrets<br/>Credential Management"]
        NonRoot["Non-root Users<br/>Container Security"]
    end

    Client -->|"✅ Valid Request"| Firewall
    Attacker -->|"❌ Blocked"| Firewall
    Firewall --> TLS --> RateLimit
    RateLimit --> CORS --> JWT --> Sanitize
    Sanitize --> DTLS & TURN_Auth
    DTLS --> Overlay --> Secrets --> NonRoot

    classDef external fill:#ffebee,stroke:#c62828
    classDef edge fill:#e3f2fd,stroke:#1565c0
    classDef app fill:#e8f5e9,stroke:#388e3c
    classDef media fill:#fff3e0,stroke:#ef6c00
    classDef internal fill:#f3e5f5,stroke:#7b1fa2

    class External external
    class EdgeSecurity edge
    class AppSecurity app
    class MediaSecurity media
    class InternalSecurity internal
```

---

## 9. Monitoring Architecture

```mermaid
flowchart TB
    subgraph Applications["📦 Applications"]
        GW["Gateway<br/>/metrics"]
        STT["STT Service<br/>/metrics"]
        Trans["Translation<br/>/metrics"]
        FE["Frontend<br/>Performance API"]
    end

    subgraph Collection["📊 Metrics Collection"]
        Prom["Prometheus<br/>Scrape Targets"]
        Loki["Loki<br/>Log Aggregation"]
        Promtail["Promtail<br/>Log Shipper"]
    end

    subgraph Visualization["📈 Visualization"]
        Grafana["Grafana<br/>grafana.jbcalling.site"]
        Dashboards["Dashboards:<br/>- System Overview<br/>- AI Performance<br/>- WebRTC Stats"]
    end

    subgraph Alerting["🚨 Alerting"]
        AlertManager["Alert Rules"]
        Notify["Notifications:<br/>- Email<br/>- Slack"]
    end

    GW & STT & Trans -->|"/metrics"| Prom
    GW & STT & Trans -->|"stdout/stderr"| Promtail
    Promtail --> Loki
    
    Prom --> Grafana
    Loki --> Grafana
    Grafana --> Dashboards
    
    Prom --> AlertManager --> Notify

    classDef app fill:#e3f2fd,stroke:#1565c0
    classDef collect fill:#e8f5e9,stroke:#388e3c
    classDef viz fill:#fff3e0,stroke:#ef6c00
    classDef alert fill:#fce4ec,stroke:#c2185b

    class Applications app
    class Collection collect
    class Visualization viz
    class Alerting alert
```

---

## 10. Performance Metrics

### 10.1 Latency Budget

```mermaid
flowchart LR
    subgraph Pipeline["⏱️ E2E Latency Budget: <1.5s"]
        direction LR
        A["Audio Capture<br/>~50ms"]
        B["Network<br/>~100ms"]
        C["STT<br/>~500ms"]
        D["Translation<br/>~500ms"]
        E["TTS<br/>~400ms"]
        F["Playback<br/>~50ms"]
    end

    A --> B --> C --> D --> E --> F

    classDef fast fill:#c8e6c9,stroke:#388e3c
    classDef medium fill:#fff9c4,stroke:#f9a825
    classDef slow fill:#ffcdd2,stroke:#c62828

    class A,B,F fast
    class C,D,E medium
```

### 10.2 Resource Allocation

| Node | CPU | Memory | Services | Expected Usage |
|------|-----|--------|----------|----------------|
| translation01 | 4 vCPUs | 30GB | Traefik, Gateway, Frontend, Redis, Coturn | CPU: 40-60%, Mem: 8-12GB |
| translation02 | 8 vCPUs | 16GB | STT, Translation | CPU: 60-80%, Mem: 10-14GB |
| translation03 | 4 vCPUs | 8GB | Prometheus, Grafana, Loki | CPU: 20-40%, Mem: 4-6GB |

---

## 11. Appendix

### A. Port Reference

| Service | Internal Port | External Port | Protocol |
|---------|---------------|---------------|----------|
| Traefik | 80, 443, 8080 | 80, 443 | HTTP/HTTPS |
| Frontend | 80 | - | HTTP |
| Gateway | 3000 | - | HTTP/WS |
| STT | 8002 | - | HTTP |
| Translation | 8005 | - | HTTP |
| TTS (translation02) | 8004 | - | HTTP |
| TTS (translation03) | 8004 | - | HTTP |
| Redis | 6379, 6380 | - | TCP |
| Coturn | 3478 | 3478 | UDP/TCP |
| MediaSoup | 40000-40019 | 40000-40019 | UDP |
| Prometheus | 9090 | - | HTTP |
| Grafana | 3000 | - | HTTP |

### B. Technology Stack Summary

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Orchestration | Docker Swarm | 29.1.1 | Container Management |
| Reverse Proxy | Traefik | v3.6 | SSL Termination, Routing |
| Frontend | React | 18.x | User Interface |
| WebRTC | MediaSoup | 3.x | SFU Media Server |
| STT | Sherpa-ONNX (VI offline + EN streaming) | Zipformer INT8 | Vietnamese + English Speech Recognition |
| Translation | VinAI vi2en + en2vi | CTranslate2 INT8 | Bidirectional VI↔EN Translation |
| TTS | Piper (vi_VN + en_US) | medium ONNX | Vietnamese + English Voice Synthesis |
| Cache | Redis | 7.x | Caching, Pub/Sub |
| Monitoring | Prometheus/Grafana | - | Metrics/Visualization |

---

**Document History:**
- v1.0 (2025-12-02): Initial SAD document with Mermaid diagrams
