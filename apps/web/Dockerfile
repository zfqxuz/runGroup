# syntax=docker/dockerfile:1

# ---------- 基础层 ----------
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /repo

# ---------- 依赖层：只复制 manifest，最大化缓存命中 ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/formula/package.json ./packages/formula/
COPY packages/rules/package.json ./packages/rules/
COPY packages/combat/package.json ./packages/combat/
RUN npm ci --no-audit --no-fund

# ---------- 构建层 ----------
FROM deps AS builder
COPY . .
RUN npx prisma generate --schema apps/web/prisma/schema.prisma
RUN npm run build --workspace @touhou/web

# ---------- 运行层 ----------
FROM base AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
RUN addgroup -S app && adduser -S app -G app

COPY --from=builder --chown=app:app /repo/node_modules ./node_modules
COPY --from=builder --chown=app:app /repo/package.json ./package.json
COPY --from=builder --chown=app:app /repo/package-lock.json ./package-lock.json
COPY --from=builder --chown=app:app /repo/apps/web ./apps/web
COPY --from=builder --chown=app:app /repo/packages ./packages

USER app
EXPOSE 3000
CMD ["npm", "run", "start", "--workspace", "@touhou/web"]
