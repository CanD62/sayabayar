// apps/scraper/src/scrapers/qrisBca.js
// QRIS BCA Merchant Dashboard scraper
// Adapted from example_scapre/flipjs/services/bcaService.js

import { saveSession, loadSession, clearSession } from './qrisBcaSession.js'

const LOGIN_URL = 'https://qr.klikbca.com/login'
const HOME_URL = 'https://qr.klikbca.com/home'
const MAX_RETRIES = 3

// ── Persistent per-page state (survives between scrape cycles) ──
// WeakMap: page instance → { lastReloadDate }
const pageState = new WeakMap()
function getPageState(page) {
  if (!pageState.has(page)) pageState.set(page, { lastReloadDate: null })
  return pageState.get(page)
}

/** Clear state when browser session is destroyed */
export function clearPageState(page) {
  pageState.delete(page)
}

/** Get current date in WIB (UTC+7), format: YYYY-MM-DD */
function getCurrentWIBDate() {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000)
  const y = wib.getUTCFullYear()
  const m = String(wib.getUTCMonth() + 1).padStart(2, '0')
  const d = String(wib.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Scrape QRIS BCA dashboard mutations
 * @param {import('playwright').Page} mainPage - persistent page (standby)
 * @param {import('playwright').BrowserContext} context
 * @param {object} config - { username, password }
 * @param {boolean} isLoggedIn
 * @returns {{ transactions: Array, isLoggedIn: boolean, error?: string }}
 */
export async function scrapeQrisBca(mainPage, context, config, isLoggedIn = false, options = {}) {
  const page = mainPage
  const channelId = config.channelId  // dipass dari scrapeWorker untuk session key
  const state = { invalidGrant: false, credentialError: false, invalidGrantResolver: null }

  // ── Setup token interceptor ────────────────────────────
  // Setiap ~30 menit, Angular HTTP Interceptor otomatis:
  // list → 401 → token refresh → list retry
  // Kita update Redis setiap kali dapat token baru agar session restore selalu fresh.
  let saveSessionDebounce = null
  const tokenHandler = async (response) => {
    const url = response.url()
    if (url.includes('mssi.ebanksvc.bca.co.id') && url.includes('/token')) {
      try {
        const data = await response.json()
        if (data.access_token && data.refresh_token) {
          state.invalidGrant = false
          state.credentialError = false
          console.log('[QRIS BCA] ✅ Tokens captured')

          // Update Redis session dengan token terbaru (debounce 5s untuk hindari flood)
          // Saat Angular retry setelah 401, bisa ada 2 token response berurutan
          if (channelId) {
            clearTimeout(saveSessionDebounce)
            saveSessionDebounce = setTimeout(() => {
              saveSession(channelId, page).catch(() => {})
            }, 5000)
          }
        } else if (data.error === 'invalid_grant') {
          const desc = data.error_description || ''
          // "Invalid user credentials" → salah username/password
          const isCredError = desc.toLowerCase().includes('invalid user credentials') ||
            desc.toLowerCase().includes('bad credentials')

          if (isCredError) {
            console.log(`[QRIS BCA] ❌ CREDENTIAL_ERROR: ${desc}`)
            state.credentialError = true
          } else {
            // Refresh token expired (8 jam hard expiry) → re-login dengan credential
            console.log(`[QRIS BCA] ❌ invalid_grant (token expired): ${desc}`)
            state.invalidGrant = true
          }

          // Instant notification — resolve any waiting promise
          if (state.invalidGrantResolver) {
            state.invalidGrantResolver(isCredError ? 'credential_error' : 'invalid_grant')
            state.invalidGrantResolver = null
          }
        }
      } catch { /* not JSON */ }
    }
  }

  page.on('response', tokenHandler)

  try {
    const result = await attemptFetch(page, config, channelId, isLoggedIn, state, 0, options)
    return result || { transactions: [], isLoggedIn: false, error: 'Failed after retries' }
  } finally {
    page.off('response', tokenHandler)
    clearTimeout(saveSessionDebounce)  // Cancel pending save jika ada
  }
}

// ── Retry wrapper ──────────────────────────────────────────
async function attemptFetch(page, config, channelId, isLoggedIn, state, retryCount, options = {}) {
  try {
    // Reset flags at start of each attempt
    state.invalidGrant = false
    state.credentialError = false
    state.invalidGrantResolver = null

    // ── Login if needed ────────────────────────────────────
    if (!isLoggedIn) {
      const loginOk = await login(page, config.username, config.password, state, channelId)
      if (!loginOk) {
        // Check if it was a credential error (wrong username/password)
        if (state.credentialError) {
          console.log('[QRIS BCA] ❌ Login ditolak: username/password salah — deactivating channel')
          await clearSession(channelId)
          return { transactions: [], isLoggedIn: false, error: 'CREDENTIAL_ERROR: Username atau password QRIS BCA salah' }
        }
        console.log('[QRIS BCA] ❌ Login failed')
        return { transactions: [], isLoggedIn: false, error: 'Login failed' }
      }
      isLoggedIn = true
    }

    // ── Navigate to home ───────────────────────────────────
    // Track 401 responses during navigation
    let got401 = false
    const check401 = (response) => {
      if (response.status() === 401) {
        console.log(`[QRIS BCA] ❌ 401 on: ${response.url()}`)
        got401 = true
      }
    }
    page.on('response', check401)

    const navOk = await navigateToHome(page, options, state)
    page.off('response', check401)

    if (got401 || !navOk) {
      console.log('[QRIS BCA] ⚠️ Navigation failed (401 or error)')
      if (retryCount < MAX_RETRIES - 1) {
        console.log('[QRIS BCA] 🔄 Retrying...')
        await page.waitForTimeout(1000)
        return await attemptFetch(page, config, channelId, false, state, retryCount + 1, options)
      }
      return { transactions: [], isLoggedIn: false, error: 'Navigation failed' }
    }

    // ── Click today's date ─────────────────────────────────
    const dateClickOk = await clickTodayDate(page, state)

    // Check: credential error (wrong username/password) — deactivate immediately
    if (state.credentialError) {
      console.log('[QRIS BCA] ❌ Credential error setelah date click — deactivating channel')
      await dismissModal(page)
      return { transactions: [], isLoggedIn: false, error: 'CREDENTIAL_ERROR: Username atau password QRIS BCA salah' }
    }

    // Check: invalid_grant after date click (token expired) — re-login
    if (state.invalidGrant) {
      console.log('[QRIS BCA] 🚨 invalid_grant after date click — re-login')
      await dismissModal(page)
      await clearSession(channelId)  // Token sudah tidak valid, hapus session
      if (retryCount < MAX_RETRIES - 1) {
        state.invalidGrant = false
        const reLoginOk = await login(page, config.username, config.password, state, channelId)
        if (!reLoginOk) return { transactions: [], isLoggedIn: false, error: 'Re-login failed' }
        await page.waitForTimeout(300)
        return await attemptFetch(page, config, channelId, true, state, retryCount + 1)
      }
      return { transactions: [], isLoggedIn: false, error: 'invalid_grant' }
    }

    // Check: redirected to login page
    if (!dateClickOk && page.url().includes('login')) {
      console.log('[QRIS BCA] 🚨 Session expired — re-login')
      await clearSession(channelId)
      if (retryCount < MAX_RETRIES - 1) {
        const reLoginOk = await login(page, config.username, config.password, state, channelId)
        if (!reLoginOk) return { transactions: [], isLoggedIn: false, error: 'Re-login failed' }
        await page.waitForTimeout(300)
        return await attemptFetch(page, config, channelId, true, state, retryCount + 1)
      }
      return { transactions: [], isLoggedIn: false, error: 'Session expired' }
    }

    if (!dateClickOk) {
      console.log('[QRIS BCA] ⚠️ Date click failed, returning empty')
      return { transactions: [], isLoggedIn: true }
    }

    // ── Wait for table stability ───────────────────────────
    // HIGH mode: skip — clickTodayDate sudah tunggu table update via waitForFunction
    // LOW/MEDIUM: perlu konfirmasi ekstra sebelum scroll
    if (options.scroll !== false) {
      const stable = await waitForTableStable(page)
      if (!stable) {
        console.log('[QRIS BCA] Table not stable, waiting extra...')
        await page.waitForTimeout(500)
      }
    }

    // ── Scroll to load all lazy-loaded rows ────────────────
    if (options.scroll !== false) {
      await scrollToLoadAllTransactions(page)
    } else {
      console.log('[QRIS BCA] ⏭️ Scroll skipped (HIGH mode)')
    }


    // ── Parse transactions ─────────────────────────────────
    const transactions = await parseQrisTransactions(page)

    if (transactions === null) {
      console.log('[QRIS BCA] ⚠️ Parse failed')
      if (retryCount < MAX_RETRIES - 1) {
        await page.waitForTimeout(1000)
        return await attemptFetch(page, config, channelId, true, state, retryCount + 1, options)
      }
      return { transactions: [], isLoggedIn: true, error: 'Parse failed' }
    }

    console.log(`[QRIS BCA] ✅ ${transactions.length} transactions found`)
    return { transactions, isLoggedIn: true }

  } catch (error) {
    console.error(`[QRIS BCA] ❌ Error (attempt ${retryCount + 1}/${MAX_RETRIES}):`, error.message)

    // Check for invalid_grant in catch
    if (state.invalidGrant && retryCount < MAX_RETRIES - 1) {
      console.log('[QRIS BCA] 🔑 Re-login due to invalid_grant')
      await dismissModal(page)
      await clearSession(channelId)
      state.invalidGrant = false
      const reLoginOk = await login(page, config.username, config.password, state, channelId)
      if (!reLoginOk) return { transactions: [], isLoggedIn: false, error: 'Re-login failed' }
      await page.waitForTimeout(300)
      return await attemptFetch(page, config, channelId, true, state, retryCount + 1, options)
    }
    throw error
  }
}

async function login(page, username, password, state, channelId) {
  console.log('[QRIS BCA] Checking session validity...')

  // ── Session restore dari Redis ─────────────────────────────────
  // Optimasi: gabungkan restore + verifikasi dalam SATU goto(HOME_URL).
  // Sebelum: goto(LOGIN_URL) → set localStorage → goto(HOME_URL) = 2 round-trip BCA
  // Sekarang: restore cookies → goto(HOME_URL, commit) → set localStorage → wait Angular = 1 round-trip
  if (channelId) {
    try {
      const sessionData = await loadSession(channelId)
      if (sessionData) {
        // 1. Restore cookies terlebih dahulu (sebelum navigasi agar dikirim dengan request)
        if (sessionData.cookies?.length > 0) {
          await page.context().addCookies(sessionData.cookies)
        }

        // 2. Navigasi ke HOME_URL dengan 'commit' — hanya tunggu HTTP header (cepat)
        //    Cookies sudah di-set → BCA server terima session cookie
        await page.goto(HOME_URL, { waitUntil: 'commit', timeout: 15000 })

        // 3. Set localStorage SEGERA setelah commit, sebelum Angular jalankan kode
        //    Angular membaca localStorage saat bootstrap → token langsung tersedia
        if (sessionData.localStorage && Object.keys(sessionData.localStorage).length > 0) {
          await page.evaluate((ls) => {
            for (const [key, value] of Object.entries(ls)) {
              window.localStorage.setItem(key, value)
            }
          }, sessionData.localStorage).catch(() => {})
        }

        // 4. Tunggu Angular render tabel (verifikasi session valid)
        const finalUrl = await Promise.race([
          page.waitForURL('**/login**', { timeout: 10000 }).then(() => 'login'),
          page.waitForSelector('table.table.borderless.table-responsive', { timeout: 10000 }).then(() => 'home')
        ]).catch(() => page.url().includes('login') ? 'login' : 'unknown')

        if (finalUrl === 'home') {
          console.log('[QRIS BCA] ✅ Session restored from Redis — skipping credential login')
          return true
        }
        // Session tidak valid → hapus dan login ulang
        console.log('[QRIS BCA] ⚠️ Restored session expired — clearing and re-logging in')
        await clearSession(channelId)
      }
    } catch (restoreErr) {
      console.log(`[QRIS BCA] ⚠️ Session restore failed: ${restoreErr.message.split('\n')[0]}`)
    }
  }

  // ── Session check via HOME_URL (browser masih hidup, tidak restart) ─────
  try {
    if (!page.url().includes('home')) {
      await page.goto(HOME_URL, { waitUntil: 'domcontentloaded', timeout: 10000 })
    }
    const finalUrl = await Promise.race([
      page.waitForURL('**/login**', { timeout: 5000 }).then(() => 'login'),
      page.waitForSelector('table.table.borderless.table-responsive', { timeout: 5000 }).then(() => 'home')
    ]).catch(() => page.url().includes('login') ? 'login' : 'unknown')

    if (finalUrl === 'home') {
      console.log('[QRIS BCA] ✅ Session still valid — skipping credential login')
      return true
    }
  } catch (sessionCheckErr) {
    console.log(`[QRIS BCA] ⚠️ Session check failed (${sessionCheckErr.message.split('\n')[0]}) — proceeding to credential login`)
  }

  // ── Credential login ────────────────────────────────────────────
  try {
    // Cek apakah email input sudah ada (mungkin loadSession sudah navigate ke LOGIN_URL)
    const emailInputExists = await page.$('input[type="email"]').catch(() => null)

    if (emailInputExists) {
      console.log('[QRIS BCA] Session expired or not logged in — login form already loaded')
    } else {
      // Selalu navigate ke LOGIN_URL eksplisit untuk state bersih.
      // Penting setelah invalid_grant/8jam expiry — BCA SPA bisa di state aneh.
      console.log('[QRIS BCA] Session expired or not logged in — navigating to login...')
      await page.goto(LOGIN_URL, { waitUntil: 'commit', timeout: 20000 })
    }

    // Beri Angular lebih banyak waktu — BCA server lambat setelah session hard-expired
    await page.waitForSelector('input[type="email"]', { timeout: 30000 })

    await page.fill('input[type="email"]', username)
    await page.fill('input[type="password"]', password)
    await page.waitForTimeout(300)  // Beri Angular waktu untuk enable tombol submit

    // ── Dismiss cookie-law banner ────────────────────────────────
    // JANGAN klik a/button di dalamnya — bisa navigasi ke halaman T&C!
    // Cukup force-remove dari DOM agar tidak blokir pointer events.
    const cookieDismissed = await page.evaluate(() => {
      const cookieLaw = document.querySelector('cookie-law')
      if (cookieLaw) {
        cookieLaw.style.cssText = 'display:none!important;pointer-events:none!important;'
        return true
      }
      return false
    }).catch(() => false)
    if (cookieDismissed) {
      console.log('[QRIS BCA] 🍪 Cookie banner hidden')
      await page.waitForTimeout(100)
    }

    // Klik submit via page.evaluate() — bypass pointer-events interceptors.
    // Button: <button type="submit" class="btn btn-test btn-block"> Masuk </button>
    // Catatan: console.log di dalam evaluate() masuk browser console, bukan Node terminal.
    const btnText = await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"]')
        || document.querySelector('button.btn-block')
        || [...document.querySelectorAll('button')].find(b => {
          const t = b.textContent.trim().toLowerCase()
          return t === 'masuk' || t.includes('masuk') || t.includes('login')
        })
      if (btn) { btn.click(); return btn.textContent.trim() }
      // Return list of all buttons for debugging
      return 'NOT_FOUND:' + [...document.querySelectorAll('button')].map(b => b.className + '|' + b.type).join(', ')
    }).catch(e => 'ERROR:' + e.message)

    if (!btnText || btnText.startsWith('NOT_FOUND') || btnText.startsWith('ERROR')) {
      console.log(`[QRIS BCA] ❌ Cannot find Masuk button — debug: ${btnText}`)
      return false
    }
    console.log(`[QRIS BCA] 🔘 Clicked: "${btnText}" — waiting for dashboard...`)




    // Tunggu sinyal positif dari SPA setelah klik Masuk.
    // JANGAN pakai waitForURL('**/login**') — itu langsung resolve karena
    // kita masih di /login saat race dimulai (false positive).
    const credentialErrorSignal = new Promise((resolve) => {
      if (state?.credentialError) { resolve('credential_error'); return }
      const prevResolver = state?.invalidGrantResolver
      if (state) {
        state.invalidGrantResolver = (result) => {
          if (result === 'credential_error') resolve('credential_error')
          else if (prevResolver) prevResolver(result)
        }
      }
      setTimeout(() => resolve('timeout'), 20000)
    })

    const outcome = await Promise.race([
      page.waitForSelector('app-homescreen', { timeout: 20000 }).then(() => 'homescreen'),
      page.waitForSelector('table.table.borderless.table-responsive', { timeout: 20000 }).then(() => 'table'),
      credentialErrorSignal
    ]).catch(() => 'timeout')

    if (state?.invalidGrantResolver) state.invalidGrantResolver = null

    console.log(`[QRIS BCA] Login outcome: ${outcome} (URL: ${page.url()})`)

    if (outcome === 'credential_error') {
      await page.evaluate(() => window.stop?.()).catch(() => { })
      return false
    }

    if (outcome === 'homescreen' || outcome === 'table') {
      console.log('[QRIS BCA] ✅ Login successful')
      // Simpan session ke Redis agar bisa di-restore saat scraper restart
      if (channelId) await saveSession(channelId, page)
      return true
    }

    // timeout — cek URL sekarang untuk tentukan berhasil/gagal
    const currentUrl = page.url()
    if (currentUrl.includes('home')) {
      console.log('[QRIS BCA] ✅ Login successful (URL at home after timeout)')
      if (channelId) await saveSession(channelId, page)
      return true
    }

    console.log(`[QRIS BCA] ❌ Login failed: dashboard not loaded (URL: ${currentUrl})`)
    return false


  } catch (error) {
    if (state?.credentialError) return false
    console.error('[QRIS BCA] Login error:', error.message)
    return false
  }
}


