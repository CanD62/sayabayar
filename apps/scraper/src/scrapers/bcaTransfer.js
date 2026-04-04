// apps/scraper/src/scrapers/bcaTransfer.js
// BCA Transfer Scraper — TRUE STANDBY mode
//
// Flow:
//   1. mainPage stays alive (keeps BCA frameset session)
//   2. login() → mainPage navigates to klikBCA, fills login
//   3. getMutations() → navigates mainPage to statement, opens popup, parses, closes popup
//   4. Session check → detects BCA 5-min auto-logout (redirect detection)
//   5. Cookies saved to Redis for restore after restart
//
// BCA auto-logout after ~5 min idle. If session expired → re-login on mainPage.

import { load } from 'cheerio'
import { isShutdown } from '../index.js'

const LOGIN_URL = 'https://ibank.klikbca.com/'
const STATEMENT_URL = 'https://ibank.klikbca.com/nav_bar_indo/account_information_menu.htm'

const SELECTORS = {
  transactionsTable: 'table[border="1"]'
}

/**
 * Scrape BCA Transfer — TRUE STANDBY
 * @param {import('playwright').Page} mainPage - persistent page (stays alive)
 * @param {import('playwright').BrowserContext} context - for popup pages
 * @param {object} config - { username, password }
 * @param {boolean} isLoggedIn
 * @returns {{ transactions: Array, isLoggedIn: boolean }}
 */
