// packages/shared/src/flip/index.js
// Single source of truth untuk Flip Personal API HTTP calls.
// Dipakai oleh apps/api (paymentProvider.js) dan apps/scraper (flipClient.js).
// TIDAK menyimpan state (DB, Redis) — hanya pure HTTP functions.
//
// Import:  import * as flipApi from '@payment-gateway/shared/flip'

// ── Constants ────────────────────────────────────────────────
export const FLIP_HOST = 'flip.id'
export const CUST_HOST = 'customer.flip.id'

export const FLIP_URLS = {
  // Auth
  refresh:        'https://customer.flip.id/user-auth/api/v3.1/auth/refresh',

  // Info & saldo
  akun:           'https://flip.id/api/v1/user/info',
  alaflipStatus:  'https://customer.flip.id/alaflip/api/v1/users',   // + /{userId}/status
  alaflipBalance: 'https://customer.flip.id/alaflip/api/v1/users',   // + /{userId}/balance
  webviewUrl:     'https://customer.flip.id/alaflip/api/v1/users',   // + /{userId}/webview-url

  // Bank & rekening
  listBank:       'https://flip.id/api/v2/transactions/beneficiary-bank',
  cekRekening:    'https://customer.flip.id/domestic-transfer/v1/accounts/inquire',

  // Transfer & topup
  chargeChallenge:'https://customer.flip.id/alaflip/api/v1/payments/charge/challenge',
  transfer:       'https://flip.id/api/v2/forward-transfers',
  topup:          'https://flip.id/api/v2/e-money/me/topup',
  topupStatus:    'https://flip.id/api/v2/top-up-wallet-transfers',              // + /{id}
  topupConfirm:   'https://flip.id/api/v2/top-up-wallet-transfers',              // + /{id}/confirm

  // Payment methods & saldo
  paymentMethods: 'https://flip.id/api/v2/transactions/payment-methods',
  coinBalance:    'https://customer.flip.id/coin/v1/balance',
}

const API_KEY      = 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz'
const INTERNAL_KEY = 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ=='

// ── JWT helpers ───────────────────────────────────────────────
export function decodeJwtPayload(token) {
  try {
    const base64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=')
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch { return null }
}

export function getDeviceIdentifier(token) {
  return decodeJwtPayload(token)?.data?.device_identifier || null
}

// ── Headers builder ───────────────────────────────────────────
/**
 * Build standard Flip API request headers.
 * deviceId diambil otomatis dari JWT — tidak perlu hardcode.
 */
export function flipHeaders(token, contentType = 'application/x-www-form-urlencoded', extra = {}) {
  const deviceId = getDeviceIdentifier(token)
  return {
    'Authorization':      `Bearer ${token}`,
    'api-key':            API_KEY,
    'x-internal-api-key': INTERNAL_KEY,
    ...(deviceId ? { 'x-device-id': deviceId } : {}),
    'accept-language':    'en-ID',
    'content-language':   'en-ID',
    'content-type':       contentType,
    'Host':               FLIP_HOST,
    'Connection':         'Keep-Alive',
    'User-Agent':         'okhttp/4.10.0',
    ...extra,
  }
}

/** Headers untuk endpoint customer.flip.id */
export function custHeaders(token, contentType = 'application/x-www-form-urlencoded', extra = {}) {
  return flipHeaders(token, contentType, { Host: CUST_HOST, ...extra })
}

// ── Response parser ───────────────────────────────────────────
/** Parse fetch response, throw Error jika !res.ok */
export async function parseResponse(res) {
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { message: text } }
  if (!res.ok) {
    const msg = body?.message || `Flip API error ${res.status}`
    const err = new Error(msg)
    err.status   = res.status
    err.flipBody = body
    throw err
  }
  return body
}

// ── Auth ──────────────────────────────────────────────────────
/**
 * Refresh Flip token via new endpoint v3.1.
 * @param {string} currentToken  - Token aktif
 * @param {string} [refreshToken] - Refresh token (opsional)
 */