// ── Navigate to Home ───────────────────────────────────────

async function navigateToHome(page, options = {}, state = null) {
  try {
    const ps = getPageState(page)
    const today = getCurrentWIBDate()
    const dateChanged = ps.lastReloadDate !== null && ps.lastReloadDate !== today
    const needsScroll = options.scroll !== false

    if (dateChanged) {
      console.log(`[QRIS BCA] 🌙 Tanggal berganti! ${ps.lastReloadDate} → ${today} — force reload kalender`)
    }

    if (!page.url().includes('home')) {
      // Navigasi fresh ke home → scroll container sudah siap
      await page.goto(HOME_URL, { waitUntil: 'commit', timeout: 30000 })
      ps.lastReloadDate = today
      console.log(`[QRIS BCA] 📅 lastReloadDate set: ${today}`)
    } else if (dateChanged) {
      // Sudah di home, tapi tanggal berubah → reload agar kalender refresh
      console.log('[QRIS BCA] 🔄 Force reload halaman untuk kalender baru...')
      await page.reload({ waitUntil: 'commit', timeout: 30000 })
      ps.lastReloadDate = today
      console.log(`[QRIS BCA] 📅 lastReloadDate updated: ${today}`)
    } else if (ps.lastReloadDate === null) {
      // Pertama kali set tanggal
      ps.lastReloadDate = today
      console.log(`[QRIS BCA] 📅 lastReloadDate init: ${today}`)
    } else if (needsScroll) {
      // Sudah di home, tanggal sama, tapi MEDIUM/LOW butuh scroll
      // → BCA SPA perlu reload agar scroll container ter-inisialisasi
      console.log('[QRIS BCA] 🔄 Force reload untuk init scroll container (MEDIUM/LOW)...')
      await page.reload({ waitUntil: 'commit', timeout: 30000 })
    }

    if (page.url().includes('login')) {
      console.log('[QRIS BCA] Redirected to login page, session expired')
      return false
    }

    // Two-stage wait: Angular SPA root → then the table.
    // 'commit' only waits for HTTP headers — the SPA still needs to bootstrap.
    // Waiting for app-homescreen first gives Angular time to mount before we look for the table.
    await page.waitForSelector('app-homescreen', { timeout: 20000 }).catch(() => {
      // Not fatal — some SPA versions don't use app-homescreen wrapper; fall through to table wait
    })

    // ── Dismiss modal yang muncul saat home load (token expired / koneksi putus) ──
    // BCA SPA menampilkan modal-container saat token habis atau ada error API,
    // SEBELUM table ter-render. Harus dismiss dulu agar table bisa muncul.
    const hasModal = await page.evaluate(() => {
      const modal = document.querySelector('modal-container')
      return modal && modal.style.display !== 'none' && modal.innerText.trim().length > 0
    }).catch(() => false)

    if (hasModal) {
      console.log('[QRIS BCA] ⚠️ Modal detected on home page — dismissing before table wait...')
      await page.click('modal-container button.btn-transparent').catch(() => { })
      await page.waitForFunction(() => {
        const modal = document.querySelector('modal-container')
        return !modal || modal.style.display === 'none' || !document.body.contains(modal)
      }, { timeout: 3000 }).catch(() => { })
      await page.waitForTimeout(200)

      // Setelah dismiss: cek apakah ini karena token expired (invalid_grant)
      // Token interceptor sudah set state.invalidGrant sebelum modal muncul
      if (state?.invalidGrant) {
        console.log('[QRIS BCA] 🚨 Modal was token-expired — signalling re-login')
        return false // attemptFetch akan handle re-login
      }
      if (state?.credentialError) {
        console.log('[QRIS BCA] 🚨 Modal was credential error')
        return false
      }
      console.log('[QRIS BCA] ✅ Modal dismissed (connection error / recoverable)')
    }

    // After Angular root is up (and any modal is gone), the table should appear quickly
    await page.waitForSelector('table.table.borderless.table-responsive', { timeout: 20000 })
    console.log('[QRIS BCA] ✅ Home page loaded')
    return true
  } catch (error) {
    console.error('[QRIS BCA] Navigation error:', error.message)
    if (page.url().includes('login')) return false
    return false
  }
}

