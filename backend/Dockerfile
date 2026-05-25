FROM node:22-alpine

WORKDIR /app

# Install build tools for any native modules
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./
RUN npm ci --only=production

# Copy source
COPY . .

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s \
  CMD wget -q -O- http://localhost:4000/health || exit 1

CMD ["node", "src/server.js"]
