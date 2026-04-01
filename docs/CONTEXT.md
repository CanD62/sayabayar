# CONTEXT — Payment Gateway Platform ("bayar")

> **Dokumen ini HARUS dibaca AI di awal setiap chat baru** sebelum menyentuh kode apapun.
> Berisi arsitektur, keputusan desain, pola kode, dan constraint kritis yang sudah disepakati.

---

## 1. Overview Proyek

**Nama project:** `payment-gateway` (monorepo pnpm)
**Directory root:** `/Users/cand62/Documents/htdocs/bayar`
**Stack:**
- **API:** Node.js (ESM) + Fastify v5 + Prisma (MySQL/MariaDB)
- **Frontend:** Next.js 15 (App Router, `src/`)
- **Scraper:** Node.js (ESM) + Playwright + BullMQ (Redis)
- **Database:** MySQL/MariaDB (Prisma ORM)
- **Message broker/cache:** Redis (IORedis)
- **Shared package:** `@payment-gateway/shared`

**Package manager:** `pnpm` (workspace)

**Dev server:** `pnpm dev` dari root — menjalankan API (port 3001), Scraper (port 3002), Frontend (port 3000) secara paralel.

---

## 2. Struktur Monorepo

```
bayar/
├── apps/
│   ├── api/          # Fastify REST API (port 3001)
│   │   └── src/
│   │       ├── index.js            # Entry point
│   │       ├── middleware/
│   │       │   └── authenticate.js # JWT + API Key auth
│   │       ├── plugins/
│   │       │   ├── redis.js        # Redis plugin
│   │       │   └── responseFormatter.js # reply.success/fail/paginated
│   │       ├── routes/
│   │       │   ├── auth.js         # /v1/auth (login, register, google, reset-password, verify-email, dll)
│   │       │   ├── apiKeys.js      # /v1/api-keys
│   │       │   ├── invoices.js     # /v1/invoices
│   │       │   ├── channels.js     # /v1/channels
│   │       │   ├── balance.js      # /v1/balance
│   │       │   ├── withdrawals.js  # /v1/withdrawals
│   │       │   ├── webhooks.js     # /v1/webhooks
│   │       │   ├── pay.js          # /v1/pay (PUBLIC)
│   │       │   ├── subscriptions.js# /v1/subscriptions
│   │       │   ├── lookup.js       # /v1/lookup (bank validation via Flip)
│   │       │   └── admin.js        # /v1/admin
│   │       └── services/
│   │           ├── paymentProvider.js # Flip API service
│   │           └── email.js           # Nodemailer (Mailcow SMTP) — verifikasi & reset password
│   │
│   ├── scraper/      # Scraper service (port 3002 test server)
│   │   └── src/
│   │       ├── index.js            # Entry point
│   │       ├── scheduler.js        # Poll DB, dispatch BullMQ jobs
│   │       ├── browserPool.js      # Playwright browser instance pool
│   │       ├── sessionStore.js     # Redis session status + command store
│   │       ├── queues.js           # BullMQ queue definitions
│   │       ├── circuitBreaker.js   # Circuit breaker logic
│   │       ├── scrapers/
│   │       │   ├── qrisBca.js      # QRIS BCA dashboard scraper (Playwright)
│   │       │   ├── qrisBcaSession.js # QRIS BCA session persistence → Redis
│   │       │   ├── qrisGopay.js    # GoPay QRIS scraper (API-based, no browser)
│   │       │   ├── bcaTransfer.js  # BCA KlikBCA internet banking scraper
│   │       │   └── flipBrowser.js  # Flip PIN input via browser
│   │       ├── workers/
│   │       │   ├── scrapeWorker.js # BullMQ: jalankan scraper per channel
│   │       │   ├── matchWorker.js  # BullMQ: cocokkan tx → invoice
│   │       │   ├── webhookWorker.js# BullMQ: kirim webhook ke client
│   │       │   ├── settlementWorker.js # Settle pending balance H+2
│   │       │   └── flipWorker.js   # BullMQ: proses withdrawal via Flip (concurrency=1)
│   │       └── lib/
│   │           └── flipClient.js   # Flip API HTTP client
│   │
│   └── frontend/     # Next.js 15 (App Router)
│       └── src/
│           ├── app/
│           │   ├── page.js         # Landing page
│           │   ├── layout.js
│           │   ├── globals.css
│           │   ├── login/          # Login page (+ link lupa password)
│           │   ├── register/       # Register page (+ success state verifikasi email)
│           │   ├── forgot-password/# Form request reset password
│           │   ├── reset-password/ # Form set password baru via token
│           │   ├── verify-email/   # Landing verifikasi email dari link
│           │   ├── dashboard/      # Dashboard (protected)
│           │   ├── pay/            # Payment page (PUBLIC)
│           │   ├── privacy/
│           │   └── terms/
│           ├── components/
│           │   ├── BankSelect.js
│           │   ├── Sidebar.js
│           │   ├── Toast.js
│           │   ├── ShareModal.js
│           │   ├── ConfirmModal.js
│           │   ├── WhatsAppButton.js
│           │   └── ui.js
│           └── lib/
│               ├── api.js          # ApiClient singleton
│               ├── AuthContext.js  # React context untuk auth state
│               ├── InvoiceEventContext.js
│               ├── constants.js    # SUPPORTED_BANKS, dll
│               ├── format.js       # Format currency, tanggal
│               └── qris.js         # QR code render logic
│
├── packages/
│   └── shared/
│       ├── prisma/
│       │   └── schema.prisma      # DATABASE SCHEMA — sumber kebenaran
│       └── src/
│           ├── constants/index.js # Semua konstanta business logic
│           ├── crypto/            # AES-256-GCM encrypt/decrypt, hash
│           ├── db/                # Prisma client (singleton)
│           └── qris/              # QRIS TLV parser + validator
│
├── .env                           # Environment variables (SATU file di root)
├── package.json                   # Root scripts (pnpm workspace)
└── pnpm-workspace.yaml
```

