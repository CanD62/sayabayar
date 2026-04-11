// apps/scraper/src/workers/matchWorker.js
// Matches scraped transactions to pending invoices

import { Worker } from 'bullmq'
import { getRedisConnection, webhookQueue, QUEUE_PREFIX } from '../queues.js'
import { getDb } from '@payment-gateway/shared/db'
import { MATCH } from '@payment-gateway/shared/constants'
import Redis from 'ioredis'

export function startMatchWorker(concurrency = 5) {
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 500, 3000),
    reconnectOnError: () => true
  })
  redis.on('error', (err) => console.error('[MatchWorker] Redis error:', err.message))

  const worker = new Worker('match', async (job) => {
    const { transactionId, channelId, amount } = job.data
    const db = getDb()

    console.log(`[MatchWorker] Matching transaction ${transactionId} (amount: ${amount})`)

    // ── Find matching invoice (pending or user_confirmed) ───
    // Prioritize user_confirmed (user said they transferred)
    const invoice = await db.invoice.findFirst({
      where: {
        paymentChannelId: channelId,
        amountUnique: amount,
        status: { in: ['user_confirmed', 'pending'] },
        expiredAt: { gt: new Date() }
      },
      orderBy: [
        { status: 'asc' },       // user_confirmed sorts before pending
        { createdAt: 'asc' }     // oldest first (FIFO)
      ],
      include: {
        paymentChannel: { select: { channelOwner: true } }
      }
    })

    if (!invoice) {
      // Check if transaction still exists (may have been deleted)
      const tx = await db.transaction.findUnique({ where: { id: transactionId } })
      if (!tx) {
        console.log(`[MatchWorker] Transaction ${transactionId} no longer exists, skipping`)
        return { matched: false, reason: 'deleted' }
      }

      const attempts = (tx.matchAttempt || 0) + 1

      await db.transaction.update({
        where: { id: transactionId },
        data: {
          matchAttempt: attempts,
          lastMatchAttempt: new Date(),
          matchStatus: attempts >= MATCH.MAX_ATTEMPTS ? 'manual' : 'unmatched'
        }
      })

      if (attempts >= MATCH.MAX_ATTEMPTS) {
        console.log(`[MatchWorker] ${transactionId} → manual review (${attempts}/${MATCH.MAX_ATTEMPTS})`)
        return { matched: false, attempts }
      }

      console.log(`[MatchWorker] No match for ${transactionId}, attempt ${attempts}/${MATCH.MAX_ATTEMPTS} — retry in 30s`)
      throw new Error('NO_MATCH_FOUND')
    }

    // ── Match found → atomic update ───────────────────────
    console.log(`[MatchWorker] MATCH! Transaction ${transactionId} → Invoice ${invoice.invoiceNumber}`)

    const now = new Date()
    const settlementDate = new Date(now.getTime() + 2 * 24 * 60 * 60_000) // H+2

    const isSubscriptionInvoice = invoice.invoiceNumber.startsWith('SUB-')

    const txOps = [
      // Update transaction → matched
      db.transaction.update({
        where: { id: transactionId },
        data: {
          invoiceId: invoice.id,
          matchStatus: 'matched',
          matchAttempt: { increment: 1 },
          lastMatchAttempt: now
        }
      }),

      // Update invoice → paid
      db.invoice.update({
        where: { id: invoice.id },
        data: {
          status: 'paid',
          paidAt: now
        }
      })
    ]

    // Only credit client balance for regular invoices (NOT subscription payments)
    if (!isSubscriptionInvoice) {
      const isOwnChannel = invoice.paymentChannel?.channelOwner === 'client'

      if (isOwnChannel) {
        // ── Channel sendiri: dana TIDAK masuk ke saldo platform ──────────
        // Dana sudah langsung ke rekening/QRIS milik client.
        // Platform tidak memegang dana ini → tidak boleh bisa ditarik via platform.
        // Tidak perlu insert balanceLedger maupun update clientBalance.
        console.log(`[MatchWorker] Own-channel invoice ${invoice.invoiceNumber} — skip balance ledger (dana ke rekening sendiri)`)
      } else {
        // ── Channel platform: masuk pending, settle H+2 ──────────────────
        txOps.push(
          db.balanceLedger.create({
            data: {
              clientId: invoice.clientId,
              invoiceId: invoice.id,
              type: 'credit_pending',
              amount: Number(invoice.amount),
              availableAt: settlementDate,
              note: `Invoice ${invoice.invoiceNumber} — settlement H+2`
            }
          }),

          db.clientBalance.update({
            where: { clientId: invoice.clientId },
            data: {
              balancePending: { increment: Number(invoice.amount) },
              totalEarned:    { increment: Number(invoice.amount) }
            }
          })
        )

        console.log(`[MatchWorker] Balance credited: type=credit_pending owner=platform amount=${invoice.amount}`)
      }
    }

    await db.$transaction(txOps)

    // ── Publish SSE event via Redis ───────────────────────
    await redis.publish('invoice_events', JSON.stringify({
      invoice_id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      client_id: invoice.clientId,
      event: 'invoice.paid',
      amount: Number(invoice.amount),
      paid_at: now.toISOString()
    }))

    // ── Push webhook job ──────────────────────────────────
    await webhookQueue.add('webhook', {
      invoiceId: invoice.id,
      event: 'invoice.paid',
      clientId: invoice.clientId
    })

    console.log(`[MatchWorker] Invoice ${invoice.invoiceNumber} PAID! Webhook queued.`)

    // ── Auto-activate subscription for SUB- invoices ──────
    if (invoice.invoiceNumber.startsWith('SUB-')) {
      try {
        const subPlan = await db.subscriptionPlan.findFirst({
          where: { planType: 'subscription', isActive: true }
        })

        if (subPlan) {
          // Read existing active subscription BEFORE deactivating it
          const existingSub = await db.clientSubscription.findFirst({
            where: { clientId: invoice.clientId, status: 'active' },
            include: { plan: true },
            orderBy: { createdAt: 'desc' }
          })

          // Deactivate current subscriptions
          await db.clientSubscription.updateMany({
            where: { clientId: invoice.clientId, status: 'active' },
            data: { status: 'expired' }
          })

          // Extend from existing period end only if currently on a PAID plan and still active
          // (free plan has far-future date like 2099 — ignore it)
          const isPaidSub = existingSub?.plan?.planType === 'subscription'
          const baseDate = (isPaidSub && existingSub.currentPeriodEnd > now)
            ? existingSub.currentPeriodEnd
            : now

          // Create new subscription (+1 month from base)
          const periodEnd = new Date(baseDate)
          periodEnd.setMonth(periodEnd.getMonth() + 1)

          await db.clientSubscription.create({
            data: {
              clientId: invoice.clientId,
              planId: subPlan.id,
              status: 'active',
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd
            }
          })

          console.log(`[MatchWorker] ⭐ Subscription activated for client ${invoice.clientId} until ${periodEnd.toISOString().slice(0, 10)} (base: ${baseDate.toISOString().slice(0, 10)})`)
        }
      } catch (err) {
        console.error(`[MatchWorker] Failed to auto-activate subscription:`, err.message)
      }
    }

    return { matched: true, invoiceId: invoice.id }

  }, {
    connection: getRedisConnection(),
    prefix: QUEUE_PREFIX,
    concurrency,
    stalledInterval: 30_000,  // cek stalled job setiap 30s
    maxStalledCount: 3        // retry 3x sebelum dianggap failed
  })

  worker.on('completed', (job, result) => {
    if (result?.matched) {
      console.log(`[MatchWorker] Job ${job.id} → MATCHED`)
    }
  })

  worker.on('failed', (job, err) => {
    console.error(`[MatchWorker] Job ${job.id} failed:`, err.message)
  })

  worker.on('ready', () => {
    console.log('[MatchWorker] ✅ Worker connected to Redis and ready')
  })

  console.log(`[MatchWorker] Started with concurrency: ${concurrency}`)
  return worker
}
