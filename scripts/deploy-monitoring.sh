#!/bin/bash
# ===========================================
# Script Deploy Monitoring Stack - JBCalling
# Production-grade monitoring với Prometheus, Grafana, Loki
# Updated: December 9, 2025
# ===========================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  JBCalling - Monitoring Stack Deployment                   ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

# Check if running on manager node
if ! docker node ls &>/dev/null; then
    echo -e "${RED}❌ ERROR: Phải chạy script này trên Docker Swarm Manager node!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Đang chạy trên Manager node${NC}"

# Navigate to swarm directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SWARM_DIR="$(dirname "$SCRIPT_DIR")/infrastructure/swarm"

if [ ! -f "$SWARM_DIR/stack-hybrid.yml" ]; then
    echo -e "${RED}❌ ERROR: Không tìm thấy stack-hybrid.yml${NC}"
    echo "Expected path: $SWARM_DIR/stack-hybrid.yml"
    exit 1
fi

cd "$SWARM_DIR"
echo -e "${BLUE}📁 Working directory: $(pwd)${NC}"

# Verify config files exist
echo -e "\n${YELLOW}🔍 Kiểm tra config files...${NC}"

CONFIG_FILES=(
    "configs/prometheus.yml"
    "configs/alertmanager.yml"
    "configs/loki-config.yml"
    "configs/promtail-config.yml"
    "configs/prometheus-rules/node-alerts.yml"
    "configs/prometheus-rules/service-alerts.yml"
    "configs/grafana/provisioning/datasources/datasources.yml"
    "configs/grafana/provisioning/dashboards/dashboards.yml"
    "configs/grafana/dashboards/node-overview.json"
    "configs/grafana/dashboards/ai-services.json"
)

MISSING_FILES=0
for file in "${CONFIG_FILES[@]}"; do
    if [ -f "$file" ]; then
        echo -e "${GREEN}  ✓ $file${NC}"
    else
        echo -e "${RED}  ✗ $file (MISSING)${NC}"
        MISSING_FILES=$((MISSING_FILES + 1))
    fi
done

if [ $MISSING_FILES -gt 0 ]; then
    echo -e "${RED}❌ ERROR: Thiếu $MISSING_FILES config files!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Tất cả config files đã sẵn sàng${NC}"

# Enable Docker daemon metrics on all nodes (optional)
echo -e "\n${YELLOW}📊 Kiểm tra Docker daemon metrics...${NC}"
echo -e "${BLUE}ℹ️  Để bật Docker daemon metrics, thêm vào /etc/docker/daemon.json:${NC}"
echo '  {"metrics-addr": "0.0.0.0:9323", "experimental": true}'

# Deploy stack
echo -e "\n${YELLOW}🚀 Deploying monitoring stack...${NC}"
docker stack deploy -c stack-hybrid.yml translation --prune

# Wait for services to start
echo -e "\n${YELLOW}⏳ Chờ services khởi động...${NC}"
sleep 10

# Check monitoring services
echo -e "\n${YELLOW}📊 Kiểm tra monitoring services...${NC}"

MONITORING_SERVICES=(
    "translation_prometheus"
    "translation_alertmanager"
    "translation_grafana"
    "translation_loki"
    "translation_promtail"
    "translation_node-exporter"
    "translation_cadvisor"
    "translation_redis-exporter"
)

for service in "${MONITORING_SERVICES[@]}"; do
    STATUS=$(docker service ls --filter "name=$service" --format "{{.Replicas}}" 2>/dev/null || echo "NOT_FOUND")
    if [[ "$STATUS" == "NOT_FOUND" ]]; then
        echo -e "${RED}  ✗ $service: Not found${NC}"
    elif [[ "$STATUS" == "0/"* ]]; then
        echo -e "${YELLOW}  ⚠ $service: Starting... ($STATUS)${NC}"
    else
        echo -e "${GREEN}  ✓ $service: $STATUS${NC}"
    fi
done

# Print access URLs
echo -e "\n${BLUE}╔════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  🎉 Monitoring Stack Deployed Successfully!               ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════╝${NC}"

echo -e "\n${GREEN}📊 Access URLs:${NC}"
echo -e "  Grafana:       https://grafana.jbcalling.site"
echo -e "  Prometheus:    https://prometheus.jbcalling.site"
echo -e "  Alertmanager:  https://alertmanager.jbcalling.site"

echo -e "\n${GREEN}🔑 Grafana Credentials:${NC}"
echo -e "  Username: admin"
echo -e "  Password: JBCalling2025!"

echo -e "\n${YELLOW}📝 Chú ý:${NC}"
echo -e "  - Dashboards được tự động provisioned khi Grafana khởi động"
echo -e "  - Prometheus scrape interval: 15s"
echo -e "  - Alert rules đã được cấu hình cho CPU, Memory, Service Health"
echo -e "  - Logs được thu thập bởi Promtail và lưu trong Loki"

echo -e "\n${BLUE}💡 Commands hữu ích:${NC}"
echo -e "  docker service logs translation_prometheus --tail 50"
echo -e "  docker service logs translation_grafana --tail 50"
echo -e "  docker service ps translation_prometheus"
echo -e "  docker service ls | grep translation_"
