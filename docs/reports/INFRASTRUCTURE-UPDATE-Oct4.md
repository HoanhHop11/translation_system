# ⚠️ INFRASTRUCTURE UPDATE - Oct 4, 2025

## Thay Đổi Cấu Hình Instances

### Before (Docs Original)
```yaml
translation01: c2d-highcpu-8 (8 vCPU, 16GB RAM)
translation02: c2d-highcpu-8 (8 vCPU, 16GB RAM)
translation03: c2d-highcpu-4 (4 vCPU, 8GB RAM)
Total: 20 vCPUs, 40GB RAM
```

### After (Reality - Oct 4, 2025)
```yaml
translation01: c4d-standard-4 (4 vCPU, 15GB RAM) ⚠️ -50% CPU, -6% RAM
translation02: c2d-standard-4 (4 vCPU, 16GB RAM) ⚠️ -50% CPU
translation03: c2d-highcpu-4 (4 vCPU, 8GB RAM)  ✅ No change
Total: 12 vCPUs (-40%), 39GB RAM (-2.5%)
```

---

## 🔴 Critical Impact Analysis

### 1. Instance 1 (Manager + AI) - translation01

**RAM Usage Projection:**
```
PostgreSQL:        2GB
Redis:             2GB
Whisper (2 rep):   4GB (2×2GB)
NLLB (2 rep):      5GB (2×2.5GB)
OS + overhead:     2GB
─────────────────────
Total:            15GB (100% usage!)
```

**⚠️ RISKS:**
- ❌ Zero headroom cho spikes
- ❌ OOM risk rất cao
- ❌ Không thể add thêm services

**✅ MITIGATIONS:**
1. Giảm Whisper replicas: 2 → 1 (save 2GB)
2. Giảm NLLB replicas: 2 → 1 (save 2.5GB)
3. Giảm Postgres shared_buffers: 2GB → 1GB
4. Monitor swap usage continuously
5. Setup OOM alerts

**Adjusted Config:**
```yaml
# services/transcription/docker-compose.yml
deploy:
  replicas: 1  # ⚠️ Changed from 2
  resources:
    limits:
      memory: 2GB
      cpus: '1.5'

# services/translation/docker-compose.yml
deploy:
  replicas: 1  # ⚠️ Changed from 2
  resources:
    limits:
      memory: 2.5GB
      cpus: '1.5'
```

---

### 2. Instance 2 (WebRTC) - translation02

**Original Plan:**
- 6 MediaSoup workers (1 per core, 2 reserved)
- ~3000 consumers capacity
- 3-5 concurrent rooms

**Adjusted Reality (4 vCPU):**
- **2 MediaSoup workers** (1 per core, 2 reserved)
- **~1000 consumers** capacity (500 per worker)
- **1-2 concurrent rooms** realistic

**Capacity Calculation:**
```
6-person room:
  - 6 users × 3 streams (audio, video, screen) = 18 producers
  - 6 users × 5 peers × 3 streams = 90 consumers
  
1000 consumers / 90 per room = ~11 rooms theoretical
But STT bottleneck limits to 1-2 rooms practical
```

**✅ MITIGATIONS:**
1. Start MVP with 1 room only
2. Limit max participants: 6 (không cho 10)
3. Disable screen sharing trong MVP
4. Monitor CPU per worker
5. Plan upgrade path to 8 vCPU

---

### 3. Instance 3 (Monitoring) - translation03

**Status:** ✅ No change (4 vCPU, 8GB RAM)

**Services:**
- Prometheus: ~1GB
- Grafana: ~512MB
- Loki: ~1GB
- Promtail: ~256MB
- Node exporter: ~128MB

**Total:** ~3GB / 8GB = 37.5% → ✅ SAFE

---

## 📊 Performance Impact

### Latency Changes

| Metric | Original (8 vCPU) | Adjusted (4 vCPU) | Delta |
|--------|-------------------|-------------------|-------|
| STT | 500-800ms | **800-1200ms** | +60% |
| Translation | 150-300ms | **250-450ms** | +67% |
| End-to-end | 1.3-1.5s | **1.8-2.5s** | +54% |
| Concurrent rooms | 3-5 | **1-2** | -60% |

### Throughput Changes

| Metric | Original | Adjusted | Delta |
|--------|----------|----------|-------|
| MediaSoup workers | 6 | **2** | -67% |
| Max consumers | 3000 | **1000** | -67% |
| STT jobs/sec | ~4 | **~2** | -50% |
| Translation batches/sec | ~8 | **~4** | -50% |

---

## ✅ Recommended Actions

### Immediate (Before Phase 1)

