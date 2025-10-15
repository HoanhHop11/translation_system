#!/bin/bash
# =============================================================================
# MASTER DEPLOYMENT SCRIPT - PHASE 1
# Tự động deploy Phase 1 lên cả 3 instances
# Chạy từ máy local (có gcloud CLI)
# Date: October 5, 2025
# =============================================================================

set -e

echo "=========================================="
echo "🚀 PHASE 1 - AUTOMATIC DEPLOYMENT"
echo "=========================================="

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
MANAGER_ZONE="asia-southeast1-a"
WORKER_ZONE="asia-southeast1-b"
MANAGER_NODE="translation01"
WORKER1_NODE="translation02"
WORKER2_NODE="translation03"
MANAGER_INTERNAL_IP="10.148.0.5"

SCRIPT_DIR="scripts/phase1"
PROJECT_DIR="/home/hopboy2003/jbcalling_translation_realtime"

echo ""
echo -e "${BLUE}📋 Configuration:${NC}"
echo "  Manager: $MANAGER_NODE ($MANAGER_ZONE)"
echo "  Worker1: $WORKER1_NODE ($WORKER_ZONE)"
echo "  Worker2: $WORKER2_NODE ($WORKER_ZONE)"
echo ""

# Hỏi xác nhận
echo -e "${YELLOW}⚠️  Script này sẽ thực hiện:${NC}"
echo "  1. Copy scripts lên các instances"
echo "  2. Cài đặt Docker trên tất cả instances"
echo "  3. Khởi tạo Docker Swarm"
echo "  4. Join workers vào swarm"
echo "  5. Configure labels và secrets"
echo "  6. Deploy base services"
echo ""
read -p "Bạn có muốn tiếp tục? (y/N): " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Hủy deployment."
    exit 0
fi

# =============================================================================
# STEP 1: Copy scripts lên các instances
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}📦 STEP 1: Copy scripts${NC}"
echo "=========================================="

