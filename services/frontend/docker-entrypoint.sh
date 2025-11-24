#!/bin/sh
# Production-ready entrypoint for nginx in Docker Swarm
# Injects runtime environment variables into React app

set -e

echo "Injecting runtime environment variables..."

# Create env-config.js with runtime environment variables
cat > /usr/share/nginx/html/env-config.js <<EOF
window._env_ = {
  REACT_APP_GATEWAY_URL: "${REACT_APP_GATEWAY_URL}",
  REACT_APP_SIGNALING_URL: "${REACT_APP_SIGNALING_URL}",
  REACT_APP_TURN_SERVER: "${REACT_APP_TURN_SERVER}",
  REACT_APP_TURN_USERNAME: "${REACT_APP_TURN_USERNAME}",
  REACT_APP_TURN_SECRET: "${REACT_APP_TURN_SECRET}",
  REACT_APP_STUN_SERVERS: "${REACT_APP_STUN_SERVERS}",
  REACT_APP_STT_SERVICE_URL: "${REACT_APP_STT_SERVICE_URL}",
  REACT_APP_TRANSLATION_SERVICE_URL: "${REACT_APP_TRANSLATION_SERVICE_URL}",
  REACT_APP_TTS_SERVICE_URL: "${REACT_APP_TTS_SERVICE_URL}"
};
EOF

echo "Environment variables injected successfully"
echo "GATEWAY_URL: ${REACT_APP_GATEWAY_URL}"
echo "SIGNALING_URL: ${REACT_APP_SIGNALING_URL}"
echo "TURN_SERVER: ${REACT_APP_TURN_SERVER}"
echo "STT_SERVICE_URL: ${REACT_APP_STT_SERVICE_URL}"
echo "TRANSLATION_SERVICE_URL: ${REACT_APP_TRANSLATION_SERVICE_URL}"
echo "TTS_SERVICE_URL: ${REACT_APP_TTS_SERVICE_URL}"

echo "Starting nginx in foreground mode..."

# Use 'exec' to replace this shell process with nginx
# nginx becomes PID 1 and handles all signals (SIGTERM, SIGQUIT) properly
exec nginx -g 'daemon off;'
