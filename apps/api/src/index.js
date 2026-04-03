// apps/api/src/index.js
// Entry point — Fastify API Server

import Fastify from 'fastify'
import cors from '@fastify/cors'
import cookie from '@fastify/cookie'
import rateLimit from '@fastify/rate-limit'
import { getDb, disconnectDb } from '@payment-gateway/shared/db'

// Plugins
import { redisPlugin } from './plugins/redis.js'
import { responseFormatter } from './plugins/responseFormatter.js'

// Routes
import { authRoutes } from './routes/auth.js'
import { apiKeyRoutes } from './routes/apiKeys.js'
import { invoiceRoutes } from './routes/invoices.js'
import { channelRoutes } from './routes/channels.js'
import { balanceRoutes } from './routes/balance.js'
import { withdrawalRoutes } from './routes/withdrawals.js'
import { webhookRoutes } from './routes/webhooks.js'
import { payRoutes } from './routes/pay.js'
import { subscriptionRoutes } from './routes/subscriptions.js'
import { lookupRoutes } from './routes/lookup.js'
import { adminRoutes } from './routes/admin.js'

const PORT = parseInt(process.env.API_PORT || '3001')

// Helper: ambil IP real pengunjung dari header Cloudflare / proxy
// Urutan prioritas: CF-Connecting-IP → X-Forwarded-For (first hop) → req.ip
function getRealIp(req) {
  const cf = req.headers['cf-connecting-ip']
  if (cf) return cf.trim()
  const xff = req.headers['x-forwarded-for']
  if (xff) return xff.split(',')[0].trim()
  return req.ip
}

async function buildApp() {
  const app = Fastify({
    logger: {
      level: 'info',
      serializers: {
        // Sertakan IP real (CF-Connecting-IP → X-Forwarded-For → socket) di setiap log request
        req(req) {
          const cf  = req.headers?.['cf-connecting-ip']
          const xff = req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
          const ip  = cf ?? xff ?? req.socket?.remoteAddress ?? '-'
          return {
            method: req.method,
            url:    req.url,
            ip,
          }
        }
      }
    },
    requestIdHeader: 'x-request-id',
    genReqId: () => crypto.randomUUID(),
    // Percayai proxy internal (NPM) agar X-Forwarded-For diteruskan dengan benar
    trustProxy: true
  })

  // ── Global Plugins ────────────────────────────────────────
  await app.register(cors, {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
    maxAge: 86400, // Cache preflight for 1 day — prevents OPTIONS on every request
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })

  await app.register(cookie, {
    secret: process.env.JWT_REFRESH_SECRET
  })

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    // Rate limit berbasis API key / client ID, fallback ke IP real pengunjung
    keyGenerator: (req) => {
      // API key auth — gunakan hash key sebagai identifier
      const apiKey = req.headers['x-api-key']
      if (apiKey) return `apikey:${apiKey}`
      // JWT auth — gunakan client ID dari token
      const auth = req.headers.authorization
      if (auth?.startsWith('Bearer ')) {
        try {
          const payload = JSON.parse(
            Buffer.from(auth.slice(7).split('.')[1], 'base64url').toString()
          )
          if (payload.clientId) return `client:${payload.clientId}`
        } catch {}
      }
      // Fallback: IP real (dari Cloudflare header, bukan IP NPM)
      return getRealIp(req)
    },
    allowList: (req) => {
      // SSE endpoints are long-lived connections — exclude from rate limit
      const sseRoutes = ['/v1/invoices/events', '/v1/balance/events']
      const url = req.url?.split('?')[0] || ''
      if (sseRoutes.includes(url)) return true
      // /v1/pay/:token/status — dynamic SSE route
      if (/^\/v1\/pay\/[^/]+\/status$/.test(url)) return true
      return false
    }
  })

  // ── Custom Plugins ────────────────────────────────────────
  await app.register(redisPlugin)
  await app.register(responseFormatter)

  // ── Prisma DB ─────────────────────────────────────────────
  const db = getDb()
  app.decorate('db', db)

  // ── Routes ────────────────────────────────────────────────
  await app.register(authRoutes,         { prefix: '/v1/auth' })
  await app.register(apiKeyRoutes,       { prefix: '/v1/api-keys' })
  await app.register(invoiceRoutes,      { prefix: '/v1/invoices' })
  await app.register(channelRoutes,      { prefix: '/v1/channels' })
  await app.register(balanceRoutes,      { prefix: '/v1/balance' })
  await app.register(withdrawalRoutes,   { prefix: '/v1/withdrawals' })
  await app.register(webhookRoutes,      { prefix: '/v1/webhooks' })
  await app.register(payRoutes,          { prefix: '/v1/pay' })
  await app.register(subscriptionRoutes, { prefix: '/v1/subscriptions' })
  await app.register(lookupRoutes,       { prefix: '/v1/lookup' })
  await app.register(adminRoutes,        { prefix: '/v1/admin' })

  // ── Health Check ──────────────────────────────────────────
  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  }))

  // ── Debug IP ─────────────────────────────────────────────
  app.get('/debug/ip', async (req) => ({
    req_ip:           req.ip,
    real_ip:          getRealIp(req),
    cf_connecting_ip: req.headers['cf-connecting-ip'] ?? null,
    x_forwarded_for:  req.headers['x-forwarded-for'] ?? null,
    x_real_ip:        req.headers['x-real-ip'] ?? null,
  }))

  return app
}

// ── Start Server ──────────────────────────────────────────
const app = await buildApp()

try {
  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`🚀 API server running on http://localhost:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

// ── Graceful Shutdown ─────────────────────────────────────
let isShuttingDown = false
const shutdown = async (signal) => {
  if (isShuttingDown) return
  isShuttingDown = true
  console.log(`\n${signal} received — shutting down gracefully...`)

  // Force exit after 5s agar node --watch bisa restart
  // (SSE / Prisma connection bisa menyebabkan app.close() hang)
  const forceExit = setTimeout(() => {
    console.warn('[API] Graceful shutdown timeout — forcing exit')
    process.exit(0)
  }, 5000)
  forceExit.unref() // Jangan blokir event loop jika sudah selesai lebih cepat

  await app.close().catch(() => {})
  await disconnectDb().catch(() => {})
  clearTimeout(forceExit)
  process.exit(0)
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

// Prevent Redis ECONNRESET from crashing the server
process.on('uncaughtException', (err) => {
  if (err.code === 'ECONNRESET' || err.message?.includes('Connection is closed')) {
    console.error('[API] Redis connection reset (handled):', err.message)
    return  // don't crash
  }
  console.error('[API] Uncaught exception:', err)
  process.exit(1)
})