// ── Click Today's Date Button ──────────────────────────────
async function clickTodayDate(page, state) {
  try {
    // Dismiss any existing modal first
    await dismissModalIfPresent(page, state)
    if (state.invalidGrant || page.url().includes('login')) return false

    // Find today's highlighted date button
    const dateButton = await page.waitForSelector('.weekdays li button.highlight', { timeout: 8000 })
      .catch(() => null)

    if (!dateButton) {
      console.log('[QRIS BCA] Date button not found')
      if (page.url().includes('login')) return false
      return false
    }

    // Capture current table state before clicking
    const oldRowCount = await page.evaluate(() => {
      const rows = document.querySelectorAll('table.table.borderless.table-responsive tbody tr.table-active')
      return rows.length
    })

    await dateButton.click()
    console.log('[QRIS BCA] Date button clicked (today)')

    // Wait for table update OR invalid_grant (whichever comes first)
    const waitForTable = page.waitForFunction((oldCount) => {
      const table = document.querySelector('table.table.borderless.table-responsive')
      if (!table) return false
      const tbody = table.querySelector('tbody')
      if (!tbody) return false

      const currentRows = tbody.querySelectorAll('tr.table-active').length
      const hasNoTransMsg = tbody.textContent.includes('Transaksi tidak ada')

      if (hasNoTransMsg) return true
      if (currentRows !== oldCount && currentRows > 0) {
        const firstRow = tbody.querySelector('tr.table-active')
        const refSpan = firstRow?.querySelector('.reference-number')
        return refSpan?.textContent.includes('RRN:')
      }
      return false
    }, { timeout: 3000 }, oldRowCount).catch(() => false)

    // Instant invalid_grant detection via promise
    const checkInvalidGrant = new Promise((resolve) => {
      if (state.invalidGrant) { resolve('invalid_grant'); return }
      state.invalidGrantResolver = resolve
      setTimeout(() => {
        if (state.invalidGrantResolver === resolve) {
          state.invalidGrantResolver = null
          resolve('timeout')
        }
      }, 3000)
    })

    const result = await Promise.race([
      waitForTable.then(() => 'table_updated'),
      checkInvalidGrant
    ])

    // Cleanup resolver
    if (state.invalidGrantResolver) { state.invalidGrantResolver = null }

    if (result === 'invalid_grant') {
      console.log('[QRIS BCA] ⚠️ invalid_grant during date click')
      return false
    }

    await page.waitForTimeout(100)
    console.log('[QRIS BCA] ✅ Table updated')
    return true
  } catch (error) {
    console.error('[QRIS BCA] Date click error:', error.message)
    if (state.invalidGrantResolver) { state.invalidGrantResolver = null }
    return false
  }
}

