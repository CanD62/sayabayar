# API Structure — Payment Gateway Platform
> Version 1.0 | Fastify / Node.js | REST JSON

---

## Daftar Isi

1. [Konvensi Umum](#konvensi-umum)
2. [Auth Flow](#auth-flow)
3. [Middleware](#middleware)
4. [Error Codes](#error-codes)
5. [Endpoint: Auth](#endpoint-auth)
6. [Endpoint: Invoice](#endpoint-invoice)
7. [Endpoint: Payment Channel](#endpoint-payment-channel)
8. [Endpoint: Withdrawal](#endpoint-withdrawal)
9. [Endpoint: Webhook](#endpoint-webhook)
10. [Endpoint: Balance](#endpoint-balance)
11. [Endpoint: Subscription](#endpoint-subscription)

---

## Konvensi Umum

### Base URL
```
Production : https://api.yourdomain.com/v1
Sandbox    : https://sandbox-api.yourdomain.com/v1
```

### Request Headers
```
Content-Type  : application/json
Accept        : application/json
Authorization : Bearer <token>        (untuk akses dashboard/client)
X-Api-Key     : <api_key>             (untuk akses via API klien)
X-Request-Id  : <uuid>                (opsional, untuk idempotency)
```

### Response Format
Semua response menggunakan format konsisten:

```json
// Success
{
  "success": true,
  "data": { ... },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2025-01-01T00:00:00Z"
  }
}

// Success dengan pagination
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 100,
    "total_pages": 5
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2025-01-01T00:00:00Z"
  }
}

// Error
{
  "success": false,
  "error": {
    "code": "INVOICE_NOT_FOUND",
    "message": "Invoice tidak ditemukan.",
    "details": null
  },
  "meta": {
    "request_id": "uuid",
    "timestamp": "2025-01-01T00:00:00Z"
  }
}
```

### Pagination Query Params
```
?page=1&per_page=20&sort=created_at&order=desc
```

---

## Auth Flow

Platform memiliki **2 jalur autentikasi** berbeda:

```
Jalur 1 — Dashboard (JWT)
  Client login → dapat access_token (JWT, 15 menit)
                + refresh_token (httpOnly cookie, 7 hari)
  Setiap request → Authorization: Bearer <access_token>
  Token expired  → hit /auth/refresh untuk dapat token baru

Jalur 2 — API Key (X-Api-Key)
  Client generate API key di dashboard
  Setiap request → X-Api-Key: <raw_api_key>
  Server hash key → cari di tabel api_keys
  Catat last_used_at setiap request
```

### Diagram Flow

```
[Dashboard]                          [API Client]
     │                                    │
POST /auth/login                   X-Api-Key: sk_xxx
     │                                    │
     ▼                                    ▼
┌─────────────────┐            ┌──────────────────┐
│  Validate email │            │  Hash key        │
│  + password     │            │  Lookup api_keys │
└────────┬────────┘            └────────┬─────────┘
         │                              │
         ▼                              ▼
┌─────────────────┐            ┌──────────────────┐
│  Issue JWT      │            │  Validate        │
│  access_token   │            │  is_active &     │
│  refresh_token  │            │  client.status   │
└────────┬────────┘            └────────┬─────────┘
         │                              │
         ▼                              ▼
    Request dengan                 Request dengan
    Bearer token                   X-Api-Key
```

---

## Middleware

### Urutan Middleware per Request

```
Request masuk
    │
    ▼
1. requestId         → generate / ambil X-Request-Id
    │
    ▼
2. rateLimiter       → cek limit per IP / per API key
    │
    ▼
3. authenticate      → validasi Bearer JWT atau X-Api-Key
    │
    ▼
4. checkClientStatus → pastikan client.status = 'active'
    │
    ▼
5. checkPlanAccess   → validasi fitur sesuai plan (gratis/langganan)
    │
    ▼
6. Route Handler
    │
    ▼
7. responseFormatter → wrap semua response ke format standar
    │
    ▼
8. errorHandler      → tangkap semua error, format ke response error standar
```

### Rate Limiter

| Scope | Limit |
|---|---|
| Per IP (unauthenticated) | 30 req / menit |
| Per client (dashboard JWT) | 120 req / menit |
| Per API key | 60 req / menit |
| POST /invoices via API key | 30 req / menit |

Header response saat rate limit:
```
X-RateLimit-Limit     : 60
X-RateLimit-Remaining : 45
X-RateLimit-Reset     : 1704067200
```

### checkPlanAccess

Middleware ini memvalidasi akses fitur berdasarkan plan aktif klien:

```javascript
// Contoh penggunaan di route
fastify.post('/channels', {
  preHandler: [authenticate, checkClientStatus, checkPlanAccess('can_add_own_channel')]
}, handler)
```

| Permission key | Keterangan |
|---|---|
| `can_add_own_channel` | Hanya plan langganan |
| `can_request_withdrawal` | Hanya plan gratis (channel platform) |
| `can_use_api` | Semua plan |

---

## Error Codes

### HTTP Status

| Status | Digunakan untuk |
|---|---|
| `200` | Success |
| `201` | Created |
| `400` | Validasi gagal / request tidak valid |
| `401` | Tidak ada / token invalid |
| `403` | Ada token tapi tidak punya akses |
| `404` | Resource tidak ditemukan |
| `409` | Konflik (duplicate, state tidak sesuai) |
| `422` | Data valid tapi tidak bisa diproses |
| `429` | Rate limit terlampaui |
| `500` | Internal server error |

### Error Code List

#### Auth
| Code | Status | Keterangan |
|---|---|---|
| `INVALID_CREDENTIALS` | 401 | Email / password salah |
| `TOKEN_EXPIRED` | 401 | JWT access token expired |
| `TOKEN_INVALID` | 401 | JWT tidak valid / tampered |
| `REFRESH_TOKEN_EXPIRED` | 401 | Refresh token expired, harus login ulang |
| `API_KEY_INVALID` | 401 | API key tidak ditemukan / tidak aktif |
| `UNAUTHORIZED` | 401 | Tidak ada token sama sekali |
| `FORBIDDEN` | 403 | Token valid tapi tidak punya akses ke resource ini |
| `CLIENT_SUSPENDED` | 403 | Akun klien di-suspend |
| `PLAN_FEATURE_UNAVAILABLE` | 403 | Fitur tidak tersedia di plan saat ini |

#### Invoice
| Code | Status | Keterangan |
|---|---|---|
| `INVOICE_NOT_FOUND` | 404 | Invoice tidak ditemukan |
| `INVOICE_ALREADY_PAID` | 409 | Invoice sudah dibayar |
| `INVOICE_EXPIRED` | 422 | Invoice sudah expired |
| `INVOICE_CANCELLED` | 422 | Invoice sudah dibatalkan |
| `AMOUNT_TOO_LOW` | 400 | Nominal di bawah minimum (Rp 1.000) |
| `CHANNEL_NOT_FOUND` | 404 | Payment channel tidak ditemukan |
| `CHANNEL_INACTIVE` | 422 | Payment channel tidak aktif |

#### Payment Channel
| Code | Status | Keterangan |
|---|---|---|
| `CHANNEL_NOT_FOUND` | 404 | Channel tidak ditemukan |
| `CHANNEL_LIMIT_REACHED` | 422 | Sudah mencapai batas max_channels |
| `CHANNEL_ALREADY_EXISTS` | 409 | Nomor rekening sudah terdaftar |

#### Withdrawal
| Code | Status | Keterangan |
|---|---|---|
| `INSUFFICIENT_BALANCE` | 422 | Saldo available tidak cukup |
| `BELOW_MINIMUM_WITHDRAW` | 400 | Di bawah minimum withdraw (Rp 50.000) |
| `BALANCE_STILL_PENDING` | 422 | Dana masih dalam masa H+2 |
| `WITHDRAWAL_NOT_FOUND` | 404 | Withdrawal tidak ditemukan |

#### Umum
| Code | Status | Keterangan |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Field tidak valid, lihat `details` |
| `RESOURCE_NOT_FOUND` | 404 | Resource generik tidak ditemukan |
| `DUPLICATE_REQUEST` | 409 | Request idempotency key sudah diproses |
| `RATE_LIMIT_EXCEEDED` | 429 | Terlalu banyak request |
| `INTERNAL_ERROR` | 500 | Server error |

---

## Endpoint: Auth

### POST /auth/register
Daftarkan akun klien baru.

**Request:**
```json
{
  "name": "Toko Budi",
  "email": "budi@example.com",
  "password": "Min8KarakterDanAda1Angka",
  "phone": "08123456789"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Toko Budi",
    "email": "budi@example.com",
    "status": "active"
  }
}
```

---

### POST /auth/login
Login dan dapat JWT token.

**Request:**
```json
{
  "email": "budi@example.com",
  "password": "Min8KarakterDanAda1Angka"
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "expires_in": 900
  }
}
```
> `refresh_token` dikirim via httpOnly cookie, bukan response body.

---

### POST /auth/refresh
Perbarui access token menggunakan refresh token dari cookie.

**Request:** *(tidak perlu body, refresh token diambil dari cookie)*

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "access_token": "eyJ...",
    "expires_in": 900
  }
}
```

---

### POST /auth/logout
Invalidate refresh token.

**Response `200`:**
```json
{
  "success": true,
  "data": null
}
```

---

### GET /auth/me
Ambil data profil klien yang sedang login.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Toko Budi",
    "email": "budi@example.com",
    "phone": "08123456789",
    "status": "active",
    "plan": {
      "name": "Langganan",
      "plan_type": "subscription",
      "current_period_end": "2025-02-01"
    },
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

---

## Endpoint: API Keys

### GET /api-keys
Daftar semua API key milik klien.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "label": "Production Server",
      "key_preview": "sk_live_xxxx...xxxx",
      "is_active": true,
      "last_used_at": "2025-01-10T08:00:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /api-keys
Buat API key baru. Raw key **hanya ditampilkan sekali** saat dibuat.

**Request:**
```json
{
  "label": "Production Server"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "label": "Production Server",
    "key": "pgk_live_<your_api_key_32_chars_here>",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```
> ⚠️ Simpan `key` sekarang — tidak akan ditampilkan lagi.

---

### DELETE /api-keys/:id
Nonaktifkan API key.

**Response `200`:**
```json
{
  "success": true,
  "data": null
}
```

---

## Endpoint: Invoice

> Endpoint ini bisa diakses via **Bearer JWT** (dashboard) maupun **X-Api-Key** (API klien).

### POST /invoices
Buat invoice baru dan generate payment link.

**Request:**
```json
{
  "payment_channel_id": "uuid",
  "amount": 150000,
  "description": "Pembayaran Produk A",
  "customer_name": "John Doe",
  "customer_email": "john@example.com",
  "expired_minutes": 60
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "invoice_number": "INV-20250101-0001",
    "amount": 150000,
    "amount_unique": 150123,
    "unique_code": 123,
    "payment_url": "https://pay.yourdomain.com/inv/INV-20250101-0001",
    "status": "pending",
    "expired_at": "2025-01-01T01:00:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

> `unique_code` dan `amount_unique` hanya muncul jika klien menggunakan channel platform (plan gratis).

---

### GET /invoices
Daftar invoice dengan filter dan pagination.

**Query params:**
```
?status=pending&channel_id=uuid&page=1&per_page=20
?date_from=2025-01-01&date_to=2025-01-31
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "invoice_number": "INV-20250101-0001",
      "customer_name": "John Doe",
      "amount": 150000,
      "amount_unique": 150123,
      "status": "paid",
      "payment_url": "https://pay.yourdomain.com/inv/INV-20250101-0001",
      "expired_at": "2025-01-01T01:00:00Z",
      "paid_at": "2025-01-01T00:30:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 45,
    "total_pages": 3
  }
}
```

---

### GET /invoices/:id
Detail satu invoice.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "invoice_number": "INV-20250101-0001",
    "customer_name": "John Doe",
    "customer_email": "john@example.com",
    "amount": 150000,
    "amount_unique": 150123,
    "unique_code": 123,
    "description": "Pembayaran Produk A",
    "status": "paid",
    "source": "api",
    "payment_url": "https://pay.yourdomain.com/inv/INV-20250101-0001",
    "payment_channel": {
      "id": "uuid",
      "channel_type": "bca_transfer",
      "account_name": "PT Contoh",
      "account_number": "1234567890"
    },
    "expired_at": "2025-01-01T01:00:00Z",
    "paid_at": "2025-01-01T00:30:00Z",
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

---

### DELETE /invoices/:id
Batalkan invoice (hanya jika status `pending`).

**Response `200`:**
```json
{
  "success": true,
  "data": null
}
```

**Error jika sudah paid:**
```json
{
  "success": false,
  "error": {
    "code": "INVOICE_ALREADY_PAID",
    "message": "Invoice yang sudah dibayar tidak dapat dibatalkan."
  }
}
```

---

### GET /pay/:invoice_number *(Public)*
Halaman pembayaran — endpoint publik, tidak perlu auth. Diakses pelanggan via payment link.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "invoice_number": "INV-20250101-0001",
    "merchant_name": "Toko Budi",
    "description": "Pembayaran Produk A",
    "amount": 150000,
    "amount_to_pay": 150123,
    "unique_code": 123,
    "status": "pending",
    "payment_channel": {
      "channel_type": "bca_transfer",
      "account_name": "PT Contoh",
      "account_number": "1234567890"
    },
    "expired_at": "2025-01-01T01:00:00Z"
  }
}
```

---

## Endpoint: Payment Channel

### GET /channels
Daftar semua channel milik klien.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "channel_type": "bca_transfer",
      "channel_owner": "client",
      "account_name": "Toko Budi",
      "account_number": "1234567890",
      "is_active": true,
      "circuit_state": "closed",
      "last_scraped_at": "2025-01-01T00:55:00Z",
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /channels
Tambah channel baru. Hanya plan langganan yang bisa tambah channel `client`.

**Request:**
```json
{
  "channel_type": "bca_transfer",
  "account_name": "Toko Budi",
  "account_number": "1234567890",
  "scraping_config": {
    "username": "123456789",
    "password": "rahasia123"
  }
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "channel_type": "bca_transfer",
    "channel_owner": "client",
    "account_name": "Toko Budi",
    "account_number": "1234567890",
    "is_active": true,
    "created_at": "2025-01-01T00:00:00Z"
  }
}
```

---

### PATCH /channels/:id
Update status aktif channel.

**Request:**
```json
{
  "is_active": false
}
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "is_active": false
  }
}
```

---

### DELETE /channels/:id
Hapus channel. Tidak bisa dihapus jika ada invoice `pending`.

**Response `200`:**
```json
{
  "success": true,
  "data": null
}
```

---

## Endpoint: Withdrawal

> Hanya untuk klien plan gratis yang menggunakan channel platform.

### GET /withdrawals
Riwayat withdraw.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "amount": 100000,
      "fee": 2500,
      "amount_received": 97500,
      "destination_bank": "BCA",
      "destination_account": "1234567890",
      "destination_name": "Toko Budi",
      "status": "processed",
      "requested_at": "2025-01-01T00:00:00Z",
      "processed_at": "2025-01-01T02:00:00Z"
    }
  ]
}
```

---

### POST /withdrawals
Request withdraw saldo available.

**Request:**
```json
{
  "amount": 100000,
  "destination_bank": "BCA",
  "destination_account": "1234567890",
  "destination_name": "Toko Budi"
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "amount": 100000,
    "fee": 2500,
    "amount_received": 97500,
    "status": "pending",
    "requested_at": "2025-01-01T00:00:00Z"
  }
}
```

---

## Endpoint: Balance

> Hanya untuk klien plan gratis.

### GET /balance
Saldo real-time klien.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "balance_pending": 150000,
    "balance_available": 320000,
    "total_earned": 1500000,
    "total_withdrawn": 1030000
  }
}
```

---

### GET /balance/ledger
Riwayat mutasi saldo.

**Query params:**
```
?type=credit_pending&page=1&per_page=20
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "type": "credit_pending",
      "amount": 150123,
      "note": "Invoice INV-20250101-0001 terbayar",
      "available_at": "2025-01-03T00:30:00Z",
      "settled_at": null,
      "created_at": "2025-01-01T00:30:00Z"
    },
    {
      "id": "uuid",
      "type": "credit_available",
      "amount": 150123,
      "note": "Dana tersedia setelah H+2",
      "available_at": "2025-01-03T00:30:00Z",
      "settled_at": "2025-01-03T01:00:00Z",
      "created_at": "2025-01-03T01:00:00Z"
    }
  ]
}
```

---

## Endpoint: Webhook

### GET /webhooks
Daftar webhook endpoint.

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "url": "https://mystore.com/webhook/payment",
      "event_types": ["invoice.paid", "invoice.expired"],
      "is_active": true,
      "created_at": "2025-01-01T00:00:00Z"
    }
  ]
}
```

---

### POST /webhooks
Daftarkan webhook endpoint baru.

**Request:**
```json
{
  "url": "https://mystore.com/webhook/payment",
  "event_types": ["invoice.paid", "invoice.expired"]
}
```

**Response `201`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "url": "https://mystore.com/webhook/payment",
    "secret": "whsec_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "event_types": ["invoice.paid", "invoice.expired"],
    "is_active": true
  }
}
```
> ⚠️ Simpan `secret` sekarang — tidak akan ditampilkan lagi. Digunakan untuk verifikasi signature.

---

### DELETE /webhooks/:id
Hapus webhook endpoint.

**Response `200`:**
```json
{
  "success": true,
  "data": null
}
```

---

### POST /webhooks/:id/test
Kirim test event ke webhook endpoint.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "http_status": 200,
    "response_body": "ok",
    "duration_ms": 234
  }
}
```

