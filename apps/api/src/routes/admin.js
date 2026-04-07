// apps/api/src/routes/admin.js
// Admin-only endpoints — protected by isAdmin middleware

import { authenticate, checkClientStatus, isAdmin } from '../middleware/authenticate.js'
import { encrypt, decrypt } from '@payment-gateway/shared/crypto'
import { Queue } from 'bullmq'

function getFlipQueue() {
  const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
  return new Queue('flip', {
    connection: {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null
    }
  })
}

export async function adminRoutes(fastify) {
  const db = fastify.db
  const flipQueue = getFlipQueue()

  // All admin routes require: auth + active status + isAdmin
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)
  fastify.addHook('preHandler', isAdmin)

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
    ])

    // Build 7-day chart data
    const chartData = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      d.setHours(0, 0, 0, 0)
      const dateStr = d.toISOString().slice(0, 10)
      const dayEntries = dailyPaid.filter(e => e.paidAt && e.paidAt.toISOString().slice(0, 10) === dateStr)
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
      chart_7d: chartData,
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
          search: { type: 'string', maxLength: 100 },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, plan, search } = request.query

    const where = {
      id: { not: 'platform-owner-000000000000000' },
      ...(status && { status }),
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
        orderBy: { createdAt: 'desc' },
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
      auth_provider: client.authProvider,
      avatar_url: client.avatarUrl,
      created_at: client.createdAt,
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
          date_from: { type: 'string' },
          date_to: { type: 'string' },
        }
      }
    }
  }, async (request, reply) => {
    const { page = 1, per_page = 20, status, client_id, date_from, date_to } = request.query

    const where = {
      ...(status && { status }),
      ...(client_id && { clientId: client_id }),
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

      // Decode payload untuk response
      function decodeJwt(t) {
        try {
          const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
          const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
          return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
        } catch { return null }
      }
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

    function decodeJwt(t) {
      try {
        const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
      } catch { return null }
    }

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
        const balancePayload = decodeJwt(activeToken)
        const deviceId = balancePayload?.data?.device_identifier

        const balRes = await fetch(
          `https://customer.flip.id/alaflip/api/v1/users/${userId}/balance`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${activeToken}`,
              'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
              'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
              ...(deviceId ? { 'x-device-id': deviceId } : {}),
              'accept-language': 'en-ID',
              'content-language': 'en-ID',
              'content-type': 'application/x-www-form-urlencoded',
              'Host': 'customer.flip.id',
              'User-Agent': 'okhttp/4.10.0',
            }
          }
        )
        const balBody = await balRes.json().catch(() => ({}))
        results.alaflip_balance = {
          ok: balRes.ok,
          balance: balBody?.data?.balance ?? null,
          status: balBody?.data?.status ?? null,
          raw: balRes.ok ? undefined : balBody,
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
      function decodeJwt(t) {
        try {
          const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
          const padded = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
          return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
        } catch { return null }
      }
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
}