---

## 3. Database Schema (ringkasan)

**File:** `packages/shared/prisma/schema.prisma`
**Provider:** MySQL (MariaDB)

| Model | Tabel | Fungsi |
|---|---|---|
| `Client` | `clients` | Merchant yang pakai platform ini |
| `ApiKey` | `api_keys` | API key untuk integrasi |
| `SubscriptionPlan` | `subscription_plans` | Free / subscription plan |
| `ClientSubscription` | `client_subscriptions` | Relasi client ↔ plan |
| `PaymentChannel` | `payment_channels` | Rekening / QRIS yang dipakai scraping |
| `ChannelState` | `channel_states` | Status scraping, circuit breaker, priority |
| `Invoice` | `invoices` | Invoice yang dibuat merchant |
| `Transaction` | `transactions` | Mutasi bank yang berhasil di-scrape |
| `ClientBalance` | `client_balances` | Saldo client (pending + available) |
| `BalanceLedger` | `balance_ledger` | Histori mutasi saldo |
| `Withdrawal` | `withdrawals` | Permintaan penarikan saldo |
| `WebhookEndpoint` | `webhook_endpoints` | URL webhook client |
| `WebhookLog` | `webhook_logs` | Log pengiriman webhook |
| `ScrapingLog` | `scraping_logs` | Log hasil scraping |
| `PaymentProvider` | `payment_providers` | Konfigurasi Flip (token, PIN — terenkripsi) |

### Field penting di Invoice
- `amount` — jumlah asli dari merchant
- `uniqueCode` — kode unik (1-999, tiered by amount)
- `amountUnique` — `amount + uniqueCode` — yang harus dibayar customer
- `uniqueCodeRevenue` — revenue platform dari unique code (jika `channelOwner = platform`)
- `status`: `pending` → `user_confirmed` → `paid` | `expired` | `cancelled`
- `channelPreference`: `platform` | `client`
- `paymentToken` — token public untuk URL payment page (32 chars, unique)

