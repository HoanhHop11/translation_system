#!/bin/bash
# =============================================================================
# Script: Join Worker Node vào Docker Swarm
# Phase: 1 - Infrastructure Setup
# Chạy trên: translation02 và translation03
# Date: October 5, 2025
# =============================================================================

set -e

echo "======================================"
echo "🐳 JOIN DOCKER SWARM WORKER"
echo "======================================"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Kiểm tra arguments
if [ $# -ne 2 ]; then
    echo -e "${RED}❌ Thiếu arguments!${NC}"
    echo ""
    echo "Usage: $0 <WORKER_TOKEN> <MANAGER_IP>"
    echo ""
    echo "Example:"
    echo "  $0 SWMTKN-1-xxxxx 10.148.0.5"
    exit 1
fi

WORKER_TOKEN=$1
MANAGER_IP=$2

echo -e "${YELLOW}📍 Manager IP: $MANAGER_IP${NC}"
echo -e "${YELLOW}🔑 Worker Token: ${WORKER_TOKEN:0:20}...${NC}"

# Kiểm tra xem đã là Swarm member chưa
if docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo -e "${YELLOW}⚠️  Node này đã là member của Swarm${NC}"
    echo ""
    echo "📋 Thông tin hiện tại:"
    docker info | grep -A 5 "Swarm:"
    echo ""
    echo -e "${YELLOW}Bạn có muốn leave và join lại không? (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^([yY][eE][sS]|[yY])$ ]]; then
        echo "🔄 Leaving swarm..."
        docker swarm leave
    else
        echo "Giữ nguyên cấu hình hiện tại."
        exit 0
    fi
fi

echo ""
echo "🚀 Joining swarm as worker node..."
docker swarm join --token "$WORKER_TOKEN" "$MANAGER_IP:2377"

echo ""
echo -e "${GREEN}✅ ĐÃ JOIN SWARM THÀNH CÔNG!${NC}"
echo ""

# Hiển thị thông tin
echo "📋 Thông tin Swarm:"
docker info | grep -A 5 "Swarm:"

echo ""
echo "======================================"
echo -e "${GREEN}✅ WORKER NODE SETUP HOÀN TẤT!${NC}"
echo "======================================"
echo ""
echo "📝 BƯỚC TIẾP THEO:"
echo "Về manager node và chạy: docker node ls"
echo ""
