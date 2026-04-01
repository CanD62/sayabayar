# Scraper Architecture — Payment Gateway Platform
> Version 1.2 | Playwright + BullMQ + Redis + SSE | Tanpa PM2

---

## Daftar Isi

1. [Gambaran Umum](#gambaran-umum)
2. [Stack & Dependency](#stack--dependency)
3. [Komponen Utama](#komponen-utama)
4. [Alur Lengkap](#alur-lengkap)
5. [Scheduler](#scheduler)
6. [BullMQ Queue](#bullmq-queue)
7. [Browser Pool](#browser-pool)
8. [Session Manager](#session-manager)
9. [Scraper Worker](#scraper-worker)
10. [Transaction Matcher](#transaction-matcher)
11. [SSE Manager](#sse-manager)
12. [Circuit Breaker](#circuit-breaker)
13. [Error Handling](#error-handling)
14. [Resource Estimate](#resource-estimate)

---

## Gambaran Umum

Scraper service berjalan **terpisah dari Fastify API**, berkomunikasi hanya melalui database (MariaDB) dan Redis. Tidak ada HTTP call langsung antar service.

```
┌─────────────────────┐         ┌──────────────────────────┐
│    Fastify API      │         │     Scraper Service      │
│                     │         │                          │
│  - Buat invoice     │         │  - Scheduler             │
│  - Auth, webhook    │         │  - Browser Pool          │
│  - Balance, dll     │         │  - Session Manager       │
│  - SSE endpoint     │         │  - Scraper Worker        │
│                     │         │  - Transaction Matcher   │
└────────┬────────────┘         └────────────┬─────────────┘
         │                                   │
         └──────────────┬────────────────────┘
                        │
           ┌────────────┴─────────────┐
           │                          │
    ┌──────▼──────┐           ┌───────▼──────┐
    │   MariaDB   │           │    Redis     │
    │             │           │              │
    │  - invoices │           │  - BullMQ    │
    │  - channels │           │    queues    │
    │  - channel  │           │  - SSE pub   │
    │    states   │           │  - session   │
    │  - transactions         │    cache     │
    └─────────────┘           └──────────────┘
```

---

## Stack & Dependency

```
Runtime    : Node.js 20+
Scraping   : Playwright (Chromium)
Queue      : BullMQ
Cache/Pub  : Redis 7+
DB         : MariaDB (via prisma / mysql2)
Deploy     : Docker (mcr.microsoft.com/playwright:v1.52.0-noble)
```

### Package
```json
{
  "dependencies": {
    "playwright": "latest",
    "bullmq": "latest",
    "ioredis": "latest",
    "mysql2": "latest"
  }
}
```

---

## Komponen Utama

```
┌─────────────────────────────────────────────────────┐
│                  Scraper Service                     │
│                                                     │
│  ┌─────────────┐    push job    ┌─────────────────┐ │
│  │  Scheduler  │ ─────────────► │   BullMQ Queue  │ │
│  └─────────────┘                └────────┬────────┘ │
│                                          │ consume  │
│  ┌─────────────┐                ┌────────▼────────┐ │
│  │   Circuit   │ ◄──────────── │  Scraper Worker │ │
│  │   Breaker   │                └────────┬────────┘ │
│  └─────────────┘                         │          │
│                                          │          │
│  ┌─────────────┐    reuse       ┌────────▼────────┐ │
│  │   Browser   │ ◄────────────► │ Session Manager │ │
│  │    Pool     │                └─────────────────┘ │
│  └─────────────┘                                    │
│                                                     │
│  ┌──────────────────────┐   ┌─────────────────────┐ │
│  │ Transaction Matcher  │   │    SSE Manager      │ │
│  └──────────────────────┘   └─────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Alur Lengkap

### Happy Path — Invoice Terbayar

```
1. Fastify API: invoice dibuat (status = pending)
       │
       ▼
2. DB Trigger (app layer):
   UPDATE channel_states
     SET scrape_priority = 'high',
         next_scrape_at  = NOW()
       │
       ▼
3. Scheduler (polling tiap 5 detik):
   Deteksi channel dengan next_scrape_at <= NOW()
   → Push job ke BullMQ queue
       │
       ▼
4. BullMQ Worker:
   Ambil job dari queue
   → Minta browser instance dari Browser Pool
       │
       ▼
5. Session Manager:
   Cek session aktif di Redis
   → Session ada & valid → skip login
   → Session tidak ada / expired → login dulu
       │
       ▼
6. Scraper Worker:
   Hit halaman mutasi bank
   → Ambil semua mutasi hari ini (scrape_cursor = tanggal hari ini)
   → Filter duplikat via unique_hash — yang sudah ada di DB dilewati
   → Tulis transaksi baru ke tabel transactions
   → Update channel_states (cursor, last_scraped_at, next_scrape_at)
       │
       ▼
7. Transaction Matcher:
   Coba cocokkan transaksi ke invoice pending
   → Match ditemukan:
       - UPDATE transactions SET match_status = 'matched'
       - UPDATE invoices SET status = 'paid', paid_at = NOW()
       - INSERT balance_ledger (plan gratis)
       - Publish event ke Redis pub/sub
   → Tidak match:
       - Masuk retry pool (max 20x, tiap 30 detik)
       │
       ▼
8. SSE Manager:
   Subscribe Redis channel
   → Terima event invoice.paid
   → Push ke semua SSE client yang menonton invoice ini
       │
       ▼
9. Halaman pembayaran pelanggan:
   Terima SSE event → tampilkan "Pembayaran Berhasil" ✅

10. Webhook (async):
    Fastify API kirim webhook ke endpoint klien
```

---

## Scheduler

Scheduler adalah **loop sederhana** yang berjalan di background, polling DB tiap 5 detik untuk mencari channel yang perlu di-scrape.

### Interval per Prioritas

| Priority | Kondisi | next_scrape_at |
|---|---|---|
| `high` | Ada invoice pending | NOW() + 15 detik |
| `medium` | Akun aktif, tidak ada invoice | NOW() + 5 menit |
| `low` | Akun jarang transaksi | NOW() + 15 menit |

### Query Scheduler

```sql
-- Ambil channel yang siap di-scrape (max 50 per batch)
SELECT
  cs.channel_id,
  cs.scrape_priority,
  pc.channel_type,
  pc.client_id
FROM channel_states cs
JOIN payment_channels pc ON pc.id = cs.channel_id
WHERE cs.next_scrape_at <= NOW()
  AND cs.circuit_state != 'open'
  AND pc.is_active = TRUE
ORDER BY
  CASE cs.scrape_priority
    WHEN 'high'   THEN 1
    WHEN 'medium' THEN 2
    WHEN 'low'    THEN 3
  END ASC,
  cs.next_scrape_at ASC
LIMIT 50;
```

### Update Prioritas Otomatis

```javascript
// Dipanggil dari Fastify API, bukan dari scraper
// Saat invoice dibuat:
async function onInvoiceCreated(channelId) {
  await db.channelStates.update({
    where: { channel_id: channelId },
    data: {
      scrape_priority: 'high',
      next_scrape_at: new Date()   // segera scrape
    }
  })
}

// Saat invoice paid / expired / cancelled:
async function onInvoiceResolved(channelId) {
  const pendingCount = await db.invoices.count({
    where: { payment_channel_id: channelId, status: 'pending' }
  })

  await db.channelStates.update({
    where: { channel_id: channelId },
    data: {
      scrape_priority: pendingCount > 0 ? 'high' : 'medium',
      next_scrape_at: pendingCount > 0
        ? new Date()
        : new Date(Date.now() + 5 * 60 * 1000)
    }
  })
}
```

---

## BullMQ Queue

### Queue Definitions

```javascript
// queues.js
import { Queue, Worker, QueueEvents } from 'bullmq'
import { redis } from './redis.js'

// Queue utama scraping
export const scrapeQueue = new Queue('scrape', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
    removeOnComplete: 100,   // simpan 100 job terakhir
    removeOnFail: 500        // simpan 500 job gagal untuk debug
  }
})

// Queue matching (dijalankan setelah scrape selesai)
export const matchQueue = new Queue('match', {
  connection: redis,
  defaultJobOptions: {
    attempts: 20,
    backoff: { type: 'fixed', delay: 30_000 },  // retry tiap 30 detik
    removeOnComplete: 100,
    removeOnFail: 500
  }
})

// Queue webhook (dijalankan setelah match berhasil)
export const webhookQueue = new Queue('webhook', {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'custom',
      // 1m, 5m, 15m, 1h, 6h
      delays: [60_000, 300_000, 900_000, 3_600_000, 21_600_000]
    },
    removeOnComplete: 200,
    removeOnFail: 1000
  }
})
```

### Job Payload

```javascript
// Scrape job
{
  channelId: 'uuid',
  channelType: 'bca_transfer',   // bca_transfer | qris_bca | qris_gopay
  clientId: 'uuid',
  priority: 'high'
}

// Match job
{
  transactionId: 'uuid',
  channelId: 'uuid',
  amount: 150123,
  detectedAt: '2025-01-01T00:30:00Z',
  attemptNumber: 1
}

// Webhook job
{
  webhookEndpointId: 'uuid',
  invoiceId: 'uuid',
  event: 'invoice.paid',
  attemptNumber: 1
}
```

### Concurrency per Queue

```javascript
// Concurrency disesuaikan resource server
const scrapeWorker = new Worker('scrape', scrapeProcessor, {
  connection: redis,
  concurrency: 10   // max 10 channel di-scrape bersamaan
})

const matchWorker = new Worker('match', matchProcessor, {
  connection: redis,
  concurrency: 20   // matching ringan, bisa lebih tinggi
})

const webhookWorker = new Worker('webhook', webhookProcessor, {
  connection: redis,
  concurrency: 15
})
```

---

## Browser Pool

Satu browser instance per channel (bukan per request). Browser standby, tidak pernah ditutup kecuali error fatal.

### Pool Management

```javascript
// browserPool.js
class BrowserPool {
  constructor() {
    this.pool = new Map()   // channelId → BrowserContext
  }

  async get(channelId) {
    if (!this.pool.has(channelId)) {
      const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-dev-shm-usage']
      })
      const context = await browser.newContext({
        userAgent: '...',    // user agent yang wajar
        viewport: { width: 1280, height: 720 }
      })
      this.pool.set(channelId, { browser, context, createdAt: Date.now() })
    }
    return this.pool.get(channelId)
  }

  async release(channelId) {
    // Tidak tutup browser — standby untuk scrape berikutnya
    // Hanya tutup page, bukan context
  }

  async destroy(channelId) {
    // Hanya dipanggil saat fatal error atau channel dinonaktifkan
    const instance = this.pool.get(channelId)
    if (instance) {
      await instance.browser.close()
      this.pool.delete(channelId)
    }
  }

  getPoolSize() {
    return this.pool.size
  }
}

export const browserPool = new BrowserPool()
```

### Resource per Instance

```
RAM per browser  : ~150MB
10 akun BCA      : ~1.5GB
20 akun campuran : ~3GB

Server minimum   : 4 core / 8GB RAM (untuk 20-30 akun)
```

---

## Session Manager

Mengelola cookies dan token per channel. Disimpan di Redis (bukan DB) karena sering diakses dan tidak perlu persistent jangka panjang.

### BCA Transfer — Cookie Session

```javascript
// sessionManager.js

const SESSION_TTL = {
  bca_transfer: 60 * 60 * 4,    // 4 jam (konservatif, BCA bisa kick kapan saja)
  qris_bca:     60 * 30,         // 30 menit (sesuai token expiry)
  qris_gopay:   60 * 60 * 8      // 8 jam
}

export async function saveSession(channelId, channelType, sessionData) {
  const key = `session:${channelId}`
  const ttl = SESSION_TTL[channelType]
  await redis.setex(key, ttl, JSON.stringify(encrypt(sessionData)))

  // Backup ke DB untuk recovery setelah Redis restart
  await db.channelStates.update({
    where: { channel_id: channelId },
    data: { session_data: encrypt(sessionData) }
  })
}

export async function getSession(channelId) {
  // Coba dari Redis dulu (cepat)
  const cached = await redis.get(`session:${channelId}`)
  if (cached) return decrypt(JSON.parse(cached))

  // Fallback ke DB
  const state = await db.channelStates.findUnique({
    where: { channel_id: channelId },
    select: { session_data: true }
  })
  return state?.session_data ? decrypt(state.session_data) : null
}

export async function clearSession(channelId) {
  await redis.del(`session:${channelId}`)
  await db.channelStates.update({
    where: { channel_id: channelId },
    data: { session_data: null }
  })
}
```

### Deteksi Session Kicked (BCA Transfer)

```javascript
async function isSessionValid(page) {
  const url = page.url()
  // BCA redirect ke login page kalau session expired / kicked
  if (url.includes('/login') || url.includes('/authentication')) {
    return false
  }
  // Cek elemen yang hanya ada saat sudah login
  const isLoggedIn = await page.$('.menu-wrapper') !== null
  return isLoggedIn
}
```

---

## Scraper Worker

Logic scraping per channel type. Setiap bank punya implementasi sendiri tapi interface yang sama.

### Interface

```javascript
// scrapers/base.js
export class BaseScraper {
  constructor(page, channel, sessionManager) {
    this.page = page
    this.channel = channel
    this.session = sessionManager
  }

  async login(credentials) { throw new Error('Not implemented') }
  async getMutations(cursor) { throw new Error('Not implemented') }
  async isLoggedIn() { throw new Error('Not implemented') }
}
```

### BCA Transfer Scraper

```javascript
// scrapers/bcaTransfer.js
export class BCATransferScraper extends BaseScraper {

  async ensureLoggedIn(credentials) {
    if (await this.isLoggedIn()) return

    // Session tidak valid → login ulang
    await this.login(credentials)
  }

  async isLoggedIn() {
    return isSessionValid(this.page)
  }

  async login(credentials) {
    // Playwright login flow BCA
    // ...
    // Setelah berhasil → simpan cookies
    const cookies = await this.page.context().cookies()
    await this.session.saveSession(
      this.channel.id,
      'bca_transfer',
      { cookies }
    )
  }

  async getMutations(cursor) {
    // Ambil SEMUA mutasi hari ini dari BCA
    // cursor = tanggal hari ini (YYYY-MM-DD)
    // Duplicate protection ditangani unique_hash saat insert ke DB
    // Return semua mutasi kredit hari ini

    return [
      {
        reference_number: 'REF001',
        amount: 150123,
        type: 'credit',
        date: '2025-01-01',
        description: 'TRF dari JOHN DOE'
      }
    ]
  }
}
```

### QRIS BCA Scraper

```javascript
// scrapers/qrisBca.js
export class QRISBCAScraper extends BaseScraper {
  // Token-based, lebih sederhana dari BCA Transfer
  // Token valid 30 menit → refresh otomatis
  // Login ulang tiap 8 jam

  async ensureToken() {
    const session = await this.session.getSession(this.channel.id)

    if (!session || this.isTokenExpired(session.token)) {
      if (this.isLoginRequired(session)) {
        await this.login()
      } else {
        await this.refreshToken(session.refreshToken)
      }
    }
  }

  async getMutations(cursor) {
    await this.ensureToken()
    // Hit API endpoint QRIS BCA dengan token
    // Ambil semua mutasi hari ini
    // unique_hash sebagai duplicate protection saat insert
  }
}
```

### Main Scrape Processor (BullMQ Worker)

```javascript
// workers/scrapeWorker.js
export async function scrapeProcessor(job) {
  const { channelId, channelType, clientId } = job.data

  // 1. Ambil browser instance
  const { context } = await browserPool.get(channelId)
  const page = await context.newPage()

  // 2. Ambil konfigurasi channel
  const channel = await db.paymentChannels.findUnique({
    where: { id: channelId }
  })
  const credentials = decrypt(channel.scraping_config)
  const state = await db.channelStates.findUnique({
    where: { channel_id: channelId }
  })

  try {
    // 3. Pilih scraper sesuai channel type
    const scraper = scraperFactory(channelType, page, channel)

    // 4. Pastikan sudah login
    await scraper.ensureLoggedIn(credentials)

    // 5. Ambil mutasi hari ini (semua baris)
    const startTime = Date.now()
    const today = new Date().toISOString().split('T')[0]   // YYYY-MM-DD
    const mutations = await scraper.getMutations(today)

    // 6. Insert transaksi baru ke DB
    let txNew = 0
    for (const mutation of mutations) {
      const uniqueHash = sha256(
        `${channelId}${mutation.reference_number}${mutation.amount}${mutation.date}`
      )

      const exists = await db.transactions.findUnique({
        where: { unique_hash: uniqueHash }
      })
      if (exists) continue   // duplicate protection

      const tx = await db.transactions.create({
        data: {
          payment_channel_id: channelId,
          amount: mutation.amount,
          reference_number: mutation.reference_number,
          unique_hash: uniqueHash,
          raw_data: JSON.stringify(mutation),
          match_status: 'unmatched',
          detected_at: new Date()   // waktu scraper mendeteksi, bukan waktu mutasi
        }
      })

      // 7. Push ke match queue
      await matchQueue.add('match', {
        transactionId: tx.id,
        channelId,
        amount: mutation.amount,
        detectedAt: new Date().toISOString(),
        attemptNumber: 1
      })

      txNew++
    }

    // 8. Update channel state
    // cursor = tanggal hari ini, unique_hash yang cegah duplikat
    const pendingCount = await db.invoices.count({
      where: { payment_channel_id: channelId, status: 'pending' }
    })

    await db.channelStates.update({
      where: { channel_id: channelId },
      data: {
        last_scraped_at: new Date(),
        last_success_at: new Date(),
        scrape_cursor: today,   // tanggal hari ini (YYYY-MM-DD)
        consecutive_errors: 0,
        scrape_priority: pendingCount > 0 ? 'high' : 'medium',
        next_scrape_at: pendingCount > 0
          ? new Date(Date.now() + 15_000)         // 15 detik
          : new Date(Date.now() + 5 * 60_000)     // 5 menit
      }
    })

    // 9. Log
    await db.scrapingLogs.create({
      data: {
        channel_id: channelId,
        status: 'success',
        tx_found: mutations.length,
        tx_new: txNew,
        duration_ms: Date.now() - startTime
      }
    })

  } catch (error) {
    await handleScrapeError(channelId, error)
    throw error   // BullMQ retry
  } finally {
    await page.close()
  }
}
```

---

## Transaction Matcher

Mencocokkan transaksi yang terdeteksi ke invoice pending.

### Matching Logic

```javascript
// workers/matchWorker.js
export async function matchProcessor(job) {
  const { transactionId, channelId, amount, attemptNumber } = job.data

  // Cari invoice yang cocok
  const invoice = await db.invoices.findFirst({
    where: {
      payment_channel_id: channelId,
      status: 'pending',
      amount_unique: amount,        // cocokkan ke amount_unique (sudah termasuk kode unik)
      expired_at: { gt: new Date() }
    },
    orderBy: { created_at: 'asc' }  // FIFO — invoice terlama duluan
  })

  if (!invoice) {
    // Tidak match — akan di-retry otomatis oleh BullMQ
    // (max 20x attempts, tiap 30 detik = 10 menit total)
    await db.transactions.update({
      where: { id: transactionId },
      data: {
        match_attempt: attemptNumber,
        last_match_attempt: new Date()
      }
    })

    // Setelah max attempts → tandai manual
    if (attemptNumber >= 20) {
      await db.transactions.update({
        where: { id: transactionId },
        data: { match_status: 'manual' }
      })
      // Notif ke klien untuk review manual
      await notifyUnmatched(channelId, transactionId)
    }
    throw new Error('NO_MATCH_FOUND')  // trigger BullMQ retry
  }

  // Match ditemukan — atomic update
  await db.$transaction([
    db.transactions.update({
      where: { id: transactionId },
      data: {
        invoice_id: invoice.id,
        match_status: 'matched'
      }
    }),
    db.invoices.update({
      where: { id: invoice.id },
      data: { status: 'paid', paid_at: new Date() }
    })
  ])

  // Plan gratis → insert balance ledger
  const channel = await db.paymentChannels.findUnique({
    where: { id: channelId }
  })
  if (channel.channel_owner === 'platform') {
    const availableAt = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)  // H+2
    await db.balanceLedger.create({
      data: {
        client_id: invoice.client_id,
        invoice_id: invoice.id,
        type: 'credit_pending',
        amount: invoice.amount,
        available_at: availableAt,
        note: `Invoice ${invoice.invoice_number} terbayar`
      }
    })
    await db.clientBalances.update({
      where: { client_id: invoice.client_id },
      data: {
        balance_pending: { increment: invoice.amount },
        total_earned: { increment: invoice.amount }
      }
    })
  }

  // Publish event ke Redis untuk SSE
  await redis.publish('invoice_events', JSON.stringify({
    event: 'invoice.paid',
    invoice_id: invoice.id,
    invoice_number: invoice.invoice_number,
    amount: invoice.amount,
    paid_at: new Date().toISOString()
  }))

  // Push webhook job
  const webhooks = await db.webhookEndpoints.findMany({
    where: {
      client_id: invoice.client_id,
      is_active: true
    }
  })
  for (const webhook of webhooks) {
    if (webhook.event_types.includes('invoice.paid')) {
      await webhookQueue.add('webhook', {
        webhookEndpointId: webhook.id,
        invoiceId: invoice.id,
        event: 'invoice.paid',
        attemptNumber: 1
      })
    }
  }
}
```

---

## SSE Manager

Push realtime ke halaman pembayaran pelanggan via Server-Sent Events.

### Fastify SSE Endpoint

```javascript
// routes/pay.js (di Fastify API)
fastify.get('/pay/:invoiceNumber/status', async (req, reply) => {
  const invoice = await db.invoices.findUnique({
    where: { invoice_number: req.params.invoiceNumber }
  })
  if (!invoice) return reply.code(404).send()

  // Kalau sudah paid → langsung return, tidak perlu SSE
  if (invoice.status === 'paid') {
    return reply.send({ status: 'paid', paid_at: invoice.paid_at })
  }

  // Setup SSE
  reply.raw.setHeader('Content-Type', 'text/event-stream')
  reply.raw.setHeader('Cache-Control', 'no-cache')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.flushHeaders()

  // Subscribe ke Redis channel
  const subscriber = redis.duplicate()
  await subscriber.subscribe('invoice_events')

  const sendEvent = (data) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  // Kirim heartbeat tiap 30 detik (cegah koneksi timeout)
  const heartbeat = setInterval(() => {
    reply.raw.write(': heartbeat\n\n')
  }, 30_000)

  subscriber.on('message', (channel, message) => {
    const event = JSON.parse(message)
    if (event.invoice_id === invoice.id) {
      sendEvent(event)
      cleanup()
    }
  })

  // Auto-close saat invoice expired
  const expiryMs = new Date(invoice.expired_at) - Date.now()
  const expiryTimeout = setTimeout(() => {
    sendEvent({ event: 'invoice.expired' })
    cleanup()
  }, expiryMs)

  const cleanup = () => {
    clearInterval(heartbeat)
    clearTimeout(expiryTimeout)
    subscriber.unsubscribe()
    subscriber.quit()
    reply.raw.end()
  }

  req.raw.on('close', cleanup)
})
```

### Flow SSE di Halaman Pembayaran

```javascript
// Frontend payment page
const evtSource = new EventSource(`/pay/${invoiceNumber}/status`)

evtSource.onmessage = (e) => {
  const data = JSON.parse(e.data)

  if (data.event === 'invoice.paid') {
    // Tampilkan halaman sukses
    showSuccessPage(data)
    evtSource.close()
  }

  if (data.event === 'invoice.expired') {
    // Tampilkan halaman expired
    showExpiredPage()
    evtSource.close()
  }
}
```

---

## Circuit Breaker

### State Machine

```
CLOSED ──(consecutive_errors >= 5)──► OPEN
                                         │
                                   (cooldown 15 menit)
                                         │
                                         ▼
                                     HALF-OPEN
                                      /      \
                                 sukses       gagal
                                   /              \
                                CLOSED            OPEN
                          (reset error count)  (cooldown ulang)
```

### Implementasi

```javascript
// circuitBreaker.js
export async function handleScrapeError(channelId, error) {
  const errorType = classifyError(error)
  const state = await db.channelStates.findUnique({
    where: { channel_id: channelId }
  })

  if (errorType === 'fatal') {
    // Fatal → langsung OPEN, jangan retry
    await db.channelStates.update({
      where: { channel_id: channelId },
      data: {
        circuit_state: 'open',
        circuit_opened_at: new Date(),
        consecutive_errors: { increment: 1 },
        last_error_at: new Date(),
        last_error_type: 'fatal',
        last_error_message: error.message
      }
    })
    await notifyClientFatalError(channelId, error)
    return
  }

  const newErrorCount = state.consecutive_errors + 1

  if (newErrorCount >= 5) {
    // Threshold tercapai → OPEN
    await db.channelStates.update({
      where: { channel_id: channelId },
      data: {
        circuit_state: 'open',
        circuit_opened_at: new Date(),
        consecutive_errors: newErrorCount,
        last_error_at: new Date(),
        last_error_type: errorType,
        last_error_message: error.message,
        next_scrape_at: new Date(Date.now() + 15 * 60_000)  // cooldown 15 menit
      }
    })
  } else {
    // Masih di bawah threshold → tetap CLOSED
    await db.channelStates.update({
      where: { channel_id: channelId },
      data: {
        consecutive_errors: newErrorCount,
        last_error_at: new Date(),
        last_error_type: errorType,
        last_error_message: error.message
      }
    })
  }

  await db.scrapingLogs.create({
    data: {
      channel_id: channelId,
      status: errorType === 'fatal' ? 'fatal' : 'transient',
      error_type: errorType,
      error_message: error.message
    }
  })
}

function classifyError(error) {
  // Fatal — perlu intervensi manual
  if (
    error.message.includes('LOGIN_FAILED') ||
    error.message.includes('ACCOUNT_BLOCKED') ||
    error.message.includes('CAPTCHA_DETECTED') ||
    error.message.includes('SELECTOR_NOT_FOUND')
  ) return 'fatal'

  // Transient — akan retry
  return 'transient'
}
```

### Cron: Recovery OPEN → HALF-OPEN

```javascript
// Jalankan tiap menit
async function circuitRecoveryCron() {
  const openChannels = await db.channelStates.findMany({
    where: {
      circuit_state: 'open',
      circuit_opened_at: {
        lte: new Date(Date.now() - 15 * 60_000)  // sudah lewat 15 menit
      }
    }
  })

  for (const channel of openChannels) {
    await db.channelStates.update({
      where: { channel_id: channel.channel_id },
      data: {
        circuit_state: 'half_open',
        next_scrape_at: new Date()   // coba scrape sekali
      }
    })
  }
}
```

---

## Error Handling

| Error | Tipe | Penanganan |
|---|---|---|
| Login gagal | Fatal | Stop scraping, notif klien, circuit OPEN |
| CAPTCHA muncul | Fatal | Stop scraping, notif klien, circuit OPEN |
| Selector tidak ditemukan | Fatal | Stop scraping, notif admin (kemungkinan bank update UI) |
| Session kicked (login manual klien) | Transient | Tunggu 5 menit, login ulang otomatis |
| Timeout koneksi | Transient | Retry dengan exponential backoff |
| Bank maintenance | Transient | Pause, resume otomatis setelah maintenance |
| Browser crash | Transient | Destroy instance, buat baru, retry |
| Redis down | Transient | Fallback session ke DB, queue pause |

---

## Resource Estimate

| Jumlah Akun | RAM Scraper | RAM Redis | Server Rekomendasi |
|---|---|---|---|
| 10 akun | ~1.5GB | ~256MB | 2 core / 4GB |
| 30 akun | ~4.5GB | ~512MB | 4 core / 8GB |
| 50 akun | ~7.5GB | ~512MB | 8 core / 16GB |
| 100 akun | ~15GB | ~1GB | 16 core / 32GB |

> Scraper service dan Fastify API sebaiknya di-deploy di server terpisah mulai 30+ akun.

---

## Cron Jobs

| Job | Interval | Fungsi |
|---|---|---|
| `settlementCron` | Tiap jam | Update balance pending → available (H+2) |
| `circuitRecoveryCron` | Tiap menit | Recovery circuit OPEN → HALF-OPEN |
| `invoiceExpiryCron` | Tiap menit | Update invoice expired yang lewat `expired_at` |
| `matchRetryCron` | — | Ditangani BullMQ otomatis |

---

## Catatan match_status

Tabel `transactions` menyimpan **semua mutasi masuk**, bukan hanya yang berasal dari invoice. Ini by design.

| match_status | Artinya |
|---|---|
| `unmatched` | Belum cocok dengan invoice, masih dalam retry window (max 10 menit) |
| `matched` | Berhasil cocok dengan invoice |
| `manual` | Tidak cocok setelah 20x retry — perlu review klien |
| `duplicate` | unique_hash sudah ada di DB sebelumnya — dilewati |

Mutasi yang masuk di luar invoice (misal transfer biasa ke rekening klien) akan menjadi `manual` setelah retry habis. Klien bisa melihatnya di dashboard sebagai **"Transaksi tidak dikenal"** untuk keperluan rekonsiliasi manual.

---

*Scraper service di-deploy sebagai Docker container terpisah menggunakan image `mcr.microsoft.com/playwright:v1.52.0-noble`. Redis berjalan sebagai container independen — dipakai bersama oleh scraper service dan Fastify API. Komunikasi antar service hanya melalui MariaDB dan Redis — tidak ada HTTP call langsung.*