// ── Scroll to load all lazy-loaded transactions ─────────────
// 1. Read totalTransactions from DOM summary to know exactly how many scrolls are needed
// 2. For each scroll, scroll the Angular scroll container (not window) and wait for API response
// 3. If first scroll times out (container not ready), reload page and retry once
async function scrollToLoadAllTransactions(page) {
  try {
    // ── Step 1: Read total transaction count from DOM summary ──
    const totalTransactions = await page.evaluate(() => {
      const allEls = document.querySelectorAll('*')
      for (const el of allEls) {
        const text = el.textContent.trim()
        if (text.includes('TOTAL TRANSAKSI') && text.includes('(')) {
          const m = text.match(/\(\s*(\d+)\s*\)/)
          if (m) return parseInt(m[1])
        }
      }
      return 0
    })

    const currentlyLoaded = await page.evaluate(() =>
      document.querySelectorAll('table.table.borderless.table-responsive tbody tr.table-active').length
    )

    if (totalTransactions <= currentlyLoaded || currentlyLoaded === 0) {
      console.log(`[QRIS BCA] 📜 Scroll not needed — ${currentlyLoaded}/${totalTransactions} loaded`)
      return
    }

    const remainingNeeded = totalTransactions - currentlyLoaded
    const scrollsNeeded = Math.ceil(remainingNeeded / 10)
    console.log(`[QRIS BCA] 📜 Need ${scrollsNeeded} scroll(s) for ${remainingNeeded} remaining transactions`)

    // ── Step 2: Scroll the correct Angular scroll container ──
    for (let i = 0; i < scrollsNeeded; i++) {
      console.log(`[QRIS BCA] 📜 Scroll ${i + 1}/${scrollsNeeded}...`)

      // Set up API listener BEFORE scrolling
      const apiResponsePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Scroll API timeout')), 8000)
        const handler = (response) => {
          const url = response.url()
          if (url.includes('/transaction-v2/') && url.includes('/list')) {
            clearTimeout(timeout)
            page.off('response', handler)
            resolve(response)
          }
        }
        page.on('response', handler)
      })

      // Scroll the Angular scroll container (not window).
      // BCA SPA listens to scroll events on an overflow container, not on window.
      await page.evaluate(() => {
        // Find the nearest scrollable ancestor of the transaction table
        const table = document.querySelector('table.table.borderless.table-responsive')
        let container = table?.parentElement
        while (container && container !== document.body) {
          const { overflowY } = window.getComputedStyle(container)
          if (overflowY === 'auto' || overflowY === 'scroll') break
          container = container.parentElement
        }
        const target = (container && container !== document.body) ? container : document.documentElement

        // Scroll to bottom and dispatch events
        target.scrollTop = target.scrollHeight
        target.dispatchEvent(new Event('scroll', { bubbles: true }))

        // Also scroll window as fallback
        window.scrollTo(0, document.body.scrollHeight)
        window.dispatchEvent(new Event('scroll', { bubbles: true }))
      })
      // Physical wheel event on the table for Angular IntersectionObserver triggers
      await page.mouse.wheel(0, 3000)

      // Wait for API response
      try {
        const response = await apiResponsePromise
        if (response.status() === 200) {
          await page.waitForTimeout(800) // Let Angular render the new rows
          console.log(`[QRIS BCA] 📜 Scroll ${i + 1} — data loaded`)
        } else {
          console.log(`[QRIS BCA] ⚠️ Scroll ${i + 1} — API returned ${response.status()}, stopping`)
          break
        }
      } catch (scrollErr) {
        console.log(`[QRIS BCA] ⚠️ Scroll ${i + 1} — timeout, stopping`)
        break
      }
    }

    const finalCount = await page.evaluate(() =>
      document.querySelectorAll('table.table.borderless.table-responsive tbody tr.table-active').length
    )
    console.log(`[QRIS BCA] 📜 Scroll complete — ${finalCount}/${totalTransactions} rows visible`)
  } catch (err) {
    console.error('[QRIS BCA] Scroll error:', err.message)
  }
}