### ChannelType enum
- `bca_transfer` — KlikBCA internet banking (Playwright)
- `qris_bca` — QRIS BCA Merchant Dashboard (Playwright, SPA Angular)
- `qris_gopay` — GoPay QRIS (API-based, tanpa browser)

### ChannelOwner enum
- `platform` — channel milik platform, unique code = revenue
- `client` — channel milik merchant, unique code revenue = 0

---

## 4. Business Logic Kritis

### 4.1 Unique Code System
- Setiap invoice di channel yang sama harus punya unique code **berbeda** agar bisa di-match secara otomatis
- Code generation pakai **Redis distributed lock** (`lock:unique_code:{channelId}`) untuk avoid race condition di multi-node
- **Tiered by amount:**
  - < Rp 3.000 → kode 1–99
  - Rp 3.000–5.000 → kode 100–199
  - Rp 5.000–50.000 → kode 201–500
  - ≥ Rp 50.000 → kode 501–999
- PaymentCode ditambahkan ke amount → `amountUnique`
- `amountUnique` adalah field yang di-match di `matchWorker`

### 4.2 Channel Selection (QRIS)
- Customer bisa pilih "QRIS" → sistem auto-pilih channel QRIS dengan **least pending invoices**
- Skip channel dengan circuit breaker `open`
- Kalau semua open, fallback ke yang paling sedikit pending
- **Payment window:** 30 menit (set saat channel dipilih, update `expiredAt`)

### 4.3 Scraping Priority System
| Priority | Interval | Triggered By |
|---|---|---|
| HIGH | 15s (BCA transfer), 2s (QRIS BCA), 1s (GoPay) | Invoice `user_confirmed` |
| MEDIUM | 5m (BCA), 2m (QRIS) | Invoice `pending` ada |
| LOW | 15m (BCA), 5m (QRIS) | Tidak ada invoice aktif |

- HIGH timeout: 5 menit sejak `confirmedAt` → turun ke MEDIUM
- Scheduler poll setiap 5 detik

### 4.4 Transaction Matching
1. Scraper menemukan mutasi → simpan ke `transactions` dengan `uniqueHash` (channel+ref+amount+date)
2. Push ke `matchQueue` BullMQ
3. `matchWorker` cari invoice di channel yang sama dengan `amountUnique == tx.amount`
4. Prioritas: `user_confirmed` > `pending`, FIFO (createdAt asc)
5. Match → invoice jadi `paid`, balance ledger `credit_pending` (H+2), publish Redis event `invoice_events`
6. Max 5 attempt untuk match → jadi `manual`

### 4.5 Balance Settlement
- Saat invoice paid → balance masuk `balancePending` (H+2 `availableAt`)
- `settlementWorker` cek setiap 5 menit → pindahkan H+2 yang sudah jatuh tempo ke `balanceAvailable`
- **SUB- invoices:** invoice untuk subscription, TIDAK menambah credit client balance

### 4.6 Withdrawal Flow
1. Client POST `/v1/withdrawals/intent` → nonce one-time (TTL 5 menit di Redis)
2. Client POST `/v1/withdrawals` dengan nonce + password re-auth
3. Server verifikasi nonce, password (bcrypt), daily limit (1x/hari)
4. Brute-force protection: 3x salah password → lock sampai midnight WIB
5. Saldo didebit atomik, jika `autoProcess = true` → push ke `flip` queue
6. `flipWorker` (concurrency=1, sequential) → Flip API → transfer bank

### 4.7 SSE Real-time
- **Payment status:** `GET /v1/pay/:token/status` — per-connection Redis subscriber
- **Invoice events:** `GET /v1/invoices/events` — dashboard
- **Balance events:** `GET /v1/balance/events` — dashboard
- Mekanisme: `matchWorker` publish ke Redis `invoice_events` channel → SSE subscribers forward ke client
- Heartbeat setiap 25 detik agar tidak di-timeout proxy

---

## 5. API Design

