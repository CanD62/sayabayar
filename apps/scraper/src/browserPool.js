// apps/scraper/src/browserPool.js
// Manages Playwright browser instances per channel — TRUE STANDBY mode
// ─ Browser + Context + Main Page stay alive
// ─ Main page keeps the login session (BCA uses framesets)
// ─ Only mutation popup pages are opened/closed per scrape
// ─ Cookie persistence to Redis for session restore

import { chromium } from 'playwright'
import { setSessionStatus, clearSessionStatus } from './sessionStore.js'
import { clearPageState } from './scrapers/qrisBca.js'

const BROWSER_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-web-security',
  '--disable-features=VizDisplayCompositor',
  '--disable-extensions',
  '--disable-plugins',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage'
]

/**
 * @typedef {Object} PoolSession
 * @property {import('playwright').Browser} browser
 * @property {import('playwright').BrowserContext} context
 * @property {import('playwright').Page} mainPage - stays alive for session
 * @property {boolean} isLoggedIn
 * @property {number} lastUsed
 * @property {number} loginAt
 */

class BrowserPool {
  constructor(maxBrowsers = 20) {
    /** @type {Map<string, PoolSession>} */
    this.pool = new Map()
    this.maxBrowsers = maxBrowsers
    this.cleanupInterval = null
  }

  /**
   * Get or create browser session for a channel.
   * Returns { context, mainPage, isLoggedIn }
   * The mainPage stays alive between scrapes to keep BCA session.
   */
  async getSession(channelId) {
    let session = this.pool.get(channelId)

    if (session) {
      // Verify browser + mainPage are still alive
      try {
        await session.mainPage.evaluate(() => true)
        session.lastUsed = Date.now()
        return session
      } catch {
        console.log(`[BrowserPool] Session ${channelId} is dead, recreating`)
        await this.destroySession(channelId)
      }
    }

    // Evict oldest if at capacity
    if (this.pool.size >= this.maxBrowsers) {
      await this.evictOldest()
    }

    return this.createSession(channelId)
  }

  /**
   * Create a new browser + context + main page
   */
  async createSession(channelId) {
    const browser = await chromium.launch({
      headless: true,
      args: BROWSER_ARGS
    })

    const context = await browser.newContext({
      bypassCSP: true,
      ignoreHTTPSErrors: true,
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
      }
    })

    // Main page — stays alive to keep session
    const mainPage = await context.newPage()
    mainPage.setDefaultNavigationTimeout(15000)
    mainPage.setDefaultTimeout(5000)

    const session = {
      browser,
      context,
      mainPage,
      isLoggedIn: false,
      lastUsed: Date.now(),
      loginAt: 0
    }

