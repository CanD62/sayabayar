// apps/scraper/src/scrapers/qrisGopay.js
// QRIS GoPay merchant dashboard scraper — pure HTTP API (no browser)
//
// Flow:
//   1. Load access_token from Redis (if cached)
//   2. Login via POST /goid/token (if no token or got 401)
//   3. GET /goresto/v5/public/users/config → merchant_id
//   4. POST /journals/search → transactions for today (WIB)
//   5. Return normalized transactions
//
// Config: { email, password }
// Token storage: Redis key pg:gopay_session:{channelId}

import IORedis from 'ioredis'
import { randomUUID } from 'crypto'

const API_BASE = 'https://api.gobiz.co.id'
const CLIENT_ID = 'go-biz-web-new'
const MAX_RETRIES = 3
const TOKEN_TTL = 60 * 60 * 23   // 23 hours in seconds (GoPay tokens typically valid 24h)

// Static GoBiz web client token — required in Authorization header for login.
// This is a public client credential embedded in the GoBiz web portal (not a user token).
// Confirmed identical across multiple independent login captures.
const GOBIZ_CLIENT_TOKEN = 'eyJhbGciOiJkaXIiLCJjdHkiOiJKV1QiLCJlbmMiOiJBMTI4R0NNIiwidHlwIjoiSldUIiwiemlwIjoiREVGIn0..Ihu7PJlPcGQfisN_.nsfdn-5mRHddgujKCbtREssnTcKgWRsr6A5fgZnHjJBHbOd3yz_pS7jV-csC3QTVpFrdrLDR94UQyKpKsUchGwZdH1xGUp9Pf-YTAjsWRQGMQ7ZqV13y8PHTp-cr1qKYsvEd5Hgl6ZgAu1XdsRDFC-cJc_W57WZ2UisZIkcqzDGA2clc3kFk5wa00GQGNJHCI5tZiMrU7hISZ3huoGUVjd7h4rkHHku5kKEw1OVnuEwju4cPFL_GRo4ctJWFS0DB6Er7y52eHtdguGaLjEQ4La0-VkypI1A_2dcjLsijYkytssrlevORPpp-ZQkjBAylhGarBOWUDLRiI1FslP0KFt9wuwU2cMqD5gRaYKdJdVbsP43yIS-DA4NZAfSwiGOwlHe4XoN-3fyNoS6Wz69xN2mYZmkj9rsZMsD-Efi-gMeQ4srILPoYd1YucGV_5gSrQtSIiRrhz7pzjJMqKJuGEod8OeuUZ085t2fkM1udUNWwDtfcXgqTgXpcJtf-983G1xWAFlUFH6y4gRCPTlFpYQa14eCu4wQQhRFPAk0EOYScq-qTdIISrgXLVJaTWYmJ61DfOT6hICjWaHSV8-zzaOwI8IGicT8NjByNxSNqZU9XjCydy16Zk1lnQcGiRvIgm52mLAGF1agv9kys0rYQcL3okccHynKkHF_DZYjM9VCvedGg7FdW9IqJjeDiqsWiKZQinql12zN_hzgTzn6wCacWF1jPVN4IRVWgqhJa3LVnoKfE4Bpi72pZH2vc6DJbIPK7LnPpSOOMENQVGpnZlWCVytsl9P-DLQTdRR7nva4AzWkt28xeBZOJtGnDn5QP1FYv2xfRtgdEmz4PZQY7Yy4gEjNLDozCCyqit6zQ3u94hJi_0aqHviaLF5fjDi8mwxiU7JGtMAHI8ZoVz7eQsQ43SOxbpjWImQ8_3LP16LKfBHiZLfenQ4wGDtLaxBxBKkl5nibLeJ6PcicKwB7zq3acgGRaiICeeIQ0HUriXjiMMtBm4tGbXTjeW3h-rBS9OjJlQWASGkWU9Dt-sSyx95UjP_MWqrpIlKStr8QBAKsoj1KyD_txzQ2Viq5y-FIvb4JVgi-0LszD6OpkQNIzo6yB17oW3hyMPLpAn189fJ4ZXs5UlpkVrHKezKR12x28mr1aNXpQdQz2tN8X4W0JtNPfZV2KHk4WHHnVyqG8BRIM5h_EY4fTVU1jbeq_jsVArZkPMCuUWXfFxHVsioq5JN_2VvdezSLXtZasXz0N1z8BKRn0ta9QNwKcNkUL2vIdQVhHMNVqLC1jfeC57qRGZio53btmAJzcEZ2ur3eKfObRMUez5mcZod--5ommdYxHPqS7MItUPiuCgQMl4on2Nt96i7qZXzd6Syjwd3xwNfv3ZckBluT6NxQtO9v8-m39I6QY4KThgD9xtVgODxXLe-8iHupZ0Rm7-qkLpT068AE-RV72YdZjYuPpSuzxkkDFY0kHxxXa6k17i5RW3P7_TfjfVxej__kSHN8J6Ev4izlw1hJOhI8AJkazWgjnXuY5yZpDPdBsmg7MsDOGfmITNr7CXUE5TjPl0sS0TdVl8yjggPy_prP3QcJSVK69rPmFx2bzbuHHXzdr0kFg8A9KXPIPaQGQj983DR9zuPDPaa7A-LPcSkjX6MEnmpQHE4sT8kYrMZqPs1IkfBFsG-7pJbmgg65k61nviLkYlRWb4h7NGHQ7ri4EssWrsRf9Rum2uwXqrBzfAlrKLBpS03oid6vtDlQR5SpzIEvSdr1P3V-_tUwuVY3SYRSWR_maw8kJsqddoX63HLXJTArnQl_gda9A5F87J8BCzM_owg6J0ysz7-frlDdPkWoJZKtytN66N7xop1o-fAXIiOw-XYV4H956VhfVTqmIca0gkgl68IhQcOfvvhgxQ0iCXrN-aAJRqq6TBpkrGJ8FYhKHywiB5oCkdfXaGu8fEVSVOGlhNXlaGw4.N3Azp3qTk1yknPmNDqfG2Q'


