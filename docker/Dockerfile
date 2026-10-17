FROM node:20-alpine AS builder

# Security: run as non-root
RUN addgroup -S vaultgroup && adduser -S vaultuser -G vaultgroup

WORKDIR /app

# Copy only package files first (layer cache optimization)
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy source and build
COPY tsconfig.json ./
COPY src ./src
RUN npm install --save-dev typescript && npx tsc --project tsconfig.json

# -------- Production image --------
FROM node:20-alpine AS production

RUN addgroup -S vaultgroup && adduser -S vaultuser -G vaultgroup

WORKDIR /app

# Copy only what's needed
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY package.json ./

# Security hardening
RUN chown -R vaultuser:vaultgroup /app
USER vaultuser

# Healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

EXPOSE 3000

CMD ["node", "dist/server.js"]
