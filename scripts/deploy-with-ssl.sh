#!/bin/bash
# =============================================================================
# Deploy Script - JB Calling với SSL và Environment Variables
# =============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}JB Calling - SSL Stack Deployment${NC}"
echo -e "${BLUE}========================================${NC}"

# Load environment variables from .env
if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Loading environment variables from .env${NC}"
export $(grep -v '^#' .env | grep -v '^$' | xargs)

# Verify critical variables
if [ -z "$DOMAIN_NAME" ]; then
    echo -e "${RED}Error: DOMAIN_NAME not set in .env${NC}"
    exit 1
fi

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo -e "${RED}Error: LETSENCRYPT_EMAIL not set in .env${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Domain: $DOMAIN_NAME${NC}"
echo -e "${GREEN}✅ SSL Email: $LETSENCRYPT_EMAIL${NC}"

# Export variables for docker stack deploy
export DOMAIN_NAME
export API_DOMAIN
export WEBRTC_DOMAIN
export MONITORING_DOMAIN
export LETSENCRYPT_EMAIL
export POSTGRES_PASSWORD
export POSTGRES_USER
export POSTGRES_DB
export REDIS_PASSWORD
export REDIS_MAXMEMORY
export REDIS_MAXMEMORY_POLICY
export JWT_SECRET_KEY
export APP_ENV
export LOG_LEVEL

echo -e "\n${YELLOW}Deploying stack with environment variables...${NC}"
echo -e "${YELLOW}Stack file: infrastructure/swarm/stack-with-ssl.yml${NC}"

# Deploy stack
docker stack deploy -c infrastructure/swarm/stack-with-ssl.yml translation

echo -e "\n${GREEN}✅ Stack deployed successfully!${NC}"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Services Status:${NC}"
echo -e "${BLUE}========================================${NC}"
docker service ls

echo -e "\n${YELLOW}Waiting for services to start (30 seconds)...${NC}"
sleep 30

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Service Endpoints:${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}🎤 STT:           https://stt.$DOMAIN_NAME${NC}"
echo -e "${GREEN}🌐 Translation:   https://translate.$DOMAIN_NAME${NC}"
echo -e "${GREEN}🔊 TTS:           https://tts.$DOMAIN_NAME${NC}"
echo -e "${GREEN}📊 Grafana:       https://monitoring.$DOMAIN_NAME${NC}"
echo -e "${GREEN}🔀 Traefik:       https://traefik.$DOMAIN_NAME${NC}"
echo -e "${GREEN}🌐 Frontend:      https://$DOMAIN_NAME${NC}"
echo -e "${GREEN}⚡ API:           https://api.$DOMAIN_NAME${NC}"

echo -e "\n${YELLOW}Note: SSL certificates will be generated automatically by Let's Encrypt${NC}"
echo -e "${YELLOW}This may take 1-2 minutes on first deployment${NC}"

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}Quick Health Check:${NC}"
echo -e "${BLUE}========================================${NC}"

sleep 10

echo -e "\n${YELLOW}Checking STT service...${NC}"
curl -k -s https://stt.$DOMAIN_NAME/health | python3 -m json.tool 2>/dev/null || echo "⏳ Waiting for SSL cert..."

echo -e "\n${YELLOW}Checking Translation service...${NC}"
curl -k -s https://translate.$DOMAIN_NAME/health | python3 -m json.tool 2>/dev/null || echo "⏳ Waiting for SSL cert..."

echo -e "\n${YELLOW}Checking TTS service...${NC}"
curl -k -s https://tts.$DOMAIN_NAME/health | python3 -m json.tool 2>/dev/null || echo "⏳ Waiting for SSL cert..."

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment completed!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "\n${YELLOW}Check Traefik dashboard: https://traefik.$DOMAIN_NAME${NC}"
echo -e "${YELLOW}Monitor services: docker service ls${NC}"
echo -e "${YELLOW}View logs: docker service logs translation_<service_name>${NC}"
