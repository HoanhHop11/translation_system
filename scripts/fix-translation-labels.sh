#!/bin/bash
# =============================================================================
# FIX TRANSLATION SERVICE - Traefik Labels với Syntax Đúng
# =============================================================================

set -e

echo "🔧 Fixing Translation service Traefik labels (correct syntax)..."

# Remove old labels first
docker service update \
    --label-rm "traefik.http.middlewares.translation-cors.headers.accesscontrolallowheaders" \
    --label-rm "traefik.http.middlewares.translation-cors.headers.accesscontrolallowmethods" \
    --label-rm "traefik.http.middlewares.translation-cors.headers.accesscontrolalloworigin" \
    --label-rm "traefik.http.middlewares.translation-cors.headers.accesscontrolmaxage" \
    translation_translation

echo "✅ Old labels removed"

# Add correct labels (camelCase syntax for Traefik v3)
docker service update \
    --label-add "traefik.http.middlewares.translation-cors.headers.accessControlAllowMethods=GET,POST,OPTIONS" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accessControlAllowOriginList=*" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accessControlAllowHeaders=*" \
    --label-add "traefik.http.middlewares.translation-cors.headers.accessControlMaxAge=3600" \
    translation_translation

echo "✅ Correct labels added"
echo "⏰ Wait 30 seconds for Traefik to pick up changes..."
sleep 30

echo ""
echo "🧪 Testing..."
curl -i https://translate.jbcalling.site/health

echo ""
echo "✅ Done!"
