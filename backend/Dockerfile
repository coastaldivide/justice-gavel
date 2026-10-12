# Justice Gavel API — production image
# Build context: backend/   (Railway: set the service Root Directory to "backend")

# ── Stage 1: install production dependencies (native builds allowed) ──────────
FROM node:22-alpine AS deps
WORKDIR /app
# Toolchain only lives in this stage (native optional deps such as sqlite3,
# used by the offline scraper scripts, may need to compile on musl).
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production \
    PORT=4000 \
    REPORT_DIR=/app/tmp/reports
WORKDIR /app

# Non-root user with writable runtime directories
RUN addgroup -g 1001 -S nodejs && adduser -S -G nodejs -u 1001 nodejs \
 && mkdir -p /app/data /app/logs /app/tmp/uploads /app/tmp/reports \
 && chown -R nodejs:nodejs /app

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs . .

USER nodejs
EXPOSE 4000

# Uses $PORT so it works when the platform injects a different port
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-4000}/health" || exit 1

CMD ["node", "--import", "./src/instrument.js", "src/server.js"]
