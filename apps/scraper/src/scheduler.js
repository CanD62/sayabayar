// apps/scraper/src/scheduler.js
// Polls database for channels that need scraping
// 3-tier priority:
//   HIGH   (15s)  — user clicked "Sudah Transfer" (user_confirmed)
//   MEDIUM (5m)   — invoice pending, user hasn't confirmed yet
//   LOW    (15m)  — no pending invoices at all

import { scrapeQueue } from './queues.js'
import { browserPool } from './browserPool.js'
import { getDb } from '@payment-gateway/shared/db'
import { decrypt } from '@payment-gateway/shared/crypto'
import { getScrapeInterval } from '@payment-gateway/shared/constants'
import { consumeCommand } from './sessionStore.js'
import IORedis from 'ioredis'

let running = false

// HIGH priority timeout: 5 minutes after user_confirmed → drop to MEDIUM
// MEDIUM is already fast (2 min QRIS, 5 min BCA) so no need for longer HIGH window
const HIGH_PRIORITY_TIMEOUT_MS = 5 * 60_000

export function startScheduler(intervalMs = 5000) {
  running = true
  console.log(`[Scheduler] Started (poll every ${intervalMs / 1000}s)`)

  const poll = async () => {
    if (!running) return

    try {
      const db = getDb()
      const now = new Date()

      const channels = await db.paymentChannel.findMany({
        where: { isActive: true, deletedAt: null },
        include: { channelState: true }
      })

      // ── Proses commands untuk channel nonaktif (paused) ──────────
      // Channel paused tidak masuk loop utama, tapi tetap perlu proses clean_browser/force_logout
      const inactiveChannels = await db.paymentChannel.findMany({
        where: { isActive: false, deletedAt: null },
        select: { id: true, accountName: true, channelType: true }
      })
      for (const ch of inactiveChannels) {
        const cmd = await consumeCommand(ch.id)
        const isGoPay = ch.channelType === 'qris_gopay'

        if (cmd === 'clean_browser' || cmd === 'force_logout') {
          const label = cmd === 'force_logout' ? '⚠️ Force logout' : '🧹 Clean browser'
          console.log(`[Scheduler] ${label} (paused): ${ch.accountName}`)

          if (isGoPay) {
            const { logoutGopay } = await import('./scrapers/qrisGopay.js')
            await logoutGopay(ch.id).catch(() => {})
            console.log(`[Scheduler] ✅ GoPay token cleared: ${ch.accountName}`)
          } else if (cmd === 'clean_browser') {
            await browserPool.destroySession(ch.id)
          } else {
            await browserPool.forceLogout(ch.id)
          }
        }
      }


      for (const channel of channels) {
        const state = channel.channelState

        // ── Management commands ──────────────────────────
        const cmd = await consumeCommand(channel.id)
        const isGoPay = channel.channelType === 'qris_gopay'

        if (cmd === 'force_logout') {
          console.log(`[Scheduler] ⚠️ Force logout: ${channel.accountName}`)
          if (isGoPay) {
            // GoPay: clear Redis token (no browser session)
            const { logoutGopay } = await import('./scrapers/qrisGopay.js')
            await logoutGopay(channel.id).catch(() => {})
            console.log(`[Scheduler] ✅ GoPay token cleared: ${channel.accountName}`)
          } else {
            await browserPool.forceLogout(channel.id)
          }
          continue
        }
        if (cmd === 'clean_browser') {
          console.log(`[Scheduler] 🧹 Clean browser: ${channel.accountName}`)
          if (isGoPay) {
            const { logoutGopay } = await import('./scrapers/qrisGopay.js')
            await logoutGopay(channel.id).catch(() => {})
          } else {
            await browserPool.destroySession(channel.id)
          }
          continue
        }
        if (cmd && cmd.startsWith('test_login:')) {
          const testId = cmd.split(':')[1]
          console.log(`[Scheduler] 🔑 Test login: ${channel.accountName}`)
          await handleTestLogin(channel, testId)
          continue
        }

        // ── Circuit breaker check ────────────────────────
        if (state?.circuitState === 'open') {
          const elapsed = Date.now() - new Date(state.circuitOpenedAt).getTime()
          const remaining = Math.ceil((15 * 60_000 - elapsed) / 1000)
          if (remaining > 0) {
            // Only log every 60 seconds to reduce noise
            if (remaining % 60 < 6) {
              console.log(`[Scheduler] ${channel.accountName} — circuit OPEN, cooldown ${remaining}s`)
            }
            continue
          }
        }

        // ── Determine priority based on invoice status ────
        const confirmedCount = await db.invoice.count({
          where: {
            paymentChannelId: channel.id,
            status: 'user_confirmed',
            expiredAt: { gt: now }
          }
        })

        const pendingCount = await db.invoice.count({
          where: {
            paymentChannelId: channel.id,
            status: 'pending',
            expiredAt: { gt: now }
          }
        })

        // Check if HIGH priority timed out (10 min since confirm)
        let highTimedOut = false
        if (confirmedCount > 0) {
          const oldestConfirmed = await db.invoice.findFirst({
            where: {
              paymentChannelId: channel.id,
              status: 'user_confirmed',
              expiredAt: { gt: now }
            },
            orderBy: { confirmedAt: 'asc' },
            select: { confirmedAt: true }
          })

          if (oldestConfirmed?.confirmedAt) {
            const elapsed = Date.now() - new Date(oldestConfirmed.confirmedAt).getTime()
            highTimedOut = elapsed > HIGH_PRIORITY_TIMEOUT_MS
          }
        }

        let priority
        if (confirmedCount > 0 && !highTimedOut) {
          priority = 'high'     // User confirmed transfer — check every 15s
        } else if (pendingCount > 0 || confirmedCount > 0) {
          priority = 'medium'   // Has pending invoices — check every 5m
        } else {
          priority = 'low'      // Idle — check every 15m
        }

        const interval = getScrapeInterval(channel.channelType, priority)

        // Update priority in DB if changed
        if (state && state.scrapePriority !== priority) {
          await db.channelState.update({
            where: { channelId: channel.id },
            data: { scrapePriority: priority }
          })
        }

        // Check if it's time to scrape
        const nextScrapeAt = state?.nextScrapeAt
        if (nextScrapeAt && new Date(nextScrapeAt) > now) continue

        // Check for duplicate jobs in queue
        const jobId = `scrape-${channel.id}`
        const existingJob = await scrapeQueue.getJob(jobId)
        if (existingJob) {
          const jobState = await existingJob.getState()
          if (jobState === 'active' || jobState === 'waiting' || jobState === 'delayed') {
            continue
          }
          await existingJob.remove().catch(() => { })
        }

        // Ensure channel_state exists
        await db.channelState.upsert({
          where: { channelId: channel.id },
          update: { nextScrapeAt: new Date(Date.now() + interval) },
          create: {
            channelId: channel.id,
            nextScrapeAt: new Date(Date.now() + interval),
            scrapePriority: priority
          }
        })

        // Add scrape job
        await scrapeQueue.add('scrape', {
          channelId: channel.id,
          channelType: channel.channelType,
          priority  // ← agar scrapeWorker tahu scroll perlu atau tidak
        }, {
          jobId,
          priority: priority === 'high' ? 1 : priority === 'medium' ? 5 : 10
        })

        const label = confirmedCount > 0 && !highTimedOut
          ? `⚡ HIGH (${confirmedCount} confirmed, next ${interval / 1000}s)`
          : pendingCount > 0
            ? `📋 MEDIUM (${pendingCount} pending, next ${interval / 1000}s)`
            : `💤 LOW (idle, next ${interval / 1000}s)`
        console.log(`[Scheduler] ✅ ${channel.accountName}: ${label}`)
      }

      // ── Auto-expire overdue invoices ────────────────────────
      const expired = await db.invoice.updateMany({
        where: {
          status: { in: ['pending', 'user_confirmed'] },
          expiredAt: { lte: now }
        },
        data: { status: 'expired' }
      })
      if (expired.count > 0) {
        console.log(`[Scheduler] ⏰ Auto-expired ${expired.count} invoice(s)`)
      }

    } catch (error) {
      console.error('[Scheduler] Poll error:', error.message)
    }

    if (running) {
      setTimeout(poll, intervalMs)
    }
  }

  setTimeout(poll, 1000)
}

