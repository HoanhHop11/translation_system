#!/bin/bash
# =============================================================================
# Script: Tạo Docker Secrets từ .env file
# Phase: 1 - Infrastructure Setup
# Chạy trên: translation01 (Manager Node)
# Date: October 5, 2025
# =============================================================================

set -e

echo "======================================"
echo "🔒 TẠO DOCKER SECRETS"
echo "======================================"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Kiểm tra xem có phải manager không
if ! docker info 2>/dev/null | grep -q "Is Manager: true"; then
    echo -e "${RED}❌ Script này chỉ chạy trên Manager Node!${NC}"
    exit 1
fi

# Kiểm tra .env file
ENV_FILE="$HOME/jbcalling_translation_realtime/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}❌ Không tìm thấy file .env tại: $ENV_FILE${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Tìm thấy file .env${NC}"
echo ""

# Load .env file
set -a
source "$ENV_FILE"
set +a

# Function để tạo secret an toàn
create_secret() {
    local secret_name=$1
    local secret_value=$2
    
    if [ -z "$secret_value" ]; then
        echo -e "${RED}❌ $secret_name: Giá trị trống!${NC}"
        return 1
    fi
    
    # Kiểm tra xem secret đã tồn tại chưa
    if docker secret ls --format '{{.Name}}' | grep -q "^${secret_name}$"; then
        echo -e "${YELLOW}⚠️  $secret_name: Đã tồn tại, bỏ qua${NC}"
        return 0
    fi
    
    # Tạo secret
    echo -n "$secret_value" | docker secret create "$secret_name" -
    echo -e "${GREEN}✅ $secret_name: Đã tạo${NC}"
}

echo "🔒 Đang tạo secrets..."
echo ""

# Database secrets
create_secret "postgres_password" "$POSTGRES_PASSWORD"
create_secret "postgres_db" "$POSTGRES_DB"
create_secret "postgres_user" "$POSTGRES_USER"

# Redis secret
create_secret "redis_password" "$REDIS_PASSWORD"

# JWT và Security secrets
create_secret "jwt_secret_key" "$JWT_SECRET_KEY"
create_secret "session_secret_key" "$SESSION_SECRET_KEY"
create_secret "encryption_key" "$ENCRYPTION_KEY"

# API Keys
create_secret "hf_token" "$HF_TOKEN"

# Grafana
create_secret "grafana_admin_password" "$GRAFANA_ADMIN_PASSWORD"

echo ""
echo "📋 Danh sách secrets đã tạo:"
docker secret ls

echo ""
echo "======================================"
echo -e "${GREEN}✅ DOCKER SECRETS ĐÃ ĐƯỢC TẠO!${NC}"
echo "======================================"
echo ""
echo "📝 Lưu ý:"
echo "- Secrets chỉ có thể đọc bởi các services được gán"
echo "- Không thể xem lại giá trị của secrets"
echo "- Để cập nhật secret, phải xóa và tạo lại"
echo ""
