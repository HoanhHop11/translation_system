#!/bin/bash

# =============================================================================
# Phase 2: Deploy Services lên Docker Swarm
# =============================================================================
# Script này deploy các services của Phase 2 lên Docker Swarm cluster
# =============================================================================

set -e  # Exit on error

echo "🚀 PHASE 2: Deploy Services lên Docker Swarm"
echo "============================================"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env ]; then
    source .env
else
    echo -e "${RED}❌ File .env không tồn tại!${NC}"
    exit 1
fi

# Variables
STACK_NAME=${STACK_NAME:-"translation"}
STACK_FILE="infrastructure/swarm/stack.yml"

echo ""
echo -e "${BLUE}Thông tin deployment:${NC}"
echo "  Stack Name: $STACK_NAME"
echo "  Stack File: $STACK_FILE"
echo "  Registry: ${DOCKER_REGISTRY:-localhost:5000}"
echo "  Version: ${APP_VERSION:-latest}"
echo ""

# =============================================================================
# Pre-deployment checks
# =============================================================================

echo ""
echo -e "${YELLOW}📋 Pre-deployment checks...${NC}"
echo ""

# Check if running on manager node
NODE_ROLE=$(docker info --format '{{.Swarm.ControlAvailable}}')
if [ "$NODE_ROLE" != "true" ]; then
    echo -e "${RED}❌ Script này phải chạy trên Swarm manager node${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Đang chạy trên manager node${NC}"

# Check if stack file exists
if [ ! -f "$STACK_FILE" ]; then
    echo -e "${RED}❌ Stack file không tồn tại: $STACK_FILE${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Stack file tồn tại${NC}"

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ File .env không tồn tại${NC}"
    exit 1
fi
echo -e "${GREEN}✅ File .env tồn tại${NC}"

# Check if secrets exist
echo ""
echo -e "${YELLOW}Kiểm tra Docker secrets...${NC}"

REQUIRED_SECRETS=("postgres_password" "redis_password" "jwt_secret_key")
MISSING_SECRETS=()

for secret in "${REQUIRED_SECRETS[@]}"; do
    if ! docker secret ls --format '{{.Name}}' | grep -q "^${secret}$"; then
        MISSING_SECRETS+=("$secret")
    fi
done

if [ ${#MISSING_SECRETS[@]} -gt 0 ]; then
    echo -e "${RED}❌ Thiếu các secrets sau:${NC}"
    for secret in "${MISSING_SECRETS[@]}"; do
        echo "  - $secret"
    done
    echo ""
    echo "Chạy script scripts/phase1/05-create-secrets.sh để tạo secrets"
    exit 1
fi
echo -e "${GREEN}✅ Tất cả secrets đã tồn tại${NC}"

# =============================================================================
# Deploy stack
# =============================================================================

echo ""
echo -e "${YELLOW}🚀 Deploying stack...${NC}"
echo ""

# Export environment variables for docker stack deploy
export $(cat .env | grep -v '^#' | xargs)

# Deploy stack
docker stack deploy -c "$STACK_FILE" "$STACK_NAME" --with-registry-auth

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Stack deployed thành công${NC}"
else
    echo ""
    echo -e "${RED}❌ Deploy stack thất bại${NC}"
    exit 1
fi

# =============================================================================
# Wait for services to be ready
# =============================================================================

echo ""
echo -e "${YELLOW}⏳ Đợi services khởi động...${NC}"
echo ""

sleep 5

# List services
echo "Danh sách services:"
docker stack services "$STACK_NAME"

echo ""
echo -e "${YELLOW}Chờ 30 giây để services stabilize...${NC}"
for i in {30..1}; do
    echo -ne "  $i giây\r"
    sleep 1
done
echo ""

# =============================================================================
# Verify deployment
# =============================================================================

echo ""
echo -e "${YELLOW}🔍 Kiểm tra trạng thái services...${NC}"
echo ""

# List all Phase 2 services
PHASE2_SERVICES=("${STACK_NAME}_api" "${STACK_NAME}_signaling" "${STACK_NAME}_frontend")
ALL_READY=true

for service in "${PHASE2_SERVICES[@]}"; do
    # Check if service exists
    if ! docker service ls --format '{{.Name}}' | grep -q "^${service}$"; then
        echo -e "${YELLOW}⚠️  Service ${service} chưa được tạo${NC}"
        continue
    fi
    
    # Get replicas info
    REPLICAS=$(docker service ls --filter name="${service}" --format "{{.Replicas}}")
    
    if [[ "$REPLICAS" == *"/"* ]]; then
        CURRENT=$(echo $REPLICAS | cut -d'/' -f1)
        DESIRED=$(echo $REPLICAS | cut -d'/' -f2)
        
        if [ "$CURRENT" == "$DESIRED" ]; then
            echo -e "${GREEN}✅ ${service}: ${REPLICAS}${NC}"
        else
            echo -e "${YELLOW}⏳ ${service}: ${REPLICAS} (đang khởi động)${NC}"
            ALL_READY=false
        fi
    fi
done

# =============================================================================
# Summary and next steps
# =============================================================================

echo ""
echo "========================================"
echo "📊 DEPLOYMENT SUMMARY"
echo "========================================"
echo ""

if [ "$ALL_READY" = true ]; then
    echo -e "${GREEN}✅ Tất cả Phase 2 services đã sẵn sàng${NC}"
else
    echo -e "${YELLOW}⏳ Một số services đang khởi động. Chạy lệnh sau để kiểm tra:${NC}"
    echo "  docker stack services $STACK_NAME"
fi

echo ""
echo -e "${BLUE}📋 Các lệnh hữu ích:${NC}"
echo ""
echo "  # Xem danh sách services"
echo "  docker stack services $STACK_NAME"
echo ""
echo "  # Xem logs của service"
echo "  docker service logs -f ${STACK_NAME}_api"
echo "  docker service logs -f ${STACK_NAME}_signaling"
echo "  docker service logs -f ${STACK_NAME}_frontend"
echo ""
echo "  # Kiểm tra chi tiết service"
echo "  docker service inspect ${STACK_NAME}_api"
echo ""
echo "  # Scale service"
echo "  docker service scale ${STACK_NAME}_api=3"
echo ""
echo "  # Update service"
echo "  docker service update --image new-image:tag ${STACK_NAME}_api"
echo ""

echo -e "${BLUE}🌐 Access URLs:${NC}"
echo ""
echo "  Frontend: http://<any-node-ip>:${FRONTEND_PORT:-80}"
echo "  API Health: http://<any-node-ip>:8000/health (internal)"
echo "  Signaling Health: http://<any-node-ip>:8001/health (internal)"
echo ""

echo -e "${GREEN}✅ Phase 2 deployment hoàn tất!${NC}"
echo ""
echo "Next steps:"
echo "  1. Truy cập frontend qua browser"
echo "  2. Test đăng ký/đăng nhập"
echo "  3. Test tạo room và video call"
echo "  4. Kiểm tra logs nếu có lỗi"
echo ""
