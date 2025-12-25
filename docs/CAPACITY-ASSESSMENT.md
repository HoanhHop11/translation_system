# Báo Cáo Đánh Giá Capacity - JBCalling Translation System

**Ngày đánh giá**: 10/12/2025  
**Nguồn dữ liệu**: Grafana Dashboards (12h → extrapolated 24h)  
**Cloud Provider**: Google Cloud Platform (GCP)  
**Mục tiêu Scale**: 500 concurrent users

---

## Executive Summary

| Metric | Hiện tại | Mục tiêu (500 users) |
|--------|----------|---------------------|
| **Nodes** | 3 | 8-10 |
| **Total vCPU** | 12 | ~75 |
| **Total Memory** | ~94 GB | ~125 GB |
| **Monthly Cost** | ~$530 | ~$2,400 |
| **Max Capacity** | ~150 users | 500 users |

**Trạng thái hệ thống**: ✅ TẤT CẢ SERVICES ĐANG UP VÀ HEALTHY

---

## 1. Hạ Tầng Hiện Tại

### 1.1 Thông Số Nodes

| Node | vCPU | RAM | Disk | Vai trò |
|------|------|-----|------|---------|
| translation01 | 4 | 31.3 GB | 100 GB | Manager + Gateway + Frontend |
| translation02 | 4 | 31.3 GB | 100 GB | STT + Translation + TTS |
| translation03 | 4 | 31.3 GB | 100 GB | TTS + Backup |
| **Tổng** | **12** | **~94 GB** | **300 GB** | - |

### 1.2 Service Distribution

```
translation01: Traefik, Gateway, Frontend, Prometheus, Grafana, Loki, Redis
translation02: STT, Translation, TTS, Redis-Gateway
translation03: TTS (replica)
```

---

## 2. Resource Usage (12h Data → 24h Estimate)

### 2.1 CPU Usage

| Node | Current | Mean (12h) | Max (12h) | Est. Mean (24h) |
|------|---------|------------|-----------|-----------------|
| translation01 | 20.8% | 4.04% | 81.5% | **~5%** |
| translation02 | 38.7% | 2.95% | 77.2% | **~4%** |
| translation03 | 0.86% | 1.38% | 80.5% | **~2%** |
| **Cluster Avg** | - | **2.79%** | - | **~3.7%** |

**Nhận xét**: 
- CPU usage trung bình **RẤT THẤP** (~3-4%)
- Burst peaks lên **77-81%** khi có traffic
- Headroom còn **~70-75%** cho scale

### 2.2 Memory Usage

| Node | Current | Mean (12h) | Max (12h) | Est. Mean (24h) |
|------|---------|------------|-----------|-----------------|
| translation01 | 6.31% | 2.58 GiB | 2.92 GiB | **~2.7 GiB** |
| translation02 | 12.9% | 3.26 GiB | 4.04 GiB | **~3.5 GiB** |
| translation03 | 3.33% | 1.03 GiB | 1.14 GiB | **~1.1 GiB** |
| **Total Used** | - | **6.87 GiB** | - | **~7.3 GiB** |

**Nhận xét**:
- Memory usage thấp (**~7-8%** of 94GB)
- translation02 dùng nhiều nhất (AI models)
- Headroom còn **~85 GB** cho scale

### 2.3 Disk Usage

| Node | Usage | Est. 24h |
|------|-------|----------|
| translation01 | 42.9% | **~43%** |
| translation02 | 15.2% | **~15%** |
| translation03 | 14.5% | **~15%** |

**Nhận xét**: Đủ disk space, translation01 cần monitor (>40%)

### 2.4 Network Traffic

| Node | Mean RX | Max RX |
|------|---------|--------|
| translation01 | 36.6 mB/s | 3.09 B/s |
| translation02 | 7.98 mB/s | 589 B/s |
| translation03 | 6.17 mB/s | 589 B/s |

### 2.5 Disk I/O

| Node | Mean Read | Max Read |
|------|-----------|----------|
| translation01 | 14.9 kB/s | 810 kB/s |
| translation02 | 30.6 kB/s | 3.09 MB/s |
| translation03 | 9.07 kB/s | 810 kB/s |

---

## 3. Service Performance (12h → 24h Estimate)

### 3.1 STT Service (Speech-to-Text)

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Status | ✅ UP | UP | ✅ |
| **P50 Latency** | 30.8 ms | < 500ms | ✅ Excellent |
| **P95 Latency** | 149 ms | < 3,000ms | ✅ Excellent |
| **P99 Latency** | 214 ms | < 5,000ms | ✅ Excellent |
| Max Latency | 450 ms | - | ✅ |

