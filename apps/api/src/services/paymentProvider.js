// apps/api/src/services/paymentProvider.js
// Wrapper Flip Personal API — token disimpan encrypted di DB, lazy refresh
// HTTP layer: @payment-gateway/shared/flip (single source of truth)
// Service layer di sini: DB, Redis, lazy token refresh, lock

import crypto from 'node:crypto'
import { encrypt, decrypt } from '@payment-gateway/shared/crypto'
import {
  decodeJwtPayload,
  getDeviceIdentifier,
  flipHeaders,
  custHeaders,
  parseResponse,
  refreshFlipToken,
  getAlaflipStatus   as getAlaflipStatusHttp,
  getAlaflipBalance  as getAlaflipBalanceHttp,
  getAlaflipWebviewUrl as getAlaflipWebviewUrlHttp,
  getChargeChallenge,
  executeTransfer,
  getBankList        as getBankListHttp,
  checkAccount       as checkAccountHttp,
  getPaymentMethods  as getPaymentMethodsHttp,
  confirmTopup       as confirmTopupHttp,
  getTopupStatus     as getTopupStatusHttp,
  getCoinBalance     as getCoinBalanceHttp,
  FLIP_URLS,
  CUST_HOST,
} from '@payment-gateway/shared/flip'

// ── Cache TTL ──────────────────────────────────────────────
const BANKS_TTL_SEC   = 60 * 60   // 1 jam
const ACCOUNT_TTL_SEC = 5  * 60   // 5 menit

// ── Cache key helper ────────────────────────────────────────
function accountCacheKey(accountNumber, bank) {
  const hash = crypto.createHash('sha256')
    .update(`${accountNumber}:${bank}`)
    .digest('hex')
    .slice(0, 16)
  return `pg:flip:acct:${hash}`
}



// ── Lock sederhana untuk mencegah aktivasi ganda Alaflip ──
const _alaflipActivationLock = { active: false }

