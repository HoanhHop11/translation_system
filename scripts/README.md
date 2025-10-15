# Scripts Directory

Automation scripts cho setup, deployment, và maintenance.

## Cấu trúc

```
scripts/
├── setup/              # Initial setup scripts
│   ├── install_docker.sh
│   ├── init_swarm.sh
│   ├── download_models.py
│   └── create_secrets.sh
├── deploy/             # Deployment scripts
│   ├── deploy_dev.sh
│   ├── deploy_prod.sh
│   ├── rollback.sh
│   └── health_check.sh
├── maintenance/        # Maintenance scripts
│   ├── backup.sh
│   ├── restore.sh
│   ├── cleanup.sh
│   └── update_models.py
├── monitoring/         # Monitoring scripts
│   ├── check_health.sh
│   ├── collect_metrics.py
│   └── generate_report.py
└── utils/              # Utility scripts
    ├── ssh_all.sh
    ├── logs.sh
    └── scale_service.sh
```

## Setup Scripts

### install_docker.sh
Cài đặt Docker trên Ubuntu instance:
```bash
./scripts/setup/install_docker.sh
```

### init_swarm.sh
Initialize Docker Swarm cluster:
```bash
# On manager node
./scripts/setup/init_swarm.sh manager

# On worker nodes
./scripts/setup/init_swarm.sh worker <JOIN_TOKEN> <MANAGER_IP>
```

### download_models.py
Download tất cả AI models:
```bash
export HF_TOKEN="your_token"
python scripts/setup/download_models.py
```

### create_secrets.sh
Tạo Docker secrets:
```bash
./scripts/setup/create_secrets.sh
```

## Deployment Scripts

### deploy_dev.sh
Deploy development environment:
```bash
./scripts/deploy/deploy_dev.sh
```

### deploy_prod.sh
Deploy production stack:
```bash
./scripts/deploy/deploy_prod.sh [stack_name]
```

### rollback.sh
Rollback to previous version:
```bash
./scripts/deploy/rollback.sh <service_name> <version>
```

### health_check.sh
Check health của tất cả services:
```bash
./scripts/deploy/health_check.sh
```

## Maintenance Scripts

### backup.sh
Backup databases và configs:
```bash
./scripts/maintenance/backup.sh [destination]
```

### restore.sh
Restore from backup:
```bash
./scripts/maintenance/restore.sh <backup_file>
```

### cleanup.sh
Clean up old images, volumes, logs:
```bash
./scripts/maintenance/cleanup.sh [--aggressive]
```

### update_models.py
Update AI models to newer versions:
```bash
python scripts/maintenance/update_models.py [model_name]
```

## Monitoring Scripts

### check_health.sh
Periodic health checks:
```bash
./scripts/monitoring/check_health.sh
```

### collect_metrics.py
Collect và aggregate metrics:
```bash
python scripts/monitoring/collect_metrics.py [--output report.json]
```

### generate_report.py
Generate system report:
```bash
python scripts/monitoring/generate_report.py [--format html|pdf]
```

## Utility Scripts

### ssh_all.sh
Execute command trên tất cả nodes:
```bash
./scripts/utils/ssh_all.sh "docker ps"
```

### logs.sh
View logs của service:
```bash
./scripts/utils/logs.sh <service_name> [--follow]
```

### scale_service.sh
Scale service replicas:
```bash
./scripts/utils/scale_service.sh <service_name> <replicas>
```

## Usage Guidelines

### Script Standards
- Bash scripts: Use strict mode
  ```bash
  #!/bin/bash
  set -euo pipefail
  ```
- Python scripts: Type hints, docstrings
- Error handling: Proper exit codes
- Logging: Clear, actionable messages

### Making Scripts Executable
```bash
chmod +x scripts/**/*.sh
```

### Testing Scripts
```bash
# Dry run mode
./script.sh --dry-run

# Verbose mode
./script.sh --verbose

# Test mode
./script.sh --test
```

## Environment Variables

Scripts sử dụng environment variables:

```bash
# Set in ~/.bashrc hoặc ~/.zshrc
export SWARM_MANAGER_IP="10.148.0.2"
export DOCKER_REGISTRY="your-registry"
export HF_TOKEN="your_hf_token"
export BACKUP_DIR="/backups"
```

## Scheduling

### Cron Jobs
```bash
# Edit crontab
crontab -e

# Backup daily at 2 AM
0 2 * * * /path/to/scripts/maintenance/backup.sh

# Health check every 5 minutes
*/5 * * * * /path/to/scripts/monitoring/check_health.sh

# Cleanup weekly on Sunday at 3 AM
0 3 * * 0 /path/to/scripts/maintenance/cleanup.sh
```

## Logging

Scripts log to:
- STDOUT: Normal operations
- STDERR: Errors
- File: `/var/log/translation-scripts/`

```bash
# Create log directory
sudo mkdir -p /var/log/translation-scripts
sudo chown $USER:$USER /var/log/translation-scripts
```

## Documentation

Each script PHẢI có:
- Header với description
- Usage examples
- Required environment variables
- Exit codes
- Examples

Example:
```bash
#!/bin/bash
# Description: Deploy production stack
# Usage: ./deploy_prod.sh [stack_name]
# Environment: SWARM_MANAGER_IP, DOCKER_REGISTRY
# Exit codes: 0=success, 1=error, 2=invalid args
```

## Development

### Adding New Script
1. Create script trong appropriate directory
2. Add shebang và set -euo pipefail
3. Write clear help message
4. Add error handling
5. Test thoroughly
6. Document in this README
7. Make executable
8. Commit

### Testing
```bash
# Test script syntax
bash -n script.sh

# Test with shellcheck
shellcheck script.sh

# Test Python script
pylint script.py
mypy script.py
```

## Related Documentation

- [02-SETUP-GUIDE.md](../docs/02-SETUP-GUIDE.md) - Manual setup steps
- [08-DEPLOYMENT.md](../docs/08-DEPLOYMENT.md) - Deployment process
- [09-MONITORING.md](../docs/09-MONITORING.md) - Monitoring setup

## Next Steps

Scripts sẽ được tạo theo phases:
- **Week 3**: Setup scripts
- **Week 5**: Deployment scripts
- **Week 10**: Maintenance scripts
- **Week 20**: Monitoring scripts

Xem [11-ROADMAP.md](../docs/11-ROADMAP.md) cho chi tiết.
