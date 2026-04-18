// apps/scraper/src/workers/flipWorker.js
// BullMQ worker — proses withdrawal ke Flip Personal (sequential, concurrency=1)
// Status flow:
//   pending/failed → processing → processed
//                              → failed (Flip error, bisa di-retry admin)
// Saldo TIDAK dirollback saat failed — dikembalikan hanya jika admin reject

import { Worker } from 'bullmq'
import { getRedisConnection, QUEUE_PREFIX } from '../queues.js'
import { getDb } from '@payment-gateway/shared/db'
import { decrypt, encrypt } from '@payment-gateway/shared/crypto'
import { FLIP } from '@payment-gateway/shared/constants'
import * as flipClient from '../lib/flipClient.js'
import * as flipBrowser from '../scrapers/flipBrowser.js'

const SAFE_FLIP_JOB_INTERVAL_MS = Number.isFinite(FLIP.MIN_JOB_INTERVAL_MS) && FLIP.MIN_JOB_INTERVAL_MS > 0
  ? FLIP.MIN_JOB_INTERVAL_MS
  : 5000

// ── Helpers ──────────────────────────────────────────────
function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
    return JSON.parse(Buffer.from(pad, 'base64').toString())
  } catch { return null }
}

/** Cek apakah error adalah Alaflip tidak aktif */
function isAlaflipInactive(res) {
  if (!res) return false
  const msg = (res.error?.message || res.message || '').toLowerCase()
  const code = String(res.error?.code || res.code || '')
  return msg.includes('inactive') || msg.includes('not active') ||
    msg.includes('refresh token not found') || code === '40301'
}

/** Ambil webview URL untuk aktivasi Alaflip */
async function getAlaflipWebviewUrl(token, userId) {
  const { getAlaflipWebviewUrl: getAlaflipWebviewUrlHttp } = await import('@payment-gateway/shared/flip')
  const { url } = await getAlaflipWebviewUrlHttp(userId, token)
  const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
  const deviceId = JSON.parse(Buffer.from(pad, 'base64').toString())?.data?.device_identifier
  return { url, deviceId }
}

export function startFlipWorker() {
  const worker = new Worker('flip', async (job) => {
    const db = getDb()

    // ── Route by job name ───────────────────────────────
    if (job.name === 'disbursement-transfer') {
      return handleDisbursementTransfer(job, db)
    }

    // ── Default: withdrawal processing ──────────────────
    const { withdrawalId, triggeredBy } = job.data

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
      data: { status: 'processing', retryCount: { increment: 1 } }
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
      const now = new Date()
      const isExpired = !provider.tokenExpiresAt || provider.tokenExpiresAt <= now

      if (isExpired) {
        console.log('[FlipWorker] Token expired — refreshing...')
        const currentToken = decrypt(provider.token)
        const refreshRes = await flipClient.refreshToken(currentToken)

        if (!refreshRes?.data?.token) {
          throw new Error('Gagal refresh token Flip: tidak ada token baru')
        }

        token = refreshRes.data.token
        const expiresAt = new Date(Date.now() + (24 - 0.5) * 60 * 60 * 1000)

        await db.paymentProvider.update({
          where: { providerName: 'flip' },
          data: { token: encrypt(token), tokenExpiresAt: expiresAt }
        })
      } else {
        token = decrypt(provider.token)
      }
    } catch (err) {
      await markFailed(db, withdrawalId, `Token refresh gagal: ${err.message}`)
      throw err
    }

    const pin = decrypt(provider.pin)
    const userId = provider.userId

    try {
      // ── Step 1: Cek status Alaflip lalu dapatkan challenge token ──
      console.log(`[FlipWorker] Getting transfer challenge for withdrawal ${withdrawalId}...`)
      let challengeRes = await flipClient.getTokenTransfer(
        Math.round(Number(withdrawal.amountReceived)),
        token
      )

      // Jika Alaflip tidak aktif — aktivasi otomatis via Playwright
      if (isAlaflipInactive(challengeRes)) {
        console.log(`[FlipWorker] Alaflip inactive detected — memulai auto-activation...`)

        const { url: webviewUrl, deviceId: devId } = await getAlaflipWebviewUrl(token, userId)
        const pinStr = decrypt(provider.pin)

        await flipBrowser.activateAlaflip(webviewUrl, pinStr, devId)
        console.log(`[FlipWorker] Alaflip activated — retrying challenge...`)

        // Retry sekali setelah aktivasi
        challengeRes = await flipClient.getTokenTransfer(
          Math.round(Number(withdrawal.amountReceived)),
          token
        )

        if (isAlaflipInactive(challengeRes)) {
          throw new Error('Alaflip masih tidak aktif setelah re-aktivasi. Coba aktivasi manual.')
        }
      }

      if (!challengeRes?.data?.challenge_url) {
        throw new Error(`Gagal mendapatkan challenge URL: ${JSON.stringify(challengeRes)}`)
      }

      const challengeUrl = challengeRes.data.challenge_url
      const wvHeaders    = challengeRes.data.headers || {}
      const wvDeviceId   = wvHeaders['X-DEVICE-ID'] || deviceId || ''

      // ── Step 2: Input PIN via Playwright ─────────────────
      console.log(`[FlipWorker] Launching browser for PIN input...`)
      const pinResponse = await flipBrowser.inputPin(challengeUrl, pin, wvHeaders)

      const nonce       = pinResponse.nonce
      const referenceId = pinResponse.partner_reference_no

      // ── Step 3: Execute transfer ──────────────────────────
      console.log(`[FlipWorker] Executing transfer...`)
      const transferRes = await flipClient.transferBank({
        accountNumber:   withdrawal.destinationAccount,
        beneficiaryBank: withdrawal.destinationBank,
        amount:          Number(withdrawal.amountReceived),
        beneficiaryName: withdrawal.destinationName,
        nonce,
        referenceId,
        idempotencyKey:  `${userId || 'flip'}_${Math.floor(Date.now() / 1000)}`,
      }, token)

      // Validasi response
      const trxId = transferRes?.id || transferRes?.data?.id
      const status = transferRes?.status || transferRes?.data?.status

      if (!trxId) {
        throw new Error(`Transfer response tidak valid: ${JSON.stringify(transferRes)}`)
      }

      // ── Step 4: Mark as processing with Flip ID ─────────────
      // Status final (processed/failed) ditentukan oleh flipStatusWorker
      // setelah verifikasi ke Flip API
      await db.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          status: 'processing',
          flipTrxId: String(trxId),
          processedAt: new Date(),
          rejectionReason: null
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
                data: { balance: newBalance }
              }).catch(() => { })
            }
          })
          .catch(() => { })
      }

      console.log(`[FlipWorker] ✅ Withdrawal ${withdrawalId} processed — Flip ID: ${trxId}`)
      return { success: true, flipTrxId: String(trxId), status }

    } catch (err) {
      console.error(`[FlipWorker] ❌ Transfer failed for withdrawal ${withdrawalId}: ${err.message}`)
      await markFailed(db, withdrawalId, err.message)
      throw err  // BullMQ akan retry sesuai konfigurasi queue
    }

  }, {
    connection: getRedisConnection(),
    prefix: QUEUE_PREFIX,
    concurrency: 1,         // Sequential — tidak boleh paralel ke Flip
    limiter: {
      max: 1,               // Max 1 job per duration window
      duration: SAFE_FLIP_JOB_INTERVAL_MS
    },
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

  console.log(`[FlipWorker] Started — concurrency: 1 (sequential), min interval: ${SAFE_FLIP_JOB_INTERVAL_MS}ms`)
  return worker
}

