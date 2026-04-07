// apps/scraper/src/scrapers/flipBrowser.js
// Playwright automation untuk input PIN Flip/Aladin (aktivasi & transfer)

import { chromium } from 'playwright'

// ── Singleton browser instance ────────────────────────────
let _browser = null

async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: false,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })
    console.log('[FlipBrowser] Chromium launched')
  }
  return _browser
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => { })
    _browser = null
    console.log('[FlipBrowser] Chromium closed')
  }
}

// ── User-Agent dari HAR (Android 13 WebView) ──────────────
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-G998B Build/TE1A.240213.009; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.123 Mobile Safari/537.36'

// ── Helper: tunggu selector dengan retry ─────────────────
async function waitForSelector(page, selectors, timeout = 8000, label = 'element') {
  const selectorList = Array.isArray(selectors) ? selectors : [selectors]
  const start = Date.now()
  while (Date.now() - start < timeout) {
    for (const sel of selectorList) {
      try {
        const el = await page.$(sel)
        if (el) return el
      } catch { /* lanjut */ }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  throw new Error(`[FlipBrowser] ${label} tidak ditemukan (${selectorList.join(' | ')})`)
}

// ── Helper: input PIN digit per digit ─────────────────────
async function typePinIntoInputs(page, pin) {
  // Coba multi-digit input (1 kotak per digit) — format Aladin flamingo
  const digitInputs = await page.$$('input[type="tel"][maxlength="1"], input[type="number"][maxlength="1"], input[data-pin-input], input[name*="pin"]')

  if (digitInputs.length >= pin.length) {
    console.log(`[FlipBrowser] Multi-digit PIN (${digitInputs.length} inputs ditemukan)`)
    for (let i = 0; i < Math.min(pin.length, digitInputs.length); i++) {
      await digitInputs[i].click()
      await digitInputs[i].type(pin[i], { delay: 100 })
    }
    return true
  }

  // Fallback: single OTP box
  const single = await page.$('input[data-input-otp="true"], input[inputmode="numeric"], input[type="tel"]')
  if (single) {
    console.log('[FlipBrowser] Single OTP input ditemukan')
    await single.click()
    await single.type(pin, { delay: 100 })
    return true
  }

  throw new Error('[FlipBrowser] PIN input tidak ditemukan di halaman')
}

/**
 * Input PIN transfer via Aladin flamingo WebView.
 *
 * Flow (dari HAR proses_transfer_by_aladin.har):
 *  1. GET /charge/challenge → challenge_url + headers (X-AUTHORIZATION, X-AUTHORIZATION-CUSTOMER, X-DEVICE-ID)
 *  2. Buka challenge_url (flamingo.aladinbank.id/v1/transaction/pin?authorize_request_id=...)
 *  3. Set cookies: authorization, authorization-customer, deviceId, authorizeRequestId
 *  4. PIN form muncul → ketik PIN → JS enkripsi ECDH → POST /api/whitelabel/v1/transaction/auth/pin
 *  5. Response: { data: { nonce, partner_reference_no, redirect_url } }
 *  6. Return nonce → dipakai untuk POST transfer
 *
 * @param {string} challengeUrl  - URL dari charge/challenge (data.challenge_url)
 * @param {string} pin           - 6 digit PIN Aladin
 * @param {object} wvHeaders     - Headers dari charge/challenge response (data.headers):
 *                                 { X-AUTHORIZATION, X-AUTHORIZATION-CUSTOMER, X-DEVICE-ID }
 * @returns {Promise<{nonce, partner_reference_no}>}
 */
export async function inputPin(challengeUrl, pin, wvHeaders = {}) {
  console.log('[FlipBrowser] Starting PIN input for transfer...')
  const browser = await getBrowser()

  const authorization         = wvHeaders['X-AUTHORIZATION'] || wvHeaders['authorization'] || ''
  const authorizationCustomer = wvHeaders['X-AUTHORIZATION-CUSTOMER'] || wvHeaders['authorization-customer'] || ''
  const deviceId              = wvHeaders['X-DEVICE-ID'] || wvHeaders['x-device-id'] || ''

  // Extract authorizeRequestId dari challengeUrl query param
  const authorizeReqId = new URL(challengeUrl).searchParams.get('authorize_request_id') || ''
  console.log('[FlipBrowser] authorizeRequestId:', authorizeReqId.slice(0, 20) + '...')
  console.log('[FlipBrowser] x-authorization:', authorization ? '✅' : '❌')

  // Headers browser untuk semua request ke flamingo
  const browserHeaders = {
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'x-requested-with': 'id.flip',
    'sec-ch-ua': '"Android WebView";v="109", "Chromium";v="109", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
  }

  const context = await browser.newContext({
    userAgent: MOBILE_UA,
    extraHTTPHeaders: browserHeaders,
  })

  // Set cookies untuk autentikasi flamingo
  const cookies = [
    { name: 'authorization',          value: authorization },
    { name: 'authorization-customer', value: authorizationCustomer },
    { name: 'deviceId',               value: deviceId },
    { name: 'authorizeRequestId',     value: encodeURIComponent(authorizeReqId) },
  ].filter(c => c.value)

  await context.addCookies(cookies.map(c => ({
    ...c,
    domain: 'flamingo.aladinbank.id',
    path: '/', secure: true, httpOnly: false, sameSite: 'Lax'
  })))

  const page = await context.newPage()

  try {
    // Intercept response dari /api/whitelabel/v1/transaction/auth/pin
    // Ini AJAX request biasa — body bisa dibaca via route handler
    let pinResult = null
    const pinResponseCapture = new Promise((resolve, reject) => {
      page.route('**/api/whitelabel/v1/transaction/auth/pin', async (route) => {
        // Lanjutkan request ke server
        const response = await route.fetch()
        const body = await response.json().catch(() => ({}))
        console.log('[FlipBrowser] /transaction/auth/pin response:', JSON.stringify(body).slice(0, 150))
        pinResult = body?.data
        await route.fulfill({ response })  // forward response ke browser
        resolve()
      })
      // Timeout
      setTimeout(() => reject(new Error('Timeout 30s menunggu PIN response')), 30_000)
    })

    // Buka halaman PIN
    console.log('[FlipBrowser] Opening challenge URL:', challengeUrl.slice(0, 80) + '...')
    await page.goto(challengeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})

    // Tunggu form PIN muncul
    console.log('[FlipBrowser] Waiting for PIN input...')
    const pinInput = await page.waitForSelector(
      'input[data-input-otp="true"], input[inputmode="numeric"][maxlength="1"], input[type="tel"]',
      { timeout: 15_000 }
    )
    console.log('[FlipBrowser] PIN input found!')

    // Ketik PIN digit per digit
    await pinInput.focus()
    await new Promise(r => setTimeout(r, 500))
    for (const digit of pin) {
      await page.keyboard.type(digit, { delay: 150 })
    }
    console.log('[FlipBrowser] PIN typed — waiting for auth/pin response...')

    // Tunggu response tercapture
    await pinResponseCapture

    if (!pinResult?.nonce) {
      throw new Error(`PIN response tidak valid: ${JSON.stringify(pinResult)}`)
    }

    console.log('[FlipBrowser] PIN input success — nonce:', pinResult.nonce.slice(0, 20) + '...')
    return pinResult  // { nonce, partner_reference_no, redirect_url }

  } catch (err) {
    console.error('[FlipBrowser] inputPin error:', err.message)
    throw err
  } finally {
    await context.close()
    console.log('[FlipBrowser] Context closed (inputPin)')
  }
}


/**
 * Aktivasi Alaflip — login Aladin WebView + binding ke Flip.
 *
 * Flow yang benar (sesuai HAR + debug-alaflip.js):
 *  1. Buka URL dari POST /webview-url dengan headers dari data.headers
 *  2. Server Aladin set cookie authorization → /api/shield → 200
 *  3. Browser navigasi ke /authentication/login → form PIN muncul
 *  4. Tekan PIN → JS Aladin enkripsi ECDH → POST /api/shield/login
 *  5. Browser navigate ke storage.googleapis.com?code=xxx
 *  6. Intercept & abort navigasi itu → ambil code dari URL
 *  7. Kembalikan code ke caller untuk POST /auth-code ke Flip
 *
 * @param {string} activationUrl  - URL dari POST /webview-url (data.url)
 * @param {string} pin            - 6 digit PIN Aladin
 * @param {object} wvHeaders      - Headers dari POST /webview-url (data.headers):
 *                                  { X-AUTHORIZATION, X-DEVICE-ID, X-PARTNER-ID, X-CHANNEL-ID, X-CLIENT-ID }
 * @returns {Promise<string>}     OAuth code untuk POST /auth-code
 */
export async function activateAlaflip(activationUrl, pin, wvHeaders = {}) {
  console.log('[FlipBrowser] Starting Alaflip activation...')
  const browser = await getBrowser()

  // Headers WebView dari response /webview-url — sudah include semua yang dibutuhkan
  const aladinHeaders = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'sec-ch-ua': '"Android WebView";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua-platform': '"Android"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'x-requested-with': 'id.flip',
    // Dari webview-url response:
    ...(wvHeaders['X-AUTHORIZATION'] ? { 'x-authorization': wvHeaders['X-AUTHORIZATION'] } : {}),
    ...(wvHeaders['X-DEVICE-ID'] ? { 'x-device-id': wvHeaders['X-DEVICE-ID'] } : {}),
    ...(wvHeaders['X-CLIENT-ID'] ? { 'x-client-id': wvHeaders['X-CLIENT-ID'] } : {}),
    ...(wvHeaders['X-CHANNEL-ID'] ? { 'x-channel-id': wvHeaders['X-CHANNEL-ID'] } : {}),
    ...(wvHeaders['X-PARTNER-ID'] ? { 'x-partner-id': wvHeaders['X-PARTNER-ID'] } : {}),
  }

  console.log('[FlipBrowser] x-authorization:', wvHeaders['X-AUTHORIZATION'] ? '✅' : '❌ TIDAK ADA — /api/shield akan 404!')

  const context = await browser.newContext({
    userAgent: MOBILE_UA,
    extraHTTPHeaders: aladinHeaders,
  })

  const page = await context.newPage()

  try {
    // ── Route intercept: capture code dari storage.googleapis.com ──
    // Setelah PIN sukses, JS Aladin navigate ke:
    // https://storage.googleapis.com/...?code=xxx
    // Kita abort navigasi agar code tidak dikonsumsi duluan
    let oauthCode = null
    const codeCapture = new Promise((resolve) => {
      page.route('https://storage.googleapis.com/**', async (route) => {
        const url = route.request().url()
        console.log('[FlipBrowser] Intercepted storage URL:', url.slice(0, 120))
        const codeMatch = url.match(/[?&]code=([^&]+)/)
        if (codeMatch) {
          oauthCode = decodeURIComponent(codeMatch[1])
          console.log('[FlipBrowser] OAuth code captured! length:', oauthCode.length)
        }
        await route.abort()
        resolve()
      })
    })

    // ── Buka URL aktivasi ──────────────────────────────────────────
    console.log('[FlipBrowser] Opening activation URL...')
    await page.goto(activationUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => { })

    // ── Tunggu navigasi ke /authentication/login ───────────────────
    console.log('[FlipBrowser] Waiting for login page...')
    await page.waitForURL(
      url => url.toString().includes('/authentication/login'),
      { timeout: 20_000 }
    ).catch(() => {
      console.log('[FlipBrowser] Login page wait timeout — checking current URL:', page.url())
    })
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => { })
    console.log('[FlipBrowser] URL:', page.url())

    // ── Tunggu form PIN muncul ─────────────────────────────────────
    console.log('[FlipBrowser] Waiting for PIN input...')
    const pinInput = await page.waitForSelector(
      'input[data-input-otp="true"], input[inputmode="numeric"][maxlength="1"], input[type="tel"]',
      { timeout: 15_000 }
    )
    console.log('[FlipBrowser] PIN input found!')

    // ── Ketik PIN digit per digit ──────────────────────────────────
    console.log('[FlipBrowser] Typing PIN...')
    await pinInput.focus()
    await new Promise(r => setTimeout(r, 500))
    for (const digit of pin) {
      await page.keyboard.type(digit, { delay: 150 })
    }
    console.log('[FlipBrowser] PIN typed — waiting for storage.googleapis.com intercept...')

    // ── Tunggu code tercapture (max 30s) ───────────────────────────
    await Promise.race([
      codeCapture,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 30s menunggu OAuth code')), 30_000))
    ])

    if (!oauthCode) {
      throw new Error('[FlipBrowser] OAuth code tidak ditemukan di storage URL')
    }

    console.log('[FlipBrowser] Activation flow complete, returning OAuth code')
    return oauthCode

  } catch (err) {
    console.error('[FlipBrowser] Activation error:', err.message)
    throw err
  } finally {
    await context.close()
    console.log('[FlipBrowser] Context closed (activation)')
  }
}