// ── Shared Redis client (lazy-init, one per scraper module) ──
let _redis = null
function getRedis() {
  if (!_redis) {
    _redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      lazyConnect: true,
      maxRetriesPerRequest: 2
    })
    _redis.on('error', (err) => {
      if (!err.message?.includes('ECONNRESET')) {
        console.error('[GoPay] Redis error:', err.message)
      }
    })
  }
  return _redis
}

// ── Standard GoBiz headers ─────────────────────────────────────
// Key findings from captured traffic [1248]:
//   - Authorization: 'Bearer ' (empty value, not absent, not a token)
//   - x-uniqueid must be the SAME UUID for Step 1 AND Step 2 of same login
//   - X-AppVersion: platform-v3.100.0-065b170a (original version)
//   - User-Agent: Chrome macOS (not Firefox Windows)

function buildBaseHeaders(sessionUniqueId) {
  return {
    'Authentication-Type': 'go-id',
    'Authorization': 'Bearer ',     // empty Bearer — required by GoBiz API
    'X-User-Type': 'merchant',
    'x-uniqueid': sessionUniqueId || randomUUID(),
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'X-PhoneModel': 'Chrome 146.0.0.0 on OS X 10.15.7 64-bit',
    'x-DeviceOS': 'Web',
    'X-Platform': 'Web',
    'Gojek-Country-Code': 'ID',
    'Gojek-Timezone': 'Asia/Jakarta',
    'X-AppVersion': 'platform-v3.100.0-065b170a',
    'X-PhoneMake': 'OS X 10.15.7 64-bit',
    'X-User-Locale': 'en-US',
    'x-appId': 'go-biz-web-dashboard',
    'Accept-Language': 'id',
    'Origin': 'https://portal.gofoodmerchant.co.id',
    'Referer': 'https://portal.gofoodmerchant.co.id/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  }
}

// Login headers (empty Bearer, shared sessionUniqueId)
function buildLoginHeaders(sessionUniqueId) {
  return buildBaseHeaders(sessionUniqueId)
}

// Authenticated headers (user's access_token replaces empty Bearer)
function buildAuthHeaders(accessToken) {
  const h = buildBaseHeaders()
  h['Authorization'] = `Bearer ${accessToken}`
  return h
}

// Legacy alias
function buildHeaders(accessToken = null) {
  return accessToken ? buildAuthHeaders(accessToken) : buildLoginHeaders()
}



// ── Redis token helpers ───────────────────────────────────────
async function loadToken(channelId) {
  try {
    const r = getRedis()
    const raw = await r.get(`pg:gopay_session:${channelId}`)
    if (!raw) return null
    const { access_token, merchant_id } = JSON.parse(raw)
    return access_token ? { access_token, merchant_id: merchant_id || null } : null
  } catch {
    return null
  }
}

async function saveToken(channelId, accessToken, merchantId) {
  try {
    const r = getRedis()
    await r.setex(
      `pg:gopay_session:${channelId}`,
      TOKEN_TTL,
      JSON.stringify({ access_token: accessToken, merchant_id: merchantId, saved_at: Date.now() })
    )
  } catch (err) {
    console.error('[GoPay] Failed to save token:', err.message)
  }
}

async function clearToken(channelId) {
  try {
    const r = getRedis()
    await r.del(`pg:gopay_session:${channelId}`)
  } catch {}
}

// ── Login ─────────────────────────────────────────────────────
// GoPay login is a 2-step flow:
//   Step 1: POST /goid/login/request  → signals intent to login
//   Step 2: POST /goid/token          → exchange credentials for token
async function login(channelId, email, password) {
  // Debug: confirm credentials are present before sending
  console.log(`[GoPay] Logging in... email=${email ? email.slice(0, 4) + '***' : 'UNDEFINED'} pass=${password ? '***' : 'UNDEFINED'}`)

  if (!email || !password) {
    return { error: 'CREDENTIAL_ERROR: Email atau password tidak ditemukan di konfigurasi channel' }
  }

  // Generate ONE uniqueid for the entire login session — same for Step 1 & Step 2
  // (observed in captures: x-uniqueid is identical in [1248] and [1306])
  const sessionUniqueId = randomUUID()

  // ── Step 1: Login request ───────────────────────────────────
  const step1 = await fetch(`${API_BASE}/goid/login/request`, {
    method: 'POST',
    headers: buildLoginHeaders(sessionUniqueId),
    body: JSON.stringify({
      email,
      login_type: 'password',
      client_id: CLIENT_ID
    })
  })

  const step1Data = await step1.json().catch(() => ({}))

  if (!step1.ok) {
    const errCode = step1Data.errors?.[0]?.code || ''
    const errMsg  = step1Data.errors?.[0]?.message || 'Login request gagal'
    console.log(`[GoPay] ❌ Step 1 failed [${step1.status}] ${errCode}: ${errMsg}`)
    return { error: `Login step 1 failed [${step1.status}] ${errCode}: ${errMsg}` }
  }

  // Log Step 1 response — might contain a token/challenge needed for Step 2
  console.log('[GoPay] Step 1 response:', JSON.stringify(step1Data))
  console.log('[GoPay] Step 1 OK — requesting token...')

  // Capture cookies from Step 1 response to forward to Step 2
  // Node.js fetch does NOT auto-share cookies between requests
  const cookies = step1.headers.getSetCookie?.() || []
  const cookieHeader = cookies.join('; ')
  if (cookieHeader) console.log(`[GoPay] Forwarding ${cookies.length} cookie(s) to Step 2`)

  // ── Step 2: Get token (same x-uniqueid as Step 1) ──────────
  const step2Headers = buildLoginHeaders(sessionUniqueId)
  if (cookieHeader) step2Headers['Cookie'] = cookieHeader

  const res = await fetch(`${API_BASE}/goid/token`, {
    method: 'POST',
    headers: step2Headers,
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'password',
      data: { email, password }
    })
  })



  const data = await res.json()

  // Check for errors
  if (!res.ok || data.success === false) {
    const errCode = data.errors?.[0]?.code || ''
    const errMsg  = data.errors?.[0]?.message || 'Login gagal'

    // Only deactivate channel on actual wrong credentials — not on technical errors
    const isCredErr = errCode.includes('wrong_email_password_combination')

    if (isCredErr) {
      console.log(`[GoPay] ❌ CREDENTIAL_ERROR: ${errCode}`)
      return { error: `CREDENTIAL_ERROR: Email atau password GoPay salah (${errMsg})` }
    }

    // Technical error (missing_field, server error, etc.) — log but don't deactivate
    console.log(`[GoPay] ❌ Login failed [${res.status}] ${errCode}: ${errMsg}`)
    return { error: `Login failed [${res.status}] ${errCode}: ${errMsg}` }
  }

  const accessToken = data.access_token
  if (!accessToken) {
    return { error: 'Login response missing access_token' }
  }

  await saveToken(channelId, accessToken)
  console.log('[GoPay] ✅ Login successful')
  return { accessToken }
}



