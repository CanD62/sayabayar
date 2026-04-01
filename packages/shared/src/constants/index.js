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
  QRIS_GOPAY: 'qris_gopay'
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
  qris_gopay: 60 * 60 * 8     // 8 jam
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
  BANK_TRANSFER_MIN_AMOUNT: 10_000
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
