# Infrastructure Directory

Thư mục này chứa infrastructure as code và deployment configurations.

## Cấu trúc

```
infrastructure/
├── docker-compose.yml          # Development environment
├── docker-compose.override.yml # Local overrides (gitignored)
├── swarm/                      # Production deployment
│   ├── stack.yml              # Main stack file
│   ├── stack.monitoring.yml   # Monitoring stack
│   ├── configs/               # Docker configs
│   │   ├── postgres.conf
│   │   ├── redis.conf
│   │   └── prometheus.yml
│   └── secrets/               # Secret templates (gitignored when filled)
│       └── README.md
├── monitoring/                 # Monitoring configurations
│   ├── prometheus/
│   │   ├── prometheus.yml
│   │   ├── alerts/
│   │   └── rules/
│   ├── grafana/
│   │   ├── dashboards/
│   │   └── datasources/
│   └── elk/
│       ├── elasticsearch.yml
│       ├── logstash.conf
│       └── kibana.yml
└── nginx/                      # Nginx configs (nếu dùng)
    ├── nginx.conf
    └── sites-available/
```

## Files

### docker-compose.yml
Development environment với:
- PostgreSQL
- Redis
- Prometheus
- Grafana
- Hot reload cho development

### swarm/stack.yml
Production deployment với:
- All microservices
- Proper resource limits
- Health checks
- Placement constraints
- Secrets và configs
- Networks và volumes

### monitoring/
Monitoring stack configurations:
- Prometheus scrape configs
- Grafana dashboards
- Alert rules
- ELK configuration

## Usage

### Development
```bash
# Start development environment
docker-compose up -d

# View logs
docker-compose logs -f

# Stop
docker-compose down

# Clean up (including volumes)
docker-compose down -v
```

### Production
```bash
# Deploy full stack
docker stack deploy -c swarm/stack.yml translation

# Deploy monitoring separately
docker stack deploy -c swarm/stack.monitoring.yml monitoring

# Update a service
docker service update --image new-image:tag translation_api

# Scale a service
docker service scale translation_transcription=4

# Remove stack
docker stack rm translation
```

## Secrets Management

### Development
Use `.env` file (gitignored):
```bash
cp .env.example .env
# Edit .env with real values
```

### Production
Use Docker secrets:
```bash
# Create secrets
echo "password" | docker secret create postgres_password -
echo "token" | docker secret create hf_token -

# List secrets
docker secret ls

# Remove secret
docker secret rm postgres_password
```

## Configs Management

### Development
Direct file mounts:
```yaml
volumes:
  - ./infrastructure/monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml
```

### Production
Use Docker configs:
```bash
# Create config
docker config create prometheus_config prometheus.yml

# List configs
docker config ls

# Remove config
docker config rm prometheus_config
```

## Networks

```yaml
Networks:
  app-network:      # Main application network
  data-network:     # Database network
  monitoring-network: # Monitoring network
```

## Volumes

```yaml
Volumes:
  postgres-data:         # PostgreSQL data
  redis-data:           # Redis data
  models-data:          # AI models (shared)
  voice-embeddings:     # Voice samples
  prometheus-data:      # Prometheus metrics
  grafana-data:         # Grafana configs
  elastic-data:         # Elasticsearch data
```

## Resource Allocation

Xem [01-ARCHITECTURE.md](../docs/01-ARCHITECTURE.md) section "Phân bổ Services trên Instances"

## Placement Constraints

```yaml
# Manager node only
constraints:
  - node.role == manager

# Specific node label
constraints:
  - node.labels.role == transcription

# Multiple constraints
constraints:
  - node.role == worker
  - node.labels.role == gateway
```

## Health Checks

All services có health checks:
```yaml
healthcheck:
  test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

## Logging

Sử dụng json-file logging driver:
```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

## Documentation

- [02-SETUP-GUIDE.md](../docs/02-SETUP-GUIDE.md) - Setup hướng dẫn
- [03-DOCKER-SWARM.md](../docs/03-DOCKER-SWARM.md) - Swarm chi tiết
- [08-DEPLOYMENT.md](../docs/08-DEPLOYMENT.md) - Deployment strategies
- [09-MONITORING.md](../docs/09-MONITORING.md) - Monitoring setup

## Next Steps

1. **Week 3**: Tạo docker-compose.yml cho development
2. **Week 4**: Tạo stack.yml cho production
3. **Week 5**: Setup monitoring configurations
4. **Week 8**: Finalize và test deployment

Xem [11-ROADMAP.md](../docs/11-ROADMAP.md) cho timeline chi tiết.
