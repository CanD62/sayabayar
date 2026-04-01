# Database Schema — Payment Gateway Platform
> Version 2.1 | Added unique code, H+2 settlement (client_balances, balance_ledger)

---

## Daftar Tabel

| Tabel | Deskripsi |
|---|---|
| `clients` | Data merchant/pengguna platform |
| `api_keys` | API key per klien |
| `subscription_plans` | Definisi plan (gratis & langganan) |
| `client_subscriptions` | Langganan aktif per klien |
| `payment_channels` | Rekening/QRIS yang terdaftar |
| `channel_states` | State scraping & circuit breaker per channel |
| `invoices` | Invoice pembayaran |
| `transactions` | Hasil deteksi scraping |
| `client_balances` | Saldo real-time per klien (plan gratis) |
| `balance_ledger` | Riwayat mutasi saldo (pending & available) |
| `withdrawals` | Request withdraw (plan gratis) |
| `webhook_endpoints` | URL webhook klien |
| `webhook_logs` | Log pengiriman webhook |
| `scraping_logs` | Log setiap sesi scraping |

---

## Tabel: `clients`

Data utama merchant yang mendaftar ke platform.

```sql
CREATE TABLE clients (
  id            CHAR(36)        NOT NULL DEFAULT (UUID()),
  name          VARCHAR(100)    NOT NULL,
  email         VARCHAR(100)    NOT NULL UNIQUE,
  password_hash VARCHAR(255)    NOT NULL,
  phone         VARCHAR(20),
  status        ENUM(
                  'active',
                  'suspended',
                  'inactive'
                )               NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id)
);
```

---

## Tabel: `api_keys`

API key untuk akses via API (entry point kedua selain dashboard).

