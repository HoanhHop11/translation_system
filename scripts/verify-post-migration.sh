#!/bin/bash

# =============================================================================
# POST-MIGRATION VERIFICATION SCRIPT
# =============================================================================
# Script kiểm tra hệ thống sau khi migration IP
# Date: October 6, 2025
# Author: GitHub Copilot Agent
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables
if [ -f .env ]; then
    source .env
else
    echo -e "${RED}❌ File .env không tồn tại!${NC}"
    exit 1
fi

echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     POST-MIGRATION VERIFICATION - IP MIGRATION OCT 6         ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

# =============================================================================
# 1. VERIFY NEW IPs
# =============================================================================
echo -e "${BLUE}📍 Step 1: Verifying New IPs from .env${NC}"
echo ""

echo "Instance 1 (translation01):"
echo "  - External IP: $INSTANCE_01_IP"
echo "  - Internal IP: $INSTANCE_01_INTERNAL_IP"
echo "  - Zone: $INSTANCE_01_ZONE"
echo ""

echo "Instance 2 (translation02):"
echo "  - External IP: $INSTANCE_02_IP"
echo "  - Internal IP: $INSTANCE_02_INTERNAL_IP"
echo "  - Zone: $INSTANCE_02_ZONE"
echo ""

echo "Instance 3 (translation03):"
echo "  - External IP: $INSTANCE_03_IP"
echo "  - Internal IP: $INSTANCE_03_INTERNAL_IP"
echo "  - Zone: $INSTANCE_03_ZONE"
echo ""

echo "Swarm Manager IP: $SWARM_MANAGER_IP"
echo ""

# =============================================================================
# 2. PING TEST
# =============================================================================
echo -e "${BLUE}🏓 Step 2: Ping Test - Instance Connectivity${NC}"
echo ""

ping_test() {
    local name=$1
    local ip=$2
    
    if ping -c 3 -W 2 $ip > /dev/null 2>&1; then
        echo -e "  ${GREEN}✅ $name ($ip) - REACHABLE${NC}"
        return 0
    else
        echo -e "  ${RED}❌ $name ($ip) - NOT REACHABLE${NC}"
        return 1
    fi
}

ping_test "translation01" "$INSTANCE_01_IP"
ping_test "translation02" "$INSTANCE_02_IP"
ping_test "translation03" "$INSTANCE_03_IP"
echo ""

# =============================================================================
# 3. DNS VERIFICATION
# =============================================================================
echo -e "${BLUE}🌐 Step 3: DNS Resolution Check${NC}"
echo ""

check_dns() {
    local domain=$1
    local expected_ip=$2
    
    echo -n "  Checking $domain... "
    
    # Try nslookup first
    resolved_ip=$(nslookup $domain 8.8.8.8 2>/dev/null | grep -A1 "Name:" | tail -1 | awk '{print $2}')
    
    if [ -z "$resolved_ip" ]; then
        # Fallback to dig
        resolved_ip=$(dig +short $domain @8.8.8.8 | head -1)
    fi
    
    if [ "$resolved_ip" = "$expected_ip" ]; then
        echo -e "${GREEN}✅ OK ($resolved_ip)${NC}"
        return 0
    else
        echo -e "${YELLOW}⚠️  Points to: $resolved_ip (Expected: $expected_ip)${NC}"
        return 1
    fi
}

# Check all domains
check_dns "$DOMAIN_NAME" "$SWARM_MANAGER_IP"
check_dns "www.$DOMAIN_NAME" "$SWARM_MANAGER_IP"
check_dns "api.$DOMAIN_NAME" "$SWARM_MANAGER_IP"
check_dns "webrtc.$DOMAIN_NAME" "$SWARM_MANAGER_IP"
check_dns "monitoring.$DOMAIN_NAME" "$SWARM_MANAGER_IP"
check_dns "traefik.$DOMAIN_NAME" "$SWARM_MANAGER_IP"
echo ""

# =============================================================================
# 4. GCP INSTANCES STATUS
# =============================================================================
echo -e "${BLUE}☁️  Step 4: Google Cloud Instances Status${NC}"
echo ""

if command -v gcloud &> /dev/null; then
    echo "Fetching instances from Google Cloud..."
    gcloud compute instances list --filter="name~'translation'" \
        --format="table(name,zone,status,networkInterfaces[0].accessConfigs[0].natIP,networkInterfaces[0].networkIP)" \
        2>/dev/null || echo -e "${YELLOW}⚠️  gcloud command failed or not authenticated${NC}"
else
    echo -e "${YELLOW}⚠️  gcloud CLI not installed - skipping GCP check${NC}"
fi
echo ""

# =============================================================================
# 5. HTTPS ENDPOINTS CHECK
# =============================================================================
echo -e "${BLUE}🔒 Step 5: HTTPS Endpoints Verification${NC}"
echo ""

check_https() {
    local name=$1
    local url=$2
    
    echo -n "  $name... "
    
    status_code=$(curl -k -s -o /dev/null -w "%{http_code}" --max-time 10 "$url" 2>/dev/null || echo "000")
    
    if [ "$status_code" = "200" ] || [ "$status_code" = "301" ] || [ "$status_code" = "302" ]; then
        echo -e "${GREEN}✅ $status_code${NC}"
        return 0
    elif [ "$status_code" = "000" ]; then
        echo -e "${RED}❌ TIMEOUT/UNREACHABLE${NC}"
        return 1
    else
        echo -e "${YELLOW}⚠️  $status_code${NC}"
        return 1
    fi
}

