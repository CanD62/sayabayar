// apps/api/src/routes/disbursements.js
// Disbursement routes: balance, deposit (via Flip topup), transfer, inquiry, history
// All endpoints require authenticate + checkClientStatus + requireDisbursementAccess

import crypto from 'node:crypto'
import { authenticate, checkClientStatus, requireDisbursementAccess } from '../middleware/authenticate.js'
import { DISBURSEMENT, getDisbursementFee } from '@payment-gateway/shared/constants'
import { getAlaflipBalanceFull } from '@payment-gateway/shared/flip'
import { Queue } from 'bullmq'

// Queue prefix must match the scraper worker (apps/scraper/src/queues.js)
const ENV = process.env.NODE_ENV || 'development'
const QUEUE_PREFIX = ENV === 'production' ? 'bull' : `bull:${ENV}`

// Flip queue — must use same prefix as the worker
function getFlipQueue() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
  return new Queue('flip', {
    connection: {
      host:     url.hostname,
      port:     parseInt(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null
    },
    prefix: QUEUE_PREFIX,
  })
}

export async function disbursementRoutes(fastify) {
  const db = fastify.db
  const redis = fastify.redis
  const flipQueue = getFlipQueue()

  // Apply auth hooks to all routes
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ══════════════════════════════════════════════════════════
  // BALANCE
  // ══════════════════════════════════════════════════════════

  // ── GET /disbursements/balance ───────────────────────────
  fastify.get('/balance', {
    preHandler: [requireDisbursementAccess]
  }, async (request, reply) => {
    const balance = await db.disbursementBalance.findUnique({
      where: { clientId: request.client.id }
    })

    if (!balance) {
      return reply.success({
        balance: 0,
        total_deposited: 0,
        total_disbursed: 0,
        total_fees: 0,
      })
    }

    return reply.success({
      balance: Number(balance.balance),
      total_deposited: Number(balance.totalDeposited),
      total_disbursed: Number(balance.totalDisbursed),
      total_fees: Number(balance.totalFees),
    })
  })

  // ══════════════════════════════════════════════════════════
  // INTERNAL TRANSFER (balance_available → disbursement_balance)
  // ══════════════════════════════════════════════════════════

  // ── POST /disbursements/transfer-in ─────────────────────
  // Pindahkan dana dari balance_available ke saldo disbursement.
  // Hanya ambil dari balanceAvailable (sudah settle), bukan balancePending.
  // Khusus disbursement_user — tanpa H+2 delay.
  fastify.post('/transfer-in', {
    preHandler: [requireDisbursementAccess],
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          amount: { type: 'number', minimum: 10000 },
        }
      }
    }
  }, async (request, reply) => {
    const clientId = request.client.id
    const amount = Math.round(request.body.amount)

    if (amount < 10000) {
      return reply.fail('VALIDATION_ERROR', 'Minimal transfer Rp 10.000', 422)
    }

    // Cek saldo available (sudah settle, bukan pending)
    const clientBalance = await db.clientBalance.findUnique({
      where: { clientId }
    })

    const available = Number(clientBalance?.balanceAvailable || 0)

    if (available < amount) {
      return reply.fail(
        'INSUFFICIENT_BALANCE',
        `Saldo tersedia Rp ${available.toLocaleString('id-ID')}, tidak cukup untuk transfer Rp ${amount.toLocaleString('id-ID')}.`,
        422
      )
    }

    // Atomic transaction:
    // 1. Kurangi balance_available
    // 2. Tambah disbursement_balance
    // 3. Insert ledger audit trail (debit_withdraw type for balance deduction)
    const now = new Date()

    await db.$transaction([
      // Debit dari balance_available
      db.clientBalance.update({
        where: { clientId },
        data: {
          balanceAvailable: { decrement: amount },
        }
      }),

      // Insert ledger entry sebagai audit trail
      db.balanceLedger.create({
        data: {
          clientId,
          type: 'debit_withdraw',
          amount,
          availableAt: now,
          settledAt: now,
          note: `Transfer ke saldo disbursement — Rp ${amount.toLocaleString('id-ID')}`,
        }
      }),

      // Credit ke disbursement balance
      db.disbursementBalance.upsert({
        where: { clientId },
        create: {
          clientId,
          balance: amount,
          totalDeposited: amount,
        },
        update: {
          balance: { increment: amount },
          totalDeposited: { increment: amount },
        }
      }),
    ])

    fastify.log.info(`[Disbursement] Transfer-in: ${request.client.email} moved Rp ${amount.toLocaleString('id-ID')} from balance_available to disbursement`)

    return reply.success({
      amount,
      message: `Berhasil memindahkan Rp ${amount.toLocaleString('id-ID')} ke saldo disbursement.`,
      balance_available_after: available - amount,
    })
  })

  // ══════════════════════════════════════════════════════════
  // DEPOSIT (via Flip Top-Up)
  // ══════════════════════════════════════════════════════════

  // ── POST /disbursements/deposit ─────────────────────────
  // Create deposit: generate Flip topup → user transfers manually
  // If a pending deposit exists and is < 2h old, resume it.
  // If > 2h old, auto-expire and allow new deposit.
  fastify.post('/deposit', {
    preHandler: [requireDisbursementAccess],
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'sender_bank'],
        properties: {
          amount: { type: 'integer', minimum: DISBURSEMENT.MIN_DEPOSIT },
          sender_bank: { type: 'string', maxLength: 50 },
        }
      }
    }
  }, async (request, reply) => {
    const { amount, sender_bank } = request.body
    const clientId = request.client.id

    const DEPOSIT_EXPIRY_MS = 2 * 60 * 60 * 1000  // 2 hours

    // Check for existing pending/confirmed deposits
    const existingDeposit = await db.disbursementDeposit.findFirst({
      where: {
        clientId,
        status: { in: ['pending', 'confirmed'] }
      },
      orderBy: { createdAt: 'desc' }
    })

    if (existingDeposit) {
      const age = Date.now() - new Date(existingDeposit.createdAt).getTime()

      if (age > DEPOSIT_EXPIRY_MS) {
        // Auto-expire: deposit terlalu lama, mark expired
        await db.disbursementDeposit.update({
          where: { id: existingDeposit.id },
          data: { status: 'expired' }
        })
        fastify.log.info(`[Disbursement] Auto-expired stale deposit ${existingDeposit.id} (age: ${Math.round(age / 60000)}m)`)
      } else {
        // Resume: return existing deposit data so user can continue
        return reply.success({
          deposit_id: existingDeposit.id,
          flip_topup_id: existingDeposit.flipTopupId,
          amount: Number(existingDeposit.amount),
          unique_code: existingDeposit.uniqueCode,
          total_transfer: Number(existingDeposit.totalTransfer),
          sender_bank: existingDeposit.senderBank,
          receiver_bank: existingDeposit.receiverBank,
          status: existingDeposit.status,
          resumed: true,
          message: `Deposit sebelumnya masih aktif. Silakan transfer Rp ${Number(existingDeposit.totalTransfer).toLocaleString('id-ID')}.`,
        })
      }
    }

    // Get Flip provider info
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, redis)

    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('NOT_CONFIGURED', 'Provider Flip belum dikonfigurasi.', 400)
    if (!provider.userId) return reply.fail('NOT_CONFIGURED', 'userId Flip belum tersedia.', 400)

    // Get Alaflip account number
    const token = await svc.getToken()
    let accountNumber
    try {
      const balData = await getAlaflipBalanceFull(provider.userId, token)
      fastify.log.info(`[Disbursement] Alaflip balance response: ${JSON.stringify(balData || {})}`)
      accountNumber = balData?.account_id
    } catch (e) {
      fastify.log.error(`[Disbursement] Alaflip balance fetch error: ${e.message}`)
    }

    if (!accountNumber) {
      return reply.fail('NOT_CONFIGURED', 'Account Alaflip tidak tersedia.', 400)
    }

    const idempotencyKey = `disb_deposit_${clientId}_${Date.now()}`

    // Create Flip topup
    try {
      const result = await svc.topup({
        senderBank: sender_bank,
        senderBankType: 'bank_account',
        amount,
        accountNumber,
        idempotencyKey,
      })

      // Save deposit record
      const deposit = await db.disbursementDeposit.create({
        data: {
          clientId,
          amount,
          uniqueCode: result.unique_code || 0,
          totalTransfer: amount + (result.unique_code || 0),
          senderBank: sender_bank.toLowerCase(),
          flipTopupId: String(result.id || ''),
          status: 'pending',
          receiverBank: result.flip_receiver_bank || null,
          idempotencyKey,
        }
      })

      fastify.log.info(`[Disbursement] Deposit created: ${deposit.id}, client=${clientId}, amount=${amount}`)

      return reply.success({
        deposit_id: deposit.id,
        flip_topup_id: deposit.flipTopupId,
        amount: Number(deposit.amount),
        unique_code: deposit.uniqueCode,
        total_transfer: Number(deposit.totalTransfer),
        sender_bank: deposit.senderBank,
        receiver_bank: deposit.receiverBank,
        status: deposit.status,
        message: `Transfer Rp ${Number(deposit.totalTransfer).toLocaleString('id-ID')} (termasuk kode unik) ke rekening yang tertera.`,
      }, 201)

    } catch (e) {
      fastify.log.error(`[Disbursement] Deposit failed: ${e.message}`)
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── POST /disbursements/deposit/:id/cancel ──────────────
  // Cancel a pending deposit (user closed modal / wants to create new one)
  fastify.post('/deposit/:id/cancel', {
    preHandler: [requireDisbursementAccess]
  }, async (request, reply) => {
    const deposit = await db.disbursementDeposit.findUnique({
      where: { id: request.params.id }
    })

    if (!deposit || deposit.clientId !== request.client.id) {
      return reply.fail('DISBURSEMENT_DEPOSIT_NOT_FOUND', 'Deposit tidak ditemukan.', 404)
    }

    if (!['pending', 'confirmed'].includes(deposit.status)) {
      return reply.fail('VALIDATION_ERROR', `Deposit sudah berstatus ${deposit.status}, tidak bisa dibatalkan.`, 422)
    }

    await db.disbursementDeposit.update({
      where: { id: deposit.id },
      data: { status: 'cancelled' }
    })

    fastify.log.info(`[Disbursement] Deposit ${deposit.id} cancelled by user`)

    return reply.success({
      deposit_id: deposit.id,
      status: 'cancelled',
      message: 'Deposit dibatalkan. Anda bisa membuat deposit baru.',
    })
  })

  // ── POST /disbursements/deposit/:id/confirm ─────────────
  // User confirms they have transferred
  fastify.post('/deposit/:id/confirm', {
    preHandler: [requireDisbursementAccess]
  }, async (request, reply) => {
    const deposit = await db.disbursementDeposit.findUnique({
      where: { id: request.params.id }
    })

    if (!deposit || deposit.clientId !== request.client.id) {
      return reply.fail('DISBURSEMENT_DEPOSIT_NOT_FOUND', 'Deposit tidak ditemukan.', 404)
    }

    if (deposit.status !== 'pending') {
      return reply.fail('VALIDATION_ERROR', `Deposit sudah berstatus ${deposit.status}.`, 422)
    }

    // Confirm via Flip
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, redis)
    const flipId = deposit.flipTopupId?.replace(/^FT/, '')

    try {
      const idempotencyKey = `disb_confirm_${deposit.id}_${Date.now()}`
      await svc.confirmTopup(flipId, idempotencyKey)

      await db.disbursementDeposit.update({
        where: { id: deposit.id },
        data: { status: 'confirmed', confirmedAt: new Date() }
      })

      return reply.success({
        deposit_id: deposit.id,
        status: 'confirmed',
        message: 'Konfirmasi berhasil. Menunggu verifikasi dari Flip.',
      })
    } catch (e) {
      fastify.log.error(`[Disbursement] Deposit confirm failed: ${e.message}`)
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── GET /disbursements/deposit/:id/status ────────────────
  // Poll deposit status
  fastify.get('/deposit/:id/status', {
    preHandler: [requireDisbursementAccess]
  }, async (request, reply) => {
    const deposit = await db.disbursementDeposit.findUnique({
      where: { id: request.params.id }
    })

    if (!deposit || deposit.clientId !== request.client.id) {
      return reply.fail('DISBURSEMENT_DEPOSIT_NOT_FOUND', 'Deposit tidak ditemukan.', 404)
    }

    // If already done, return immediately
    if (deposit.status === 'done' || deposit.status === 'failed' || deposit.status === 'expired') {
      return reply.success({
        deposit_id: deposit.id,
        status: deposit.status,
        amount: Number(deposit.amount),
        completed_at: deposit.completedAt,
      })
    }

    // Poll Flip for status
    if (deposit.status === 'confirmed' && deposit.flipTopupId) {
      const { createPaymentProviderService } = await import('../services/paymentProvider.js')
      const svc = createPaymentProviderService(db, redis)
      const flipId = deposit.flipTopupId.replace(/^FT/, '')

      try {
        const result = await svc.getTopupStatus(flipId)
        const flipStatus = result.status

        if (flipStatus === 'DONE' || flipStatus === 'PROCESSED') {
          // Credit disbursement balance
          const now = new Date()
          const depositAmount = Number(deposit.amount)

          await db.$transaction([
            db.disbursementDeposit.update({
              where: { id: deposit.id },
              data: { status: 'done', completedAt: now }
            }),
            db.disbursementBalance.upsert({
              where: { clientId: deposit.clientId },
              create: {
                clientId: deposit.clientId,
                balance: depositAmount,
                totalDeposited: depositAmount,
              },
              update: {
                balance: { increment: depositAmount },
                totalDeposited: { increment: depositAmount },
              }
            }),
          ])

          fastify.log.info(`[Disbursement] Deposit ${deposit.id} completed: +Rp ${depositAmount}`)

          return reply.success({
            deposit_id: deposit.id,
            status: 'done',
            amount: depositAmount,
            completed_at: now,
            message: `Saldo berhasil ditambahkan Rp ${depositAmount.toLocaleString('id-ID')}`,
          })
        }

        return reply.success({
          deposit_id: deposit.id,
          status: deposit.status,
          flip_status: flipStatus,
          amount: Number(deposit.amount),
        })
      } catch (e) {
        fastify.log.error(`[Disbursement] Deposit status poll failed: ${e.message}`)
        return reply.success({
          deposit_id: deposit.id,
          status: deposit.status,
          amount: Number(deposit.amount),
        })
      }
    }

    return reply.success({
      deposit_id: deposit.id,
      status: deposit.status,
      amount: Number(deposit.amount),
    })
  })

  // ── GET /disbursements/deposits ──────────────────────────
  // Deposit history
  fastify.get('/deposits', {
    preHandler: [requireDisbursementAccess],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20 } = request.query
    const clientId = request.client.id

    const [deposits, total] = await Promise.all([
      db.disbursementDeposit.findMany({
        where: { clientId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.disbursementDeposit.count({ where: { clientId } })
    ])

    const mapped = deposits.map(d => ({
      id: d.id,
      amount: Number(d.amount),
      unique_code: d.uniqueCode,
      total_transfer: Number(d.totalTransfer),
      sender_bank: d.senderBank,
      status: d.status,
      created_at: d.createdAt,
      confirmed_at: d.confirmedAt,
      completed_at: d.completedAt,
    }))

    return reply.paginated(mapped, {
      page, per_page, total, total_pages: Math.ceil(total / per_page)
    })
  })

  // ══════════════════════════════════════════════════════════
  // BANK LIST & INQUIRY
  // ══════════════════════════════════════════════════════════

  // ── GET /disbursements/banks ─────────────────────────────
  fastify.get('/banks', {
    preHandler: [requireDisbursementAccess]
  }, async (request, reply) => {
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, redis)

    try {
      const banks = await svc.getBankList()
      return reply.success(banks)
    } catch (e) {
      return reply.fail('INTERNAL_ERROR', e.message, 502)
    }
  })

  // ── POST /disbursements/inquiry ──────────────────────────
  fastify.post('/inquiry', {
    preHandler: [requireDisbursementAccess],
    schema: {
      body: {
        type: 'object',
        required: ['account_number', 'bank'],
        properties: {
          account_number: { type: 'string', minLength: 1, maxLength: 30 },
          bank: { type: 'string', minLength: 1, maxLength: 50 },
        }
      }
    }
  }, async (request, reply) => {
    const { account_number, bank } = request.body

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, redis)

    try {
      const result = await svc.checkAccount(account_number, bank)
      return reply.success(result)
    } catch (e) {
      if (e.code === 'BANK_INVALID') {
        return reply.fail('VALIDATION_ERROR', e.message, 422)
      }
      if (e.status === 422) {
        return reply.fail('LOOKUP_ACCOUNT_NOT_FOUND', e.message, 422)
      }
      return reply.fail('LOOKUP_SERVICE_ERROR', e.message, 502)
    }
  })

  // ══════════════════════════════════════════════════════════
  // TRANSFER (DISBURSEMENT)
  // ══════════════════════════════════════════════════════════

  // ── POST /disbursements/transfer ────────────────────────
  fastify.post('/transfer', {
    preHandler: [requireDisbursementAccess],
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'destination_bank', 'destination_account', 'destination_name'],
        properties: {
          amount: { type: 'number', minimum: DISBURSEMENT.MIN_AMOUNT },
          destination_bank: { type: 'string', maxLength: 50 },
          destination_account: { type: 'string', maxLength: 50 },
          destination_name: { type: 'string', maxLength: 100 },
          note: { type: 'string', maxLength: 255 },
        }
      }
    }
  }, async (request, reply) => {
    const { amount, destination_bank, destination_account, destination_name, note } = request.body
    const clientId = request.client.id
    const source = request.authMethod === 'api_key' ? 'api' : 'dashboard'

    const fee = getDisbursementFee(amount)
    const totalDeducted = amount + fee

    // 1. Cek saldo cukup
    const balance = await db.disbursementBalance.findUnique({
      where: { clientId }
    })

    if (!balance || Number(balance.balance) < totalDeducted) {
      return reply.fail(
        'DISBURSEMENT_INSUFFICIENT_BALANCE',
        `Saldo tidak cukup. Diperlukan Rp ${totalDeducted.toLocaleString('id-ID')} (termasuk biaya Rp ${fee.toLocaleString('id-ID')}). Saldo saat ini: Rp ${(Number(balance?.balance) || 0).toLocaleString('id-ID')}.`,
        422
      )
    }

    // 2. Generate idempotency key
    const idempotencyKey = `disb_${clientId}_${crypto.randomUUID()}`

    // 3. Atomic: create disbursement + debit balance
    const [disbursement] = await db.$transaction([
      db.disbursement.create({
        data: {
          clientId,
          amount,
          fee,
          totalDeducted,
          destinationBank: destination_bank.toUpperCase(),
          destinationAccount: destination_account,
          destinationName: destination_name,
          idempotencyKey,
          source,
          note: note || null,
        }
      }),
      db.disbursementBalance.update({
        where: { clientId },
        data: {
          balance: { decrement: totalDeducted },
          totalDisbursed: { increment: amount },
          totalFees: { increment: fee },
        }
      }),
    ])

    // 4. Push ke BullMQ for Flip processing
    try {
      await flipQueue.add('disbursement-transfer', {
        disbursementId: disbursement.id,
        triggeredBy: source,
      })
      fastify.log.info(`[Disbursement] Transfer queued: ${disbursement.id}, client=${clientId}, amount=${amount}`)
    } catch (e) {
      fastify.log.error(`[Disbursement] Failed to queue transfer: ${e.message}`)
      // Don't fail the request — the disbursement is created, admin can retry
    }

    return reply.success({
      id: disbursement.id,
      amount: Number(disbursement.amount),
      fee: Number(disbursement.fee),
      total_deducted: Number(disbursement.totalDeducted),
      destination_bank: disbursement.destinationBank,
      destination_account: disbursement.destinationAccount,
      destination_name: disbursement.destinationName,
      status: disbursement.status,
      note: disbursement.note,
      created_at: disbursement.createdAt,
    }, 201)
  })

  // ── GET /disbursements/:id ──────────────────────────────
  // Get single disbursement status
  fastify.get('/:id', {
    preHandler: [requireDisbursementAccess],
    schema: {
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    // Avoid matching /balance, /banks, /deposits routes
    if (['balance', 'banks', 'deposits'].includes(request.params.id)) return

    const disbursement = await db.disbursement.findUnique({
      where: { id: request.params.id }
    })

    if (!disbursement || disbursement.clientId !== request.client.id) {
      return reply.fail('DISBURSEMENT_NOT_FOUND', 'Disbursement tidak ditemukan.', 404)
    }

    return reply.success({
      id: disbursement.id,
      amount: Number(disbursement.amount),
      fee: Number(disbursement.fee),
      total_deducted: Number(disbursement.totalDeducted),
      destination_bank: disbursement.destinationBank,
      destination_account: disbursement.destinationAccount,
      destination_name: disbursement.destinationName,
      status: disbursement.status,
      failure_reason: disbursement.failureReason,
      note: disbursement.note,
      source: disbursement.source,
      created_at: disbursement.createdAt,
      processed_at: disbursement.processedAt,
    })
  })

  // ── GET /disbursements ──────────────────────────────────
  // List disbursements (history)
  fastify.get('/', {
    preHandler: [requireDisbursementAccess],
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          status: { type: 'string', enum: ['pending', 'processing', 'success', 'failed'] },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status } = request.query
    const clientId = request.client.id

    const where = {
      clientId,
      ...(status && { status }),
    }

    const [disbursements, total] = await Promise.all([
      db.disbursement.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.disbursement.count({ where })
    ])

    const mapped = disbursements.map(d => ({
      id: d.id,
      amount: Number(d.amount),
      fee: Number(d.fee),
      total_deducted: Number(d.totalDeducted),
      destination_bank: d.destinationBank,
      destination_account: d.destinationAccount,
      destination_name: d.destinationName,
      status: d.status,
      failure_reason: d.failureReason,
      note: d.note,
      source: d.source,
      created_at: d.createdAt,
      processed_at: d.processedAt,
    }))

    return reply.paginated(mapped, {
      page, per_page, total, total_pages: Math.ceil(total / per_page)
    })
  })
}
