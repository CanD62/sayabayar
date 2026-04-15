// apps/api/src/middleware/authenticate.js
// Supports both Bearer JWT and X-Api-Key authentication

import jwt from 'jsonwebtoken'
import { hashApiKey } from '@payment-gateway/shared/crypto'
import { ERROR_CODES } from '@payment-gateway/shared/constants'

/**
 * Authentication middleware — resolves client from JWT or API key
 * Sets request.client with client data
 */
export async function authenticate(request, reply) {
  const db = request.server.db

  // ─── Try Bearer JWT first (header or ?token= for SSE/EventSource) ─
  const authHeader = request.headers.authorization
  const rawToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : request.query?.token   // EventSource can't set headers — use ?token=

  if (rawToken) {
    try {
      const payload = jwt.verify(rawToken, process.env.JWT_SECRET)
      const client = await db.client.findUnique({
        where: { id: payload.clientId },
        include: {
          subscriptions: {
            where: { status: 'active' },
            include: { plan: true },
            take: 1
          }
        }
      })

      if (!client) {
        return reply.fail(ERROR_CODES.TOKEN_INVALID, 'Token tidak valid', 401)
      }

      request.client = client
      request.authMethod = 'jwt'
      return
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return reply.fail(ERROR_CODES.TOKEN_EXPIRED, 'Token expired', 401)
      }
      return reply.fail(ERROR_CODES.TOKEN_INVALID, 'Token tidak valid', 401)
    }
  }

  // ─── Try X-Api-Key ──────────────────────────────────────
  const apiKey = request.headers['x-api-key']
  if (apiKey) {
    const keyHash = hashApiKey(apiKey)
    const apiKeyRecord = await db.apiKey.findUnique({
      where: { keyHash },
      include: {
        client: {
          include: {
            subscriptions: {
              where: { status: 'active' },
              include: { plan: true },
              take: 1
            }
          }
        }
      }
    })

    if (!apiKeyRecord || !apiKeyRecord.isActive) {
      return reply.fail(ERROR_CODES.API_KEY_INVALID, 'API key tidak valid atau tidak aktif', 401)
    }

    // Update last_used_at (fire and forget)
    db.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsedAt: new Date() }
    }).catch(() => {})

    request.client = apiKeyRecord.client
    request.authMethod = 'api_key'
    return
  }

  // ─── No auth provided ──────────────────────────────────
  return reply.fail(ERROR_CODES.UNAUTHORIZED, 'Token atau API key diperlukan', 401)
}

/**
 * Check that client status is active
 */
export async function checkClientStatus(request, reply) {
  if (!request.client) {
    return reply.fail(ERROR_CODES.UNAUTHORIZED, 'Not authenticated', 401)
  }

  if (request.client.status !== 'active') {
    return reply.fail(ERROR_CODES.CLIENT_SUSPENDED, 'Akun Anda di-suspend', 403)
  }
}

/**
 * Factory: check if client's plan has a specific permission
 * @param {string} permission - e.g. 'can_add_own_channel'
 */
export function checkPlanAccess(permission) {
  return async (request, reply) => {
    const activeSub = request.client.subscriptions?.[0]
    if (!activeSub) {
      return reply.fail(ERROR_CODES.PLAN_FEATURE_UNAVAILABLE, 'Tidak ada plan aktif', 403)
    }

    const plan = activeSub.plan
    if (permission === 'can_add_own_channel' && !plan.canAddOwnChannel) {
      return reply.fail(
        ERROR_CODES.PLAN_FEATURE_UNAVAILABLE,
        'Fitur ini hanya tersedia untuk plan Langganan',
        403
      )
    }
  }
}

/**
 * Helper: get active plan info from request.client
 * Returns null jika tidak ada plan ATAU plan adalah free tier.
 * Free plan dianggap "tidak berlangganan" untuk keperluan guard limit.
 */
export function getActivePlan(client) {
  const sub = client.subscriptions?.[0]
  if (!sub || sub.plan?.planType === 'free') return null
  return { subscription: sub, plan: sub.plan }
}

/**
 * Helper: cek apakah client adalah free tier
 * (tidak ada subscription aktif, atau subscription-nya adalah free plan)
 */
export function isFreeTier(client) {
  const sub = client.subscriptions?.[0]
  return !sub || sub.plan?.planType === 'free'
}

/**
 * Admin-only middleware — must run AFTER authenticate
 * Checks that the logged-in client is the platform admin
 */
export async function isAdmin(request, reply) {
  const adminEmail = process.env.ADMIN_EMAIL
  if (!adminEmail || request.client?.email !== adminEmail) {
    return reply.fail('FORBIDDEN', 'Akses hanya untuk admin platform', 403)
  }
}

/**
 * Disbursement access middleware — must run AFTER authenticate
 * Checks: role = disbursement_user + KYC approved
 */
export async function requireDisbursementAccess(request, reply) {
  const client = request.client
  if (!client) {
    return reply.fail('UNAUTHORIZED', 'Not authenticated', 401)
  }

  // 1. Cek role
  if (client.role !== 'disbursement_user') {
    return reply.fail(
      'DISBURSEMENT_ROLE_REQUIRED',
      'Akun Anda belum memiliki akses fitur Disbursement. Hubungi admin untuk upgrade.',
      403
    )
  }

  // 2. Cek KYC approved
  const kyc = await request.server.db.kycDocument.findUnique({
    where: { clientId: client.id }
  })

  if (!kyc) {
    return reply.fail(
      'DISBURSEMENT_KYC_REQUIRED',
      'Anda perlu menyelesaikan verifikasi KYC sebelum menggunakan fitur Disbursement.',
      403
    )
  }

  if (kyc.status === 'pending') {
    return reply.fail(
      'DISBURSEMENT_KYC_PENDING',
      'Verifikasi KYC Anda sedang dalam proses review. Mohon tunggu.',
      403
    )
  }

  if (kyc.status === 'rejected') {
    return reply.fail(
      'DISBURSEMENT_KYC_REQUIRED',
      `KYC ditolak: ${kyc.rejectionReason || 'Silakan submit ulang dokumen KYC.'}`,
      403
    )
  }

  request.kycDocument = kyc
}
