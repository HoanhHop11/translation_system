#!/bin/bash

# =============================================================================
# SETUP SSH KEYS FOR SWARM CLUSTER
# =============================================================================
# Script này setup SSH keys để các instances có thể SSH vào nhau
# Run trên TẤT CẢ 3 instances
# =============================================================================

set -e

echo "==================================================================="
echo "  SSH KEYS SETUP FOR DOCKER SWARM CLUSTER"
echo "==================================================================="
echo ""

# =============================================================================
# BƯỚC 1: HIỂN THỊ PUBLIC KEY
# =============================================================================

echo "📝 Public Key cần thêm vào Google Cloud Metadata:"
echo ""
echo "-------------------------------------------------------------------"
cat ~/.ssh/id_ed25519_swarm.pub
echo "-------------------------------------------------------------------"
echo ""
echo "✅ Copy public key phía trên"
echo ""

# =============================================================================
# BƯỚC 2: HƯỚNG DẪN THÊM VÀO GOOGLE CLOUD
# =============================================================================

echo "📋 HƯỚNG DẪN: Thêm SSH Key vào Google Cloud"
echo ""
echo "CÁCH 1: Thêm vào Project-wide SSH keys (KHUYẾN NGHỊ)"
echo "  1. Mở Google Cloud Console"
echo "  2. Đi tới: Compute Engine → Metadata → SSH Keys"
echo "  3. Click 'Add SSH Key'"
echo "  4. Paste public key phía trên"
echo "  5. Click 'Save'"
echo ""
echo "CÁCH 2: Thêm vào từng instance"
echo "  1. Mở Google Cloud Console"
echo "  2. Đi tới: Compute Engine → VM Instances"
echo "  3. Click vào instance (translation01, 02, 03)"
echo "  4. Click 'Edit'"
echo "  5. Scroll xuống 'SSH Keys'"
echo "  6. Click 'Add item'"
echo "  7. Paste public key"
echo "  8. Click 'Save'"
echo "  9. Lặp lại cho tất cả 3 instances"
echo ""

# =============================================================================
# BƯỚC 3: SETUP SSH CONFIG
# =============================================================================

echo "📁 Tạo SSH config file..."

cat > ~/.ssh/config << 'EOF'
# SSH Config cho JB Calling Translation Cluster

Host translation01
    HostName 10.148.0.5
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null

Host translation02
    HostName 10.148.0.3
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null

Host translation03
    HostName 10.148.0.4
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null

# External IPs (for backup)
Host translation01-ext
    HostName 34.143.235.114
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null

Host translation02-ext
    HostName 34.142.190.250
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null

Host translation03-ext
    HostName 34.126.138.3
    User hopboy2003
    IdentityFile ~/.ssh/id_ed25519_swarm
    StrictHostKeyChecking no
    UserKnownHostsFile=/dev/null
EOF

chmod 600 ~/.ssh/config

echo "✅ SSH config đã được tạo tại: ~/.ssh/config"
echo ""

# =============================================================================
# BƯỚC 4: VERIFY
# =============================================================================

echo "🔍 Kiểm tra files..."
echo ""
ls -la ~/.ssh/id_ed25519_swarm* ~/.ssh/config 2>/dev/null || echo "⚠️ Một số files chưa tồn tại"
echo ""

# =============================================================================
# BƯỚC 5: TEST CONNECTION
# =============================================================================

echo "==================================================================="
echo "  TESTING SSH CONNECTIONS"
echo "==================================================================="
echo ""
echo "⚠️ Chỉ test SAU KHI đã thêm public key vào Google Cloud!"
echo ""
echo "Test commands:"
echo "  ssh translation01 'hostname && ip addr show | grep \"inet 10.148\"'"
echo "  ssh translation02 'hostname && ip addr show | grep \"inet 10.148\"'"
echo "  ssh translation03 'hostname && ip addr show | grep \"inet 10.148\"'"
echo ""

read -p "Bạn đã thêm public key vào Google Cloud chưa? (y/n): " -n 1 -r
echo ""

if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "Testing SSH to translation01..."
    ssh translation01 'hostname && ip addr show | grep "inet 10.148"' 2>&1 || echo "❌ Failed to connect to translation01"
    
    echo ""
    echo "Testing SSH to translation02..."
    ssh translation02 'hostname && ip addr show | grep "inet 10.148"' 2>&1 || echo "❌ Failed to connect to translation02"
    
    echo ""
    echo "Testing SSH to translation03..."
    ssh translation03 'hostname && ip addr show | grep "inet 10.148"' 2>&1 || echo "❌ Failed to connect to translation03"
else
    echo ""
    echo "⚠️ Hãy thêm public key vào Google Cloud trước, sau đó chạy lại script này"
    echo ""
    echo "Hoặc test thủ công bằng commands:"
    echo "  ssh translation01 hostname"
    echo "  ssh translation02 hostname"
    echo "  ssh translation03 hostname"
fi

echo ""
echo "==================================================================="
echo "  SETUP COMPLETE!"
echo "==================================================================="
echo ""
echo "✅ Next steps:"
echo "  1. Thêm public key vào Google Cloud (nếu chưa)"
echo "  2. Run script này trên translation01 và translation03"
echo "  3. Test SSH: ssh translation01 hostname"
echo "  4. Sau đó có thể kiểm tra Docker Swarm từ bất kỳ node nào"
echo ""

exit 0
