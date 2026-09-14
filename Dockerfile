# syntax=docker/dockerfile:1

# ---- build ---------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime --------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist

# SQLite data lives here; mount a volume to persist it across container restarts.
RUN mkdir -p /app/data \
  && addgroup -S mcp && adduser -S mcp -G mcp \
  && chown -R mcp:mcp /app
USER mcp
VOLUME ["/app/data"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# MCP_API_KEY should be provided at `docker run` / deploy time, not baked into the image.
CMD ["node", "dist/http.js"]
