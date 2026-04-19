// packages/shared/src/constants/index.js

export const INVOICE_STATUS = {
  PENDING: 'pending',
  PAID: 'paid',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled'
}

export const CHANNEL_TYPE = {
  BCA_TRANSFER: 'bca_transfer',
  QRIS_BCA: 'qris_bca',
  QRIS_GOPAY: 'qris_gopay',
  QRIS_BRI: 'qris_bri'
}

export const CHANNEL_OWNER = {
  PLATFORM: 'platform',
  CLIENT: 'client'
}

export const MATCH_STATUS = {
  UNMATCHED: 'unmatched',
  MATCHED: 'matched',
  DUPLICATE: 'duplicate',
  MANUAL: 'manual'
}

export const CIRCUIT_STATE = {
  CLOSED: 'closed',
  OPEN: 'open',
  HALF_OPEN: 'half_open'
}

export const SCRAPE_PRIORITY = {
  HIGH: 'high',
  MEDIUM: 'medium',
  LOW: 'low'
}

export const PLAN_TYPE = {
  FREE: 'free',
  SUBSCRIPTION: 'subscription'
}

export const CLIENT_STATUS = {
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
  INACTIVE: 'inactive'
}

export const WITHDRAWAL_STATUS = {
  PENDING: 'pending',
  PROCESSED: 'processed',
  REJECTED: 'rejected'
}

export const DISBURSEMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILED: 'failed'
}

export const KYC_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected'
}

export const CLIENT_ROLE = {
  MERCHANT: 'merchant',
  DISBURSEMENT_USER: 'disbursement_user'
}

export const INVOICE_SOURCE = {
  DASHBOARD: 'dashboard',
  API: 'api'
}

export const BALANCE_LEDGER_TYPE = {
  CREDIT_PENDING: 'credit_pending',
  CREDIT_AVAILABLE: 'credit_available',
  DEBIT_WITHDRAW: 'debit_withdraw'
}

export const ERROR_TYPE = {
  FATAL: 'fatal',
  TRANSIENT: 'transient',
  EMPTY_RESULT: 'empty_result'
}

export const ERROR_CODES = {
  // Auth
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  API_KEY_INVALID: 'API_KEY_INVALID',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CLIENT_SUSPENDED: 'CLIENT_SUSPENDED',
  PLAN_FEATURE_UNAVAILABLE: 'PLAN_FEATURE_UNAVAILABLE',

  // Invoice
  INVOICE_NOT_FOUND: 'INVOICE_NOT_FOUND',
  INVOICE_ALREADY_PAID: 'INVOICE_ALREADY_PAID',
  INVOICE_EXPIRED: 'INVOICE_EXPIRED',
  INVOICE_CANCELLED: 'INVOICE_CANCELLED',
  AMOUNT_TOO_LOW: 'AMOUNT_TOO_LOW',
  AMOUNT_EXCEEDS_FREE_LIMIT: 'AMOUNT_EXCEEDS_FREE_LIMIT',

  // Channel
  CHANNEL_NOT_FOUND: 'CHANNEL_NOT_FOUND',
  CHANNEL_INACTIVE: 'CHANNEL_INACTIVE',
  CHANNEL_LIMIT_REACHED: 'CHANNEL_LIMIT_REACHED',
  CHANNEL_ALREADY_EXISTS: 'CHANNEL_ALREADY_EXISTS',

  // Withdrawal
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  BELOW_MINIMUM_WITHDRAW: 'BELOW_MINIMUM_WITHDRAW',
  BALANCE_STILL_PENDING: 'BALANCE_STILL_PENDING',
  WITHDRAWAL_NOT_FOUND: 'WITHDRAWAL_NOT_FOUND',
  WITHDRAWAL_DAILY_LIMIT: 'WITHDRAWAL_DAILY_LIMIT',       // sudah withdrawal hari ini
  WITHDRAWAL_PENDING_EXISTS: 'WITHDRAWAL_PENDING_EXISTS', // masih ada yang pending/processing
  WITHDRAWAL_NONCE_INVALID: 'WITHDRAWAL_NONCE_INVALID',   // nonce tidak valid atau expired
  WITHDRAWAL_TRANSFER_FAILED: 'WITHDRAWAL_TRANSFER_FAILED', // Flip gagal saat auto-process

  // Lookup
  LOOKUP_ACCOUNT_NOT_FOUND: 'LOOKUP_ACCOUNT_NOT_FOUND',
  LOOKUP_SERVICE_ERROR: 'LOOKUP_SERVICE_ERROR',

  // Disbursement / KYC
  DISBURSEMENT_KYC_REQUIRED: 'DISBURSEMENT_KYC_REQUIRED',
  DISBURSEMENT_KYC_PENDING: 'DISBURSEMENT_KYC_PENDING',
  DISBURSEMENT_ROLE_REQUIRED: 'DISBURSEMENT_ROLE_REQUIRED',
  DISBURSEMENT_INSUFFICIENT_BALANCE: 'DISBURSEMENT_INSUFFICIENT_BALANCE',
  DISBURSEMENT_BELOW_MINIMUM: 'DISBURSEMENT_BELOW_MINIMUM',
  DISBURSEMENT_TRANSFER_FAILED: 'DISBURSEMENT_TRANSFER_FAILED',
  DISBURSEMENT_DEPOSIT_NOT_FOUND: 'DISBURSEMENT_DEPOSIT_NOT_FOUND',
  DISBURSEMENT_NOT_FOUND: 'DISBURSEMENT_NOT_FOUND',
  KYC_ALREADY_SUBMITTED: 'KYC_ALREADY_SUBMITTED',
  KYC_NOT_FOUND: 'KYC_NOT_FOUND',

  // General
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  DUPLICATE_REQUEST: 'DUPLICATE_REQUEST',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INTERNAL_ERROR: 'INTERNAL_ERROR'
}

