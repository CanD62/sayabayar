// apps/api/src/routes/webhooks.js
import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { sha256, encrypt } from '@payment-gateway/shared/crypto'
import crypto from 'crypto'

export async function webhookRoutes(fastify) {
  const db = fastify.db

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /webhooks ───────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const webhooks = await db.webhookEndpoint.findMany({
      where: { clientId: request.client.id },
      select: {
        id: true,
        url: true,
        eventTypes: true,
        isActive: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    })

    const mapped = webhooks.map(w => ({
      id: w.id,
      url: w.url,
      event_types: w.eventTypes,
      is_active: w.isActive,
      created_at: w.createdAt
    }))

    return reply.success(mapped)
  })

  // ── POST /webhooks ──────────────────────────────────────
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        required: ['url', 'event_types'],
        properties: {
          url:         { type: 'string', format: 'uri', maxLength: 500 },
          event_types: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['invoice.paid', 'invoice.expired', 'invoice.cancelled']
            },
            minItems: 1
          }
        }
      }
    }
  }, async (request, reply) => {
    const { url, event_types } = request.body

    // Cek duplikat URL untuk client yang sama
    const existing = await db.webhookEndpoint.findFirst({
      where: { clientId: request.client.id, url }
    })
    if (existing) {
      return reply.fail('DUPLICATE_REQUEST', 'URL endpoint ini sudah terdaftar', 409)
    }

    // Generate webhook secret
    const rawSecret       = `whsec_${crypto.randomBytes(24).toString('hex')}`
    const secretHash      = sha256(rawSecret)
    const secretEncrypted = encrypt(rawSecret)

    const webhook = await db.webhookEndpoint.create({
      data: {
        clientId: request.client.id,
        url,
        secretHash,
        secretEncrypted,
        eventTypes: event_types
      }
    })

    // Raw secret hanya ditampilkan SEKALI
    return reply.success({
      id: webhook.id,
      url: webhook.url,
      secret: rawSecret,
      event_types: webhook.eventTypes,
      is_active: webhook.isActive,
      created_at: webhook.createdAt
    }, 201)
  })

  // ── PATCH /webhooks/:id ─────────────────────────────────
  fastify.patch('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          url:         { type: 'string', format: 'uri', maxLength: 500 },
          event_types: {
            type: 'array',
            items: { type: 'string' },
            minItems: 1
          },
          is_active: { type: 'boolean' }
        }
      }
    }
  }, async (request, reply) => {
    const webhook = await db.webhookEndpoint.findFirst({
      where: { id: request.params.id, clientId: request.client.id }
    })

    if (!webhook) {
      return reply.fail('RESOURCE_NOT_FOUND', 'Webhook tidak ditemukan', 404)
    }

    const data = {}
    if (request.body.url !== undefined) data.url = request.body.url
    if (request.body.event_types !== undefined) data.eventTypes = request.body.event_types
    if (request.body.is_active !== undefined) data.isActive = request.body.is_active

    const updated = await db.webhookEndpoint.update({
      where: { id: webhook.id },
      data
    })

    return reply.success({
      id: updated.id,
      url: updated.url,
      event_types: updated.eventTypes,
      is_active: updated.isActive
    })
  })

  // ── DELETE /webhooks/:id ────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const webhook = await db.webhookEndpoint.findFirst({
      where: { id: request.params.id, clientId: request.client.id }
    })

    if (!webhook) {
      return reply.fail('RESOURCE_NOT_FOUND', 'Webhook tidak ditemukan', 404)
    }

    await db.webhookLog.deleteMany({ where: { webhookId: webhook.id } })
    await db.webhookEndpoint.delete({ where: { id: webhook.id } })
    return reply.success(null)
  })

  // ── POST /webhooks/:id/test ─────────────────────────────
  fastify.post('/:id/test', {
    schema: {
      body: {
        type: 'object',
        properties: {
          event: {
            type: 'string',
            enum: ['invoice.paid', 'invoice.expired', 'invoice.cancelled'],
            default: 'invoice.paid'
          }
        }
      }
    }
  }, async (request, reply) => {
    const webhook = await db.webhookEndpoint.findFirst({
      where: { id: request.params.id, clientId: request.client.id }
    })

    if (!webhook) {
      return reply.fail('RESOURCE_NOT_FOUND', 'Webhook tidak ditemukan', 404)
    }

    const event = request.body?.event || 'invoice.paid'

    // Build test payload
    const payload = JSON.stringify({
      event,
      data: {
        invoice_id:      'test-invoice-id',
        invoice_number:  'INV-TEST-0001',
        amount:          100000,
        amount_unique:   100123,
        status:          'paid',
        payment_channel: 'bca_transfer',
        paid_at:         new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    })

    // Sign dengan cara yang sama seperti worker
    const { generateWebhookSignature, decrypt } = await import('@payment-gateway/shared/crypto')
    const hmacKey = webhook.secretEncrypted
      ? decrypt(webhook.secretEncrypted)
      : webhook.secretHash
    const signature = generateWebhookSignature(payload, hmacKey)

    const startMs = Date.now()
    let httpStatus = null
    let responseBody = ''
    let error = null

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type':        'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event':     'test',
          'User-Agent':          'PaymentGateway-Webhook/1.0'
        },
        body: payload,
        signal: AbortSignal.timeout(10000)
      })
      httpStatus   = response.status
      responseBody = (await response.text()).slice(0, 1000)
    } catch (err) {
      error = err.message
    }

    const latencyMs = Date.now() - startMs

    return reply.success({
      url:          webhook.url,
      http_status:  httpStatus,
      response:     responseBody,
      latency_ms:   latencyMs,
      success:      httpStatus !== null && httpStatus >= 200 && httpStatus < 300,
      error
    })
  })

  // ── GET /webhooks/:id/logs ──────────────────────────────
  fastify.get('/:id/logs', {
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
    const webhook = await db.webhookEndpoint.findFirst({
      where: { id: request.params.id, clientId: request.client.id }
    })

    if (!webhook) {
      return reply.fail('RESOURCE_NOT_FOUND', 'Webhook tidak ditemukan', 404)
    }

    const { page = 1, per_page = 20 } = request.query

    const [logs, total] = await Promise.all([
      db.webhookLog.findMany({
        where: { webhookId: webhook.id },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * per_page,
        take: per_page,
        include: {
          invoice: { select: { invoiceNumber: true } }
        }
      }),
      db.webhookLog.count({ where: { webhookId: webhook.id } })
    ])

    const mapped = logs.map(l => ({
      id: l.id,
      invoice_number: l.invoice?.invoiceNumber,
      http_status: l.httpStatus,
      attempt_number: l.attemptNumber,
      sent_at: l.sentAt
    }))

    return reply.paginated(mapped, {
      page,
      per_page,
      total,
      total_pages: Math.ceil(total / per_page)
    })
  })
}
