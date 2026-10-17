# API (Express). Build từ thư mục gốc repo:  docker build -f deploy/api.Dockerfile .
FROM node:24-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/crm-web/package.json apps/crm-web/
COPY apps/lms-web/package.json apps/lms-web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY packages/web-core/package.json packages/web-core/

FROM base AS build
RUN npm ci -w @zero1/api --include-workspace-root
COPY packages/config packages/config
COPY apps/api apps/api
RUN npm run build -w @zero1/api

# Chỉ dependency chạy thật của API (không devDependencies, không gói của web).
FROM base AS prod-deps
RUN npm ci -w @zero1/api --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app ./
COPY --from=build /app/apps/api/dist apps/api/dist
COPY apps/api/drizzle apps/api/drizzle
COPY apps/api/assets apps/api/assets
RUN mkdir -p /data/uploads && chown node:node /data/uploads
USER node
WORKDIR /app/apps/api
ENV UPLOAD_DIR=/data/uploads PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1
# Chạy migration (idempotent) rồi khởi động; quyền/vai trò được đồng bộ lúc khởi động.
CMD ["sh", "-c", "node dist/cli/migrate.js && exec node dist/main.js"]