export async function refreshFlipToken(currentToken, refreshToken) {
  const payload = decodeJwtPayload(currentToken)
  const version = payload?.data?.version || '402'
  const res = await fetch(FLIP_URLS.refresh, {
    method:  'POST',
    headers: custHeaders(currentToken, 'application/json'),
    body: JSON.stringify({
      version,
      token:         currentToken,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    })
  })
  return parseResponse(res)
}

// ── Alaflip ────────────────────────────────────────────────────
/** GET status Alaflip — return string status e.g. 'SUCCESS_REGISTER' */
export async function getAlaflipStatus(userId, token) {
  const res = await fetch(`${FLIP_URLS.alaflipStatus}/${userId}/status`, {
    method: 'GET', headers: custHeaders(token)
  })
  const body = await parseResponse(res)
  return body?.data?.status
}

/** GET saldo Aladin — returns balance number */
export async function getAlaflipBalance(userId, token) {
  const res = await fetch(`${FLIP_URLS.alaflipBalance}/${userId}/balance`, {
    method: 'GET', headers: custHeaders(token)
  })
  const body = await parseResponse(res)
  return body?.data?.balance
}

/** GET saldo Aladin (full) — returns { balance, account_id, account_name, ... } */
export async function getAlaflipBalanceFull(userId, token) {
  const res = await fetch(`${FLIP_URLS.alaflipBalance}/${userId}/balance`, {
    method: 'GET', headers: custHeaders(token)
  })
  const body = await parseResponse(res)
  return body?.data || null
}

/** POST webview-url untuk linkage/aktivasi */
export async function getAlaflipWebviewUrl(userId, token) {
  const res = await fetch(`${FLIP_URLS.webviewUrl}/${userId}/webview-url`, {
    method:  'POST',
    headers: custHeaders(token, 'application/json'),
    body: JSON.stringify({
      redirect_url:               'flip://home',
      url_type:                   'linkage',
      expired_token_redirect_url: 'flip://home',
      no_cam_permission_url:      'flip://open-camera-permission',
    })
  })
  const body = await res.json().catch(() => ({}))
  const url  = body?.data?.url
  if (!url) throw new Error('Webview URL tidak diterima dari Flip')
  return { url, headers: body?.data?.headers || {} }
}

/**
 * GET charge/challenge — dapat challenge_url + wvHeaders untuk PIN input.
 * Verified dari HAR proses_transfer_by_aladin.har.
 */
export async function getChargeChallenge(amount, token) {
  const url = `${FLIP_URLS.chargeChallenge}?amount=${amount}&currency=IDR&expired_token_redirect_url=flip%3A%2F%2Fhome&product_name=TRANSFER`
  const res = await fetch(url, {
    method: 'GET',
    headers: custHeaders(token, 'application/json'),
  })
  return parseResponse(res)
}

// ── Transfer ──────────────────────────────────────────────────
/**
 * POST /api/v2/forward-transfers — eksekusi transfer via Alaflip.
 * Body format verified dari HAR proses_transfer_by_aladin.har.
 *
 * @param {object} params
 * @param {string} params.accountNumber
 * @param {string} params.beneficiaryBank
 * @param {string} params.beneficiaryName
 * @param {number} params.amount
 * @param {string} params.nonce         - Dari Aladin PIN response (data.nonce)
 * @param {string} params.referenceId   - partner_reference_no dari PIN response
 * @param {string} params.idempotencyKey
 * @param {string} [params.remark]
 */
