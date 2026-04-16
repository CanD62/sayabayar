// apps/api/src/routes/auth.js
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import jwt from 'jsonwebtoken'
import { OAuth2Client } from 'google-auth-library'
import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { sendVerificationEmail, sendPasswordResetEmail } from '../services/email.js'

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID)

const SALT_ROUNDS = 12
const JWT_EXPIRES = parseInt(process.env.JWT_EXPIRES_IN || '900')          // 15 min
const REFRESH_EXPIRES = parseInt(process.env.JWT_REFRESH_EXPIRES_IN || '604800') // 7 days

const VERIFY_TOKEN_TTL  = 60 * 60 * 24  // 24 jam
const RESET_TOKEN_TTL   = 60 * 60       // 1 jam

function generateTokens(clientId) {
  const accessToken = jwt.sign(
    { clientId },
    process.env.JWT_SECRET,
    { expiresIn: JWT_EXPIRES }
  )

  const refreshToken = jwt.sign(
    { clientId, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: REFRESH_EXPIRES }
  )

  return { accessToken, refreshToken }
}

/**
 * Generate a short-lived impersonation token (15 min, no refresh).
 * Payload: { clientId, type: 'impersonation', impersonatedBy }
 */
export function generateImpersonationToken(clientId, adminEmail) {
  return jwt.sign(
    { clientId, type: 'impersonation', impersonatedBy: adminEmail },
    process.env.JWT_SECRET,
    { expiresIn: 900 }  // 15 menit, hardcoded, tidak mengikuti JWT_EXPIRES
  )
}

/**
 * Middleware: blokir aksi destruktif saat sesi impersonation.
 * Pasang di route yang tidak boleh dieksekusi oleh admin yang sedang impersonate.
 */
export async function blockIfImpersonation(request, reply) {
  if (request.isImpersonation) {
    return reply.fail(
      'IMPERSONATION_NOT_ALLOWED',
      'Aksi ini tidak diperbolehkan dalam sesi "Login As". Silakan tutup tab ini.',
      403
    )
  }
}


/** Generate a secure 32-byte hex token (64 chars) */
function generateSecureToken() {
  return crypto.randomBytes(32).toString('hex')
}

