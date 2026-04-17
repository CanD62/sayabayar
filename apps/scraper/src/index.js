// apps/scraper/src/index.js
// Entry point — Scraper Service

import { getDb, disconnectDb } from '@payment-gateway/shared/db'
import { browserPool } from './browserPool.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { scrapeQueue } from './queues.js'
import { startScrapeWorker } from './workers/scrapeWorker.js'
import { startMatchWorker } from './workers/matchWorker.js'
import { startWebhookWorker } from './workers/webhookWorker.js'
import { startSettlementWorker, stopSettlementWorker } from './workers/settlementWorker.js'
import { startFlipWorker } from './workers/flipWorker.js'
import { startFlipStatusWorker, stopFlipStatusWorker } from './workers/flipStatusWorker.js'
import { closeBrowser as closeFlipBrowser, activateAlaflip } from './scrapers/flipBrowser.js'
import { closeSessionStore } from './sessionStore.js'
import { createServer } from 'http'
import { decrypt } from '@payment-gateway/shared/crypto'
import { scrapeQrisBca } from './scrapers/qrisBca.js'
import { scrapeBcaTransfer } from './scrapers/bcaTransfer.js'

console.log('🔍 Starting Scraper Service...')

// ── Validate DB connection ────────────────────────────────
const db = getDb()
await db.$connect()
console.log('✅ Database connected')

// ── Fresh start: reset all sessions & schedules ───────────
const activeChannels = await db.paymentChannel.findMany({
  where: { isActive: true },
  select: { id: true, accountName: true }
})