export async function scrapeBcaTransfer(mainPage, context, config, isLoggedIn = false) {
  // Retry wrapper — BCA sometimes reports login success but session isn't valid
  // When popup redirects to login, we logout + re-login + retry
  const MAX_ATTEMPTS = 2

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let mutationPage = null

    try {
      // ── Abort if shutting down ────────────────────────────
      if (isShutdown()) {
        console.log('[BCA Transfer] ⛔ Shutdown detected — aborting')
        return { transactions: [], isLoggedIn: false, error: 'Shutdown' }
      }

      // ── Step 1: Ensure logged in ──────────────────────────
      if (!isLoggedIn) {
        console.log('[BCA Transfer] Not logged in, performing logout first...')
        try {
          await mainPage.goto(
            'https://ibank.klikbca.com/authentication.do?value(actions)=logout',
            { waitUntil: 'domcontentloaded', timeout: 8000 }
          )
          await mainPage.waitForTimeout(1000)
          console.log('[BCA Transfer] ✅ Logged out — proceeding to login')
        } catch {
          // Best effort — continue anyway
          console.log('[BCA Transfer] ⚠️ Logout attempt failed (best effort) — continuing to login')
        }
        console.log('[BCA Transfer] Not logged in, performing login...')
        await doLogin(mainPage, config.username, config.password)
      } else {
        const stillValid = await isSessionValid(mainPage)
        if (!stillValid) {
          console.log('[BCA Transfer] Session expired (BCA 5-min timeout), re-login...')
          await doLogin(mainPage, config.username, config.password)
        } else {
          console.log('[BCA Transfer] Session STANDBY — skipping login')
          // isSessionValid already navigated to STATEMENT_URL
        }
      }

      // ── Step 2: Navigate to statement page ─────────────────
      if (!isLoggedIn) {
        // Wait for BCA frameset to fully load after login
        await mainPage.waitForLoadState('load', { timeout: 10000 }).catch(() => {})

        await mainPage.goto(STATEMENT_URL, { waitUntil: 'domcontentloaded' })

        // Verify we're not redirected to login
        const stmtUrl = mainPage.url()
        if (stmtUrl.includes('login') || stmtUrl === LOGIN_URL) {
          throw new Error('Session not established — redirected to login')
        }
      }

      // Wait for the account info link
      await mainPage.waitForSelector('tr:nth-child(2) a', { timeout: 8000 })

      // ── Step 3: Click to open mutation page (popup) ────────
      const [popup] = await Promise.all([
        context.waitForEvent('page', { timeout: 10000 }),
        mainPage.click('tr:nth-child(2) a')
      ])

      mutationPage = popup
      popup.on('dialog', async (d) => { await d.dismiss() })
      await popup.setDefaultNavigationTimeout(0)
      await popup.waitForLoadState('domcontentloaded')

      // ── Step 4: Wait for date form ─────────────────────────
      await waitForForm(mutationPage, 3)
      await mutationPage.click('input[name="value(submit1)"]')
      await mutationPage.waitForSelector(SELECTORS.transactionsTable, { timeout: 15000 })

      // ── Step 5: Parse HTML with cheerio ────────────────────
      const htmlContent = await mutationPage.evaluate(() => document.body.innerHTML)
      const transactions = parseWithCheerio(htmlContent)

      // ── Step 6: Close ONLY the popup — mainPage stays alive ─
      await mutationPage.close()
      mutationPage = null

      // ── NO LOGOUT — mainPage stays logged in (STANDBY) ─────
      return { transactions, isLoggedIn: true }

    } catch (error) {
      // FATAL login errors — pass through immediately (no retry)
      if (error.message.startsWith('CREDENTIAL_ERROR:') ||
          error.message.startsWith('LOCKOUT:') ||
          error.message.startsWith('LOGIN_DIALOG:') ||
          error.message.startsWith('Shutdown')) {
        if (mutationPage) await mutationPage.close().catch(() => {})
        return { transactions: [], isLoggedIn: false, error: error.message }
      }

      // Check if popup went to login page → session expired
      let popupWentToLogin = false
      if (mutationPage) {
        try {
          const popupUrl = mutationPage.url()
          popupWentToLogin = (
            popupUrl.includes('login') ||
            popupUrl.includes('authentication.do') ||
            popupUrl === 'https://ibank.klikbca.com/' ||
            popupUrl === 'https://ibank.klikbca.com'
          )
          if (popupWentToLogin) {
            console.log(`[BCA Transfer] Popup redirected to login → session expired`)
          }
        } catch { /* page might be crashed */ }
        await mutationPage.close().catch(() => {})
      }

      const isSessionGone = (
        popupWentToLogin ||
        error.message.includes('Target page') ||
        error.message.includes('Target closed') ||
        error.message.includes('browser has been closed') ||
        error.message.includes('Session closed')
      )

      if (isSessionGone && attempt < MAX_ATTEMPTS) {
        // Session failed — logout, re-login, retry entire flow
        console.log(`[BCA Transfer] ⚠️ Session invalid (attempt ${attempt}/${MAX_ATTEMPTS}) — re-login and retry`)
        try {
          await mainPage.goto(
            'https://ibank.klikbca.com/authentication.do?value(actions)=logout',
            { timeout: 5000 }
          ).catch(() => {})
          await mainPage.waitForTimeout(1000)
        } catch { /* best effort */ }
        isLoggedIn = false
        continue  // ← retry entire loop
      }

      if (isSessionGone) {
        // Final attempt also failed
        try {
          console.log('[BCA Transfer] Logging out mainPage to clear BCA session...')
          await mainPage.goto(
            'https://ibank.klikbca.com/authentication.do?value(actions)=logout',
            { timeout: 5000 }
          ).catch(() => {})
          await mainPage.waitForTimeout(500).catch(() => {})
          console.log('[BCA Transfer] ✅ Logged out from BCA — clean for next login')
        } catch { /* best effort */ }
        return { transactions: [], isLoggedIn: false, error: error.message }
      }

      // Other error — mainPage might still be alive (STANDBY)
      console.log(`[BCA Transfer] Scrape error (session may still be alive): ${error.message}`)
      return { transactions: [], isLoggedIn: true, error: error.message }
    }
  }

  return { transactions: [], isLoggedIn: false, error: 'Max attempts reached' }
}

/**
 * Check if BCA session is still valid on mainPage
 * BCA auto-logouts after ~5 min idle → redirects to login page or shows dialog
 */
