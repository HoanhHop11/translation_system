#!/bin/bash
# ============================================================================
# Script: setup-firewall-rules.sh
# Mục đích: Tạo tất cả firewall rules cần thiết cho JBCalling Translation System
# Ngày tạo: December 2, 2025
# ============================================================================

set -e

# Cấu hình
NETWORK="${NETWORK:-translation-network}"
SUBNET="${SUBNET:-10.200.0.0/24}"

echo "=============================================="
echo "🔥 Setup Firewall Rules cho JBCalling System"
echo "=============================================="
echo "Network: $NETWORK"
echo "Subnet: $SUBNET"
echo ""

# Hàm tạo rule với kiểm tra tồn tại
create_rule() {
    local name=$1
    local priority=$2
    local source=$3
    local rules=$4
    local description=$5
    
    echo -n "  → $name... "
    
    if gcloud compute firewall-rules describe "$name" &>/dev/null; then
        echo "đã tồn tại ✓"
    else
        gcloud compute firewall-rules create "$name" \
            --network="$NETWORK" \
            --priority="$priority" \
            --direction=INGRESS \
            --action=ALLOW \
            --source-ranges="$source" \
            --rules="$rules" \
            --description="$description" \
            --quiet
        echo "đã tạo ✅"
    fi
}

echo "📦 1. Docker Swarm Rules (Critical)"
echo "-----------------------------------"

# Rule quan trọng nhất - bao gồm ESP protocol
create_rule "allow-swarm-full" \
    "900" \
    "$SUBNET" \
    "tcp:2377,tcp:7946,udp:7946,udp:4789,esp" \
    "Docker Swarm full connectivity with ESP encryption"

create_rule "allow-swarm" \
    "1000" \
    "$SUBNET" \
    "tcp:2377,tcp:7946,udp:7946,udp:4789" \
    "Docker Swarm basic ports"

echo ""
echo "🔗 2. Internal Communication Rules"
echo "-----------------------------------"

create_rule "allow-internal" \
    "1000" \
    "$SUBNET" \
    "tcp,udp,icmp" \
    "Allow all internal traffic between nodes"

create_rule "allow-ai-services" \
    "1000" \
    "$SUBNET" \
    "tcp:8002,tcp:8003,tcp:8004,tcp:8005,tcp:6379" \
    "AI services internal communication"

echo ""
echo "🌐 3. Web Traffic Rules"
echo "-----------------------------------"

create_rule "allow-http-https" \
    "1000" \
    "0.0.0.0/0" \
    "tcp:80,tcp:443" \
    "HTTP and HTTPS traffic"

create_rule "allow-gateway-http" \
    "1000" \
    "0.0.0.0/0" \
    "tcp:3000" \
    "Gateway service HTTP port"

echo ""
echo "📹 4. WebRTC Rules"
echo "-----------------------------------"

create_rule "allow-webrtc" \
    "1000" \
    "0.0.0.0/0" \
    "udp:40000-40100,tcp:40000-40100,tcp:3478,udp:3478,tcp:5349" \
    "WebRTC media and STUN/TURN ports"

create_rule "allow-turn-relay" \
    "1000" \
    "0.0.0.0/0" \
    "udp:49152-49156" \
    "TURN relay ports"

create_rule "allow-nginx-webrtc" \
    "1000" \
    "0.0.0.0/0" \
    "tcp:8443,tcp:8080" \
    "Nginx WebRTC proxy ports"

echo ""
echo "🔐 5. SSH Access"
echo "-----------------------------------"

create_rule "allow-ssh" \
    "1000" \
    "0.0.0.0/0" \
    "tcp:22" \
    "SSH access"

echo ""
echo "🏥 6. Health Check Rules"
echo "-----------------------------------"

create_rule "translation-network-allow-health-check" \
    "1000" \
    "35.191.0.0/16,130.211.0.0/22,209.85.152.0/22,209.85.204.0/22" \
    "tcp" \
    "Google Cloud health check probes IPv4"

create_rule "translation-network-allow-health-check-ipv6" \
    "1000" \
    "2600:1901:8001::/48,2600:2d00:1:b029::/64" \
    "tcp" \
    "Google Cloud health check probes IPv6"

echo ""
echo "=============================================="
echo "✅ Hoàn tất setup firewall rules!"
echo "=============================================="
echo ""
echo "📋 Danh sách rules hiện tại:"
echo ""

gcloud compute firewall-rules list \
    --filter="network:$NETWORK" \
    --format="table(name,priority,sourceRanges.list():label=SOURCE,allowed[].map().firewall_rule().list():label=ALLOW)" \
    --sort-by=priority

echo ""
echo "💡 Kiểm tra connectivity:"
echo "   nc -zv <worker-ip> 7946  # Node communication"
echo "   docker node ls           # Swarm status"