export function stopScheduler() {
  running = false
  console.log('[Scheduler] Stopped')
}

/**
 * Handle test_login command — try login with channel credentials
 * Writes result to Redis for API to poll
 */
async function handleTestLogin(channel, testId) {
  const r = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379')
  const resultKey = `pg:test_result:${testId}`

  try {
    // Decrypt scraping config
    let config
    try {
      config = JSON.parse(decrypt(channel.scrapingConfig))
    } catch {
      await r.setex(resultKey, 60, JSON.stringify({ success: false, message: 'Gagal decrypt konfigurasi' }))
      return
    }

    // Import the correct scraper
    const scrapers = {
      bca_transfer: () => import('./scrapers/bcaTransfer.js'),
      qris_bca: () => import('./scrapers/qrisBca.js'),
      qris_gopay: () => import('./scrapers/qrisGopay.js')
    }

    const importFn = scrapers[channel.channelType]
    if (!importFn) {
      await r.setex(resultKey, 60, JSON.stringify({ success: false, message: `Scraper belum tersedia untuk ${channel.channelType}` }))
      return
    }

    // Create a temporary session for testing (don't use the pool — avoid disrupting ongoing sessions)
    const testChannelId = `test_${channel.id}_${Date.now()}`
    const session = await browserPool.getSession(testChannelId)

    try {
      const scraperModule = await importFn()
      // Get the scraper function
      const scraperFn = scraperModule.scrapeBcaTransfer
        || scraperModule.scrapeQrisBca
        || scraperModule.scrapeQrisGopay

      // GoPay needs channelId to access Redis token store
      const scraperConfig = channel.channelType === 'qris_gopay'
        ? { ...config, _channelId: `test_${channel.id}` }
        : config

      // Attempt scrape (which includes login)
      await scraperFn(session.mainPage, session.context, scraperConfig, false)

      await r.setex(resultKey, 60, JSON.stringify({ success: true, message: 'Login berhasil! Koneksi OK.' }))
      console.log(`[Scheduler] ✅ Test login SUCCESS: ${channel.accountName}`)
    } catch (err) {
      await r.setex(resultKey, 60, JSON.stringify({ success: false, message: `Login gagal: ${err.message}` }))
      console.log(`[Scheduler] ❌ Test login FAILED: ${channel.accountName} — ${err.message}`)
    } finally {
      // Always destroy test session
      await browserPool.destroySession(testChannelId)
    }
  } catch (err) {
    await r.setex(resultKey, 60, JSON.stringify({ success: false, message: `Error: ${err.message}` }))
  } finally {
    await r.quit()
  }
}
