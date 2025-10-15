#!/bin/bash
# =============================================================================
# Script: Verify Phase 1 Deployment
# Phase: 1 - Infrastructure Setup
# Chạy trên: translation01 (Manager Node)
# Date: October 5, 2025
# =============================================================================

set -e

echo "======================================"
echo "✅ VERIFY PHASE 1 DEPLOYMENT"
echo "======================================"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

PASSED=0
FAILED=0

# Function để check
check_test() {
    local test_name=$1
    local test_command=$2
    
    echo ""
    echo -e "${BLUE}🔍 Testing: $test_name${NC}"
    
    if eval "$test_command" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ PASS${NC}"
        ((PASSED++))
        return 0
    else
        echo -e "${RED}❌ FAIL${NC}"
        ((FAILED++))
        return 1
    fi
}

echo ""
echo "=" $(date) "="

# Test 1: Docker installed
check_test "Docker Installation" "docker --version"

# Test 2: Swarm active
check_test "Swarm Active" "docker info | grep -q 'Swarm: active'"

# Test 3: Manager node
check_test "Manager Node" "docker info | grep -q 'Is Manager: true'"

# Test 4: Number of nodes
NODE_COUNT=$(docker node ls -q | wc -l)
echo ""
echo -e "${BLUE}🔍 Testing: Node Count${NC}"
if [ "$NODE_COUNT" -eq 3 ]; then
    echo -e "${GREEN}✅ PASS (3 nodes)${NC}"
    ((PASSED++))
else
    echo -e "${YELLOW}⚠️  PARTIAL (Found: $NODE_COUNT nodes, Expected: 3)${NC}"
fi

# Test 5: Networks
check_test "Backend Network" "docker network ls | grep -q backend"
check_test "Frontend Network" "docker network ls | grep -q frontend"
check_test "Monitoring Network" "docker network ls | grep -q monitoring"

# Test 6: Secrets
check_test "Postgres Password Secret" "docker secret ls | grep -q postgres_password"
check_test "Redis Password Secret" "docker secret ls | grep -q redis_password"
check_test "JWT Secret" "docker secret ls | grep -q jwt_secret_key"
check_test "HF Token Secret" "docker secret ls | grep -q hf_token"

# Test 7: Services
echo ""
echo -e "${BLUE}🔍 Testing: Services${NC}"
if docker service ls | grep -q postgres; then
    POSTGRES_REPLICAS=$(docker service ls --format "{{.Name}} {{.Replicas}}" | grep postgres | awk '{print $2}')
    if [ "$POSTGRES_REPLICAS" = "1/1" ]; then
        echo -e "${GREEN}✅ PostgreSQL: Running ($POSTGRES_REPLICAS)${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠️  PostgreSQL: Starting ($POSTGRES_REPLICAS)${NC}"
    fi
else
    echo -e "${RED}❌ PostgreSQL: Not deployed${NC}"
    ((FAILED++))
fi

if docker service ls | grep -q redis; then
    REDIS_REPLICAS=$(docker service ls --format "{{.Name}} {{.Replicas}}" | grep redis | awk '{print $2}')
    if [ "$REDIS_REPLICAS" = "1/1" ]; then
        echo -e "${GREEN}✅ Redis: Running ($REDIS_REPLICAS)${NC}"
        ((PASSED++))
    else
        echo -e "${YELLOW}⚠️  Redis: Starting ($REDIS_REPLICAS)${NC}"
    fi
else
    echo -e "${RED}❌ Redis: Not deployed${NC}"
    ((FAILED++))
fi

# Test 8: Node Labels
echo ""
echo -e "${BLUE}🔍 Testing: Node Labels${NC}"
LABELED_NODES=$(docker node ls -q | while read node; do
    docker node inspect --format '{{.Spec.Labels.name}}' "$node" 2>/dev/null
done | grep -c "translation" || true)

if [ "$LABELED_NODES" -ge 1 ]; then
    echo -e "${GREEN}✅ Node labels configured ($LABELED_NODES nodes)${NC}"
    ((PASSED++))
else
    echo -e "${RED}❌ No node labels found${NC}"
    ((FAILED++))
fi

# Summary
echo ""
echo "======================================"
echo "📊 TEST SUMMARY"
echo "======================================"
echo -e "${GREEN}✅ Passed: $PASSED${NC}"
echo -e "${RED}❌ Failed: $FAILED${NC}"
echo ""

if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}🎉 PHASE 1 HOÀN TẤT THÀNH CÔNG!${NC}"
    echo ""
    echo "📝 BƯỚC TIẾP THEO:"
    echo "1. Review các services: docker service ls"
    echo "2. Check logs: docker service logs postgres"
    echo "3. Sẵn sàng cho Phase 2: Core Services"
    exit 0
else
    echo -e "${YELLOW}⚠️  PHASE 1 CÒN MỘT SỐ VẤN ĐỀ${NC}"
    echo ""
    echo "📝 KHẮC PHỤC:"
    echo "1. Xem lại các test failed"
    echo "2. Check logs: docker service logs <service_name>"
    echo "3. Rerun failed scripts"
    exit 1
fi
