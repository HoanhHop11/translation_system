#!/bin/bash

# =============================================================================
# JB CALLING - DEPLOY OPTIMAL REPLICA CONFIGURATION
# =============================================================================
# Script tự động deploy cấu hình replica tối ưu
# Mục tiêu: 22 replicas tổng, 3 STT replicas (1 per node)
# =============================================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

separator() {
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════════════════════${NC}"
}

# =============================================================================
# MAIN DEPLOYMENT
# =============================================================================

separator
echo -e "${GREEN}🚀 JB CALLING - OPTIMAL REPLICA DEPLOYMENT${NC}"
separator
echo ""
log_info "Configuration: 3 nodes (31GB / 16GB / 16GB)"
log_info "Target: 22 total replicas, 3 STT replicas (1 per node)"
echo ""

# Step 1: Verify translation01 is running
separator
log_info "Step 1: Checking translation01 status..."
separator

if ! ssh -o ConnectTimeout=5 translation01 'echo "Connected"' &>/dev/null; then
    log_error "translation01 is NOT accessible!"
    log_warning "Please start translation01 first:"
    echo "  gcloud compute instances start translation01 --zone=asia-southeast1-a"
    exit 1
fi

log_success "translation01 is online ✅"

# Step 2: Verify Docker Swarm
separator
log_info "Step 2: Verifying Docker Swarm cluster..."
separator

NODE_COUNT=$(ssh translation01 'sudo docker node ls -q | wc -l' 2>/dev/null || echo "0")

if [ "$NODE_COUNT" -ne 3 ]; then
    log_error "Expected 3 nodes, found $NODE_COUNT"
    ssh translation01 'sudo docker node ls'
    exit 1
fi

log_success "Docker Swarm cluster: 3 nodes ✅"
ssh translation01 'sudo docker node ls'
echo ""

# Step 3: Verify stack file exists
separator
log_info "Step 3: Verifying stack configuration file..."
separator

if ! ssh translation01 'test -f /home/hopboy2003/infrastructure/swarm/stack-with-ssl.yml'; then
    log_error "stack-with-ssl.yml not found on translation01"
    exit 1
fi

log_success "stack-with-ssl.yml found ✅"

# Step 4: Show current service status
separator
log_info "Step 4: Current service status (before deployment)..."
separator

ssh translation01 'sudo docker service ls'
echo ""

# Step 5: Deploy stack with new configuration
separator
log_info "Step 5: Deploying stack with optimal replica configuration..."
separator

log_warning "This will:"
echo "  • Scale API: 2 → 3 replicas"
echo "  • Scale Signaling: 2 → 3 replicas"
echo "  • Scale Frontend: 2 → 3 replicas"
echo "  • Scale STT: 2 → 3 replicas ✅ TARGET"
echo "  • Scale Translation: 1 → 2 replicas"
echo "  • Scale TTS: 1 → 2 replicas"
echo ""

read -p "Continue with deployment? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Deployment cancelled by user"
    exit 0
fi

log_info "Deploying stack..."

ssh translation01 'cd /home/hopboy2003 && \
  sudo docker stack deploy -c infrastructure/swarm/stack-with-ssl.yml translation'

log_success "Stack deployment command executed ✅"

# Step 6: Wait for services to stabilize
separator
log_info "Step 6: Waiting for services to stabilize..."
separator

log_info "Waiting 30 seconds for Docker Swarm to schedule replicas..."
sleep 30

# Step 7: Verify new service status
separator
log_info "Step 7: Verifying new service status..."
separator

ssh translation01 'sudo docker service ls'
echo ""

# Step 8: Verify STT replica distribution
separator
log_info "Step 8: Verifying STT replica distribution (TARGET: 3 replicas, 1 per node)..."
separator

ssh translation01 'sudo docker service ps translation_stt --format "table {{.Name}}\t{{.Node}}\t{{.CurrentState}}\t{{.Error}}"'
echo ""

STT_RUNNING=$(ssh translation01 'sudo docker service ps translation_stt --filter "desired-state=running" -q | wc -l')

if [ "$STT_RUNNING" -eq 3 ]; then
    log_success "✅ STT: 3/3 replicas running!"
else
    log_warning "STT: $STT_RUNNING/3 replicas running (may still be starting...)"
fi

# Step 9: Verify API replica distribution
separator
log_info "Step 9: Verifying API replica distribution..."
separator

ssh translation01 'sudo docker service ps translation_api --format "table {{.Name}}\t{{.Node}}\t{{.CurrentState}}"'
echo ""

# Step 10: Verify Translation replica distribution
separator
log_info "Step 10: Verifying Translation replica distribution..."
separator

ssh translation01 'sudo docker service ps translation_translation --format "table {{.Name}}\t{{.Node}}\t{{.CurrentState}}"'
echo ""

# Step 11: Verify TTS replica distribution
separator
log_info "Step 11: Verifying TTS replica distribution..."
separator