### Response Format (responseFormatter.js)
```js
// Sukses
{ success: true, data: {...}, meta: { request_id, timestamp } }

// Sukses dengan pagination
{ success: true, data: [...], pagination: { page, per_page, total, total_pages }, meta: {...} }

// Gagal
{ success: false, error: { code, message, details }, meta: {...} }
```

Semua tanggal/waktu dalam response dikonversi ke **WIB (+07:00)** oleh `convertDates()`.

### Authentication
- **JWT Bearer** (di-store in-memory saja, tidak di localStorage)
- **X-Api-Key** header (untuk integrasi server-to-server)
- JWT: access token 15 menit, refresh token 7 hari (HttpOnly cookie)
- EventSource/SSE: Bearer token via `?token=` query param
- **Email verification wajib** sebelum bisa login (kecuali Google OAuth)
- **Reset password** via email link (token Redis, TTL 1 jam, one-time use)
- **Resend verification** tersedia dari halaman login jika email belum diverifikasi

### Rate Limiting
- Global: 120 req/menit per IP
- SSE endpoints dikecualikan dari rate limit
- `select-channel`: 5 req / 5 menit per token invoice
- `confirm`: 3 req / 5 menit per IP
- `withdrawal/intent`: 5 req / 5 menit

---

## 6. Scraper Architecture

### BrowserPool
- Playwright browser per channel, **STAY ALIVE** (tidak ditutup antar scrape)
- `mainPage` tetap hidup untuk menjaga session BCA
- `isLoggedIn` flag di pool + Redis (`pg:session:{channelId}`)
- Max 20 browser (via `MAX_BROWSERS`)
- Cleanup stale session setelah 1 jam idle

### QRIS BCA Session Persistence
- Setelah login berhasil → cookies + localStorage disimpan ke Redis (`bca:session:{channelId}`, TTL 7 jam)
- Saat login: restore cookies → `goto(HOME_URL, {waitUntil:'commit'})` → set localStorage → tunggu Angular render
- Satu round-trip ke BCA (bukan dua)
- Token Angular auto-refresh setiap ~30 menit → interceptor update Redis session (debounce 5s)

### Redis Key Patterns
| Key | Format | Fungsi |
|---|---|---|
| Session status | `pg:session:{channelId}` | Login state (API baca, scraper tulis) |
| Management command | `pg:cmd:{channelId}` | `force_logout` / `clean_browser` / `test_login:{id}` |
| Test result | `pg:test_result:{testId}` | Hasil test login (TTL 60s) |
| BCA session | `bca:session:{channelId}` | Cookies + localStorage QRIS BCA (TTL 7h) |
| Withdraw nonce | `pg:withdraw:nonce:{clientId}` | One-time nonce (TTL 5m) |
| Withdraw pw-fail | `pg:withdraw:pwfail:{clientId}` | Counter salah password |
| Withdraw pw-lock | `pg:withdraw:pwlock:{clientId}` | Lock sampai midnight WIB |
| Unique code lock | `lock:unique_code:{channelId}` | Distributed lock (TTL 10s) |
| Invoice events | `invoice_events` | Redis Pub/Sub channel untuk SSE |
| Email verify token | `verify_token:{token}` | Token verifikasi email (TTL 24 jam, one-time) |
| Password reset token | `reset_token:{token}` | Token reset password (TTL 1 jam, one-time) |
| Login fail counter | `auth:loginfail:{clientId}` | Counter gagal login (reset saat berhasil) |
| Login account lock | `auth:loginlock:{clientId}` | Kunci akun 30 menit setelah 5x gagal |

### Circuit Breaker
- Threshold: 5 consecutive errors → `open`
- Cooldown: 15 menit → `half_open` → `closed`
- Fatal error: browser pool di-destroy
- Transient error: dicatat, dijadwalkan ulang

### BullMQ Queues
| Queue | Concurrency | Processor |
|---|---|---|
| `scrape` | 5 | `scrapeWorker.js` |
| `match` | 5 | `matchWorker.js` |
| `webhook` | 3 | `webhookWorker.js` |
| `flip` | **1** (sequential) | `flipWorker.js` |

