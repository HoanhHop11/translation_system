#!/bin/bash
# Quick deploy script cho Phase 2

# Load .env
export POSTGRES_DB="jbcalling_db"
export POSTGRES_USER="jbcalling"
export POSTGRES_PASSWORD="jfUFB0nBDF4opzopizrgd2Tg0EFX95c6WpTSmzm4KDU="
export REDIS_PASSWORD="DjDu1tvKxXw6pyV+W9XEN31TySQFx6ofXVti0cvO5xA="
export REDIS_MAXMEMORY="2gb"
export REDIS_MAXMEMORY_POLICY="allkeys-lru"

export DOCKER_REGISTRY=""
export APP_VERSION="1.0.0"
export JWT_SECRET_KEY="a5bd104dcd913439e9ed2a1ebbc7b0218932a6a8fdbcef109bd6c02f47d33b5a"
export JWT_ALGORITHM="HS256"
export ACCESS_TOKEN_EXPIRE_MINUTES="30"
export REFRESH_TOKEN_EXPIRE_DAYS="7"

export APP_ENV="production"
export CORS_ORIGINS="http://34.142.190.250,http://34.126.138.3,http://34.143.235.114,https://jbcalling.site,https://api.jbcalling.site"
export FRONTEND_PORT="80"

export PROMETHEUS_RETENTION_TIME="15d"
export PROMETHEUS_PORT="9090"
export GRAFANA_ADMIN_USER="admin"
export GRAFANA_ADMIN_PASSWORD="1z5c3XEf+dKTvM8KvujWww=="
export LOKI_PORT="3100"

# Deploy stack
docker stack deploy -c stack.yml translation
