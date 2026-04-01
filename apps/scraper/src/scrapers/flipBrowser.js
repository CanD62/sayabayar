// apps/scraper/src/scrapers/flipBrowser.js
// ESM adaptation dari example_scapre/flipjs/services/flipBrowser.js
// Playwright automation untuk input PIN Flip Aladin

import { chromium } from 'playwright'

// ── Singleton browser instance untuk flip ─────────────────
let _browser = null

async function getBrowser() {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    })
    console.log('[FlipBrowser] Chromium launched')
  }
  return _browser
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {})
    _browser = null
    console.log('[FlipBrowser] Chromium closed')
  }
}

// ── Wait OTP input dengan retry ───────────────────────────
async function waitForOTPInput(page, maxAttempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const otpInput = await page.waitForSelector('input[data-input-otp="true"]', { timeout: 5000 })
      return otpInput
    } catch (err) {
      lastError = err
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, attempt * 1000))
      }
    }
  }
  throw new Error(`OTP input tidak ditemukan setelah ${maxAttempts} percobaan: ${lastError.message}`)
}

/**
 * Input PIN Flip via browser automation (Playwright)
 * Dipanggil saat challenge URL sudah didapat dari getTokenTransfer()
 *
 * @param {string} challengeUrl - URL dari responses.data.challenge_url
 * @param {string} pin          - 6 digit PIN (sudah didecrypt)
 * @param {string} authorization          - X-AUTHORIZATION header
 * @param {string} authorizationCustomer  - X-AUTHORIZATION-CUSTOMER header
 * @param {string} deviceId               - X-DEVICE-ID header
 * @returns {Promise<{ nonce, partner_reference_no }>}
 */
export async function inputPin(challengeUrl, pin, authorization, authorizationCustomer, deviceId) {
  console.log('[FlipBrowser] Starting PIN input...')
  const browser = await getBrowser()

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Linux; Android 7.1.2; SM-N976N Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.193 Mobile Safari/537.36'
  })

  await context.setExtraHTTPHeaders({
    'x-authorization-customer': authorizationCustomer,
    'x-authorization':          authorization,
    'x-device-id':              deviceId,
    'Accept':       'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'sec-ch-ua-mobile': '?1',
    'sec-ch-ua':        '"Android WebView";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    'sec-ch-ua-platform': '"Android"',
    'Connection': 'keep-alive',
    'User-Agent': 'Mozilla/5.0 (Linux; Android 7.1.2; SM-N976N Build/QP1A.190711.020) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.193 Mobile Safari/537.36'
  })

  const page = await context.newPage()

  try {
    // Intercept semua request untuk inject auth headers
    await page.route('**/*', (route) => {
      route.continue({
        headers: {
          ...route.request().headers(),
          'x-authorization':          authorization,
          'x-authorization-customer': authorizationCustomer,
          'x-device-id':              deviceId
        }
      })
    })

    // Listen untuk response PIN sebelum navigate
    const responsePromise = page.waitForResponse(
      res => res.url().includes('/api/whitelabel/v1/transaction/auth/pin'),
      { timeout: 30_000 }
    )

    console.log('[FlipBrowser] Navigating to challenge URL...')
    await page.goto(challengeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })

    const otpInput = await waitForOTPInput(page)

    console.log('[FlipBrowser] Typing PIN...')
    await otpInput.type(pin, { delay: 50 })

    console.log('[FlipBrowser] Waiting for PIN response...')
    const res     = await responsePromise
    const pinData = await res.json()

    if (!pinData?.data?.nonce) {
      throw new Error(`PIN response tidak valid: ${JSON.stringify(pinData)}`)
    }

    console.log('[FlipBrowser] PIN input success')
    return pinData.data // { nonce, partner_reference_no }

  } finally {
    await context.close()
    console.log('[FlipBrowser] Context closed')
  }
}
