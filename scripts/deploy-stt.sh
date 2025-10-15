#!/bin/bash
# =============================================================================
# Deploy STT Service Script
# =============================================================================
# Description: Deploy STT service (PhoWhisper) lên Docker Swarm
# Usage: ./scripts/deploy-stt.sh [push|deploy|all]
# =============================================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DOCKER_IMAGE="jackboun11/jbcalling-stt"
TAG="phowhisper"
STACK_NAME="translation"
STACK_FILE="infrastructure/swarm/stack-with-ssl.yml"
MANAGER_NODE="translation01"
ZONE="asia-southeast1-a"

# Functions
print_header() {
    echo -e "${BLUE}========================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}========================================${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${YELLOW}ℹ️  $1${NC}"
}

# Check if Docker image exists locally
check_image() {
    print_header "Checking Docker Image"
    if sudo docker images | grep -q "$DOCKER_IMAGE.*$TAG"; then
        print_success "Docker image found: $DOCKER_IMAGE:$TAG"
        sudo docker images | grep "$DOCKER_IMAGE"
        return 0
    else
        print_error "Docker image not found: $DOCKER_IMAGE:$TAG"
        print_info "Please build the image first: cd services/stt && sudo docker build -t $DOCKER_IMAGE:$TAG ."
        return 1
    fi
}

# Push image to Docker Hub
push_image() {
    print_header "Pushing Image to Docker Hub"
    
    print_info "Logging in to Docker Hub..."
    # sudo docker login
    
    print_info "Tagging image..."
    sudo docker tag $DOCKER_IMAGE:$TAG $DOCKER_IMAGE:$TAG
    sudo docker tag $DOCKER_IMAGE:$TAG $DOCKER_IMAGE:latest
    
    print_info "Pushing $DOCKER_IMAGE:$TAG..."
    sudo docker push $DOCKER_IMAGE:$TAG
    
    print_info "Pushing $DOCKER_IMAGE:latest..."
    sudo docker push $DOCKER_IMAGE:latest
    
    print_success "Image pushed successfully!"
}

# Label nodes for STT placement
label_nodes() {
    print_header "Labeling Nodes for STT Placement"
    
    print_info "Connecting to manager node..."
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        # Label translation01 for STT workload
        sudo docker node update --label-add instance=translation01 translation01
        
        echo '✅ Node labels updated'
        echo ''
        echo 'Current node labels:'
        sudo docker node inspect translation01 --format '{{json .Spec.Labels}}' | python3 -m json.tool
    "
    
    print_success "Nodes labeled successfully!"
}

# Deploy stack to Swarm
deploy_stack() {
    print_header "Deploying STT Service to Swarm"
    
    print_info "Copying stack file to manager node..."
    gcloud compute scp $STACK_FILE $MANAGER_NODE:~/stack-with-ssl.yml --zone=$ZONE
    
    print_info "Deploying stack..."
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        echo '📦 Pulling latest image...'
        sudo docker pull $DOCKER_IMAGE:$TAG
        
        echo ''
        echo '🚀 Deploying stack...'
        sudo docker stack deploy -c ~/stack-with-ssl.yml $STACK_NAME
        
        echo ''
        echo '⏳ Waiting for services to start...'
        sleep 10
        
        echo ''
        echo '📊 Service Status:'
        sudo docker stack services $STACK_NAME | grep -E 'NAME|stt'
        
        echo ''
        echo '🔍 STT Service Details:'
        sudo docker service ps ${STACK_NAME}_stt --no-trunc
    "
    
    print_success "Stack deployed successfully!"
}

# Check STT service health
check_health() {
    print_header "Checking STT Service Health"
    
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        echo '🏥 Service Health Check:'
        echo ''
        
        # Get service replicas
        REPLICAS=\$(sudo docker service ls | grep stt | awk '{print \$4}')
        echo \"Replicas: \$REPLICAS\"
        
        echo ''
        echo '📋 Service Logs (last 20 lines):'
        sudo docker service logs ${STACK_NAME}_stt --tail 20
        
        echo ''
        echo '🔍 Container Status:'
        sudo docker service ps ${STACK_NAME}_stt
    "
}

