// apps/api/src/routes/pay.js
// Public payment page endpoints — NO AUTH required

import { INVOICE, getUniqueCodeRange } from '@payment-gateway/shared/constants'

/**
 * Generate random unique code (1-999) that doesn't conflict
 * with existing pending invoices on the same channel.
 * Returns a code not currently in use by active invoices on this channel.
 */
function generateUniqueCodeFromSet(usedCodes, amount) {
  const { min, max } = getUniqueCodeRange(amount)
  let code
  let attempts = 0

  do {
    code = Math.floor(Math.random() * (max - min + 1)) + min
    attempts++
  } while (usedCodes.has(code) && attempts < 100)

  return code
}
/**
 * Acquire a Redis distributed lock (SET NX with TTL).
 * Returns the lock value (for safe release) or null if lock not acquired.
 */
async function acquireLock(redis, key, ttlMs = 10000) {
  const lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const result = await redis.set(key, lockValue, 'PX', ttlMs, 'NX')
  return result === 'OK' ? lockValue : null
}

/**
 * Release a Redis lock only if we still own it (compare lock value).
 * Uses Lua script for atomicity.
 */
async function releaseLock(redis, key, lockValue) {
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `
  await redis.eval(script, 1, key, lockValue).catch(() => {})
}

/**
 * Assign a unique code to an invoice using Redis distributed lock per channel.
 * This is safe for MariaDB Galera Cluster (multi-node) because the lock
 * serializes access at the application level via Redis, not the DB.
 *
 * Retries up to maxRetries times if the lock can't be acquired.
 */
async function assignUniqueCodeWithRetry(db, redis, invoiceId, channelId, amount, channelOwner, extraData = {}, maxRetries = 5) {
  const lockKey = `lock:unique_code:${channelId}`

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    let lockValue
    try {
      lockValue = await acquireLock(redis, lockKey, 10000)
    } catch {
      // Redis unavailable — skip lock, fall through to no-lock fallback below
      break
    }

    if (!lockValue) {
      // Lock held by another request — wait and retry
      await new Promise(r => setTimeout(r, 100 + Math.random() * 200))
      continue
    }

    try {
      // 2. Query existing codes (safe — we hold the lock)
      const existingCodes = await db.invoice.findMany({
        where: {
          paymentChannelId: channelId,
          status: { in: ['pending', 'user_confirmed'] },
          id: { not: invoiceId }
        },
        select: { uniqueCode: true }
      })

      const usedCodes = new Set(existingCodes.map(i => i.uniqueCode))
      const uniqueCode = generateUniqueCodeFromSet(usedCodes, amount)
      const amountUnique = amount + uniqueCode

      // 3. Update invoice (unique code + any extra fields like expiredAt) in ONE query
      await db.invoice.update({
        where: { id: invoiceId },
        data: {
          paymentChannelId: channelId,
          uniqueCode,
          amountUnique,
          uniqueCodeRevenue: channelOwner === 'platform' ? uniqueCode : 0,
          fee: 0,
          ...extraData
        }
      })

      return { uniqueCode, amountUnique }
    } finally {
      // Release lock — if Redis drops here, auto-expire after TTL (10s) is safe
      await releaseLock(redis, lockKey, lockValue).catch(e =>
        console.warn(`[Pay] releaseLock failed (will auto-expire): ${e.message}`)
      )
    }
  }

  // Fallback: Redis unavailable or max retries exceeded — generate code without lock
  // Collision risk is very low (only if two requests hit the exact same channel at the same ms)
  const existingCodes = await db.invoice.findMany({
    where: {
      paymentChannelId: channelId,
      status: { in: ['pending', 'user_confirmed'] },
      id: { not: invoiceId }
    },
    select: { uniqueCode: true }
  })

  const usedCodes = new Set(existingCodes.map(i => i.uniqueCode))
  const uniqueCode = generateUniqueCodeFromSet(usedCodes, amount)
  const amountUnique = amount + uniqueCode

  await db.invoice.update({
    where: { id: invoiceId },
    data: {
      paymentChannelId: channelId,
      uniqueCode,
      amountUnique,
      uniqueCodeRevenue: channelOwner === 'platform' ? uniqueCode : 0,
      fee: 0,
      ...extraData
    }
  })

  return { uniqueCode, amountUnique }
}

/**
 * Select QRIS channel using round-robin strategy.
 * Rotates fairly across healthy channels and skips circuit-open channels.
 * Uses Redis to persist the last selected channel across instances.
 */
async function selectRoundRobinQrisChannel(db, redis, channelWhere, scopeKey, fallbackEntropy = '') {
  // 1. Get all matching QRIS channels (deterministic order for stable rotation)
  const qrisChannels = await db.paymentChannel.findMany({
    where: {
      ...channelWhere,
      channelType: { in: ['qris_bca', 'qris_gopay', 'qris_bri'] }
    },
    orderBy: [
      { createdAt: 'asc' },
      { id: 'asc' }
    ],
    include: {
      channelState: {
        select: { circuitState: true }
      }
    }
  })

  if (qrisChannels.length === 0) return null

  // 2. Filter out channels with open circuit breakers
  const healthyChannels = qrisChannels.filter(
    ch => ch.channelState?.circuitState !== 'open'
  )
  const candidates = healthyChannels.length > 0 ? healthyChannels : qrisChannels

  if (candidates.length === 1) return candidates[0]

  // 3. Continue from the next channel after the last-picked channel.
  const rrKey = `rr:qris:last:${scopeKey}`
  let nextIndex = 0

  try {
    const lastChannelId = await redis.get(rrKey)
    if (lastChannelId) {
      const lastIdx = candidates.findIndex(ch => ch.id === lastChannelId)
      if (lastIdx >= 0) nextIndex = (lastIdx + 1) % candidates.length
    }
  } catch {
    // Redis unavailable: fall back to deterministic spread by invoice id/token
    const entropy = String(fallbackEntropy || '')
    const hashSeed = entropy.split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0)
    nextIndex = hashSeed % candidates.length
  }

  const selected = candidates[nextIndex]

  // 4. Persist selected channel as "last used" for next rotation turn.
  try {
    await redis.set(rrKey, selected.id, 'EX', 30 * 24 * 60 * 60)
  } catch {
    // Ignore persistence failure; selection still succeeds.
  }

  return selected
}

export async function payRoutes(fastify) {
  const db = fastify.db
  // Fail-fast Redis client for distributed locking.
  // maxRetriesPerRequest:0 + enableOfflineQueue:false ensures acquireLock throws immediately
  // when Redis is unreachable instead of queuing commands and hanging for 9+ seconds.
  const redisForLock = fastify.redis.duplicate({
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false
  })

  const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'

  // ── GET /pay/:token ────────────────────────────────────
  // Public endpoint — accessed by customer via payment link
  fastify.get('/:token', async (request, reply) => {
    const invoice = await db.invoice.findFirst({
      where: { paymentToken: request.params.token },
      include: {
        client: { select: { id: true, name: true } },
        paymentChannel: {
          select: {
            id: true,
            channelType: true,
            channelOwner: true,
            accountName: true,
            accountNumber: true,
            qrisData: true
          }
        }
      }
    })

    if (!invoice) {
      return reply.fail('INVOICE_NOT_FOUND', 'Invoice tidak ditemukan', 404)
    }

    // Build response
    const data = {
      id: invoice.id,  // ← diperlukan frontend untuk SSE guard (invoiceId)
      invoice_number: invoice.invoiceNumber,
      merchant_name: invoice.client.name,
      description: invoice.description,
      customer_name: invoice.customerName,
      customer_email: invoice.customerEmail,
      amount: Number(invoice.amount),
      amount_to_pay: Number(invoice.amountUnique),
      unique_code: invoice.uniqueCode,
      status: invoice.status,
      redirect_url: invoice.redirectUrl || null,
      expired_at: invoice.expiredAt,
      payment_channel: null,
      available_channels: []
    }

    // If channel already selected
    if (invoice.paymentChannel) {
      data.payment_channel = {
        id: invoice.paymentChannel.id,
        channel_type: invoice.paymentChannel.channelType,
        channel_owner: invoice.paymentChannel.channelOwner,
        account_name: invoice.paymentChannel.accountName,
        account_number: invoice.paymentChannel.accountNumber,
        qris_data: invoice.paymentChannel.qrisData || null
      }
    }

    // If no channel yet → show available channels based on merchant's preference
    if (!invoice.paymentChannelId && ['pending'].includes(invoice.status)) {
      const channelWhere = invoice.channelPreference === 'client'
        ? { isActive: true, deletedAt: null, clientId: invoice.clientId, channelOwner: 'client' }
        : { isActive: true, deletedAt: null, channelOwner: 'platform' }

      const channels = await db.paymentChannel.findMany({
        where: channelWhere,
        select: {
          id: true,
          channelType: true,
          channelOwner: true,
          accountName: true,
          accountNumber: true,
          qrisData: true
        }
      })

      const invoiceAmount = Number(invoice.amount)

      // Group channels: merge all qris_* into one "qris" entry, keep bank transfers individual
      const grouped = []
      let hasQris = false

      for (const c of channels) {
        if (c.channelType.startsWith('qris')) {
          // Only add one QRIS entry
          if (!hasQris) {
            hasQris = true
            grouped.push({
              id: '__qris__', // sentinel — frontend uses channel_type instead
              channel_type: 'qris',
              channel_owner: c.channelOwner,
              account_name: 'QRIS',
              account_number: '',
              qris_data: null
            })
          }
        } else {
          // Bank transfer — only show if amount >= threshold
          if (invoiceAmount >= (INVOICE.BANK_TRANSFER_MIN_AMOUNT || 10_000)) {
            grouped.push({
              id: c.id,
              channel_type: c.channelType,
              channel_owner: c.channelOwner,
              account_name: c.accountName,
              account_number: c.accountNumber,
              qris_data: c.qrisData || null
            })
          }
        }
      }

      data.available_channels = grouped
    }

    return reply.success(data)
  })

  // ── POST /pay/:token/select-channel ─────────────────────
  // Customer selects payment method → generate unique code
  // Accepts { channel_id: "xxx" } for specific channel (bank transfer)
  // OR { channel_type: "qris" } for auto-selected QRIS (round-robin)
  fastify.post('/:token/select-channel', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '5 minutes',
        keyGenerator: (req) => `select-channel:${req.params.token}`,
        errorResponseBuilder: (_req, _ctx) => ({
          statusCode: 429,
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan. Coba lagi dalam beberapa menit.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        properties: {
          channel_id: { type: 'string' },
          channel_type: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { channel_id, channel_type } = request.body

    if (!channel_id && !channel_type) {
      return reply.fail('VALIDATION_ERROR', 'Pilih metode pembayaran', 400)
    }

    const t0 = performance.now()
    const invoice = await db.invoice.findFirst({
      where: { paymentToken: request.params.token }
    })
    console.log(`[Pay] step=findInvoice ${Math.round(performance.now()-t0)}ms`)

    if (!invoice) {
      return reply.fail('INVOICE_NOT_FOUND', 'Invoice tidak ditemukan', 404)
    }

    if (invoice.status !== 'pending') {
      return reply.fail('INVOICE_NOT_PENDING', 'Invoice sudah tidak aktif', 422)
    }

    if (new Date(invoice.expiredAt) < new Date()) {
      return reply.fail('INVOICE_EXPIRED', 'Link invoice sudah kedaluwarsa', 422)
    }

    // If channel already selected — return existing channel data (handles page refresh gracefully)
    if (invoice.paymentChannelId) {
      const existingChannel = await db.paymentChannel.findUnique({
        where: { id: invoice.paymentChannelId },
        select: { channelType: true, channelOwner: true, accountName: true, accountNumber: true, qrisData: true }
      })
      return reply.success({
        channel_type: existingChannel?.channelType,
        channel_owner: existingChannel?.channelOwner,
        account_name: existingChannel?.accountName,
        account_number: existingChannel?.accountNumber,
        qris_data: existingChannel?.qrisData || null,
        amount_to_pay: Number(invoice.amountUnique),
        unique_code: invoice.uniqueCode,
        expired_at: invoice.expiredAt?.toISOString()
      })
    }

    let channel

    if (channel_type === 'qris') {
      // ── Auto-select QRIS channel (round-robin) ──────────
      const channelWhere = invoice.channelPreference === 'client'
        ? { isActive: true, deletedAt: null, clientId: invoice.clientId, channelOwner: 'client' }
        : { isActive: true, deletedAt: null, channelOwner: 'platform' }

      const rrScopeKey = invoice.channelPreference === 'client'
        ? `client:${invoice.clientId}`
        : 'platform'

      const t1 = performance.now()
      channel = await selectRoundRobinQrisChannel(
        db,
        redisForLock,
        channelWhere,
        rrScopeKey,
        invoice.id || invoice.paymentToken
      )
      console.log(`[Pay] step=selectQris ${Math.round(performance.now()-t1)}ms`)

      if (!channel) {
        return reply.fail('CHANNEL_NOT_FOUND', 'Tidak ada QRIS channel yang tersedia', 404)
      }
    } else {
      // ── Specific channel selection (bank transfer / legacy) ──
      const channelWhere = invoice.channelPreference === 'client'
        ? { id: channel_id, isActive: true, clientId: invoice.clientId, channelOwner: 'client' }
        : { id: channel_id, isActive: true, channelOwner: 'platform' }

      channel = await db.paymentChannel.findFirst({ where: channelWhere })

      if (!channel) {
        return reply.fail('CHANNEL_NOT_FOUND', 'Channel pembayaran tidak valid', 404)
      }
    }

    // Atomically assign unique code with Redis distributed lock.
    // Payment window (30m) is set inside the same DB update to save 1 round-trip.
    const PAYMENT_WINDOW_MS = 30 * 60_000
    const expiredAt = new Date(Date.now() + PAYMENT_WINDOW_MS)
    const t2 = performance.now()
    const { uniqueCode, amountUnique } = await assignUniqueCodeWithRetry(
      db, redisForLock, invoice.id, channel.id, Number(invoice.amount), channel.channelOwner,
      { expiredAt }
    )
    console.log(`[Pay] step=assignCode ${Math.round(performance.now()-t2)}ms`)

    const t3 = performance.now()
    await db.channelState.upsert({
      where: { channelId: channel.id },
      update: {
        scrapePriority: 'high',
        nextScrapeAt: new Date()
      },
      create: {
        channelId: channel.id,
        scrapePriority: 'high',
        nextScrapeAt: new Date()
      }
    })
    console.log(`[Pay] step=upsertState ${Math.round(performance.now()-t3)}ms`)

    console.log(`[Pay] ✅ Channel selected for ${invoice.invoiceNumber}: ${channel.channelType} (${channel.channelOwner}) [unique_code=${uniqueCode}] total=${Math.round(performance.now()-t0)}ms`)

    return reply.success({
      channel_type: channel.channelType,
      channel_owner: channel.channelOwner,
      account_name: channel.accountName,
      account_number: channel.accountNumber,
      qris_data: channel.qrisData || null,
      amount_to_pay: amountUnique,
      unique_code: uniqueCode,
      expired_at: expiredAt.toISOString()
    })
  })

  // ── POST /pay/:invoiceNumber/confirm ─────────────────────
  // Customer clicked "Saya Sudah Transfer"
  fastify.post('/:token/confirm', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '5 minutes',
        keyGenerator: (req) => `confirm:${req.params.token}`,
        errorResponseBuilder: (_req, _ctx) => ({
          statusCode: 429,
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan konfirmasi. Coba lagi dalam beberapa menit.' }
        })
      }
    }
  }, async (request, reply) => {
    const invoice = await db.invoice.findFirst({
      where: { paymentToken: request.params.token }
    })

    if (!invoice) {
      return reply.fail('INVOICE_NOT_FOUND', 'Invoice tidak ditemukan', 404)
    }

    // Must have channel selected first
    if (!invoice.paymentChannelId) {
      return reply.fail('NO_CHANNEL_SELECTED', 'Pilih metode pembayaran terlebih dahulu', 422)
    }

    // Already confirmed or paid — return current status
    if (invoice.status === 'user_confirmed') {
      return reply.success({ status: 'user_confirmed', confirmed_at: invoice.confirmedAt })
    }
    if (invoice.status === 'paid') {
      return reply.success({ status: 'paid', paid_at: invoice.paidAt })
    }
    if (invoice.status !== 'pending') {
      return reply.fail('INVOICE_NOT_PENDING', 'Invoice sudah tidak aktif', 422)
    }

    // Check if expired
    if (new Date(invoice.expiredAt) < new Date()) {
      return reply.fail('INVOICE_EXPIRED', 'Invoice sudah kedaluwarsa', 422)
    }

    // Update status → user_confirmed
    const now = new Date()
    await db.invoice.update({
      where: { id: invoice.id },
      data: {
        status: 'user_confirmed',
        confirmedAt: now
      }
    })

    // Set channel priority to HIGH → scrape immediately
    await db.channelState.upsert({
      where: { channelId: invoice.paymentChannelId },
      update: {
        scrapePriority: 'high',
        nextScrapeAt: now  // trigger immediate scrape
      },
      create: {
        channelId: invoice.paymentChannelId,
        scrapePriority: 'high',
        nextScrapeAt: now
      }
    })

    console.log(`[Pay] ✅ User confirmed transfer: ${invoice.invoiceNumber}`)
    return reply.success({ status: 'user_confirmed', confirmed_at: now })
  })

  // ── GET /pay/:token/status ─────────────────────────────
  // SSE endpoint — realtime payment status (per-connection Redis subscriber)
  fastify.get('/:token/status', async (request, reply) => {
    const invoice = await db.invoice.findFirst({
      where: { paymentToken: request.params.token }
    })

    if (!invoice) {
      return reply.code(404).send({ error: 'Invoice not found' })
    }

    // If already paid → return immediately (no SSE needed)
    if (invoice.status === 'paid') {
      console.log(`[SSE] ${invoice.invoiceNumber} already paid, return immediately`)
      return reply.send({ status: 'paid', paid_at: invoice.paidAt })
    }

    // If expired/cancelled → return immediately
    if (invoice.status === 'expired' || invoice.status === 'cancelled') {
      return reply.send({ status: invoice.status })
    }

    // ── Setup SSE ──────────────────────────────────────────
    const raw = reply.raw
    raw.setHeader('Content-Type', 'text/event-stream')
    raw.setHeader('Cache-Control', 'no-cache')
    raw.setHeader('Connection', 'keep-alive')
    raw.setHeader('Access-Control-Allow-Origin', '*')
    raw.setHeader('X-Accel-Buffering', 'no')
    raw.flushHeaders()

    console.log(`[SSE] 🔌 Client connected for invoice ${invoice.invoiceNumber} (id=${invoice.id})`)

    // Dedicated Redis subscriber per SSE connection
    const { default: Redis } = await import('ioredis')
    const subscriber = new Redis(REDIS_URL, {
      enableOfflineQueue: true,
      maxRetriesPerRequest: null,  // subscriber tidak perlu fail-fast
      retryStrategy: (times) => Math.min(times * 500, 5000)
    })
    subscriber.on('error', (e) => console.warn(`[SSE] Redis error (${invoice.invoiceNumber}):`, e.message))

    // Re-subscribe after Redis reconnect
    subscriber.on('ready', () => {
      subscriber.subscribe('invoice_events').catch(() => {})
    })

    try {
      await subscriber.subscribe('invoice_events')
      console.log(`[SSE] ✅ Subscribed to invoice_events for ${invoice.invoiceNumber}`)
    } catch (e) {
      console.error(`[SSE] ❌ Subscribe failed for ${invoice.invoiceNumber}:`, e.message)
    }

    const sendEvent = (data) => {
      try { raw.write(`data: ${JSON.stringify(data)}\n\n`) } catch {}
    }

    // Kirim heartbeat agar koneksi tidak di-timeout proxy/browser
    const heartbeat = setInterval(() => {
      try { raw.write(': heartbeat\n\n') } catch {}
    }, 25_000)

    subscriber.on('message', (_ch, message) => {
      try {
        const event = JSON.parse(message)
        console.log(`[SSE] 📨 Message received: event=${event.event} invoice_id=${event.invoice_id} (watching: ${invoice.id})`)
        if (event.invoice_id === invoice.id) {
          console.log(`[SSE] ✅ MATCH! Sending ${event.event} to client for ${invoice.invoiceNumber}`)
          sendEvent(event)
          if (['invoice.paid', 'invoice.expired', 'invoice.cancelled'].includes(event.event)) {
            cleanup()
          }
        }
      } catch (e) {
        console.warn('[SSE] Parse error:', e.message)
      }
    })

    // Auto-close saat invoice expired
    const expiryMs = new Date(invoice.expiredAt) - Date.now()
    const expiryTimeout = setTimeout(() => {
      sendEvent({ event: 'invoice.expired' })
      cleanup()
    }, Math.max(expiryMs, 0))

    let cleaned = false
    const cleanup = () => {
      if (cleaned) return
      cleaned = true
      console.log(`[SSE] 🔌 Cleanup for ${invoice.invoiceNumber}`)
      clearInterval(heartbeat)
      clearTimeout(expiryTimeout)
      subscriber.unsubscribe('invoice_events').catch(() => {})
      subscriber.quit().catch(() => {})
      try { raw.end() } catch {}
    }

    request.raw.on('close', cleanup)
    reply.hijack()
  })

  // Cleanup lock Redis on server shutdown
  fastify.addHook('onClose', async () => {
    await redisForLock.quit().catch(() => {})
  })
}