---

## 7. Frontend Architecture

### Auth Flow
- `AuthContext.js` — React context, `useAuth()` hook
- Access token: disimpan in-memory di singleton `ApiClient`
- Refresh token: HttpOnly cookie
- Saat 401: `api.refresh()` otomatis → retry request
- Logout/expired: `_onSessionExpired` callback → clear state → redirect ke `/login`

### ApiClient (`lib/api.js`)
- Singleton `api` — diimport langsung, tidak perlu context
- `api.get()`, `api.post()`, `api.patch()`, `api.del()`
- Auto-retry on 401 dengan refresh token
- Melempar Error dengan `.code` dan `.status` untuk error handling

### Payment Flow (Public)
1. Customer buka `/pay/{token}`
2. Pilih channel → POST `/v1/pay/{token}/select-channel`
3. Transfer → POST `/v1/pay/{token}/confirm`
4. SSE polling → `GET /v1/pay/{token}/status`

### Dashboard Pages
- `/dashboard` — ringkasan saldo + statistik invoice
- `/dashboard/invoices` — daftar + buat invoice
- `/dashboard/channels` — manajemen payment channel
- `/dashboard/withdrawals` — riwayat + buat penarikan
- `/dashboard/settings` — API key, webhook, profil

---

## 8. Environment Variables

File: `/Users/cand62/Documents/htdocs/bayar/.env` (SATU file, di-share semua apps)

```env
DATABASE_URL=mysql://...        # Prisma DB connection
REDIS_URL=redis://localhost:6379

JWT_SECRET=...                  # 64+ karakter
JWT_REFRESH_SECRET=...          # 64+ karakter, berbeda dari JWT_SECRET
JWT_EXPIRES_IN=900              # 15 menit (detik)
JWT_REFRESH_EXPIRES_IN=604800   # 7 hari (detik)

ENCRYPTION_KEY=...              # 64 hex chars (AES-256 key untuk scraping_config)

API_URL=http://localhost:3001
FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3001
API_PORT=3001
SCRAPER_PORT=3002

MAX_BROWSERS=20
SCRAPER_CONCURRENCY=10
```

---

## 9. Pola Kode Penting

### 9.1 Encrypt/Decrypt
- `encrypt()` / `decrypt()` dari `@payment-gateway/shared/crypto`
- Dipakai untuk: `scrapingConfig`, `sessionData` di DB, `PaymentProvider.token` + `.pin`
- Algoritma: AES-256-GCM
- Jangan pernah store plaintext credential di DB

### 9.2 Add Route (Fastify)
```js
// Semua route wajib pakai reply.success / reply.fail / reply.paginated
return reply.success(data)             // 200
return reply.success(data, 201)        // 201
return reply.fail('ERROR_CODE', 'Pesan user-friendly', 422)
return reply.paginated(data, pagination)
```

### 9.3 Soft Delete Channel
- Channel tidak di-hard delete → `deletedAt = new Date()`, `isActive = false`
- Query filter: `where: { deletedAt: null }`

### 9.4 Graceful Shutdown
- API dan scraper punya graceful shutdown dengan force exit timeout 5 detik
- Mencegah SSE / Prisma connection block proses shutdown

### 9.5 Terminology di UI
- Unique code disebut **"digit verifikasi"** di UI (bukan "kode unik")
- Invoice minimum: **Rp 1.000**
- Withdrawal minimum: **Rp 50.000**
- Withdrawal fee: **Rp 2.500**
- Billing settlement: **H+2**

---

## 10. Flip Integration

**Provider:** Flip Personal (Aladin bank transfer)

**PaymentProvider model** menyimpan:
- `token` — Bearer token Flip (encrypted, expire 24 jam, lazy refresh)
- `pin` — 6-digit PIN Flip (encrypted)
- `userId` — untuk URL Aladin balance check
- `autoProcess` — toggle transfer otomatis saat withdrawal dibuat
- `balance` — saldo Flip (update setelah setiap transfer)

