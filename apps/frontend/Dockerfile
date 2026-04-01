# ── Stage 1: Builder ─────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files dulu (layer caching optimal)
COPY package.json package-lock.json* ./

# Install semua dependencies
RUN npm install

# Copy seluruh source frontend
COPY . ./

# NEXT_PUBLIC_* harus di-set saat BUILD TIME (bukan runtime)
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY=$NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY

# Build Next.js (menghasilkan .next/standalone)
RUN npm run build

# ── Stage 2: Runner ──────────────────────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Jakarta

# Standalone output sudah include server.js + minimal node_modules
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000

# server.js di-generate oleh Next.js standalone build
CMD ["node", "server.js"]
