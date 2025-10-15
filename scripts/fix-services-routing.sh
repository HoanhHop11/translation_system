#!/bin/bash
# =============================================================================
# FIX SERVICES ROUTING - Phase 3 Hotfix
# =============================================================================
# Issues:
#   1. Translation service: No Traefik labels → 404
#   2. TTS service: Permission denied on cache directory → 500
#   3. CORS: Missing headers
# Solution:
#   - Update Translation service với Traefik labels đúng
#   - Fix TTS cache permissions
#   - Thêm CORS middleware
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${BLUE}  FIX SERVICES ROUTING - OCTOBER 6, 2025${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""

# Check if running on manager node
if ! docker node ls &>/dev/null; then
    echo -e "${RED}❌ ERROR: Script must run on Docker Swarm manager node${NC}"
    exit 1
fi

echo -e "${YELLOW}📋 Current Issues:${NC}"
echo "  1. Translation service: No Traefik labels → 404"
echo "  2. TTS service: Permission denied on cache → 500"
echo "  3. CORS: Missing headers"
echo ""

# =============================================================================
# FIX 1: Update Translation Service với Traefik Labels
# =============================================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}FIX 1: Update Translation Service Labels${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}⏳ Updating Translation service với Traefik labels...${NC}"

docker service update \
    --label-add "traefik.enable=true" \
    --label-add "traefik.http.routers.translation.rule=Host(\`translate.jbcalling.site\`)" \
    --label-add "traefik.http.routers.translation.entrypoints=websecure" \
    --label-add "traefik.http.routers.translation.tls.certresolver=letsencrypt" \
    --label-add "traefik.http.routers.translation.service=translation" \
    --label-add "traefik.http.services.translation.loadbalancer.server.port=8003" \
    --label-add "traefik.http.routers.translation.middlewares=translation-cors" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accesscontrolallowmethods=GET,POST,OPTIONS" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accesscontrolalloworigin=*" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accesscontrolallowheaders=*" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accesscontrolmaxage=3600" \
    translation_translation

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Translation service labels updated${NC}"
else
    echo -e "${RED}❌ Failed to update Translation service${NC}"
    exit 1
fi

echo ""

# =============================================================================
# FIX 2: Fix TTS Cache Permissions
# =============================================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}FIX 2: Fix TTS Cache Permissions${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}⏳ Updating TTS service với tmpfs mount cho cache...${NC}"

# Remove cache volume mount, use tmpfs instead (fixes permission issues)
docker service update \
    --mount-rm /app/cache \
    --mount type=tmpfs,destination=/app/cache,tmpfs-size=1073741824 \
    translation_tts

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ TTS cache mount updated (using tmpfs)${NC}"
else
    echo -e "${RED}❌ Failed to update TTS service${NC}"
    exit 1
fi

echo ""

# =============================================================================
# VERIFICATION
# =============================================================================
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}VERIFICATION${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${YELLOW}⏳ Waiting for services to update (30 seconds)...${NC}"
sleep 30

echo ""
echo -e "${YELLOW}📊 Checking Translation service labels:${NC}"
docker service inspect translation_translation | grep -A 5 '"Labels"' | head -20

echo ""
echo -e "${YELLOW}📊 Checking TTS service mounts:${NC}"
docker service inspect translation_tts | grep -A 10 '"Mounts"'

echo ""
echo -e "${YELLOW}📊 Service status:${NC}"
docker service ps translation_translation --no-trunc | head -5
docker service ps translation_tts --no-trunc | head -5

echo ""
echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}✅ SERVICES UPDATED${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""
echo -e "${YELLOW}⏰ Wait 2-3 minutes for replicas to restart, then test:${NC}"
echo ""
echo "  📝 Translation health:"
echo "     curl -i https://translate.jbcalling.site/health"
echo ""
echo "  📝 TTS health:"
echo "     curl -i https://tts.jbcalling.site/health"
echo ""
echo "  📝 Test translation:"
echo "     curl -X POST https://translate.jbcalling.site/translate \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"text\":\"Hello\",\"src_lang\":\"en\",\"tgt_lang\":\"vi\"}'"
echo ""
echo "  📝 Test TTS:"
echo "     curl -X POST https://tts.jbcalling.site/synthesize \\"
echo "       -H 'Content-Type: application/json' \\"
echo "       -d '{\"text\":\"Xin chào\",\"engine\":\"gtts\",\"language\":\"vi\"}'"
echo ""
echo -e "${YELLOW}🔍 Monitor logs:${NC}"
echo "     docker service logs -f translation_translation"
echo "     docker service logs -f translation_tts"
echo ""
