// apps/api/src/routes/lookup.js
// Bank list & validasi rekening — nama vendor tersembunyi dari network traffic
// Rate limit ketat: /check-account adalah external call ke Flip API

import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { createPaymentProviderService } from '../services/paymentProvider.js'

// Error builder yang konsisten dengan format API
function rateLimitError(msg) {
  return () => ({
    success: false,
    error: { code: 'RATE_LIMIT_EXCEEDED', message: msg }
  })
}

export async function lookupRoutes(fastify) {
  const db    = fastify.db
  const redis = fastify.redis

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /lookup/banks ────────────────────────────────────
  // Return daftar bank, di-cache 1 jam di Redis
  fastify.get('/banks', {
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.client?.id || req.ip,
        errorResponseBuilder: rateLimitError('Terlalu banyak permintaan. Coba lagi dalam 1 menit.')
      }
    }
  }, async (request, reply) => {
    const svc = createPaymentProviderService(db, redis)
    try {
      const banks = await svc.getBankList()
      return reply.success(banks)
    } catch (err) {
      fastify.log.error({ err }, '[Lookup] getBankList error')
      return reply.fail('LOOKUP_SERVICE_ERROR', 'Layanan pengecekan bank sedang tidak tersedia', 503)
    }
  })

  // ── POST /lookup/check-account ───────────────────────────
  // Validasi nomor rekening + dapatkan nama pemilik rekening
  // Rate limit ketat: setiap call merupakan external call ke Flip API
  fastify.post('/check-account', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        keyGenerator: (req) => `lookup:${req.client?.id || req.ip}`,
        errorResponseBuilder: rateLimitError('Terlalu banyak permintaan pengecekan rekening. Tunggu 1 menit.')
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['account_number', 'bank'],
        properties: {
          account_number: { type: 'string', minLength: 5, maxLength: 30, pattern: '^[0-9]+$' },
          bank:           { type: 'string', minLength: 2, maxLength: 10, pattern: '^[A-Za-z0-9_]+$' }
        }
      }
    }
  }, async (request, reply) => {
    const { account_number, bank } = request.body
    const svc = createPaymentProviderService(db, redis)

    try {
      const result = await svc.checkAccount(account_number, bank)
      return reply.success(result)
    } catch (err) {
      // Log warn (bukan error) — 422 dari Flip adalah user input problem, bukan bug server
      fastify.log.warn({ flipCode: err.code, bank, status: err.status }, '[Lookup] checkAccount: %s', err.message)

      if (err.code === 'BANK_INVALID') {
        return reply.fail('LOOKUP_ACCOUNT_NOT_FOUND', `Bank "${bank}" tidak tersedia untuk pengecekan rekening`, 422)
      }
      if (err.status === 422 || err.status === 404) {
        return reply.fail('LOOKUP_ACCOUNT_NOT_FOUND', 'Nomor rekening tidak ditemukan atau tidak valid', 422)
      }
      fastify.log.error({ err }, '[Lookup] checkAccount error')
      return reply.fail('LOOKUP_SERVICE_ERROR', 'Layanan pengecekan rekening sedang tidak tersedia', 503)
    }
  })
}
