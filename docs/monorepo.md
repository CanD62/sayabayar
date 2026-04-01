# Monorepo & Deployment — Payment Gateway Platform
> Version 1.0 | pnpm workspaces + Docker Compose

---

## Daftar Isi

1. [Kenapa Monorepo](#kenapa-monorepo)
2. [Struktur Folder](#struktur-folder)
3. [Setup pnpm Workspaces](#setup-pnpm-workspaces)
4. [Shared Package](#shared-package)
5. [Dockerfile per App](#dockerfile-per-app)
6. [Docker Compose](#docker-compose)
7. [Environment Variables](#environment-variables)
8. [Infrastruktur](#infrastruktur)

---

## Kenapa Monorepo

3 service (frontend, api, scraper) punya kebutuhan berbeda tapi berbagi kode yang sama — tipe data, konstanta, helper enkripsi.

```
Tanpa monorepo:
  Tipe Invoice didefinisikan di api/  → copy-paste ke scraper/ → tidak sinkron
  Helper encrypt didefinisikan di api/ → copy-paste ke scraper/ → duplikasi

Dengan monorepo:
  packages/shared/ → dipakai api/ dan scraper/ sekaligus
  Satu perubahan → semua service ikut update otomatis
```

---

## Struktur Folder

```
payment-gateway/
│
├── apps/
│   ├── frontend/               → Next.js (dashboard klien + payment page)
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   ├── api/                    → Fastify (REST API + SSE)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── middleware/
│   │   │   ├── plugins/
│   │   │   └── index.js
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── scraper/                → Playwright + BullMQ workers
│       ├── src/
│       │   ├── scrapers/       → BCATransferScraper, QRISBCAScraper, dll
│       │   ├── workers/        → scrapeWorker, matchWorker, webhookWorker
│       │   ├── scheduler/
│       │   ├── browserPool.js
│       │   ├── sessionManager.js
│       │   ├── circuitBreaker.js
│       │   └── index.js
│       ├── Dockerfile
│       └── package.json
│
├── packages/
│   └── shared/                 → Kode yang dipakai lebih dari 1 service
│       ├── src/
│       │   ├── constants/      → Status enum, error codes, dll
│       │   ├── crypto/         → encrypt, decrypt, hash helpers
│       │   └── index.js
│       └── package.json
│
├── docker-compose.yml          → Production
├── docker-compose.dev.yml      → Development override
├── .env.example
├── package.json                → Root workspace config
└── pnpm-workspace.yaml
```

---

## Setup pnpm Workspaces

### `pnpm-workspace.yaml`

```yaml
packages:
  - 'apps/*'
  - 'packages/*'
```

### `package.json` (root)

```json
{
  "name": "payment-gateway",
  "private": true,
  "scripts": {
    "dev:api":      "pnpm --filter api dev",
    "dev:scraper":  "pnpm --filter scraper dev",
    "dev:frontend": "pnpm --filter frontend dev",
    "build":        "pnpm --filter './apps/*' build",
    "lint":         "pnpm --filter './apps/*' lint"
  }
}
```

### Install dependency ke workspace tertentu

```bash
# Tambah dependency ke app tertentu
pnpm --filter api add fastify
pnpm --filter scraper add bullmq playwright
pnpm --filter frontend add next react react-dom

# Tambah shared package ke app
pnpm --filter api add @payment-gateway/shared
pnpm --filter scraper add @payment-gateway/shared
```

---

## Shared Package

### `packages/shared/package.json`

```json
{
  "name": "@payment-gateway/shared",
  "version": "1.0.0",
  "main": "./src/index.js",
  "exports": {
    ".":            "./src/index.js",
    "./constants":  "./src/constants/index.js",
    "./crypto":     "./src/crypto/index.js"
  }
}
```

### Constants

```javascript
// packages/shared/src/constants/index.js

export const INVOICE_STATUS = {
  PENDING:   'pending',
  PAID:      'paid',
  EXPIRED:   'expired',
  CANCELLED: 'cancelled'
}

export const CHANNEL_TYPE = {
  BCA_TRANSFER: 'bca_transfer',
  QRIS_BCA:     'qris_bca',
  QRIS_GOPAY:   'qris_gopay'
}

export const MATCH_STATUS = {
  UNMATCHED: 'unmatched',
  MATCHED:   'matched',
  DUPLICATE: 'duplicate',
  MANUAL:    'manual'
}

export const SCRAPE_PRIORITY = {
  HIGH:   'high',
  MEDIUM: 'medium',
  LOW:    'low'
}

export const PLAN_TYPE = {
  FREE:         'free',
  SUBSCRIPTION: 'subscription'
}

export const ERROR_CODES = {
  INVOICE_NOT_FOUND:        'INVOICE_NOT_FOUND',
  INVOICE_ALREADY_PAID:     'INVOICE_ALREADY_PAID',
  INVOICE_EXPIRED:          'INVOICE_EXPIRED',
  INSUFFICIENT_BALANCE:     'INSUFFICIENT_BALANCE',
  BELOW_MINIMUM_WITHDRAW:   'BELOW_MINIMUM_WITHDRAW',
  CHANNEL_NOT_FOUND:        'CHANNEL_NOT_FOUND',
  CHANNEL_INACTIVE:         'CHANNEL_INACTIVE',
  PLAN_FEATURE_UNAVAILABLE: 'PLAN_FEATURE_UNAVAILABLE',
  RATE_LIMIT_EXCEEDED:      'RATE_LIMIT_EXCEEDED'
}
```

### Crypto Helper

```javascript
// packages/shared/src/crypto/index.js
import crypto from 'crypto'

const ALGORITHM  = 'aes-256-gcm'
const KEY        = Buffer.from(process.env.ENCRYPTION_KEY, 'hex')  // 32 bytes

export function encrypt(text) {
  const iv     = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv)
  const enc    = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(encoded) {
  const buf       = Buffer.from(encoded, 'base64')
  const iv        = buf.slice(0, 12)
  const tag       = buf.slice(12, 28)
  const enc       = buf.slice(28)
  const decipher  = crypto.createDecipheriv(ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

export function hashApiKey(rawKey) {
  return sha256(rawKey)
}
```

---

## Dockerfile per App

### `apps/api/Dockerfile`

```dockerfile
FROM node:20-alpine
RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Install hanya dependency yang dibutuhkan api + shared
RUN pnpm install --frozen-lockfile --filter api...

EXPOSE 3001
CMD ["node", "apps/api/src/index.js"]
```

### `apps/scraper/Dockerfile`

```dockerfile
# Image sudah include Chromium + system deps untuk Playwright
FROM mcr.microsoft.com/playwright:v1.52.0-noble
RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/scraper ./apps/scraper

RUN pnpm install --frozen-lockfile --filter scraper...

CMD ["node", "apps/scraper/src/index.js"]
```

### `apps/frontend/Dockerfile`

```dockerfile
FROM node:20-alpine AS builder
RUN npm install -g pnpm

WORKDIR /app

COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared ./packages/shared
COPY apps/frontend ./apps/frontend

RUN pnpm install --frozen-lockfile --filter frontend...
RUN pnpm --filter frontend build

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "frontend", "start"]
```

---

## Docker Compose

### `docker-compose.yml` (Production)

```yaml
services:

  frontend:
    build:
      context: .
      dockerfile: apps/frontend/Dockerfile
    restart: always
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=${API_URL}
    depends_on:
      - api

  api:
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: always
    ports:
      - "3001:3001"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - JWT_REFRESH_SECRET=${JWT_REFRESH_SECRET}
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - FRONTEND_URL=${FRONTEND_URL}
    depends_on:
      - redis

  scraper:
    build:
      context: .
      dockerfile: apps/scraper/Dockerfile
    restart: always
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - REDIS_URL=redis://redis:6379
      - ENCRYPTION_KEY=${ENCRYPTION_KEY}
      - MAX_BROWSERS=${MAX_BROWSERS}
      - SCRAPER_CONCURRENCY=${SCRAPER_CONCURRENCY}
    depends_on:
      - redis

  redis:
    image: redis:7-alpine
    restart: always
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

> MariaDB tidak masuk docker-compose karena sudah berjalan di VM terpisah.
> Redis dipakai bersama oleh `api` (SSE pub/sub) dan `scraper` (BullMQ queue).

### `docker-compose.dev.yml` (Development Override)

```yaml
# Jalankan dengan:
# docker compose -f docker-compose.yml -f docker-compose.dev.yml up
services:

  api:
    volumes:
      - ./apps/api/src:/app/apps/api/src
      - ./packages/shared/src:/app/packages/shared/src
    environment:
      - NODE_ENV=development
    command: ["node", "--watch", "apps/api/src/index.js"]

  scraper:
    volumes:
      - ./apps/scraper/src:/app/apps/scraper/src
      - ./packages/shared/src:/app/packages/shared/src
    environment:
      - NODE_ENV=development
    command: ["node", "--watch", "apps/scraper/src/index.js"]

  frontend:
    volumes:
      - ./apps/frontend/src:/app/apps/frontend/src
    environment:
      - NODE_ENV=development
    command: ["pnpm", "--filter", "frontend", "dev"]
```

---

## Environment Variables

### `.env.example`

```bash
# ── Database (VM terpisah) ──────────────────────────────────
DATABASE_URL=mysql://user:password@192.168.1.100:3306/payment_gateway

# ── Redis (container di VM yang sama) ──────────────────────
# Tidak perlu diset manual — sudah hardcode redis://redis:6379 di compose
# Set ini hanya kalau Redis dijalankan di luar Docker
REDIS_URL=redis://redis:6379

# ── Auth ────────────────────────────────────────────────────
JWT_SECRET=ganti_dengan_random_string_minimal_64_karakter
JWT_REFRESH_SECRET=ganti_dengan_random_string_lain_minimal_64_karakter
JWT_EXPIRES_IN=900            # 15 menit (dalam detik)
JWT_REFRESH_EXPIRES_IN=604800 # 7 hari (dalam detik)

# ── Enkripsi ─────────────────────────────────────────────────
# Untuk scraping_config dan session_data di DB
# Generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
ENCRYPTION_KEY=isi_dengan_64_karakter_hex

# ── App URL ──────────────────────────────────────────────────
API_URL=https://api.yourdomain.com
FRONTEND_URL=https://yourdomain.com
API_PORT=3001

# ── Scraper ──────────────────────────────────────────────────
MAX_BROWSERS=20         # sesuaikan dengan RAM server
SCRAPER_CONCURRENCY=10  # max job scrape bersamaan di BullMQ
```

---

## Infrastruktur

### Topologi

```
Internet
    │
    ▼
┌───────────────────────────────────────────┐
│                 VM Apps                   │
│                                           │
│  ┌──────────┐  ┌──────┐  ┌───────────┐   │
│  │ frontend │  │ api  │  │  scraper  │   │
│  │  :3000   │  │ :3001│  │(Playwright│   │
│  └──────────┘  └──────┘  │ + BullMQ) │   │
│                           └───────────┘   │
│  ┌──────────────────────┐                 │
│  │        redis         │                 │
│  │        :6379         │                 │
│  │  (BullMQ + SSE pub)  │                 │
│  └──────────────────────┘                 │
└─────────────────────┬─────────────────────┘
                      │ DATABASE_URL
                      ▼
          ┌───────────────────────┐
          │      VM Database      │
          │       MariaDB         │
          │        :3306          │
          └───────────────────────┘
```

### Container Summary

| Container | Image | Port | Restart | Depends On |
|---|---|---|---|---|
| `frontend` | node:20-alpine | 3000 | always | api |
| `api` | node:20-alpine | 3001 | always | redis |
| `scraper` | playwright:v1.52.0-noble | — | always | redis |
| `redis` | redis:7-alpine | 6379 | always | — |

### Deploy Commands

```bash
# Clone repo dan setup env
git clone <repo>
cd payment-gateway
cp .env.example .env
# edit .env sesuai kebutuhan

# Build semua image
docker compose build

# Jalankan production
docker compose up -d

# Lihat logs realtime
docker compose logs -f
docker compose logs -f scraper   # scraper saja

# Restart satu service
docker compose restart scraper

# Update setelah push kode baru
git pull
docker compose build api scraper frontend
docker compose up -d --no-deps api scraper frontend

# Development mode (hot reload)
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

---

*1 repo (monorepo) → 4 container (frontend, api, scraper, redis) → MariaDB di VM terpisah.*