async function isSessionValid(mainPage) {
  try {
    const url = mainPage.url()

    // Already on login page → session expired
    if (url.includes('login') || url === LOGIN_URL || url === 'about:blank') {
      return false
    }

    // Try navigating to statement page to test session
    await mainPage.goto(STATEMENT_URL, { waitUntil: 'domcontentloaded', timeout: 8000 })
    const afterUrl = mainPage.url()

    // BCA redirects to login page if session expired
    if (afterUrl.includes('login') || afterUrl.includes('authentication.do')) {
      return false
    }

    // Check if we can see the account info link (indicates logged in)
    const hasLink = await mainPage.$('tr:nth-child(2) a').catch(() => null)
    return !!hasLink

  } catch {
    return false
  }
}

/**
 * Login to KlikBCA on mainPage
 * mainPage stays at the post-login page afterward (STANDBY)
 */
async function doLogin(mainPage, username, password) {
  let loginError = null

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      console.log(`[BCA Transfer] Login attempt ${attempt}`)

      // Abort if shutting down
      if (isShutdown()) {
        throw new Error('Shutdown — aborting login')
      }

      await mainPage.goto(LOGIN_URL, { waitUntil: 'load' })

      // Wait 2s for BCA login page JS to fully initialize
      await mainPage.waitForTimeout(2000)

      // Handle dialog (BCA shows alert on wrong credentials / lockout)
      mainPage.removeAllListeners('dialog')
      loginError = null
      mainPage.on('dialog', async (dialog) => {
        loginError = dialog.message()
        console.log(`[BCA Transfer] 🔔 Dialog: ${loginError}`)
        await dialog.accept()
      })

      await mainPage.fill('#txt_user_id', username)
      await mainPage.fill('#txt_pswd', password)
      await mainPage.click("input[value='LOGIN']")

      // Wait for URL to change from login AND page fully loaded (including frames)
      try {
        await mainPage.waitForURL(
          url => !url.includes('login') && url !== LOGIN_URL,
          { waitUntil: 'load', timeout: 10000 }
        )
      } catch {
        // Timeout — check if dialog was the cause
      }

      // Wait 2s for late-firing dialog (BCA sometimes shows alert AFTER URL changes)
      await mainPage.waitForTimeout(2000)

      // Check for dialog errors — NEVER retry on credential/lockout errors
      if (loginError) {
        if (loginError.includes('5 menit') || loginError.includes('5 minutes')) {
          console.log('[BCA Transfer] ⚠️ BCA lockout detected — need to wait')
          throw new Error(`LOCKOUT: ${loginError}`)
        }
        if (
          loginError.includes('User ID') ||
          loginError.includes('Password') ||
          loginError.includes('benar') ||
          loginError.includes('PIN harus Angka') ||
          loginError.includes('PIN must be Numeric')
        ) {
          console.log('[BCA Transfer] ❌ Wrong credentials — stopping immediately')
          throw new Error(`CREDENTIAL_ERROR: ${loginError}`)
        }
        throw new Error(`LOGIN_DIALOG: ${loginError}`)
      }

      // Verify login success — also check if dialog redirected back to login
      const afterUrl = mainPage.url()
      if (afterUrl.includes('login') || afterUrl === LOGIN_URL) {
        throw new Error('Login redirect failed')
      }

      console.log('[BCA Transfer] ✅ Login successful — STANDBY mode active')
      return

    } catch (error) {
      // FATAL errors — NEVER retry (prevents BCA blocking the account)
      if (error.message.startsWith('CREDENTIAL_ERROR:') ||
          error.message.startsWith('LOCKOUT:') ||
          error.message.startsWith('LOGIN_DIALOG:') ||
          error.message.startsWith('Shutdown')) {
        throw error
      }
      if (attempt >= 3) throw error
      loginError = null
      await mainPage.waitForTimeout(1000)
    }
  }
}

// ──────────────────────────────────────────────────────────
// Form retry — matches original BCA.class.js waitForForm()
// ──────────────────────────────────────────────────────────

async function waitForForm(page, maxRetries = 3) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.waitForSelector('#startDt', { timeout: 3000 })
      console.log('[BCA Transfer] ✅ Form elements ready')
      return
    } catch {
      console.log(`[BCA Transfer] ⏳ Waiting for form... (${attempt}/${maxRetries})`)
      if (attempt >= maxRetries) {
        throw new Error('Form elements (#startDt) not found after maximum retries')
      }
    }
  }
}

