#!/bin/bash
# =============================================================================
# Script: Cài đặt Docker trên instance
# Phase: 1 - Infrastructure Setup
# Author: JB Calling Team
# Date: October 5, 2025
# =============================================================================

set -e  # Exit on error

echo "======================================"
echo "🚀 BẮT ĐẦU CÀI ĐẶT DOCKER"
echo "======================================"

# Màu sắc cho output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Kiểm tra xem đã cài Docker chưa
if command -v docker &> /dev/null; then
    echo -e "${YELLOW}⚠️  Docker đã được cài đặt!${NC}"
    docker --version
    echo -e "${YELLOW}Bỏ qua bước cài đặt...${NC}"
    exit 0
fi

echo "📦 Bước 1: Cập nhật hệ thống..."
sudo apt update
sudo apt upgrade -y

echo ""
echo "📦 Bước 2: Cài đặt các gói cần thiết..."
sudo apt install -y \
    git \
    curl \
    wget \
    htop \
    net-tools \
    ca-certificates \
    gnupg \
    lsb-release

echo ""
echo "📦 Bước 3: Tải Docker installation script..."
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh

echo ""
echo "📦 Bước 4: Chạy Docker installation script..."
sudo sh /tmp/get-docker.sh

echo ""
echo "📦 Bước 5: Thêm user vào docker group..."
sudo usermod -aG docker $USER

echo ""
echo "📦 Bước 6: Kích hoạt Docker service..."
sudo systemctl enable docker
sudo systemctl start docker

echo ""
echo "📦 Bước 7: Cấu hình Docker daemon..."
sudo mkdir -p /etc/docker

# Tạo daemon.json với cấu hình tối ưu
sudo tee /etc/docker/daemon.json > /dev/null <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2",
  "default-ulimits": {
    "nofile": {
      "Name": "nofile",
      "Hard": 64000,
      "Soft": 64000
    }
  }
}
EOF

echo ""
echo "📦 Bước 8: Restart Docker với cấu hình mới..."
sudo systemctl restart docker

echo ""
echo "======================================"
echo -e "${GREEN}✅ DOCKER ĐÃ ĐƯỢC CÀI ĐẶT THÀNH CÔNG!${NC}"
echo "======================================"
echo ""
echo "📊 Thông tin Docker:"
docker --version
docker info | grep -E "Server Version|Storage Driver|Logging Driver"

echo ""
echo -e "${YELLOW}⚠️  QUAN TRỌNG:${NC}"
echo "Bạn cần LOGOUT và LOGIN lại để sử dụng Docker không cần sudo"
echo "Hoặc chạy: newgrp docker"
echo ""
