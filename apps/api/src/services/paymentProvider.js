// apps/api/src/services/paymentProvider.js
// Wrapper Flip Personal API — token disimpan encrypted di DB, lazy refresh
// Tidak ada referensi "flip" yang bocor ke frontend/network traffic client

import crypto from 'node:crypto'
import { encrypt, decrypt } from '@payment-gateway/shared/crypto'

// ── Flip API endpoints (Flip Personal / Consumer) ──────────
const FLIP_HOST    = 'flip.id'
const FLIP_URLS = {
  token:      'https://flip.id/api/v3/auth/token',
  akun:       'https://flip.id/api/v1/user/info',
  limit:      'https://flip.id/api/v2/e-money/me',
  list_bank:  'https://flip.id/api/v2/transactions/beneficiary-bank',
  cekrekening:'https://flip.id/api/v2.1/accounts/inquiry-account-number'
}

// ── Cache TTL ──────────────────────────────────────────────
const BANKS_TTL_SEC   = 60 * 60   // 1 jam
const ACCOUNT_TTL_SEC = 5  * 60   // 5 menit

// ── Flip HTTP client headers (mirroring flip.js dari example) ──
function flipHeaders(token, contentType = 'application/x-www-form-urlencoded') {
  return {
    'Authorization':        `Bearer ${token}`,
    'api-key':              'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
    'x-device-id':          '0e5e4950-14cf-4ad9-a5ef-5cf11fb641f4',
    'x-internal-api-key':   'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
    'accept-language':      'id-ID',
    'content-language':     'id-ID',
    'content-type':         contentType,
    'Host':                 FLIP_HOST,
    'Connection':           'Keep-Alive',
    'User-Agent':           'okhttp/5.0.0-alpha.3'
  }
}

/** Hash account_number + bank untuk cache key (tidak bocorkan no rek ke Redis key mentah) */
function accountCacheKey(accountNumber, bank) {
  const hash = crypto.createHash('sha256')
    .update(`${accountNumber}:${bank}`)
    .digest('hex')
    .slice(0, 16)
  return `pg:flip:acct:${hash}`
}

/** Parse response Fetch, throw jika error */
async function parseResponse(res) {
  const text = await res.text()
  let body
  try { body = JSON.parse(text) } catch { body = { message: text } }
  if (!res.ok) {
    const msg = body?.message || `Flip API error ${res.status}`
    const err = new Error(msg)
    err.status  = res.status
    err.flipBody = body
    throw err
  }
  return body
}

// ── Factory — dipanggil per-request dari route ─────────────

