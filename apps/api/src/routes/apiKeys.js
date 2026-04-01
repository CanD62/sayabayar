// apps/api/src/routes/apiKeys.js
import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { generateApiKey, hashApiKey } from '@payment-gateway/shared/crypto'

export async function apiKeyRoutes(fastify) {
  const db = fastify.db

  // ── Pre-handler for all routes ──────────────────────────
  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /api-keys ───────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const keys = await db.apiKey.findMany({
      where: { clientId: request.client.id },
      select: {
        id: true,
        label: true,
        keyHash: true,
        isActive: true,
        lastUsedAt: true,
        createdAt: true
      },
      orderBy: { createdAt: 'desc' }
    })

    // Show only preview (first 8 + last 4 chars are masked)
    const mapped = keys.map(k => ({
      id: k.id,
      label: k.label,
      key_preview: `sk_live_${'x'.repeat(40)}...`,
      is_active: k.isActive,
      last_used_at: k.lastUsedAt,
      created_at: k.createdAt
    }))

    return reply.success(mapped)
  })

  // ── POST /api-keys ──────────────────────────────────────
  fastify.post('/', {
    schema: {
      body: {
        type: 'object',
        properties: {
          label: { type: 'string', maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const rawKey = generateApiKey()
    const keyHash = hashApiKey(rawKey)

    const apiKey = await db.apiKey.create({
      data: {
        clientId: request.client.id,
        keyHash,
        label: request.body?.label || null
      }
    })

    // Raw key hanya ditampilkan SEKALI
    return reply.success({
      id: apiKey.id,
      label: apiKey.label,
      key: rawKey,
      created_at: apiKey.createdAt
    }, 201)
  })

  // ── DELETE /api-keys/:id ────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const { id } = request.params

    const key = await db.apiKey.findFirst({
      where: { id, clientId: request.client.id }
    })

    if (!key) {
      return reply.fail('RESOURCE_NOT_FOUND', 'API key tidak ditemukan', 404)
    }

    await db.apiKey.update({
      where: { id },
      data: { isActive: false }
    })

    return reply.success(null)
  })
}
