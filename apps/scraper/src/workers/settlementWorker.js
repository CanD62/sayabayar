// apps/scraper/src/workers/settlementWorker.js
// Settles credit_pending ledger entries whose availableAt has passed.
// Runs on a cron-like interval (default: every 1 minute).
// For each due entry (atomic):
//   1. Mark credit_pending settled_at = NOW()
//   2. Insert credit_available audit row
//   3. Move amount: balancePending → balanceAvailable

import { getDb } from '@payment-gateway/shared/db'
import Redis from 'ioredis'

let redis = null

let running = false
let timer = null

export function startSettlementWorker(intervalMs = 1 * 60_000) {
  running = true
  redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
  redis.on('error', (err) => console.error('[SettlementWorker] Redis error:', err.message))
  console.log(`[SettlementWorker] Started (interval: ${intervalMs / 1000}s)`)

  const run = async () => {
    if (!running) return

    try {
      const db = getDb()

      // Both available_at (stored via Prisma timezone=+07:00, so in WIB) and
      // NOW() (MariaDB session +07:00, also WIB) are in the same timezone.
      // Comparison is correct: available_at <= NOW() works as-is.
      const dueEntries = await db.$queryRaw`
        SELECT
          bl.id,
          bl.client_id  AS clientId,
          bl.amount,
          bl.invoice_id AS invoiceId,
          i.invoice_number AS invoiceNumber
        FROM balance_ledger bl
        LEFT JOIN invoices i ON i.id = bl.invoice_id
        WHERE bl.type = 'credit_pending'
          AND bl.settled_at IS NULL
          AND bl.available_at <= NOW()
      `

      // Log hanya saat ada yang perlu di-settle
      if (dueEntries.length > 0) {
        console.log(`[SettlementWorker] Tick — ${dueEntries.length} entry due`)

        let settled = 0
        for (const entry of dueEntries) {
          const id = entry.id
          const clientId = entry.clientId
          const invoiceId = entry.invoiceId || null
          const invoiceNumber = entry.invoiceNumber || '-'
          const amount = Number(entry.amount)
          const note = `Cair: ${invoiceNumber} — Rp ${amount.toLocaleString('id-ID')}`

          try {
            const now = new Date()
            // Interactive transaction — $executeRaw works reliably here
            await db.$transaction(async (tx) => {
              // 1. Mark credit_pending as settled
              await tx.$executeRaw`
                UPDATE balance_ledger
                SET settled_at = ${now}
                WHERE id = ${id} AND settled_at IS NULL
              `

              // 2. Insert credit_available audit entry
              // Gunakan JS Date (bukan NOW()) agar Prisma handle timezone dengan benar
              await tx.$executeRaw`
                INSERT INTO balance_ledger
                  (id, client_id, invoice_id, type, amount, available_at, settled_at, note, created_at)
                VALUES (
                  UUID(), ${clientId}, ${invoiceId}, 'credit_available', ${amount},
                  ${now}, ${now},
                  ${note},
                  ${now}
                )
              `

              // 3. Move balance: pending → available
              await tx.$executeRaw`
                UPDATE client_balances
                SET balance_pending   = balance_pending   - ${amount},
                    balance_available = balance_available + ${amount},
                    updated_at        = ${now}
                WHERE client_id = ${clientId}
              `
            })

            settled++
            console.log(`[SettlementWorker] ✅ Settled Rp ${amount.toLocaleString('id-ID')} — client ${clientId}`)

            // Publish SSE event via Redis
            if (redis) {
              await redis.publish('balance_events', JSON.stringify({
                event:          'balance.settled',
                client_id:      clientId,
                amount,
                invoice_number: invoiceNumber
              })).catch(() => {})
            }
          } catch (err) {
            console.error(`[SettlementWorker] ❌ Failed ledger ${id}:`, err.message)
          }
        }

        console.log(`[SettlementWorker] Done — ${settled}/${dueEntries.length} settled`)
      }
    } catch (err) {
      console.error('[SettlementWorker] Error:', err.message)
    }

    // Always reschedule — even if no entries were found or an error occurred
    if (running) {
      timer = setTimeout(run, intervalMs)
    }
  }

  // Run immediately on start, then on interval
  timer = setTimeout(run, 0)
}

export function stopSettlementWorker() {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (redis) {
    redis.disconnect()
    redis = null
  }
  console.log('[SettlementWorker] Stopped')
}
