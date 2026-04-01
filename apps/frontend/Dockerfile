# ── Stage 1: Builder ─────────────────────────────────────────
FROM registry.pcs.my.id/playwright:latest AS builder

WORKDIR /app

# Copy hanya package files dulu (layer caching)
COPY apps/frontend/package.json ./

# Install dependencies
RUN npm install

# Copy seluruh source frontend
COPY apps/frontend/ ./

# Build Next.js (NEXT_PUBLIC_ harus di-set saat build time)
ARG NEXT_PUBLIC_API_URL=https://api.sayabayar.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL

ARG NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY

RUN npm run build

# ── Stage 2: Runner ──────────────────────────────────────────
FROM registry.pcs.my.id/playwright:latest AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta

# Standalone output sudah include server.js + node_modules minimal
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# server.js di-generate oleh Next.js standalone
CMD ["node", "server.js"]
