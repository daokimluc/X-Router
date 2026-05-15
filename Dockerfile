# Stage 1: Build Dashboard
FROM node:22-alpine AS dashboard-build
WORKDIR /app/dashboard
COPY apps/dashboard/package.json apps/dashboard/package-lock.json ./
RUN npm ci
COPY apps/dashboard/ ./
RUN npm run build

# Stage 2: Build Gateway
FROM node:22-alpine AS gateway-build
WORKDIR /app/gateway
COPY apps/gateway/package.json apps/gateway/package-lock.json ./
RUN npm ci
COPY apps/gateway/ ./
RUN npm run build
RUN npm prune --omit=dev

# Stage 3: Final image
FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -S gateway && adduser -S gateway -G gateway
COPY --from=gateway-build /app/gateway/dist ./dist
COPY --from=gateway-build /app/gateway/node_modules ./node_modules
COPY --from=gateway-build /app/gateway/package.json ./package.json
COPY --from=dashboard-build /app/dashboard/dist ./dashboard-dist
COPY bin/ ./bin/
USER gateway
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bin/ai-gateway.js"]