// Scraping intervals — default (ms)
export const SCRAPE_INTERVALS = {
  HIGH: 15_000,       // 15 detik (user_confirmed — sudah transfer)
  MEDIUM: 5 * 60_000,   // 5 menit  (ada invoice pending, belum konfirmasi)
  LOW: 15 * 60_000    // 15 menit (tidak ada invoice pending)
}

// Override per channel type (hanya definisikan yang berbeda dari default)
export const SCRAPE_INTERVAL_OVERRIDES = {
  qris_bca: {
    HIGH: 2_000,       // 2 detik (tidak ada anti-spam)
    MEDIUM: 2 * 60_000,   // 2 menit
    // LOW: 5 * 60_000     // 5 menit
  },
  qris_gopay: {
    HIGH: 1_000,       // 3 detik (API call, cepat)
    MEDIUM: 2 * 60_000,   // 2 menit
    LOW: 5 * 60_000    // 5 menit (lebih sering dari default 15m — API tidak mahal)
  },
  qris_bri: {
    HIGH: 2_000,       // 2 detik (API call, cepat)
    MEDIUM: 2 * 60_000,   // 2 menit
    LOW: 5 * 60_000    // 5 menit
  }
}

/** Get interval for a channel type + priority. Falls back to default. */
export function getScrapeInterval(channelType, priority) {
  const key = priority.toUpperCase()
  return SCRAPE_INTERVAL_OVERRIDES[channelType]?.[key] ?? SCRAPE_INTERVALS[key]
}

// Session TTL (seconds)
export const SESSION_TTL = {
  bca_transfer: 60 * 60 * 4,    // 4 jam
  qris_bca: 60 * 30,         // 30 menit
  qris_gopay: 60 * 60 * 8,    // 8 jam
  qris_bri: 60 * 60 * 24 * 6  // 6 hari (BRI JWT valid ~7 hari)
}

// Circuit breaker config
export const CIRCUIT_BREAKER = {
  ERROR_THRESHOLD: 5,
  COOLDOWN_MS: 15 * 60_000  // 15 menit
}

// Webhook config
export const WEBHOOK = {
  MAX_ATTEMPTS: 5,
  BACKOFF_DELAYS: [60_000, 300_000, 900_000, 3_600_000, 21_600_000] // 1m, 5m, 15m, 1h, 6h
}

// Match config
export const MATCH = {
  MAX_ATTEMPTS: 5,
  RETRY_DELAY_MS: 30_000  // 30 detik
}

// Invoice config
export const INVOICE = {
  MIN_AMOUNT: 1_000,
  BANK_TRANSFER_MIN_AMOUNT: 10_000,

  // ── Free Tier limits ──────────────────────────────────
  // Batas maksimal nominal invoice untuk plan Gratis.
  // Dipilih Rp 490.000 agar kode unik worst-case (+999) tetap < Rp 500.000,
  // sehingga QRIS MDR 0% selalu terjaga dan platform tidak tekor.
  FREE_TIER_MAX_AMOUNT: 490_000,

  // Total nilai invoice LUNAS (paid) dalam satu bulan kalender untuk plan Gratis.
  // Judol butuh volume jauh lebih besar → tidak tertarik.
  FREE_TIER_MONTHLY_LIMIT: 5_000_000,

  // Maksimal invoice berstatus 'pending' bersamaan untuk plan Gratis.
  // Merepotkan bot/abuse tanpa mengganggu UMKM kecil.
  FREE_TIER_MAX_PENDING: 5
}

// Unique code tiers — based on invoice amount
// The unique code is added to the invoice amount for auto-matching.
// Higher invoice → higher code range → more platform revenue.
export const UNIQUE_CODE_TIERS = [
  { maxAmount: 2_999, min: 1, max: 99 },  // < Rp 3.000
  { maxAmount: 4_999, min: 100, max: 199 },  // Rp 3.000 – Rp 5.000
  { maxAmount: 49_999, min: 201, max: 500 },  // Rp 5.000 – Rp 49.999
  { maxAmount: Infinity, min: 501, max: 999 }   // ≥ Rp 50.000
]

/** Get unique code range {min, max} based on invoice amount */
export function getUniqueCodeRange(amount) {
  const tier = UNIQUE_CODE_TIERS.find(t => amount <= t.maxAmount)
  return { min: tier.min, max: tier.max }
}

// Withdraw config
export const WITHDRAW = {
  MIN_AMOUNT: 50_000,
  DEFAULT_FEE: 2_500
}

// Flip worker throttling (BullMQ limiter)
export const FLIP = {
  // Minimal jeda antar start job transfer agar tidak dianggap spam provider
  MIN_JOB_INTERVAL_MS: 5_000
}

// Disbursement config
export const DISBURSEMENT = {
  MIN_AMOUNT: 10_000,
  MIN_DEPOSIT: 50_000,
  // Withdrawal dari saldo platform wajib KYC jika total_earned mencapai ambang ini.
  KYC_THRESHOLD: 490_000,
  // Fee berjenjang: < 100k → Rp 2.500, >= 250k → Rp 3.000
  FEE_LOW: 2_500,   // transfer < Rp 250.000
  FEE_HIGH: 3_000,   // transfer >= Rp 250.000
  FEE_THRESHOLD: 250_000,
  /** @deprecated pakai getFee(amount) */
  DEFAULT_FEE: 2_500,
}

/** Hitung fee berdasarkan nominal transfer */
export function getDisbursementFee(amount) {
  return amount >= DISBURSEMENT.FEE_THRESHOLD
    ? DISBURSEMENT.FEE_HIGH
    : DISBURSEMENT.FEE_LOW
}
