// apps/scraper/src/workers/scrapeWorker.js
// BullMQ processor — runs scraping jobs (TRUE STANDBY)

import { Worker } from 'bullmq'
import { getRedisConnection, matchQueue } from '../queues.js'
import { browserPool } from '../browserPool.js'
import { canScrape, recordSuccess, recordError, classifyError } from '../circuitBreaker.js'
import { scrapeBcaTransfer } from '../scrapers/bcaTransfer.js'
import { scrapeQrisBca } from '../scrapers/qrisBca.js'
import { scrapeQrisGopay } from '../scrapers/qrisGopay.js'
import { getDb } from '@payment-gateway/shared/db'
import { decrypt, generateTransactionHash } from '@payment-gateway/shared/crypto'

const SCRAPERS = {
  bca_transfer: scrapeBcaTransfer,
  qris_bca: scrapeQrisBca,
  qris_gopay: scrapeQrisGopay
}

export function startScrapeWorker(concurrency = 5) {
  const worker = new Worker('scrape', async (job) => {
    const { channelId, channelType } = job.data
    const startTime = Date.now()
    const db = getDb()

    console.log(`[ScrapeWorker] Processing channel ${channelId} (${channelType})`)

    // ── Circuit Breaker Check ─────────────────────────────
    const allowed = await canScrape(channelId)
    if (!allowed) {
      console.log(`[ScrapeWorker] Circuit OPEN for ${channelId}, skipping`)
      return { skipped: true, reason: 'circuit_open' }
    }

    // ── Get channel config ────────────────────────────────
    const channel = await db.paymentChannel.findUnique({ where: { id: channelId } })
    if (!channel || !channel.isActive) {
      return { skipped: true, reason: 'channel_inactive' }
    }

    // Decrypt scraping credentials
    let config
    try {
      config = JSON.parse(decrypt(channel.scrapingConfig))
    } catch (err) {
      await recordError(channelId, 'fatal', 'Failed to decrypt scraping config')
      throw new Error('Failed to decrypt scraping config')
    }

    const scraperFn = SCRAPERS[channelType]
    if (!scraperFn) {
      throw new Error(`No scraper for channel type: ${channelType}`)
    }

    // ── API-based scrapers skip browser pool ────────────────
    // qris_gopay hits API directly — no browser needed
    const isApiBased = channelType === 'qris_gopay'
    const session = isApiBased
      ? { mainPage: null, context: null, isLoggedIn: false }
      : await browserPool.getSession(channelId)

    try {
      // ── Run scraper (passes mainPage + context) ─────────
      // HIGH priority: tidak perlu scroll — hanya cek baris terbaru yang masuk
      // INITIAL/LOW/MEDIUM: scroll untuk load semua transaksi lazy-loaded
      const priority = job.data.priority ?? 'low'
      const scraperOptions = {
        scroll: priority !== 'high'
      }

      // Pass channelId ke semua scraper — QRIS BCA butuh ini untuk session persistence ke Redis
      const scraperConfig = { ...config, channelId }

      const result = await scraperFn(
        session.mainPage,
        session.context,
        scraperConfig,
        session.isLoggedIn,
        scraperOptions
      )

      // Update standby login state
      if (result.isLoggedIn !== undefined) {
        await browserPool.setLoggedIn(channelId, result.isLoggedIn)
      }

      // Save cookies for session restore after restart
      if (result.isLoggedIn) {
        // Fire and forget — don't block scrape flow
        browserPool.saveCookies(channelId).catch(() => { })
      }

      // Handle soft errors (session expired, timeout, lockout, credentials)
      if (result.error) {
        console.log(`[ScrapeWorker] Soft error: ${result.error}`)

        // CREDENTIAL ERROR — deactivate channel immediately
        if (result.error.startsWith('CREDENTIAL_ERROR:')) {
          console.log(`[ScrapeWorker] ❌ Wrong credentials — deactivating channel`)
          await db.paymentChannel.update({
            where: { id: channelId },
            data: { isActive: false }
          })
          await db.channelState.update({
            where: { channelId },
            data: {
              lastErrorType: 'fatal',
              lastErrorMessage: result.error.replace('CREDENTIAL_ERROR: ', ''),
              lastErrorAt: new Date(),
              circuitState: 'open',
              nextScrapeAt: null  // Don't scrape anymore
            }
          })
          // Destroy browser session
          await browserPool.destroySession(channelId).catch(() => { })
          return
        }

        // RATE LIMITED (GoPay 429) — back off 20 minutes (check FIRST before LOCKOUT)
        if (result.error.includes('429') || result.error.includes('ratelimited')) {
          console.log(`[ScrapeWorker] 🚦 Rate limited — will retry in 20 minutes`)
          await db.channelState.update({
            where: { channelId },
            data: {
              lastScrapedAt: new Date(),
              lastErrorType: 'transient',
              lastErrorMessage: 'Rate limited oleh GoPay, coba lagi dalam 20 menit',
              lastErrorAt: new Date(),
              nextScrapeAt: new Date(Date.now() + 20 * 60_000)
            }
          })
        // LOCKOUT (BCA) — retry in 60s
        // NOTE: use ' 5 menit' (with space) to avoid matching '15 menit'
        } else if (result.error.startsWith('LOCKOUT:') ||
          result.error.includes(' 5 menit') || result.error.includes('5 minutes')) {
          console.log(`[ScrapeWorker] 🔒 Lockout — will retry in 60s`)
          await db.channelState.update({
            where: { channelId },
            data: {
              lastScrapedAt: new Date(),
              lastErrorType: 'transient',
              lastErrorMessage: result.error.replace('LOCKOUT: ', ''),
              lastErrorAt: new Date(),
              nextScrapeAt: new Date(Date.now() + 60_000)
            }
          })
        }

        // Soft error handled — return early so recordSuccess() doesn't overwrite error state
        const durationMs = Date.now() - startTime
        console.log(`[ScrapeWorker] ${channelId}: found 0, new 0 (${durationMs}ms)`)
        return { txFound: 0, txNew: 0, durationMs }
      }

      const transactions = result.transactions || []

      // ── Insert transactions + deduplicate ─────────────────
      let txNew = 0
      for (const tx of transactions) {
        const uniqueHash = generateTransactionHash(
          channelId, tx.reference_number, tx.amount, tx.date
        )

        // Check if already exists (avoids noisy prisma:error on unique constraint)
        const existing = await db.transaction.findUnique({ where: { uniqueHash } })
        if (existing) continue

        try {
          const created = await db.transaction.create({
            data: {
              paymentChannelId: channelId,
              amount: tx.amount,
              referenceNumber: tx.reference_number,
              uniqueHash,
              rawData: JSON.stringify(tx),
              matchStatus: 'unmatched'
            }
          })

          txNew++

          // ── Push to match queue ───────────────────────────
          await matchQueue.add('match', {
            transactionId: created.id,
            channelId,
            amount: tx.amount,
            referenceNumber: tx.reference_number
          })

        } catch (err) {
          if (err.code === 'P2002') {
            // Duplicate — skip silently
          } else {
            console.error(`[ScrapeWorker] Insert error:`, err.message)
          }
        }
      }

      // ── Record success ──────────────────────────────────
      await recordSuccess(channelId)
      const durationMs = Date.now() - startTime

      // ── Log scraping result ─────────────────────────────
      await db.scrapingLog.create({
        data: {
          channelId,
          status: 'success',
          txFound: transactions.length,
          txNew,
          durationMs
        }
      })

      console.log(`[ScrapeWorker] ${channelId}: found ${transactions.length}, new ${txNew} (${durationMs}ms)`)
      return { txFound: transactions.length, txNew, durationMs }

    } catch (error) {
      const errorType = classifyError(error)
      await recordError(channelId, errorType, error.message)

      // Fatal error → destroy browser session entirely
      if (errorType === 'fatal') {
        console.log(`[ScrapeWorker] Fatal error — destroying browser for ${channelId}`)
        await browserPool.destroySession(channelId)
      }

      const durationMs = Date.now() - startTime
      await db.scrapingLog.create({
        data: {
          channelId,
          status: errorType === 'fatal' ? 'fatal' : 'transient',
          errorType: errorType,
          errorMessage: error.message.slice(0, 500),
          durationMs
        }
      })

      throw error
    }

  }, {
    connection: getRedisConnection(),
    concurrency,
    limiter: { max: 1, duration: 5000 },
    stalledInterval: 30_000,  // cek stalled job setiap 30s
    maxStalledCount: 3        // retry 3x sebelum dianggap failed
  })

  worker.on('completed', (job, result) => {
    if (!result?.skipped) {
      console.log(`[ScrapeWorker] Job ${job.id} completed`)
    }
  })

  worker.on('failed', (job, err) => {
    console.error(`[ScrapeWorker] Job ${job.id} failed:`, err.message)
  })

  console.log(`[ScrapeWorker] Started with concurrency: ${concurrency}`)
  return worker
}
