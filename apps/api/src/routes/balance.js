// apps/api/src/routes/balance.js
import { authenticate, checkClientStatus } from '../middleware/authenticate.js'

export async function balanceRoutes(fastify) {
  const db = fastify.db

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /balance/events — SSE realtime balance notifications ─
  fastify.get('/events', async (request, reply) => {
    const raw = reply.raw
    const origin = process.env.FRONTEND_URL || 'http://localhost:3000'
    raw.setHeader('Access-Control-Allow-Origin', origin)
    raw.setHeader('Access-Control-Allow-Credentials', 'true')
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('X-Accel-Buffering', 'no')
    raw.flushHeaders()

    const Redis = (await import('ioredis')).default
    const subscriber = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      reconnectOnError: () => true,
      retryStrategy: (times) => Math.min(times * 200, 2000)
    })
    subscriber.on('error', () => {})
    subscriber.on('ready', () => {
      // Re-subscribe setelah Redis reconnect
      subscriber.subscribe('balance_events').catch(() => {})
    })
    await subscriber.subscribe('balance_events')

    const heartbeat = setInterval(() => { raw.write(': heartbeat\n\n') }, 25_000)

    subscriber.on('message', (_ch, message) => {
      try {
        const event = JSON.parse(message)
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

  // ── GET /balance ────────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const balance = await db.clientBalance.findUnique({
      where: { clientId: request.client.id }
    })

    if (!balance) {
      return reply.success({
        balance_pending: 0,
        balance_available: 0,
        total_earned: 0,
        total_withdrawn: 0
      })
    }

    return reply.success({
      balance_pending: Number(balance.balancePending),
      balance_available: Number(balance.balanceAvailable),
      total_earned: Number(balance.totalEarned),
      total_withdrawn: Number(balance.totalWithdrawn)
    })
  })

  // ── GET /balance/ledger ─────────────────────────────────
  fastify.get('/ledger', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          type:     { type: 'string', enum: ['credit_pending', 'credit_available', 'debit_withdraw'] },
          page:     { type: 'integer', minimum: 1, default: 1 },
          per_page: { type: 'integer', minimum: 1, maximum: 100, default: 20 }
        }
      }
    }
  }, async (request, reply) => {
    const { type, page = 1, per_page = 20 } = request.query

    const where = { clientId: request.client.id }
    if (type) where.type = type

    // credit_pending: hanya tampilkan yang belum settle (settled_at IS NULL)
    // yang sudah settle sudah punya pasangan credit_available
    if (type === 'credit_pending') where.settledAt = null

    const [entries, total] = await Promise.all([
      db.balanceLedger.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
        include: {
          invoice: { select: { invoiceNumber: true } },
          withdrawal: { select: { id: true } }
        }
      }),
      db.balanceLedger.count({ where })
    ])

    const mapped = entries.map(e => ({
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      available_at: e.availableAt,
      settled_at: e.settledAt,
      note: e.note,
      invoice_number: e.invoice?.invoiceNumber,
      withdrawal_id: e.withdrawalId,
      created_at: e.createdAt
    }))

    return reply.paginated(mapped, {
      page,
      per_page,
      total,
      total_pages: Math.ceil(total / per_page)
    })
  })
}