// ── Wait for Table Stability ───────────────────────────────
async function waitForTableStable(page) {
  try {
    const isStable = await page.waitForFunction(() => {
      const table = document.querySelector('table.table.borderless.table-responsive')
      if (!table) return false
      const tbody = table.querySelector('tbody')
      if (!tbody) return false

      const hasNoTransMsg = tbody.textContent.includes('Transaksi tidak ada')
      if (hasNoTransMsg) return true

      const rows = tbody.querySelectorAll('tr.table-active')
      if (rows.length === 0) return false

      const firstRow = rows[0]
      const refSpan = firstRow.querySelector('.reference-number')
      if (!refSpan) return false
      return refSpan.textContent.trim().includes('RRN:')
    }, { timeout: 8000 }).then(() => true).catch(() => false)

    if (isStable) console.log('[QRIS BCA] ✅ Table stable')
    else console.log('[QRIS BCA] ⚠️ Table stability timeout')
    return isStable
  } catch {
    return false
  }
}

// ── Parse Transaction Table ────────────────────────────────
async function parseQrisTransactions(page) {
  try {
    // Check table exists
    const tableExists = await page.evaluate(() =>
      !!document.querySelector('table.table.borderless.table-responsive')
    )
    if (!tableExists) {
      console.log('[QRIS BCA] ⚠️ Transaction table not found')
      return null
    }

    // Check for empty state
    const noTransaction = await page.evaluate(() => {
      const table = document.querySelector('table.table.borderless.table-responsive')
      return table?.textContent?.includes('Transaksi tidak ada') ?? true
    })
    if (noTransaction) {
      console.log('[QRIS BCA] ℹ️ No transactions (empty state)')
      return []
    }

    // Parse transaction rows
    const transactions = await page.evaluate(() => {
      const rows = document.querySelectorAll('table.table.borderless.table-responsive tbody tr.table-active')
      const results = []

      rows.forEach((row, index) => {
        try {
          // ── Reference number + time ──
          const refSpan = row.querySelector('.reference-number')
          if (!refSpan) return
          const refText = refSpan.textContent.trim()
          if (!refText) return

          const rrnMatch = refText.match(/RRN:\s*(\w+)/)
          const timeMatch = refText.match(/(\d{2}\.\d{2})\s*WIB/)

          // ── Merchant name + NMID ──
          const merchantSpan = row.querySelector('.text-primary strong')
          const merchantText = merchantSpan ? merchantSpan.textContent.trim() : ''
          const nmidMatch = merchantText.match(/NMID:\s*([\w]+)/)
          const merchantName = merchantText.replace(/\(NMID:.*?\)/, '').trim()

          // ── Payer info ──
          const detailP = row.querySelector('.font-size-detail-trx')
          const detailText = detailP ? detailP.textContent.trim() : ''
          const payerMatch = detailText.match(/dari\s+(.+?)\s+a\.n\.\s*(.+)/)
          const payerBank = payerMatch ? payerMatch[1].trim() : ''
          const payerName = payerMatch ? payerMatch[2].trim() : ''

          // ── Amount ──
          const amountH4 = row.querySelector('td.text-right h4')
          const amountText = amountH4 ? amountH4.textContent.trim() : ''
          const amountMatch = amountText.match(/Rp\s*([\d.,]+)/)
          const amountStr = amountMatch ? amountMatch[1].replace(/\./g, '').replace(',', '.') : '0'
          const amount = parseFloat(amountStr)

          const isIncome = amountText.includes('+')
          if (!isIncome || amount <= 0) return // Only income transactions

          const rrn = rrnMatch ? rrnMatch[1] : ''
          const time = timeMatch ? timeMatch[1].replace('.', ':') : ''

          results.push({
            reference_number: rrn,
            date: time,
            amount,
            description: `${merchantName} dari ${payerBank} a.n. ${payerName}`,
            payer_name: payerName,
            payer_bank: payerBank,
            merchant_name: merchantName,
            nmid: nmidMatch ? nmidMatch[1] : '',
            type: 'credit',
            raw: refText
          })
        } catch (err) {
          console.error(`[QRIS BCA] Row ${index} parse error:`, err)
        }
      })

      return results
    })

    console.log(`[QRIS BCA] ✅ Parsed ${transactions.length} transactions`)
    return transactions
  } catch (error) {
    console.error('[QRIS BCA] ❌ Parse error:', error.message)
    return null
  }
}

// ── Helpers ────────────────────────────────────────────────
async function dismissModalIfPresent(page, state) {
  const hasModal = await page.evaluate(() => {
    const modal = document.querySelector('modal-container')
    return modal && modal.style.display !== 'none'
  }).catch(() => false)

  if (hasModal) {
    console.log('[QRIS BCA] ⚠️ Dismissing modal...')
    await dismissModal(page)
    await page.waitForTimeout(100)
  }
}

async function dismissModal(page) {
  await page.click('modal-container button.btn-transparent').catch(() => { })
  await page.waitForFunction(() => {
    const modal = document.querySelector('modal-container')
    return !modal || modal.style.display === 'none' || !document.body.contains(modal)
  }, { timeout: 1000 }).catch(() => { })
}
