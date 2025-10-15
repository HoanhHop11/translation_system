# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port
EXPOSE 80

# Health check - Use curl instead of wget (wget has IPv6 issues in Alpine)
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost/ || exit 1

# Stop signal - nginx handles SIGTERM gracefully by default
STOPSIGNAL SIGTERM

# Use entrypoint script (exec makes nginx PID 1)
ENTRYPOINT ["/docker-entrypoint.sh"]

# Direct nginx command - SIMPLE IS BEST
CMD ["nginx", "-g", "daemon off;"]
