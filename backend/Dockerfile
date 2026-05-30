FROM node:22-alpine

# ── Security: create non-root user ───────────────────────────────────────────
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Install build tools for native modules (removed after build)
RUN apk add --no-cache python3 make g++

# Copy package files and install production deps as root (needs write access)
COPY --chown=nodejs:nodejs package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    apk del python3 make g++ && \
    rm -rf /root/.npm /tmp/*

# Copy source with correct ownership
COPY --chown=nodejs:nodejs . .

# Drop to non-root for runtime
USER nodejs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -q -O- http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]