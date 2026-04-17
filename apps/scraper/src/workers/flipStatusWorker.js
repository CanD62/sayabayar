// apps/scraper/src/workers/flipStatusWorker.js
// Periodically checks Flip API for the real status of:
//   1. Withdrawals (status = 'processed', has flipTrxId)
//   2. Disbursements (status = 'success', has flipTrxId, recent)
//   3. Deposits (status = 'pending'/'confirmed', has flipTopupId)
// Runs on cron interval (default: 2 minutes).

import { getDb } from '@payment-gateway/shared/db'
import { decrypt } from '@payment-gateway/shared/crypto'
import * as flipClient from '../lib/flipClient.js'

let running = false
let timer = null

export function startFlipStatusWorker(intervalMs = 10_000) {
  running = true
  console.log(`[FlipStatusWorker] Started (interval: ${intervalMs / 1000}s)`)

  const run = async () => {
    if (!running) return

    try {
      const db = getDb()

      // ── Get Flip token ──────────────────────────────────
      const provider = await db.paymentProvider.findUnique({
        where: { providerName: 'flip' }
      })

      if (!provider?.token) {
        scheduleNext(intervalMs)
        return
      }

      let token
      try {
        const now = new Date()
        const isExpired = !provider.tokenExpiresAt || provider.tokenExpiresAt <= now

        if (isExpired) {
          const currentToken = decrypt(provider.token)
          const refreshRes = await flipClient.refreshToken(currentToken)
          if (!refreshRes?.data?.token) {
            console.error('[FlipStatusWorker] Token refresh failed')
            scheduleNext(intervalMs)
            return
          }
          token = refreshRes.data.token
          const expiresAt = new Date(Date.now() + (24 - 0.5) * 60 * 60 * 1000)
          await db.paymentProvider.update({
            where: { providerName: 'flip' },
            data: {
              token: (await import('@payment-gateway/shared/crypto')).encrypt(token),
              tokenExpiresAt: expiresAt
            }
          })
        } else {
          token = decrypt(provider.token)
        }
      } catch (err) {
        console.error('[FlipStatusWorker] Token error:', err.message)
        scheduleNext(intervalMs)
        return
      }

      let totalChecked = 0

      // ═══════════════════════════════════════════════════════
      // A. CHECK WITHDRAWALS (processed → verify via Flip)
      // ═══════════════════════════════════════════════════════
      const pendingWithdrawals = await db.withdrawal.findMany({
        where: {
          status: 'processing',
          flipTrxId: { not: null },
        },
        take: 20,
      })

      for (const w of pendingWithdrawals) {
        try {
          const flipId = (w.flipTrxId || '').replace(/^FT/, '')
          const result = await flipClient.getTransferStatus(flipId, token)
          const flipStatus = (result?.status || result?.data?.status || '').toUpperCase()

          if (flipStatus === 'DONE') {
            // Transfer confirmed by Flip — mark as processed (final success)
            if (w.status !== 'processed') {
              await db.withdrawal.update({
                where: { id: w.id },
                data: { status: 'processed' }
              })
            }
            console.log(`[FlipStatusWorker] ✅ Withdrawal ${w.id} confirmed DONE by Flip`)
            totalChecked++
          } else if (['CANCELLED', 'FAILED', 'REJECTED'].includes(flipStatus)) {
            // Flip rejected — mark as failed & refund balance
            await db.$transaction([
              db.withdrawal.update({
                where: { id: w.id },
                data: {
                  status: 'failed',
                  rejectionReason: `Flip status: ${flipStatus} (detected by status worker)`
                }
              }),
              // Refund balance_available
              db.clientBalance.update({
                where: { clientId: w.clientId },
                data: {
                  balanceAvailable: { increment: Number(w.amount) },
                  totalWithdrawn: { decrement: Number(w.amount) }
                }
              }),
              // Audit ledger
              db.balanceLedger.create({
                data: {
                  clientId: w.clientId,
                  withdrawalId: w.id,
                  type: 'credit_available',
                  amount: Number(w.amount),
                  availableAt: new Date(),
                  settledAt: new Date(),
                  note: `Refund withdrawal — Flip ${flipStatus}`
                }
              })
            ])

            console.log(`[FlipStatusWorker] ❌ Withdrawal ${w.id} FAILED by Flip (${flipStatus}) — refunded Rp ${w.amount}`)
            totalChecked++
          }
          // If still PENDING/PROCESSING at Flip, do nothing — check again next cycle
        } catch (err) {
          console.error(`[FlipStatusWorker] Withdrawal ${w.id} (flipTrxId: ${w.flipTrxId}) check error:`, err.message)
        }
      }

      // ═══════════════════════════════════════════════════════
      // B. CHECK DISBURSEMENTS (success → verify via Flip)
      // ═══════════════════════════════════════════════════════
      const recentDisbursements = await db.disbursement.findMany({
        where: {
          status: 'processing',
          flipTrxId: { not: null },
          processedAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
        },
        take: 20,
      })

      for (const d of recentDisbursements) {
        try {
          const flipId = (d.flipTrxId || '').replace(/^FT/, '')
          const result = await flipClient.getTransferStatus(flipId, token)
          const flipStatus = (result?.status || result?.data?.status || '').toUpperCase()

          if (flipStatus === 'DONE') {
            // Transfer confirmed — mark as success (final)
            if (d.status !== 'success') {
              await db.disbursement.update({
                where: { id: d.id },
                data: { status: 'success' }
              })
            }
            console.log(`[FlipStatusWorker] ✅ Disbursement ${d.id} confirmed DONE by Flip`)
            totalChecked++
          } else if (['CANCELLED', 'FAILED', 'REJECTED'].includes(flipStatus)) {
            // Flip rejected — refund disbursement balance
            await db.$transaction([
              db.disbursement.update({
                where: { id: d.id },
                data: {
                  status: 'failed',
                  failureReason: `Flip status: ${flipStatus} (detected by status worker)`
                }
              }),
              db.disbursementBalance.update({
                where: { clientId: d.clientId },
                data: {
                  balance: { increment: Number(d.totalDeducted) },
                  totalDisbursed: { decrement: Number(d.amount) },
                  totalFees: { decrement: Number(d.fee) },
                }
              }),
            ])

            console.log(`[FlipStatusWorker] ❌ Disbursement ${d.id} FAILED by Flip (${flipStatus}) — refunded Rp ${d.totalDeducted}`)
            totalChecked++
          }
        } catch (err) {
          console.error(`[FlipStatusWorker] Disbursement ${d.id} check error:`, err.message)
        }
      }

      // ═══════════════════════════════════════════════════════
      // C. CHECK DEPOSITS (pending/confirmed → auto-complete)
      // ═══════════════════════════════════════════════════════
      const pendingDeposits = await db.disbursementDeposit.findMany({
        where: {
          status: { in: ['pending', 'confirmed'] },
          flipTopupId: { not: null },
        },
        take: 20,
      })

      for (const dep of pendingDeposits) {
        try {
          const flipId = dep.flipTopupId.replace(/^FT/, '')
          const result = await flipClient.getTransferStatus(flipId, token)
          const flipStatus = (result?.status || result?.data?.status || '').toUpperCase()

          if (flipStatus === 'DONE' || flipStatus === 'PROCESSED') {
            const now = new Date()
            const depositAmount = Number(dep.amount)

            await db.$transaction([
              db.disbursementDeposit.update({
                where: { id: dep.id },
                data: { status: 'done', completedAt: now, confirmedAt: dep.confirmedAt || now }
              }),
              db.disbursementBalance.upsert({
                where: { clientId: dep.clientId },
                create: {
                  clientId: dep.clientId,
                  balance: depositAmount,
                  totalDeposited: depositAmount,
                },
                update: {
                  balance: { increment: depositAmount },
                  totalDeposited: { increment: depositAmount },
                }
              }),
            ])

            console.log(`[FlipStatusWorker] ✅ Deposit ${dep.id} completed: +Rp ${depositAmount} (auto-detected)`)
            totalChecked++
          } else if (['CANCELLED', 'FAILED', 'EXPIRED'].includes(flipStatus)) {
            await db.disbursementDeposit.update({
              where: { id: dep.id },
              data: { status: 'expired' }
            })

            console.log(`[FlipStatusWorker] ⏰ Deposit ${dep.id} expired/cancelled by Flip (${flipStatus})`)
            totalChecked++
          }
        } catch (err) {
          console.error(`[FlipStatusWorker] Deposit ${dep.id} check error:`, err.message)
        }
      }

      if (totalChecked > 0) {
        console.log(`[FlipStatusWorker] Cycle done — ${totalChecked} items verified`)
      }

    } catch (err) {
      console.error('[FlipStatusWorker] Error:', err.message)
    }

    scheduleNext(intervalMs)
  }

  function scheduleNext(ms) {
    if (running) timer = setTimeout(run, ms)
  }

  // Start immediately
  timer = setTimeout(run, 5000) // 5s delay after boot
}

export function stopFlipStatusWorker() {
  running = false
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  console.log('[FlipStatusWorker] Stopped')
}
