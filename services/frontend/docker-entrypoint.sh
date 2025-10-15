#!/bin/sh
# Production-ready entrypoint for nginx in Docker Swarm
# Uses 'exec' to replace shell with nginx process, making nginx PID 1
# This allows nginx to receive signals directly from Docker/Swarm

set -e

echo "Starting nginx in foreground mode..."

# Use 'exec' to replace this shell process with nginx
# nginx becomes PID 1 and handles all signals (SIGTERM, SIGQUIT) properly
exec nginx -g 'daemon off;'