// ── Logout (force_logout command) ─────────────────────────────
export async function logoutGopay(channelId, accessToken) {
  try {
    await fetch(`${API_BASE}/goid/token`, {
      method: 'DELETE',
      headers: buildHeaders(accessToken),
      body: JSON.stringify({ client_id: CLIENT_ID })
    })
    console.log('[GoPay] ✅ Logged out')
  } catch (err) {
    console.error('[GoPay] Logout error:', err.message)
  } finally {
    await clearToken(channelId)
  }
}

// ── Validate token + fetch merchant_id (combined) ────────────
// Returns { merchantId } on success, { tokenExpired: true } on 401/403,
// throws on other errors.
async function validateAndFetchMerchantId(accessToken) {
  const res = await fetch(`${API_BASE}/goresto/v5/public/users/config`, {
    method: 'GET',
    headers: buildAuthHeaders(accessToken)
  })

  if (res.status === 401 || res.status === 403) {
    return { tokenExpired: true }
  }

  if (!res.ok) {
    throw new Error(`users/config failed [${res.status}]`)
  }

  const data = await res.json()
  const merchantId = data.merchant?.id
  if (!merchantId) throw new Error('merchant_id not found in users/config response')

  console.log(`[GoPay] merchant_id: ${merchantId}`)
  return { merchantId }
}