---

### Webhook Payload (Dikirim ke sistem klien)

```json
{
  "event": "invoice.paid",
  "timestamp": "2025-01-01T00:30:00Z",
  "data": {
    "invoice_id": "uuid",
    "invoice_number": "INV-20250101-0001",
    "amount": 150000,
    "amount_paid": 150123,
    "status": "paid",
    "paid_at": "2025-01-01T00:30:00Z",
    "customer_name": "John Doe",
    "customer_email": "john@example.com"
  }
}
```

Header yang dikirim:
```
X-Webhook-Signature : sha256=<hmac_signature>
X-Webhook-Event     : invoice.paid
X-Webhook-Timestamp : 1704067800
```

Verifikasi signature di sisi klien:
```javascript
const payload   = JSON.stringify(body)
const timestamp = req.headers['x-webhook-timestamp']
const expected  = crypto
  .createHmac('sha256', webhookSecret)
  .update(`${timestamp}.${payload}`)
  .digest('hex')

const received = req.headers['x-webhook-signature'].replace('sha256=', '')
const isValid  = crypto.timingSafeEqual(
  Buffer.from(expected),
  Buffer.from(received)
)
```

---

## Endpoint: Subscription

### GET /subscription
Info langganan aktif klien saat ini.

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "plan": {
      "name": "Langganan",
      "plan_type": "subscription",
      "monthly_price": 99000,
      "withdraw_fee": 2500,
      "can_add_own_channel": true,
      "max_channels": 10
    },
    "status": "active",
    "current_period_start": "2025-01-01",
    "current_period_end": "2025-02-01"
  }
}
```

---

### GET /subscription/plans
Daftar semua plan yang tersedia (untuk halaman upgrade).

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Gratis",
      "plan_type": "free",
      "monthly_price": 0,
      "withdraw_fee": 2500,
      "can_add_own_channel": false,
      "max_channels": 1
    },
    {
      "id": "uuid",
      "name": "Langganan",
      "plan_type": "subscription",
      "monthly_price": 99000,
      "withdraw_fee": 2500,
      "can_add_own_channel": true,
      "max_channels": 10
    }
  ]
}
```

---

## Ringkasan Endpoint

```
Auth
  POST   /auth/register
  POST   /auth/login
  POST   /auth/refresh
  POST   /auth/logout
  GET    /auth/me

API Keys
  GET    /api-keys
  POST   /api-keys
  DELETE /api-keys/:id

Invoices
  GET    /invoices
  POST   /invoices
  GET    /invoices/:id
  DELETE /invoices/:id
  GET    /pay/:invoice_number     (public)

Payment Channels
  GET    /channels
  POST   /channels
  PATCH  /channels/:id
  DELETE /channels/:id

Withdrawals
  GET    /withdrawals
  POST   /withdrawals

Balance
  GET    /balance
  GET    /balance/ledger

Webhooks
  GET    /webhooks
  POST   /webhooks
  DELETE /webhooks/:id
  POST   /webhooks/:id/test

Subscription
  GET    /subscription
  GET    /subscription/plans
```

---

*Semua endpoint kecuali `/pay/:invoice_number` memerlukan autentikasi via Bearer JWT atau X-Api-Key.*
