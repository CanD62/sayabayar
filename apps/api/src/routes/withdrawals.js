// apps/api/src/routes/withdrawals.js
import bcrypt from 'bcrypt'
import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { WITHDRAW } from '@payment-gateway/shared/constants'
import { Queue } from 'bullmq'

// Flip queue — BullMQ terkoneksi ke Redis yang sama dengan scraper.
// FlipWorker di apps/scraper akan memproses job dari queue ini.
function getFlipQueue(redis) {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
  return new Queue('flip', {
    connection: {
      host:     url.hostname,
      port:     parseInt(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null
    }
  })
}


export async function withdrawalRoutes(fastify) {
  const db       = fastify.db
  const redis    = fastify.redis
  const flipQueue = getFlipQueue()

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /withdrawals ────────────────────────────────────
  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page:     { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20 } = request.query

    const [withdrawals, total] = await Promise.all([
      db.withdrawal.findMany({
        where:   { clientId: request.client.id },
        orderBy: { requestedAt: 'desc' },
        skip:    (page - 1) * per_page,
        take:    per_page
      }),
      db.withdrawal.count({ where: { clientId: request.client.id } })
    ])

    const mapped = withdrawals.map(w => ({
      id:                 w.id,
      amount:             Number(w.amount),
      fee:                Number(w.fee),
      amount_received:    Number(w.amountReceived),
      destination_bank:   w.destinationBank,
      destination_account:w.destinationAccount,
      destination_name:   w.destinationName,
      status:             w.status,
      rejection_reason:   w.rejectionReason,
      retry_count:        w.retryCount,
      requested_at:       w.requestedAt,
      processed_at:       w.processedAt
    }))

    return reply.paginated(mapped, {
      page,
      per_page,
      total,
      total_pages: Math.ceil(total / per_page)
    })
  })

  // ── POST /withdrawals/intent ────────────────────────────
  // Step 1: dapatkan nonce one-time sebelum submit withdrawal
  // Juga sebagai pre-check: daily limit + no pending
  fastify.post('/intent', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '5 minutes',
        keyGenerator: (req) => `intent:${req.client?.id || req.ip}`,
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan. Tunggu beberapa menit.' }
        })
      }
    }
  }, async (request, reply) => {
    const clientId = request.client.id
    const today    = new Date()
    today.setHours(0, 0, 0, 0)

    // Cek: sudah ada withdrawal hari ini (status apapun kecuali rejected)
    const todayWithdrawal = await db.withdrawal.findFirst({
      where: {
        clientId,
        requestedAt: { gte: today },
        status:      { not: 'rejected' }
      }
    })

    if (todayWithdrawal) {
      // Jika statusnya failed → beri tahu harus tunggu admin retry, bukan buat baru
      if (todayWithdrawal.status === 'failed') {
        return reply.fail(
          'WITHDRAWAL_DAILY_LIMIT',
          'Anda sudah memiliki permintaan penarikan hari ini yang gagal diproses. Hubungi admin untuk melanjutkan.',
          422
        )
      }
      return reply.fail(
        'WITHDRAWAL_DAILY_LIMIT',
        'Anda hanya dapat melakukan 1 penarikan per hari.',
        422
      )
    }

    // Cek: ada withdrawal pending atau processing
    const pendingWithdrawal = await db.withdrawal.findFirst({
      where: {
        clientId,
        status: { in: ['pending', 'processing'] }
      }
    })

    if (pendingWithdrawal) {
      return reply.fail(
        'WITHDRAWAL_PENDING_EXISTS',
        'Masih ada penarikan yang sedang diproses. Harap tunggu hingga selesai.',
        422
      )
    }

    // Generate nonce one-time
    const nonce    = crypto.randomUUID()
    const nonceKey = `pg:withdraw:nonce:${clientId}`
    await redis.setex(nonceKey, 300, nonce) // TTL 5 menit

    return reply.success({ nonce, expires_in: 300 })
  })

  // ── POST /withdrawals ───────────────────────────────────
  // Step 2: submit withdrawal (dengan nonce + password re-auth)
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'destination_bank', 'destination_account', 'destination_name', 'nonce', 'password'],
        properties: {
          amount:              { type: 'number', minimum: WITHDRAW.MIN_AMOUNT },  // jumlah yang diterima user
          destination_bank:    { type: 'string', maxLength: 10 },
          destination_account: { type: 'string', maxLength: 30 },
          destination_name:    { type: 'string', maxLength: 100 },
          nonce:               { type: 'string', minLength: 1 },
          password:            { type: 'string', minLength: 1 }
        }
      }
    }
  }, async (request, reply) => {
    const { amount, destination_bank, destination_account, destination_name, nonce, password } = request.body
    const clientId = request.client.id

    // 1. Verifikasi nonce dari Redis — belum dihapus dulu, hapus hanya setelah password valid
    const nonceKey    = `pg:withdraw:nonce:${clientId}`
    const storedNonce = await redis.get(nonceKey)

    if (!storedNonce || storedNonce !== nonce) {
      return reply.fail('WITHDRAWAL_NONCE_INVALID', 'Sesi penarikan tidak valid atau sudah kedaluwarsa. Silakan mulai ulang.', 422)
    }

    // 2. Verifikasi password user dengan proteksi brute-force
    const pwLockKey = `pg:withdraw:pwlock:${clientId}`
    const pwFailKey = `pg:withdraw:pwfail:${clientId}`

    // Cek apakah akun sedang dikunci
    const isLocked = await redis.get(pwLockKey)
    if (isLocked) {
      return reply.fail(
        'WITHDRAWAL_PASSWORD_LOCKED',
        'Penarikan diblokir karena 3x salah password. Coba lagi besok (tengah malam WIB).',
        429
      )
    }

    const client = await db.client.findUnique({ where: { id: clientId } })
    if (!client?.passwordHash) {
      return reply.fail('INVALID_CREDENTIALS', 'Akun tidak memiliki password. Gunakan metode login lain.', 422)
    }

    const passwordValid = await bcrypt.compare(password, client.passwordHash)
    if (!passwordValid) {
      // Hitung menit sampai tengah malam WIB (UTC+7 = UTC+7)
      const nowMs       = Date.now()
      const nowWIB      = new Date(nowMs + 7 * 3600_000)  // shift ke WIB
      const midnightWIB = new Date(nowWIB)
      midnightWIB.setUTCHours(17, 0, 0, 0)                // 17:00 UTC = 00:00 WIB
      if (midnightWIB.getTime() <= nowMs + 7 * 3600_000) {
        midnightWIB.setUTCDate(midnightWIB.getUTCDate() + 1)
      }
      const midnightEpoch = Math.floor(midnightWIB.getTime() / 1000) - 7 * 3600  // back to UTC epoch

      // Increment fail counter (INCR + EXPIREAT)
      const fails = await redis.incr(pwFailKey)
      if (fails === 1) {
        // Set expiry di fail key ke midnight WIB agar counter reset besok
        await redis.expireat(pwFailKey, midnightEpoch)
      }

      const remaining = Math.max(0, 3 - fails)
      if (fails >= 3) {
        // Lock sampai midnight WIB
        await redis.set(pwLockKey, '1', 'EXAT', midnightEpoch)
        return reply.fail(
          'WITHDRAWAL_PASSWORD_LOCKED',
          'Password salah 3x berturut-turut. Penarikan diblokir hingga besok (tengah malam WIB).',
          429
        )
      }

      return reply.fail(
        'INVALID_CREDENTIALS',
        `Password salah. Sisa percobaan: ${remaining}x sebelum diblokir.`,
        401
      )
    }

    // Password benar — hapus nonce (single-use) + reset fail counter
    await redis.del(nonceKey)
    await redis.del(pwFailKey)

    // 3. Double-check: withdrawal hari ini (server-side, anti race condition)
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const todayWithdrawal = await db.withdrawal.findFirst({
      where: {
        clientId,
        requestedAt: { gte: today },
        status:      { not: 'rejected' }
      }
    })
    if (todayWithdrawal) {
      return reply.fail('WITHDRAWAL_DAILY_LIMIT', 'Anda hanya dapat melakukan 1 penarikan per hari.', 422)
    }

    // 4. Double-check: tidak ada pending/processing
    const pendingWithdrawal = await db.withdrawal.findFirst({
      where: { clientId, status: { in: ['pending', 'processing'] } }
    })
    if (pendingWithdrawal) {
      return reply.fail('WITHDRAWAL_PENDING_EXISTS', 'Masih ada penarikan yang sedang diproses.', 422)
    }

    // 5. Cek balance cukup (harus cukup untuk amount + fee)
    const balance = await db.clientBalance.findUnique({ where: { clientId } })
    const fee       = WITHDRAW.DEFAULT_FEE
    const totalDebit = amount + fee   // total yang didebit dari saldo

    if (!balance || Number(balance.balanceAvailable) < totalDebit) {
      return reply.fail(
        'INSUFFICIENT_BALANCE',
        `Saldo tidak cukup. Diperlukan Rp ${(amount + fee).toLocaleString('id-ID')} (termasuk biaya Rp ${fee.toLocaleString('id-ID')}).`,
        422
      )
    }

    // amountReceived = amount yang diterima user (sudah termasuk fee di totalDebit)
    const amountReceived = amount

    // 6. Atomic: create withdrawal + debit balance + create ledger
    const [withdrawal] = await db.$transaction([
      db.withdrawal.create({
        data: {
          clientId,
          amount:             totalDebit,   // total didebit dari saldo (amount + fee)
          fee,
          amountReceived,                   // yang diterima user
          destinationBank:    destination_bank.toUpperCase(),
          destinationAccount: destination_account,
          destinationName:    destination_name
        }
      }),
      db.clientBalance.update({
        where: { clientId },
        data: {
          balanceAvailable: { decrement: totalDebit },
          totalWithdrawn:   { increment: totalDebit }
        }
      })
    ])

    // Ledger entry (perlu withdrawal.id → setelah transaction)
    await db.balanceLedger.create({
      data: {
        clientId,
        withdrawalId: withdrawal.id,
        type:         'debit_withdraw',
        amount,
        availableAt:  new Date(),
        note:         `Withdraw ke ${destination_bank.toUpperCase()} ${destination_account}`
      }
    })

    // 7. Cek flag autoProcess
    const provider = await db.paymentProvider.findUnique({
      where: { providerName: 'flip' }
    })

    if (provider?.autoProcess) {
      // Push ke BullMQ flip queue — FlipWorker di scraper proses sequentially
      await flipQueue.add('transfer', {
        withdrawalId: withdrawal.id,
        triggeredBy:  'auto'
      })
      fastify.log.info(`[Withdrawals] Auto-process: queued withdrawal ${withdrawal.id}`)
    }

    return reply.success({
      id:              withdrawal.id,
      amount:          Number(withdrawal.amount),
      fee:             Number(withdrawal.fee),
      amount_received: Number(withdrawal.amountReceived),
      status:          withdrawal.status,
      auto_process:    provider?.autoProcess ?? false,
      requested_at:    withdrawal.requestedAt
    }, 201)
  })
}
