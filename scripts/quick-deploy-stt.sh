#!/bin/bash
# =============================================================================
# Quick Deploy STT Service Script
# =============================================================================
# Deploy STT service với registry authentication
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Deploying STT Service${NC}"
echo -e "${BLUE}========================================${NC}"

# Configuration
MANAGER="translation01"
ZONE="asia-southeast1-a"
STACK="translation"

echo -e "${YELLOW}ℹ️  Step 1: Copy stack file to manager node${NC}"
gcloud compute scp infrastructure/swarm/stack-with-ssl.yml $MANAGER:~/stack-with-ssl.yml --zone=$ZONE

echo -e "${YELLOW}ℹ️  Step 2: Copy Docker credentials to manager node${NC}"
sudo cat /root/.docker/config.json > /tmp/docker-config.json
gcloud compute scp /tmp/docker-config.json $MANAGER:~/docker-config.json --zone=$ZONE
rm /tmp/docker-config.json

echo -e "${YELLOW}ℹ️  Step 3: Setup and deploy on manager node${NC}"
gcloud compute ssh $MANAGER --zone=$ZONE --command="
    # Setup Docker credentials
    sudo mkdir -p /root/.docker
    sudo cp ~/docker-config.json /root/.docker/config.json
    sudo chmod 600 /root/.docker/config.json
    
    # Label node
    sudo docker node update --label-add instance=translation01 translation01 2>/dev/null || true
    
    echo '🔄 Pulling STT image...'
    sudo docker pull jackboun11/jbcalling-stt:phowhisper
    
    echo ''
    echo '🚀 Deploying stack with registry auth...'
    sudo docker stack deploy -c ~/stack-with-ssl.yml --with-registry-auth $STACK
    
    echo ''
    echo '⏳ Waiting for services to start...'
    sleep 20
    
    echo ''
    echo '📊 All Services:'
    sudo docker stack services $STACK
    
    echo ''
    echo '🎤 STT Service Details:'
    sudo docker service ps ${STACK}_stt --no-trunc
"

echo -e "${GREEN}✅ Deployment completed!${NC}"
echo ""
echo "Check status: gcloud compute ssh $MANAGER --zone=$ZONE --command='sudo docker service ps ${STACK}_stt'"
echo "View logs:    gcloud compute ssh $MANAGER --zone=$ZONE --command='sudo docker service logs ${STACK}_stt --follow'"
