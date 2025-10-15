#!/bin/bash

# =============================================================================
# Phase 2: Master Deployment Script
# =============================================================================
# Script này tự động chạy toàn bộ quá trình deploy Phase 2
# =============================================================================

set -e  # Exit on error

echo "🚀 PHASE 2: AUTOMATED DEPLOYMENT"
echo "================================="
echo ""

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "$PROJECT_ROOT"

echo -e "${BLUE}Project Root: ${PROJECT_ROOT}${NC}"
echo ""

# =============================================================================
# Step 1: Build Docker Images
# =============================================================================

echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo -e "${YELLOW}STEP 1: Build Docker Images${NC}"
echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo ""

bash "${SCRIPT_DIR}/01-build-images.sh"

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}❌ Build images thất bại${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Build images hoàn tất${NC}"
echo ""

# Wait a moment
sleep 2

# =============================================================================
# Step 2: Deploy to Swarm
# =============================================================================

echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo -e "${YELLOW}STEP 2: Deploy to Docker Swarm${NC}"
echo -e "${YELLOW}═══════════════════════════════════════${NC}"
echo ""

bash "${SCRIPT_DIR}/02-deploy-phase2-services.sh"

if [ $? -ne 0 ]; then
    echo ""
    echo -e "${RED}❌ Deploy thất bại${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}✅ Deploy hoàn tất${NC}"
echo ""

# =============================================================================
# Completion
# =============================================================================

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}🎉 PHASE 2 DEPLOYMENT COMPLETED${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""

echo -e "${BLUE}📋 Deployed Services:${NC}"
echo "  ✅ API Gateway (FastAPI)"
echo "  ✅ WebSocket Signaling Server"
echo "  ✅ React Frontend"
echo ""

echo -e "${BLUE}🔗 Next Steps:${NC}"
echo "  1. Verify services: docker stack services translation"
echo "  2. Check logs: docker service logs -f translation_frontend"
echo "  3. Access frontend: http://<node-ip>:80"
echo "  4. Test registration and login"
echo "  5. Create a room and test video call"
echo ""

echo -e "${YELLOW}📖 For troubleshooting, check:${NC}"
echo "  - Service logs: docker service logs <service-name>"
echo "  - Service status: docker service ps <service-name>"
echo "  - Stack status: docker stack ps translation"
echo ""

exit 0