**Kết luận**: STT đạt hiệu năng **XUẤT SẮC** - P95 chỉ 149ms (target 3s)

### 3.2 Translation Service

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Status | ✅ UP | UP | ✅ |
| **P95 Latency** | 159 ms | < 2,000ms | ✅ Excellent |
| Success Rate | 100% | > 99% | ✅ |
| Request Rate | ~0.5 req/s peak | - | Low |

**Kết luận**: Translation đạt hiệu năng **XUẤT SẮC** - 100% success rate

### 3.3 TTS Service (Text-to-Speech)

| Metric | Value | Status |
|--------|-------|--------|
| TTS Node02 | ✅ UP | ✅ |
| TTS Node03 | ✅ UP | ✅ |
| **Avg Response** | 1.94 ms | ✅ Excellent |
| HTTP Status | 200 OK | ✅ |

### 3.4 Gateway Service (WebRTC)

| Metric | Value |
|--------|-------|
| Status | ✅ UP |
| Workers | 2 |
| Active Rooms | 1 (Mean: 1.01) |
| Audio Streams | Mean: 0.109 |

### 3.5 External Endpoints

| Endpoint | Status | Response Time | SSL Expiry |
|----------|--------|---------------|------------|
| jbcalling.site | ✅ UP | 25.7 ms | 11.7 weeks |
| grafana.jbcalling.site | ✅ UP | 38.6 ms | 11.7 weeks |
| prometheus.jbcalling.site | ✅ UP | 33.4 ms | 12.7 weeks |

### 3.6 Service Health Summary

| Service | Status |
|---------|--------|
| gateway | ✅ UP |
| grafana | ✅ UP |
| blackbox-external (x3) | ✅ UP |
| prometheus | ✅ UP |
| loki | ✅ UP |
| redis | ✅ UP |
| stt | ✅ UP |
| traefik | ✅ UP |
| cadvisor (x3) | ✅ UP |
| node-exporter (x3) | ✅ UP |
| translation | ✅ UP |
| tts (x2) | ✅ UP |

**Tổng**: 18/18 services **UP** ✅

---

## 4. Logs Analysis (24h Estimate)

| Metric | Value (12h) | Est. 24h |
|--------|-------------|----------|
| Total Errors | ~860 | **~1,720** |
| Total Log Volume | ~78K | **~156K** |
| Error Rate | ~1.1% | **~1.1%** |

**Error Pattern**: Chủ yếu từ `update-notifier-download.service` (không critical)

---

## 5. Capacity Estimation

### 5.1 Resource per User (Ước tính)

| Resource | Per Concurrent User |
|----------|---------------------|
| CPU | ~0.08 cores |
| Memory | ~150 MB |
| Network | ~2 Mbps |
| STT requests | ~4/min |
| Translation requests | ~4/min |
| TTS requests | ~2/min |

### 5.2 Current Capacity Analysis

```
Available Resources:
- CPU: 12 cores × (100% - 4%) = 11.5 cores available
- Memory: 94 GB × (100% - 8%) = 86 GB available

Estimated Max Capacity:
- By CPU: 11.5 cores / 0.08 = ~144 users
- By Memory: 86 GB / 0.15 GB = ~573 users
- By STT latency: OK up to ~200 users (based on current P95)

Bottleneck: CPU (burst to 80% with traffic)
Estimated Safe Capacity: ~100-150 concurrent users
```

### 5.3 Headroom Summary

| Resource | Used | Available | Headroom |
|----------|------|-----------|----------|
| CPU | 4% | 96% | ✅ High |
| Memory | 8% | 92% | ✅ High |
| Disk | 24% | 76% | ✅ OK |
| Network | Low | High | ✅ High |

---

## 6. Scale Requirements: 500 Users

### 6.1 Resource Calculation

| Resource | Current | Required (500 users) | Gap |
|----------|---------|---------------------|-----|
| CPU Cores | 12 | ~75 (500 × 0.15) | +63 |
| Memory | 94 GB | ~125 GB | +31 GB |
| Network | ~1 Gbps | ~1.5 Gbps | Upgrade |
| Nodes | 3 | 8-10 | +5-7 |

### 6.2 Recommended Architecture

```
Option A: Horizontal Scaling (Recommended)
├── Manager Cluster (2 nodes)
│   ├── translation01: Traefik, Prometheus, Grafana, Loki
│   └── translation01-backup: HA failover
├── Gateway Cluster (2 nodes)
│   ├── gateway01: WebRTC Gateway + MediaSoup
│   └── gateway02: WebRTC Gateway + MediaSoup
├── AI Processing Cluster (4 nodes)
│   ├── ai01: STT (Primary)
│   ├── ai02: STT + Translation
│   ├── ai03: Translation + TTS
│   └── ai04: TTS (Primary)
└── Cache/DB Cluster (2 nodes)
    ├── redis01: Primary
    └── redis02: Replica

Total: 10 nodes (n2-standard-4 or n2-standard-8)
```