export function createPaymentProviderService(db, redis) {

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
    const now = new Date()
    const isExpired = !provider.tokenExpiresAt || provider.tokenExpiresAt <= now

    if (isExpired) {
      return refreshToken(provider)
    }
    return decrypt(provider.token)
  }

  /**
   * Refresh token via Flip API (PUT /auth/token).
   * Setelah berhasil, update DB: token (encrypted), tokenExpiresAt, userId, balance.
   */
  async function refreshToken(provider) {
    if (!provider) provider = await getProvider()

    const currentToken = decrypt(provider.token)

    const res = await fetch(FLIP_URLS.token, {
      method:  'PUT',
      headers: flipHeaders(currentToken),
      body:    new URLSearchParams({ version: '360' })
    })
    const body = await parseResponse(res)

    if (!body?.data?.token) {
      throw new Error('Flip tidak mengembalikan token baru saat refresh')
    }

    const newToken = body.data.token

    // Ambil info akun (user_id) + saldo Aladin
    const [infoRes, saldoRes] = await Promise.all([
      fetch(FLIP_URLS.akun, { method: 'GET', headers: flipHeaders(newToken) }),
      provider.userId
        ? fetch(`https://api.flip.id/alaflip/api/v1/users/${provider.userId}/balance`, {
            method: 'GET',
            headers: { ...flipHeaders(newToken), 'Host': 'api.flip.id' }
          })
        : Promise.resolve(null)
    ])

    const infoBody = await parseResponse(infoRes)
    const userId   = infoBody?.id || provider.userId || null

    let balance = provider.balance
    if (saldoRes) {
      const saldoBody = await saldoRes.json().catch(() => ({}))
      balance = saldoBody?.data?.balance ?? balance
    }

    // Token Flip valid 24 jam — simpan dengan margin 30 menit
    const expiresAt = new Date(Date.now() + (24 - 0.5) * 60 * 60 * 1000)

    await db.paymentProvider.update({
      where: { providerName: 'flip' },
      data: {
        token:          encrypt(newToken),
        tokenExpiresAt: expiresAt,
        userId:         String(userId),
        balance:        balance
      }
    })

    return newToken
  }

  /**
   * GET list bank — cache Redis 1 jam
   * Return: [{ id, name, code, popular }]
   * Parse format Flip baru: { popularBanks, supportedBanks, detailBanks, eWallets, ... }
   */
  async function getBankList() {
    const cacheKey = 'pg:flip:banks'
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const token = await getToken()
    const res   = await fetch(FLIP_URLS.list_bank, {
      method:  'GET',
      headers: flipHeaders(token)
    })
    const body = await parseResponse(res)

    // Format baru Flip: { popularBanks[], supportedBanks[], detailBanks[], eWallets[], ... }
    let banks
    if (body.supportedBanks && Array.isArray(body.supportedBanks)) {
      // Build name map dari detailBanks
      const nameMap = {}
      if (Array.isArray(body.detailBanks)) {
        for (const b of body.detailBanks) {
          nameMap[b.id] = b.aliasName || b.officialName || b.id
        }
      }

      // eCommerces tetap difilter (tokopedia dll - bukan untuk penarikan)
      const eCommerceSet = new Set(body.eCommerces || [])
      const eWalletSet   = new Set(body.eWallets || [])
      const popularSet   = new Set(body.popularBanks || [])

      // Ambil semua supportedBanks kecuali e-commerce
      const bankCodes = body.supportedBanks.filter(
        code => !eCommerceSet.has(code)
      )

      // Nama fallback jika tidak ada di detailBanks
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
        id:       code,
        name:     nameMap[code] || FALLBACK_NAMES[code] || code.replace(/_/g, ' ').toUpperCase(),
        popular:  popularSet.has(code) && !eWalletSet.has(code),
        isEwallet: eWalletSet.has(code)
      }))

      // Urutkan: popularBanks dulu → bank biasa alfabetis → e-wallet alfabetis
      const popularOrder = (body.popularBanks || []).filter(c => !eCommerceSet.has(c) && !eWalletSet.has(c))
      const popularMap   = Object.fromEntries(popularOrder.map((c, i) => [c, i]))

      banks.sort((a, b) => {
        // E-wallet selalu di bawah bank
        if (a.isEwallet !== b.isEwallet) return a.isEwallet ? 1 : -1
        const pa = popularMap[a.code] ?? Infinity
        const pb = popularMap[b.code] ?? Infinity
        if (pa !== pb) return pa - pb
        return a.name.localeCompare(b.name)
      })

    } else {
      // Format lama (fallback): object { BCA: { name, ... }, ... }
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
   * Return: { account_name, account_number, bank }
   */
  async function checkAccount(accountNumber, bank) {
    // Flip menggunakan kode bank lowercase (bca, bni, bri, dll)
    const bankCode = bank.toLowerCase()
    const cacheKey = accountCacheKey(accountNumber, bankCode)
    const cached   = await redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const token = await getToken()
    const url   = `${FLIP_URLS.cekrekening}?account_number=${encodeURIComponent(accountNumber)}&bank=${encodeURIComponent(bankCode)}`

    const res  = await fetch(url, { method: 'GET', headers: flipHeaders(token) })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = { message: text } }

    // Parse specific Flip error codes
    if (!res.ok) {
      const flipErrors = body?.errors || []
      const isBankInvalid = flipErrors.some(e => {
        try { return JSON.parse(e.message)?.bank?.includes('bank_invalid') } catch { return false }
      })
      if (isBankInvalid) {
        const err = new Error(`Kode bank tidak valid: ${bankCode}`)
        err.status = 422
        err.code   = 'BANK_INVALID'
        throw err
      }
      const msg = body?.message || `Flip API error ${res.status}`
      const err = new Error(msg)
      err.status  = res.status
      err.flipBody = body
      throw err
    }

    const result = {
      account_name:   body?.account_holder || body?.name || null,
      account_number: body?.account_number || accountNumber,
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

  return { getToken, refreshToken, getBankList, checkAccount, getProvider }
}
