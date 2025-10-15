#!/bin/bash

# =============================================================================
# Phase 2: Build và Push Docker Images
# =============================================================================
# Script này build các Docker images cho Phase 2 và push lên registry (local)
# =============================================================================

set -e  # Exit on error

echo "🐳 PHASE 2: Build và Push Docker Images"
echo "========================================"

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env ]; then
    source .env
else
    echo "❌ File .env không tồn tại!"
    exit 1
fi

# Variables
DOCKER_REGISTRY=${DOCKER_REGISTRY:-"localhost:5000"}
APP_VERSION=${APP_VERSION:-"latest"}
PROJECT_ROOT=$(pwd)

echo ""
echo -e "${BLUE}Thông tin build:${NC}"
echo "  Registry: $DOCKER_REGISTRY"
echo "  Version: $APP_VERSION"
echo "  Project Root: $PROJECT_ROOT"
echo ""

# =============================================================================
# Function: Build and tag image
# =============================================================================
build_and_tag() {
    local service_name=$1
    local service_path=$2
    local image_name="${DOCKER_REGISTRY}/jbcalling-${service_name}:${APP_VERSION}"
    
    echo ""
    echo -e "${YELLOW}📦 Building ${service_name}...${NC}"
    echo "  Path: ${service_path}"
    echo "  Image: ${image_name}"
    
    cd "${PROJECT_ROOT}/${service_path}"
    
    docker build -t "${image_name}" .
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Build ${service_name} thành công${NC}"
        
        # Also tag as latest
        docker tag "${image_name}" "${DOCKER_REGISTRY}/jbcalling-${service_name}:latest"
        
        return 0
    else
        echo -e "❌ Build ${service_name} thất bại"
        return 1
    fi
}

# =============================================================================
# Function: Push image to registry
# =============================================================================
push_image() {
    local service_name=$1
    local image_name="${DOCKER_REGISTRY}/jbcalling-${service_name}:${APP_VERSION}"
    
    echo ""
    echo -e "${YELLOW}📤 Pushing ${service_name}...${NC}"
    
    docker push "${image_name}"
    docker push "${DOCKER_REGISTRY}/jbcalling-${service_name}:latest"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Push ${service_name} thành công${NC}"
        return 0
    else
        echo -e "❌ Push ${service_name} thất bại"
        return 1
    fi
}

# =============================================================================
# Main Build Process
# =============================================================================

echo ""
echo "Bắt đầu build các services..."
echo ""

# Build API Service
build_and_tag "api" "services/api"
API_BUILD=$?

# Build Frontend
build_and_tag "frontend" "services/frontend"
FRONTEND_BUILD=$?

# =============================================================================
# Summary
# =============================================================================

echo ""
echo "========================================"
echo "📊 BUILD SUMMARY"
echo "========================================"

if [ $API_BUILD -eq 0 ]; then
    echo -e "${GREEN}✅ API Service: Success${NC}"
else
    echo -e "❌ API Service: Failed"
fi

if [ $FRONTEND_BUILD -eq 0 ]; then
    echo -e "${GREEN}✅ Frontend: Success${NC}"
else
    echo -e "❌ Frontend: Failed"
fi

echo ""

# Check if all builds succeeded
if [ $API_BUILD -eq 0 ] && [ $FRONTEND_BUILD -eq 0 ]; then
    echo -e "${GREEN}✅ Tất cả services đã build thành công${NC}"
    
    # Push images (nếu cần - comment out nếu không dùng registry)
    echo ""
    read -p "Push images lên registry? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        push_image "api"
        push_image "frontend"
        echo ""
        echo -e "${GREEN}✅ Tất cả images đã được push lên registry${NC}"
    fi
    
    echo ""
    echo "Next steps:"
    echo "  1. Chạy script 02-deploy-phase2-services.sh để deploy lên Swarm"
    echo "  2. Hoặc deploy thủ công: docker stack deploy -c infrastructure/swarm/stack.yml translation"
    exit 0
else
    echo -e "❌ Một số services build thất bại. Vui lòng kiểm tra lỗi ở trên."
    exit 1
fi