check_https "Frontend" "https://$DOMAIN_NAME"
check_https "API Gateway" "https://api.$DOMAIN_NAME"
check_https "API Health" "https://api.$DOMAIN_NAME/api/v1/health"
check_https "Monitoring" "https://monitoring.$DOMAIN_NAME"
check_https "Traefik Dashboard" "https://traefik.$DOMAIN_NAME"
echo ""

# =============================================================================
# 6. DOCKER SWARM STATUS (Optional - requires SSH)
# =============================================================================
echo -e "${BLUE}🐳 Step 6: Docker Swarm Status (Optional)${NC}"
echo ""
echo "To check Docker Swarm, run these commands manually:"
echo ""
echo -e "${YELLOW}gcloud compute ssh $INSTANCE_02_HOSTNAME --zone=$INSTANCE_02_ZONE --command='docker node ls'${NC}"
echo -e "${YELLOW}gcloud compute ssh $INSTANCE_02_HOSTNAME --zone=$INSTANCE_02_ZONE --command='docker service ls'${NC}"
echo ""

# =============================================================================
# 7. API ENDPOINTS TEST
# =============================================================================
echo -e "${BLUE}🔌 Step 7: API Endpoints Functional Test${NC}"
echo ""

test_api_endpoint() {
    local name=$1
    local url=$2
    local expected_status=$3
    
    echo -n "  Testing $name... "
    
    response=$(curl -k -s -w "\n%{http_code}" --max-time 10 "$url" 2>/dev/null || echo -e "\n000")
    status_code=$(echo "$response" | tail -1)
    body=$(echo "$response" | head -n -1)
    
    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ $status_code${NC}"
        if [ ! -z "$body" ] && [ "$body" != "000" ]; then
            echo "     Response: $(echo $body | head -c 80)..."
        fi
        return 0
    else
        echo -e "${RED}❌ $status_code (Expected: $expected_status)${NC}"
        return 1
    fi
}

test_api_endpoint "API Health" "https://api.$DOMAIN_NAME/api/v1/health" "200"
test_api_endpoint "STT Health" "https://api.$DOMAIN_NAME/api/v1/stt/health" "200"
test_api_endpoint "Translation Health" "https://api.$DOMAIN_NAME/api/v1/translation/health" "200"
echo ""

# =============================================================================
# 8. SUMMARY
# =============================================================================
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║                      VERIFICATION SUMMARY                      ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}✅ Completed Checks:${NC}"
echo "  - .env file validation"
echo "  - Instance IP verification"
echo "  - Ping connectivity tests"
echo "  - DNS resolution checks"
echo "  - HTTPS endpoints verification"
echo "  - API health checks"
echo ""
echo -e "${YELLOW}⏳ Manual Checks Required:${NC}"
echo "  - Docker Swarm cluster status (see Step 6 commands)"
echo "  - Service replicas verification"
echo "  - SSL certificate validation"
echo "  - WebRTC signaling test"
echo "  - Full end-to-end user flow"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo "  1. If DNS not updated: Update DNS records at your provider"
echo "  2. Verify Docker Swarm: Run commands from Step 6"
echo "  3. Restart services if needed: docker stack deploy ..."
echo "  4. Monitor Grafana: https://monitoring.$DOMAIN_NAME"
echo "  5. Test full application: https://$DOMAIN_NAME"
echo ""
echo -e "${GREEN}✅ Post-Migration Verification Complete!${NC}"
echo ""

# =============================================================================
# 9. GENERATE REPORT
# =============================================================================
REPORT_FILE="post-migration-verification-$(date +%Y%m%d-%H%M%S).log"
echo "Saving report to: $REPORT_FILE"

{
    echo "================================================"
    echo "POST-MIGRATION VERIFICATION REPORT"
    echo "Date: $(date)"
    echo "================================================"
    echo ""
    echo "NEW IPs:"
    echo "  translation01: $INSTANCE_01_IP (Internal: $INSTANCE_01_INTERNAL_IP)"
    echo "  translation02: $INSTANCE_02_IP (Internal: $INSTANCE_02_INTERNAL_IP)"
    echo "  translation03: $INSTANCE_03_IP (Internal: $INSTANCE_03_INTERNAL_IP)"
    echo "  Swarm Manager: $SWARM_MANAGER_IP"
    echo ""
    echo "DOMAINS:"
    echo "  $DOMAIN_NAME → $SWARM_MANAGER_IP"
    echo "  api.$DOMAIN_NAME → $SWARM_MANAGER_IP"
    echo "  webrtc.$DOMAIN_NAME → $SWARM_MANAGER_IP"
    echo "  monitoring.$DOMAIN_NAME → $SWARM_MANAGER_IP"
    echo ""
    echo "This report was generated by: scripts/verify-post-migration.sh"
    echo "================================================"
} > "$REPORT_FILE"

echo -e "${GREEN}Report saved: $REPORT_FILE${NC}"
echo ""

exit 0