// ── Factory — dipanggil per-request dari route ────────────
export function createPaymentProviderService(db, redis, { inputPin, activateAlaflip } = {}) {

  /** Ambil row PaymentProvider dari DB */
  async function getProvider() {
    const provider = await db.paymentProvider.findUnique({
      where: { providerName: 'flip' }
    })
    if (!provider) {
      throw new Error('PaymentProvider "flip" belum dikonfigurasi. Hubungi administrator.')
    }
    return provider
  }

  /**
   * Lazy token getter:
   *   baca token dari DB → jika tokenExpiresAt < now → refreshToken → return token baru
   */
  async function getToken() {
    const provider = await getProvider()
    const now      = new Date()
    const isExpired = !provider.tokenExpiresAt || provider.tokenExpiresAt <= now

    if (isExpired) {
      return refreshToken(provider)
    }
    return decrypt(provider.token)
  }

  /**
   * Refresh token via Flip API (POST /user-auth/api/v3.1/auth/refresh).
   * Setelah berhasil, update DB: token (encrypted), tokenExpiresAt, userId, balance.
   */
  async function refreshToken(provider) {
    if (!provider) provider = await getProvider()

    const currentToken    = decrypt(provider.token)
    const currentRefreshToken = provider.refreshToken ? decrypt(provider.refreshToken) : undefined

    const body = await refreshFlipToken(currentToken, currentRefreshToken)

    // Flip v3.1 refresh response: { data: { token, refresh_token, ... } }
    const newToken = body?.data?.token || body?.token
    if (!newToken) {
      throw new Error('Flip tidak mengembalikan token baru saat refresh')
    }

    const newRefreshToken = body?.data?.refresh_token || body?.refresh_token

    // Ambil info akun (user_id) dari token payload atau endpoint
    let userId = provider.userId
    try {
      const payload = decodeJwtPayload(newToken)
      userId = String(payload?.data?.id || userId)
    } catch { /* gunakan userId lama */ }

    // Ambil saldo Aladin jika userId tersedia
    let balance = provider.balance
    if (userId) {
      try {
        const balanceNum = await getAlaflipBalanceHttp(userId, newToken)
        if (balanceNum !== undefined) balance = balanceNum
      } catch { /* saldo Aladin tidak kritikal */ }
    }

    // Token Flip valid ±14 hari (exp di JWT) — simpan dengan margin 30 menit
    let expiresAt = new Date(Date.now() + (14 * 24 - 0.5) * 60 * 60 * 1000)
    try {
      const payload = decodeJwtPayload(newToken)
      if (payload?.exp) expiresAt = new Date(payload.exp * 1000 - 30 * 60 * 1000)
    } catch { /* gunakan default */ }

    await db.paymentProvider.update({
      where: { providerName: 'flip' },
      data: {
        token:          encrypt(newToken),
        tokenExpiresAt: expiresAt,
        ...(newRefreshToken ? { refreshToken: encrypt(newRefreshToken) } : {}),
        userId:         userId ? String(userId) : provider.userId,
        balance:        balance
      }
    })

    return newToken
  }

  /**
   * Cek status Alaflip — apakah aktif di device bot atau tidak.
   * Return: 'SUCCESS_REGISTER' | 'INACTIVE' | ...
   */
  async function getAlaflipStatus() {
    const [token, provider] = await Promise.all([getToken(), getProvider()])
    if (!provider.userId) throw new Error('userId belum tersedia di provider')
    return getAlaflipStatusHttp(provider.userId, token)
  }

  /**
   * Ambil URL webview Alaflip untuk aktivasi/linkage.
   * POST /alaflip/api/v1/users/{userId}/webview-url
   */
  async function getAlaflipWebviewUrl() {
    const [token, provider] = await Promise.all([getToken(), getProvider()])
    if (!provider.userId) throw new Error('userId belum tersedia di provider')

    const { url } = await getAlaflipWebviewUrlHttp(provider.userId, token)
    return url
  }

  /**
   * Pastikan Alaflip aktif sebelum transfer.
   * Jika tidak aktif, jalankan aktivasi via flipBrowser (Playwright).
   * Flow baru: dapatkan webview URL → buka di browser → login Aladin + PIN → binding selesai.
   */
  async function ensureAlaflipActive() {
    if (!activateAlaflip) {
      throw new Error('activateAlaflip (flipBrowser) tidak di-inject ke service')
    }

    if (_alaflipActivationLock.active) {
      // Tunggu aktivasi oleh request lain selesai (max 60 detik)
      let waited = 0
      while (_alaflipActivationLock.active && waited < 60000) {
        await new Promise(r => setTimeout(r, 500))
        waited += 500
      }
      return
    }

    _alaflipActivationLock.active = true
    try {
      const provider  = await getProvider()
      const token     = await getToken()
      const deviceId  = getDeviceIdentifier(token)
      const pin       = provider.pin ? decrypt(provider.pin) : null

      if (!pin) throw new Error('PIN belum dikonfigurasi di provider')

      console.log('[PaymentProvider] Alaflip tidak aktif — mengambil webview URL...')
      const webviewUrl = await getAlaflipWebviewUrl()

      console.log('[PaymentProvider] Memulai aktivasi via browser (Playwright)...')
      await activateAlaflip(webviewUrl, pin, deviceId)
      console.log('[PaymentProvider] Aktivasi Alaflip selesai')
    } finally {
      _alaflipActivationLock.active = false
    }
  }

  /**
   * GET list bank — cache Redis 1 jam
   * Return: [{ id, name, code, popular }]
   */
  async function getBankList() {
    const cacheKey = 'pg:flip:banks'
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const token = await getToken()
    const body  = await getBankListHttp(token)

    let banks
    if (body.supportedBanks && Array.isArray(body.supportedBanks)) {
      const nameMap = {}
      if (Array.isArray(body.detailBanks)) {
        for (const b of body.detailBanks) {
          nameMap[b.id] = b.aliasName || b.officialName || b.id
        }
      }

      const eCommerceSet = new Set(body.eCommerces || [])
      const eWalletSet   = new Set(body.eWallets || [])
      const popularSet   = new Set(body.popularBanks || [])

      const bankCodes = body.supportedBanks.filter(code => !eCommerceSet.has(code))

      const FALLBACK_NAMES = {
        bca:                        'BCA',
        bri:                        'BRI',
        mandiri:                    'Bank Mandiri',
        bni:                        'BNI',
        bsm:                        'BSI (Bank Syariah Indonesia)',
        cimb:                       'CIMB Niaga',
        muamalat:                   'Bank Muamalat',
        permata:                    'Bank Permata',
        dbs:                        'DBS Indonesia',
        danamon:                    'Bank Danamon',
        btn:                        'BTN',
        dki:                        'Bank DKI Jakarta',
        bjb:                        'BJB (Bank Jabar Banten)',
        tabungan_pensiunan_nasional: 'BTPN Jenius',
        kesejahteraan_ekonomi:      'BKE (Kesejahteraan Ekonomi)',
        ovo:                        'OVO',
        gopay:                      'GoPay',
        dana:                       'DANA',
        shopeepay:                  'ShopeePay',
        linkaja:                    'LinkAja',
        isaku:                      'iSaku',
      }

      banks = bankCodes.map(code => ({
        code,
        id:        code,
        name:      nameMap[code] || FALLBACK_NAMES[code] || code.replace(/_/g, ' ').toUpperCase(),
        popular:   popularSet.has(code) && !eWalletSet.has(code),
        isEwallet: eWalletSet.has(code)
      }))

      const popularOrder = (body.popularBanks || []).filter(c => !eCommerceSet.has(c) && !eWalletSet.has(c))
      const popularMap   = Object.fromEntries(popularOrder.map((c, i) => [c, i]))

      banks.sort((a, b) => {
        if (a.isEwallet !== b.isEwallet) return a.isEwallet ? 1 : -1
        const pa = popularMap[a.code] ?? Infinity
        const pb = popularMap[b.code] ?? Infinity
        if (pa !== pb) return pa - pb
        return a.name.localeCompare(b.name)
      })

    } else {
      banks = Object.entries(body).map(([code, info]) => ({
        id:      code,
        code,
        name:    info.name || code,
        popular: false
      })).sort((a, b) => a.name.localeCompare(b.name))
    }

    await redis.setex(cacheKey, BANKS_TTL_SEC, JSON.stringify(banks))
    return banks
  }

  /**
   * Cek nomor rekening — cache Redis 5 menit
   * Endpoint baru: POST /domestic-transfer/v1/accounts/inquire (JSON body)
   * Return: { account_name, account_number, bank }
   */
  async function checkAccount(accountNumber, bank) {
    const bankCode = bank.toLowerCase()
    const cacheKey = accountCacheKey(accountNumber, bankCode)
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const token = await getToken()

    let body
    try {
      body = await checkAccountHttp(accountNumber, bankCode, token)
    } catch (err) {
      const flipErrors = err.flipBody?.errors || []
      const isBankInvalid = flipErrors.some(e => {
        try { return JSON.parse(e.message)?.bank?.includes('bank_invalid') } catch { return false }
      })
      if (isBankInvalid) {
        const customErr = new Error(`Kode bank tidak valid: ${bankCode}`)
        customErr.status = 422
        customErr.code   = 'BANK_INVALID'
        throw customErr
      }
      throw err
    }

    // Response format baru: { success: true, data: { account_number, bank, account_name, ... } }
    const data = body?.data || body
    const result = {
      account_name:   data?.account_name || data?.account_holder || data?.name || null,
      account_number: data?.account_number || accountNumber,
      bank:           bankCode
    }

    if (!result.account_name) {
      const err = new Error('Nomor rekening tidak ditemukan')
      err.status = 422
      throw err
    }

    await redis.setex(cacheKey, ACCOUNT_TTL_SEC, JSON.stringify(result))
    return result
  }

  /**
   * Kirim transfer via Flip (sender: superflip/Alaflip).
   * Mendukung auto-reactivation Alaflip jika tidak aktif.
   *
   * @param {object}  params
   * @param {string}  params.accountNumber      - Rekening tujuan
   * @param {string}  params.beneficiaryBank    - Kode bank tujuan
   * @param {string}  params.beneficiaryName    - Nama penerima
   * @param {number}  params.amount             - Jumlah (integer rupiah)
   * @param {string}  [params.remark]           - Keterangan
   * @param {string}  params.nonce              - Dari inputPin hasil flipBrowser
   * @param {string}  params.referenceId        - partner_reference_no dari inputPin
   * @param {string}  params.idempotencyKey     - Idempotency key unik per transaksi
   * @param {object}  [params.retryAlaflip]     - { challengeUrl, authorizationAladin, authorizationAladinCustomer }
   *                                               jika diisi, akan auto-reactivate Alaflip jika inactive
   */
  async function transfer(params) {
    const token = await getToken()

    try {
      const data = await executeTransfer(params, token)
      return data
    } catch (err) {
      const errBody = err.flipBody || {}
      
      const isAlaflipInactive = (
        errBody?.message?.toLowerCase().includes('alaflip') ||
        errBody?.message?.toLowerCase().includes('inactive') ||
        errBody?.message?.toLowerCase().includes('tidak aktif') ||
        errBody?.error_code === 'ALAFLIP_INACTIVE'
      )

      if (isAlaflipInactive && params.retryAlaflip && !params.retryAlaflip._retried) {
        console.warn('[PaymentProvider] Alaflip tidak aktif — mencoba aktivasi ulang...')
        await ensureAlaflipActive(
          params.retryAlaflip.challengeUrl,
          params.retryAlaflip.authorizationAladin,
          params.retryAlaflip.authorizationAladinCustomer
        )
        // Retry sekali setelah aktivasi
        return transfer({ ...params, retryAlaflip: { ...params.retryAlaflip, _retried: true } })
      }

      throw err
    }
  }

  /**
   * Top up saldo Flip dari rekening bank (untuk isi ulang saldo superflip).
   *
   * @param {object} params
   * @param {string} params.senderBank     - Kode bank pengirim (misal 'mandiri')
   * @param {string} params.senderBankType - 'bank_account' | 'virtual_account'
   * @param {number} params.amount         - Jumlah (integer rupiah)
   * @param {string} params.accountNumber  - Nomor rekening Aladin (superflip) tujuan topup
   * @param {string} params.idempotencyKey - Idempotency key unik
   */
  async function topup(params) {
    const {
      senderBank,
      senderBankType = 'bank_account',
      amount,
      accountNumber,
      idempotencyKey
    } = params

    const token = await getToken()

    const body = new URLSearchParams({
      sender_bank:       senderBank.toLowerCase(),
      sender_bank_type:  senderBankType,
      amount:            String(amount),
      remark:            '',
      account_number:    accountNumber,
      beneficiary_bank:  'superflip'
    })

    const res = await fetch(FLIP_URLS.topup, {
      method:  'POST',
      headers: flipHeaders(token, 'application/x-www-form-urlencoded', {
        'idempotency-key': idempotencyKey,
      }),
      body
    })

    return parseResponse(res)
  }

  return {
    getToken,
    refreshToken,
    getBankList,
    checkAccount,
    getProvider,
    getAlaflipStatus,
    ensureAlaflipActive,
    transfer,
    topup,

    /**
     * GET daftar metode pembayaran + fee untuk top-up.
     * Dari HAR topup_saldo_flip.har.
     *
     * @param {number} amount - Nominal top-up
     */
    async getPaymentMethods(amount) {
      const token = await getToken()
      return getPaymentMethodsHttp(amount, token)
    },

    /**
     * PUT konfirmasi top-up setelah user transfer dari bank.
     * Dari HAR topup_saldo_flip.har.
     *
     * @param {string} topupId        - ID top-up (misal '808682512')
     * @param {string} idempotencyKey - Idempotency key
     */
    async confirmTopup(topupId, idempotencyKey) {
      const token = await getToken()
      return confirmTopupHttp(topupId, token, idempotencyKey)
    },

    /**
     * GET status top-up (polling): NOT_CONFIRMED → PENDING → PROCESSED → DONE.
     * Dari HAR topup_saldo_flip.har.
     *
     * @param {string} topupId - ID top-up
     */
    async getTopupStatus(topupId) {
      const token = await getToken()
      return getTopupStatusHttp(topupId, token)
    },

    /**
     * GET saldo Flip Coin.
     * Dari HAR topup_saldo_flip.har.
     *
     * @returns {number} amount (misal 8806)
     */
    async getCoinBalance() {
      const token = await getToken()
      return getCoinBalanceHttp(token)
    },
  }
}