**Withdrawal flow via Flip:**
1. `getTokenTransfer()` → challenge URL + headers
2. `inputPin()` via Playwright (flipBrowser.js) → nonce + referenceId
3. `transferBank()` → eksekusi transfer
4. Update withdrawal status → `processed`, simpan `flipTrxId`

**Lookup (validasi rekening):**
- `GET /v1/lookup/banks` — daftar bank
- `POST /v1/lookup/account` — validasi nomor rekening
- Vendor (Flip) tidak di-expose ke frontend

---

## 11. Keputusan Desain yang Sudah Final

1. **Satu `.env` di root** — shared semua apps, tidak ada env terpisah per app
2. **ESM modules only** — `"type": "module"` di semua package.json
3. **Token in-memory** — access token tidak pernah di localStorage
4. **Redis distributed lock** untuk unique code collision prevention (bukan DB lock)
5. **BrowserPool standby** — browser tidak ditutup antar scrape untuk hemat login time
6. **QRIS selection: least-loaded** — auto-pilih channel dengan invoice pending paling sedikit
7. **Response dates: WIB (+07:00)** — semua tanggal di response API dalam WIB
8. **Withdrawal: 1x/hari** — hard limit dengan nonce one-time + re-auth password
9. **SUB- invoice** — prefix khusus untuk subscription payment, tidak masuk credit balance
10. **`channelId` di scraper config** — selalu dipass ke scraper agar bisa simpan session per channel
11. **Scroll skip pada HIGH priority** — QRIS BCA HIGH mode tidak scroll untuk kecepatan
12. **Cookie banner dismiss** — QRIS BCA: force-remove dari DOM (tidak klik) untuk hindari navigasi ke T&C

---

---

## 12. Auth Email Flow

### Email Verifikasi (saat register)
1. User POST `/v1/auth/register` → akun dibuat, `emailVerified = false`
2. Token 64-char hex disimpan ke Redis `verify_token:{token}` (TTL 24 jam)
3. Email verifikasi dikirim async (non-blocking, error tidak gagalkan register)
4. Register page tampilkan success state — user tidak auto-login
5. User klik link `/verify-email?token=xxx` → GET `/v1/auth/verify-email`
6. Token valid → `emailVerified = true`, token dihapus dari Redis
7. User bisa login

### Reset Password
1. User POST `/v1/auth/forgot-password` → selalu return sukses (anti user enumeration)
2. Jika email ditemukan & punya password → token disimpan Redis `reset_token:{token}` (TTL 1 jam)
3. Email reset dikirim async
4. User klik link `/reset-password?token=xxx` → isi password baru
5. POST `/v1/auth/reset-password` → verifikasi token, hash password baru, hapus token Redis

### Email Service (`apps/api/src/services/email.js`)
- SMTP via Mailcow (`server.sosmedpedia.com:587`) — DKIM signing otomatis di level server
- Template HTML: background putih, warna emerald `#10b981` sesuai design system frontend
- Logo SVG identik dengan `LogoIcon.js` (receipt + lightning bolt)
- Anti-spam: multipart HTML+plaintext, `List-Unsubscribe`, preheader text tersembunyi
- Google OAuth users: `emailVerified = true` langsung (Google sudah verifikasi email)
- Akun lama sebelum fitur ini: di-set `emailVerified = true` via SQL migration

---

## 13. TODO / Post-Launch

- [ ] **Profile page** — tampilkan badge status `email_verified` (API sudah return field ini)
- [ ] **Email notifikasi invoice paid** — kirim email ke merchant saat invoice berubah jadi `paid` (saat ini hanya SSE + webhook)
- [ ] **In-app toast saat invoice paid** — tampilkan notifikasi dari SSE di dashboard (tanpa perlu refresh)
- [ ] **Halaman kontak/support** — minimal link WA atau email support di footer landing page

---

*Terakhir diperbarui: 2026-04-01*
