#!/bin/bash
# IPv6 Test Script - WebRTC Gateway
# Usage: ./test-ipv6.sh [ipv6_address]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Parse arguments
IPV6_ADDRESS="${1:-}"

if [ -z "$IPV6_ADDRESS" ]; then
  echo -e "${RED}❌ Error: IPv6 address required${NC}"
  echo "Usage: $0 <ipv6_address>"
  echo "Example: $0 2600:1900:4020:1234::1"
  exit 1
fi

echo "🧪 Testing IPv6 connectivity for: $IPV6_ADDRESS"
echo "================================================"
echo ""

# Test 1: Ping6
echo -e "${YELLOW}Test 1: ICMPv6 Ping${NC}"
if ping6 -c 3 "$IPV6_ADDRESS" > /dev/null 2>&1; then
  echo -e "${GREEN}✅ PASS: ICMPv6 ping successful${NC}"
else
  echo -e "${RED}❌ FAIL: ICMPv6 ping failed${NC}"
  echo "  → Check: VM có IPv6 interface không?"
  echo "  → Check: Firewall có allow ICMPv6 không?"
fi
echo ""

# Test 2: HTTP/HTTPS (Port 443)
echo -e "${YELLOW}Test 2: HTTPS Connectivity (Port 443)${NC}"
if timeout 5 bash -c "echo > /dev/tcp/$IPV6_ADDRESS/443" 2>/dev/null; then
  echo -e "${GREEN}✅ PASS: TCP port 443 open${NC}"
else
  echo -e "${RED}❌ FAIL: TCP port 443 not reachable${NC}"
  echo "  → Check: Firewall rule 'allow-gateway-https-ipv6' exists?"
  echo "  → Check: Gateway service đang chạy?"
fi
echo ""

# Test 3: WebRTC Media Port (UDP 40000)
echo -e "${YELLOW}Test 3: WebRTC UDP Port (40000)${NC}"
# Note: UDP test khó hơn vì không có handshake
if command -v nc >/dev/null 2>&1; then
  if timeout 2 nc -6 -u -z "$IPV6_ADDRESS" 40000 2>/dev/null; then
    echo -e "${GREEN}✅ PASS: UDP port 40000 accessible${NC}"
  else
    echo -e "${YELLOW}⚠️  WARNING: Cannot verify UDP port (normal behavior)${NC}"
    echo "  → UDP requires active connection to test"
    echo "  → Will test during actual WebRTC call"
  fi
else
  echo -e "${YELLOW}⚠️  SKIP: netcat not available${NC}"
fi
echo ""

# Test 4: DNS Resolution
echo -e "${YELLOW}Test 4: DNS AAAA Record${NC}"
DOMAIN="webrtc.jbcalling.site"
if command -v dig >/dev/null 2>&1; then
  RESOLVED_IPV6=$(dig AAAA "$DOMAIN" +short | head -1)
  if [ -n "$RESOLVED_IPV6" ]; then
    echo -e "${GREEN}✅ PASS: AAAA record found${NC}"
    echo "  Domain: $DOMAIN"
    echo "  Resolves to: $RESOLVED_IPV6"
    
    if [ "$RESOLVED_IPV6" = "$IPV6_ADDRESS" ]; then
      echo -e "${GREEN}  ✓ Matches target IPv6${NC}"
    else
      echo -e "${YELLOW}  ⚠️  DNS points to different IPv6${NC}"
    fi
  else
    echo -e "${RED}❌ FAIL: No AAAA record found${NC}"
    echo "  → Add DNS AAAA record for $DOMAIN"
  fi
else
  echo -e "${YELLOW}⚠️  SKIP: dig not available${NC}"
fi
echo ""

# Test 5: Gateway Service Status
echo -e "${YELLOW}Test 5: Gateway Service Status${NC}"
if command -v ssh >/dev/null 2>&1; then
  GATEWAY_LOGS=$(ssh translation01 'docker service logs translation_gateway --tail 20 2>&1 | grep -i "ipv6\|listening\|::"' || true)
  
  if echo "$GATEWAY_LOGS" | grep -q "::"; then
    echo -e "${GREEN}✅ PASS: Gateway listening on IPv6${NC}"
    echo "  Sample logs:"
    echo "$GATEWAY_LOGS" | head -3 | sed 's/^/  /'
  else
    echo -e "${RED}❌ FAIL: Gateway not listening on IPv6${NC}"
    echo "  → Check: ENABLE_IPV6=true in stack-hybrid.yml?"
    echo "  → Check: ANNOUNCED_IPV6 env var set?"
  fi
else
  echo -e "${YELLOW}⚠️  SKIP: SSH not available${NC}"
fi
echo ""

# Summary
echo "================================================"
echo -e "${YELLOW}📊 Test Summary${NC}"
echo "================================================"
echo "Target IPv6: $IPV6_ADDRESS"
echo ""
echo "Next steps:"
echo "1. If tests pass: Update DNS AAAA record (if not done)"
echo "2. Deploy Gateway with IPv6 enabled"
echo "3. Test E2E WebRTC call from IPv6 client"
echo "4. Monitor: ssh translation01 'docker service logs translation_gateway --follow'"
echo ""
echo "Troubleshooting:"
echo "- Check VM IPv6: ssh translation01 'ip -6 addr show'"
echo "- Check firewall: gcloud compute firewall-rules list --filter=sourceRanges::/0"
echo "- Test from online tool: https://ipv6.chappell-family.com/ipv6tcptest/"