echo "Copying to $MANAGER_NODE..."
gcloud compute scp --zone=$MANAGER_ZONE \
    "$SCRIPT_DIR"/*.sh "$MANAGER_NODE":~ 

echo "Copying to $WORKER1_NODE..."
gcloud compute scp --zone=$WORKER_ZONE \
    "$SCRIPT_DIR"/01-install-docker.sh \
    "$SCRIPT_DIR"/03-join-swarm-worker.sh \
    "$WORKER1_NODE":~

echo "Copying to $WORKER2_NODE..."
gcloud compute scp --zone=$WORKER_ZONE \
    "$SCRIPT_DIR"/01-install-docker.sh \
    "$SCRIPT_DIR"/03-join-swarm-worker.sh \
    "$WORKER2_NODE":~

echo -e "${GREEN}✅ Scripts copied${NC}"

# =============================================================================
# STEP 2: Cài Docker trên Manager
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🐳 STEP 2: Install Docker on Manager${NC}"
echo "=========================================="

gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    chmod +x 01-install-docker.sh && \
    ./01-install-docker.sh && \
    newgrp docker
"

echo -e "${GREEN}✅ Docker installed on $MANAGER_NODE${NC}"

# =============================================================================
# STEP 3: Cài Docker trên Worker 1
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🐳 STEP 3: Install Docker on Worker 1${NC}"
echo "=========================================="

gcloud compute ssh $WORKER1_NODE --zone=$WORKER_ZONE --command="
    chmod +x 01-install-docker.sh && \
    ./01-install-docker.sh && \
    newgrp docker
"

echo -e "${GREEN}✅ Docker installed on $WORKER1_NODE${NC}"

# =============================================================================
# STEP 4: Cài Docker trên Worker 2
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🐳 STEP 4: Install Docker on Worker 2${NC}"
echo "=========================================="

gcloud compute ssh $WORKER2_NODE --zone=$WORKER_ZONE --command="
    chmod +x 01-install-docker.sh && \
    ./01-install-docker.sh && \
    newgrp docker
"

echo -e "${GREEN}✅ Docker installed on $WORKER2_NODE${NC}"

# =============================================================================
# STEP 5: Khởi tạo Swarm Manager
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🎯 STEP 5: Initialize Swarm Manager${NC}"
echo "=========================================="

gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    chmod +x 02-init-swarm-manager.sh && \
    ./02-init-swarm-manager.sh
"

echo -e "${GREEN}✅ Swarm Manager initialized${NC}"

# Lấy worker token
echo "Retrieving worker join token..."
WORKER_TOKEN=$(gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="cat ~/swarm-tokens/worker-token.txt" 2>/dev/null | tr -d '\r\n')

if [ -z "$WORKER_TOKEN" ]; then
    echo -e "${RED}❌ Failed to retrieve worker token${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Worker token retrieved${NC}"

# =============================================================================
# STEP 6: Join Worker 1 vào Swarm
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🔗 STEP 6: Join Worker 1 to Swarm${NC}"
echo "=========================================="

gcloud compute ssh $WORKER1_NODE --zone=$WORKER_ZONE --command="
    chmod +x 03-join-swarm-worker.sh && \
    ./03-join-swarm-worker.sh '$WORKER_TOKEN' '$MANAGER_INTERNAL_IP'
"

echo -e "${GREEN}✅ $WORKER1_NODE joined swarm${NC}"

# =============================================================================
# STEP 7: Join Worker 2 vào Swarm
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🔗 STEP 7: Join Worker 2 to Swarm${NC}"
echo "=========================================="

gcloud compute ssh $WORKER2_NODE --zone=$WORKER_ZONE --command="
    chmod +x 03-join-swarm-worker.sh && \
    ./03-join-swarm-worker.sh '$WORKER_TOKEN' '$MANAGER_INTERNAL_IP'
"

echo -e "${GREEN}✅ $WORKER2_NODE joined swarm${NC}"

# =============================================================================
# STEP 8: Label nodes
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🏷️  STEP 8: Label Nodes${NC}"
echo "=========================================="

# Wait for nodes to be ready
sleep 10

gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    chmod +x 04-label-nodes.sh && \
    ./04-label-nodes.sh
"

echo -e "${GREEN}✅ Nodes labeled${NC}"

# =============================================================================
# STEP 9: Copy .env và tạo secrets
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🔒 STEP 9: Create Secrets${NC}"
echo "=========================================="

# Tạo thư mục project trên manager
gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    mkdir -p ~/jbcalling_translation_realtime
"

# Copy .env file
echo "Copying .env file..."
gcloud compute scp --zone=$MANAGER_ZONE \
    .env "$MANAGER_NODE":~/jbcalling_translation_realtime/.env

# Tạo secrets
gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    chmod +x 05-create-secrets.sh && \
    ./05-create-secrets.sh
"

echo -e "${GREEN}✅ Secrets created${NC}"

# =============================================================================
# STEP 10: Deploy base services
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}🚀 STEP 10: Deploy Base Services${NC}"
echo "=========================================="

gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    chmod +x 06-deploy-base-services.sh && \
    ./06-deploy-base-services.sh
"

echo -e "${GREEN}✅ Base services deployed${NC}"

# =============================================================================
# STEP 11: Verify deployment
# =============================================================================
echo ""
echo "=========================================="
echo -e "${BLUE}✅ STEP 11: Verify Deployment${NC}"
echo "=========================================="

sleep 20  # Đợi services start

gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    chmod +x verify-phase1.sh && \
    ./verify-phase1.sh
"

# =============================================================================
# COMPLETE
# =============================================================================
echo ""
echo "=========================================="
echo -e "${GREEN}🎉 PHASE 1 DEPLOYMENT COMPLETE!${NC}"
echo "=========================================="
echo ""
echo -e "${BLUE}📊 Quick Status Check:${NC}"

gcloud compute ssh $MANAGER_NODE --zone=$MANAGER_ZONE --command="
    echo '=== Nodes ===' && \
    docker node ls && \
    echo '' && \
    echo '=== Networks ===' && \
    docker network ls | grep overlay && \
    echo '' && \
    echo '=== Services ===' && \
    docker service ls && \
    echo '' && \
    echo '=== Secrets ===' && \
    docker secret ls
"

echo ""
echo -e "${GREEN}✅ Phase 1 hoàn tất!${NC}"
echo ""
echo -e "${BLUE}📝 Next Steps:${NC}"
echo "  1. Verify services: ssh vào $MANAGER_NODE và chạy 'docker service ls'"
echo "  2. Check logs: docker service logs postgres"
echo "  3. Prepare for Phase 2: Core Services"
echo ""
echo -e "${YELLOW}💡 Tip:${NC} Save this terminal output for reference"
echo ""
