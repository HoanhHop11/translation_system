#!/bin/bash
# GCP IPv6 Setup Script - Automated configuration cho WebRTC Gateway
# Usage: ./setup-ipv6-gcp.sh [--dry-run]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
PROJECT_ID="your-gcp-project-id"  # ⚠️ UPDATE THIS
REGION="asia-southeast1"
ZONE="asia-southeast1-b"
INSTANCE_NAME="translation01"
SUBNET_NAME="default"
NETWORK_NAME="default"

# Parse arguments
DRY_RUN=false
if [ "$1" = "--dry-run" ]; then
  DRY_RUN=true
  echo -e "${YELLOW}🔍 DRY RUN MODE - No changes will be made${NC}"
  echo ""
fi

# Helper functions
run_cmd() {
  local cmd="$1"
  local description="$2"
  
  echo -e "${BLUE}→ $description${NC}"
  
  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would execute: $cmd"
    return 0
  fi
  
  if eval "$cmd"; then
    echo -e "${GREEN}  ✓ Success${NC}"
    return 0
  else
    echo -e "${RED}  ✗ Failed${NC}"
    return 1
  fi
}

echo "=========================================="
echo "🌐 GCP IPv6 Setup for WebRTC Gateway"
echo "=========================================="
echo ""
echo "Configuration:"
echo "  Project: $PROJECT_ID"
echo "  Region: $REGION"
echo "  Zone: $ZONE"
echo "  Instance: $INSTANCE_NAME"
echo ""

# Check gcloud is installed
if ! command -v gcloud >/dev/null 2>&1; then
  echo -e "${RED}❌ Error: gcloud CLI not found${NC}"
  echo "Install: https://cloud.google.com/sdk/install"
  exit 1
fi

# Check authentication
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q "@"; then
  echo -e "${RED}❌ Error: Not authenticated with gcloud${NC}"
  echo "Run: gcloud auth login"
  exit 1
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo ""

# Phase 1: Enable IPv6 for Subnet
echo "=========================================="
echo "📋 Phase 1: Subnet Configuration"
echo "=========================================="
echo ""

# Check current subnet configuration
echo "Checking current subnet configuration..."
CURRENT_STACK_TYPE=$(gcloud compute networks subnets describe "$SUBNET_NAME" \
  --region="$REGION" \
  --format="value(stackType)" 2>/dev/null || echo "NOT_FOUND")

echo "Current stack type: $CURRENT_STACK_TYPE"

if [ "$CURRENT_STACK_TYPE" = "IPV4_IPV6" ]; then
  echo -e "${GREEN}✓ Subnet already has IPv6 enabled${NC}"
else
  echo -e "${YELLOW}⚠️  Subnet is IPv4-only, enabling IPv6...${NC}"
  
  run_cmd \
    "gcloud compute networks subnets update '$SUBNET_NAME' \
      --region='$REGION' \
      --stack-type=IPV4_IPV6 \
      --ipv6-access-type=EXTERNAL" \
    "Enable IPv6 for subnet"
fi
echo ""

# Phase 2: Add IPv6 to VM Instance
echo "=========================================="
echo "📋 Phase 2: VM Instance IPv6 Configuration"
echo "=========================================="
echo ""