// ── Get fetch window: 2 jam terakhir (bukan seluruh hari) ────
// Ini jauh lebih cepat daripada fetch seluruh hari WIB karena:
// - Payload response lebih kecil
// - Index GoPay Journal lebih efisien dengan range sempit
// Minimal window 2 jam untuk toleransi scraper downtime / delay.
function getFetchWindow() {
  const now = new Date()
  // Mulai dari 2 jam lalu, tapi tidak lebih awal dari 00:00 WIB hari ini
  const from = new Date(now.getTime() - 2 * 60 * 60_000)
  const to   = now
  return {
    from: from.toISOString(),
    to:   to.toISOString()
  }
}

// ── Fetch transactions ────────────────────────────────────────
async function fetchTransactions(accessToken, merchantId) {
  const { from, to } = getFetchWindow()  // 2 jam terakhir, bukan seluruh hari

  console.log(`[GoPay] Fetching transactions ${from} → ${to}`)

  const body = {
    from: 0,
    size: 20,
    sort: { time: { order: 'desc' } },
    included_categories: { incoming: ['transaction_share', 'action'] },
    query: [{
      op: 'and',
      clauses: [
        {
          op: 'not',
          clauses: [{
            // Matches exactly: [677] capture — one level of clauses with two fields and op:or
            clauses: [
              { field: 'metadata.source', op: 'in', value: ['GOSAVE_ONLINE', 'GoSave', 'GODEALS_ONLINE'] },
              { field: 'metadata.gopay.source', op: 'in', value: ['GOSAVE_ONLINE', 'GoSave', 'GODEALS_ONLINE'] }
            ],
            op: 'or'
          }]
        },
        { field: 'metadata.transaction.status', op: 'in', value: ['settlement', 'capture', 'refund', 'partial_refund'] },
        {
          op: 'or',
          clauses: [{
            op: 'or',
            clauses: [{ field: 'metadata.transaction.payment_type', op: 'in', value: ['qris', 'gopay', 'offline_credit_card', 'offline_debit_card', 'credit_card'] }]
          }]
        },
        { field: 'metadata.transaction.transaction_time', op: 'gte', value: from },
        { field: 'metadata.transaction.transaction_time', op: 'lte', value: to },
        { field: 'metadata.transaction.merchant_id', op: 'equal', value: merchantId }
      ]
    }]
  }


  const res = await fetch(`${API_BASE}/journals/search`, {
    method: 'POST',
    headers: {
      ...buildHeaders(accessToken),
      'Accept': 'application/json, text/plain, */*, application/vnd.journal.v1+json'
    },
    body: JSON.stringify(body)
  })

  if (res.status === 401) {
    throw new Error('TOKEN_EXPIRED')
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    console.error('[GoPay] journals/search error body:', JSON.stringify(errBody))
    throw new Error(`journals/search failed [${res.status}]`)
  }

  const data = await res.json()
  return data.hits || []
}

