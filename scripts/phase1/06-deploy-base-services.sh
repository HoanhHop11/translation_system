#!/bin/bash
# =============================================================================
# Script: Deploy các base services (PostgreSQL, Redis)
# Phase: 1 - Infrastructure Setup
# Chạy trên: translation01 (Manager Node)
# Date: October 5, 2025
# =============================================================================

set -e

echo "======================================"
echo "🚀 DEPLOY BASE SERVICES"
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

echo "🗄️  Deploying PostgreSQL..."

docker service create \
  --name postgres \
  --network backend \
  --secret postgres_password \
  --secret postgres_user \
  --secret postgres_db \
  --env POSTGRES_PASSWORD_FILE=/run/secrets/postgres_password \
  --env POSTGRES_USER_FILE=/run/secrets/postgres_user \
  --env POSTGRES_DB_FILE=/run/secrets/postgres_db \
  --mount type=volume,source=postgres_data,target=/var/lib/postgresql/data \
  --constraint 'node.labels.role==manager' \
  --replicas 1 \
  --limit-memory 2G \
  --limit-cpu 2 \
  --reserve-memory 1G \
  --reserve-cpu 1 \
  postgres:15-alpine

echo -e "${GREEN}✅ PostgreSQL deployed${NC}"

echo ""
echo "🗃️  Deploying Redis..."

docker service create \
  --name redis \
  --network backend \
  --secret redis_password \
  --env REDIS_PASSWORD_FILE=/run/secrets/redis_password \
  --mount type=volume,source=redis_data,target=/data \
  --constraint 'node.labels.role==manager' \
  --replicas 1 \
  --limit-memory 1G \
  --limit-cpu 1 \
  --reserve-memory 512M \
  --reserve-cpu 0.5 \
  redis:7-alpine \
  sh -c 'redis-server --requirepass $(cat /run/secrets/redis_password) --appendonly yes'

echo -e "${GREEN}✅ Redis deployed${NC}"

echo ""
echo "⏳ Đợi services khởi động (30 giây)..."
sleep 30

echo ""
echo "📋 Trạng thái services:"
docker service ls

echo ""
echo "======================================"
echo -e "${GREEN}✅ BASE SERVICES ĐÃ ĐƯỢC DEPLOY!${NC}"
echo "======================================"
echo ""
echo "📝 Kiểm tra logs:"
echo "  docker service logs postgres"
echo "  docker service logs redis"
echo ""