// ──────────────────────────────────────────────────────────
// Cheerio parsing (same as BCAParser.js)
// ──────────────────────────────────────────────────────────

function parseWithCheerio(html) {
  const $ = load(html)
  const transactions = []

  const periodeText = $('font:contains("Periode")').parent().next().next().text().trim()

  $(SELECTORS.transactionsTable).find('tr').each((i, elem) => {
    let tanggal = $(elem).find('td:nth-child(1)').text().trim()

    if (tanggal === 'Tgl.' || tanggal === 'Date') return

    if (tanggal === 'PEND' && periodeText) {
      tanggal = periodeText.split('-')[1]?.trim() || tanggal
    }

    let keterangan = $(elem).find('td:nth-child(2)').text().trim().replace(/\s+/g, ' ')

    // Extract nama from HTML structure (<br> based)
    let nama = null
    const keteranganHtml = $(elem).find('td:nth-child(2)').html()
    if (keteranganHtml) {
      const lines = keteranganHtml
        .split(/<br\s*\/?>/i)
        .map(line => line.replace(/<[^>]*>/g, '').trim())
        .filter(line => line.length > 0)

      if (lines.length > 0 && keterangan.includes('TRSF E-BANKING')) {
        const lastLine = lines[lines.length - 1]
        if (/^[A-Z\s]+$/.test(lastLine) && lastLine.length > 2) {
          nama = lastLine
        }
      }
    }

    if (!nama) nama = extractBCAMutationName(keterangan)

    const cab = $(elem).find('td:nth-child(3)').text().trim()
    const nominalRaw = $(elem).find('td:nth-child(4)').text().trim()
    const mutasi = $(elem).find('td:nth-child(5)').text().trim()
    const saldoAkhir = $(elem).find('td:nth-child(6)').text().trim()

    const amount = parseAmount(nominalRaw)

    if (mutasi === 'CR' && amount > 0) {
      transactions.push({
        date: tanggal,
        description: keterangan,
        reference_number: extractReference(keterangan),
        amount,
        type: 'credit',
        payer_name: nama || '',
        branch: cab,
        balance_after: parseAmount(saldoAkhir),
        raw: JSON.stringify({ tanggal, keterangan, nama, cab, mutasi, nominal: nominalRaw, saldoAkhir })
      })
    }
  })

  return transactions
}

function parseAmount(str) {
  if (!str) return 0
  const cleaned = str.replace(/,/g, '').replace(/\.00$/, '')
  return parseFloat(cleaned) || 0
}

function extractReference(desc) {
  const refMatch = desc.match(/\d{4}\/\w+\/\w+/i)
  if (refMatch) return refMatch[0]
  const ftsMatch = desc.match(/FTS\w+\/\w+/)
  if (ftsMatch) return ftsMatch[0]
  return desc.slice(0, 50)
}

function extractBCAMutationName(keterangan) {
  if (keterangan.includes('TRSF E-BANKING')) {
    if (keterangan.includes('FTFVA')) {
      const matches = keterangan.match(/\/(\w+)\s*-/)
      return matches ? matches[1].trim() : null
    }
    const matches = keterangan.match(/\d+\.\d+\s*(.+?)\s*$/)
    if (matches && matches[1]) {
      const capitalOnly = matches[1].trim().match(/[A-Z\s]+$/)
      return capitalOnly ? capitalOnly[0].trim() : matches[1].trim()
    }
    return null
  }
  if (keterangan.includes('KARTU DEBIT')) {
    const matches = keterangan.match(/KARTU DEBIT(.+?)\s*\d{13,}/)
    return matches ? matches[1].trim() : null
  }
  if (keterangan.includes('KR OTOMATIS')) {
    const matches = keterangan.match(/MID\s*:\s*\d+(.+?)QR\s*:/)
    return matches ? matches[1].trim() : null
  }
  if (keterangan.includes('TRANSAKSI DEBIT')) {
    const matches = keterangan.match(/\d+\.\d+([A-Za-z\s]+)$/)
    return matches ? matches[1].trim() : null
  }
  return null
}
