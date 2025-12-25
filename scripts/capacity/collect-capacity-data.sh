#!/bin/bash
# ===========================================
# Script Thu Thập Dữ Liệu Capacity từ Prometheus
# JBCalling Translation System
# Purpose: Export 24h metrics để phân tích capacity và chi phí scale
# ===========================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
PROMETHEUS_URL="${PROMETHEUS_URL:-https://prometheus.jbcalling.site}"
OUTPUT_DIR="${OUTPUT_DIR:-./capacity-data}"
TIME_RANGE="${TIME_RANGE:-24h}"
STEP="${STEP:-5m}"  # 5 minute resolution for 24h data

# Calculate time range
END_TIME=$(date +%s)
# Convert time range to seconds
case "${TIME_RANGE}" in
    *h) SECONDS_AGO=$((${TIME_RANGE%h} * 3600)) ;;
    *d) SECONDS_AGO=$((${TIME_RANGE%d} * 86400)) ;;
    *m) SECONDS_AGO=$((${TIME_RANGE%m} * 60)) ;;
    *)  SECONDS_AGO=86400 ;;  # Default 24h
esac
START_TIME=$((END_TIME - SECONDS_AGO))

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  JBCalling - Capacity Data Collection                      ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${CYAN}📊 Configuration:${NC}"
echo -e "   Prometheus URL: $PROMETHEUS_URL"
echo -e "   Time Range: $TIME_RANGE"
echo -e "   Start: $(date -d "@$START_TIME" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $START_TIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo $START_TIME)"
echo -e "   End: $(date -d "@$END_TIME" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $END_TIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo $END_TIME)"
echo -e "   Step: $STEP"
echo -e "   Output: $OUTPUT_DIR"

# Function to query Prometheus range
query_range() {
    local query="$1"
    local filename="$2"
    local description="$3"
    
    echo -e "${BLUE}→ ${description}${NC}"
    
    local response=$(curl -s -G "${PROMETHEUS_URL}/api/v1/query_range" \
        --data-urlencode "query=${query}" \
        --data-urlencode "start=${START_TIME}" \
        --data-urlencode "end=${END_TIME}" \
        --data-urlencode "step=${STEP}" \
        2>/dev/null)
    
    if echo "$response" | jq -e '.status == "success"' > /dev/null 2>&1; then
        echo "$response" > "${OUTPUT_DIR}/${filename}.json"
        local count=$(echo "$response" | jq '.data.result | length')
        echo -e "${GREEN}  ✓ Saved (${count} series)${NC}"
    else
        echo -e "${RED}  ✗ Failed: $(echo "$response" | jq -r '.error // "Unknown error"')${NC}"
        echo '{"status":"error","data":{"result":[]}}' > "${OUTPUT_DIR}/${filename}.json"
    fi
}

# Function to query instant
query_instant() {
    local query="$1"
    local filename="$2"
    local description="$3"
    
    echo -e "${BLUE}→ ${description}${NC}"
    
    local response=$(curl -s -G "${PROMETHEUS_URL}/api/v1/query" \
        --data-urlencode "query=${query}" \
        2>/dev/null)
    
    if echo "$response" | jq -e '.status == "success"' > /dev/null 2>&1; then
        echo "$response" > "${OUTPUT_DIR}/${filename}.json"
        echo -e "${GREEN}  ✓ Saved${NC}"
    else
        echo -e "${RED}  ✗ Failed${NC}"
        echo '{"status":"error","data":{"result":[]}}' > "${OUTPUT_DIR}/${filename}.json"
    fi
}

# ===========================================
# PHASE 1: System Resource Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 1: System Resources ═══${NC}"

# CPU Usage (percentage used)
query_range \
    '100 - (avg by(instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])) * 100)' \
    "node-cpu-usage" \
    "Node CPU Usage (%)"

# Memory Usage (percentage used)
query_range \
    '(1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100' \
    "node-memory-usage" \
    "Node Memory Usage (%)"

# Memory Total (bytes)
query_instant \
    'node_memory_MemTotal_bytes' \
    "node-memory-total" \
    "Node Memory Total"

# Disk Usage (percentage used)
query_range \
    '(1 - (node_filesystem_avail_bytes{fstype!~"tmpfs|overlay",mountpoint="/"} / node_filesystem_size_bytes{fstype!~"tmpfs|overlay",mountpoint="/"})) * 100' \
    "node-disk-usage" \
    "Node Disk Usage (%)"

# Disk I/O Read (bytes/s)
query_range \
    'rate(node_disk_read_bytes_total[5m])' \
    "node-disk-read" \
    "Node Disk Read (bytes/s)"

# Disk I/O Write (bytes/s)
query_range \
    'rate(node_disk_written_bytes_total[5m])' \
    "node-disk-write" \
    "Node Disk Write (bytes/s)"

# Network RX (bytes/s)
query_range \
    'sum by(instance) (rate(node_network_receive_bytes_total{device!~"lo|docker.*|br.*|veth.*"}[5m]))' \
    "node-network-rx" \
    "Node Network RX (bytes/s)"

