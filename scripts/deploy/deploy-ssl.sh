#!/bin/bash

# =============================================================================
# JB CALLING - DEPLOY SSL STACK
# =============================================================================
# Script tự động deploy stack với Traefik và Let's Encrypt SSL
# Usage: ./deploy-ssl.sh [--staging]
# =============================================================================

set -e  # Exit on error

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
    echo -e "${BLUE}ℹ ${1}${NC}"
}

log_success() {
    echo -e "${GREEN}✅ ${1}${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ ${1}${NC}"
}

log_error() {
    echo -e "${RED}❌ ${1}${NC}"
}

# Check if running on manager node
check_manager() {
    log_info "Checking if this is a manager node..."
    if ! docker node ls &>/dev/null; then
        log_error "This script must run on a Docker Swarm manager node"
        exit 1
    fi
    log_success "Running on manager node"
}

# Load environment variables
load_env() {
    log_info "Loading environment variables..."
    if [ ! -f .env ]; then
        log_error ".env file not found!"
        exit 1
    fi
    source .env
    log_success "Environment loaded"
}

# Check DNS
check_dns() {
    log_info "Checking DNS records..."
    
    domains=(
        "${DOMAIN_NAME}"
        "www.${DOMAIN_NAME}"
        "${API_DOMAIN}"
        "${WEBRTC_DOMAIN}"
        "${MONITORING_DOMAIN}"
    )
    
    all_ok=true
    for domain in "${domains[@]}"; do
        ip=$(dig +short "$domain" @8.8.8.8 | head -n 1)
        if [ -z "$ip" ]; then
            log_warning "DNS not resolved: $domain"
            all_ok=false
        else
            log_success "$domain → $ip"
        fi
    done
    
    if [ "$all_ok" = false ]; then
        log_warning "Some DNS records not resolved. Continue anyway? (y/n)"
        read -r response
        if [ "$response" != "y" ]; then
            exit 1
        fi
    fi
}

# Check firewall
check_firewall() {
    log_info "Checking firewall ports..."
    
    ports=(80 443 8001)
    for port in "${ports[@]}"; do
        if sudo netstat -tulpn | grep ":$port " &>/dev/null; then
            log_success "Port $port is listening"
        else
            log_warning "Port $port is not listening (will be after Traefik starts)"
        fi
    done
}

# Backup current stack
backup_stack() {
    log_info "Backing up current stack state..."
    
    mkdir -p backups
    backup_file="backups/stack-backup-$(date +%Y%m%d-%H%M%S).txt"
    
    if docker stack ls | grep -q "translation"; then
        docker stack services translation > "$backup_file"
        log_success "Backup saved to $backup_file"
    else
        log_info "No existing stack to backup"
    fi
}

# Remove old stack
remove_old_stack() {
    log_info "Checking for existing stack..."
    
    if docker stack ls | grep -q "translation"; then
        log_warning "Removing existing stack..."
        docker stack rm translation
        
        log_info "Waiting for services to stop..."
        sleep 20
        
        # Wait for all containers to stop
        while docker ps | grep -q "translation_"; do
            echo -n "."
            sleep 2
        done
        echo ""
        
        log_success "Old stack removed"
    else
        log_info "No existing stack found"
    fi
}

# Deploy new stack
deploy_stack() {
    local staging=$1
    
    log_info "Deploying new stack with SSL..."
    
    # Check if stack file exists
    if [ ! -f infrastructure/swarm/stack-with-ssl.yml ]; then
        log_error "stack-with-ssl.yml not found!"
        exit 1
    fi
    
    # Deploy
    docker stack deploy -c infrastructure/swarm/stack-with-ssl.yml translation
    
    log_success "Stack deployed"
}

# Wait for services
wait_for_services() {
    log_info "Waiting for services to start..."
    
    local max_wait=120  # 2 minutes
    local elapsed=0
    
    while [ $elapsed -lt $max_wait ]; do
        # Count running services
        total=$(docker stack services translation --format "{{.Name}}" | wc -l)
        ready=0
        
        for service in $(docker stack services translation --format "{{.Name}}"); do
            replicas=$(docker stack services translation --format "{{.Replicas}}" --filter "name=$service")
            if [[ "$replicas" =~ ^([0-9]+)/\1 ]]; then
                ready=$((ready + 1))
            fi
        done
        
        echo -ne "\r⏳ Services ready: $ready/$total"
        
        if [ $ready -eq $total ]; then
            echo ""
            log_success "All services are ready!"
            return 0
        fi
        
        sleep 5
        elapsed=$((elapsed + 5))
    done
    
    echo ""
    log_warning "Timeout waiting for services. Check status manually."
}

# Show service status
show_status() {
    log_info "Service Status:"
    echo ""
    docker stack services translation
    echo ""
}

# Check Traefik logs for certificates
check_certificates() {
    log_info "Checking SSL certificates..."
    
    traefik_container=$(docker ps -q -f name=translation_traefik | head -n 1)
    
    if [ -z "$traefik_container" ]; then
        log_warning "Traefik container not found"
        return
    fi
    
    log_info "Traefik logs (last 20 lines):"
    docker logs "$traefik_container" --tail 20 2>&1 | grep -i "certificate\|acme\|error" || true
    echo ""
}

# Show URLs
show_urls() {
    echo ""
    log_success "🎉 Deployment completed!"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "📱 Frontend:     https://${DOMAIN_NAME}"
    echo "🔌 API Docs:     https://${API_DOMAIN}/docs"
    echo "❤️  API Health:   https://${API_DOMAIN}/health"
    echo "📊 Monitoring:   https://${MONITORING_DOMAIN}"
    echo "🚦 Traefik:      https://traefik.${DOMAIN_NAME}"
    echo "🔌 WebSocket:    wss://${WEBRTC_DOMAIN}"
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    log_info "SSL certificates will be issued on first request (30-60s)"
    log_info "Check Traefik logs: sudo docker service logs translation_traefik -f"
    echo ""
}

# Test SSL
test_ssl() {
    log_info "Testing SSL endpoints..."
    echo ""
    
    sleep 10  # Give Traefik time to start
    
    # Test frontend
    if curl -k -s -o /dev/null -w "%{http_code}" "https://${DOMAIN_NAME}" | grep -q "200\|301\|302"; then
        log_success "Frontend accessible"
    else
        log_warning "Frontend not accessible yet (may need time for SSL cert)"
    fi
    
    # Test API
    if curl -k -s -o /dev/null -w "%{http_code}" "https://${API_DOMAIN}/health" | grep -q "200"; then
        log_success "API accessible"
    else
        log_warning "API not accessible yet"
    fi
}

# Main
main() {
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  JB CALLING - SSL DEPLOYMENT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    
    # Parse arguments
    staging=false
    if [ "$1" = "--staging" ]; then
        staging=true
        log_warning "Using Let's Encrypt STAGING environment"
    fi
    
    # Run checks and deployment
    check_manager
    load_env
    check_dns
    check_firewall
    backup_stack
    remove_old_stack
    deploy_stack "$staging"
    wait_for_services
    show_status
    check_certificates
    show_urls
    test_ssl
    
    log_success "Deployment script completed!"
}

# Run main
main "$@"
