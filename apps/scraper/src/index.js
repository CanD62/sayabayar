// apps/scraper/src/index.js
// Entry point — Scraper Service

import { getDb, disconnectDb } from '@payment-gateway/shared/db'
import { browserPool } from './browserPool.js'
import { startScheduler, stopScheduler } from './scheduler.js'
import { startScrapeWorker } from './workers/scrapeWorker.js'
import { startMatchWorker } from './workers/matchWorker.js'
import { startWebhookWorker } from './workers/webhookWorker.js'
import { startSettlementWorker, stopSettlementWorker } from './workers/settlementWorker.js'
import { startFlipWorker } from './workers/flipWorker.js'
import { closeBrowser as closeFlipBrowser } from './scrapers/flipBrowser.js'
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
        data: { nextScrapeAt: new Date(Date.now() + 5_000) }  // 5s buffer — avoids race with scheduler first poll
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
}

// ── Start browser pool cleanup ────────────────────────────
browserPool.startCleanup()
console.log('✅ Browser pool initialized')

// ── Start workers ─────────────────────────────────────────
const concurrency  = parseInt(process.env.SCRAPER_CONCURRENCY || '5')
const scrapeWorker = startScrapeWorker(concurrency)
const matchWorker  = startMatchWorker(concurrency)
const webhookWorker= startWebhookWorker(3)
const flipWorker   = startFlipWorker()   // concurrency=1, sequential

// ── Start settlement worker ───────────────────────────────
// Settles pending balances every 5 minutes
startSettlementWorker() // default: 30s (dev)

// ── Start scheduler ───────────────────────────────────────
startScheduler(5000)

console.log('🚀 Scraper Service running!')
console.log(`   Workers: scrape(${concurrency}), match(${concurrency}), webhook(3), flip(1)`)
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
  await scrapeWorker.close().catch(() => {})
  await matchWorker.close().catch(() => {})
  await webhookWorker.close().catch(() => {})
  await flipWorker.close().catch(() => {})
  stopSettlementWorker()

  // Logout from banks + close browsers
  await browserPool.shutdown()
  await closeFlipBrowser().catch(() => {})

  // Cleanup Redis session store
  await closeSessionStore().catch(() => {})

  // Disconnect DB
  await disconnectDb().catch(() => {})

  console.log('Scraper service stopped.')
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// ── Test HTTP server (dev/debug) ───────────────────────────

const SCRAPERS = { qris_bca: scrapeQrisBca, bca_transfer: scrapeBcaTransfer }
const SCRAPER_PORT = parseInt(process.env.SCRAPER_PORT || '3002')


const testServer = createServer(async (req, res) => {
  // POST /scrape-now/:channelId[?scroll=false]
  const urlObj = new URL(req.url, `http://localhost`)
  const match = urlObj.pathname.match(/^\/scrape-now\/([^/?]+)/)
  if (!match || req.method !== 'POST') {
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
