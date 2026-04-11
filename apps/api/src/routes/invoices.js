// apps/api/src/routes/invoices.js
import { authenticate, checkClientStatus, getActivePlan } from '../middleware/authenticate.js'
import { INVOICE } from '@payment-gateway/shared/constants'
import { randomBytes } from 'crypto'

/** Generate a cryptographically random 16-char URL-safe payment token */
function generatePaymentToken() {
  return randomBytes(12).toString('base64url') // 16 chars, 96-bit entropy
}

/**
 * Generate unique invoice number: INV-YYYYMMDD-XXXX
 * Includes retry logic for collision handling under high traffic
 */
function generateInvoiceNumber() {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const rand = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')
  return `INV-${date}-${rand}`
}

/**
 * Create invoice with retry on invoiceNumber collision (P2002)
 */
async function createInvoiceWithRetry(db, data, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await db.invoice.create({ data })
    } catch (err) {
      const isUniqueViolation = err.code === 'P2002' &&
        err.meta?.target?.includes('invoiceNumber')
      if (!isUniqueViolation || attempt === maxRetries - 1) throw err
      // Regenerate invoice number with extra entropy on retries
      const now = new Date()
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const rand = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0')
      const ms = String(now.getMilliseconds()).padStart(3, '0')
      data.invoiceNumber = `INV-${date}-${rand}${ms}`
    }
  }
}


