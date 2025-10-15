#!/bin/bash
# =============================================================================
# Build và Deploy STT Service trực tiếp trên Manager Node
# =============================================================================
# Description: Build image trên manager node và deploy
# Usage: ./scripts/build-and-deploy-stt-local.sh
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
MANAGER_NODE="translation01"
ZONE="asia-southeast1-a"
IMAGE_NAME="hopboy2003/jbcalling-stt:phowhisper"
STACK_NAME="translation"

print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

print_header "STT Service - Build & Deploy on Manager Node"

print_info "Step 1: Copy service files to manager node..."
gcloud compute scp --recurse services/stt $MANAGER_NODE:~/stt-service --zone=$ZONE
gcloud compute scp infrastructure/swarm/stack-with-ssl.yml $MANAGER_NODE:~/stack-with-ssl.yml --zone=$ZONE

print_success "Files copied!"

print_info "Step 2: Build Docker image on manager node..."
gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
    cd ~/stt-service
    echo '🔨 Building Docker image...'
    sudo docker build -t $IMAGE_NAME -t hopboy2003/jbcalling-stt:latest .
    
    echo ''
    echo '📦 Image built:'
    sudo docker images | grep jbcalling-stt
"

print_success "Image built on manager node!"

print_info "Step 3: Label nodes..."
gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
    sudo docker node update --label-add instance=translation01 translation01
    echo '✅ Node labeled'
"

print_success "Nodes labeled!"

print_info "Step 4: Deploy stack..."
gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
    echo '🚀 Deploying stack...'
    sudo docker stack deploy -c ~/stack-with-ssl.yml $STACK_NAME
    
    echo ''
    echo '⏳ Waiting for services...'
    sleep 15
    
    echo ''
    echo '📊 Service Status:'
    sudo docker stack services $STACK_NAME
"

print_success "Stack deployed!"

print_info "Step 5: Check STT service..."
gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
    echo '🔍 STT Service Details:'
    sudo docker service ps ${STACK_NAME}_stt
    
    echo ''
    echo '📋 Recent Logs:'
    sudo docker service logs ${STACK_NAME}_stt --tail 30
"

print_success "Deployment completed!"

print_header "Quick Test Commands"
echo "View logs:      gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command='sudo docker service logs ${STACK_NAME}_stt --follow'"
echo "Service status: gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command='sudo docker service ps ${STACK_NAME}_stt'"
echo "Scale service:  gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command='sudo docker service scale ${STACK_NAME}_stt=3'"
