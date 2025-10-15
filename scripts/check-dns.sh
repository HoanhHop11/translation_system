#!/bin/bash

echo ""
echo "╔══════════════════════════════════════════════════════════════════════════╗"
echo "║              🔍 KIỂM TRA DNS RECORDS - JB CALLING                        ║"
echo "╚══════════════════════════════════════════════════════════════════════════╝"
echo ""

check_domain() {
    local domain=$1
    local name=$2
    local expected="34.142.190.250"
    
    echo "$name"
    result=$(getent hosts $domain 2>/dev/null)
    
    if [ -z "$result" ]; then
        echo "   ❌ Không resolve được - CẦN THÊM RECORD"
        return 1
    fi
    
    ip=$(echo $result | awk '{print $1}')
    
    if [ "$ip" = "$expected" ]; then
        echo "   ✅ $ip (ĐÚNG - Manager node)"
        return 0
    else
        echo "   ⚠️  $ip (SAI - Cần: $expected)"
        return 1
    fi
}

errors=0

check_domain "jbcalling.site" "1. jbcalling.site (Main)" || ((errors++))
echo ""

check_domain "www.jbcalling.site" "2. www.jbcalling.site (WWW)" || ((errors++))
echo ""

check_domain "api.jbcalling.site" "3. api.jbcalling.site (API)" || ((errors++))
echo ""

check_domain "webrtc.jbcalling.site" "4. webrtc.jbcalling.site (WebSocket)" || ((errors++))
echo ""

check_domain "monitoring.jbcalling.site" "5. monitoring.jbcalling.site (Grafana)" || ((errors++))
echo ""

check_domain "traefik.jbcalling.site" "6. traefik.jbcalling.site (Traefik)" || ((errors++))
echo ""

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if [ $errors -eq 0 ]; then
    echo "🎉 TẤT CẢ DNS RECORDS ĐÚNG! SẴN SÀNG DEPLOY!"
    echo ""
    echo "Chạy lệnh sau để deploy:"
    echo "  cd ~/jbcalling_translation_realtime"
    echo "  ./deploy-ssl.sh"
else
    echo "⚠️  CÓ $errors RECORD CẦN SỬA TRÊN HOSTINGER"
    echo ""
    echo "Cần sửa:"
    [ $(getent hosts www.jbcalling.site 2>/dev/null | wc -l) -eq 0 ] && echo "  • Thêm: A www → 34.142.190.250"
    [ $(getent hosts traefik.jbcalling.site 2>/dev/null | wc -l) -eq 0 ] && echo "  • Thêm: A traefik → 34.142.190.250"
    [ $(getent hosts webrtc.jbcalling.site 2>/dev/null | grep -c "34.126.152.20") -gt 0 ] && echo "  • Sửa: webrtc từ 34.126.152.20 → 34.142.190.250"
fi

echo ""