export async function invoiceRoutes(fastify) {
  const db = fastify.db

  // ── Pre-handler for all routes ──────────────────────────
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /invoices/events — SSE realtime dashboard ───────
  // Streams invoice.paid / invoice.expired events for the authenticated client
  fastify.get('/events', async (request, reply) => {
    const raw = reply.raw
    // reply.hijack() bypasses @fastify/cors, so we must set CORS headers manually
    const reqOrigin = request.headers.origin
    const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000')
      .replace(/["']/g, '').split(/[\s,]+/).map(o => o.trim().replace(/\/$/, '')).filter(Boolean)
    const validOrigin = reqOrigin && allowed.includes(reqOrigin) ? reqOrigin : (allowed[0] || 'http://localhost:3000')
    raw.setHeader('Access-Control-Allow-Origin', validOrigin)
    raw.setHeader('Access-Control-Allow-Credentials', 'true')
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('X-Accel-Buffering', 'no') // nginx: disable buffering
    raw.flushHeaders()

    const Redis = (await import('ioredis')).default
    const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      reconnectOnError: () => true,
      retryStrategy: (times) => Math.min(times * 200, 2000)
    })
    subscriber.on('error', () => {})
    subscriber.on('ready', () => {
      // Re-subscribe setelah Redis reconnect (ioredis tidak auto re-subscribe)
      subscriber.subscribe('invoice_events').catch(() => {})
    })
    await subscriber.subscribe('invoice_events')

    // Heartbeat every 25s to keep connection alive through proxies
    const heartbeat = setInterval(() => { raw.write(': heartbeat\n\n') }, 25_000)

    subscriber.on('message', (_ch, message) => {
      try {
        const event = JSON.parse(message)
        // Only forward events for this authenticated client
        if (event.client_id === request.client.id) {
          raw.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      } catch {}
    })

    const cleanup = () => {
      clearInterval(heartbeat)
      subscriber.unsubscribe().catch(() => {})
      subscriber.quit().catch(() => {})
      raw.end()
    }

    request.raw.on('close', cleanup)
    reply.hijack()
  })

  // ── POST /invoices ──────────────────────────────────────
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['amount'],
        properties: {
          channel_preference: { type: 'string', enum: ['platform', 'client'], default: 'platform' },
          amount:             { type: 'number', minimum: INVOICE.MIN_AMOUNT },
          description:        { type: 'string' },
          customer_name:      { type: 'string', maxLength: 200 },
          customer_email:     { type: 'string', format: 'email' },
          expired_minutes:    { type: 'integer', minimum: 60, maximum: 10080, default: 1440 },  // link validity: default 24h, max 7 days
          redirect_url:       { type: 'string', format: 'uri', maxLength: 500 }  // redirect customer after payment success
        }
      }
    }
  }, async (request, reply) => {
    const { channel_preference = 'platform', amount, description, customer_name, customer_email, expired_minutes = 1440, redirect_url } = request.body

    // ── Guard: platform channel invoice amount limit ──────────────
    // Siapapun yang pakai channel platform (free maupun Pro backup) dibatasi Rp 490.000 per invoice.
    // Angka ini memastikan total bayar (amount + kode unik max 999) selalu < Rp 500.000,
    // sehingga QRIS MDR 0% dan platform tidak tekor.
    const activePlan = getActivePlan(request.client)
    if (channel_preference === 'platform' && amount > INVOICE.FREE_TIER_MAX_AMOUNT) {
      const msg = activePlan
        ? `Channel platform hanya mendukung invoice hingga Rp ${INVOICE.FREE_TIER_MAX_AMOUNT.toLocaleString('id-ID')}. Gunakan channel sendiri untuk nominal lebih besar.`
        : `Plan Gratis hanya mendukung invoice hingga Rp ${INVOICE.FREE_TIER_MAX_AMOUNT.toLocaleString('id-ID')}. Upgrade ke Pro untuk nominal lebih besar.`
      return reply.fail('AMOUNT_EXCEEDS_PLATFORM_LIMIT', msg, 422)
    }

    // ── Guard: free tier monthly volume + concurrent pending ──
    // Jalankan keduanya paralel agar tidak ada latency ganda.
    if (!activePlan) {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const monthEnd   = new Date(now.getFullYear(), now.getMonth() + 1, 1)

      const [monthlyPaid, pendingCount] = await Promise.all([
        // Total nilai invoice LUNAS bulan ini (bulan kalender, bukan rolling 30 hari)
        db.invoice.aggregate({
          where: {
            clientId: request.client.id,
            status: 'paid',
            paidAt: { gte: monthStart, lt: monthEnd }
          },
          _sum: { amount: true }
        }),
        // Jumlah invoice masih pending (belum dibayar / belum expire)
        db.invoice.count({
          where: { clientId: request.client.id, status: { in: ['pending', 'user_confirmed'] } }
        })
      ])

      const monthlyTotal = Number(monthlyPaid._sum.amount ?? 0)
      if (monthlyTotal + amount > INVOICE.FREE_TIER_MONTHLY_LIMIT) {
        const sisa = Math.max(0, INVOICE.FREE_TIER_MONTHLY_LIMIT - monthlyTotal)
        return reply.fail(
          'AMOUNT_EXCEEDS_FREE_LIMIT',
          `Batas volume bulanan Plan Gratis (Rp ${(INVOICE.FREE_TIER_MONTHLY_LIMIT / 1_000_000).toFixed(0)} juta/bulan) hampir tercapai. Sisa kuota bulan ini: Rp ${sisa.toLocaleString('id-ID')}. Upgrade ke Pro untuk volume tidak terbatas.`,
          422
        )
      }

      if (pendingCount >= INVOICE.FREE_TIER_MAX_PENDING) {
        return reply.fail(
          'AMOUNT_EXCEEDS_FREE_LIMIT',
          `Plan Gratis hanya boleh memiliki ${INVOICE.FREE_TIER_MAX_PENDING} invoice aktif (pending/menunggu konfirmasi) secara bersamaan. Selesaikan atau batalkan invoice yang ada sebelum membuat yang baru.`,
          422
        )
      }
    }

    // ── Guard: channel preference validation ───────────────
    if (channel_preference === 'client') {
      // Must be on a plan that allows own channels
      if (!activePlan?.plan?.canAddOwnChannel) {
        return reply.fail('PLAN_FEATURE_UNAVAILABLE', 'Plan Anda tidak mendukung penggunaan channel sendiri', 403)
      }

      // Must have at least one active channel
      const ownChannel = await db.paymentChannel.findFirst({
        where: { clientId: request.client.id, isActive: true, deletedAt: null }
      })
      if (!ownChannel) {
        return reply.fail('CHANNEL_NOT_FOUND', 'Anda belum memiliki channel pembayaran aktif. Tambahkan channel terlebih dahulu.', 422)
      }
    }

    const uniqueCode = 0
    const amountUnique = amount

    const invoiceNumber = generateInvoiceNumber()
    const paymentToken = generatePaymentToken()
    const expiredAt = new Date(Date.now() + expired_minutes * 60 * 1000)
    const frontendBaseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/["']/g, '').split(/[\s,]+/).map(o => o.trim().replace(/\/$/, '')).filter(Boolean)[0]
    const paymentUrl = `${frontendBaseUrl}/pay/${paymentToken}`

    const invoice = await createInvoiceWithRetry(db, {
      clientId: request.client.id,
      invoiceNumber,
      customerName: customer_name,
      customerEmail: customer_email,
      amount,
      uniqueCode,
      amountUnique,
      uniqueCodeRevenue: 0,
      description,
      source: request.authMethod === 'api_key' ? 'api' : 'dashboard',
      channelPreference: channel_preference,
      redirectUrl: redirect_url || null,
      paymentUrl,
      paymentToken,
      expiredAt
    })

    return reply.success({
      id: invoice.id,
      invoice_number: invoice.invoiceNumber,
      amount: Number(invoice.amount),
      amount_unique: Number(invoice.amountUnique),
      unique_code: invoice.uniqueCode,
      payment_url: invoice.paymentUrl,
      redirect_url: invoice.redirectUrl || null,
      status: invoice.status,
      expired_at: invoice.expiredAt,
      created_at: invoice.createdAt
    }, 201)
  })

  // ── GET /invoices/stats ─────────────────────────────────
  fastify.get('/stats', async (request, reply) => {
    const groups = await db.invoice.groupBy({
      by: ['status'],
      where: { clientId: request.client.id },
      _count: { status: true }
    })

    const counts = { pending: 0, user_confirmed: 0, paid: 0, expired: 0, cancelled: 0 }
    for (const g of groups) {
      counts[g.status] = g._count.status
    }
    return reply.success(counts)
  })

  // ── GET /invoices ───────────────────────────────────────

  fastify.get('/', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status:     { type: 'string', enum: ['pending', 'user_confirmed', 'paid', 'expired', 'cancelled'] },
          channel_id: { type: 'string' },
          date_from:  { type: 'string' },
          date_to:    { type: 'string' },
          page:       { type: 'integer', minimum: 1, default: 1 },
          per_page:   { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      }
    }
  }, async (request, reply) => {
    const { status, channel_id, date_from, date_to, page = 1, per_page = 20 } = request.query

    const where = { clientId: request.client.id }
    if (status) where.status = status
    if (channel_id) where.paymentChannelId = channel_id
    if (date_from || date_to) {
      where.createdAt = {}
      if (date_from) where.createdAt.gte = new Date(date_from)
      if (date_to) where.createdAt.lte = new Date(date_to + 'T23:59:59Z')
    }

    const [invoices, total] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
        select: {
          id: true, invoiceNumber: true, customerName: true,
          amount: true, amountUnique: true, status: true,
          paymentUrl: true, expiredAt: true, paidAt: true, createdAt: true
        }
      }),
      db.invoice.count({ where })
    ])

    const mapped = invoices.map(i => ({
      id: i.id,
      invoice_number: i.invoiceNumber,
      customer_name: i.customerName,
      amount: Number(i.amount),
      amount_unique: Number(i.amountUnique),
      status: i.status,
      payment_url: i.paymentUrl,
      expired_at: i.expiredAt,
      paid_at: i.paidAt,
      created_at: i.createdAt
    }))

    return reply.paginated(mapped, {
      page,
      per_page,
      total,
      total_pages: Math.ceil(total / per_page)
    })
  })

  // ── GET /invoices/:id ───────────────────────────────────
  // :id dapat berupa CUID/UUID (id) atau invoice number (INV-YYYYMMDD-XXXX)
  fastify.get('/:id', async (request, reply) => {
    const param = request.params.id
    const isInvoiceNumber = /^INV-/i.test(param)

    const invoice = await db.invoice.findFirst({
      where: {
        ...(isInvoiceNumber ? { invoiceNumber: param } : { id: param }),
        clientId: request.client.id
      },
      include: {
        paymentChannel: {
          select: {
            id: true, channelType: true, accountName: true, accountNumber: true
          }
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
      customer_name: invoice.customerName,
      customer_email: invoice.customerEmail,
      amount: Number(invoice.amount),
      amount_unique: Number(invoice.amountUnique),
      unique_code: invoice.uniqueCode,
      description: invoice.description,
      status: invoice.status,
      source: invoice.source,
      payment_url: invoice.paymentUrl,
      redirect_url: invoice.redirectUrl || null,
      payment_channel: invoice.paymentChannel ? {
        id: invoice.paymentChannel.id,
        channel_type: invoice.paymentChannel.channelType,
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

  // ── DELETE /invoices/:id (cancel) ───────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const invoice = await db.invoice.findFirst({
      where: { id: request.params.id, clientId: request.client.id }
    })

    if (!invoice) {
      return reply.fail('INVOICE_NOT_FOUND', 'Invoice tidak ditemukan', 404)
    }

    if (invoice.status === 'paid') {
      return reply.fail('INVOICE_ALREADY_PAID', 'Invoice yang sudah dibayar tidak dapat dibatalkan', 409)
    }

    if (invoice.status !== 'pending') {
      return reply.fail('INVOICE_CANCELLED', 'Invoice sudah dibatalkan atau expired', 422)
    }

    await db.invoice.update({
      where: { id: invoice.id },
      data: { status: 'cancelled' }
    })

    // Publish cancellation event → SSE will pick this up
    try {
      const Redis = (await import('ioredis')).default
      const publisher = new Redis(process.env.REDIS_URL || 'redis://localhost:6379')
      await publisher.publish('invoice_events', JSON.stringify({
        invoice_id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        client_id: invoice.clientId,
        event: 'invoice.cancelled'
      }))
      publisher.disconnect()
    } catch (e) {
      console.warn('[Invoice] Redis publish cancelled failed:', e.message)
    }

    // Update channel priority (only if channel was selected)
    if (invoice.paymentChannelId) {
      const pendingCount = await db.invoice.count({
        where: { paymentChannelId: invoice.paymentChannelId, status: 'pending' }
      })

      if (pendingCount === 0) {
        await db.channelState.update({
          where: { channelId: invoice.paymentChannelId },
          data: {
            scrapePriority: 'medium',
            nextScrapeAt: new Date(Date.now() + 5 * 60_000)
          }
        }).catch(() => {}) // ignore if channel_state doesn't exist yet
      }
    }

    return reply.success(null)
  })
}
