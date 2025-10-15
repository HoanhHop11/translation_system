#!/bin/bash
# Quick Deploy Script for Translation Service to Docker Swarm
# Phase 3.1 - Translation Service Deployment

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Deploying Translation Service to Docker Swarm${NC}"
echo "=================================================="

# 1. Copy stack file to manager node
echo -e "\n${YELLOW}📤 Copying stack file to manager node...${NC}"
gcloud compute scp \
    /home/hopboy2003/jbcalling_translation_realtime/infrastructure/swarm/stack-with-ssl.yml \
    translation01:/tmp/stack-with-ssl.yml \
    --zone=asia-southeast1-a

# 2. Copy Docker credentials to manager node (for registry authentication)
echo -e "\n${YELLOW}🔑 Copying Docker credentials...${NC}"
gcloud compute scp \
    ~/.docker/config.json \
    translation01:~/.docker/config.json \
    --zone=asia-southeast1-a

# 3. Ensure node has correct labels
echo -e "\n${YELLOW}🏷️  Setting node labels...${NC}"
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
    sudo docker node update --label-add instance=translation01 translation01 2>/dev/null || true
"

# 4. Deploy stack with registry authentication
echo -e "\n${YELLOW}🎯 Deploying Translation service...${NC}"
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
    echo '📦 Deploying stack with registry authentication...'
    sudo docker stack deploy \
        --compose-file /tmp/stack-with-ssl.yml \
        --with-registry-auth \
        translation
    
    echo ''
    echo '⏳ Waiting for Translation service to start (5 seconds)...'
    sleep 5
    
    echo ''
    echo '📊 Current service status:'
    sudo docker service ls | grep -E 'NAME|translation'
    
    echo ''
    echo '🔍 Translation service details:'
    sudo docker service ps translation_translation --no-trunc | head -3
"

# 5. Wait for service to stabilize
echo -e "\n${YELLOW}⏳ Waiting for service to stabilize (30 seconds)...${NC}"
sleep 30

# 6. Test Translation service health
echo -e "\n${YELLOW}🏥 Testing Translation service health...${NC}"
gcloud compute ssh translation01 --zone=asia-southeast1-a --command='
    echo "Testing Translation health endpoint..."
    
    # Get container ID
    CONTAINER_ID=$(sudo docker ps | grep translation_translation | awk "{print \$1}" | head -1)
    
    if [ -z "$CONTAINER_ID" ]; then
        echo "❌ Translation container not found!"
        exit 1
    fi
    
    echo "Container ID: $CONTAINER_ID"
    echo ""
    
    # Test health endpoint
    echo "1️⃣ Health Check:"
    sudo docker exec $CONTAINER_ID curl -s http://localhost:8003/health | python3 -m json.tool || echo "❌ Health check failed"
    
    echo ""
    echo "2️⃣ Service Info:"
    sudo docker exec $CONTAINER_ID curl -s http://localhost:8003/ | python3 -m json.tool || echo "❌ Root endpoint failed"
    
    echo ""
    echo "3️⃣ Supported Languages:"
    sudo docker exec $CONTAINER_ID curl -s http://localhost:8003/languages | python3 -m json.tool | head -20 || echo "❌ Languages endpoint failed"
'

# 7. Show final status
echo -e "\n${GREEN}✅ Translation Service Deployment Complete!${NC}"
echo "=================================================="
echo ""
echo "📊 Service Status:"
gcloud compute ssh translation01 --zone=asia-southeast1-a --command="
    sudo docker service ls | grep -E 'NAME|translation'
"

echo ""
echo -e "${GREEN}🎉 Deployment finished!${NC}"
echo ""
echo "Next steps:"
echo "  1. Monitor service: sudo docker service ps translation_translation"
echo "  2. Check logs: sudo docker service logs -f translation_translation"
echo "  3. Test translation: curl translation01:8003/translate"
echo "  4. View metrics: curl translation01:8003/metrics"