```sql
CREATE TABLE api_keys (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  client_id    CHAR(36)     NOT NULL,
  key_hash     VARCHAR(64)  NOT NULL UNIQUE,  -- SHA-256 dari raw key
  label        VARCHAR(100),                  -- nama/deskripsi key
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  last_used_at TIMESTAMP,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

---

## Tabel: `subscription_plans`

Definisi plan yang tersedia di platform.

```sql
CREATE TABLE subscription_plans (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  name                 VARCHAR(100)  NOT NULL,
  plan_type            ENUM(
                         'free',
                         'subscription'
                       )             NOT NULL,
  max_channels         INT           NOT NULL DEFAULT 1,
  monthly_price        DECIMAL(12,2) NOT NULL DEFAULT 0,
  withdraw_fee         DECIMAL(12,2) NOT NULL DEFAULT 0,
  can_add_own_channel  BOOLEAN       NOT NULL DEFAULT FALSE,
  is_active            BOOLEAN       NOT NULL DEFAULT TRUE,

  PRIMARY KEY (id)
);
```

### Data Awal (Seed)

| name | plan_type | monthly_price | withdraw_fee | can_add_own_channel |
|---|---|---|---|---|
| Gratis | free | 0 | 2500 | false |
| Langganan | subscription | 99000 | 2500 | true |

> **Catatan:** Plan langganan tetap kena `withdraw_fee` jika klien menggunakan channel platform sebagai backup.

---

## Tabel: `client_subscriptions`

Riwayat dan status langganan per klien.

```sql
CREATE TABLE client_subscriptions (
  id                   CHAR(36)  NOT NULL DEFAULT (UUID()),
  client_id            CHAR(36)  NOT NULL,
  plan_id              CHAR(36)  NOT NULL,
  status               ENUM(
                         'active',
                         'expired',
                         'cancelled'
                       )         NOT NULL DEFAULT 'active',
  current_period_start DATE      NOT NULL,
  current_period_end   DATE      NOT NULL,
  created_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id) REFERENCES clients(id),
  FOREIGN KEY (plan_id)   REFERENCES subscription_plans(id)
);
```

---

## Tabel: `payment_channels`

Rekening atau QRIS yang digunakan untuk menerima pembayaran.

```sql
CREATE TABLE payment_channels (
  id               CHAR(36)     NOT NULL DEFAULT (UUID()),
  client_id        CHAR(36)     NOT NULL,
  channel_type     ENUM(
                     'bca_transfer',
                     'qris_bca',
                     'qris_gopay'
                   )            NOT NULL,
  channel_owner    ENUM(
                     'platform', -- rekening milik operator (plan gratis)
                     'client'    -- rekening milik klien (plan langganan)
                   )            NOT NULL,
  account_name     VARCHAR(100) NOT NULL,
  account_number   VARCHAR(50)  NOT NULL,
  scraping_config  JSON         NOT NULL,  -- WAJIB dienkripsi di app layer
  is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

> **Keamanan:** `scraping_config` menyimpan kredensial login bank. Enkripsi wajib dilakukan di application layer sebelum disimpan (AES-256 recommended).

### Aturan channel_owner per Plan

| Plan | channel_owner yang diizinkan |
|---|---|
| Gratis | `platform` only |
| Langganan | `client` + boleh tambah `platform` sebagai backup |

---

## Tabel: `channel_states`

State scraping dan circuit breaker per channel. Dipisah dari `payment_channels` agar tidak lock tabel utama saat scraping berjalan.

```sql
CREATE TABLE channel_states (
  channel_id          CHAR(36)     NOT NULL,

  -- Circuit Breaker
  circuit_state       ENUM(
                        'closed',    -- normal, scraping berjalan
                        'open',      -- dihentikan sementara
                        'half_open'  -- sedang test recovery
                      )             NOT NULL DEFAULT 'closed',
  circuit_opened_at   TIMESTAMP,
  consecutive_errors  INT          NOT NULL DEFAULT 0,
  last_error_at       TIMESTAMP,
  last_error_type     ENUM(
                        'fatal',
                        'transient',
                        'empty_result'
                      ),
  last_error_message  TEXT,

  -- Scraping State
  last_scraped_at     TIMESTAMP,
  last_success_at     TIMESTAMP,
  scrape_cursor       VARCHAR(255),  -- ID/timestamp transaksi terakhir diproses
  session_data        TEXT,          -- cookies/token aktif, WAJIB dienkripsi

  -- Scheduler
  next_scrape_at      TIMESTAMP,
  scrape_priority     ENUM(
                        'high',    -- ada invoice pending
                        'medium',  -- akun aktif
                        'low'      -- jarang transaksi
                      )             NOT NULL DEFAULT 'medium',

  -- Anomaly Detection
  last_known_balance  DECIMAL(15,2),

  updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (channel_id),
  FOREIGN KEY (channel_id) REFERENCES payment_channels(id)
);
```

### Circuit Breaker State Machine

```
CLOSED ──(5 error / 10 menit)──► OPEN
                                    │
                              (cooldown 15 menit)
                                    │
                                    ▼
                               HALF-OPEN
                                 /    \
                            sukses    gagal
                              /          \
                           CLOSED        OPEN
```

---

## Tabel: `invoices`

Invoice pembayaran yang dibuat klien.

```sql
CREATE TABLE invoices (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  client_id           CHAR(36)      NOT NULL,
  payment_channel_id  CHAR(36)      NOT NULL,
  invoice_number      VARCHAR(50)   NOT NULL UNIQUE,
  customer_name       VARCHAR(200),
  customer_email      VARCHAR(100),
  amount              DECIMAL(15,2) NOT NULL,   -- nominal asli dari klien
  unique_code         SMALLINT      NOT NULL DEFAULT 0, -- angka unik 1-999 (hanya plan gratis)
  amount_unique       DECIMAL(15,2) NOT NULL,   -- amount + unique_code (yang dibayar customer)
  unique_code_revenue DECIMAL(15,2) NOT NULL DEFAULT 0, -- nilai unique_code (pendapatan platform)
  description         TEXT,
  status              ENUM(
                        'pending',
                        'paid',
                        'expired',
                        'cancelled'
                      )             NOT NULL DEFAULT 'pending',
  source              ENUM(
                        'dashboard', -- dibuat manual via dashboard
                        'api'        -- dibuat via API klien
                      )             NOT NULL,
  payment_url         VARCHAR(500)  NOT NULL,
  expired_at          TIMESTAMP     NOT NULL,
  paid_at             TIMESTAMP,
  created_at          TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id)           REFERENCES clients(id),
  FOREIGN KEY (payment_channel_id)  REFERENCES payment_channels(id),
  INDEX idx_status_expired (status, expired_at),
  INDEX idx_channel_pending (payment_channel_id, status)
);
```

### Logika Kode Unik

Kode unik **hanya aktif untuk plan gratis** (channel platform). Plan langganan `unique_code = 0` dan `amount_unique = amount`.

```
Plan gratis:
  amount         = 150.000  (nominal dari klien)
  unique_code    = 123       (random 1–999, generate saat buat invoice)
  amount_unique  = 150.123   (yang ditampilkan ke customer & dicocokkan scraping)
  unique_code_revenue = 123  (masuk pendapatan platform)

Plan langganan:
  amount         = 150.000
  unique_code    = 0
  amount_unique  = 150.000
  unique_code_revenue = 0
```

> **Catatan:** Matching scraping untuk plan gratis menggunakan `amount_unique`, bukan `amount`.

---

## Tabel: `transactions`

Hasil deteksi pembayaran dari proses scraping.

```sql
CREATE TABLE transactions (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  invoice_id          CHAR(36),                -- NULL jika belum match
  payment_channel_id  CHAR(36)      NOT NULL,
  amount              DECIMAL(15,2) NOT NULL,
  reference_number    VARCHAR(100),
  unique_hash         VARCHAR(64)   NOT NULL UNIQUE,  -- duplicate protection
  raw_data            TEXT,                           -- data mentah dari scraping
  match_status        ENUM(
                        'matched',    -- berhasil match ke invoice
                        'unmatched',  -- belum match, masih dalam retry window
                        'duplicate',  -- sudah pernah diproses
                        'manual'      -- perlu review manual
                      )             NOT NULL DEFAULT 'unmatched',
  match_attempt       INT           NOT NULL DEFAULT 0,  -- jumlah percobaan matching
  last_match_attempt  TIMESTAMP,
  detected_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (invoice_id)          REFERENCES invoices(id),
  FOREIGN KEY (payment_channel_id)  REFERENCES payment_channels(id),
  INDEX idx_unmatched (match_status, detected_at)
);
```

### Duplicate Protection

`unique_hash` dibentuk dari:
```
SHA-256(channel_id + reference_number + amount + timestamp)
```

Sebelum insert, cek apakah hash sudah ada. Jika ada → skip.

### Matching Retry Flow

```
Transaksi masuk → coba match ke invoice
  ├── Match ditemukan → status = matched, update invoice = paid
  └── Tidak match → masuk unmatched pool
        └── Retry tiap 30 detik selama 10 menit (max 20 attempt)
              ├── Match ditemukan → status = matched
              └── Tetap tidak match → status = manual, notif klien
```

---

## Tabel: `client_balances`

Saldo real-time per klien plan gratis. Dipisah dari `clients` agar tidak lock tabel utama saat update saldo.

```sql
CREATE TABLE client_balances (
  client_id          CHAR(36)      NOT NULL,
  balance_pending    DECIMAL(15,2) NOT NULL DEFAULT 0, -- belum H+2, belum bisa dicairkan
  balance_available  DECIMAL(15,2) NOT NULL DEFAULT 0, -- sudah H+2, siap dicairkan
  total_earned       DECIMAL(15,2) NOT NULL DEFAULT 0, -- akumulasi semua yang pernah masuk
  total_withdrawn    DECIMAL(15,2) NOT NULL DEFAULT 0, -- akumulasi semua yang sudah dicairkan
  updated_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                   ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (client_id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

---

## Tabel: `balance_ledger`

Riwayat setiap mutasi saldo — sumber kebenaran untuk rekonsiliasi dan audit.

```sql
CREATE TABLE balance_ledger (
  id              CHAR(36)      NOT NULL DEFAULT (UUID()),
  client_id       CHAR(36)      NOT NULL,
  invoice_id      CHAR(36),                  -- NULL untuk entry withdraw
  withdrawal_id   CHAR(36),                  -- NULL untuk entry invoice
  type            ENUM(
                    'credit_pending',         -- dana masuk, belum H+2
                    'credit_available',       -- dana H+2 tiba, pindah ke available
                    'debit_withdraw'          -- dana dicairkan
                  )             NOT NULL,
  amount          DECIMAL(15,2) NOT NULL,    -- selalu positif
  available_at    TIMESTAMP     NOT NULL,    -- kapan dana bisa dicairkan (detected_at + 2 hari)
  settled_at      TIMESTAMP,                 -- kapan status berubah jadi available (diisi cron)
  note            VARCHAR(255),
  created_at      TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id)    REFERENCES clients(id),
  FOREIGN KEY (invoice_id)   REFERENCES invoices(id),
  FOREIGN KEY (withdrawal_id) REFERENCES withdrawals(id),
  INDEX idx_client_available (client_id, type, available_at)
);
```

### Flow H+2 Settlement

```
Invoice paid (plan gratis):
  1. Insert balance_ledger → type = credit_pending
                           → available_at = NOW() + 2 hari
  2. Update client_balances → balance_pending += amount