if (activeChannels.length > 0) {
  // Reset nextScrapeAt → scrape immediately
  // Retry up to 5x with backoff — previous process may still hold a DB lock on restart
  let resetOk = false
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await db.channelState.updateMany({
        where: { channelId: { in: activeChannels.map(c => c.id) } },
        data: { nextScrapeAt: new Date(Date.now() + 5_000) }
      })
      console.log(`🔄 Reset ${activeChannels.length} channel(s) — will scrape in 5s`)
      resetOk = true
      break
    } catch (err) {
      const isLockTimeout = err.message?.includes('Lock wait timeout') || err.message?.includes('1205')
      if (isLockTimeout && attempt < 5) {
        const delay = attempt * 1000
        console.warn(`⚠️  channelState lock timeout (attempt ${attempt}/5) — retrying in ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      } else {
        console.error('❌ Failed to reset channelState after retries:', err.message)
        // Non-fatal: scheduler will still pick up channels on their existing nextScrapeAt
        break
      }
    }
  }
  if (!resetOk) {
    console.warn('⚠️  channelState reset skipped — channels will scrape on their existing schedule')
  }

  // ── Clear stale BullMQ jobs so scheduler can add fresh ones ──
  // Setelah restart, job lama (active/waiting/delayed) masih ada di Redis.
  // Drain semua waiting/delayed jobs agar scheduler bisa add fresh ones.
  try {
    const drained = await scrapeQueue.drain()
    console.log('🧹 Drained stale BullMQ scrape jobs')
  } catch {}
}

// ── Start browser pool cleanup ────────────────────────────
browserPool.startCleanup()
console.log('✅ Browser pool initialized')

// ── Start workers ─────────────────────────────────────────
const concurrency = parseInt(process.env.SCRAPER_CONCURRENCY || '5')
const scrapeWorker = startScrapeWorker(concurrency)
const matchWorker = startMatchWorker(concurrency)
const webhookWorker = startWebhookWorker(3)
const flipWorker = startFlipWorker()         // concurrency=1, sequential

// ── Start settlement worker ───────────────────────────────
// Settles pending balances every 5 minutes
startSettlementWorker() // default: 30s (dev)
startFlipStatusWorker() // check Flip status every 10s

// ── Start scheduler ───────────────────────────────────────
startScheduler(5000)

console.log('🚀 Scraper Service running!')
console.log(`   Workers: scrape(${concurrency}), match(${concurrency}), webhook(3), flip(1), flipStatus(cron)`)
console.log(`   Browser pool max: ${process.env.MAX_BROWSERS || 20}`)

// ── Graceful Shutdown ─────────────────────────────────────
let isShuttingDown = false
export function isShutdown() { return isShuttingDown }

const shutdown = async (signal) => {
  if (isShuttingDown) return  // Prevent double shutdown
  isShuttingDown = true

  console.log(`\n${signal} received — shutting down scraper...`)

  stopScheduler()

  // Close workers first (stop accepting jobs)
  await scrapeWorker.close().catch(() => { })
  await matchWorker.close().catch(() => { })
  await webhookWorker.close().catch(() => { })
  await flipWorker.close().catch(() => { })
  // await alaflipWorker.close().catch(() => { })
  stopSettlementWorker()
  stopFlipStatusWorker()

  // Logout from banks + close browsers
  await browserPool.shutdown()
  await closeFlipBrowser().catch(() => { })

  // Cleanup Redis session store
  await closeSessionStore().catch(() => { })

  // Disconnect DB
  await disconnectDb().catch(() => { })

  console.log('Scraper service stopped.')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ── Test HTTP server (dev/debug) ───────────────────────────

const SCRAPERS = { qris_bca: scrapeQrisBca, bca_transfer: scrapeBcaTransfer }
const SCRAPER_PORT = parseInt(process.env.SCRAPER_PORT || '3008')


const testServer = createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://localhost`)
  const path = urlObj.pathname
  const method = req.method

  // ── POST /pre-deploy ───────────────────────────────────
  // Dipanggil oleh Drone CI SEBELUM docker stop
  // Logout semua bank session agar container baru bisa login fresh
  if (path === '/pre-deploy' && method === 'POST') {
    console.log('[PreDeploy] 🔄 Logging out all bank sessions before deploy...')
    const start = Date.now()
    try {
      // Stop scheduler dulu agar tidak ada job baru
      stopScheduler()

      // Close workers (stop processing jobs)
      await scrapeWorker.close().catch(() => { })
      await matchWorker.close().catch(() => { })

      // Logout semua browser session (BCA, QRIS BCA, dll)
      await browserPool.shutdown()
      await closeFlipBrowser().catch(() => { })

      const elapsed_ms = Date.now() - start
      console.log(`[PreDeploy] ✅ All sessions logged out (${elapsed_ms}ms)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, elapsed_ms, message: 'All sessions logged out' }))
    } catch (err) {
      console.error('[PreDeploy] ❌ Error during pre-deploy:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: false, error: err.message }))
    }
    return
  }

  // ── GET /health ────────────────────────────────────────
  if (path === '/health' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ status: 'ok', sessions: browserPool.size }))
    return
  }

  // ── POST /alaflip-activate ─────────────────────────────
  // Dipanggil oleh admin.js untuk trigger aktivasi Alaflip manual
  if (path === '/alaflip-activate' && method === 'POST') {
    try {
      // Baca body JSON
      const body = await new Promise((resolve, reject) => {
        let data = ''
        req.on('data', chunk => data += chunk)
        req.on('end', () => { try { resolve(JSON.parse(data || '{}')) } catch { resolve({}) } })
        req.on('error', reject)
      })

      const { webviewUrl, wvHeaders, userId, flipToken, deviceId } = body
      if (!webviewUrl) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'webviewUrl wajib diisi' }))
        return
      }

      // Ambil PIN dari DB
      const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
      if (!provider) { res.writeHead(400).end(JSON.stringify({ error: 'Provider tidak ditemukan' })); return }

      const pin = decrypt(provider.pin)

      console.log('[ScraperHTTP] Memulai aktivasi Alaflip via Playwright...')
      const start = Date.now()

      // Step 1: Buka browser, input PIN, capture OAuth code
      const oauthCode = await activateAlaflip(webviewUrl, pin, wvHeaders || {})
      console.log(`[ScraperHTTP] OAuth code captured (${oauthCode.length} chars)`)

      // Step 2: POST auth-code ke Flip API
      const authCodeRes = await fetch(
        `https://customer.flip.id/alaflip/api/v1/users/${userId}/auth-code`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${flipToken}`,
            'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
            'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
            ...(deviceId ? { 'x-device-id': deviceId } : {}),
            'content-type': 'application/json',
            'accept-language': 'en-ID',
            'User-Agent': 'okhttp/4.10.0',
          },
          body: JSON.stringify({ auth_code: oauthCode })
        }
      )
      const authCodeBody = await authCodeRes.json().catch(() => ({}))
      console.log(`[ScraperHTTP] auth-code response: ${authCodeRes.status}`, JSON.stringify(authCodeBody))

      if (!authCodeRes.ok) {
        throw new Error(`auth-code gagal (${authCodeRes.status}): ${authCodeBody?.error?.message || JSON.stringify(authCodeBody)}`)
      }

      const elapsed_ms = Date.now() - start
      console.log(`[ScraperHTTP] Aktivasi Alaflip selesai (${elapsed_ms}ms)`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ ok: true, elapsed_ms }))
    } catch (err) {
      console.error('[ScraperHTTP] Aktivasi Alaflip gagal:', err.message)
      res.writeHead(500, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: err.message }))
    }
    return
  }


  // ── POST /scrape-now/:channelId[?scroll=false] ─────────
  const match = urlObj.pathname.match(/^\/scrape-now\/([^/?]+)/)
  if (!match || method !== 'POST') {
    res.writeHead(404).end(JSON.stringify({ error: 'Not found' }))
    return
  }

  const channelId = match[1]
  const scroll = urlObj.searchParams.get('scroll') !== 'false'

  try {
    const channel = await db.paymentChannel.findUnique({ where: { id: channelId } })
    if (!channel) { res.writeHead(404).end(JSON.stringify({ error: 'Channel not found' })); return }

    const config = JSON.parse(decrypt(channel.scrapingConfig))
    const scraperFn = SCRAPERS[channel.channelType]
    if (!scraperFn) { res.writeHead(400).end(JSON.stringify({ error: `No scraper for ${channel.channelType}` })); return }

    const session = await browserPool.getSession(channelId)
    const start = Date.now()
    const result = await scraperFn(session.mainPage, session.context, config, session.isLoggedIn, { scroll })
    const elapsed_ms = Date.now() - start

    if (result.isLoggedIn !== undefined) await browserPool.setLoggedIn(channelId, result.isLoggedIn)

    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      scroll,
      found: result.transactions?.length ?? 0,
      error: result.error ?? null,
      elapsed_ms
    }))
  } catch (err) {
    res.writeHead(500).end(JSON.stringify({ error: err.message }))
  }
})

testServer.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`⚠️  Scraper test server: port ${SCRAPER_PORT} already in use, skipping test server`)
  } else {
    console.error('Scraper test server error:', err.message)
  }
})

testServer.listen(SCRAPER_PORT, () => {
  console.log(`🧪 Scraper test server: http://localhost:${SCRAPER_PORT}/scrape-now/:channelId`)
})