```
Option B: Vertical Scaling
├── translation01: n2-standard-16 (16 vCPU, 64GB)
├── translation02: n2-standard-16 (16 vCPU, 64GB)  
├── translation03: n2-standard-16 (16 vCPU, 64GB)
└── Add 2-3 more n2-standard-8 nodes

Total: 5-6 nodes (larger instances)
```

---

## 7. GCP Cost Analysis

### 7.1 Current Infrastructure Cost

| Component | Qty | Spec | $/hour | Monthly |
|-----------|-----|------|--------|---------|
| Compute | 3 | n2-standard-4 | $0.194 | **$419** |
| Storage | 300GB | pd-ssd | $0.17/GB | **$51** |
| Network | 500GB | egress | $0.12/GB | **$60** |
| **Total** | | | | **$530/month** |

### 7.2 Projected Cost: 500 Users

#### Option A: Horizontal (10 nodes × n2-standard-4)

| Component | Qty | Monthly |
|-----------|-----|---------|
| Compute | 10 × n2-standard-4 | $1,398 |
| Storage | 1TB pd-ssd | $170 |
| Network | 2TB egress | $240 |
| **Total** | | **$1,808/month** |

#### Option B: Mixed (6 nodes, larger)

| Component | Qty | Monthly |
|-----------|-----|---------|
| Compute | 3 × n2-standard-16 + 3 × n2-standard-8 | $2,332 |
| Storage | 600GB pd-ssd | $102 |
| Network | 2TB egress | $240 |
| **Total** | | **$2,674/month** |

### 7.3 Cost Comparison

| Configuration | Monthly Cost | Cost/User |
|---------------|--------------|-----------|
| Current (3 nodes) | $530 | $3.53 (150 users) |
| Option A (10 nodes) | $1,808 | $3.62 (500 users) |
| Option B (6 large) | $2,674 | $5.35 (500 users) |

### 7.4 Cost Optimization

| Optimization | Savings |
|--------------|---------|
| 1-Year CUD | 37% → $1,139/month |
| 3-Year CUD | 57% → $777/month |
| Spot VMs (non-critical) | 60-80% on some nodes |
| Auto-scaling | Pay only for actual usage |

**Recommended**: Option A + 1-Year CUD = **~$1,139/month** for 500 users

---

## 8. Action Plan

### Phase 1: Immediate (Now)
- [x] All services healthy ✅
- [ ] Set up alerting (CPU > 70%, Memory > 80%)
- [ ] Enable GCP Committed Use Discount (1-year)

### Phase 2: Scale to 200 Users (Week 1-2)
- [ ] Add 2 more n2-standard-4 nodes
- [ ] Scale STT to 2 replicas
- [ ] Scale Translation to 2 replicas
- [ ] Load test to verify

### Phase 3: Scale to 500 Users (Week 3-4)
- [ ] Add remaining 5 nodes
- [ ] Implement Gateway clustering
- [ ] Set up Redis HA
- [ ] Full load test

### Phase 4: Production Hardening
- [ ] Enable auto-scaling policies
- [ ] Set up disaster recovery
- [ ] Implement monitoring dashboards for capacity

---

## 9. Summary

### Current State ✅

| Aspect | Status | Details |
|--------|--------|---------|
| **System Health** | ✅ EXCELLENT | 18/18 services UP |
| **CPU Usage** | ✅ LOW | 3-4% average |
| **Memory Usage** | ✅ LOW | 7-8% average |
| **AI Performance** | ✅ EXCELLENT | P95 < 200ms |
| **Capacity** | ✅ OK | ~150 users max |

### Scale Requirements 📈

| From | To | Action | Cost Change |
|------|-----|--------|-------------|
| 150 users | 500 users | Add 7 nodes | +$1,278/month |
| $530/month | $1,808/month | With CUD: $1,139/month | +115% |

### Key Recommendations 💡

1. **Ngay bây giờ**: Đăng ký 1-Year CUD để tiết kiệm 37%
2. **Trước khi scale**: Set up proper alerting
3. **Scale strategy**: Horizontal scaling (Option A) hiệu quả hơn về chi phí
4. **Target cost**: ~$2.28/user/month với CUD

---

*Báo cáo tạo: 10/12/2025 - Dựa trên Grafana 12h data extrapolated to 24h*
