# Multi-stage build producing a minimal standalone Next.js server.
# Requires `output: 'standalone'` in next.config.ts
#
# Node 22 (active LTS). Node 20 went end-of-life in April 2026 and no longer
# receives security patches, so it must not ship to a production VPS.

# ---------- deps: full install, including devDependencies ----------
# devDependencies are needed here on purpose: the builder needs the Next toolchain
# and the migrator needs the Prisma CLI. NODE_ENV is deliberately NOT set to
# production in this stage, or npm would omit them.
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---------- builder ----------
FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# `npm run build` is `prisma generate && next build`, so the client is generated here.
RUN npm run build

# ---------- migrator: one-shot, runs `prisma migrate deploy` and exits ----------
# A separate stage because the runner image intentionally has no node_modules —
# it only carries what Next traced into .next/standalone, which excludes the
# Prisma CLI. Without this stage `prisma migrate deploy` has no CLI to run.
FROM node:22-alpine AS migrator
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
# Exits 0 when migrations apply (or none are pending) and non-zero on failure,
# which is what lets compose gate the app on it via service_completed_successfully.
CMD ["npx", "prisma", "migrate", "deploy"]

# ---------- runner ----------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# Generated Prisma client + query engine. Next's file tracing does not reliably
# pick up the platform-specific engine binary, so it is copied explicitly.
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/prisma ./prisma

USER nextjs
EXPOSE 3000
# HOSTNAME=0.0.0.0 above matters: the standalone server binds localhost by default,
# which would make it unreachable from Caddy in another container.
CMD ["node", "server.js"]
