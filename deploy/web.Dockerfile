# CRM + LMS (static) phục vụ bởi Caddy, kèm reverse proxy /api, /files tới API và HTTPS tự động.
# Build từ thư mục gốc repo:  docker build -f deploy/web.Dockerfile --build-arg VITE_CRM_URL=... .
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/crm-web/package.json apps/crm-web/
COPY apps/lms-web/package.json apps/lms-web/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
COPY packages/ui/package.json packages/ui/
COPY packages/web-core/package.json packages/web-core/
RUN npm ci -w @zero1/crm-web -w @zero1/lms-web --include-workspace-root
COPY packages packages
COPY apps/crm-web apps/crm-web
COPY apps/lms-web apps/lms-web
# Link chuyển qua lại giữa 2 app. API gọi cùng origin (/api) nên không cần VITE_API_URL.
ARG VITE_CRM_URL
ARG VITE_LMS_URL
RUN test -n "$VITE_CRM_URL" && test -n "$VITE_LMS_URL" \
 && npm run build -w @zero1/crm-web && npm run build -w @zero1/lms-web

FROM caddy:2.10-alpine
COPY --from=build /app/apps/crm-web/dist /srv/crm
COPY --from=build /app/apps/lms-web/dist /srv/lms
COPY deploy/Caddyfile /etc/caddy/Caddyfile
