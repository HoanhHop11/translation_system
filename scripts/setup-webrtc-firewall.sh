#!/bin/bash

# ==============================================================================
# WEBRTC FIREWALL SETUP - Google Cloud
# ==============================================================================
# Script này mở firewall rules BẮT BUỘC cho MediaSoup WebRTC Gateway
# 
# Requirements:
# - gcloud CLI installed and authenticated
# - Permissions: Compute Security Admin role
# 
# Usage:
#   ./setup-webrtc-firewall.sh
# ==============================================================================

set -e

echo "🔥 WEBRTC FIREWALL SETUP - Starting..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID=$(gcloud config get-value project 2>/dev/null)
NETWORK="default"
TRANSLATION02_TAG="translation02"
TRANSLATION02_IP="34.142.190.250"

echo "📋 Configuration:"
echo "   Project: $PROJECT_ID"
echo "   Network: $NETWORK"
echo "   Target: $TRANSLATION02_TAG"
echo "   Gateway IP: $TRANSLATION02_IP"
echo ""

# ==============================================================================
# 1. WEBRTC UDP PORTS (40000-40100) - CRITICAL
# ==============================================================================
echo "🚀 Creating WebRTC UDP firewall rule..."

if gcloud compute firewall-rules describe allow-webrtc-udp &>/dev/null; then
    echo -e "${YELLOW}⚠️  Rule 'allow-webrtc-udp' already exists, updating...${NC}"
    gcloud compute firewall-rules update allow-webrtc-udp \
        --allow=udp:40000-40100 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=$TRANSLATION02_TAG \
        --description="WebRTC UDP RTP ports for MediaSoup Gateway (40000-40100)"
else
    gcloud compute firewall-rules create allow-webrtc-udp \
        --network=$NETWORK \
        --allow=udp:40000-40100 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=$TRANSLATION02_TAG \
        --description="WebRTC UDP RTP ports for MediaSoup Gateway (40000-40100)" \
        --priority=1000
    
    echo -e "${GREEN}✅ Created: allow-webrtc-udp (UDP 40000-40100)${NC}"
fi

# ==============================================================================
# 2. WEBRTC TCP PORTS (40000-40100) - FALLBACK
# ==============================================================================
echo "🔌 Creating WebRTC TCP firewall rule (fallback)..."

if gcloud compute firewall-rules describe allow-webrtc-tcp &>/dev/null; then
    echo -e "${YELLOW}⚠️  Rule 'allow-webrtc-tcp' already exists, updating...${NC}"
    gcloud compute firewall-rules update allow-webrtc-tcp \
        --allow=tcp:40000-40100 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=$TRANSLATION02_TAG \
        --description="WebRTC TCP fallback ports for MediaSoup Gateway (40000-40100)"
else
    gcloud compute firewall-rules create allow-webrtc-tcp \
        --network=$NETWORK \
        --allow=tcp:40000-40100 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=$TRANSLATION02_TAG \
        --description="WebRTC TCP fallback ports for MediaSoup Gateway (40000-40100)" \
        --priority=1000
    
    echo -e "${GREEN}✅ Created: allow-webrtc-tcp (TCP 40000-40100)${NC}"
fi

# ==============================================================================
# 3. GATEWAY HTTP PORT (3000) - Optional (nếu cần direct access)
# ==============================================================================
echo "🌐 Creating Gateway HTTP port rule (optional)..."

if gcloud compute firewall-rules describe allow-gateway-http &>/dev/null; then
    echo -e "${YELLOW}⚠️  Rule 'allow-gateway-http' already exists, skipping...${NC}"
else
    gcloud compute firewall-rules create allow-gateway-http \
        --network=$NETWORK \
        --allow=tcp:3000 \
        --source-ranges=0.0.0.0/0 \
        --target-tags=$TRANSLATION02_TAG \
        --description="Gateway HTTP port for health checks and debugging" \
        --priority=1000
    
    echo -e "${GREEN}✅ Created: allow-gateway-http (TCP 3000)${NC}"
fi

# ==============================================================================
# 4. APPLY NETWORK TAG TO TRANSLATION02
# ==============================================================================
echo ""
echo "🏷️  Applying network tag to translation02 instance..."

