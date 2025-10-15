#!/bin/bash
# =============================================================================
# Script: Gắn labels cho các nodes trong Swarm
# Phase: 1 - Infrastructure Setup
# Chạy trên: translation01 (Manager Node)
# Date: October 5, 2025
# =============================================================================

set -e

echo "======================================"
echo "🏷️  GẮN LABELS CHO SWARM NODES"
echo "======================================"

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Kiểm tra xem có phải manager không
if ! docker info 2>/dev/null | grep -q "Is Manager: true"; then
    echo -e "${RED}❌ Script này chỉ chạy trên Manager Node!${NC}"
    exit 1
fi

echo "📋 Danh sách nodes hiện tại:"
docker node ls

echo ""
echo "🏷️  Đang gắn labels..."

# Label cho translation01 (Manager + AI Processing)
NODE1_ID=$(docker node ls --filter "role=manager" -q)
echo -e "${YELLOW}📍 Node 1 (Manager): $NODE1_ID${NC}"
docker node update --label-add role=manager "$NODE1_ID"
docker node update --label-add type=processing "$NODE1_ID"
docker node update --label-add ai=true "$NODE1_ID"
docker node update --label-add name=translation01 "$NODE1_ID"

# Tìm và label các worker nodes
WORKER_NODES=$(docker node ls --filter "role=worker" -q)

if [ -z "$WORKER_NODES" ]; then
    echo -e "${YELLOW}⚠️  Chưa có worker nodes. Hãy join các worker nodes trước.${NC}"
    exit 0
fi

# Chuyển sang array để xử lý
WORKER_ARRAY=($WORKER_NODES)

# Label cho translation02 (Worker + WebRTC)
if [ ${#WORKER_ARRAY[@]} -ge 1 ]; then
    NODE2_ID=${WORKER_ARRAY[0]}
    echo -e "${YELLOW}📍 Node 2 (Worker 1): $NODE2_ID${NC}"
    docker node update --label-add role=worker "$NODE2_ID"
    docker node update --label-add type=gateway "$NODE2_ID"
    docker node update --label-add webrtc=true "$NODE2_ID"
    docker node update --label-add name=translation02 "$NODE2_ID"
fi

# Label cho translation03 (Worker + Monitoring)
if [ ${#WORKER_ARRAY[@]} -ge 2 ]; then
    NODE3_ID=${WORKER_ARRAY[1]}
    echo -e "${YELLOW}📍 Node 3 (Worker 2): $NODE3_ID${NC}"
    docker node update --label-add role=worker "$NODE3_ID"
    docker node update --label-add type=monitoring "$NODE3_ID"
    docker node update --label-add monitor=true "$NODE3_ID"
    docker node update --label-add name=translation03 "$NODE3_ID"
fi

echo ""
echo -e "${GREEN}✅ ĐÃ GẮN LABELS THÀNH CÔNG!${NC}"

echo ""
echo "📋 Xác nhận labels:"
echo "===================="
for NODE_ID in $(docker node ls -q); do
    echo ""
    echo -e "${YELLOW}Node: $(docker node inspect --format '{{.Description.Hostname}}' $NODE_ID)${NC}"
    docker node inspect --format '{{range $k, $v := .Spec.Labels}}{{$k}}={{$v}} {{end}}' "$NODE_ID"
done

echo ""
echo "======================================"
echo -e "${GREEN}✅ NODE LABELING HOÀN TẤT!${NC}"
echo "======================================"
