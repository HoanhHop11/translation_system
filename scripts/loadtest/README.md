# Load Testing Scripts - JBCalling Translation System

Thư mục này chứa các script để thực hiện load testing và thu thập metrics cho hệ thống JBCalling.

## Yêu Cầu

### k6 (Load Testing Tool)
```bash
# Ubuntu/Debian
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install k6

# macOS
brew install k6

# Docker
docker pull grafana/k6
```

### jq (JSON Parser)
```bash
sudo apt-get install jq
```

## Scripts

### 1. k6-stt-loadtest.js
Load test cho STT (Speech-to-Text) service.

```bash
# Run baseline test
k6 run k6-stt-loadtest.js

# Run with custom URL
STT_URL=https://stt.jbcalling.site k6 run k6-stt-loadtest.js

# Export results
k6 run --out json=stt-results.json k6-stt-loadtest.js

# Run specific scenario only
k6 run --tag scenario=baseline k6-stt-loadtest.js
```

### 2. k6-translation-loadtest.js
Load test cho Translation service.

```bash
# Run all scenarios
k6 run k6-translation-loadtest.js

# Run with custom URL
TRANSLATION_URL=https://translation.jbcalling.site k6 run k6-translation-loadtest.js

# Export to InfluxDB for Grafana visualization
k6 run --out influxdb=http://localhost:8086/k6 k6-translation-loadtest.js
```

### 3. collect-metrics.sh
Thu thập metrics từ Prometheus sau khi chạy load test.

```bash
# Make executable
chmod +x collect-metrics.sh

# Run with defaults
./collect-metrics.sh

# Custom configuration
PROMETHEUS_URL=https://prometheus.jbcalling.site \
OUTPUT_DIR=./results-$(date +%Y%m%d) \
DURATION=1h \
./collect-metrics.sh
```

## Quy Trình Load Testing

### Trước Khi Test

1. **Verify services healthy**
   ```bash
   curl -s https://stt.jbcalling.site/health | jq
   curl -s https://translation.jbcalling.site/health | jq
   curl -s https://prometheus.jbcalling.site/-/healthy
   ```

2. **Check Prometheus targets**
   - Mở https://prometheus.jbcalling.site/targets
   - Đảm bảo tất cả targets đều UP

3. **Silence alerts (optional)**
   ```bash
   # Tạo silence trong Alertmanager
   curl -X POST https://alertmanager.jbcalling.site/api/v2/silences \
     -H "Content-Type: application/json" \
     -d '{
       "matchers": [{"name": "severity", "value": "warning", "isRegex": false}],
       "startsAt": "'$(date -Iseconds)'",
       "endsAt": "'$(date -d "+2 hours" -Iseconds)'",
       "createdBy": "loadtest",
       "comment": "Load testing in progress"
     }'
   ```

4. **Create output directory**
   ```bash
   mkdir -p loadtest-results
   ```

### Trong Khi Test

1. **Monitor Grafana dashboards**
   - https://grafana.jbcalling.site/d/jbcalling-nodes
   - https://grafana.jbcalling.site/d/jbcalling-ai-services

2. **Watch k6 output**
   ```bash
   k6 run --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" k6-stt-loadtest.js
   ```

3. **Record timestamps**
   - Ghi lại thời điểm bắt đầu/kết thúc các scenarios
   - Note any anomalies

### Sau Khi Test

1. **Collect metrics**
   ```bash
   ./collect-metrics.sh
   ```

2. **Download Loki logs**
   ```bash
   # Via LogCLI
   logcli query '{job=~".+"}' \
     --from="2025-12-10T10:00:00Z" \
     --to="2025-12-10T11:00:00Z" \
     --output=jsonl > loadtest-logs.jsonl
   ```

3. **Generate report**
   - Analyze metrics in `loadtest-results/`
   - Compare against SLO thresholds
   - Document bottlenecks and recommendations

## Test Scenarios

### Baseline (10 VUs)
- **Duration**: 5 minutes
- **Virtual Users**: 10 concurrent
- **Purpose**: Establish baseline metrics

### Peak Load (50 VUs)
- **Duration**: 7 minutes
- **Virtual Users**: 50 concurrent
- **Purpose**: Normal peak traffic simulation

### Stress Test (100-150 VUs)
- **Duration**: 10 minutes
- **Virtual Users**: 100-150 concurrent
- **Purpose**: Identify breaking points

## SLO Thresholds

| Service | Metric | Target | Critical |
|---------|--------|--------|----------|
| STT | P95 Latency | < 3s | > 5s |
| Translation | P95 Latency | < 2s | > 3s |
| Gateway | Availability | 99.9% | < 99% |
| All | Error Rate | < 1% | > 5% |

## Output Files

```
loadtest-results/
├── stt-summary.json         # k6 STT test summary
├── translation-summary.json # k6 Translation test summary
├── cpu-usage.json           # Prometheus CPU metrics
├── memory-usage.json        # Prometheus Memory metrics
├── stt-p95-latency.json     # STT latency over time
├── translation-throughput.json
├── active-alerts.json       # Alerts during test
└── metrics-summary.md       # Human-readable summary
```

## Tips

### Analyzing Results with jq
```bash
# Get average CPU usage
jq '[.data.result[].values[] | .[1] | tonumber] | add / length' cpu-usage.json

# Get max latency
jq '[.data.result[].values[] | .[1] | tonumber] | max' stt-p95-latency.json

# List all alerts
jq '.data.alerts[] | {alertname: .labels.alertname, state: .state}' active-alerts.json
```

### Python Analysis
```python
import json
import pandas as pd

# Load Prometheus data
with open('loadtest-results/cpu-usage.json') as f:
    data = json.load(f)

# Convert to DataFrame
for result in data['data']['result']:
    instance = result['metric']['instance']
    df = pd.DataFrame(result['values'], columns=['timestamp', 'value'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='s')
    df['value'] = df['value'].astype(float)
    print(f"{instance}: Mean={df['value'].mean():.2f}%, Max={df['value'].max():.2f}%")
```

### Grafana Dashboard Import
1. Mở Grafana → Import Dashboard
2. Upload JSON files từ `loadtest-results/`
3. Chọn Prometheus datasource
4. Visualize time-series data

## Troubleshooting

### k6 không kết nối được service
```bash
# Check DNS resolution
nslookup stt.jbcalling.site

# Test với curl
curl -v https://stt.jbcalling.site/health
```

### Prometheus query timeout
```bash
# Reduce time range
DURATION=15m ./collect-metrics.sh

# Increase step interval (edit script)
--data-urlencode "step=60s"
```

### High error rate trong test
- Check service logs: `docker service logs translation_stt`
- Check resource limits: `docker stats`
- Reduce VU count và tăng dần


