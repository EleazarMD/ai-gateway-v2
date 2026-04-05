# AI Gateway v2.0.0 Enhanced with Service Mesh Protocols and AHIS Client SDK v2.2.0
# Supports WebSocket, MCP, GraphQL, gRPC for AI Homelab Ecosystem
# Production-ready deployment with PostgreSQL persistence
# Last Updated: 2025-09-25

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Install runtime dependencies (no SQLite3 native compilation needed)
RUN apk add --no-cache sqlite

# Copy package files
COPY package*.json ./

# Copy source code first to get local AHIS SDK
COPY . .

# Install dependencies with fallback for SQLite3 issues
RUN npm ci --only=production --ignore-scripts || npm ci --only=production

# Install WebSocket dependency for Dashboard integration
RUN npm install ws@^8.14.2

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S aigateway -u 1001

# Change ownership
RUN chown -R aigateway:nodejs /app
USER aigateway

# Expose ports per PORT_REGISTRY.yml
EXPOSE 7777 8777 7778

# Health check for Kubernetes
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const options = { hostname: 'localhost', port: 7777, path: '/health', method: 'GET', headers: { 'X-API-Key': process.env.API_KEY || 'ai-gateway-api-key-2024' } }; const req = http.request(options, (res) => { if (res.statusCode === 200) { process.exit(0); } else { process.exit(1); } }); req.on('error', () => process.exit(1)); req.end();"

# Start AI Gateway v2.0 with Service Mesh
CMD ["node", "server.js"]