# Test STT endpoint
test_endpoint() {
    print_header "Testing STT Service Endpoint"
    
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        echo '🧪 Testing STT health endpoint...'
        
        # Find container
        CONTAINER_ID=\$(sudo docker ps | grep stt | head -1 | awk '{print \$1}')
        
        if [ -z \"\$CONTAINER_ID\" ]; then
            echo '❌ No STT container found!'
            exit 1
        fi
        
        echo \"Container ID: \$CONTAINER_ID\"
        echo ''
        
        # Test health endpoint
        echo '1️⃣ Health Check:'
        sudo docker exec \$CONTAINER_ID curl -s http://localhost:8002/health | python3 -m json.tool || echo 'Health check failed'
        
        echo ''
        echo '2️⃣ Models Info:'
        sudo docker exec \$CONTAINER_ID curl -s http://localhost:8002/models | python3 -m json.tool || echo 'Models info failed'
        
        echo ''
        echo '3️⃣ Root Endpoint:'
        sudo docker exec \$CONTAINER_ID curl -s http://localhost:8002/ | python3 -m json.tool || echo 'Root endpoint failed'
    "
}

# View logs
view_logs() {
    print_header "Viewing STT Service Logs"
    
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        sudo docker service logs ${STACK_NAME}_stt --follow --tail 50
    "
}

# Rollback deployment
rollback() {
    print_header "Rolling Back STT Service"
    
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        echo '⏪ Rolling back STT service...'
        sudo docker service rollback ${STACK_NAME}_stt
        
        echo ''
        echo '⏳ Waiting for rollback...'
        sleep 10
        
        echo ''
        echo '📊 Service Status:'
        sudo docker service ps ${STACK_NAME}_stt
    "
    
    print_success "Rollback completed!"
}

# Scale service
scale_service() {
    local replicas=$1
    print_header "Scaling STT Service to $replicas replicas"
    
    gcloud compute ssh $MANAGER_NODE --zone=$ZONE --command="
        sudo docker service scale ${STACK_NAME}_stt=$replicas
        
        echo ''
        echo '⏳ Waiting for scaling...'
        sleep 5
        
        echo ''
        echo '📊 Service Status:'
        sudo docker service ps ${STACK_NAME}_stt
    "
    
    print_success "Service scaled to $replicas replicas!"
}

# Main script
print_header "STT Service Deployment Script"

case "${1:-help}" in
    check)
        check_image
        ;;
    push)
        check_image && push_image
        ;;
    label)
        label_nodes
        ;;
    deploy)
        deploy_stack
        ;;
    health)
        check_health
        ;;
    test)
        test_endpoint
        ;;
    logs)
        view_logs
        ;;
    rollback)
        rollback
        ;;
    scale)
        if [ -z "$2" ]; then
            print_error "Please specify number of replicas: ./deploy-stt.sh scale 3"
            exit 1
        fi
        scale_service $2
        ;;
    all)
        check_image && \
        push_image && \
        label_nodes && \
        deploy_stack && \
        sleep 15 && \
        check_health && \
        test_endpoint
        ;;
    *)
        echo "Usage: $0 {check|push|label|deploy|health|test|logs|rollback|scale|all}"
        echo ""
        echo "Commands:"
        echo "  check     - Check if Docker image exists locally"
        echo "  push      - Push Docker image to Docker Hub"
        echo "  label     - Label nodes for STT placement"
        echo "  deploy    - Deploy STT service to Swarm"
        echo "  health    - Check STT service health"
        echo "  test      - Test STT endpoints"
        echo "  logs      - View STT service logs (follow mode)"
        echo "  rollback  - Rollback to previous version"
        echo "  scale N   - Scale service to N replicas"
        echo "  all       - Run complete deployment (check → push → label → deploy → test)"
        echo ""
        echo "Examples:"
        echo "  $0 all                 # Complete deployment"
        echo "  $0 deploy              # Deploy only"
        echo "  $0 scale 3             # Scale to 3 replicas"
        echo "  $0 logs                # View logs"
        exit 1
        ;;
esac

print_success "Done!"
