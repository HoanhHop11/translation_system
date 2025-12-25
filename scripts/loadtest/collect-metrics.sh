#!/bin/bash
# ===========================================
# Script Thu Thập Metrics từ Prometheus
# JBCalling Translation System - Load Testing
# ===========================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
PROMETHEUS_URL="${PROMETHEUS_URL:-https://prometheus.jbcalling.site}"
OUTPUT_DIR="${OUTPUT_DIR:-./loadtest-results}"
DURATION="${DURATION:-30m}"  # Time range to query

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  JBCalling - Metrics Collection Script                     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${YELLOW}📊 Collecting metrics from: $PROMETHEUS_URL${NC}"
echo -e "${YELLOW}📁 Output directory: $OUTPUT_DIR${NC}"
echo -e "${YELLOW}⏱️  Time range: $DURATION${NC}\n"

# Function to query Prometheus
query_prometheus() {
    local query="$1"
    local filename="$2"
    local description="$3"
    
    echo -e "${BLUE}→ Querying: ${description}${NC}"
    
    # URL encode the query
    local encoded_query=$(python3 -c "import urllib.parse; print(urllib.parse.quote('''$query'''))")
    
    curl -s -G "${PROMETHEUS_URL}/api/v1/query_range" \
        --data-urlencode "query=${query}" \
        --data-urlencode "start=$(date -d "-${DURATION}" +%s)" \
        --data-urlencode "end=$(date +%s)" \
        --data-urlencode "step=15s" \
        -o "${OUTPUT_DIR}/${filename}.json"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Saved to ${filename}.json${NC}"
    else
        echo -e "${RED}  ✗ Failed to query${NC}"
    fi
}

# Function to get instant query
query_instant() {
    local query="$1"
    local filename="$2"
    local description="$3"
    
    echo -e "${BLUE}→ Instant query: ${description}${NC}"
    
    curl -s -G "${PROMETHEUS_URL}/api/v1/query" \
        --data-urlencode "query=${query}" \
        -o "${OUTPUT_DIR}/${filename}.json"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}  ✓ Saved to ${filename}.json${NC}"
    else
        echo -e "${RED}  ✗ Failed to query${NC}"
    fi
}

echo -e "\n${YELLOW}=== System Metrics ===${NC}"

query_prometheus \
    '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' \
    "cpu-usage" \
    "CPU Usage by Node"

query_prometheus \
    '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100' \
    "memory-usage" \
    "Memory Usage by Node"

query_prometheus \
    '(1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay"})) * 100' \
    "disk-usage" \
    "Disk Usage by Node"

query_prometheus \
    'rate(node_network_receive_bytes_total{device!~"lo|docker.*|br.*|veth.*"}[5m])' \
    "network-rx" \
    "Network RX Bytes/s"

query_prometheus \
    'rate(node_network_transmit_bytes_total{device!~"lo|docker.*|br.*|veth.*"}[5m])' \
    "network-tx" \
    "Network TX Bytes/s"

echo -e "\n${YELLOW}=== Service Health ===${NC}"

query_prometheus \
    'up' \
    "service-health" \
    "Service Health Status"

query_instant \
    'count(up == 1)' \
    "healthy-services" \
    "Count of Healthy Services"

echo -e "\n${YELLOW}=== STT Metrics ===${NC}"

query_prometheus \
    'histogram_quantile(0.95, sum(rate(stt_transcription_duration_seconds_bucket[5m])) by (le))' \
    "stt-p95-latency" \
    "STT P95 Latency"

query_prometheus \
    'histogram_quantile(0.50, sum(rate(stt_transcription_duration_seconds_bucket[5m])) by (le))' \
    "stt-p50-latency" \
    "STT P50 Latency"

query_prometheus \
    'rate(stt_transcriptions_total[5m])' \
    "stt-throughput" \
    "STT Throughput (req/s)"

query_prometheus \
    'sum(increase(stt_transcriptions_total[5m]))' \
    "stt-total-requests" \
    "STT Total Requests"

echo -e "\n${YELLOW}=== Translation Metrics ===${NC}"

query_prometheus \
    'histogram_quantile(0.95, sum(rate(translation_latency_seconds_bucket[5m])) by (le))' \
    "translation-p95-latency" \
    "Translation P95 Latency"

query_prometheus \
    'rate(translation_requests_total[5m])' \
    "translation-throughput" \
    "Translation Throughput"