ssh translation01 'sudo docker service ps translation_tts --format "table {{.Name}}\t{{.Node}}\t{{.CurrentState}}"'
echo ""

# Step 12: Check for errors
separator
log_info "Step 12: Checking for deployment errors..."
separator

ERRORS=$(ssh translation01 'sudo docker service ps translation_stt --filter "desired-state=shutdown" --format "{{.Error}}" | grep -v "^$" | wc -l')

if [ "$ERRORS" -gt 0 ]; then
    log_warning "Found $ERRORS previous task errors (may be from old deployments)"
    ssh translation01 'sudo docker service ps translation_stt --filter "desired-state=shutdown" --format "table {{.Name}}\t{{.Node}}\t{{.Error}}" | head -10'
else
    log_success "No errors found ✅"
fi

echo ""

# Step 13: Health checks
separator
log_info "Step 13: Waiting for health checks to pass..."
separator

log_info "Waiting 60 seconds for services to become healthy..."
sleep 60

log_info "Testing STT health endpoint..."
if curl -sf https://stt.jbcalling.site/health > /dev/null 2>&1; then
    log_success "STT health check: PASSED ✅"
else
    log_warning "STT health check: FAILED (may still be starting models...)"
fi

log_info "Testing API health endpoint..."
if curl -sf https://api.jbcalling.site/health > /dev/null 2>&1; then
    log_success "API health check: PASSED ✅"
else
    log_warning "API health check: FAILED"
fi

log_info "Testing Translation health endpoint..."
if curl -sf https://translate.jbcalling.site/health > /dev/null 2>&1; then
    log_success "Translation health check: PASSED ✅"
else
    log_warning "Translation health check: FAILED (may still be loading models...)"
fi

log_info "Testing TTS health endpoint..."
if curl -sf https://tts.jbcalling.site/health > /dev/null 2>&1; then
    log_success "TTS health check: PASSED ✅"
else
    log_warning "TTS health check: FAILED"
fi

echo ""

# Step 14: Resource monitoring
separator
log_info "Step 14: Resource usage summary..."
separator

echo ""
log_info "translation01 (Manager - 31GB):"
ssh translation01 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -15'

echo ""
log_info "translation02 (Worker - 16GB):"
ssh translation02 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -10'

echo ""
log_info "translation03 (Worker - 16GB):"
ssh translation03 'docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" | head -10'

echo ""

# Final summary
separator
echo -e "${GREEN}✅ DEPLOYMENT SUMMARY${NC}"
separator

TOTAL_SERVICES=$(ssh translation01 'sudo docker service ls -q | wc -l')
TOTAL_REPLICAS=$(ssh translation01 'sudo docker service ls --format "{{.Replicas}}" | awk -F"/" "{sum+=\$2} END {print sum}"')

echo ""
log_success "Total services: $TOTAL_SERVICES"
log_success "Total replicas: $TOTAL_REPLICAS"
echo ""

separator
echo -e "${BLUE}📊 REPLICA DISTRIBUTION${NC}"
separator

echo ""
echo "Expected configuration:"
echo "  • API: 3 replicas (1 per node)"
echo "  • Signaling: 3 replicas (1 per node)"
echo "  • Frontend: 3 replicas (1 per node)"
echo "  • STT: 3 replicas (1 per node) ✅ CRITICAL"
echo "  • Translation: 2 replicas (1 per worker)"
echo "  • TTS: 2 replicas (1 per worker)"
echo "  • Infrastructure: 1 replica each (manager only)"
echo "  • Monitoring: 1 replica each (manager only)"
echo ""

separator
echo -e "${YELLOW}⚠️  IMPORTANT NOTES${NC}"
separator

echo ""
log_warning "STT replicas may take 1-2 minutes to fully start (loading medium model)"
log_warning "Translation replicas may take 1-2 minutes (loading NLLB-200 model)"
log_warning "Monitor with: ssh translation01 'sudo docker service ps translation_stt'"
echo ""

separator
echo -e "${GREEN}🎯 NEXT STEPS${NC}"
separator

echo ""
echo "1. Monitor service logs:"
echo "   ssh translation01 'sudo docker service logs translation_stt --tail 50 -f'"
echo ""
echo "2. Test load balancing:"
echo "   for i in {1..10}; do curl -s https://stt.jbcalling.site/health | jq -r '.hostname'; done"
echo ""
echo "3. Test failover:"
echo "   ssh translation02 'sudo docker ps | grep stt'"
echo "   ssh translation02 'sudo docker stop <container_id>'"
echo "   # Docker Swarm auto-restarts within 10s"
echo ""
echo "4. View Grafana dashboard:"
echo "   https://monitoring.jbcalling.site"
echo ""
echo "5. Check detailed documentation:"
echo "   cat /home/hopboy2003/jbcalling_translation_realtime/OPTIMAL-REPLICA-DESIGN.md"
echo ""

separator
log_success "Deployment completed! 🎉"
separator

exit 0