# Network TX (bytes/s)
query_range \
    'sum by(instance) (rate(node_network_transmit_bytes_total{device!~"lo|docker.*|br.*|veth.*"}[5m]))' \
    "node-network-tx" \
    "Node Network TX (bytes/s)"

# CPU Count
query_instant \
    'count by(instance) (node_cpu_seconds_total{mode="idle"})' \
    "node-cpu-count" \
    "Node CPU Core Count"

# ===========================================
# PHASE 2: Container Resource Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 2: Container Resources ═══${NC}"

# Container CPU Usage (cores)
query_range \
    'sum by(name) (rate(container_cpu_usage_seconds_total{name!="",name!~".*POD.*"}[5m]))' \
    "container-cpu-usage" \
    "Container CPU Usage (cores)"

# Container Memory Usage (bytes)
query_range \
    'sum by(name) (container_memory_usage_bytes{name!="",name!~".*POD.*"})' \
    "container-memory-usage" \
    "Container Memory Usage (bytes)"

# Container Memory Limit (bytes)
query_instant \
    'sum by(name) (container_spec_memory_limit_bytes{name!="",name!~".*POD.*"})' \
    "container-memory-limit" \
    "Container Memory Limit"

# Container Network RX
query_range \
    'sum by(name) (rate(container_network_receive_bytes_total{name!="",name!~".*POD.*"}[5m]))' \
    "container-network-rx" \
    "Container Network RX (bytes/s)"

# Container Network TX
query_range \
    'sum by(name) (rate(container_network_transmit_bytes_total{name!="",name!~".*POD.*"}[5m]))' \
    "container-network-tx" \
    "Container Network TX (bytes/s)"

# ===========================================
# PHASE 3: Service Health & Availability
# ===========================================
echo -e "\n${YELLOW}═══ Phase 3: Service Health ═══${NC}"

# Service Up Status
query_range \
    'up' \
    "service-up-status" \
    "Service Up Status"

# Service Availability (percentage uptime)
query_instant \
    'avg_over_time(up[24h]) * 100' \
    "service-availability-24h" \
    "Service 24h Availability (%)"

# ===========================================
# PHASE 4: STT Service Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 4: STT Service ═══${NC}"

# STT P50 Latency
query_range \
    'histogram_quantile(0.50, sum(rate(stt_transcription_duration_seconds_bucket[5m])) by (le))' \
    "stt-p50-latency" \
    "STT P50 Latency (s)"

# STT P95 Latency
query_range \
    'histogram_quantile(0.95, sum(rate(stt_transcription_duration_seconds_bucket[5m])) by (le))' \
    "stt-p95-latency" \
    "STT P95 Latency (s)"

# STT P99 Latency
query_range \
    'histogram_quantile(0.99, sum(rate(stt_transcription_duration_seconds_bucket[5m])) by (le))' \
    "stt-p99-latency" \
    "STT P99 Latency (s)"

# STT Request Rate
query_range \
    'rate(stt_transcriptions_total[5m])' \
    "stt-request-rate" \
    "STT Request Rate (req/s)"

# STT Total Requests
query_range \
    'increase(stt_transcriptions_total[1h])' \
    "stt-hourly-requests" \
    "STT Hourly Requests"

# ===========================================
# PHASE 5: Translation Service Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 5: Translation Service ═══${NC}"

# Translation P95 Latency
query_range \
    'histogram_quantile(0.95, sum(rate(translation_latency_seconds_bucket[5m])) by (le))' \
    "translation-p95-latency" \
    "Translation P95 Latency (s)"

# Translation Request Rate
query_range \
    'rate(translation_requests_total[5m])' \
    "translation-request-rate" \
    "Translation Request Rate (req/s)"

# Translation Cache Hit Rate
query_range \
    'rate(translation_cache_hits_total[5m]) / (rate(translation_cache_hits_total[5m]) + rate(translation_cache_misses_total[5m]) + 0.001)' \
    "translation-cache-hit-rate" \
    "Translation Cache Hit Rate"

# Translation Success Rate
query_range \
    'sum(rate(translation_requests_total{status="success"}[5m])) / (sum(rate(translation_requests_total[5m])) + 0.001)' \
    "translation-success-rate" \
    "Translation Success Rate"

# ===========================================
# PHASE 6: TTS Service Metrics (via Blackbox)
# ===========================================
echo -e "\n${YELLOW}═══ Phase 6: TTS Service ═══${NC}"

# TTS Probe Success
query_range \
    'probe_success{job="tts"}' \
    "tts-probe-success" \
    "TTS Probe Success"

# TTS Response Time
query_range \
    'probe_duration_seconds{job="tts"}' \
    "tts-response-time" \
    "TTS Response Time (s)"

# TTS HTTP Status
query_range \
    'probe_http_status_code{job="tts"}' \
    "tts-http-status" \
    "TTS HTTP Status Code"

# ===========================================
# PHASE 7: Gateway Service Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 7: Gateway Service ═══${NC}"