1. **Update all docs với actual specs:**
   - ✅ `.env.example` - DONE
   - ✅ `README.md` - DONE
   - ⏳ `docs/01-ARCHITECTURE.md`
   - ⏳ `docs/SUMMARY.md`
   - ⏳ `infrastructure/swarm/stack.yml`

2. **Adjust resource limits:**
   ```yaml
   # All services
   deploy:
     resources:
       limits:
         cpus: '1.0'  # Max 1 CPU per service
   ```

3. **Setup monitoring alerts:**
   ```yaml
   - alert: HighMemoryUsage
     expr: node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes < 0.1
     for: 5m
     annotations:
       summary: "RAM <10% available"
   ```

### Short-term (Phase 1-2)

4. **MVP Scope Reduction:**
   - ✅ 1 room only (không 3-5)
   - ✅ 4-6 users per room (không 10)
   - ✅ Audio + Video only (không screen share)
   - ✅ Text captions only (không voice clone trong MVP)

5. **Load Testing:**
   - Test với 1 room, 4 users
   - Monitor CPU/RAM thực tế
   - Adjust limits theo actual usage

### Mid-term (Phase 3-4)

6. **Optimization Priority:**
   - ✅ Redis caching aggressive (hit rate >50%)
   - ✅ Translation batching (group requests)
   - ✅ Model quantization double-check
   - ✅ Lazy loading (load models on-demand)

### Long-term (Phase 5-6)

7. **Upgrade Path:**
   ```
   Option A: Vertical scaling
   - translation01: 4→8 vCPU (+$100/month)
   - translation02: 4→8 vCPU (+$100/month)
   Cost: +$200/month total
   
   Option B: Horizontal scaling
   - Add translation04 (4 vCPU) (+$100/month)
   - Add translation05 (4 vCPU) (+$100/month)
   Cost: +$200/month, better HA
   
   Recommendation: Option B (better availability)
   ```

---

## 🎯 Revised MVP Targets

### Performance (Realistic với 4 vCPU)

```yaml
Latency:
  Text mode: 1.0-1.7s (STT + Translation)
  Audio mode: 2.0-2.5s (+ gTTS)
  Acceptable: YES (still faster than human 3-5s)

Capacity:
  Concurrent rooms: 1 (MVP), 2 (stretch goal)
  Users per room: 4-6 optimal
  Total concurrent users: 4-12

Quality:
  STT WER: 5-10% (unchanged, model-dependent)
  Translation: 85-90% (unchanged)
  Video quality: May need to reduce to 720p@24fps
```

### Resource Allocation

```yaml
translation01 (15GB RAM):
  PostgreSQL: 1GB      (reduced from 2GB)
  Redis: 2GB           (keep)
  Whisper: 2GB ×1      (reduced from ×2)
  NLLB: 2.5GB ×1       (reduced from ×2)
  OS: 2GB              (reserve)
  Available: 5.5GB     (37% buffer ✅)

translation02 (16GB RAM):
  MediaSoup: 2GB ×2    (reduced from ×6)
  API: 1GB
  Nginx: 512MB
  OS: 2GB
  Available: 8.5GB     (53% buffer ✅)

translation03 (8GB RAM):
  Prometheus: 1GB
  Grafana: 512MB
  Loki: 1GB
  Promtail: 256MB
  OS: 1GB
  Available: 4.2GB     (53% buffer ✅)
```

---

## 📝 Files to Update

### High Priority
- [x] `.env.example` - IPs, workers, concurrency
- [x] `README.md` - Infrastructure section
- [ ] `docs/01-ARCHITECTURE.md` - All capacity numbers
- [ ] `docs/SUMMARY.md` - Performance targets
- [ ] `infrastructure/swarm/stack.yml` - Resource limits

### Medium Priority
- [ ] `docs/06-WEBRTC.md` - MediaSoup workers
- [ ] `docs/05-AI-MODELS.md` - Replicas config
- [ ] All service `docker-compose.yml` files

### Low Priority
- [ ] `docs/12-FEASIBILITY-ANALYSIS.md` - Add addendum
- [ ] `docs/STATUS.md` - Update status

---

## 💡 Lessons Learned

1. **Always validate infrastructure specs** trước khi design
2. **Build in 30-40% overhead** cho RAM
3. **Plan degradation gracefully** (1 replica OK nếu cần)
4. **Monitor early, monitor often**
5. **Vertical scaling dễ hơn horizontal** (consider khi chọn instance type)

---

**Date**: Oct 4, 2025  
**Status**: ⚠️ Action Required  
**Owner**: DevOps Team
