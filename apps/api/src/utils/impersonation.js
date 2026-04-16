// apps/api/src/utils/impersonation.js
// Utility untuk admin impersonation — terpisah dari route files agar bisa di-import lintas modul

import jwt from 'jsonwebtoken'

/**
 * Generate a short-lived impersonation token (15 min, no refresh).
 * Payload: { clientId, type: 'impersonation', impersonatedBy }
 */
export function generateImpersonationToken(clientId, adminEmail) {
  return jwt.sign(
    { clientId, type: 'impersonation', impersonatedBy: adminEmail },
    process.env.JWT_SECRET,
    { expiresIn: 900 }  // 15 menit — hardcoded, tidak mengikuti JWT_EXPIRES
  )
}

/**
 * Fastify preHandler: blokir aksi destruktif saat sesi impersonation.
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
