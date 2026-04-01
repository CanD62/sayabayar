# Saya Bayar — Payment Gateway

Sistem verifikasi pembayaran otomatis menggunakan scraping mutasi bank.

## Arsitektur

```
apps/
├── api/           → Fastify REST API
├── frontend/      → Next.js dashboard + halaman pembayaran
└── scraper/       → Scraper service (Playwright + BullMQ)

packages/
└── shared/        → Prisma schema, constants, crypto, QRIS parser
```

## Setup

```bash
pnpm install
cp .env.example .env   # isi DATABASE_URL, REDIS_URL, dll
pnpm --filter @payment-gateway/shared prisma:generate
pnpm dev
```

## Menambah Channel Type Baru

Contoh: menambah `bri_transfer`

### 1. Schema Prisma
```prisma
// packages/shared/prisma/schema.prisma
enum ChannelType {
  bca_transfer
  qris_bca
  qris_gopay
  bri_transfer    // ← tambah di sini
}
```

Lalu jalankan:
```bash
cd packages/shared
pnpm prisma:generate
pnpm prisma:migrate:dev
```

### 2. Constants
```js
// packages/shared/src/constants/index.js

// Tambah di CHANNEL_TYPE
export const CHANNEL_TYPE = {
  ...
  BRI_TRANSFER: 'bri_transfer'
}

// Tambah di SESSION_TTL
export const SESSION_TTL = {
  ...
  bri_transfer: 60 * 60 * 4  // 4 jam
}

// (Opsional) Override interval scraping jika berbeda dari default
export const SCRAPE_INTERVAL_OVERRIDES = {
  ...
  bri_transfer: {
    HIGH: 15_000,
    MEDIUM: 3 * 60_000,
    LOW: 10 * 60_000
  }
}
```

### 3. Scraper
Buat file scraper baru:
```
apps/scraper/src/scrapers/briTransfer.js
```
Export fungsi utama:
```js
export async function scrapeBriTransfer(mainPage, context, config, isLoggedIn) {
  // Implementasi login, navigasi, dan parsing transaksi
  return { transactions: [...], isLoggedIn: true }
}
```

### 4. Scrape Worker
```js
// apps/scraper/src/scrapeWorker.js
// Tambah import dan registrasi scraper baru
import { scrapeBriTransfer } from './scrapers/briTransfer.js'

const SCRAPERS = {
  ...
  bri_transfer: scrapeBriTransfer
}
```

### 5. Browser Pool
```js
// apps/scraper/src/browserPool.js
// Tambah logout handler di forceLogout() dan destroySession()
if (url && url.includes('bri.co.id')) {
  // BRI logout logic
}
```

### 6. API — Validasi Channel Type
```js
// apps/api/src/routes/channels.js
// Tambah di schema POST /channels → channel_type enum
enum: ['bca_transfer', 'qris_bca', 'qris_gopay', 'bri_transfer']
```

### 7. Frontend — Dropdown Tipe Channel
```js
// apps/frontend/src/app/dashboard/channels/page.js
// Tambah opsi di <select> Tipe Channel
<option value="bri_transfer">BRI Transfer</option>
```

### Checklist Ringkas

| # | File | Aksi |
|---|---|---|
| 1 | `schema.prisma` | Tambah enum + migrasi |
| 2 | `constants/index.js` | `CHANNEL_TYPE`, `SESSION_TTL`, `SCRAPE_INTERVAL_OVERRIDES` |
| 3 | `scrapers/xxxYyy.js` | Buat scraper baru |
| 4 | `scrapeWorker.js` | Register scraper |
| 5 | `browserPool.js` | Logout handler |
| 6 | `channels.js` (API) | Validasi enum |
| 7 | `channels/page.js` (Frontend) | Dropdown option |

## Scraping Intervals

Default interval (semua channel):

| Priority | Interval | Kondisi |
|---|---|---|
| HIGH | 15 detik | User klik "Sudah Transfer" |
| MEDIUM | 5 menit | Ada invoice pending |
| LOW | 15 menit | Tidak ada invoice |

Override per channel type didefinisikan di `SCRAPE_INTERVAL_OVERRIDES` di `packages/shared/src/constants/index.js`.

## Soft Delete Channel

Channel yang dihapus di-*soft delete* (`deleted_at` diisi timestamp). Data transaksi dan invoice tetap tersimpan. Browser session ditutup otomatis saat channel dihapus atau di-pause.
