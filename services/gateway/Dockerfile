# =============================================================================
# Stage 1: Builder - Build TypeScript và dependencies
# =============================================================================
FROM node:18-slim AS builder

# Install build dependencies (cần cho MediaSoup native modules)
# Debian-based: Tương thích tốt hơn với MediaSoup prebuilt binaries
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install ALL dependencies (including devDependencies)
# Use npm install if package-lock.json doesn't exist
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# =============================================================================
# Stage 2: Production - Runtime image
# =============================================================================
FROM node:18-slim

# Labels
LABEL maintainer="JB Calling Team"
LABEL service="gateway"
LABEL version="1.0.0"

# Install runtime dependencies (MediaSoup cần ít hơn trong runtime)
RUN apt-get update && apt-get install -y \
    tini \
    ca-certificates \
    wget \
    && rm -rf /var/lib/apt/lists/*

# Create app user (non-root)
RUN groupadd -g 1001 appgroup && \
    useradd -u 1001 -g appgroup -m appuser

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install ONLY production dependencies
# Use npm install --production if package-lock.json doesn't exist
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi && \
    npm cache clean --force

# Copy built files từ builder stage
COPY --from=builder /app/dist ./dist

# Create logs directory
RUN mkdir -p logs && \
    chown -R appuser:appgroup /app

# Switch to non-root user
USER appuser

# Expose ports
EXPOSE 3000
EXPOSE 40000-40100/udp
EXPOSE 40000-40100/tcp

# Environment variables (override trong docker-compose/swarm)
ENV NODE_ENV=production \
    PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Use tini để handle signals properly (Debian puts it in /usr/bin)
ENTRYPOINT ["/usr/bin/tini", "--"]

# Start application
CMD ["node", "dist/index.js"]