# Gateway Active Rooms
query_range \
    'gateway_rooms_total' \
    "gateway-rooms" \
    "Gateway Active Rooms"

# Gateway Audio Streams
query_range \
    'gateway_audio_streams_total' \
    "gateway-audio-streams" \
    "Gateway Audio Streams"

# Gateway Workers
query_range \
    'gateway_workers_total' \
    "gateway-workers" \
    "Gateway Workers"

# ===========================================
# PHASE 8: Redis Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 8: Redis ═══${NC}"

# Redis Memory Usage
query_range \
    'redis_memory_used_bytes' \
    "redis-memory-used" \
    "Redis Memory Used (bytes)"

# Redis Memory Max
query_instant \
    'redis_memory_max_bytes' \
    "redis-memory-max" \
    "Redis Memory Max"

# Redis Connected Clients
query_range \
    'redis_connected_clients' \
    "redis-connections" \
    "Redis Connected Clients"

# Redis Commands/s
query_range \
    'rate(redis_commands_processed_total[5m])' \
    "redis-commands-rate" \
    "Redis Commands Rate (/s)"

# ===========================================
# PHASE 9: Traefik Metrics
# ===========================================
echo -e "\n${YELLOW}═══ Phase 9: Traefik ═══${NC}"

# Traefik Request Rate
query_range \
    'sum(rate(traefik_service_requests_total[5m]))' \
    "traefik-request-rate" \
    "Traefik Total Request Rate (/s)"

# Traefik Request Rate by Service
query_range \
    'sum by(service) (rate(traefik_service_requests_total[5m]))' \
    "traefik-request-rate-by-service" \
    "Traefik Request Rate by Service"

# Traefik Error Rate
query_range \
    'sum(rate(traefik_service_requests_total{code=~"5.."}[5m])) / (sum(rate(traefik_service_requests_total[5m])) + 0.001) * 100' \
    "traefik-error-rate" \
    "Traefik Error Rate (%)"

# Traefik Latency by Service
query_range \
    'histogram_quantile(0.95, sum by(service, le) (rate(traefik_service_request_duration_seconds_bucket[5m])))' \
    "traefik-p95-latency" \
    "Traefik P95 Latency by Service (s)"

# ===========================================
# PHASE 10: External Endpoints
# ===========================================
echo -e "\n${YELLOW}═══ Phase 10: External Endpoints ═══${NC}"

# External Probe Success
query_range \
    'probe_success{job="blackbox-external"}' \
    "external-probe-success" \
    "External Endpoints Probe Success"

# External Response Time
query_range \
    'probe_duration_seconds{job="blackbox-external"}' \
    "external-response-time" \
    "External Endpoints Response Time (s)"

# SSL Certificate Expiry
query_instant \
    '(probe_ssl_earliest_cert_expiry{job="blackbox-external"} - time()) / 86400' \
    "ssl-cert-expiry-days" \
    "SSL Certificate Expiry (days)"

# ===========================================
# Generate Metadata
# ===========================================
echo -e "\n${YELLOW}═══ Generating Metadata ═══${NC}"

START_TIME_HUMAN=$(date -d "@$START_TIME" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $START_TIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo $START_TIME)
END_TIME_HUMAN=$(date -d "@$END_TIME" '+%Y-%m-%d %H:%M:%S' 2>/dev/null || date -r $END_TIME '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo $END_TIME)
COLLECTION_TIME=$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')

cat > "${OUTPUT_DIR}/metadata.json" << EOF
{
  "collection_time": "${COLLECTION_TIME}",
  "prometheus_url": "${PROMETHEUS_URL}",
  "time_range": "${TIME_RANGE}",
  "start_time": ${START_TIME},
  "end_time": ${END_TIME},
  "start_time_human": "${START_TIME_HUMAN}",
  "end_time_human": "${END_TIME_HUMAN}",
  "step": "${STEP}",
  "files": [
    $(ls -1 ${OUTPUT_DIR}/*.json 2>/dev/null | grep -v metadata | xargs -I{} basename {} | sed 's/^/"/;s/$/"/' | paste -sd,)
  ]
}
EOF
echo -e "${GREEN}  ✓ Metadata saved${NC}"

# ===========================================
# Summary
# ===========================================
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  ✅ Data Collection Complete!                              ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

FILE_COUNT=$(ls -1 ${OUTPUT_DIR}/*.json 2>/dev/null | wc -l)
TOTAL_SIZE=$(du -sh ${OUTPUT_DIR} 2>/dev/null | cut -f1)

echo -e "\n${GREEN}📊 Summary:${NC}"
echo -e "   Files collected: ${FILE_COUNT}"
echo -e "   Total size: ${TOTAL_SIZE}"
echo -e "   Output directory: ${OUTPUT_DIR}"

echo -e "\n${CYAN}📁 Files:${NC}"
ls -lh ${OUTPUT_DIR}/*.json | awk '{print "   " $NF " (" $5 ")"}'

echo -e "\n${YELLOW}💡 Next Step:${NC}"
echo -e "   Run: python3 analyze-capacity.py --data-dir ${OUTPUT_DIR}"