// ── Parse raw hit → normalized transaction ───────────────────
function parseHit(hit) {
  try {
    // amount is in smallest unit (cents * 100), divide by 100 to get IDR
    const amount = Math.round((hit.amount || 0) / 100)
    if (amount <= 0) return null

    // Only include income (payin) with status success
    if (hit.type !== 'payin' || hit.status !== 'success') return null

    const meta       = hit.metadata?.transaction?.metadata || {}
    const rrn        = meta.retrieval_reference_number || ''
    const issuer     = meta.aspi_qr_issuer || ''   // bank pengirim (BCA, DUTAMONEY, dll)
    const referenceId = hit.reference_id || hit.id || ''
    const time        = hit.time || hit.created_at || ''

    return {
      reference_number: referenceId,
      amount,
      date: time,       // ISO string — scrapeWorker uses this for hash
      rrn,
      issuer,
      payment_type: hit.metadata?.transaction?.payment_type || 'qris',
      raw: hit          // full raw object saved as rawData
    }
  } catch (err) {
    console.error('[GoPay] parseHit error:', err.message)
    return null
  }
}

// ── Main scraper function ──────────────────────────────────────
// Signature matches existing scrapers (mainPage + context ignored — no browser needed)
export async function scrapeQrisGopay(_mainPage, _context, config, _isLoggedIn = false, _options = {}) {
  // scraping_config stores credentials as username + password
  // For GoPay, username IS the email (GoBiz login)
  const email = config.email || config.username
  const { password } = config

  // channelId is injected by scrapeWorker via config or we derive from context
  const channelId = config._channelId || config.channelId || 'unknown'

  return await attemptScrape(channelId, email, password, 0)
}

async function attemptScrape(channelId, email, password, retryCount) {
  try {
    // ── Step 1: Load cached token ─────────────────
    const cached = await loadToken(channelId)
    let accessToken = cached?.access_token || null

    // ── Step 2: Validate token (atau login baru) ────────
    let merchantId

    if (accessToken) {
      if (cached?.merchant_id) {
        // merchant_id sudah di-cache — skip API validate, hemat ~800ms
        console.log('[GoPay] ✅ Token + merchant_id from cache — skip validate')
        merchantId = cached.merchant_id
      } else {
        // merchant_id belum ada (token lama) — validasi sekali
        console.log('[GoPay] 🔍 Validating cached token...')
        const check = await validateAndFetchMerchantId(accessToken)
        if (check.tokenExpired) {
          console.log('[GoPay] ⚠️ Token expired — clearing cache, re-login...')
          await clearToken(channelId)
          accessToken = null
        } else {
          console.log('[GoPay] ✅ Token valid — caching merchant_id for next scrape')
          merchantId = check.merchantId
          await saveToken(channelId, accessToken, merchantId)  // simpan ulang dengan merchant_id
        }
      }
    }

    if (!accessToken) {
      // Tidak ada token atau sudah expired — login baru
      const loginResult = await login(channelId, email, password)
      if (loginResult.error) {
        return { transactions: [], isLoggedIn: false, error: loginResult.error }
      }
      accessToken = loginResult.accessToken

      // Ambil merchant_id setelah login baru
      const check = await validateAndFetchMerchantId(accessToken)
      if (check.tokenExpired) {
        // Sangat jarang — token baru tapi langsung 401
        return { transactions: [], isLoggedIn: false, error: 'Token baru tidak valid setelah login' }
      }
      merchantId = check.merchantId
      await saveToken(channelId, accessToken, merchantId)  // simpan dengan merchant_id
    }

    // ── Step 3: Fetch transactions ────────────────────────
    let hits
    try {
      hits = await fetchTransactions(accessToken, merchantId)
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED' && retryCount < MAX_RETRIES - 1) {
        console.log('[GoPay] ⚠️ 401 on journals/search — re-login')
        await clearToken(channelId)
        const loginResult = await login(channelId, email, password)
        if (loginResult.error) return { transactions: [], isLoggedIn: false, error: loginResult.error }
        return attemptScrape(channelId, email, password, retryCount + 1)
      }
      throw err
    }

    // ── Step 4: Parse ─────────────────────────────────────
    const transactions = hits
      .map(parseHit)
      .filter(Boolean)

    console.log(`[GoPay] ✅ ${transactions.length} transactions found`)
    return { transactions, isLoggedIn: true }

  } catch (error) {
    console.error(`[GoPay] ❌ Error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error.message)

    if (retryCount < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 1000))
      return attemptScrape(channelId, email, password, retryCount + 1)
    }

    return { transactions: [], isLoggedIn: false, error: error.message }
  }
}
