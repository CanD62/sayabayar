// apps/scraper/src/scrapers/qrisBri.js
// BRI Merchant QRIS scraper — pure HTTP API (no browser)

import { exec } from 'child_process'
import { promisify } from 'util'
//
// Flow:
//   1. Load JWT token + MID/TID from Redis (if cached)
//   2. Login via POST /api/auth/v4/login (if no token or got 403)
//   3. POST /api/user/v2/inquiryUser → auto-discover MID (list_mid[0])
//   4. TID = MID[10:18] (substring derivation)
//   5. POST /api/reporting/v2/inquiryListTransaction → transactions for today (WIB)
//   6. Return normalized transactions
//
// Config: { username, password }   (MID/TID auto-discovered)
// Token storage: Redis key pg:bri_session:{channelId}

import IORedis from 'ioredis'
import { randomUUID } from 'crypto'

const API_BASE = 'https://brimerchant.bri.co.id'
const MAX_RETRIES = 3
const TOKEN_TTL = 60 * 60 * 24 * 6   // 6 days in seconds (BRI JWT valid ~7 days)

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
        console.error('[BRI] Redis error:', err.message)
      }
    })
  }
  return _redis
}

// ── curl-based HTTP helper (async) ────────────────────────────
// Imperva WAF blocks Node.js fetch (TLS fingerprinting).
// curl passes because it has a recognized TLS fingerprint.
// Uses async exec to avoid blocking the event loop.
const execAsync = promisify(exec)

async function curlRequest(url, { method = 'GET', headers = {}, body = null, cookies = '' } = {}) {
  const args = ['curl', '-s', '-w', '"\\n__HTTP_STATUS__:%{http_code}"']

  // Method
  if (method !== 'GET') args.push('-X', method)

  // Headers
  for (const [k, v] of Object.entries(headers)) {
    args.push('-H', `'${k}: ${v}'`)
  }

  // Cookies
  if (cookies) args.push('-H', `'Cookie: ${cookies}'`)

  // Body
  if (body) {
    args.push('-H', "'Content-Type: application/json'")
    args.push('-d', `'${typeof body === 'string' ? body : JSON.stringify(body)}'`)
  }

  // Include response headers (for Set-Cookie parsing)
  args.push('-D', '-')

  // URL
  args.push(`'${url}'`)

  const cmd = args.join(' ')
  const { stdout: raw } = await execAsync(cmd, { timeout: 15_000, encoding: 'utf-8', shell: '/bin/sh' })

  // Parse: headers section + body + status code
  const statusMatch = raw.match(/__HTTP_STATUS__:(\d+)/)
  const statusCode = statusMatch ? parseInt(statusMatch[1]) : 0
  const cleanRaw = raw.replace(/\n?__HTTP_STATUS__:\d+\s*$/, '')

  // Split headers and body (separated by \r\n\r\n)
  const splitIdx = cleanRaw.indexOf('\r\n\r\n')
  const headerSection = splitIdx >= 0 ? cleanRaw.slice(0, splitIdx) : ''
  const bodyText = splitIdx >= 0 ? cleanRaw.slice(splitIdx + 4) : cleanRaw

  // Parse Set-Cookie headers
  const setCookies = []
  for (const line of headerSection.split('\n')) {
    const match = line.match(/^set-cookie:\s*(.+)/i)
    if (match) setCookies.push(match[1].trim())
  }

  // Parse content-type
  const ctMatch = headerSection.match(/^content-type:\s*(.+)/im)
  const contentType = ctMatch ? ctMatch[1].trim() : ''

  // Try parse JSON
  let json = null
  try { json = JSON.parse(bodyText) } catch { }

  return { status: statusCode, body: bodyText, json, setCookies, contentType }
}

// Standard BRI device header values
function deviceHeaders(deviceId) {
  return {
    'Accept': 'application/json, text/plain, */*',
    'Origin': 'https://brimerchant.bri.co.id',
    'Referer': 'https://brimerchant.bri.co.id/auth/login',
    'x-device-id': deviceId,
    'x-device': `WEB-scraper$$auto$$${deviceId.slice(0, 6)}`,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'
  }
}

// Authenticated headers (JWT in Authorization — no "Bearer " prefix)
function authHeaders(jwtToken, deviceId) {
  return {
    ...deviceHeaders(deviceId),
    'Authorization': jwtToken
  }
}