    this.pool.set(channelId, session)
    console.log(`[BrowserPool] Created session for ${channelId} (pool: ${this.pool.size}/${this.maxBrowsers})`)
    return session
  }

  /**
   * Restore session from saved cookies
   */
  async restoreSession(channelId, cookies) {
    const session = this.pool.get(channelId)
    if (session && cookies && cookies.length > 0) {
      await session.context.addCookies(cookies)
      console.log(`[BrowserPool] Restored ${cookies.length} cookies for ${channelId}`)
    }
  }

  /**
   * Save current cookies for session persistence
   */
  async saveCookies(channelId) {
    const session = this.pool.get(channelId)
    if (session) {
      return await session.context.cookies()
    }
    return []
  }

  /**
   * Mark session as logged in + sync to Redis
   */
  async setLoggedIn(channelId, loggedIn) {
    const session = this.pool.get(channelId)
    if (session) {
      session.isLoggedIn = loggedIn
      if (loggedIn) session.loginAt = Date.now()
    }
    await setSessionStatus(channelId, loggedIn).catch(() => { })
  }

  /**
   * Force logout: navigate to bank logout URL + clear cookies
   * Keeps browser alive — next scrape will re-login
   */
  async forceLogout(channelId) {
    const session = this.pool.get(channelId)
    if (session) {
      try {
        const url = session.mainPage.url()
        if (url && url.includes('qr.klikbca.com')) {
          // QRIS BCA — Angular SPA: token disimpan di localStorage
          console.log(`[BrowserPool] Logging out QRIS BCA: ${channelId}...`)
          await session.mainPage.evaluate(() => {
            localStorage.clear()
            sessionStorage.clear()
          }).catch(() => { })
          await session.mainPage.goto('https://qr.klikbca.com/QRMerchantService/v2.10/login', { timeout: 5000 }).catch(() => { })
          await session.mainPage.waitForTimeout(500).catch(() => { })
        } else if (url && url.includes('ibank.klikbca.com')) {
          // KlikBCA Internet Banking
          console.log(`[BrowserPool] Logging out BCA: ${channelId}...`)
          await session.mainPage.goto(
            'https://ibank.klikbca.com/authentication.do?value(actions)=logout',
            { timeout: 5000 }
          ).catch(() => { })
          await session.mainPage.waitForTimeout(500).catch(() => { })
        }
      } catch { /* page might be crashed */ }

      await session.context.clearCookies().catch(() => { })
      session.isLoggedIn = false
      session.loginAt = 0
      await setSessionStatus(channelId, false).catch(() => { })
      console.log(`[BrowserPool] ✅ Force logout: ${channelId}`)
    }
  }

  /**
   * Destroy session completely — logout from bank + kill browser
   */
  async destroySession(channelId) {
    const session = this.pool.get(channelId)
    if (session) {
      try {
        if (session.mainPage) {
          try {
            const url = session.mainPage.url()
            if (url && url.includes('qr.klikbca.com')) {
              // QRIS BCA — navigate to login page (clears Angular SPA state)
              console.log(`[BrowserPool] Logging out QRIS BCA: ${channelId}...`)
              await session.mainPage.goto(
                'https://qr.klikbca.com/QRMerchantService/v2.10/login',
                { timeout: 5000 }
              ).catch(() => { })
              await session.mainPage.waitForTimeout(500).catch(() => { })
              console.log(`[BrowserPool] ✅ QRIS BCA logged out: ${channelId}`)
            } else if (url && url.includes('ibank.klikbca.com')) {
              // KlikBCA Internet Banking
              console.log(`[BrowserPool] Logging out BCA: ${channelId}...`)
              await session.mainPage.goto(
                'https://ibank.klikbca.com/authentication.do?value(actions)=logout',
                { timeout: 5000 }
              ).catch(() => { })
              await session.mainPage.waitForTimeout(500).catch(() => { })
              console.log(`[BrowserPool] ✅ BCA logged out: ${channelId}`)
            }
          } catch { /* page might be crashed */ }
        }

        // Clear QRIS page state (WeakMap cleanup)
        if (session.mainPage) {
          clearPageState(session.mainPage)
        }

        await session.mainPage?.close().catch(() => { })
        await session.context?.close().catch(() => { })
        await session.browser?.close().catch(() => { })
      } catch { /* ignore */ }
      this.pool.delete(channelId)
      await clearSessionStatus(channelId).catch(() => { })
      console.log(`[BrowserPool] Destroyed session: ${channelId}`)
    }
  }

  /**
   * Evict the least recently used session
   */
  async evictOldest() {
    let oldest = null, oldestId = null
    for (const [id, session] of this.pool) {
      if (!oldest || session.lastUsed < oldest.lastUsed) {
        oldest = session
        oldestId = id
      }
    }
    if (oldestId) {
      console.log(`[BrowserPool] Evicting oldest: ${oldestId}`)
      await this.destroySession(oldestId)
    }
  }

  /**
   * Start periodic cleanup of stale sessions (> 1h inactive)
   */
  startCleanup(intervalMs = 15 * 60_000) {
    this.cleanupInterval = setInterval(async () => {
      const cutoff = Date.now() - 60 * 60_000 // 1 hour idle
      for (const [id, session] of this.pool) {
        if (session.lastUsed < cutoff) {
          console.log(`[BrowserPool] Cleaning stale session: ${id}`)
          await this.destroySession(id)
        }
      }
    }, intervalMs)
  }

  /**
   * Shutdown all sessions — destroySession handles logout + close
   */
  async shutdown() {
    if (this.cleanupInterval) clearInterval(this.cleanupInterval)

    const ids = [...this.pool.keys()]
    console.log(`[BrowserPool] Shutting down ${ids.length} session(s)...`)

    for (const id of ids) {
      await this.destroySession(id)
    }

    console.log('[BrowserPool] All sessions logged out and closed')
  }

  get size() { return this.pool.size }
}

export const browserPool = new BrowserPool(parseInt(process.env.MAX_BROWSERS || '20'))
