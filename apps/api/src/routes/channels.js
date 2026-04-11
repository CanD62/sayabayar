// apps/api/src/routes/channels.js
import { authenticate, checkClientStatus, checkPlanAccess, getActivePlan } from '../middleware/authenticate.js'
import { encrypt } from '@payment-gateway/shared/crypto'

export async function channelRoutes(fastify) {
  const db = fastify.db
  const redis = fastify.redis  // from Fastify Redis plugin

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /channels ───────────────────────────────────────
  fastify.get('/', async (request, reply) => {
    const channels = await db.paymentChannel.findMany({
      where: { clientId: request.client.id, deletedAt: null },
      include: {
        channelState: {
          select: {
            circuitState: true,
            lastScrapedAt: true,
            lastSuccessAt: true,
            nextScrapeAt: true,
            consecutiveErrors: true,
            lastErrorType: true,
            lastErrorMessage: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    // Get session statuses from Redis
    const pipeline = redis.pipeline()
    for (const c of channels) {
      pipeline.get(`pg:session:${c.id}`)
    }
    const sessionResults = await pipeline.exec()

    const mapped = channels.map((c, i) => {
      const [, sessionData] = sessionResults[i] || []
      const session = sessionData ? JSON.parse(sessionData) : null
      return {
        id: c.id,
        channel_type: c.channelType,
        channel_owner: c.channelOwner,
        account_name: c.accountName,
        account_number: c.accountNumber,
        is_active: c.isActive,
        circuit_state: c.channelState?.circuitState || 'closed',
        consecutive_errors: c.channelState?.consecutiveErrors || 0,
        last_scraped_at: c.channelState?.lastScrapedAt,
        last_success_at: c.channelState?.lastSuccessAt,
        next_scrape_at: c.channelState?.nextScrapeAt,
        last_error_type: c.channelState?.lastErrorType || null,
        last_error_message: c.channelState?.lastErrorMessage || null,
        session_active: session?.isLoggedIn || false,
        session_updated_at: session?.updatedAt || null,
        created_at: c.createdAt
      }
    })

    return reply.success(mapped)
  })

  // ── POST /channels/:id/force-logout ──────────────────────
  fastify.post('/:id/force-logout', async (request, reply) => {
    const channel = await db.paymentChannel.findFirst({
      where: { id: request.params.id, clientId: request.client.id, deletedAt: null }
    })
    if (!channel) return reply.fail('CHANNEL_NOT_FOUND', 'Channel tidak ditemukan', 404)

    await redis.setex(`pg:cmd:${channel.id}`, 300, 'force_logout')

    return reply.success({ message: 'Force logout command sent' })
  })

  // ── POST /channels/:id/clean-browser ─────────────────────
  // Full reset: logout + reset circuit breaker + destroy browser
  fastify.post('/:id/clean-browser', async (request, reply) => {
    const channel = await db.paymentChannel.findFirst({
      where: { id: request.params.id, clientId: request.client.id, deletedAt: null }
    })
    if (!channel) return reply.fail('CHANNEL_NOT_FOUND', 'Channel tidak ditemukan', 404)

    // Send clean command to scraper
    await redis.setex(`pg:cmd:${channel.id}`, 300, 'clean_browser')

    // Reset circuit breaker in DB
    await db.channelState.upsert({
      where: { channelId: channel.id },
      update: {
        circuitState: 'closed',
        consecutiveErrors: 0,
        lastErrorType: null,
        lastErrorMessage: null,
        nextScrapeAt: new Date()
      },
      create: {
        channelId: channel.id,
        circuitState: 'closed',
        nextScrapeAt: new Date()
      }
    })

    return reply.success({ message: 'Channel di-reset: logout + circuit reset + browser clean' })
  })

  // ── POST /channels ──────────────────────────────────────
  fastify.post('/', {
    preHandler: [checkPlanAccess('can_add_own_channel')],
    schema: {
      body: {
        type: 'object',
        required: ['channel_type', 'scraping_config'],
        properties: {
          channel_type: { type: 'string', enum: ['bca_transfer', 'qris_bca', 'qris_gopay', 'qris_bri'] },
          account_name: { type: 'string', maxLength: 100 },
          account_number: { type: 'string', maxLength: 50 },
          scraping_config: {
            type: 'object',
            required: ['username', 'password'],
            properties: {
              username: { type: 'string' },
              password: { type: 'string' }
            }
          },
          qris_data: { type: 'string', maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const { channel_type, scraping_config, qris_data } = request.body
    let { account_name, account_number } = request.body

    const isQris = channel_type.startsWith('qris_')

    // ── QRIS: parse QR data for account_name & account_number ──
    if (isQris) {
      if (!qris_data) {
        return reply.fail('QRIS_DATA_REQUIRED', 'Upload QR code QRIS terlebih dahulu', 422)
      }

      const { extractQrisInfo, isValidQris } = await import('@payment-gateway/shared/qris')

      if (!isValidQris(qris_data)) {
        return reply.fail('INVALID_QRIS', 'Data QRIS tidak valid', 422)
      }

      try {
        const info = extractQrisInfo(qris_data)
        account_name = info.merchantName
        account_number = info.merchantId || 'QRIS'
      } catch (err) {
        return reply.fail('QRIS_PARSE_ERROR', err.message, 422)
      }
    } else {
      // ── Bank Transfer: require manual account_name & account_number ──
      if (!account_name?.trim()) {
        return reply.fail('VALIDATION_ERROR', 'Nama akun wajib diisi', 422)
      }
      if (!account_number?.trim()) {
        return reply.fail('VALIDATION_ERROR', 'Nomor rekening wajib diisi', 422)
      }
    }

    // Validasi: username QRIS BCA harus berupa email
    if (channel_type === 'qris_bca') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(scraping_config.username.trim())) {
        return reply.fail('VALIDATION_ERROR', 'Username QRIS BCA harus berupa alamat email yang valid', 422)
      }
    }


    // Check duplicate account number
    const existing = await db.paymentChannel.findFirst({
      where: { accountNumber: account_number, channelType: channel_type, deletedAt: null }
    })

    if (existing) {
      return reply.fail('CHANNEL_ALREADY_EXISTS', 'Nomor rekening sudah terdaftar', 409)
    }

    // Validate plan channel limit
    const activePlanInfo = getActivePlan(request.client)
    const maxChannels = activePlanInfo?.plan?.maxChannels ?? 0

    const currentCount = await db.paymentChannel.count({
      where: { clientId: request.client.id, deletedAt: null }
    })

    if (currentCount >= maxChannels) {
      return reply.fail('MAX_CHANNELS_REACHED', `Batas maksimal channel (${maxChannels}) telah tercapai. Hubungi kami untuk menambah kuota.`, 422)
    }

    // Encrypt scraping config before storing
    const encryptedConfig = encrypt(JSON.stringify(scraping_config))

    const channel = await db.paymentChannel.create({
      data: {
        clientId: request.client.id,
        channelType: channel_type,
        channelOwner: 'client',
        accountName: account_name,
        accountNumber: account_number,
        scrapingConfig: encryptedConfig,
        ...(isQris && qris_data ? { qrisData: qris_data } : {})
      }
    })

    // Initialize channel state
    await db.channelState.create({
      data: {
        channelId: channel.id,
        scrapePriority: 'medium',
        nextScrapeAt: new Date() // scrape immediately
      }
    })

    return reply.success({
      id: channel.id,
      channel_type: channel.channelType,
      channel_owner: channel.channelOwner,
      account_name: channel.accountName,
      account_number: channel.accountNumber,
      is_active: channel.isActive,
      created_at: channel.createdAt
    }, 201)
  })

  // ── PATCH /channels/:id ─────────────────────────────────
  fastify.patch('/:id', {
    schema: {
      body: {
        type: 'object',
        properties: {
          is_active: { type: 'boolean' },
          scraping_config: {
            type: 'object',
            properties: {
              username: { type: 'string' },
              password: { type: 'string' }
            }
          },
          qris_data: { type: 'string', maxLength: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const channel = await db.paymentChannel.findFirst({
      where: { id: request.params.id, clientId: request.client.id, deletedAt: null }
    })

    if (!channel) {
      return reply.fail('CHANNEL_NOT_FOUND', 'Channel tidak ditemukan', 404)
    }

    const updateData = {}

    // Toggle active
    if (request.body.is_active !== undefined) {
      updateData.isActive = request.body.is_active

      if (!request.body.is_active) {
        // PAUSE: kirim force_logout ke scraper agar browser session ditutup
        await fastify.redis.setex(`pg:cmd:${channel.id}`, 60, 'force_logout')
        console.log(`[Channels] ⏸ Pause: sent force_logout for ${channel.id}`)
      } else {
        // AKTIFKAN: jadwalkan scrape segera agar langsung login & sinkronisasi
        await db.channelState.updateMany({
          where: { channelId: channel.id },
          data: { nextScrapeAt: new Date() }
        })
        console.log(`[Channels] ▶️ Activate: reset nextScrapeAt for ${channel.id}`)
      }
    }

    // Update scraping credentials
    if (request.body.scraping_config) {
      const { username, password } = request.body.scraping_config
      if (!username?.trim() || !password?.trim()) {
        return reply.fail('VALIDATION_ERROR', 'Username dan password wajib diisi', 422)
      }
      updateData.scrapingConfig = encrypt(JSON.stringify({ username, password }))

      // Auto-reactivate channel (in case it was deactivated due to wrong credentials)
      updateData.isActive = true

      // Clear error state + reset circuit breaker
      await db.channelState.updateMany({
        where: { channelId: channel.id },
        data: {
          lastErrorType: null,
          lastErrorMessage: null,
          circuitState: 'closed',
          consecutiveErrors: 0,
          nextScrapeAt: new Date()  // Scrape immediately with new credentials
        }
      })

      // Force logout so next scrape uses new credentials
      await redis.setex(`pg:cmd:${channel.id}`, 300, 'clean_browser')
    }

    // Update QRIS data
    if (request.body.qris_data) {
      const { extractQrisInfo, isValidQris } = await import('@payment-gateway/shared/qris')

      if (!isValidQris(request.body.qris_data)) {
        return reply.fail('INVALID_QRIS', 'Data QRIS tidak valid', 422)
      }

      try {
        const info = extractQrisInfo(request.body.qris_data)
        updateData.qrisData = request.body.qris_data
        updateData.accountName = info.merchantName
        updateData.accountNumber = info.merchantId || 'QRIS'
      } catch (err) {
        return reply.fail('QRIS_PARSE_ERROR', err.message, 422)
      }
    }

    if (Object.keys(updateData).length === 0) {
      return reply.fail('VALIDATION_ERROR', 'Tidak ada data yang diupdate', 422)
    }

    const updated = await db.paymentChannel.update({
      where: { id: channel.id },
      data: updateData
    })

    return reply.success({
      id: updated.id,
      channel_type: updated.channelType,
      account_name: updated.accountName,
      account_number: updated.accountNumber,
      is_active: updated.isActive
    })
  })

  // ── POST /channels/:id/test-connection ──────────────────
  // Sends test login command to scraper via Redis, waits for result
  fastify.post('/:id/test-connection', async (request, reply) => {
    const channel = await db.paymentChannel.findFirst({
      where: { id: request.params.id, clientId: request.client.id, deletedAt: null }
    })

    if (!channel) {
      return reply.fail('CHANNEL_NOT_FOUND', 'Channel tidak ditemukan', 404)
    }

    // Send test command — scraper scheduler picks it up
    const testId = `test_${Date.now()}`
    await redis.setex(`pg:cmd:${channel.id}`, 60, `test_login:${testId}`)

    // Poll Redis for result (scraper writes result back)
    const resultKey = `pg:test_result:${testId}`
    const maxWait = 30 // 30 seconds max
    let result = null

    for (let i = 0; i < maxWait; i++) {
      result = await redis.get(resultKey)
      if (result) {
        await redis.del(resultKey)
        break
      }
      await new Promise(r => setTimeout(r, 1000))
    }

    if (!result) {
      return reply.fail('TEST_TIMEOUT', 'Test koneksi timeout. Pastikan scraper service berjalan.', 408)
    }

    const parsed = JSON.parse(result)
    return reply.success({
      success: parsed.success,
      message: parsed.message
    })
  })

  // ── DELETE /channels/:id ────────────────────────────────
  fastify.delete('/:id', async (request, reply) => {
    const channel = await db.paymentChannel.findFirst({
      where: { id: request.params.id, clientId: request.client.id, deletedAt: null }
    })

    if (!channel) {
      return reply.fail('CHANNEL_NOT_FOUND', 'Channel tidak ditemukan', 404)
    }

    // Cek invoice pending — tidak boleh hapus jika masih ada
    const pendingCount = await db.invoice.count({
      where: { paymentChannelId: channel.id, status: { in: ['pending', 'user_confirmed'] } }
    })

    if (pendingCount > 0) {
      return reply.fail('CHANNEL_HAS_PENDING', `Tidak bisa hapus — masih ada ${pendingCount} invoice aktif yang menggunakan channel ini`, 422)
    }

    // Kirim perintah ke scraper untuk tutup browser session
    await fastify.redis.setex(`pg:cmd:${channel.id}`, 30, 'clean_browser')
    console.log(`[Channels] 🛑 Sent clean_browser to scraper for ${channel.id}`)

    // Tunggu scheduler memprosesnya (~5 detik poll interval)
    await new Promise(r => setTimeout(r, 6000))

    // Soft delete: nonaktifkan dan tandai sebagai dihapus
    await db.paymentChannel.update({
      where: { id: channel.id },
      data: {
        isActive: false,
        deletedAt: new Date()
      }
    })

    // Hapus channelState (tidak dibutuhkan lagi)
    await db.channelState.deleteMany({ where: { channelId: channel.id } })

    // Hapus Redis session & command keys
    await fastify.redis.del(`pg:session:${channel.id}`)
    await fastify.redis.del(`pg:cmd:${channel.id}`)

    console.log(`[Channels] ✅ Soft-deleted channel ${channel.id} (${channel.channelType})`)
    return reply.success(null)
  })
}
