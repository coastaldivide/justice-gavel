# Justice Gavel API — production image
#
# Build context: the REPO ROOT (the image also carries supabase/migrations for
# the pre-deploy migration step). Render builds it from render.yaml
# (dockerContext: ., dockerfilePath: ./backend/Dockerfile). By hand:
#   docker build -f backend/Dockerfile -t justice-gavel-api .
#   docker run --env-file backend/.env -p 4000:10000 justice-gavel-api
# What goes into the context is controlled by the repo-root .dockerignore.

# ── Stage 1: install production dependencies (native builds allowed) ──────────
FROM node:22-alpine AS deps
WORKDIR /app
# Toolchain only lives in this stage, in case a native dependency (e.g.
# @sentry/profiling-node without a musl prebuild) has to compile. The scraper
# scripts no longer use SQLite; they write the main Postgres database.
RUN apk add --no-cache python3 make g++
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# ── Stage 2: runtime ───────────────────────────────────────────────────────────
FROM node:22-alpine
# PORT: Render injects PORT (default 10000); this default matches it.
ENV NODE_ENV=production \
    PORT=10000 \
    REPORT_DIR=/app/tmp/reports
WORKDIR /app

# psql for the pre-deploy migration step (scripts/migrate.sh). The client
# speaks to any supported server version (Supabase runs Postgres 15/17).
RUN apk add --no-cache postgresql-client

# Non-root user with writable runtime directories
RUN addgroup -g 1001 -S nodejs && adduser -S -G nodejs -u 1001 nodejs \
 && mkdir -p /app/data /app/logs /app/tmp/uploads /app/tmp/reports \
 && chown -R nodejs:nodejs /app

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs backend/ ./
# Same relative layout as the repo: /app/scripts/../../supabase/migrations
COPY --chown=nodejs:nodejs supabase/migrations/ /supabase/migrations/

USER nodejs
EXPOSE 10000

# Uses $PORT so it works whatever port the platform injects
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT:-10000}/health" || exit 1

CMD ["node", "--import", "./src/instrument.js", "src/server.js"]