# Check if instance already has IPv6
echo "Checking instance IPv6 configuration..."
CURRENT_IPV6=$(gcloud compute instances describe "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --format="value(networkInterfaces[0].ipv6AccessConfigs[0].externalIpv6)" 2>/dev/null || echo "")

if [ -n "$CURRENT_IPV6" ]; then
  echo -e "${GREEN}✓ Instance already has IPv6: $CURRENT_IPV6${NC}"
  IPV6_ADDRESS="$CURRENT_IPV6"
else
  echo -e "${YELLOW}⚠️  No IPv6 found, adding IPv6 access config...${NC}"
  
  run_cmd \
    "gcloud compute instances network-interfaces update '$INSTANCE_NAME' \
      --zone='$ZONE' \
      --stack-type=IPV4_IPV6 \
      --ipv6-network-tier=PREMIUM" \
    "Add IPv6 to instance"
  
  # Wait for IPv6 to be assigned
  echo "Waiting for IPv6 assignment (this may take 10-30 seconds)..."
  sleep 10
  
  IPV6_ADDRESS=$(gcloud compute instances describe "$INSTANCE_NAME" \
    --zone="$ZONE" \
    --format="value(networkInterfaces[0].ipv6AccessConfigs[0].externalIpv6)")
  
  if [ -n "$IPV6_ADDRESS" ]; then
    echo -e "${GREEN}✓ IPv6 assigned: $IPV6_ADDRESS${NC}"
  else
    echo -e "${RED}✗ Failed to get IPv6 address${NC}"
    exit 1
  fi
fi

# Extract clean IPv6 address (remove /96 suffix if present)
IPV6_CLEAN=$(echo "$IPV6_ADDRESS" | cut -d'/' -f1)
# Add ::1 if it's a /96 range
if echo "$IPV6_ADDRESS" | grep -q "/96"; then
  IPV6_CLEAN="${IPV6_CLEAN}1"
fi

echo ""
echo -e "${GREEN}📝 IPv6 Address for configuration: $IPV6_CLEAN${NC}"
echo ""

# Phase 3: Check Network Tags
echo "=========================================="
echo "📋 Phase 3: Network Tags Verification"
echo "=========================================="
echo ""

echo "Checking instance network tags..."
CURRENT_TAGS=$(gcloud compute instances describe "$INSTANCE_NAME" \
  --zone="$ZONE" \
  --format="value(tags.items)" 2>/dev/null || echo "")

echo "Current tags: ${CURRENT_TAGS:-<none>}"

if echo "$CURRENT_TAGS" | grep -q "translation-webrtc"; then
  echo -e "${GREEN}✓ Instance has 'translation-webrtc' tag${NC}"
else
  echo -e "${YELLOW}⚠️  Instance missing 'translation-webrtc' tag${NC}"
  echo "Adding tag..."
  
  run_cmd \
    "gcloud compute instances add-tags '$INSTANCE_NAME' \
      --zone='$ZONE' \
      --tags=translation-webrtc" \
    "Add network tag for firewall rules"
fi
echo ""

# Phase 4: Firewall Rules
echo "=========================================="
echo "📋 Phase 4: Firewall Configuration"
echo "=========================================="
echo ""

# Check if firewall rules exist
WEBRTC_RULE_EXISTS=$(gcloud compute firewall-rules list \
  --filter="name=allow-webrtc-ipv6" \
  --format="value(name)" 2>/dev/null || echo "")

if [ -n "$WEBRTC_RULE_EXISTS" ]; then
  echo -e "${GREEN}✓ Firewall rule 'allow-webrtc-ipv6' already exists${NC}"
else
  echo "Creating firewall rule for WebRTC (IPv6)..."
  run_cmd \
    "gcloud compute firewall-rules create allow-webrtc-ipv6 \
      --network='$NETWORK_NAME' \
      --direction=INGRESS \
      --priority=1000 \
      --action=ALLOW \
      --rules=udp:40000-40100,tcp:40000-40100 \
      --source-ranges=::/0 \
      --target-tags=translation-webrtc \
      --description='Allow WebRTC media traffic over IPv6'" \
    "Create WebRTC IPv6 firewall rule"
fi

HTTPS_RULE_EXISTS=$(gcloud compute firewall-rules list \
  --filter="name=allow-gateway-https-ipv6" \
  --format="value(name)" 2>/dev/null || echo "")

if [ -n "$HTTPS_RULE_EXISTS" ]; then
  echo -e "${GREEN}✓ Firewall rule 'allow-gateway-https-ipv6' already exists${NC}"
else
  echo "Creating firewall rule for HTTPS (IPv6)..."
  run_cmd \
    "gcloud compute firewall-rules create allow-gateway-https-ipv6 \
      --network='$NETWORK_NAME' \
      --direction=INGRESS \
      --priority=1000 \
      --action=ALLOW \
      --rules=tcp:443,tcp:80 \
      --source-ranges=::/0 \
      --target-tags=translation-webrtc \
      --description='Allow HTTPS traffic over IPv6'" \
    "Create HTTPS IPv6 firewall rule"
fi

echo ""

# Phase 5: Summary & Next Steps
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo -e "${GREEN}IPv6 Configuration Summary:${NC}"
echo "  Instance: $INSTANCE_NAME"
echo "  IPv6 Address: $IPV6_CLEAN"
echo "  Subnet: $SUBNET_NAME (IPV4_IPV6)"
echo "  Network Tags: translation-webrtc"
echo "  Firewall: WebRTC (40000-40100) + HTTPS rules created"
echo ""

echo -e "${YELLOW}📋 Next Steps:${NC}"
echo ""
echo "1. Update Gateway environment variables:"
echo "   Edit: infrastructure/swarm/stack-hybrid.yml"
echo "   Uncomment and set:"
echo -e "   ${BLUE}  - ANNOUNCED_IPV6=$IPV6_CLEAN${NC}"
echo -e "   ${BLUE}  - ENABLE_IPV6=true${NC}"
echo ""

echo "2. Add DNS AAAA record (Hostinger):"
echo "   Login: https://hpanel.hostinger.com"
echo "   Navigate: Domains → jbcalling.site → DNS Records"
echo "   Add record:"
echo "     - Type: AAAA"
echo "     - Name: webrtc"
echo -e "     - Points to: ${BLUE}$IPV6_CLEAN${NC}"
echo "     - TTL: 300"
echo "   Wait 5-15 minutes for propagation"
echo ""

echo "3. Build and deploy Gateway:"
echo "   cd services/gateway"
echo "   docker build -t jackboun11/jbcalling-gateway:1.0.5-ipv6 ."
echo "   docker push jackboun11/jbcalling-gateway:1.0.5-ipv6"
echo "   # Update stack-hybrid.yml image version"
echo "   scp infrastructure/swarm/stack-hybrid.yml translation01:/tmp/"
echo "   ssh translation01 'docker stack deploy -c /tmp/stack-hybrid.yml translation'"
echo ""

echo "4. Test IPv6 connectivity:"
echo -e "   ${BLUE}./scripts/test-ipv6.sh $IPV6_CLEAN${NC}"
echo ""

echo "5. Verify Gateway logs:"
echo "   ssh translation01 'docker service logs translation_gateway --follow | grep -i ipv6'"
echo ""

echo -e "${GREEN}Configuration file saved to: /tmp/ipv6-config.env${NC}"
if [ "$DRY_RUN" = false ]; then
  cat > /tmp/ipv6-config.env <<EOF
# IPv6 Configuration for Gateway
# Generated: $(date)
ANNOUNCED_IPV6=$IPV6_CLEAN
ENABLE_IPV6=true
EOF
  echo "Use this file to set environment variables"
fi

echo ""
echo "For detailed documentation, see: docs/11-IPV6-SETUP-GUIDE.md"
