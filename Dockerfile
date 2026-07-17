# syntax=docker/dockerfile:1

# WACRM — multi-stage build producing a minimal Next.js standalone image.
# Node 20 matches the `engines.node >= 20` constraint in package.json.

# ── Base ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS base
# libc compat for any native deps pulled in by the toolchain.
RUN apk add --no-cache libc6-compat
WORKDIR /app

# ── Dependencies ─────────────────────────────────────────────────────
# Installed against the lockfile only, so this layer caches until the
# lockfile changes.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ────────────────────────────────────────────────────────────
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
# Brings the source AND the .env / .env.local file into the build. Next.js
# auto-loads those files during `next build`, so the NEXT_PUBLIC_* values
# get inlined into the client bundle with no build args. The env file lives
# only in this stage — it is never copied into the runtime image below, so
# server secrets stay out of the published layers. Supply those at run time
# with `docker run --env-file .env`.
COPY . .

RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Run as a non-root user.
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Static assets and public files are not bundled into server.js — copy
# them alongside the standalone server so it can serve them directly.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "server.js"]