query_prometheus \
    'rate(translation_cache_hits_total[5m]) / (rate(translation_cache_hits_total[5m]) + rate(translation_cache_misses_total[5m]))' \
    "translation-cache-hit-rate" \
    "Translation Cache Hit Rate"

echo -e "\n${YELLOW}=== TTS Metrics (Blackbox Probe) ===${NC}"

query_prometheus \
    'probe_success{job="tts"}' \
    "tts-health" \
    "TTS Health Status"

query_prometheus \
    'probe_duration_seconds{job="tts"}' \
    "tts-response-time" \
    "TTS Response Time"

echo -e "\n${YELLOW}=== Gateway Metrics ===${NC}"

query_prometheus \
    'gateway_rooms_total' \
    "gateway-rooms" \
    "Gateway Active Rooms"

query_prometheus \
    'gateway_workers_total' \
    "gateway-workers" \
    "Gateway Workers"

query_prometheus \
    'gateway_audio_streams_total' \
    "gateway-audio-streams" \
    "Gateway Audio Streams"

echo -e "\n${YELLOW}=== Redis Metrics ===${NC}"

query_prometheus \
    'redis_memory_used_bytes / redis_memory_max_bytes * 100' \
    "redis-memory-usage" \
    "Redis Memory Usage %"

query_prometheus \
    'redis_connected_clients' \
    "redis-connections" \
    "Redis Connected Clients"

echo -e "\n${YELLOW}=== Traefik Metrics ===${NC}"

query_prometheus \
    'rate(traefik_service_requests_total[5m])' \
    "traefik-request-rate" \
    "Traefik Request Rate"

query_prometheus \
    'sum(rate(traefik_service_requests_total{code=~"5.."}[5m])) / sum(rate(traefik_service_requests_total[5m])) * 100' \
    "traefik-error-rate" \
    "Traefik Error Rate %"

echo -e "\n${YELLOW}=== Container Metrics ===${NC}"

query_prometheus \
    'sum by(name) (rate(container_cpu_usage_seconds_total{name!=""}[5m])) * 100' \
    "container-cpu" \
    "Container CPU Usage"

query_prometheus \
    'sum by(name) (container_memory_usage_bytes{name!=""}) / 1024 / 1024' \
    "container-memory" \
    "Container Memory (MB)"

echo -e "\n${YELLOW}=== Alerts ===${NC}"

# Get current alerts
echo -e "${BLUE}→ Fetching active alerts${NC}"
curl -s "${PROMETHEUS_URL}/api/v1/alerts" -o "${OUTPUT_DIR}/active-alerts.json"
echo -e "${GREEN}  ✓ Saved to active-alerts.json${NC}"

# Generate summary report
echo -e "\n${YELLOW}=== Generating Summary Report ===${NC}"

cat > "${OUTPUT_DIR}/metrics-summary.md" << 'EOF'
# Metrics Collection Summary

## Collection Info
- **Timestamp**: $(date -Iseconds)
- **Prometheus URL**: $PROMETHEUS_URL
- **Time Range**: Last $DURATION

## Files Generated
EOF

# List all generated files
for f in "${OUTPUT_DIR}"/*.json; do
    echo "- $(basename $f)" >> "${OUTPUT_DIR}/metrics-summary.md"
done

# Add quick stats
echo -e "\n## Quick Stats\n" >> "${OUTPUT_DIR}/metrics-summary.md"

# Parse some key metrics
if [ -f "${OUTPUT_DIR}/healthy-services.json" ]; then
    healthy=$(jq -r '.data.result[0].value[1] // "N/A"' "${OUTPUT_DIR}/healthy-services.json")
    echo "- Healthy Services: $healthy" >> "${OUTPUT_DIR}/metrics-summary.md"
fi

echo -e "${GREEN}  ✓ Summary saved to metrics-summary.md${NC}"

echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ✅ Metrics Collection Complete!                           ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${GREEN}📁 Results saved to: ${OUTPUT_DIR}${NC}"
echo -e "${GREEN}📊 Total files: $(ls -1 ${OUTPUT_DIR}/*.json 2>/dev/null | wc -l)${NC}"

# Tips for analysis
echo -e "\n${YELLOW}💡 Analysis Tips:${NC}"
echo -e "  - Use jq to parse JSON: jq '.data.result[0].values' cpu-usage.json"
echo -e "  - Import to Grafana: Upload JSON files as datasource"
echo -e "  - Python analysis: Use pandas with json.load()"


