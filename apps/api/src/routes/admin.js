// apps/api/src/routes/admin.js
// Admin-only endpoints — protected by isAdmin middleware

import { authenticate, checkClientStatus, isAdmin } from '../middleware/authenticate.js'
import { generateImpersonationToken } from '../utils/impersonation.js'
import { encrypt, decrypt } from '@payment-gateway/shared/crypto'
import { getAlaflipBalanceFull, decodeJwtPayload } from '@payment-gateway/shared/flip'
import { Queue } from 'bullmq'

// Queue prefix must match the scraper worker (apps/scraper/src/queues.js)
const ENV = process.env.NODE_ENV || 'development'
const QUEUE_PREFIX = ENV === 'production' ? 'bull' : `bull:${ENV}`

function getQueueConnection() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
  return {
    host: url.hostname,
    port: parseInt(url.port) || 6379,
    password: url.password || undefined,
    maxRetriesPerRequest: null
  }
}

function getFlipQueue() {
  return new Queue('flip', {
    connection: getQueueConnection(),
    prefix: QUEUE_PREFIX,
  })
}

export async function adminRoutes(fastify) {
  const db = fastify.db
  const flipQueue = getFlipQueue()
  const queueConnection = getQueueConnection()
  const scrapeQueue = new Queue('scrape', { connection: queueConnection, prefix: QUEUE_PREFIX })
  const matchQueue = new Queue('match', { connection: queueConnection, prefix: QUEUE_PREFIX })
  const webhookQueue = new Queue('webhook', { connection: queueConnection, prefix: QUEUE_PREFIX })

  // ── Shared helpers ──────────────────────────────────────
  // JWT decode — alias dari shared/flip (decodeJwtPayload)
  const decodeJwt = decodeJwtPayload

  // fetchAlaflipBalance — pakai shared/flip (single source of truth)
  async function fetchAlaflipBalance(token, userId) {
    return getAlaflipBalanceFull(userId, token)
  }

  // All admin routes require: auth + active status + isAdmin
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)
  fastify.addHook('preHandler', isAdmin)

  // ── GET /admin/queue-health ─────────────────────────────
  // Queue + worker health snapshot (BullMQ + Redis)
  fastify.get('/queue-health', async (_request, reply) => {
    const startedAt = Date.now()
    const queues = [
      ['scrape', scrapeQueue],
      ['match', matchQueue],
      ['webhook', webhookQueue],
      ['flip', flipQueue]
    ]

    let redisStatus = 'up'
    let redisLatencyMs = null
    try {
      const t0 = Date.now()
      await fastify.redis.ping()
      redisLatencyMs = Date.now() - t0
    } catch {
      redisStatus = 'down'
    }

    const queueSnapshots = await Promise.all(queues.map(async ([name, queue]) => {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed', 'paused')
        const failedJobs = await queue.getJobs(['failed'], 0, 2, true)
        const pending = Number(counts.waiting || 0) + Number(counts.active || 0) + Number(counts.delayed || 0)
        const failed = Number(counts.failed || 0)
        const state = failed > 0 ? 'warning' : pending > 0 ? 'busy' : 'idle'

        return {
          queue: name,
          state,
          counts: {
            waiting: Number(counts.waiting || 0),
            active: Number(counts.active || 0),
            delayed: Number(counts.delayed || 0),
            failed: failed,
            completed: Number(counts.completed || 0),
            paused: Number(counts.paused || 0),
          },
          failed_samples: failedJobs.map(j => ({
            id: String(j.id),
            name: j.name,
            failed_reason: j.failedReason || null,
            attempts_made: Number(j.attemptsMade || 0),
            timestamp: j.timestamp ? new Date(j.timestamp).toISOString() : null,
            finished_on: j.finishedOn ? new Date(j.finishedOn).toISOString() : null,
          }))
        }
      } catch (err) {
        return {
          queue: name,
          state: 'down',
          error: err.message || 'QUEUE_UNREACHABLE',
          counts: { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0, paused: 0 },
          failed_samples: []
        }
      }
    }))

    const summary = queueSnapshots.reduce((acc, q) => {
      acc.waiting += q.counts.waiting
      acc.active += q.counts.active
      acc.delayed += q.counts.delayed
      acc.failed += q.counts.failed
      acc.completed += q.counts.completed
      return acc
    }, { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 })

    return reply.success({
      generated_at: new Date().toISOString(),
      latency_ms: Date.now() - startedAt,
      queue_prefix: QUEUE_PREFIX,
      redis: {
        status: redisStatus,
        latency_ms: redisLatencyMs,
      },
      summary,
      queues: queueSnapshots,
    })
  })

  // ── POST /admin/queue-health/:queue/clear-failed ───────
  // Clear failed jobs for a specific queue (ops tool)
  fastify.post('/queue-health/:queue/clear-failed', {
    schema: {
      params: {
        type: 'object',
        required: ['queue'],
        properties: {
          queue: { type: 'string', enum: ['scrape', 'match', 'webhook', 'flip'] }
        }
      },
      body: {
        type: 'object',
        properties: {
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }
        }
      }
    }
  }, async (request, reply) => {
    const { queue: queueName } = request.params
    const limit = request.body?.limit || 200

    const queueMap = {
      scrape: scrapeQueue,
      match: matchQueue,
      webhook: webhookQueue,
      flip: flipQueue,
    }

    const targetQueue = queueMap[queueName]
    if (!targetQueue) {
      return reply.fail('VALIDATION_ERROR', 'Queue tidak valid', 422)
    }

    try {
      // Clean failed jobs older than now (grace=0), up to limit.
      const removed = await targetQueue.clean(0, limit, 'failed')
      return reply.success({
        queue: queueName,
        removed_count: Array.isArray(removed) ? removed.length : 0,
        limit,
        message: `Failed jobs pada queue "${queueName}" dibersihkan.`
      })
    } catch (err) {
      return reply.fail('INTERNAL_ERROR', err.message || 'Gagal membersihkan failed jobs', 500)
    }
  })

  // ── GET /admin/stats ─────────────────────────────────────
  // Platform-wide overview stats
  fastify.get('/stats', async (request, reply) => {
    const now = new Date()
    const today = new Date(now); today.setHours(0, 0, 0, 0)
    const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const last7Days = new Date(now); last7Days.setDate(last7Days.getDate() - 6); last7Days.setHours(0, 0, 0, 0)

    const [
      totalMerchants,
      activeMerchants,
      suspendedMerchants,
      invoicesToday,
      invoicesMonth,
      paidToday,
      paidMonth,
      pendingWithdrawals,
      totalWithdrawalsMonth,
      platformBalances,
      provider,
      channelCount,
      // 7-day daily paid invoices for mini chart
      dailyPaid,
      // Revenue: unique_code + langganan dari invoice paid bulan ini
      revenueUniqueCode,
      revenueSubscription,
    ] = await Promise.all([
      db.client.count({ where: { id: { not: 'platform-owner-000000000000000' } } }),
      db.client.count({ where: { status: 'active', id: { not: 'platform-owner-000000000000000' } } }),
      db.client.count({ where: { status: 'suspended' } }),
      db.invoice.count({ where: { createdAt: { gte: today } } }),
      db.invoice.count({ where: { createdAt: { gte: thisMonthStart } } }),
      db.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: today } }, _sum: { amount: true }, _count: true }),
      db.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: thisMonthStart } }, _sum: { amount: true }, _count: true }),
      db.withdrawal.count({ where: { status: { in: ['pending', 'failed'] } } }),
      db.withdrawal.aggregate({ where: { requestedAt: { gte: thisMonthStart }, status: { not: 'rejected' } }, _sum: { amount: true } }),
      db.clientBalance.aggregate({ _sum: { balanceAvailable: true, balancePending: true } }),
      db.paymentProvider.findUnique({ where: { providerName: 'flip' }, select: { balance: true, autoProcess: true, email: true } }),
      db.paymentChannel.count({ where: { deletedAt: null, isActive: true } }),
      db.invoice.groupBy({
        by: ['paidAt'],
        where: { status: 'paid', paidAt: { gte: last7Days } },
        _sum: { amount: true },
        _count: true,
      }),
      db.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: thisMonthStart } }, _sum: { uniqueCodeRevenue: true } }),
      db.invoice.aggregate({ where: { status: 'paid', paidAt: { gte: thisMonthStart }, invoiceNumber: { startsWith: 'SUB-' } }, _sum: { amount: true }, _count: true }),
    ])

    // Build 7-day chart data
    const fmtDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
    const chartData = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const dateStr = fmtDate(d)
      const dayEntries = dailyPaid.filter(e => e.paidAt && fmtDate(new Date(e.paidAt)) === dateStr)
      const volume = dayEntries.reduce((s, e) => s + Number(e._sum.amount || 0), 0)
      const count = dayEntries.reduce((s, e) => s + e._count, 0)
      chartData.push({ date: dateStr, volume, count })
    }

    return reply.success({
      merchants: {
        total: totalMerchants,
        active: activeMerchants,
        suspended: suspendedMerchants,
      },
      invoices: {
        today: invoicesToday,
        this_month: invoicesMonth,
        paid_today_count: paidToday._count,
        paid_today_volume: Number(paidToday._sum.amount || 0),
        paid_month_count: paidMonth._count,
        paid_month_volume: Number(paidMonth._sum.amount || 0),
      },
      withdrawals: {
        pending_count: pendingWithdrawals,
        month_volume: Number(totalWithdrawalsMonth._sum.amount || 0),
      },
      balances: {
        total_merchant_available: Number(platformBalances._sum.balanceAvailable || 0),
        total_merchant_pending: Number(platformBalances._sum.balancePending || 0),
        flip_balance: provider ? Number(provider.balance) : null,
      },
      system: {
        active_channels: channelCount,
        flip_auto_process: provider?.autoProcess ?? false,
        flip_email: provider?.email || null,
      },
      revenue: {
        unique_code_month: Number(revenueUniqueCode._sum.uniqueCodeRevenue || 0),
        subscription_month: Number(revenueSubscription._sum.amount || 0),
        subscription_count: revenueSubscription._count || 0,
      },
      chart_7d: chartData,
    })
  })

  // ── POST /admin/impersonate/:clientId ───────────────────────
  // Buat token impersonasi 15 menit untuk masuk sebagai user tertentu
  fastify.post('/impersonate/:clientId', async (request, reply) => {
    const { clientId } = request.params
    const adminEmail = request.client.email

    const target = await db.client.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, email: true, status: true }
    })

    if (!target) {
      return reply.fail('NOT_FOUND', 'Client tidak ditemukan', 404)
    }

    if (target.status !== 'active') {
      return reply.fail('CLIENT_SUSPENDED', 'Akun client ini di-suspend atau tidak aktif', 400)
    }

    // Tolak impersonate akun admin sendiri
    if (target.email === adminEmail) {
      return reply.fail('INVALID_REQUEST', 'Tidak bisa impersonate akun sendiri', 400)
    }

    const token = generateImpersonationToken(clientId, adminEmail)

    fastify.log.info(
      `[Impersonation] ${adminEmail} → ${target.email} (${target.id})`
    )

    return reply.success({
      access_token: token,
      expires_in: 900,
      client: {
        id: target.id,
        name: target.name,
        email: target.email,
      }
    })
  })

  // ── GET /admin/clients ───────────────────────────────────
  fastify.get('/clients', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['active', 'suspended', 'inactive'] },
          plan: { type: 'string', enum: ['free', 'subscription'] },
          role: { type: 'string', enum: ['merchant', 'disbursement_user'] },
          search: { type: 'string', maxLength: 100 },
          sort_by: { type: 'string', enum: ['created_at', 'name', 'balance', 'invoice_count'], default: 'created_at' },
          sort_order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, plan, role, search, sort_by = 'created_at', sort_order = 'desc' } = request.query

    const where = {
      id: { not: 'platform-owner-000000000000000' },
      ...(status && { status }),
      ...(role && { role }),
      ...(search && {
        OR: [
          { name: { contains: search } },
          { email: { contains: search } },
        ]
      }),
      ...(plan && {
        subscriptions: {
          some: {
            status: 'active',
            plan: { planType: plan }
          }
        }
      })
    }

    const [clients, total] = await Promise.all([
      db.client.findMany({
        where,
        include: {
          subscriptions: {
            where: { status: 'active' },
            include: { plan: true },
            take: 1,
          },
          balance: { select: { balanceAvailable: true, balancePending: true, totalEarned: true } },
          _count: { select: { invoices: true, paymentChannels: true } },
        },
        orderBy: sort_by === 'name' ? { name: sort_order }
          : sort_by === 'balance' ? { balance: { balanceAvailable: sort_order } }
          : sort_by === 'invoice_count' ? { invoices: { _count: sort_order } }
          : { createdAt: sort_order },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.client.count({ where })
    ])

    const mapped = clients.map(c => ({
      id: c.id,
      name: c.name,
      email: c.email,
      phone: c.phone,
      status: c.status,
      role: c.role,
      auth_provider: c.authProvider,
      avatar_url: c.avatarUrl,
      plan: c.subscriptions[0] ? {
        id: c.subscriptions[0].plan.id,
        name: c.subscriptions[0].plan.name,
        plan_type: c.subscriptions[0].plan.planType,
        current_period_end: c.subscriptions[0].currentPeriodEnd,
      } : null,
      balance_available: Number(c.balance?.balanceAvailable || 0),
      balance_pending: Number(c.balance?.balancePending || 0),
      total_earned: Number(c.balance?.totalEarned || 0),
      invoice_count: c._count.invoices,
      channel_count: c._count.paymentChannels,
      created_at: c.createdAt,
    }))

    return reply.paginated(mapped, {
      page, per_page, total,
      total_pages: Math.ceil(total / per_page)
    })
  })

  // ── GET /admin/clients/:id ───────────────────────────────
  fastify.get('/clients/:id', async (request, reply) => {
    const client = await db.client.findUnique({
      where: { id: request.params.id },
      include: {
        subscriptions: {
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
        },
        balance: true,
        paymentChannels: {
          where: { deletedAt: null },
          include: { channelState: true },
          orderBy: { createdAt: 'desc' },
        },
        kycDocument: { select: { id: true, status: true, fullName: true, ktpNumber: true, createdAt: true, reviewedAt: true, rejectionReason: true } },
        disbursementBalance: true,
        _count: { select: { invoices: true, withdrawals: true, apiKeys: true } },
      }
    })

    if (!client) return reply.fail('NOT_FOUND', 'Merchant tidak ditemukan', 404)

    const [recentInvoices, recentWithdrawals] = await Promise.all([
      db.invoice.findMany({
        where: { clientId: client.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, invoiceNumber: true, amount: true, status: true, createdAt: true, paidAt: true }
      }),
      db.withdrawal.findMany({
        where: { clientId: client.id },
        orderBy: { requestedAt: 'desc' },
        take: 10,
      })
    ])

    return reply.success({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      status: client.status,
      role: client.role,
      auth_provider: client.authProvider,
      avatar_url: client.avatarUrl,
      created_at: client.createdAt,
      kyc: client.kycDocument ? {
        id: client.kycDocument.id,
        status: client.kycDocument.status,
        full_name: client.kycDocument.fullName,
        ktp_number: client.kycDocument.ktpNumber,
        rejection_reason: client.kycDocument.rejectionReason,
        submitted_at: client.kycDocument.createdAt,
        reviewed_at: client.kycDocument.reviewedAt,
      } : null,
      disbursement_balance: client.disbursementBalance ? {
        balance: Number(client.disbursementBalance.balance),
        total_deposited: Number(client.disbursementBalance.totalDeposited),
        total_disbursed: Number(client.disbursementBalance.totalDisbursed),
        total_fees: Number(client.disbursementBalance.totalFees),
      } : null,
      subscriptions: client.subscriptions.map(s => ({
        id: s.id,
        plan_id: s.planId,
        plan_name: s.plan.name,
        plan_type: s.plan.planType,
        status: s.status,
        current_period_start: s.currentPeriodStart,
        current_period_end: s.currentPeriodEnd,
      })),
      balance: {
        available: Number(client.balance?.balanceAvailable || 0),
        pending: Number(client.balance?.balancePending || 0),
        total_earned: Number(client.balance?.totalEarned || 0),
        total_withdrawn: Number(client.balance?.totalWithdrawn || 0),
      },
      channels: client.paymentChannels.map(ch => ({
        id: ch.id,
        channel_type: ch.channelType,
        channel_owner: ch.channelOwner,
        account_name: ch.accountName,
        account_number: ch.accountNumber,
        is_active: ch.isActive,
        circuit_state: ch.channelState?.circuitState || 'closed',
        last_scraped_at: ch.channelState?.lastScrapedAt,
      })),
      counts: {
        invoices: client._count.invoices,
        withdrawals: client._count.withdrawals,
        api_keys: client._count.apiKeys,
      },
      recent_invoices: recentInvoices.map(i => ({
        id: i.id,
        invoice_number: i.invoiceNumber,
        amount: Number(i.amount),
        status: i.status,
        created_at: i.createdAt,
        paid_at: i.paidAt,
      })),
      recent_withdrawals: recentWithdrawals.map(w => ({
        id: w.id,
        amount: Number(w.amount),
        amount_received: Number(w.amountReceived),
        destination_bank: w.destinationBank,
        destination_account: w.destinationAccount,
        destination_name: w.destinationName,
        status: w.status,
        requested_at: w.requestedAt,
        processed_at: w.processedAt,
      })),
    })
  })

  // ── PATCH /admin/clients/:id/status ─────────────────────
  fastify.patch('/clients/:id/status', {
    schema: {
      body: {
        type: 'object',
        required: ['status'],
        properties: {
          status: { type: 'string', enum: ['active', 'suspended'] }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { status } = request.body

    const client = await db.client.findUnique({ where: { id } })
    if (!client) return reply.fail('NOT_FOUND', 'Merchant tidak ditemukan', 404)
    if (client.email === process.env.ADMIN_EMAIL) {
      return reply.fail('FORBIDDEN', 'Tidak bisa suspend akun admin', 403)
    }

    await db.client.update({ where: { id }, data: { status } })

    fastify.log.info(`[Admin] Client ${id} status → ${status}`)
    return reply.success({ id, status, message: status === 'suspended' ? 'Akun merchant di-suspend' : 'Akun merchant diaktifkan kembali' })
  })

  // ── PATCH /admin/clients/:id/plan ───────────────────────
  fastify.patch('/clients/:id/plan', {
    schema: {
      body: {
        type: 'object',
        required: ['plan_id'],
        properties: {
          plan_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { plan_id } = request.body

    const [client, plan] = await Promise.all([
      db.client.findUnique({ where: { id } }),
      db.subscriptionPlan.findUnique({ where: { id: plan_id } })
    ])
    if (!client) return reply.fail('NOT_FOUND', 'Merchant tidak ditemukan', 404)
    if (!plan) return reply.fail('NOT_FOUND', 'Plan tidak ditemukan', 404)

    // Deactivate current active subscription, create new one
    await db.$transaction([
      db.clientSubscription.updateMany({
        where: { clientId: id, status: 'active' },
        data: { status: 'cancelled' }
      }),
      db.clientSubscription.create({
        data: {
          clientId: id,
          planId: plan_id,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        }
      })
    ])

    fastify.log.info(`[Admin] Client ${id} plan → ${plan_id}`)
    return reply.success({ id, plan_id, plan_name: plan.name, message: `Plan merchant diubah ke "${plan.name}"` })
  })

  // ── GET /admin/invoices ──────────────────────────────────
  fastify.get('/invoices', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['pending', 'user_confirmed', 'paid', 'expired', 'cancelled'] },
          client_id: { type: 'string' },
          search: { type: 'string' },
          invoice_number: { type: 'string' },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, client_id, search, invoice_number, date_from, date_to } = request.query
    const searchTerm = (search || invoice_number || '').trim()
    const digitsOnly = searchTerm.replace(/\D/g, '')
    const numericSearch = Number(digitsOnly)
    const hasNumericSearch = digitsOnly.length > 0 && Number.isFinite(numericSearch)

    const where = {
      ...(status && { status }),
      ...(client_id && { clientId: client_id }),
      ...(searchTerm && {
        OR: [
          { invoiceNumber: { contains: searchTerm } },
          ...(hasNumericSearch ? [{ amount: numericSearch }, { amountUnique: numericSearch }, { uniqueCode: numericSearch }] : []),
        ]
      }),
      ...(date_from || date_to ? {
        createdAt: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to + 'T23:59:59Z') }),
        }
      } : {})
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        include: {
          client: {
            select: {
              id: true, name: true, email: true, subscriptions: {
                where: { status: 'active' }, include: { plan: true }, take: 1
              }
            }
          },
          paymentChannel: { select: { channelType: true, accountName: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.invoice.count({ where })
    ])

    const mapped = invoices.map(i => ({
      id: i.id,
      invoice_number: i.invoiceNumber,
      client_id: i.clientId,
      client_name: i.client.name,
      client_email: i.client.email,
      client_plan_name: i.client.subscriptions?.[0]?.plan?.name || 'Free',
      client_plan_type: i.client.subscriptions?.[0]?.plan?.planType || 'free',
      amount: Number(i.amount),
      unique_code: i.uniqueCode,
      amount_unique: Number(i.amountUnique),
      status: i.status,
      source: i.source,
      channel_type: i.paymentChannel?.channelType || null,
      channel_account: i.paymentChannel?.accountName || null,
      channel_preference: i.channelPreference,
      customer_name: i.customerName,
      customer_email: i.customerEmail,
      created_at: i.createdAt,
      paid_at: i.paidAt,
      expired_at: i.expiredAt,
    }))

    return reply.paginated(mapped, {
      page, per_page, total,
      total_pages: Math.ceil(total / per_page)
    })
  })

  // ── GET /admin/invoices/:id ─────────────────────────────
  fastify.get('/invoices/:id', async (request, reply) => {
    const invoice = await db.invoice.findUnique({
      where: { id: request.params.id },
      include: {
        client: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            subscriptions: {
              where: { status: 'active' },
              include: { plan: true },
              take: 1
            }
          }
        },
        paymentChannel: {
          select: { id: true, channelType: true, accountName: true, accountNumber: true, channelOwner: true }
        },
        transactions: {
          select: {
            id: true, amount: true, referenceNumber: true,
            rawData: true, matchStatus: true, detectedAt: true
          },
          orderBy: { detectedAt: 'desc' }
        }
      }
    })

    if (!invoice) {
      return reply.fail('INVOICE_NOT_FOUND', 'Invoice tidak ditemukan', 404)
    }

    return reply.success({
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      client_id: invoice.clientId,
      client_name: invoice.client?.name,
      client_email: invoice.client?.email,
      client_role: invoice.client?.role,
      client_plan_name: invoice.client?.subscriptions?.[0]?.plan?.name || 'Free',
      client_plan_type: invoice.client?.subscriptions?.[0]?.plan?.planType || 'free',
      customer_name: invoice.customerName,
      customer_email: invoice.customerEmail,
      amount: Number(invoice.amount),
      amount_unique: Number(invoice.amountUnique),
      unique_code: invoice.uniqueCode,
      description: invoice.description,
      status: invoice.status,
      source: invoice.source,
      channel_preference: invoice.channelPreference,
      payment_url: invoice.paymentUrl,
      redirect_url: invoice.redirectUrl || null,
      payment_channel: invoice.paymentChannel ? {
        id: invoice.paymentChannel.id,
        channel_type: invoice.paymentChannel.channelType,
        channel_owner: invoice.paymentChannel.channelOwner,
        account_name: invoice.paymentChannel.accountName,
        account_number: invoice.paymentChannel.accountNumber
      } : null,
      transactions: invoice.transactions.map(t => ({
        id: t.id,
        amount: Number(t.amount),
        reference_number: t.referenceNumber,
        raw_data: t.rawData ? JSON.parse(t.rawData) : null,
        match_status: t.matchStatus,
        detected_at: t.detectedAt
      })),
      expired_at: invoice.expiredAt,
      paid_at: invoice.paidAt,
      confirmed_at: invoice.confirmedAt,
      created_at: invoice.createdAt
    })
  })

  // ── GET /admin/channels ──────────────────────────────────
  fastify.get('/channels', async (request, reply) => {
    const channels = await db.paymentChannel.findMany({
      where: { deletedAt: null },
      include: {
        client: { select: { id: true, name: true, email: true } },
        channelState: true,
        _count: { select: { invoices: { where: { status: { in: ['pending', 'user_confirmed'] } } } } },
      },
      orderBy: { createdAt: 'desc' },
    })

    const redis = fastify.redis
    const pipeline = redis.pipeline()
    for (const ch of channels) pipeline.get(`pg:session:${ch.id}`)
    const sessionResults = await pipeline.exec()

    const mapped = channels.map((ch, i) => {
      const [, sessionData] = sessionResults[i] || []
      const session = sessionData ? JSON.parse(sessionData) : null
      return {
        id: ch.id,
        channel_type: ch.channelType,
        channel_owner: ch.channelOwner,
        account_name: ch.accountName,
        account_number: ch.accountNumber,
        is_active: ch.isActive,
        client_id: ch.clientId,
        client_name: ch.client.name,
        client_email: ch.client.email,
        circuit_state: ch.channelState?.circuitState || 'closed',
        consecutive_errors: ch.channelState?.consecutiveErrors || 0,
        last_error_type: ch.channelState?.lastErrorType || null,
        last_error_message: ch.channelState?.lastErrorMessage || null,
        last_scraped_at: ch.channelState?.lastScrapedAt || null,
        last_success_at: ch.channelState?.lastSuccessAt || null,
        next_scrape_at: ch.channelState?.nextScrapeAt || null,
        scrape_priority: ch.channelState?.scrapePriority || 'medium',
        session_active: session?.isLoggedIn || false,
        session_updated_at: session?.updatedAt || null,
        pending_invoices: ch._count.invoices,
        created_at: ch.createdAt,
      }
    })

    return reply.success(mapped)
  })

  // ── GET /admin/provider ──────────────────────────────────
  fastify.get('/provider', async (request, reply) => {
    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('RESOURCE_NOT_FOUND', 'Payment provider belum dikonfigurasi.', 404)

    return reply.success({
      email: provider.email,
      user_id: provider.userId,
      balance: Number(provider.balance),
      auto_process: provider.autoProcess,
      token_expires_at: provider.tokenExpiresAt,
      updated_at: provider.updatedAt,
      has_token: !!provider.token,
      has_refresh: !!provider.refreshToken,
      has_pin: !!provider.pin,
    })
  })

  // ── PATCH /admin/provider ────────────────────────────────
  // Update Flip credentials — token & PIN will be encrypted before storing
  fastify.patch('/provider', {
    schema: {
      body: {
        type: 'object',
        properties: {
          email: { type: 'string', format: 'email' },
          user_id: { type: 'string', maxLength: 100 },
          token: { type: 'string', maxLength: 2000 }, // raw Bearer token dari Flip
          refresh_token: { type: 'string', maxLength: 500 },  // Flip refresh token
          pin: { type: 'string', minLength: 6, maxLength: 6, pattern: '^[0-9]{6}$' },
        }
      }
    }
  }, async (request, reply) => {
    const { email, user_id, token, refresh_token, pin } = request.body

    // At least one field required
    if (!email && !user_id && !token && !refresh_token && !pin) {
      return reply.fail('VALIDATION_ERROR', 'Minimal satu field harus diisi', 422)
    }

    const data = {}
    if (email) data.email = email
    if (user_id) data.userId = user_id
    if (token) data.token = encrypt(token)
    if (refresh_token) data.refreshToken = encrypt(refresh_token)
    if (pin) data.pin = encrypt(pin)

    // Jika token baru dimasukkan, invalidate tokenExpiresAt supaya lazy-refresh berjalan
    if (token) data.tokenExpiresAt = null

    // Upsert: jika provider belum ada, buat baru
    await db.paymentProvider.upsert({
      where: { providerName: 'flip' },
      update: data,
      create: {
        providerName: 'flip',
        email: email || 'unknown@flip.id',
        token: data.token || encrypt('placeholder'),
        pin: data.pin || encrypt('000000'),
        ...data,
      }
    })

    fastify.log.info(`[Admin] Payment provider updated: ${Object.keys(data).join(', ')}`)

    const updated = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    return reply.success({
      email: updated.email,
      user_id: updated.userId,
      balance: Number(updated.balance),
      auto_process: updated.autoProcess,
      token_expires_at: updated.tokenExpiresAt,
      updated_at: updated.updatedAt,
      has_token: !!updated.token,
      has_refresh: !!updated.refreshToken,
      has_pin: !!updated.pin,
      message: 'Konfigurasi Flip berhasil diperbarui'
    })
  })

  // ── PATCH /admin/provider/auto-process ──────────────────
  fastify.patch('/provider/auto-process', {
    schema: {
      body: {
        type: 'object',
        required: ['enabled'],
        properties: { enabled: { type: 'boolean' } }
      }
    }
  }, async (request, reply) => {
    const { enabled } = request.body
    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('RESOURCE_NOT_FOUND', 'Payment provider belum dikonfigurasi.', 404)

    await db.paymentProvider.update({ where: { providerName: 'flip' }, data: { autoProcess: enabled } })
    fastify.log.info(`[Admin] Auto-process toggled → ${enabled}`)

    return reply.success({
      auto_process: enabled,
      message: enabled
        ? 'Transfer otomatis diaktifkan — withdrawal akan diproses langsung via Flip.'
        : 'Transfer otomatis dinonaktifkan — withdrawal memerlukan persetujuan admin.'
    })
  })

  // ── GET /admin/withdrawals ───────────────────────────────
  fastify.get('/withdrawals', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['pending', 'processing', 'processed', 'failed', 'rejected'] }
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status } = request.query
    const where = status ? { status } : {}

    const [withdrawals, total] = await Promise.all([
      db.withdrawal.findMany({
        where,
        include: { client: { select: { id: true, name: true, email: true } } },
        orderBy: { requestedAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.withdrawal.count({ where })
    ])

    const mapped = withdrawals.map(w => ({
      id: w.id,
      client_id: w.clientId,
      client_name: w.client.name,
      client_email: w.client.email,
      amount: Number(w.amount),
      fee: Number(w.fee),
      amount_received: Number(w.amountReceived),
      destination_bank: w.destinationBank,
      destination_account: w.destinationAccount,
      destination_name: w.destinationName,
      status: w.status,
      rejection_reason: w.rejectionReason,
      retry_count: w.retryCount,
      flip_trx_id: w.flipTrxId,
      requested_at: w.requestedAt,
      processed_at: w.processedAt
    }))

    return reply.paginated(mapped, { page, per_page, total, total_pages: Math.ceil(total / per_page) })
  })

  // ── POST /admin/withdrawals/:id/process ─────────────────
  fastify.post('/withdrawals/:id/process', async (request, reply) => {
    const withdrawal = await db.withdrawal.findUnique({ where: { id: request.params.id } })
    if (!withdrawal) return reply.fail('WITHDRAWAL_NOT_FOUND', 'Withdrawal tidak ditemukan.', 404)

    if (!['pending', 'failed'].includes(withdrawal.status)) {
      return reply.fail('VALIDATION_ERROR', `Withdrawal dengan status "${withdrawal.status}" tidak bisa diproses ulang.`, 422)
    }

    await flipQueue.add('transfer', { withdrawalId: withdrawal.id, triggeredBy: 'admin' })
    fastify.log.info(`[Admin] Queued withdrawal ${withdrawal.id} for processing`)

    return reply.success({ id: withdrawal.id, message: 'Penarikan telah dijadwalkan untuk diproses.' })
  })

  // ── POST /admin/withdrawals/:id/reject ──────────────────
  fastify.post('/withdrawals/:id/reject', {
    schema: {
      body: {
        type: 'object',
        properties: { reason: { type: 'string', maxLength: 500 } }
      }
    }
  }, async (request, reply) => {
    const withdrawal = await db.withdrawal.findUnique({ where: { id: request.params.id } })
    if (!withdrawal) return reply.fail('WITHDRAWAL_NOT_FOUND', 'Withdrawal tidak ditemukan.', 404)

    if (!['pending', 'failed'].includes(withdrawal.status)) {
      return reply.fail('VALIDATION_ERROR', `Withdrawal dengan status "${withdrawal.status}" tidak bisa di-reject.`, 422)
    }

    const reason = request.body?.reason || 'Ditolak oleh admin'

    await db.$transaction([
      db.withdrawal.update({
        where: { id: withdrawal.id },
        data: { status: 'rejected', rejectionReason: reason, processedAt: new Date() }
      }),
      db.clientBalance.update({
        where: { clientId: withdrawal.clientId },
        data: {
          balanceAvailable: { increment: Number(withdrawal.amount) },
          totalWithdrawn: { decrement: Number(withdrawal.amount) }
        }
      }),
      db.balanceLedger.create({
        data: {
          clientId: withdrawal.clientId,
          withdrawalId: withdrawal.id,
          type: 'credit_available',
          amount: withdrawal.amount,
          availableAt: new Date(),
          note: `Refund penarikan ditolak: ${reason}`
        }
      })
    ])

    fastify.log.info(`[Admin] Rejected withdrawal ${withdrawal.id}: ${reason}`)
    return reply.success({ id: withdrawal.id, status: 'rejected', message: 'Penarikan ditolak dan saldo dikembalikan ke merchant.' })
  })

  // ── GET /admin/plans ─────────────────────────────────────
  fastify.get('/plans', async (request, reply) => {
    const plans = await db.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { monthlyPrice: 'asc' } })
    return reply.success(plans.map(p => ({
      id: p.id,
      name: p.name,
      plan_type: p.planType,
      max_channels: p.maxChannels,
      monthly_price: Number(p.monthlyPrice),
      can_add_own_channel: p.canAddOwnChannel,
    })))
  })

  // ── POST /admin/provider/refresh-token ──────────────────
  // Paksa refresh token Flip sekarang (tidak perlu tunggu expire)
  fastify.post('/provider/refresh-token', async (request, reply) => {
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const { decrypt } = await import('@payment-gateway/shared/crypto')
    const svc = createPaymentProviderService(db, fastify.redis)

    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('RESOURCE_NOT_FOUND', 'Payment provider belum dikonfigurasi.', 404)
    if (!provider.token) return reply.fail('VALIDATION_ERROR', 'Token belum ada di database.', 422)

    try {
      const newToken = await svc.refreshToken(provider)

      const payload = decodeJwt(newToken)

      fastify.log.info('[Admin] Flip token refreshed manually')
      return reply.success({
        message: 'Token berhasil diperbarui',
        user_id: payload?.data?.id,
        device_identifier: payload?.data?.device_identifier,
        expires_at: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
      })
    } catch (e) {
      fastify.log.error('[Admin] Token refresh failed:', e.message)
      return reply.fail('FLIP_API_ERROR', e.message, 502)
    }
  })

  // ── POST /admin/provider/test-connection ─────────────────
  // Jalankan serangkaian uji coba ke Flip API dan kembalikan hasilnya
  fastify.post('/provider/test-connection', {
    schema: {
      body: {
        type: 'object',
        properties: {
          // Opsional: cek rekening spesifik
          account_number: { type: 'string', maxLength: 30 },
          bank: { type: 'string', maxLength: 30 },
        }
      }
    }
  }, async (request, reply) => {
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const { decrypt } = await import('@payment-gateway/shared/crypto')
    const svc = createPaymentProviderService(db, fastify.redis)

    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('RESOURCE_NOT_FOUND', 'Payment provider belum dikonfigurasi.', 404)
    if (!provider.token) return reply.fail('VALIDATION_ERROR', 'Token belum ada di database.', 422)


    const results = {}

    // 1. Decode token saat ini
    const currentToken = decrypt(provider.token)
    const payload = decodeJwt(currentToken)
    const now = Math.floor(Date.now() / 1000)
    results.token_info = {
      ok: true,
      user_id: payload?.data?.id,
      email: payload?.data?.email,
      device_identifier: payload?.data?.device_identifier,
      device_model: payload?.data?.device_model,
      version: payload?.data?.version,
      expires_at: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
      is_expired: payload?.exp ? payload.exp <= now : true,
      seconds_remaining: payload?.exp ? Math.max(0, payload.exp - now) : 0,
    }

    // 2. Refresh token (untuk dapatkan token terbaru)
    try {
      const newToken = await svc.refreshToken(provider)
      const np = decodeJwt(newToken)
      results.refresh = {
        ok: true,
        device_identifier: np?.data?.device_identifier,
        expires_at: np?.exp ? new Date(np.exp * 1000).toISOString() : null,
      }
    } catch (e) {
      results.refresh = { ok: false, error: e.message }
    }

    // 3. Ambil token aktif (mungkin sudah diperbarui oleh refresh)
    let activeToken
    try {
      activeToken = await svc.getToken()
    } catch {
      activeToken = currentToken
    }

    // 4. List bank
    try {
      const banks = await svc.getBankList()
      results.bank_list = {
        ok: true,
        count: banks.length,
        sample: banks.filter(b => !b.isEwallet).slice(0, 5).map(b => `${b.code} (${b.name})`),
      }
    } catch (e) {
      results.bank_list = { ok: false, error: e.message }
    }

    // 5. Saldo Alaflip
    const userId = results.token_info.user_id || provider.userId
    if (userId) {
      try {
        const balData = await fetchAlaflipBalance(activeToken, userId)
        results.alaflip_balance = {
          ok: !!balData,
          balance: balData?.balance ?? null,
          status: balData?.status ?? null,
        }
      } catch (e) {
        results.alaflip_balance = { ok: false, error: e.message }
      }
    } else {
      results.alaflip_balance = { ok: false, error: 'userId tidak tersedia' }
    }

    // 6. Cek rekening (opsional)
    const { account_number, bank } = request.body || {}
    if (account_number && bank) {
      try {
        const acct = await svc.checkAccount(account_number, bank)
        results.check_account = { ok: true, ...acct }
      } catch (e) {
        results.check_account = { ok: false, error: e.message }
      }
    }

    fastify.log.info('[Admin] Flip test-connection ran')
    return reply.success(results)
  })

  // ── POST /admin/flip-login/activate-alaflip ──────────────
  // Ambil webview URL dari Flip → forward ke scraper HTTP → activateAlaflip() Playwright → POST /auth-code
  fastify.post('/flip-login/activate-alaflip', async (request, reply) => {
    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('NOT_CONFIGURED', 'Provider Flip belum dikonfigurasi', 400)
    if (!provider.userId) return reply.fail('NO_USER_ID', 'userId belum tersedia, perlu login ulang', 400)
    if (!provider.pin) return reply.fail('NO_PIN', 'PIN belum dikonfigurasi di provider', 400)

    const token = decrypt(provider.token)

    // Decode device_identifier dari JWT
    let deviceId
    try {
      const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
      const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
      deviceId = JSON.parse(Buffer.from(pad, 'base64').toString())?.data?.device_identifier
    } catch { /* optional */ }

    // Step 1: Ambil webview URL + headers dari Flip
    let webviewUrl, wvHeaders
    try {
      const res = await fetch(
        `https://customer.flip.id/alaflip/api/v1/users/${provider.userId}/webview-url`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
            'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
            ...(deviceId ? { 'x-device-id': deviceId } : {}),
            'content-type': 'application/json',
            'accept-language': 'en-ID',
            'content-language': 'en-ID',
            'Host': 'customer.flip.id',
            'User-Agent': 'okhttp/4.10.0',
          },
          body: JSON.stringify({
            redirect_url: 'flip://home',
            url_type: 'linkage',
            expired_token_redirect_url: 'flip://home',
            no_cam_permission_url: 'flip://open-camera-permission',
          })
        }
      )
      const body = await res.json().catch(() => ({}))
      webviewUrl = body?.data?.url
      wvHeaders = body?.data?.headers || {}
      if (!webviewUrl) throw new Error(body?.message || 'Webview URL tidak tersedia')
      fastify.log.info(`[Admin] Alaflip webview headers: ${Object.keys(wvHeaders).join(', ')}`)
    } catch (e) {
      return reply.fail('FLIP_ERROR', `Gagal ambil webview URL: ${e.message}`, 400)
    }

    fastify.log.info('[Admin] Alaflip webview URL obtained, forwarding to scraper...')

    // Step 2: Panggil scraper HTTP server (synchronous, 30–90 detik)
    // SCRAPER_URL di-set via env — di production gunakan nama container, contoh: http://sayabayar_scraper:3008
    const SCRAPER_URL = process.env.SCRAPER_URL || `http://localhost:${process.env.SCRAPER_PORT || '3008'}`
    try {
      const scraperRes = await fetch(`${SCRAPER_URL}/alaflip-activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webviewUrl,
          wvHeaders,
          userId: provider.userId,
          flipToken: token,
          deviceId,
        }),
        signal: AbortSignal.timeout(110_000),
      })
      const scraperBody = await scraperRes.json().catch(() => ({}))
      if (!scraperRes.ok) throw new Error(scraperBody.error || `Scraper ${scraperRes.status}`)

      fastify.log.info(`[Admin] Alaflip activated (${scraperBody.elapsed_ms}ms)`)
      return reply.success({
        message: `Aktivasi Alaflip berhasil! (${Math.round((scraperBody.elapsed_ms || 0) / 1000)}s)`,
        elapsed_ms: scraperBody.elapsed_ms,
      })
    } catch (e) {
      const isTimeout = e.name === 'TimeoutError'
      return reply.fail(
        isTimeout ? 'TIMEOUT' : 'SCRAPER_ERROR',
        isTimeout ? 'Timeout >110 detik. Cek log scraper.' : `Gagal: ${e.message}`,
        503
      )
    }
  })


  // ══════════════════════════════════════════════════════════
  // FLIP LOGIN WIZARD (4 langkah)
  //   POST /admin/flip-login/check        → cek apakah nomor terdaftar
  //   POST /admin/flip-login/request-otp  → kirim OTP via WA
  //   POST /admin/flip-login/verify-otp   → verifikasi OTP → simpan temp token di Redis
  //   POST /admin/flip-login/finalize     → verify PIN + device → simpan ke DB
  // ══════════════════════════════════════════════════════════

  // Konstanta perangkat yang dipakai (konsisten dengan device_identifier di JWT)
  const FLIP_DEVICE = {
    identifier: '7e3d6420-fee5-4ac9-b8d2-c6b3aca9b8e5',
    model: 'SM-G998B',
    name: 'samsung-galaxy-s21-ultra',  // label device di akun Flip (tidak mempengaruhi auth)
    os_version: 'Android 13',
    version: '402',
  }

  // Header dasar untuk unauthenticated requests
  function flipBaseHeaders(token = null, contentType = 'application/json') {
    return {
      'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
      'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
      'content-type': contentType,
      'accept-language': 'en-ID',
      'content-language': 'en-ID',
      'Host': 'customer.flip.id',
      'User-Agent': 'okhttp/4.10.0',
      'Connection': 'Keep-Alive',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(token ? { 'x-device-id': FLIP_DEVICE.identifier } : {}),
    }
  }

  async function flipPost(path, body, token = null) {
    const res = await fetch(`https://customer.flip.id${path}`, {
      method: 'POST',
      headers: flipBaseHeaders(token),
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || (json.code && json.code !== 2002)) {
      throw new Error(json.message || `HTTP ${res.status}`)
    }
    return json
  }

  // ── 1. Check nomor HP ────────────────────────────────────
  fastify.post('/flip-login/check', {
    schema: {
      body: {
        type: 'object', required: ['credential'],
        properties: { credential: { type: 'string' } }
      }
    }
  }, async (request, reply) => {
    const { credential } = request.body
    try {
      const json = await flipPost('/user-auth/api/v3.1/user/check', {
        credential,
        device_identifier: FLIP_DEVICE.identifier,
      })
      return reply.success({
        is_registered: json.data.is_registered,
        is_pin_registered: json.data.is_pin_registered,
        phone_masked: json.data.phone_number,
        email_masked: json.data.email,
      })
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 400)
    }
  })

  // ── 2. Request OTP ───────────────────────────────────────
  fastify.post('/flip-login/request-otp', {
    schema: {
      body: {
        type: 'object', required: ['credential'],
        properties: {
          credential: { type: 'string' },
          channel: { type: 'string', default: 'via-wa-by-service' },
        }
      }
    }
  }, async (request, reply) => {
    const { credential, channel = 'via-wa-by-service' } = request.body
    try {
      await flipPost('/user-auth/api/v3.1/auth/otp', {
        phone_number: '',
        credential,
        channel,
        device_identifier: FLIP_DEVICE.identifier,
      })
      fastify.log.info(`[FlipLogin] OTP sent to ${credential}`)
      return reply.success({ message: `OTP telah dikirim ke ${credential} via WhatsApp` })
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 400)
    }
  })

  // ── 3. Verify OTP → simpan temp token ke Redis ───────────
  fastify.post('/flip-login/verify-otp', {
    schema: {
      body: {
        type: 'object', required: ['credential', 'otp'],
        properties: {
          credential: { type: 'string' },
          otp: { type: 'string', minLength: 4, maxLength: 8 },
        }
      }
    }
  }, async (request, reply) => {
    const { credential, otp } = request.body
    try {
      const json = await flipPost('/user-auth/api/v3.1/auth/login', {
        credential,
        verification_code: otp,
        platform: 'android',
        device_model: FLIP_DEVICE.model,
        version: FLIP_DEVICE.version,
        os_version: FLIP_DEVICE.os_version,
        device_identifier: FLIP_DEVICE.identifier,
        request_id: crypto.randomUUID(),
        channel: 'via-wa-by-service',
      })

      const tempToken = json.data?.token
      if (!tempToken) throw new Error('Token tidak dikembalikan dari Flip')

      // Simpan temp token di Redis (TTL 10 menit)
      await fastify.redis.set(
        `pg:flip-login-temp:${request.client.id}`,
        tempToken,
        'EX', 600
      )

      fastify.log.info(`[FlipLogin] OTP verified for ${credential}`)
      return reply.success({ message: 'OTP terverifikasi. Masukkan PIN Flip untuk melanjutkan.' })
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 400)
    }
  })

  // ── 4. Finalize: verify PIN + device → simpan ke DB ─────
  fastify.post('/flip-login/finalize', {
    schema: {
      body: {
        type: 'object', required: ['pin'],
        properties: {
          pin: { type: 'string', minLength: 4, maxLength: 8 },
          email: { type: 'string' },
          user_id: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { pin, email, user_id } = request.body

    // Ambil temp token dari Redis
    const tempToken = await fastify.redis.get(`pg:flip-login-temp:${request.client.id}`)
    if (!tempToken) {
      return reply.fail('SESSION_EXPIRED', 'Sesi login habis. Mulai ulang proses OTP.', 400)
    }

    try {
      // 4a. PIN verify
      const pinRes = await flipPost('/user-auth/api/v3.1/auth/pin/verify', {
        pin,
        request_type: 1,
        key_one_time_password: true,
      }, tempToken)

      const deviceKey = pinRes.data?.keys?.verify_device
      if (!deviceKey) throw new Error('Device key tidak dikembalikan dari PIN verify')

      // 4b. Device verify
      const deviceRes = await flipPost('/user-auth/api/v3.1/auth/device/verify', {
        key: deviceKey,
        device_name: FLIP_DEVICE.name,
      }, tempToken)

      const finalToken = deviceRes.data?.token
      const refreshToken = deviceRes.data?.refresh_token
      if (!finalToken) throw new Error('Final token tidak dikembalikan dari device verify')

      // 4c. Simpan ke DB
      const { encrypt } = await import('@payment-gateway/shared/crypto')

      // Decode JWT untuk ambil user_id otomatis
      const payload = decodeJwt(finalToken)
      const flipEmail = email || payload?.data?.email || 'unknown@flip.id'
      const flipUserId = user_id || String(payload?.data?.id || '')

      await db.paymentProvider.upsert({
        where: { providerName: 'flip' },
        update: {
          email: flipEmail,
          userId: flipUserId,
          token: encrypt(finalToken),
          refreshToken: refreshToken ? encrypt(refreshToken) : undefined,
          pin: encrypt(pin),
          tokenExpiresAt: payload?.exp ? new Date(payload.exp * 1000) : null,
        },
        create: {
          providerName: 'flip',
          email: flipEmail,
          userId: flipUserId,
          token: encrypt(finalToken),
          refreshToken: refreshToken ? encrypt(refreshToken) : null,
          pin: encrypt(pin),
          tokenExpiresAt: payload?.exp ? new Date(payload.exp * 1000) : null,
        }
      })

      // Hapus temp token
      await fastify.redis.del(`pg:flip-login-temp:${request.client.id}`)

      fastify.log.info(`[FlipLogin] Login berhasil — userId: ${flipUserId}, expires: ${payload?.exp ? new Date(payload.exp * 1000).toISOString() : 'unknown'}`)

      return reply.success({
        message: 'Login Flip berhasil! Token dan refresh token tersimpan.',
        email: flipEmail,
        user_id: flipUserId,
        expires_at: payload?.exp ? new Date(payload.exp * 1000).toISOString() : null,
        has_token: true,
        has_refresh: !!refreshToken,
      })
    } catch (e) {
      fastify.log.error('[FlipLogin] Finalize error:', e.message)
      return reply.fail('FLIP_ERROR', e.message, 400)
    }
  })

  // ══════════════════════════════════════════════════════════
  // TRANSACTIONS MONITORING
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/transactions ─────────────────────────────
  fastify.get('/transactions', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          match_status: { type: 'string', enum: ['matched', 'unmatched', 'duplicate', 'manual'] },
          channel_id: { type: 'string' },
          amount: { type: 'number' },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, match_status, channel_id, amount, date_from, date_to } = request.query

    const where = {
      ...(match_status && { matchStatus: match_status }),
      ...(channel_id && { paymentChannelId: channel_id }),
      ...(amount && { amount }),
      ...(date_from || date_to ? {
        detectedAt: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to + 'T23:59:59Z') }),
        }
      } : {})
    }

    const [transactions, total] = await Promise.all([
      db.transaction.findMany({
        where,
        include: {
          invoice: { select: { id: true, invoiceNumber: true, amount: true, status: true, clientId: true } },
          paymentChannel: { select: { channelType: true, accountName: true, accountNumber: true } },
        },
        orderBy: { detectedAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.transaction.count({ where })
    ])

    const mapped = transactions.map(t => ({
      id: t.id,
      invoice_id: t.invoiceId,
      invoice_number: t.invoice?.invoiceNumber || null,
      payment_channel_id: t.paymentChannelId,
      channel_type: t.paymentChannel?.channelType || null,
      channel_account: t.paymentChannel?.accountName || null,
      amount: Number(t.amount),
      reference_number: t.referenceNumber,
      match_status: t.matchStatus,
      match_attempt: t.matchAttempt,
      last_match_attempt: t.lastMatchAttempt,
      detected_at: t.detectedAt,
    }))

    return reply.paginated(mapped, { page, per_page, total, total_pages: Math.ceil(total / per_page) })
  })

  // ── PATCH /admin/transactions/:id/match ──────────────────
  // Manual match: admin mencocokkan transaksi ke invoice tertentu
  fastify.patch('/transactions/:id/match', {
    schema: {
      body: {
        type: 'object',
        properties: {
          invoice_id: { type: 'string' },
          invoice_number: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { invoice_id, invoice_number } = request.body

    if (!invoice_id && !invoice_number) {
      return reply.fail('VALIDATION_ERROR', 'invoice_id atau invoice_number harus diisi', 422)
    }

    const transaction = await db.transaction.findUnique({ where: { id } })
    if (!transaction) return reply.fail('NOT_FOUND', 'Transaksi tidak ditemukan', 404)

    // Look up invoice by id or by invoice number
    const invoiceWhere = invoice_id ? { id: invoice_id } : { invoiceNumber: invoice_number }
    const invoiceInclude = {
      paymentChannel: { select: { channelOwner: true } },
      client: {
        select: {
          role: true,
          subscriptions: {
            where: { status: 'active' },
            select: { id: true },
            take: 1
          }
        }
      }
    }
    const invoice = await db.invoice.findUnique({ where: invoiceWhere, include: invoiceInclude })

    if (!invoice) return reply.fail('NOT_FOUND', 'Invoice tidak ditemukan', 404)
    if (invoice.status === 'paid') return reply.fail('VALIDATION_ERROR', 'Invoice sudah lunas', 422)
    if (transaction.matchStatus === 'matched') return reply.fail('VALIDATION_ERROR', 'Transaksi sudah ter-match', 422)

    const now = new Date()
    const settlementDate = new Date(now.getTime() + 2 * 24 * 60 * 60_000)
    const isOwnChannel = invoice.paymentChannel?.channelOwner === 'client'
    const isSubscription = invoice.invoiceNumber.startsWith('SUB-')

    const txOps = [
      db.transaction.update({
        where: { id },
        data: { invoiceId: invoice.id, matchStatus: 'matched', matchAttempt: { increment: 1 }, lastMatchAttempt: now }
      }),
      db.invoice.update({
        where: { id: invoice.id },
        data: { status: 'paid', paidAt: now }
      })
    ]

    if (!isSubscription && !isOwnChannel) {
      const invoiceAmount = Number(invoice.amount)
      const isDisbursementPro = invoice.client?.role === 'disbursement_user' && (invoice.client?.subscriptions?.length > 0)

      if (isDisbursementPro) {
        // Disbursement Pro: langsung available (tanpa H+2)
        const MDR_THRESHOLD = 500_000
        const MDR_RATE = 0.004 // 0.4%
        const mdrDeduction = invoiceAmount > MDR_THRESHOLD
          ? Math.round(invoiceAmount * MDR_RATE)
          : 0
        const creditAmount = invoiceAmount - mdrDeduction

        txOps.push(
          db.balanceLedger.create({
            data: {
              clientId: invoice.clientId,
              invoiceId: invoice.id,
              type: 'credit_available',
              amount: creditAmount,
              availableAt: now,
              settledAt: now,
              note: mdrDeduction > 0
                ? `Manual match — Invoice ${invoice.invoiceNumber} — instan (MDR 0.4%: -Rp ${mdrDeduction.toLocaleString('id-ID')})`
                : `Manual match — Invoice ${invoice.invoiceNumber} — instan (disbursement pro)`
            }
          }),
          db.clientBalance.upsert({
            where: { clientId: invoice.clientId },
            create: {
              clientId: invoice.clientId,
              balanceAvailable: creditAmount,
              totalEarned: creditAmount,
            },
            update: {
              balanceAvailable: { increment: creditAmount },
              totalEarned:      { increment: creditAmount }
            }
          })
        )

        if (mdrDeduction > 0) {
          txOps.push(
            db.balanceLedger.create({
              data: {
                clientId: invoice.clientId,
                invoiceId: invoice.id,
                type: 'mdr_fee',
                amount: mdrDeduction,
                availableAt: now,
                settledAt: now,
                note: `MDR 0.4% — Invoice ${invoice.invoiceNumber} (manual match, Rp ${invoiceAmount.toLocaleString('id-ID')})`
              }
            })
          )
        }

        fastify.log.info(`[Admin] Manual match: disbursement_pro → credit_available (instant) amount=${creditAmount}${mdrDeduction > 0 ? ` (MDR: -${mdrDeduction})` : ''}`)
      } else {
        // Regular user / Disbursement Free: masuk pending, settle H+2
        txOps.push(
          db.balanceLedger.create({
            data: {
              clientId: invoice.clientId,
              invoiceId: invoice.id,
              type: 'credit_pending',
              amount: invoiceAmount,
              availableAt: settlementDate,
              note: `Manual match oleh admin — Invoice ${invoice.invoiceNumber}`
            }
          }),
          db.clientBalance.update({
            where: { clientId: invoice.clientId },
            data: {
              balancePending: { increment: invoiceAmount },
              totalEarned: { increment: invoiceAmount }
            }
          })
        )
      }
    }

    await db.$transaction(txOps)

    // Publish SSE event + webhook
    try {
      await fastify.redis.publish('invoice_events', JSON.stringify({
        invoice_id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        client_id: invoice.clientId,
        event: 'invoice.paid',
        amount: Number(invoice.amount),
        paid_at: now.toISOString()
      }))
    } catch { /* redis publish is best-effort */ }

    fastify.log.info(`[Admin] Manual match: transaction ${id} → invoice ${invoice.invoiceNumber}`)
    return reply.success({ id, invoice_id, invoice_number: invoice.invoiceNumber, message: `Transaksi berhasil dicocokkan ke ${invoice.invoiceNumber}` })
  })

  // ══════════════════════════════════════════════════════════
  // SCRAPING LOGS
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/scraping-logs ─────────────────────────────
  fastify.get('/scraping-logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 30 },
          channel_id: { type: 'string' },
          status: { type: 'string', enum: ['success', 'transient', 'fatal'] },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 30, channel_id, status, date_from, date_to } = request.query

    const where = {
      ...(channel_id && { channelId: channel_id }),
      ...(status && { status }),
      ...(date_from || date_to ? {
        scrapedAt: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to + 'T23:59:59Z') }),
        }
      } : {})
    }

    const [logs, total] = await Promise.all([
      db.scrapingLog.findMany({
        where,
        orderBy: { scrapedAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.scrapingLog.count({ where })
    ])

    // Enrich with channel info
    const channelIds = [...new Set(logs.map(l => l.channelId))]
    const channels = channelIds.length > 0
      ? await db.paymentChannel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, channelType: true, accountName: true, accountNumber: true }
        })
      : []
    const channelMap = Object.fromEntries(channels.map(c => [c.id, c]))

    const mapped = logs.map(l => {
      const ch = channelMap[l.channelId]
      return {
        id: l.id,
        channel_id: l.channelId,
        channel_type: ch?.channelType || null,
        channel_account: ch?.accountName || null,
        status: l.status,
        error_type: l.errorType,
        error_message: l.errorMessage,
        tx_found: l.txFound,
        tx_new: l.txNew,
        duration_ms: l.durationMs,
        scraped_at: l.scrapedAt,
      }
    })

    return reply.paginated(mapped, { page, per_page, total, total_pages: Math.ceil(total / per_page) })
  })

  // ══════════════════════════════════════════════════════════
  // BALANCE LEDGER
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/ledger ───────────────────────────────────
  fastify.get('/ledger', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          client_id: { type: 'string' },
          type: { type: 'string', enum: ['credit_pending', 'credit_available', 'debit_withdraw'] },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, client_id, type, date_from, date_to } = request.query

    const where = {
      ...(client_id && { clientId: client_id }),
      ...(type && { type }),
      ...(date_from || date_to ? {
        createdAt: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to + 'T23:59:59Z') }),
        }
      } : {})
    }

    const [entries, total] = await Promise.all([
      db.balanceLedger.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true } },
          invoice: { select: { id: true, invoiceNumber: true } },
          withdrawal: { select: { id: true, destinationBank: true, destinationAccount: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.balanceLedger.count({ where })
    ])

    const mapped = entries.map(e => ({
      id: e.id,
      client_id: e.clientId,
      client_name: e.client.name,
      client_email: e.client.email,
      invoice_id: e.invoiceId,
      invoice_number: e.invoice?.invoiceNumber || null,
      withdrawal_id: e.withdrawalId,
      withdrawal_info: e.withdrawal ? `${e.withdrawal.destinationBank} ${e.withdrawal.destinationAccount}` : null,
      type: e.type,
      amount: Number(e.amount),
      available_at: e.availableAt,
      settled_at: e.settledAt,
      note: e.note,
      created_at: e.createdAt,
    }))

    return reply.paginated(mapped, { page, per_page, total, total_pages: Math.ceil(total / per_page) })
  })

  // ══════════════════════════════════════════════════════════
  // WEBHOOK LOGS
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/webhook-logs ─────────────────────────────
  fastify.get('/webhook-logs', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          success: { type: 'string', enum: ['true', 'false'] },
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, success, date_from, date_to } = request.query

    const where = {
      ...(success === 'true' && { httpStatus: { gte: 200, lt: 300 } }),
      ...(success === 'false' && { OR: [{ httpStatus: { lt: 200 } }, { httpStatus: { gte: 300 } }, { httpStatus: null }] }),
      ...(date_from || date_to ? {
        sentAt: {
          ...(date_from && { gte: new Date(date_from) }),
          ...(date_to && { lte: new Date(date_to + 'T23:59:59Z') }),
        }
      } : {})
    }

    const [logs, total] = await Promise.all([
      db.webhookLog.findMany({
        where,
        include: {
          webhook: { select: { url: true, clientId: true, client: { select: { name: true } } } },
          invoice: { select: { invoiceNumber: true, amount: true } },
        },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.webhookLog.count({ where })
    ])

    const mapped = logs.map(l => ({
      id: l.id,
      webhook_url: l.webhook.url,
      client_name: l.webhook.client?.name || null,
      invoice_number: l.invoice.invoiceNumber,
      invoice_amount: Number(l.invoice.amount),
      http_status: l.httpStatus,
      attempt_number: l.attemptNumber,
      response_body: l.responseBody?.slice(0, 200) || null,
      sent_at: l.sentAt,
    }))

    return reply.paginated(mapped, { page, per_page, total, total_pages: Math.ceil(total / per_page) })
  })

  // ══════════════════════════════════════════════════════════
  // CHANNEL MANAGEMENT
  // ══════════════════════════════════════════════════════════

  // ── PATCH /admin/channels/:id ───────────────────────────
  // Toggle active, reset circuit breaker
  fastify.patch('/channels/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          is_active: { type: 'boolean' },
          reset_circuit: { type: 'boolean' },
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { is_active, reset_circuit } = request.body

    const channel = await db.paymentChannel.findUnique({ where: { id }, include: { channelState: true } })
    if (!channel) return reply.fail('NOT_FOUND', 'Channel tidak ditemukan', 404)

    const ops = []
    const changes = []

    if (typeof is_active === 'boolean') {
      ops.push(db.paymentChannel.update({ where: { id }, data: { isActive: is_active } }))
      changes.push(`is_active → ${is_active}`)
    }

    if (reset_circuit && channel.channelState) {
      ops.push(db.channelState.update({
        where: { channelId: id },
        data: {
          circuitState: 'closed',
          consecutiveErrors: 0,
          circuitOpenedAt: null,
          lastErrorAt: null,
          lastErrorType: null,
          lastErrorMessage: null,
        }
      }))
      changes.push('circuit → closed')
    }

    if (ops.length === 0) return reply.fail('VALIDATION_ERROR', 'Tidak ada perubahan', 422)

    await db.$transaction(ops)

    fastify.log.info(`[Admin] Channel ${id}: ${changes.join(', ')}`)
    return reply.success({ id, changes, message: `Channel diperbarui: ${changes.join(', ')}` })
  })

  // ══════════════════════════════════════════════════════════
  // LEDGER STATS & MERCHANT BALANCES
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/ledger-stats ─────────────────────────────
  // Aggregate pending vs available balances
  fastify.get('/ledger-stats', async (request, reply) => {
    const now = new Date()
    const [balances, pendingSettlements] = await Promise.all([
      db.clientBalance.aggregate({
        _sum: { balancePending: true, balanceAvailable: true, totalEarned: true, totalWithdrawn: true }
      }),
      // Count pending credits & total amount waiting settlement
      db.balanceLedger.aggregate({
        where: { type: 'credit_pending', settledAt: null },
        _sum: { amount: true },
        _count: true,
      })
    ])

    return reply.success({
      total_pending: Number(balances._sum.balancePending || 0),
      total_available: Number(balances._sum.balanceAvailable || 0),
      total_earned: Number(balances._sum.totalEarned || 0),
      total_withdrawn: Number(balances._sum.totalWithdrawn || 0),
      pending_settlements: pendingSettlements._count || 0,
      pending_settlements_amount: Number(pendingSettlements._sum.amount || 0),
    })
  })

  // ── GET /admin/merchant-balances ────────────────────────
  // List merchants with available balance >= min_balance
  fastify.get('/merchant-balances', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          min_balance: { type: 'number', default: 52500 },
        }
      }
    }
  }, async (request, reply) => {
    const { min_balance = 52500 } = request.query

    const balances = await db.clientBalance.findMany({
      where: {
        balanceAvailable: { gte: min_balance },
        clientId: { not: 'platform-owner-000000000000000' },
      },
      include: {
        client: { select: { id: true, name: true, email: true, status: true } },
      },
      orderBy: { balanceAvailable: 'desc' },
    })

    const mapped = balances.map(b => ({
      client_id: b.clientId,
      client_name: b.client.name,
      client_email: b.client.email,
      client_status: b.client.status,
      balance_available: Number(b.balanceAvailable),
      balance_pending: Number(b.balancePending),
      total_earned: Number(b.totalEarned),
      total_withdrawn: Number(b.totalWithdrawn),
    }))

    const totalNeeded = mapped.reduce((s, m) => s + m.balance_available, 0)

    return reply.success({
      merchants: mapped,
      total_merchants: mapped.length,
      total_needed: totalNeeded,
    })
  })

  // ══════════════════════════════════════════════════════════
  // TOP-UP FLIP (Add Funds)
  // ══════════════════════════════════════════════════════════

  // ── POST /admin/topup-flip ──────────────────────────────
  // Buat top-up saldo Flip (superflip) dari bank transfer.
  // Flow: topup → mendapat ID + bank tujuan + unique_code → user transfer manual → confirm
  fastify.post('/topup-flip', {
    schema: {
      body: {
        type: 'object',
        required: ['amount', 'sender_bank'],
        properties: {
          amount: { type: 'integer', minimum: 10000 },
          sender_bank: { type: 'string', maxLength: 50 },
        }
      }
    }
  }, async (request, reply) => {
    const { amount, sender_bank } = request.body

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)

    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('NOT_CONFIGURED', 'Provider Flip belum dikonfigurasi.', 400)
    if (!provider.userId) return reply.fail('NO_USER_ID', 'userId belum tersedia.', 400)

    // Ambil account_number Alaflip
    const token = await svc.getToken()
    let accountNumber
    try {
      const balData = await fetchAlaflipBalance(token, provider.userId)
      fastify.log.info(`[Admin] Alaflip balance response: ${JSON.stringify(balData || {})}`)
      accountNumber = balData?.account_id
    } catch (e) {
      fastify.log.error(`[Admin] Alaflip balance fetch error: ${e.message}`)
    }
    if (!accountNumber) return reply.fail('NO_ACCOUNT', 'account_id Alaflip tidak tersedia. Pastikan Alaflip sudah diaktifkan.', 400)

    const idempotencyKey = `${provider.userId}_${Math.floor(Date.now() / 1000)}`

    try {
      const result = await svc.topup({
        senderBank: sender_bank,
        senderBankType: 'bank_account',
        amount,
        accountNumber,
        idempotencyKey,
      })

      fastify.log.info(`[Admin] Topup Flip created: ${result.id}, amount=${amount}, bank=${sender_bank}`)
      return reply.success({
        topup_id: result.id,
        amount: result.amount,
        unique_code: result.unique_code,
        total_transfer: result.amount + (result.unique_code || 0),
        status: result.status,
        sender_bank: result.sender_bank,
        receiver_bank: result.flip_receiver_bank,
        expired_at: result.expired_at ? new Date(result.expired_at * 1000).toISOString() : null,
        idempotency_key: idempotencyKey,
        message: `Transfer Rp ${(result.amount + (result.unique_code || 0)).toLocaleString('id-ID')} ke ${result.flip_receiver_bank?.bank?.toUpperCase() || 'bank'} (${result.flip_receiver_bank?.account_number || '-'}) a.n. ${result.flip_receiver_bank?.name || '-'}`,
      })
    } catch (e) {
      fastify.log.error(`[Admin] Topup Flip failed: ${e.message}`)
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── POST /admin/topup-flip/:id/confirm ──────────────────
  // Konfirmasi setelah transfer bank dilakukan
  fastify.post('/topup-flip/:id/confirm', async (request, reply) => {
    const topupId = request.params.id

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)

    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider) return reply.fail('NOT_CONFIGURED', 'Provider Flip belum dikonfigurasi.', 400)

    const idempotencyKey = `${provider.userId}_${Math.floor(Date.now() / 1000)}`

    try {
      const result = await svc.confirmTopup(topupId, idempotencyKey)
      fastify.log.info(`[Admin] Topup ${topupId} confirmed`)
      return reply.success({ topup_id: topupId, message: result.message || 'Top up confirmed', ...result })
    } catch (e) {
      fastify.log.error(`[Admin] Topup confirm failed: ${e.message}`)
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── GET /admin/topup-flip/coin-balance ──────────────────
  // Cek saldo Flip Coin
  fastify.get('/topup-flip/coin-balance', async (request, reply) => {
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)

    try {
      const amount = await svc.getCoinBalance()
      return reply.success({ coin_balance: amount })
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── GET /admin/topup-flip/alaflip-balance ──────────────
  // Saldo Alaflip LIVE dari Flip API (bukan DB)
  fastify.get('/topup-flip/alaflip-balance', async (request, reply) => {
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)

    const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
    if (!provider?.userId) return reply.fail('NOT_CONFIGURED', 'Provider belum dikonfigurasi', 400)

    try {
      const token = await svc.getToken()
      const balData = await fetchAlaflipBalance(token, provider.userId)
      const balance = balData?.balance ?? null

      // Sync ke DB juga
      if (balance !== null) {
        await db.paymentProvider.update({
          where: { providerName: 'flip' },
          data: { balance }
        })
      }

      return reply.success({
        balance,
        account_id: balData?.account_id || null,
        account_name: balData?.account_name || null,
      })
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── GET /admin/topup-flip/payment-methods ───────────────
  // Daftar bank & fee
  fastify.get('/topup-flip/payment-methods', {
    schema: {
      querystring: {
        type: 'object',
        properties: { amount: { type: 'integer', minimum: 10000, default: 50000 } }
      }
    }
  }, async (request, reply) => {
    const { amount = 50000 } = request.query

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)

    try {
      const result = await svc.getPaymentMethods(amount)
      return reply.success(result)
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ── GET /admin/topup-flip/:id/status ────────────────────
  // Polling status top-up (parametric route — harus setelah static routes)
  fastify.get('/topup-flip/:id/status', async (request, reply) => {
    const topupId = request.params.id

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)

    try {
      const result = await svc.getTopupStatus(topupId)
      const status = result.status

      // Jika topup selesai → fetch saldo terbaru & update DB
      let newBalance = null
      if (status === 'DONE' || status === 'PROCESSED') {
        try {
          const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
          if (provider?.userId) {
            const token = await svc.getToken()
            const balData = await fetchAlaflipBalance(token, provider.userId)
            newBalance = balData?.balance ?? null

            if (newBalance !== null) {
              await db.paymentProvider.update({
                where: { providerName: 'flip' },
                data: { balance: newBalance }
              })
              fastify.log.info(`[Admin] Flip balance updated after topup: Rp ${newBalance}`)
            }
          }
        } catch (e) {
          fastify.log.error(`[Admin] Failed to sync balance after topup: ${e.message}`)
        }
      }

      return reply.success({
        topup_id: result.id,
        amount: result.amount,
        unique_code: result.unique_code,
        status,
        sender_bank: result.sender_bank,
        receiver_bank: result.flip_receiver_bank,
        created_at: result.created_at ? new Date(result.created_at * 1000).toISOString() : null,
        confirmed_at: result.confirmed_at ? new Date(result.confirmed_at * 1000).toISOString() : null,
        completed_at: result.completed_at ? new Date(result.completed_at * 1000).toISOString() : null,
        ...(newBalance !== null ? { new_balance: newBalance } : {}),
      })
    } catch (e) {
      return reply.fail('FLIP_ERROR', e.message, 502)
    }
  })

  // ══════════════════════════════════════════════════════════
  // SUBSCRIPTION REPORT
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/subscriptions ────────────────────────────
  // Subscription overview: active subscribers, monthly revenue, renewal list
  fastify.get('/subscriptions', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          months: { type: 'integer', minimum: 1, maximum: 12, default: 6 },
        }
      }
    }
  }, async (request, reply) => {
    const { months = 6 } = request.query
    const now = new Date()

    // ── 1. Active subscriptions (paid plan) ──────────────
    const activeSubscriptions = await db.clientSubscription.findMany({
      where: {
        status: 'active',
        plan: { planType: 'subscription' },
      },
      include: {
        client: { select: { id: true, name: true, email: true, status: true } },
        plan: { select: { name: true, monthlyPrice: true } },
      },
      orderBy: { currentPeriodEnd: 'asc' },
    })

    const subscribers = activeSubscriptions.map(s => {
      const daysLeft = Math.ceil((new Date(s.currentPeriodEnd) - now) / (1000 * 60 * 60 * 24))
      return {
        client_id: s.clientId,
        client_name: s.client.name,
        client_email: s.client.email,
        client_status: s.client.status,
        plan_name: s.plan.name,
        monthly_price: Number(s.plan.monthlyPrice),
        period_start: s.currentPeriodStart,
        period_end: s.currentPeriodEnd,
        days_left: daysLeft,
        status: daysLeft <= 0 ? 'expired' : daysLeft <= 7 ? 'expiring_soon' : 'active',
        created_at: s.createdAt,
      }
    })

    // ── 2. Monthly revenue from SUB- invoices ────────────
    const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1)

    const subInvoices = await db.invoice.findMany({
      where: {
        invoiceNumber: { startsWith: 'SUB-' },
        status: 'paid',
        paidAt: { gte: startDate },
      },
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        paidAt: true,
        clientId: true,
        client: { select: { name: true, email: true } },
      },
      orderBy: { paidAt: 'desc' },
    })

    // Helper: format local YYYY-MM
    const fmtMonth = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`

    // Group by month
    const monthlyData = {}
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const key = fmtMonth(d)
      monthlyData[key] = { month: key, revenue: 0, count: 0, merchants: [] }
    }

    for (const inv of subInvoices) {
      const key = fmtMonth(new Date(inv.paidAt))
      if (monthlyData[key]) {
        monthlyData[key].revenue += Number(inv.amount)
        monthlyData[key].count += 1
        if (!monthlyData[key].merchants.find(m => m.client_id === inv.clientId)) {
          monthlyData[key].merchants.push({
            client_id: inv.clientId,
            client_name: inv.client.name,
            client_email: inv.client.email,
            amount: Number(inv.amount),
            paid_at: inv.paidAt,
            invoice_number: inv.invoiceNumber,
          })
        }
      }
    }

    const monthlyReport = Object.values(monthlyData).sort((a, b) => b.month.localeCompare(a.month))

    // ── 3. Summary stats ─────────────────────────────────
    const totalActiveSubscribers = subscribers.filter(s => s.status !== 'expired').length
    const expiringSoon = subscribers.filter(s => s.status === 'expiring_soon').length
    const thisMonthKey = fmtMonth(now)
    const thisMonthRevenue = monthlyData[thisMonthKey]?.revenue || 0
    const thisMonthCount = monthlyData[thisMonthKey]?.count || 0

    // Renewal rate: merchants who paid last month AND this month
    const lastMonthKey = fmtMonth(new Date(now.getFullYear(), now.getMonth() - 1, 1))
    const lastMonthMerchants = new Set((monthlyData[lastMonthKey]?.merchants || []).map(m => m.client_id))
    const thisMonthMerchants = new Set((monthlyData[thisMonthKey]?.merchants || []).map(m => m.client_id))
    const renewedCount = [...lastMonthMerchants].filter(id => thisMonthMerchants.has(id)).length
    const renewalRate = lastMonthMerchants.size > 0
      ? Math.round((renewedCount / lastMonthMerchants.size) * 100)
      : 0

    return reply.success({
      summary: {
        active_subscribers: totalActiveSubscribers,
        expiring_soon: expiringSoon,
        this_month_revenue: thisMonthRevenue,
        this_month_count: thisMonthCount,
        renewal_rate: renewalRate,
        renewed_count: renewedCount,
        last_month_count: lastMonthMerchants.size,
      },
      subscribers,
      monthly_report: monthlyReport,
    })
  })

  // ══════════════════════════════════════════════════════════
  // CLIENT ROLE MANAGEMENT
  // ══════════════════════════════════════════════════════════

  // ── PATCH /admin/clients/:id/role ────────────────────────
  // Upgrade/downgrade client role
  fastify.patch('/clients/:id/role', {
    schema: {
      body: {
        type: 'object',
        required: ['role'],
        properties: {
          role: { type: 'string', enum: ['merchant', 'disbursement_user'] }
        }
      }
    }
  }, async (request, reply) => {
    const { id } = request.params
    const { role } = request.body

    const client = await db.client.findUnique({ where: { id } })
    if (!client) return reply.fail('NOT_FOUND', 'Merchant tidak ditemukan', 404)

    if (client.role === role) {
      return reply.fail('VALIDATION_ERROR', `Role sudah ${role}`, 422)
    }

    await db.client.update({
      where: { id },
      data: { role }
    })

    // If upgrading to disbursement_user, ensure DisbursementBalance exists
    if (role === 'disbursement_user') {
      await db.disbursementBalance.upsert({
        where: { clientId: id },
        create: { clientId: id },
        update: {}
      })
    }

    fastify.log.info(`[Admin] Client ${client.email} (${id}): role → ${role}`)

    return reply.success({
      id,
      role,
      message: `Role berhasil diubah ke ${role === 'disbursement_user' ? 'Disbursement User' : 'Merchant'}`
    })
  })

  // ══════════════════════════════════════════════════════════
  // KYC MANAGEMENT
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/kyc ──────────────────────────────────────
  // List all KYC submissions
  fastify.get('/kyc', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status } = request.query

    const where = {
      ...(status && { status }),
    }

    const [docs, total] = await Promise.all([
      db.kycDocument.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true, role: true, status: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.kycDocument.count({ where })
    ])

    const mapped = docs.map(d => ({
      id: d.id,
      client_id: d.clientId,
      client_name: d.client.name,
      client_email: d.client.email,
      client_role: d.client.role,
      full_name: d.fullName,
      ktp_number: d.ktpNumber,
      status: d.status,
      rejection_reason: d.rejectionReason,
      reviewed_at: d.reviewedAt,
      created_at: d.createdAt,
    }))

    return reply.paginated(mapped, {
      page, per_page, total, total_pages: Math.ceil(total / per_page)
    })
  })

  // ── GET /admin/kyc/:id ──────────────────────────────────
  // KYC detail with presigned URLs for viewing images
  fastify.get('/kyc/:id', async (request, reply) => {
    const doc = await db.kycDocument.findUnique({
      where: { id: request.params.id },
      include: {
        client: { select: { id: true, name: true, email: true, role: true, status: true } },
      }
    })

    if (!doc) return reply.fail('KYC_NOT_FOUND', 'KYC tidak ditemukan', 404)

    // Generate presigned URLs for KTP and selfie
    let ktpUrl = null
    let selfieUrl = null

    if (fastify.minio?.s3) {
      try {
        ktpUrl = await fastify.minio.getUrl(doc.ktpImagePath, 3600)
        selfieUrl = await fastify.minio.getUrl(doc.selfieImagePath, 3600)
      } catch (e) {
        fastify.log.error(`[Admin] Failed to get presigned URLs: ${e.message}`)
      }
    }

    return reply.success({
      id: doc.id,
      client_id: doc.clientId,
      client_name: doc.client.name,
      client_email: doc.client.email,
      client_role: doc.client.role,
      full_name: doc.fullName,
      ktp_number: doc.ktpNumber,
      ktp_image_url: ktpUrl,
      selfie_image_url: selfieUrl,
      ktp_image_path: doc.ktpImagePath,
      selfie_image_path: doc.selfieImagePath,
      status: doc.status,
      rejection_reason: doc.rejectionReason,
      reviewed_by: doc.reviewedBy,
      reviewed_at: doc.reviewedAt,
      created_at: doc.createdAt,
      updated_at: doc.updatedAt,
    })
  })

  // ── POST /admin/kyc/:id/approve ─────────────────────────
  fastify.post('/kyc/:id/approve', async (request, reply) => {
    const doc = await db.kycDocument.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { id: true, email: true } } }
    })

    if (!doc) return reply.fail('KYC_NOT_FOUND', 'KYC tidak ditemukan', 404)
    if (doc.status === 'approved') return reply.fail('VALIDATION_ERROR', 'KYC sudah di-approve', 422)

    const now = new Date()
    const adminId = request.client.id

    await db.$transaction([
      db.kycDocument.update({
        where: { id: doc.id },
        data: {
          status: 'approved',
          rejectionReason: null,
          reviewedBy: adminId,
          reviewedAt: now,
        }
      }),
      // Ensure DisbursementBalance exists
      db.disbursementBalance.upsert({
        where: { clientId: doc.clientId },
        create: { clientId: doc.clientId },
        update: {}
      }),
    ])

    fastify.log.info(`[Admin] KYC approved: ${doc.client.email} (${doc.clientId})`)

    return reply.success({
      id: doc.id,
      status: 'approved',
      message: `KYC ${doc.client.email} berhasil di-approve.`,
    })
  })

  // ── POST /admin/kyc/:id/reject ──────────────────────────
  fastify.post('/kyc/:id/reject', {
    schema: {
      body: {
        type: 'object',
        required: ['reason'],
        properties: {
          reason: { type: 'string', minLength: 5, maxLength: 500 }
        }
      }
    }
  }, async (request, reply) => {
    const { reason } = request.body

    const doc = await db.kycDocument.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { id: true, email: true } } }
    })

    if (!doc) return reply.fail('KYC_NOT_FOUND', 'KYC tidak ditemukan', 404)
    if (doc.status === 'approved') return reply.fail('VALIDATION_ERROR', 'KYC sudah di-approve, tidak bisa ditolak', 422)

    await db.kycDocument.update({
      where: { id: doc.id },
      data: {
        status: 'rejected',
        rejectionReason: reason,
        reviewedBy: request.client.id,
        reviewedAt: new Date(),
      }
    })

    fastify.log.info(`[Admin] KYC rejected: ${doc.client.email} — ${reason}`)

    return reply.success({
      id: doc.id,
      status: 'rejected',
      message: `KYC ${doc.client.email} ditolak.`,
    })
  })

  // ══════════════════════════════════════════════════════════
  // DISBURSEMENT MONITORING
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/disbursements/stats ───────────────────────
  // Revenue stats: deposits, unique codes, fees, disbursements
  fastify.get('/disbursements/stats', async (request, reply) => {
    const [
      // Deposit stats
      totalDeposits,
      doneDeposits,
      uniqueCodeRevenue,
      // Disbursement stats
      totalDisbursements,
      successDisbursements,
      failedDisbursements,
      pendingDisbursements,
      feeRevenue,
      totalDisbursedAmount,
      // User stats
      activeUsers,
    ] = await Promise.all([
      db.disbursementDeposit.count(),
      db.disbursementDeposit.count({ where: { status: 'done' } }),
      db.disbursementDeposit.aggregate({
        where: { status: 'done' },
        _sum: { uniqueCode: true, amount: true },
      }),
      db.disbursement.count(),
      db.disbursement.count({ where: { status: 'success' } }),
      db.disbursement.count({ where: { status: 'failed' } }),
      db.disbursement.count({ where: { status: { in: ['pending', 'processing'] } } }),
      db.disbursement.aggregate({
        where: { status: 'success' },
        _sum: { fee: true },
      }),
      db.disbursement.aggregate({
        where: { status: 'success' },
        _sum: { amount: true },
      }),
      db.disbursementBalance.count(),
    ])

    return reply.success({
      deposits: {
        total: totalDeposits,
        done: doneDeposits,
        total_deposited: Number(uniqueCodeRevenue._sum.amount || 0),
        unique_code_revenue: Number(uniqueCodeRevenue._sum.uniqueCode || 0),
      },
      disbursements: {
        total: totalDisbursements,
        success: successDisbursements,
        failed: failedDisbursements,
        pending: pendingDisbursements,
        total_disbursed: Number(totalDisbursedAmount._sum.amount || 0),
        fee_revenue: Number(feeRevenue._sum.fee || 0),
      },
      platform_revenue: Number(uniqueCodeRevenue._sum.uniqueCode || 0) + Number(feeRevenue._sum.fee || 0),
      active_users: activeUsers,
    })
  })

  // ── GET /admin/disbursements ────────────────────────────
  // Monitor all disbursements across all clients
  fastify.get('/disbursements', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['pending', 'processing', 'success', 'failed'] },
          client_id: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, client_id } = request.query

    const where = {
      ...(status && { status }),
      ...(client_id && { clientId: client_id }),
    }

    const [disbursements, total] = await Promise.all([
      db.disbursement.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.disbursement.count({ where })
    ])

    const mapped = disbursements.map(d => ({
      id: d.id,
      client_id: d.clientId,
      client_name: d.client.name,
      client_email: d.client.email,
      amount: Number(d.amount),
      fee: Number(d.fee),
      total_deducted: Number(d.totalDeducted),
      destination_bank: d.destinationBank,
      destination_account: d.destinationAccount,
      destination_name: d.destinationName,
      status: d.status,
      failure_reason: d.failureReason,
      flip_trx_id: d.flipTrxId,
      source: d.source,
      note: d.note,
      created_at: d.createdAt,
      processed_at: d.processedAt,
    }))

    return reply.paginated(mapped, {
      page, per_page, total, total_pages: Math.ceil(total / per_page)
    })
  })

  // ── POST /admin/disbursements/:id/retry ─────────────────
  // Retry a failed disbursement
  fastify.post('/disbursements/:id/retry', async (request, reply) => {
    const disbursement = await db.disbursement.findUnique({
      where: { id: request.params.id }
    })

    if (!disbursement) return reply.fail('DISBURSEMENT_NOT_FOUND', 'Disbursement tidak ditemukan', 404)
    if (disbursement.status !== 'failed') {
      return reply.fail('VALIDATION_ERROR', `Hanya disbursement dengan status "failed" yang bisa di-retry. Status saat ini: ${disbursement.status}`, 422)
    }

    // Re-deduct balance (karena markDisbursementFailed sudah refund)
    const balance = await db.disbursementBalance.findUnique({
      where: { clientId: disbursement.clientId }
    })

    if (!balance || Number(balance.balance) < Number(disbursement.totalDeducted)) {
      return reply.fail('INSUFFICIENT_BALANCE', `Saldo user tidak cukup untuk retry. Perlu Rp ${Number(disbursement.totalDeducted).toLocaleString('id-ID')}`, 422)
    }

    // Atomic: potong saldo + reset status
    await db.$transaction([
      db.disbursementBalance.update({
        where: { clientId: disbursement.clientId },
        data: {
          balance:        { decrement: Number(disbursement.totalDeducted) },
          totalDisbursed: { increment: Number(disbursement.amount) },
          totalFees:      { increment: Number(disbursement.fee) },
        }
      }),
      db.disbursement.update({
        where: { id: disbursement.id },
        data: { status: 'pending', failureReason: null, flipTrxId: null }
      }),
    ])

    // Re-queue
    try {
      await flipQueue.add('disbursement-transfer', {
        disbursementId: disbursement.id,
        triggeredBy: 'admin_retry',
      })
    } catch (e) {
      fastify.log.error(`[Admin] Failed to re-queue disbursement: ${e.message}`)
    }

    fastify.log.info(`[Admin] Disbursement ${disbursement.id} retried`)

    return reply.success({
      id: disbursement.id,
      status: 'pending',
      message: 'Disbursement di-retry dan akan segera diproses.',
    })
  })

  // ── POST /admin/disbursement-deposit ────────────────────
  // Admin manually adds disbursement balance to a client
  fastify.post('/disbursement-deposit', {
    schema: {
      body: {
        type: 'object',
        required: ['client_id', 'amount'],
        properties: {
          client_id: { type: 'string' },
          amount: { type: 'number', minimum: 1 },
          note: { type: 'string', maxLength: 255 },
        }
      }
    }
  }, async (request, reply) => {
    const { client_id, amount, note } = request.body

    const client = await db.client.findUnique({ where: { id: client_id } })
    if (!client) return reply.fail('NOT_FOUND', 'Client tidak ditemukan', 404)
    if (client.role !== 'disbursement_user') {
      return reply.fail('VALIDATION_ERROR', 'Client bukan disbursement_user', 422)
    }

    await db.disbursementBalance.upsert({
      where: { clientId: client_id },
      create: {
        clientId: client_id,
        balance: amount,
        totalDeposited: amount,
      },
      update: {
        balance: { increment: amount },
        totalDeposited: { increment: amount },
      }
    })

    fastify.log.info(`[Admin] Manual deposit: ${client.email} +Rp ${amount} ${note ? `(${note})` : ''}`)

    return reply.success({
      client_id,
      amount,
      message: `Saldo disbursement ${client.email} bertambah Rp ${amount.toLocaleString('id-ID')}`,
    })
  })

  // ══════════════════════════════════════════════════════════
  // DEPOSIT MANAGEMENT (disbursement_deposits)
  // ══════════════════════════════════════════════════════════

  // ── GET /admin/deposits ─────────────────────────────────
  // List all deposits with client info — for admin to find orphaned/stuck deposits
  fastify.get('/deposits', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          status: { type: 'string', enum: ['pending', 'confirmed', 'done', 'expired', 'failed'] },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status } = request.query
    const where = status ? { status } : {}

    const [deposits, total] = await Promise.all([
      db.disbursementDeposit.findMany({
        where,
        include: {
          client: { select: { id: true, name: true, email: true } }
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
      }),
      db.disbursementDeposit.count({ where }),
    ])

    return reply.success(deposits.map(d => ({
      id: d.id,
      client_id: d.clientId,
      client_name: d.client?.name || '-',
      client_email: d.client?.email || '-',
      amount: Number(d.amount),
      unique_code: d.uniqueCode,
      total_transfer: Number(d.totalTransfer),
      sender_bank: d.senderBank,
      flip_topup_id: d.flipTopupId || null,
      status: d.status,
      receiver_bank: d.receiverBank,
      created_at: d.createdAt,
      confirmed_at: d.confirmedAt,
      completed_at: d.completedAt,
    })), 200, { total, page, per_page })
  })

  // ── POST /admin/deposits/:id/check-flip ─────────────────
  // Admin manually check Flip topup status & credit balance if done
  fastify.post('/deposits/:id/check-flip', async (request, reply) => {
    const deposit = await db.disbursementDeposit.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { email: true } } }
    })

    if (!deposit) {
      return reply.fail('NOT_FOUND', 'Deposit tidak ditemukan', 404)
    }

    if (deposit.status === 'done') {
      return reply.fail('ALREADY_DONE', 'Deposit ini sudah berstatus done', 422)
    }

    if (!deposit.flipTopupId) {
      return reply.fail('NO_FLIP_ID', 'Deposit ini tidak memiliki flip_topup_id', 422)
    }

    // Check Flip status
    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)
    const flipId = deposit.flipTopupId.replace(/^FT/, '')

    try {
      const result = await svc.getTopupStatus(flipId)
      const flipStatus = result.status

      // If Flip says DONE/PROCESSED → credit balance
      if (flipStatus === 'DONE' || flipStatus === 'PROCESSED') {
        const now = new Date()
        const depositAmount = Number(deposit.amount)

        await db.$transaction([
          db.disbursementDeposit.update({
            where: { id: deposit.id },
            data: { status: 'done', completedAt: now, confirmedAt: deposit.confirmedAt || now }
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

        fastify.log.info(`[Admin] Deposit ${deposit.id} force-completed via Flip check: +Rp ${depositAmount} for ${deposit.client?.email}`)

        return reply.success({
          deposit_id: deposit.id,
          status: 'done',
          flip_status: flipStatus,
          amount: depositAmount,
          message: `Deposit berhasil diproses! Saldo +Rp ${depositAmount.toLocaleString('id-ID')}`,
        })
      }

      // Not done yet — just return current status
      return reply.success({
        deposit_id: deposit.id,
        status: deposit.status,
        flip_status: flipStatus,
        flip_raw: result,
        amount: Number(deposit.amount),
        message: `Status Flip: ${flipStatus}. Belum DONE/PROCESSED.`,
      })
    } catch (e) {
      fastify.log.error(`[Admin] Deposit check-flip failed: ${e.message}`)
      return reply.fail('FLIP_ERROR', `Gagal cek Flip: ${e.message}`, 502)
    }
  })

  // ── POST /admin/withdrawals/:id/check-flip ──────────────
  // Admin manually verify withdrawal status from Flip API
  fastify.post('/withdrawals/:id/check-flip', async (request, reply) => {
    const withdrawal = await db.withdrawal.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { email: true } } }
    })

    if (!withdrawal) return reply.fail('NOT_FOUND', 'Withdrawal tidak ditemukan', 404)
    if (!withdrawal.flipTrxId) return reply.fail('NO_FLIP_ID', 'Withdrawal tidak memiliki flip_trx_id', 422)

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)
    const flipId = withdrawal.flipTrxId.replace(/^FT/, '')

    try {
      const { getTransferStatus } = await import('@payment-gateway/shared/flip')
      const token = await svc.getToken()
      const result = await getTransferStatus(flipId, token)
      const flipStatus = (result?.status || '').toUpperCase()

      if (flipStatus === 'DONE' && withdrawal.status !== 'processed') {
        await db.withdrawal.update({
          where: { id: withdrawal.id },
          data: { status: 'processed' }
        })
        return reply.success({
          id: withdrawal.id, status: 'processed', flip_status: flipStatus,
          message: `Withdrawal verified DONE — status updated to processed.`
        })
      }

      if (['CANCELLED', 'FAILED', 'REJECTED'].includes(flipStatus) && !['failed', 'rejected'].includes(withdrawal.status)) {
        await db.$transaction([
          db.withdrawal.update({
            where: { id: withdrawal.id },
            data: { status: 'failed', rejectionReason: `Flip status: ${flipStatus} (admin re-verify)` }
          }),
          db.clientBalance.update({
            where: { clientId: withdrawal.clientId },
            data: {
              balanceAvailable: { increment: Number(withdrawal.amount) },
              totalWithdrawn: { decrement: Number(withdrawal.amount) }
            }
          }),
          db.balanceLedger.create({
            data: {
              clientId: withdrawal.clientId,
              withdrawalId: withdrawal.id,
              type: 'credit_available',
              amount: Number(withdrawal.amount),
              availableAt: new Date(),
              settledAt: new Date(),
              note: `Refund withdrawal — Flip ${flipStatus} (admin re-verify)`
            }
          })
        ])

        fastify.log.info(`[Admin] Withdrawal ${withdrawal.id} FAILED by Flip (${flipStatus}) — refunded Rp ${withdrawal.amount}`)
        return reply.success({
          id: withdrawal.id, status: 'failed', flip_status: flipStatus,
          message: `Withdrawal GAGAL di Flip (${flipStatus}). Saldo Rp ${Number(withdrawal.amount).toLocaleString('id-ID')} dikembalikan.`
        })
      }

      return reply.success({
        id: withdrawal.id, status: withdrawal.status, flip_status: flipStatus,
        flip_raw: result,
        message: `Status Flip: ${flipStatus}. Status DB: ${withdrawal.status}.`
      })
    } catch (e) {
      return reply.fail('FLIP_ERROR', `Gagal cek Flip: ${e.message}`, 502)
    }
  })

  // ── POST /admin/disbursements/:id/check-flip ────────────
  // Admin manually verify disbursement status from Flip API
  fastify.post('/disbursements/:id/check-flip', async (request, reply) => {
    const disbursement = await db.disbursement.findUnique({
      where: { id: request.params.id },
      include: { client: { select: { email: true } } }
    })

    if (!disbursement) return reply.fail('NOT_FOUND', 'Disbursement tidak ditemukan', 404)
    if (!disbursement.flipTrxId) return reply.fail('NO_FLIP_ID', 'Disbursement tidak memiliki flip_trx_id', 422)

    const { createPaymentProviderService } = await import('../services/paymentProvider.js')
    const svc = createPaymentProviderService(db, fastify.redis)
    const flipId = disbursement.flipTrxId.replace(/^FT/, '')

    try {
      const { getTransferStatus } = await import('@payment-gateway/shared/flip')
      const token = await svc.getToken()
      const result = await getTransferStatus(flipId, token)
      const flipStatus = (result?.status || '').toUpperCase()

      if (flipStatus === 'DONE' && disbursement.status !== 'success') {
        await db.disbursement.update({
          where: { id: disbursement.id },
          data: { status: 'success' }
        })
        return reply.success({
          id: disbursement.id, status: 'success', flip_status: flipStatus,
          message: `Disbursement verified DONE.`
        })
      }

      if (['CANCELLED', 'FAILED', 'REJECTED'].includes(flipStatus) && disbursement.status !== 'failed') {
        await db.$transaction([
          db.disbursement.update({
            where: { id: disbursement.id },
            data: { status: 'failed', failureReason: `Flip status: ${flipStatus} (admin re-verify)` }
          }),
          db.disbursementBalance.update({
            where: { clientId: disbursement.clientId },
            data: {
              balance: { increment: Number(disbursement.totalDeducted) },
              totalDisbursed: { decrement: Number(disbursement.amount) },
              totalFees: { decrement: Number(disbursement.fee) },
            }
          }),
        ])

        fastify.log.info(`[Admin] Disbursement ${disbursement.id} FAILED by Flip (${flipStatus}) — refunded Rp ${disbursement.totalDeducted}`)
        return reply.success({
          id: disbursement.id, status: 'failed', flip_status: flipStatus,
          message: `Disbursement GAGAL di Flip (${flipStatus}). Saldo Rp ${Number(disbursement.totalDeducted).toLocaleString('id-ID')} dikembalikan.`
        })
      }

      return reply.success({
        id: disbursement.id, status: disbursement.status, flip_status: flipStatus,
        flip_raw: result,
        message: `Status Flip: ${flipStatus}. Status DB: ${disbursement.status}.`
      })
    } catch (e) {
      return reply.fail('FLIP_ERROR', `Gagal cek Flip: ${e.message}`, 502)
    }
  })

  // ── POST /admin/fix/disbursement-pro-settlement ─────────
  // Koreksi settlement Disbursement Pro yang terlanjur masuk credit_pending
  fastify.post('/fix/disbursement-pro-settlement', async (request, reply) => {
    const proClients = await db.client.findMany({
      where: {
        role: 'disbursement_user',
        subscriptions: { some: { status: 'active' } }
      },
      select: { id: true, name: true, email: true }
    })

    if (proClients.length === 0) {
      return reply.success({ fixed: 0, message: 'Tidak ada Disbursement Pro user.' })
    }

    const proIds = proClients.map(c => c.id)

    const wrongEntries = await db.balanceLedger.findMany({
      where: {
        clientId: { in: proIds },
        type: 'credit_pending',
        settledAt: null
      },
      include: { invoice: { select: { invoiceNumber: true } } }
    })

    if (wrongEntries.length === 0) {
      return reply.success({ fixed: 0, message: 'Tidak ada entry yang perlu dikoreksi.' })
    }

    const now = new Date()
    let fixed = 0

    for (const entry of wrongEntries) {
      const amount = Number(entry.amount)
      await db.$transaction([
        db.balanceLedger.update({
          where: { id: entry.id },
          data: {
            type: 'credit_available',
            availableAt: now,
            settledAt: now,
            note: (entry.note || '').replace('settlement H+2', 'instan (koreksi disbursement pro)') || 'Koreksi: instan (disbursement pro)'
          }
        }),
        db.clientBalance.update({
          where: { clientId: entry.clientId },
          data: {
            balancePending:   { decrement: amount },
            balanceAvailable: { increment: amount }
          }
        })
      ])
      fixed++
      fastify.log.info(`[Fix] ${entry.invoice?.invoiceNumber || entry.id} — Rp ${amount} → credit_available`)
    }

    return reply.success({
      fixed,
      clients: proClients.map(c => c.name),
      message: `${fixed} entry dikoreksi dari credit_pending → credit_available.`
    })
  })
}