// ── Redis token helpers ───────────────────────────────────────
// Cache stores: jwt_token, device_id, mid, tid (auto-discovered)
async function loadSession(channelId) {
  try {
    const r = getRedis()
    const raw = await r.get(`pg:bri_session:${channelId}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed.jwt_token ? parsed : null
  } catch {
    return null
  }
}

async function saveSession(channelId, data) {
  try {
    const r = getRedis()
    await r.setex(
      `pg:bri_session:${channelId}`,
      TOKEN_TTL,
      JSON.stringify({ ...data, saved_at: Date.now() })
    )
  } catch (err) {
    console.error('[BRI] Failed to save session:', err.message)
  }
}

async function clearSession(channelId) {
  try {
    const r = getRedis()
    await r.del(`pg:bri_session:${channelId}`)
  } catch { }
}

// ── Login ─────────────────────────────────────────────────────
// BRI Merchant login — all via curl (Imperva blocks Node.js fetch):
//   1. GET / → capture WAF cookies
//   2. POST /api/auth/v4/login with cookies → JWT
async function login(username, password, deviceId) {
  console.log(`[BRI] Logging in... username=${username ? username.slice(0, 4) + '***' : 'UNDEFINED'}`)

  if (!username || !password) {
    return { error: 'CREDENTIAL_ERROR: Username atau password tidak ditemukan di konfigurasi channel' }
  }

  // ── Step 1: GET root → WAF cookies ────────────────────────
  console.log('[BRI] Step 1: Fetching WAF cookies...')
  const step1 = await curlRequest(`${API_BASE}/`, {
    headers: {
      'Accept': 'text/html',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/146.0.0.0'
    }
  })

  // Build cookie jar from Set-Cookie
  const cookieJar = {}
  for (const raw of step1.setCookies) {
    const [nameVal] = raw.split(';')
    const [name, ...valParts] = nameVal.split('=')
    cookieJar[name.trim()] = valParts.join('=').trim()
  }
  // Add our device cookies
  cookieJar['mydeviceID'] = deviceId
  cookieJar['mydevice'] = encodeURIComponent(`WEB-scraper$$auto$$${deviceId.slice(0, 6)}`)

  const cookieString = Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ')
  console.log(`[BRI] WAF cookies: ${Object.keys(cookieJar).join(', ')}`)

  // ── Step 2: POST login ────────────────────────────────────
  const res = await curlRequest(`${API_BASE}/api/auth/v4/login`, {
    method: 'POST',
    headers: deviceHeaders(deviceId),
    cookies: cookieString,
    body: { username, password, token_firebase: '-' }
  })

  console.log(`[BRI] Login response [${res.status}] content-type=${res.contentType}`)

  if (!res.json) {
    console.log(`[BRI] ⚠️ Response is NOT JSON: ${res.body.slice(0, 200)}`)
    return { error: `Login failed [${res.status}]: WAF blocked request` }
  }

  const data = res.json
  if (res.status !== 200 || data.responseCode !== '00') {
    const desc = data.responseDesc || 'Login gagal'
    const isCredErr = desc.toLowerCase().includes('password') ||
      desc.toLowerCase().includes('username') ||
      desc.toLowerCase().includes('salah') ||
      data.responseCode === '01'
    if (isCredErr) {
      console.log(`[BRI] ❌ CREDENTIAL_ERROR: ${desc}`)
      return { error: `CREDENTIAL_ERROR: ${desc}` }
    }
    console.log(`[BRI] ❌ Login failed [${res.status}]: ${desc}`)
    return { error: `Login failed [${res.status}]: ${desc}` }
  }

  // Extract JWT from Set-Cookie or response body
  let jwtToken = null
  for (const c of res.setCookies) {
    if (c.startsWith('users=')) {
      jwtToken = c.split('users=')[1].split(';')[0]
      break
    }
  }
  // Fallback: JWT from response body
  if (!jwtToken && data.responseData?.token) {
    jwtToken = data.responseData.token
    console.log('[BRI] JWT from response body (not Set-Cookie)')
  }

  if (!jwtToken) {
    console.log('[BRI] ⚠️ JWT not found in Set-Cookie, checking response body')
    return { error: 'Login response missing JWT token in Set-Cookie' }
  }

  console.log(`[BRI] ✅ Login successful (${data.responseData?.nama || 'unknown'})`)
  return { jwtToken }
}

// ── Logout (force_logout command) ─────────────────────────────
export async function logoutBri(channelId) {
  console.log('[BRI] Clearing session')
  await clearSession(channelId)
  console.log('[BRI] ✅ Session cleared')
}

// ── Inquiry User (validate token + discover MID/TID) ──────────
// POST /api/user/v2/inquiryUser → { responseData.list_mid[0] }
// Also serves as token validator: 403 + responseCode "05" = expired
async function inquiryUser(jwtToken, deviceId, cookieString) {
  const res = await curlRequest(`${API_BASE}/api/user/v2/inquiryUser`, {
    method: 'POST',
    headers: authHeaders(jwtToken, deviceId),
    cookies: cookieString,
    body: {}
  })

  if (res.status === 403 && res.json?.responseCode === '05') {
    return { valid: false, expired: true }
  }
  if (res.status === 401) {
    return { valid: false, expired: true }
  }
  if (res.status !== 200 || !res.json || res.json.responseCode !== '00') {
    return { valid: true, mid: null, tid: null }
  }

  const data = res.json

  // Extract MID from list_mid[0]
  const mid = data.responseData?.list_mid?.[0] || null
  // TID = MID[10:18] — substring derivation (confirmed from QRIS/HAR analysis)
  const tid = mid ? mid.slice(10, 18) : null

  if (mid) {
    console.log(`[BRI] 🔍 Discovered MID: ${mid}, TID: ${tid}`)
  }

  return { valid: true, mid, tid, nama: data.responseData?.nama }
}

// ── Get today's date in WIB (YYYY-MM-DD) ─────────────────────
function getTodayWIB() {
  const now = new Date()
  // Convert to WIB (UTC+7)
  const wib = new Date(now.getTime() + 7 * 60 * 60_000)
  return wib.toISOString().slice(0, 10)
}

// ── Fetch transactions ────────────────────────────────────────
async function fetchTransactions(jwtToken, deviceId, mid, tid, cookieString) {
  const today = getTodayWIB()

  console.log(`[BRI] Fetching transactions for ${today} (MID: ${mid})`)

  const body = {
    mid,
    tid,
    start_date_trx: today,
    end_date_trx: today,
    limit: 20,
    page: 1,
    sort_direction: 'DESC',
    metode_pembayaran: [
      'Kartu Debit BRI', 'Kartu Kredit BRI', 'Kartu Bank Lain',
      'QRIS On Us', 'QRIS Off Us', 'BRIZZI'
    ],
    status: ['purchase_qris', 'purchase_edc', 'void', 'refund'],
    nominal_from: 0,
    nominal_to: 9999999999,
    reff_num: '',
    sort_by: 'trxDate'
  }

  const res = await curlRequest(`${API_BASE}/api/reporting/v2/inquiryListTransaction`, {
    method: 'POST',
    headers: authHeaders(jwtToken, deviceId),
    cookies: cookieString,
    body
  })

  // 403 + responseCode "05" = session expired
  if (res.status === 403 && res.json?.responseCode === '05') {
    throw new Error('TOKEN_EXPIRED')
  }
  if (res.status === 401) {
    throw new Error('TOKEN_EXPIRED')
  }
  // 400 + responseCode "02" = no transactions (normal empty result)
  if (res.status === 400 && res.json?.responseCode === '02') {
    console.log(`[BRI] No transactions found for ${today}`)
    return []
  }

  if (res.status !== 200 || !res.json) {
    console.error('[BRI] inquiryListTransaction error:', res.body.slice(0, 300))
    throw new Error(`inquiryListTransaction failed [${res.status}]`)
  }

  if (res.json.responseCode !== '00') {
    throw new Error(`inquiryListTransaction unexpected code: ${res.json.responseCode} — ${res.json.responseDesc}`)
  }

  return res.json.responseData || []
}

// ── Parse raw transaction → normalized transaction ────────────
function parseTransaction(tx) {
  try {
    const amount = tx.amount_trx
    if (!amount || amount <= 0) return null

    // Only include successful transactions
    if (tx.status_trx !== 'sukses' || tx.rc !== '00') return null

    const referenceId = tx.reff_num || ''
    const dateStr = tx.date_trx || ''  // "2026-04-12"
    const timeStr = tx.time_trx || ''  // "02:10:55"

    // Construct ISO date string in WIB
    const isoDate = dateStr && timeStr
      ? `${dateStr}T${timeStr}+07:00`
      : tx.kafka_timestamp || ''

    return {
      reference_number: referenceId,
      amount,                          // already in Rupiah
      date: isoDate,                   // ISO string — scrapeWorker uses this for hash
      rrn: referenceId,
      issuer: tx.jenis_trx || '',      // "QRIS Off Us - Bank Lain"
      payment_type: (tx.switch || 'qris').toLowerCase(),
      raw: tx                          // full raw object saved as rawData
    }
  } catch (err) {
    console.error('[BRI] parseTransaction error:', err.message)
    return null
  }
}

// ── Main scraper function ──────────────────────────────────────
// Signature matches existing scrapers (mainPage + context ignored — no browser needed)
export async function scrapeQrisBri(_mainPage, _context, config, _isLoggedIn = false, _options = {}) {
  const { username, password } = config

  // channelId is injected by scrapeWorker via config
  const channelId = config._channelId || config.channelId || 'unknown'

  return await attemptScrape(channelId, username, password, 0)
}

async function attemptScrape(channelId, username, password, retryCount) {
  try {
    // ── Step 1: Load cached session (token + MID/TID + cookies) ─
    const cached = await loadSession(channelId)
    let jwtToken = cached?.jwt_token || null
    let deviceId = cached?.device_id || randomUUID()
    let mid = cached?.mid || null
    let tid = cached?.tid || null
    let cookieString = cached?.waf_cookies || ''

    // ── Step 2: Validate token + discover MID/TID ──────────
    if (jwtToken && cookieString) {
      console.log('[BRI] 🔍 Validating cached token...')
      const check = await inquiryUser(jwtToken, deviceId, cookieString)
      if (!check.valid) {
        console.log('[BRI] ⚠️ Session expired — clearing cache, re-login...')
        await clearSession(channelId)
        jwtToken = null
        mid = null
        tid = null
        cookieString = ''
      } else {
        console.log('[BRI] ✅ Token valid')
        if (check.mid) {
          mid = check.mid
          tid = check.tid
        }
      }
    }

    if (!jwtToken) {
      // No token or expired — login fresh
      deviceId = randomUUID()
      const loginResult = await login(username, password, deviceId)
      if (loginResult.error) {
        return { transactions: [], isLoggedIn: false, error: loginResult.error }
      }
      jwtToken = loginResult.jwtToken
      cookieString = loginResult.cookieString || ''

      // After login, discover MID/TID via inquiryUser
      console.log('[BRI] 🔍 Discovering MID/TID via inquiryUser...')
      const userInfo = await inquiryUser(jwtToken, deviceId, cookieString)
      if (!userInfo.valid) {
        await clearSession(channelId)
        return { transactions: [], isLoggedIn: false, error: 'Token invalid immediately after login' }
      }
      mid = userInfo.mid
      tid = userInfo.tid
    }

    // Save session with MID/TID + WAF cookies
    await saveSession(channelId, { jwt_token: jwtToken, device_id: deviceId, mid, tid, waf_cookies: cookieString })

    if (!mid || !tid) {
      return { transactions: [], isLoggedIn: true, error: 'Gagal menemukan MID/TID dari akun BRI Merchant. Pastikan akun memiliki QRIS aktif.' }
    }

    // ── Step 3: Fetch transactions ────────────────────────
    let txList
    try {
      txList = await fetchTransactions(jwtToken, deviceId, mid, tid, cookieString)
    } catch (err) {
      if (err.message === 'TOKEN_EXPIRED' && retryCount < MAX_RETRIES - 1) {
        console.log('[BRI] ⚠️ Token expired during fetch — re-login')
        await clearSession(channelId)
        return attemptScrape(channelId, username, password, retryCount + 1)
      }
      throw err
    }

    // ── Step 4: Parse ─────────────────────────────────────
    const transactions = txList
      .map(parseTransaction)
      .filter(Boolean)

    console.log(`[BRI] ✅ ${transactions.length} transactions found`)
    return { transactions, isLoggedIn: true }

  } catch (error) {
    console.error(`[BRI] ❌ Error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error.message)

    if (retryCount < MAX_RETRIES - 1) {
      await new Promise(r => setTimeout(r, 1000))
      return attemptScrape(channelId, username, password, retryCount + 1)
    }

    return { transactions: [], isLoggedIn: false, error: error.message }
  }
}