// ── Helper: tandai withdrawal sebagai failed ───────────────
async function markFailed(db, withdrawalId, reason) {
  try {
    await db.withdrawal.update({
      where: { id: withdrawalId },
      data: {
        status: 'failed',
        rejectionReason: reason?.slice(0, 500)
      }
    })
  } catch (err) {
    console.error(`[FlipWorker] Failed to mark withdrawal ${withdrawalId} as failed:`, err.message)
  }
}

// ═══════════════════════════════════════════════════════════
// DISBURSEMENT TRANSFER HANDLER
// ═══════════════════════════════════════════════════════════
async function handleDisbursementTransfer(job, db) {
  const { disbursementId, triggeredBy } = job.data

  console.log(`[FlipWorker] Processing disbursement ${disbursementId} (triggered by: ${triggeredBy})`)

  // ── Ambil disbursement ────────────────────────────────
  const disbursement = await db.disbursement.findUnique({
    where: { id: disbursementId }
  })

  if (!disbursement) {
    console.error(`[FlipWorker] Disbursement ${disbursementId} not found`)
    return { skipped: true, reason: 'not_found' }
  }

  if (!['pending', 'failed'].includes(disbursement.status)) {
    console.log(`[FlipWorker] Disbursement ${disbursementId} status "${disbursement.status}" — skip`)
    return { skipped: true, reason: 'invalid_status' }
  }

  // ── Mark as processing ────────────────────────────────
  await db.disbursement.update({
    where: { id: disbursementId },
    data: { status: 'processing' }
  })

  // ── Get provider & token ──────────────────────────────
  const provider = await db.paymentProvider.findUnique({
    where: { providerName: 'flip' }
  })

  if (!provider) {
    await markDisbursementFailed(db, disbursement, 'PaymentProvider "flip" belum dikonfigurasi')
    throw new Error('PaymentProvider tidak ditemukan')
  }

  let token
  try {
    const now = new Date()
    const isExpired = !provider.tokenExpiresAt || provider.tokenExpiresAt <= now

    if (isExpired) {
      console.log('[FlipWorker] Token expired — refreshing for disbursement...')
      const currentToken = decrypt(provider.token)
      const refreshRes = await flipClient.refreshToken(currentToken)

      if (!refreshRes?.data?.token) throw new Error('Gagal refresh token Flip')

      token = refreshRes.data.token
      const expiresAt = new Date(Date.now() + (24 - 0.5) * 60 * 60 * 1000)

      await db.paymentProvider.update({
        where: { providerName: 'flip' },
        data: { token: encrypt(token), tokenExpiresAt: expiresAt }
      })
    } else {
      token = decrypt(provider.token)
    }
  } catch (err) {
    await markDisbursementFailed(db, disbursement, `Token refresh gagal: ${err.message}`)
    throw err
  }

  const pin = decrypt(provider.pin)
  const userId = provider.userId

  try {
    // ── Step 1: Get challenge token ──────────────────────
    console.log(`[FlipWorker] Getting disbursement challenge for ${disbursementId}...`)
    let challengeRes = await flipClient.getTokenTransfer(
      Math.round(Number(disbursement.amount)),
      token
    )

    // Auto-activate Alaflip if needed
    if (isAlaflipInactive(challengeRes)) {
      console.log(`[FlipWorker] Alaflip inactive — auto-activating for disbursement...`)
      const { url: webviewUrl, deviceId: devId } = await getAlaflipWebviewUrl(token, userId)
      await flipBrowser.activateAlaflip(webviewUrl, decrypt(provider.pin), devId)

      challengeRes = await flipClient.getTokenTransfer(
        Math.round(Number(disbursement.amount)),
        token
      )

      if (isAlaflipInactive(challengeRes)) {
        throw new Error('Alaflip masih tidak aktif setelah re-aktivasi')
      }
    }

    if (!challengeRes?.data?.challenge_url) {
      throw new Error(`Gagal mendapatkan challenge URL: ${JSON.stringify(challengeRes)}`)
    }

    // ── Step 2: PIN input via browser ────────────────────
    const pinResponse = await flipBrowser.inputPin(
      challengeRes.data.challenge_url,
      pin,
      challengeRes.data.headers || {}
    )

    // ── Step 3: Execute transfer ─────────────────────────
    console.log(`[FlipWorker] Executing disbursement transfer ${disbursementId}...`)
    const transferRes = await flipClient.transferBank({
      accountNumber:   disbursement.destinationAccount,
      beneficiaryBank: disbursement.destinationBank,
      amount:          Number(disbursement.amount),
      beneficiaryName: disbursement.destinationName,
      nonce:           pinResponse.nonce,
      referenceId:     pinResponse.partner_reference_no,
      idempotencyKey:  disbursement.idempotencyKey,
    }, token)

    const trxId = transferRes?.id || transferRes?.data?.id
    if (!trxId) throw new Error(`Transfer response tidak valid: ${JSON.stringify(transferRes)}`)

    // ── Step 4: Mark as processing with Flip ID ──────────
    // Status final (success/failed) ditentukan oleh flipStatusWorker
    await db.disbursement.update({
      where: { id: disbursementId },
      data: {
        status: 'processing',
        flipTrxId: String(trxId),
        processedAt: new Date(),
        failureReason: null,
      }
    })

    // Update Flip provider balance (fire & forget)
    if (userId) {
      flipClient.saldoAladin(userId, token)
        .then(res => {
          const b = res?.data?.balance
          if (b !== undefined) {
            db.paymentProvider.update({ where: { providerName: 'flip' }, data: { balance: b } }).catch(() => {})
          }
        })
        .catch(() => {})
    }

    console.log(`[FlipWorker] ✅ Disbursement ${disbursementId} success — Flip ID: ${trxId}`)
    return { success: true, flipTrxId: String(trxId) }

  } catch (err) {
    console.error(`[FlipWorker] ❌ Disbursement ${disbursementId} failed: ${err.message}`)
    await markDisbursementFailed(db, disbursement, err.message)
    throw err
  }
}

// ── Helper: mark disbursement as failed + refund balance ────
async function markDisbursementFailed(db, disbursement, reason) {
  try {
    await db.$transaction([
      // Mark as failed
      db.disbursement.update({
        where: { id: disbursement.id },
        data: {
          status: 'failed',
          failureReason: reason?.slice(0, 500),
        }
      }),
      // Refund saldo ke DisbursementBalance
      db.disbursementBalance.update({
        where: { clientId: disbursement.clientId },
        data: {
          balance:        { increment: Number(disbursement.totalDeducted) },
          totalDisbursed: { decrement: Number(disbursement.amount) },
          totalFees:      { decrement: Number(disbursement.fee) },
        }
      }),
    ])
    console.log(`[FlipWorker] Disbursement ${disbursement.id} refunded: +Rp ${disbursement.totalDeducted}`)
  } catch (err) {
    console.error(`[FlipWorker] Failed to mark disbursement ${disbursement.id} as failed:`, err.message)
  }
}