Cron job (tiap jam):
  3. Cek balance_ledger WHERE type = credit_pending
                          AND available_at <= NOW()
                          AND settled_at IS NULL
  4. Update balance_ledger → type = credit_available
                           → settled_at = NOW()
  5. Update client_balances → balance_pending -= amount
                            → balance_available += amount

Klien request withdraw:
  6. Cek balance_available cukup
  7. Insert balance_ledger  → type = debit_withdraw
  8. Update client_balances → balance_available -= amount
                            → total_withdrawn += amount
  9. Insert withdrawals     → status = pending
```

### Hitung Pendapatan Platform dari Kode Unik

```sql
-- Pendapatan kode unik per periode
SELECT
  SUM(unique_code_revenue) AS total_unique_code_revenue
FROM invoices
WHERE status = 'paid'
  AND created_at BETWEEN '2025-01-01' AND '2025-01-31';
```

---

## Tabel: `withdrawals`

Request penarikan dana untuk klien plan gratis (dana di rekening platform).

```sql
CREATE TABLE withdrawals (
  id                   CHAR(36)      NOT NULL DEFAULT (UUID()),
  client_id            CHAR(36)      NOT NULL,
  amount               DECIMAL(15,2) NOT NULL,  -- jumlah yang diminta
  fee                  DECIMAL(12,2) NOT NULL DEFAULT 2500,
  amount_received      DECIMAL(15,2) NOT NULL,  -- amount - fee
  destination_bank     VARCHAR(50)   NOT NULL,
  destination_account  VARCHAR(50)   NOT NULL,
  destination_name     VARCHAR(100)  NOT NULL,
  status               ENUM(
                         'pending',
                         'processed',
                         'rejected'
                       )             NOT NULL DEFAULT 'pending',
  rejection_reason     TEXT,
  requested_at         TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at         TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

---

## Tabel: `webhook_endpoints`

URL webhook yang didaftarkan klien untuk notifikasi otomatis.

```sql
CREATE TABLE webhook_endpoints (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  client_id    CHAR(36)     NOT NULL,
  url          VARCHAR(500) NOT NULL,
  secret_hash  VARCHAR(64)  NOT NULL,  -- untuk verifikasi signature
  event_types  JSON         NOT NULL,  -- ["invoice.paid", "invoice.expired"]
  is_active    BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (client_id) REFERENCES clients(id)
);
```

---

## Tabel: `webhook_logs`

Log setiap pengiriman webhook beserta hasilnya.

```sql
CREATE TABLE webhook_logs (
  id             CHAR(36)  NOT NULL DEFAULT (UUID()),
  webhook_id     CHAR(36)  NOT NULL,
  invoice_id     CHAR(36)  NOT NULL,
  http_status    INT,
  response_body  TEXT,
  attempt_number INT       NOT NULL DEFAULT 1,
  sent_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (webhook_id) REFERENCES webhook_endpoints(id),
  FOREIGN KEY (invoice_id) REFERENCES invoices(id)
);
```

> **Retry policy:** Kirim ulang jika `http_status` bukan 2xx. Maksimal 5 attempt dengan exponential backoff (1m, 5m, 15m, 1h, 6h).

---

## Tabel: `scraping_logs`

Log setiap sesi scraping untuk debugging dan monitoring.

```sql
CREATE TABLE scraping_logs (
  id           CHAR(36)     NOT NULL DEFAULT (UUID()),
  channel_id   CHAR(36)     NOT NULL,
  status       ENUM(
                 'success',
                 'transient',  -- error sementara, akan retry
                 'fatal'       -- error permanen, perlu intervensi
               )             NOT NULL,
  error_type   VARCHAR(100),
  error_message TEXT,
  tx_found     INT           NOT NULL DEFAULT 0,  -- jumlah transaksi ditemukan
  tx_new       INT           NOT NULL DEFAULT 0,  -- jumlah transaksi baru diproses
  duration_ms  INT,
  scraped_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  FOREIGN KEY (channel_id) REFERENCES payment_channels(id),
  INDEX idx_channel_time (channel_id, scraped_at)
);
```

---

## Ringkasan Relasi

```
clients
  ├── api_keys
  ├── client_subscriptions → subscription_plans
  ├── payment_channels
  │     └── channel_states
  ├── invoices → payment_channels
  │     ├── transactions
  │     ├── balance_ledger
  │     └── webhook_logs → webhook_endpoints
  ├── client_balances
  ├── balance_ledger
  ├── withdrawals
  │     └── balance_ledger
  └── webhook_endpoints
```

---

## Catatan Keamanan

| Field | Perlakuan |
|---|---|
| `scraping_config` di `payment_channels` | Enkripsi AES-256 sebelum simpan |
| `session_data` di `channel_states` | Enkripsi AES-256 sebelum simpan |
| `key_hash` di `api_keys` | Hash SHA-256 dari raw API key |
| `secret_hash` di `webhook_endpoints` | Hash SHA-256 dari raw secret |
| `password_hash` di `clients` | Bcrypt / Argon2 |

---

*Schema ini menggunakan UUID bawaan MariaDB sebagai primary key — `CHAR(36) DEFAULT (UUID())`.*