export async function executeTransfer(params, token) {
  const {
    accountNumber,
    beneficiaryBank,
    beneficiaryName,
    amount,
    nonce,
    referenceId,
    idempotencyKey,
    remark = '',
  } = params

  const deviceId = getDeviceIdentifier(token)

  const body = new URLSearchParams({
    account_number:           accountNumber,
    beneficiary_bank:         beneficiaryBank.toLowerCase(),
    beneficiary_name:         beneficiaryName,
    amount:                   String(Math.round(amount)),
    service_type:             '7',
    remark,
    beneficiary_phone_number: 'undefined',
    fee:                      '0',
    // HAR: tidak ada field 'avatar'
    beneficiary_account:      JSON.stringify({ save_beneficiary: true, id: null, nickname: '' }),
    covered_fee:              '6500',
    beneficiary_bank_type:    'bank_account',
    sender_bank_type:         'wallet_account',
    sender_bank:              'superflip',
    // HAR: x-device-id ada di dalam payment_method bukan di header request
    payment_method:           JSON.stringify([{
      sender_bank:      'superflip',
      sender_bank_type: 'wallet_account',
      pin:              nonce,
      reference_id:     referenceId,
      device_id:        deviceId || '',
    }]),
  })

  const res = await fetch(FLIP_URLS.transfer, {
    method:  'POST',
    // HAR: forward-transfers tidak kirim x-device-id di header → pakai flipHeaders biasa
    headers: flipHeaders(token, 'application/x-www-form-urlencoded', {
      'idempotency-key': idempotencyKey,
    }),
    body,
  })

  return parseResponse(res)
}

// ── Info & bank ────────────────────────────────────────────────
export async function getAkunInfo(token) {
  const res = await fetch(FLIP_URLS.akun, {
    method: 'GET', headers: flipHeaders(token)
  })
  return parseResponse(res)
}

export async function getBankList(token) {
  const res = await fetch(FLIP_URLS.listBank, {
    method: 'GET', headers: flipHeaders(token)
  })
  return parseResponse(res)
}

export async function checkAccount(accountNumber, bank, token) {
  const res = await fetch(FLIP_URLS.cekRekening, {
    method:  'POST',
    headers: custHeaders(token, 'application/json'),
    body:    JSON.stringify({ account_number: accountNumber, bank: bank.toLowerCase() })
  })
  return parseResponse(res)
}

// ── Top-up wallet ─────────────────────────────────────────────
/**
 * GET /api/v2/transactions/payment-methods
 * Daftar metode pembayaran + fee untuk top-up saldo.
 * Verified dari HAR topup_saldo_flip.har.
 *
 * @param {number} amount     - Nominal top-up (misal 50000)
 * @param {string} productType - 'balance' (default)
 */
export async function getPaymentMethods(amount, token, productType = 'balance') {
  const url = `${FLIP_URLS.paymentMethods}?service_type=&product-type=${productType}&amount=${amount}`
  const res = await fetch(url, {
    method: 'GET',
    headers: flipHeaders(token),
  })
  return parseResponse(res)
}

/**
 * PUT /api/v2/top-up-wallet-transfers/{topupId}/confirm
 * Konfirmasi top-up setelah transfer bank dilakukan.
 * Verified dari HAR topup_saldo_flip.har.
 *
 * @param {string} topupId        - ID top-up (misal '808682512')
 * @param {string} idempotencyKey - Idempotency key
 */
export async function confirmTopup(topupId, token, idempotencyKey) {
  const res = await fetch(`${FLIP_URLS.topupConfirm}/${topupId}/confirm`, {
    method:  'PUT',
    headers: flipHeaders(token, 'application/x-www-form-urlencoded', {
      'idempotency-key': idempotencyKey,
    }),
  })
  return parseResponse(res)
}

/**
 * GET /api/v2/top-up-wallet-transfers/{topupId}
 * Polling status top-up: NOT_CONFIRMED → PENDING → PROCESSED → DONE.
 * Verified dari HAR topup_saldo_flip.har.
 *
 * @param {string} topupId - ID top-up (misal '808682512')
 */
export async function getTopupStatus(topupId, token) {
  const res = await fetch(`${FLIP_URLS.topupStatus}/${topupId}`, {
    method: 'GET',
    headers: flipHeaders(token),
  })
  return parseResponse(res)
}

/**
 * GET /coin/v1/balance
 * Cek saldo Flip Coin (berbeda dari saldo Alaflip/superflip).
 * Verified dari HAR topup_saldo_flip.har.
 */
export async function getCoinBalance(token) {
  const res = await fetch(FLIP_URLS.coinBalance, {
    method: 'GET',
    headers: custHeaders(token),
  })
  const body = await parseResponse(res)
  return body?.data?.amount
}