# Get current zone
ZONE=$(gcloud compute instances list --filter="name=translation02" --format="get(zone)" | awk -F/ '{print $NF}')

if [ -z "$ZONE" ]; then
    echo -e "${RED}❌ ERROR: Cannot find translation02 instance${NC}"
    exit 1
fi

echo "   Instance: translation02"
echo "   Zone: $ZONE"

# Get current tags
CURRENT_TAGS=$(gcloud compute instances describe translation02 --zone=$ZONE --format="value(tags.items)" | tr ';' ',')

echo "   Current tags: ${CURRENT_TAGS:-none}"

# Add translation02 tag if not exists
if [[ "$CURRENT_TAGS" == *"$TRANSLATION02_TAG"* ]]; then
    echo -e "${YELLOW}⚠️  Tag '$TRANSLATION02_TAG' already exists on translation02${NC}"
else
    if [ -z "$CURRENT_TAGS" ]; then
        NEW_TAGS="$TRANSLATION02_TAG"
    else
        NEW_TAGS="$CURRENT_TAGS,$TRANSLATION02_TAG"
    fi
    
    gcloud compute instances add-tags translation02 \
        --zone=$ZONE \
        --tags=$TRANSLATION02_TAG
    
    echo -e "${GREEN}✅ Applied tag: $TRANSLATION02_TAG${NC}"
fi

# ==============================================================================
# 5. VERIFICATION
# ==============================================================================
echo ""
echo "🔍 Verifying firewall rules..."
echo ""

gcloud compute firewall-rules list \
    --filter="name:(allow-webrtc-udp OR allow-webrtc-tcp OR allow-gateway-http)" \
    --format="table(
        name,
        network,
        direction,
        priority,
        sourceRanges.list():label=SRC_RANGES,
        allowed[].map().firewall_rule().list():label=ALLOW,
        targetTags.list():label=TARGET_TAGS
    )"

echo ""
echo "📊 WebRTC Port Summary:"
echo "   UDP 40000-40100: RTP media streaming (CRITICAL)"
echo "   TCP 40000-40100: RTP fallback when UDP blocked"
echo "   TCP 3000:        Gateway health checks"
echo ""

# ==============================================================================
# 6. TEST CONNECTIVITY
# ==============================================================================
echo "🧪 Testing connectivity from external..."
echo ""

# Test HTTP health endpoint
echo "Testing Gateway health endpoint..."
if curl -s -m 5 "http://$TRANSLATION02_IP:3000/health" >/dev/null 2>&1; then
    echo -e "${GREEN}✅ Gateway HTTP accessible (port 3000)${NC}"
else
    echo -e "${YELLOW}⚠️  Gateway HTTP not accessible (might be normal if behind Traefik)${NC}"
fi

# Note about UDP testing
echo ""
echo -e "${YELLOW}ℹ️  UDP ports cannot be tested from shell, test via WebRTC client${NC}"
echo ""

# ==============================================================================
# COMPLETION
# ==============================================================================
echo "=================================="
echo -e "${GREEN}✅ WEBRTC FIREWALL SETUP COMPLETE${NC}"
echo "=================================="
echo ""
echo "📝 Next Steps:"
echo "   1. Deploy Gateway service với stack-optimized.yml"
echo "   2. Test WebRTC connection từ browser:"
echo "      - Open: https://webrtc.jbcalling.site"
echo "      - Check console for ICE candidates"
echo "      - Verify 'srflx' candidates (UDP working)"
echo ""
echo "🔍 Troubleshooting:"
echo "   - If WebRTC fails, check browser console for:"
echo "     * 'ICE connection failed'"
echo "     * 'No STUN/TURN candidates'"
echo "   - Verify ANNOUNCED_IP=$TRANSLATION02_IP in Gateway env"
echo "   - Check Gateway logs: docker service logs translation_gateway"
echo ""
echo "📚 References:"
echo "   - MediaSoup docs: https://mediasoup.org/documentation/v3/"
echo "   - WebRTC troubleshooting: https://webrtc.github.io/samples/"
echo ""
