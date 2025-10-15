#!/bin/bash
# =============================================================================
# Script: Khởi tạo Docker Swarm Manager
# Phase: 1 - Infrastructure Setup
# Chạy trên: translation01 (Manager Node)
# Date: October 5, 2025
# =============================================================================

set -e

echo "======================================"
echo "🐳 KHỞI TẠO DOCKER SWARM MANAGER"
echo "======================================"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Lấy Internal IP của instance này
MANAGER_IP=$(hostname -I | awk '{print $1}')

echo -e "${YELLOW}📍 Manager IP: $MANAGER_IP${NC}"

# Kiểm tra xem đã là Swarm member chưa
if docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo -e "${YELLOW}⚠️  Node này đã là member của Swarm${NC}"
    
    # Kiểm tra xem có phải manager không
    if docker info 2>/dev/null | grep -q "Is Manager: true"; then
        echo -e "${GREEN}✅ Node này đã là Swarm Manager${NC}"
        echo ""
        echo "📋 Thông tin Swarm:"
        docker node ls
        exit 0
    else
        echo -e "${RED}❌ Node này là worker, không phải manager${NC}"
        echo "Cần leave swarm và khởi tạo lại..."
        docker swarm leave
    fi
fi

echo ""
echo "🚀 Khởi tạo Docker Swarm..."
docker swarm init --advertise-addr $MANAGER_IP

echo ""
echo -e "${GREEN}✅ SWARM MANAGER ĐÃ ĐƯỢC KHỞI TẠO!${NC}"
echo ""

# Lấy join token cho worker nodes
echo "📋 Join Token cho Worker Nodes:"
echo "================================"
docker swarm join-token worker

echo ""
echo "📋 Join Token cho Manager Nodes (backup):"
echo "=========================================="
docker swarm join-token manager

echo ""
echo "💾 Lưu các token này vào file..."
mkdir -p ~/swarm-tokens

docker swarm join-token worker -q > ~/swarm-tokens/worker-token.txt
docker swarm join-token manager -q > ~/swarm-tokens/manager-token.txt

# Lưu full command
echo "docker swarm join --token $(cat ~/swarm-tokens/worker-token.txt) $MANAGER_IP:2377" > ~/swarm-tokens/worker-join-command.sh
echo "docker swarm join --token $(cat ~/swarm-tokens/manager-token.txt) $MANAGER_IP:2377" > ~/swarm-tokens/manager-join-command.sh

chmod +x ~/swarm-tokens/*.sh

echo -e "${GREEN}✅ Tokens đã được lưu tại: ~/swarm-tokens/${NC}"
echo ""

# Tạo overlay networks
echo "🌐 Tạo overlay networks..."
docker network create --driver overlay --attachable backend
docker network create --driver overlay --attachable frontend
docker network create --driver overlay --attachable monitoring

echo ""
echo -e "${GREEN}✅ Networks đã được tạo!${NC}"
docker network ls | grep overlay

echo ""
echo "======================================"
echo -e "${GREEN}✅ SWARM MANAGER SETUP HOÀN TẤT!${NC}"
echo "======================================"
echo ""
echo "📝 BƯỚC TIẾP THEO:"
echo "1. Copy worker-join-command.sh sang các worker nodes"
echo "2. Chạy script đó trên translation02 và translation03"
echo ""
