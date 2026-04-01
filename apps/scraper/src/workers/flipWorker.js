// apps/scraper/src/workers/flipWorker.js
// BullMQ worker — proses withdrawal ke Flip Personal (sequential, concurrency=1)
// Status flow:
//   pending/failed → processing → processed
//                              → failed (Flip error, bisa di-retry admin)
// Saldo TIDAK dirollback saat failed — dikembalikan hanya jika admin reject

import { Worker } from 'bullmq'
import { getRedisConnection } from '../queues.js'
import { getDb } from '@payment-gateway/shared/db'
import { decrypt, encrypt } from '@payment-gateway/shared/crypto'
import * as flipClient from '../lib/flipClient.js'
import * as flipBrowser from '../scrapers/flipBrowser.js'

export function startFlipWorker() {
  const worker = new Worker('flip', async (job) => {
    const { withdrawalId, triggeredBy } = job.data
    const db = getDb()

    console.log(`[FlipWorker] Processing withdrawal ${withdrawalId} (triggered by: ${triggeredBy})`)

    // ── Ambil withdrawal ──────────────────────────────────
    const withdrawal = await db.withdrawal.findUnique({
      where: { id: withdrawalId }
    })

    if (!withdrawal) {
      console.error(`[FlipWorker] Withdrawal ${withdrawalId} not found`)
      return { skipped: true, reason: 'not_found' }
    }

    // Hanya proses jika status pending atau failed
    if (!['pending', 'failed'].includes(withdrawal.status)) {
      console.log(`[FlipWorker] Withdrawal ${withdrawalId} status "${withdrawal.status}" — skip`)
      return { skipped: true, reason: 'invalid_status' }
    }

    // ── Tandai sebagai processing (lock) ──────────────────
    await db.withdrawal.update({
      where: { id: withdrawalId },
      data:  { status: 'processing', retryCount: { increment: 1 } }
    })

    // ── Ambil PaymentProvider ─────────────────────────────
    const provider = await db.paymentProvider.findUnique({
      where: { providerName: 'flip' }
    })

    if (!provider) {
      await markFailed(db, withdrawalId, 'PaymentProvider "flip" belum dikonfigurasi')
      throw new Error('PaymentProvider tidak ditemukan')
    }

    // ── Lazy token refresh ────────────────────────────────
    let token
    try {
      const now       = new Date()
      const isExpired = !provider.tokenExpiresAt || provider.tokenExpiresAt <= now

      if (isExpired) {
        console.log('[FlipWorker] Token expired — refreshing...')
        const currentToken = decrypt(provider.token)
        const refreshRes   = await flipClient.refreshToken(currentToken)

        if (!refreshRes?.data?.token) {
          throw new Error('Gagal refresh token Flip: tidak ada token baru')
        }

        token = refreshRes.data.token
        const expiresAt = new Date(Date.now() + (24 - 0.5) * 60 * 60 * 1000)

        await db.paymentProvider.update({
          where: { providerName: 'flip' },
          data:  { token: encrypt(token), tokenExpiresAt: expiresAt }
        })
      } else {
        token = decrypt(provider.token)
      }
    } catch (err) {
      await markFailed(db, withdrawalId, `Token refresh gagal: ${err.message}`)
      throw err
    }

    const pin    = decrypt(provider.pin)
    const userId = provider.userId

    try {
      // ── Step 1: Dapatkan challenge token Aladin ──────────
      console.log(`[FlipWorker] Getting transfer challenge for withdrawal ${withdrawalId}...`)
      const challengeRes = await flipClient.getTokenTransfer(
        Math.round(Number(withdrawal.amount)),
        token
      )

      if (!challengeRes?.data?.challenge_url) {
        throw new Error(`Gagal mendapatkan challenge URL: ${JSON.stringify(challengeRes)}`)
      }

      const challengeUrl           = challengeRes.data.challenge_url
      const AUTHORIZATION          = challengeRes.data.headers['X-AUTHORIZATION']
      const AUTHORIZATION_CUSTOMER = challengeRes.data.headers['X-AUTHORIZATION-CUSTOMER']
      const DEVICE_ID              = challengeRes.data.headers['X-DEVICE-ID']

      // ── Step 2: Input PIN via Playwright ─────────────────
      console.log(`[FlipWorker] Launching browser for PIN input...`)
      const pinResponse = await flipBrowser.inputPin(
        challengeUrl,
        pin,
        AUTHORIZATION,
        AUTHORIZATION_CUSTOMER,
        DEVICE_ID
      )

      const nonce       = pinResponse.nonce
      const referenceId = pinResponse.partner_reference_no

      // ── Step 3: Execute transfer ──────────────────────────
      console.log(`[FlipWorker] Executing transfer...`)
      const transferRes = await flipClient.transferBank({
        accountNumber:  withdrawal.destinationAccount,
        bank:           withdrawal.destinationBank,
        amount:         Number(withdrawal.amount),
        beneficiaryName:withdrawal.destinationName,
        pin:            nonce,
        referenceId,
        deviceId:       DEVICE_ID
      }, token)

      // Validasi response
      const trxId  = transferRes?.id       || transferRes?.data?.id
      const status = transferRes?.status   || transferRes?.data?.status

      if (!trxId) {
        throw new Error(`Transfer response tidak valid: ${JSON.stringify(transferRes)}`)
      }

      // ── Step 4: Update ke processed ──────────────────────
      await db.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status:      'processed',
          flipTrxId:   String(trxId),
          processedAt: new Date()
        }
      })

      // Update balance Aladin di provider (fire and forget)
      if (userId) {
        flipClient.saldoAladin(userId, token)
          .then(res => {
            const newBalance = res?.data?.balance
            if (newBalance !== undefined) {
              db.paymentProvider.update({
                where: { providerName: 'flip' },
                data:  { balance: newBalance }
              }).catch(() => {})
            }
          })
          .catch(() => {})
      }

      console.log(`[FlipWorker] ✅ Withdrawal ${withdrawalId} processed — Flip ID: ${trxId}`)
      return { success: true, flipTrxId: String(trxId), status }

    } catch (err) {
      console.error(`[FlipWorker] ❌ Transfer failed for withdrawal ${withdrawalId}: ${err.message}`)
      await markFailed(db, withdrawalId, err.message)
      throw err  // BullMQ akan retry sesuai konfigurasi queue
    }

  }, {
    connection:   getRedisConnection(),
    concurrency:  1,         // Sequential — tidak boleh paralel ke Flip
    stalledInterval: 60_000, // Cek stalled job setiap 60s
    maxStalledCount: 1       // Jika stalled 1x → mark failed, jangan retry otomatis
  })

  worker.on('completed', (job, result) => {
    if (!result?.skipped) {
      console.log(`[FlipWorker] Job ${job.id} completed`)
    }
  })

  worker.on('failed', (job, err) => {
    console.error(`[FlipWorker] Job ${job.id} failed (attempt ${job.attemptsMade}): ${err.message}`)
  })

  console.log('[FlipWorker] Started — concurrency: 1 (sequential)')
  return worker
}

// ── Helper: tandai withdrawal sebagai failed ───────────────
async function markFailed(db, withdrawalId, reason) {
  try {
    await db.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status:          'failed',
        rejectionReason: reason?.slice(0, 500)
      }
    })
  } catch (err) {
    console.error(`[FlipWorker] Failed to mark withdrawal ${withdrawalId} as failed:`, err.message)
  }
}