export async function authRoutes(fastify) {
  const db    = fastify.db
  const redis = fastify.redis

  // ── POST /auth/register ─────────────────────────────────
  fastify.post('/register', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 hour',
        // Berbasis email (bukan IP) — user dari NAT/proxy yang sama tidak saling kena limit
        keyGenerator: (req) => {
          const email = req.body?.email
          return email ? `register:email:${email.toLowerCase()}` : req.ip
        },
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan registrasi. Coba lagi dalam 1 jam.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['name', 'email', 'password'],
        properties: {
          name:           { type: 'string', minLength: 2, maxLength: 100 },
          email:          { type: 'string', format: 'email', maxLength: 100 },
          password:       { type: 'string', minLength: 8, maxLength: 100 },
          phone:          { type: 'string', maxLength: 20 },
          turnstileToken: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { name, email, password, phone, turnstileToken } = request.body

    // ── Verifikasi Cloudflare Turnstile ───────────────────
    const secretKey = process.env.CF_TURNSTILE_SECRET_KEY
    if (secretKey) {
      if (!turnstileToken) {
        return reply.fail('TURNSTILE_REQUIRED', 'Verifikasi keamanan diperlukan', 400)
      }
      const formData = new URLSearchParams()
      formData.append('secret', secretKey)
      formData.append('response', turnstileToken)
      formData.append('remoteip', request.ip)

      const cfRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: formData,
      })
      const cfJson = await cfRes.json()
      if (!cfJson.success) {
        fastify.log.warn({ errors: cfJson['error-codes'] }, '[register] Turnstile verification failed')
        return reply.fail('TURNSTILE_FAILED', 'Verifikasi keamanan gagal. Silakan coba lagi.', 400)
      }
    }
    // ─────────────────────────────────────────────────────
    // Check duplicate email
    const existing = await db.client.findUnique({ where: { email } })
    if (existing) {
      return reply.fail('DUPLICATE_REQUEST', 'Email sudah terdaftar', 409)
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

    // Create client — emailVerified false by default
    const client = await db.client.create({
      data: { name, email, passwordHash, phone, emailVerified: false }
    })

    // Auto-assign free plan
    const freePlan = await db.subscriptionPlan.findFirst({
      where: { planType: 'free', isActive: true }
    })

    if (freePlan) {
      const now = new Date()
      const endDate = new Date(now)
      endDate.setFullYear(endDate.getFullYear() + 99)

      await db.clientSubscription.create({
        data: {
          clientId: client.id,
          planId: freePlan.id,
          status: 'active',
          currentPeriodStart: now,
          currentPeriodEnd: endDate
        }
      })
    }

    // Create balance record
    await db.clientBalance.create({
      data: { clientId: client.id }
    })

    // Kirim email verifikasi (non-blocking — jangan gagalkan register jika SMTP error)
    const verifyToken = generateSecureToken()
    await redis.setex(`verify_token:${verifyToken}`, VERIFY_TOKEN_TTL, client.id)

    sendVerificationEmail(client.email, client.name, verifyToken).catch(err => {
      fastify.log.error({ err }, '[email] Failed to send verification email')
    })

    return reply.success({
      message: 'Akun berhasil dibuat. Silakan cek email Anda untuk verifikasi.'
    }, 201)
  })

  // ── POST /auth/google ───────────────────────────────────
  fastify.post('/google', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan. Coba lagi nanti.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['idToken'],
        properties: {
          idToken: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { idToken } = request.body

    // Verify Google ID token
    let payload
    try {
      const ticket = await googleClient.verifyIdToken({
        idToken,
        audience: process.env.GOOGLE_CLIENT_ID
      })
      payload = ticket.getPayload()
    } catch (err) {
      return reply.fail('INVALID_GOOGLE_TOKEN', 'Token Google tidak valid', 401)
    }

    const { sub: googleId, email, name, picture } = payload

    if (!email) {
      return reply.fail('GOOGLE_NO_EMAIL', 'Akun Google tidak memiliki email', 400)
    }

    // Check if user already exists by googleId or email
    let client = await db.client.findFirst({
      where: {
        OR: [
          { googleId },
          { email }
        ]
      }
    })

    if (client) {
      // Existing user — link Google account if not yet linked
      if (!client.googleId) {
        await db.client.update({
          where: { id: client.id },
          // Google sudah verifikasi email — set verified = true
          data: { googleId, avatarUrl: picture || undefined, emailVerified: true }
        })
      }

      if (client.status !== 'active') {
        return reply.fail('CLIENT_SUSPENDED', 'Akun Anda di-suspend', 403)
      }
    } else {
      // New user — auto-register via Google (email already verified by Google)
      client = await db.client.create({
        data: {
          name: name || email.split('@')[0],
          email,
          googleId,
          authProvider: 'google',
          avatarUrl: picture || null,
          emailVerified: true  // Google sudah konfirmasi email
        }
      })

      // Auto-assign free plan
      const freePlan = await db.subscriptionPlan.findFirst({
        where: { planType: 'free', isActive: true }
      })

      if (freePlan) {
        const now = new Date()
        const endDate = new Date(now)
        endDate.setFullYear(endDate.getFullYear() + 99)

        await db.clientSubscription.create({
          data: {
            clientId: client.id,
            planId: freePlan.id,
            status: 'active',
            currentPeriodStart: now,
            currentPeriodEnd: endDate
          }
        })
      }

      // Create balance record
      await db.clientBalance.create({
        data: { clientId: client.id }
      })
    }

    // Generate JWT tokens (same as normal login)
    const { accessToken, refreshToken } = generateTokens(client.id)

    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/v1/auth',
      maxAge: REFRESH_EXPIRES
    })

    return reply.success({
      access_token: accessToken,
      expires_in: JWT_EXPIRES
    })
  })

  // ── POST /auth/login ────────────────────────────────────
  fastify.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email:    { type: 'string', format: 'email' },
          password: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { email, password } = request.body

    const client = await db.client.findUnique({ where: { email } })
    if (!client) {
      // Tetap jalankan bcrypt dummy agar response time konsisten (anti timing attack)
      await bcrypt.compare(password, '$2b$12$dummyhashfortimingconsistency000000000000000000000')
      return reply.fail('INVALID_CREDENTIALS', 'Email atau password salah', 401)
    }

    if (client.status !== 'active') {
      return reply.fail('CLIENT_SUSPENDED', 'Akun Anda di-suspend', 403)
    }

    // User registered via Google — no password set
    if (!client.passwordHash) {
      return reply.fail('USE_GOOGLE_LOGIN', 'Akun ini terdaftar via Google. Silakan login dengan Google.', 400)
    }

    // ── Brute force lock per akun ─────────────────────────
    const lockKey = `auth:loginlock:${client.id}`
    const failKey = `auth:loginfail:${client.id}`
    const MAX_ATTEMPTS  = 5
    const LOCK_DURATION = 30 * 60  // 30 menit (detik)

    const isLocked = await redis.get(lockKey)
    if (isLocked) {
      const ttl = await redis.ttl(lockKey)
      const menit = Math.ceil(ttl / 60)
      return reply.fail(
        'ACCOUNT_LOCKED',
        `Akun dikunci sementara karena terlalu banyak percobaan password salah. Coba lagi dalam ${menit} menit.`,
        429
      )
    }
    // ─────────────────────────────────────────────────────

    const valid = await bcrypt.compare(password, client.passwordHash)
    if (!valid) {
      // Increment fail counter
      const fails = await redis.incr(failKey)
      if (fails === 1) await redis.expire(failKey, LOCK_DURATION)  // set TTL hanya pertama kali

      if (fails >= MAX_ATTEMPTS) {
        await redis.setex(lockKey, LOCK_DURATION, '1')
        await redis.del(failKey)
        return reply.fail(
          'ACCOUNT_LOCKED',
          'Akun dikunci 30 menit karena terlalu banyak percobaan password salah.',
          429
        )
      }

      const sisa = MAX_ATTEMPTS - fails
      return reply.fail(
        'INVALID_CREDENTIALS',
        `Email atau password salah. ${sisa} percobaan tersisa sebelum akun dikunci.`,
        401
      )
    }

    // Login berhasil — reset fail counter
    await redis.del(failKey)
    await redis.del(lockKey)

    // Cek verifikasi email
    if (!client.emailVerified) {
      return reply.fail('EMAIL_NOT_VERIFIED', 'Email belum diverifikasi. Silakan cek inbox Anda atau minta kirim ulang email verifikasi.', 403)
    }

    const { accessToken, refreshToken } = generateTokens(client.id)

    // Set refresh token as httpOnly cookie
    reply.setCookie('refresh_token', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/v1/auth',
      maxAge: REFRESH_EXPIRES
    })

    return reply.success({
      access_token: accessToken,
      expires_in: JWT_EXPIRES
    })
  })

  // ── POST /auth/refresh ──────────────────────────────────
  fastify.post('/refresh', async (request, reply) => {
    const refreshToken = request.cookies.refresh_token
    if (!refreshToken) {
      return reply.fail('REFRESH_TOKEN_EXPIRED', 'Refresh token tidak ditemukan', 401)
    }

    try {
      const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
      if (payload.type !== 'refresh') {
        return reply.fail('TOKEN_INVALID', 'Token tidak valid', 401)
      }

      const { accessToken, refreshToken: newRefreshToken } = generateTokens(payload.clientId)

      reply.setCookie('refresh_token', newRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        path: '/v1/auth',
        maxAge: REFRESH_EXPIRES
      })

      return reply.success({
        access_token: accessToken,
        expires_in: JWT_EXPIRES
      })
    } catch (err) {
      return reply.fail('REFRESH_TOKEN_EXPIRED', 'Refresh token expired, silakan login ulang', 401)
    }
  })

  // ── POST /auth/restore ──────────────────────────────────
  fastify.post('/restore', async (request, reply) => {
    const refreshToken = request.cookies.refresh_token
    if (!refreshToken) {
      return reply.fail('REFRESH_TOKEN_EXPIRED', 'Sesi tidak ditemukan', 401)
    }

    let payload
    try {
      payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)
      if (payload.type !== 'refresh') {
        return reply.fail('TOKEN_INVALID', 'Token tidak valid', 401)
      }
    } catch {
      return reply.fail('REFRESH_TOKEN_EXPIRED', 'Sesi expired, silakan login ulang', 401)
    }

    const client = await db.client.findUnique({
      where: { id: payload.clientId },
      include: {
        subscriptions: {
          where: { status: 'active' },
          include: { plan: true },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    if (!client || client.status !== 'active') {
      return reply.fail('CLIENT_SUSPENDED', 'Akun tidak aktif', 403)
    }

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(client.id)

    reply.setCookie('refresh_token', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/v1/auth',
      maxAge: REFRESH_EXPIRES
    })

    const activeSub = client.subscriptions?.[0]

    // Fetch KYC status if disbursement_user
    let kycStatus = null
    if (client.role === 'disbursement_user') {
      const kyc = await db.kycDocument.findUnique({
        where: { clientId: client.id },
        select: { status: true }
      })
      kycStatus = kyc?.status || null
    }

    return reply.success({
      access_token: accessToken,
      expires_in: JWT_EXPIRES,
      user: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        status: client.status,
        auth_provider: client.authProvider,
        avatar_url: client.avatarUrl,
        has_password: !!client.passwordHash,
        email_verified: client.emailVerified,
        is_admin: client.email === process.env.ADMIN_EMAIL,
        role: client.role,
        kyc_status: kycStatus,
        plan: activeSub ? {
          name: activeSub.plan.name,
          plan_type: activeSub.plan.planType,
          current_period_end: activeSub.currentPeriodEnd
        } : null,
        created_at: client.createdAt
      }
    })
  })

  // ── POST /auth/logout ───────────────────────────────────
  fastify.post('/logout', async (request, reply) => {
    reply.clearCookie('refresh_token', { path: '/v1/auth' })
    return reply.success(null)
  })

  // ── PATCH /auth/profile ──────────────────────────────────
  fastify.patch('/profile', {
    preHandler: [authenticate, checkClientStatus],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:  { type: 'string', minLength: 2, maxLength: 100 },
          phone: { type: 'string', maxLength: 20 }
        }
      }
    }
  }, async (request, reply) => {
    const { name, phone } = request.body
    const data = {}

    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone || null

    if (Object.keys(data).length === 0) {
      return reply.fail('VALIDATION_ERROR', 'Tidak ada data yang diubah', 400)
    }

    const updated = await db.client.update({
      where: { id: request.client.id },
      data
    })

    return reply.success({
      id: updated.id,
      name: updated.name,
      phone: updated.phone
    })
  })

  // ── POST /auth/change-password ──────────────────────────
  fastify.post('/change-password', {
    preHandler: [authenticate, checkClientStatus],
    schema: {
      body: {
        type: 'object',
        required: ['newPassword'],
        properties: {
          oldPassword: { type: 'string' },
          newPassword: { type: 'string', minLength: 8, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { oldPassword, newPassword } = request.body
    const client = request.client

    // If the user has a password, they must provide oldPassword
    if (client.passwordHash) {
      if (!oldPassword) {
        return reply.fail('VALIDATION_ERROR', 'Password lama wajib diisi', 400)
      }
      const valid = await bcrypt.compare(oldPassword, client.passwordHash)
      if (!valid) {
        return reply.fail('INVALID_CREDENTIALS', 'Password lama salah', 400)
      }
    }
    // If no passwordHash (Google-only user), allow setting password without oldPassword

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS)

    await db.client.update({
      where: { id: client.id },
      data: { passwordHash }
    })

    return reply.success({ message: 'Password berhasil diubah' })
  })

  // ── GET /auth/me ────────────────────────────────────────
  fastify.get('/me', {
    preHandler: [authenticate, checkClientStatus]
  }, async (request, reply) => {
    const client = request.client
    const activeSub = client.subscriptions?.[0]

    // Fetch KYC status if disbursement_user
    let kycStatus = null
    if (client.role === 'disbursement_user') {
      const kyc = await request.server.db.kycDocument.findUnique({
        where: { clientId: client.id },
        select: { status: true }
      })
      kycStatus = kyc?.status || null
    }

    return reply.success({
      id: client.id,
      name: client.name,
      email: client.email,
      phone: client.phone,
      status: client.status,
      auth_provider: client.authProvider,
      avatar_url: client.avatarUrl,
      has_password: !!client.passwordHash,
      email_verified: client.emailVerified,
      is_admin: client.email === process.env.ADMIN_EMAIL,
      role: client.role,
      kyc_status: kycStatus,
      plan: activeSub ? {
        name: activeSub.plan.name,
        plan_type: activeSub.plan.planType,
        current_period_end: activeSub.currentPeriodEnd
      } : null,
      created_at: client.createdAt
    })
  })

  // ── POST /auth/forgot-password ──────────────────────────
  // Rate limit: max 3 per 15 menit per IP
  fastify.post('/forgot-password', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request, reply) => {
    const { email } = request.body

    // Selalu return sukses meskipun email tidak ditemukan (mencegah user enumeration)
    const successMsg = { message: 'Jika email terdaftar, link reset password telah dikirim.' }

    const client = await db.client.findUnique({ where: { email } })
    if (!client || client.status !== 'active') {
      return reply.success(successMsg)
    }

    // User hanya bisa reset password jika punya password (bukan Google-only)
    if (!client.passwordHash) {
      // Tetap sukses agar tidak bocorkan info
      return reply.success(successMsg)
    }

    const token = generateSecureToken()
    await redis.setex(`reset_token:${token}`, RESET_TOKEN_TTL, client.id)

    sendPasswordResetEmail(client.email, client.name, token).catch(err => {
      fastify.log.error({ err }, '[email] Failed to send password reset email')
    })

    return reply.success(successMsg)
  })

  // ── POST /auth/reset-password ───────────────────────────
  fastify.post('/reset-password', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token:    { type: 'string', minLength: 64, maxLength: 64 },
          password: { type: 'string', minLength: 8, maxLength: 100 }
        }
      }
    }
  }, async (request, reply) => {
    const { token, password } = request.body

    const clientId = await redis.get(`reset_token:${token}`)
    if (!clientId) {
      return reply.fail('TOKEN_INVALID', 'Link reset password tidak valid atau sudah kadaluarsa.', 400)
    }

    const client = await db.client.findUnique({ where: { id: clientId } })
    if (!client || client.status !== 'active') {
      return reply.fail('TOKEN_INVALID', 'Link reset password tidak valid.', 400)
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS)

    await db.client.update({
      where: { id: client.id },
      data: { passwordHash }
    })

    // One-time use — hapus token dari Redis
    await redis.del(`reset_token:${token}`)

    return reply.success({ message: 'Password berhasil diubah. Silakan login dengan password baru.' })
  })

  // ── GET /auth/verify-email ──────────────────────────────
  fastify.get('/verify-email', {
    schema: {
      querystring: {
        type: 'object',
        required: ['token'],
        properties: {
          token: { type: 'string', minLength: 64, maxLength: 64 }
        }
      }
    }
  }, async (request, reply) => {
    const { token } = request.query

    const clientId = await redis.get(`verify_token:${token}`)
    if (!clientId) {
      return reply.fail('TOKEN_INVALID', 'Link verifikasi tidak valid atau sudah kadaluarsa.', 400)
    }

    const client = await db.client.findUnique({ where: { id: clientId } })
    if (!client) {
      return reply.fail('TOKEN_INVALID', 'Akun tidak ditemukan.', 400)
    }

    if (client.emailVerified) {
      // Sudah terverifikasi — hapus token dan return sukses
      await redis.del(`verify_token:${token}`)
      return reply.success({ message: 'Email sudah terverifikasi sebelumnya. Silakan login.' })
    }

    await db.client.update({
      where: { id: client.id },
      data: { emailVerified: true }
    })

    // One-time use — hapus token dari Redis
    await redis.del(`verify_token:${token}`)

    return reply.success({ message: 'Email berhasil diverifikasi! Selamat datang di SayaBayar.' })
  })

  // ── POST /auth/resend-verification ─────────────────────
  fastify.post('/resend-verification', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '15 minutes',
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak permintaan. Coba lagi dalam 15 menit.' }
        })
      }
    },
    schema: {
      body: {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }, async (request, reply) => {
    // Selalu return sukses (anti user enumeration)
    const successMsg = { message: 'Jika email terdaftar dan belum terverifikasi, email verifikasi telah dikirim.' }

    const client = await db.client.findUnique({ where: { email: request.body.email } })
    if (!client || client.emailVerified || client.status !== 'active') {
      return reply.success(successMsg)
    }

    const token = generateSecureToken()
    await redis.setex(`verify_token:${token}`, VERIFY_TOKEN_TTL, client.id)

    sendVerificationEmail(client.email, client.name, token).catch(err => {
      fastify.log.error({ err }, '[email] Failed to resend verification email')
    })

    return reply.success(successMsg)
  })
}
