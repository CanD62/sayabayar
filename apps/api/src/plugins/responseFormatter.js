// apps/api/src/plugins/responseFormatter.js
import fp from 'fastify-plugin'

const WIB_OFFSET = 7 * 60 // GMT+7 in minutes

function sanitizeUrlForLog(url = '') {
  if (!url || !url.includes('?')) return url
  try {
    const base = 'http://localhost'
    const u = new URL(url, base)
    if (u.searchParams.has('token')) {
      u.searchParams.set('token', '[REDACTED]')
    }
    const query = u.searchParams.toString()
    return query ? `${u.pathname}?${query}` : u.pathname
  } catch {
    return String(url).replace(/([?&]token=)[^&]*/gi, '$1[REDACTED]')
  }
}

/**
 * Convert Date to WIB ISO string (e.g. "2026-03-25T13:41:24.282+07:00")
 */
function toWIB(date) {
  if (!(date instanceof Date)) return date
  const wib = new Date(date.getTime() + WIB_OFFSET * 60 * 1000)
  return wib.toISOString().replace('Z', '+07:00')
}

/**
 * Recursively convert all Date values in an object to WIB strings
 */
function convertDates(obj) {
  if (obj === null || obj === undefined) return obj
  if (obj instanceof Date) return toWIB(obj)
  if (Array.isArray(obj)) return obj.map(convertDates)
  if (typeof obj === 'object') {
    const result = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = convertDates(value)
    }
    return result
  }
  return obj
}

function nowWIB() {
  return toWIB(new Date())
}

async function formatter(fastify) {
  // Helper to send success response
  fastify.decorateReply('success', function (data, statusCode = 200) {
    return this.code(statusCode).send({
      success: true,
      data: convertDates(data),
      meta: {
        request_id: this.request.id,
        timestamp: nowWIB()
      }
    })
  })

  // Helper to send paginated response
  fastify.decorateReply('paginated', function (data, pagination) {
    return this.code(200).send({
      success: true,
      data: convertDates(data),
      pagination,
      meta: {
        request_id: this.request.id,
        timestamp: nowWIB()
      }
    })
  })

  // Helper to send error response
  fastify.decorateReply('fail', function (code, message, statusCode = 400, details = null) {
    return this.code(statusCode).send({
      success: false,
      error: { code, message, details },
      meta: {
        request_id: this.request.id,
        timestamp: nowWIB()
      }
    })
  })

  // ── 404 Not Found ─────────────────────────────────────────
  fastify.setNotFoundHandler((request, reply) => {
    reply.code(404).send({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: `Route ${request.method} ${sanitizeUrlForLog(request.url)} tidak ditemukan`
      },
      meta: {
        request_id: request.id,
        timestamp: nowWIB()
      }
    })
  })

  // ── Global Error Handler ───────────────────────────────────
  fastify.setErrorHandler((error, request, reply) => {
    const statusCode = error.statusCode || 500

    // Log: hanya 5xx yang perlu level error, sisanya warn
    if (statusCode >= 500) {
      request.log.error({ err: error, method: request.method, url: sanitizeUrlForLog(request.url) }, 'Server error')
    } else {
      request.log.warn({ statusCode, method: request.method, url: sanitizeUrlForLog(request.url), msg: error.message }, 'Client error')
    }

    // Fastify validation error (body/query/params schema mismatch)
    if (error.validation) {
      const details = error.validation.map((v) => ({
        field: v.instancePath?.replace(/^\//,'') || v.params?.missingProperty || 'unknown',
        message: v.message
      }))
      return reply.fail('VALIDATION_ERROR', 'Validasi request gagal', 400, details)
    }

    // Map HTTP status codes ke respon yang informatif
    const errorMap = {
      400: { code: 'BAD_REQUEST',           message: 'Request tidak valid' },
      401: { code: 'UNAUTHORIZED',           message: 'Autentikasi diperlukan' },
      403: { code: 'FORBIDDEN',              message: 'Akses ditolak' },
      404: { code: 'NOT_FOUND',              message: 'Resource tidak ditemukan' },
      405: { code: 'METHOD_NOT_ALLOWED',     message: `Method ${request.method} tidak diizinkan pada endpoint ini` },
      408: { code: 'REQUEST_TIMEOUT',        message: 'Request timeout' },
      409: { code: 'CONFLICT',               message: 'Konflik data' },
      413: { code: 'PAYLOAD_TOO_LARGE',      message: 'Ukuran payload terlalu besar' },
      422: { code: 'UNPROCESSABLE_ENTITY',   message: 'Data tidak dapat diproses' },
      429: { code: 'RATE_LIMIT_EXCEEDED',    message: 'Terlalu banyak request, coba lagi nanti' },
      500: { code: 'INTERNAL_ERROR',         message: 'Internal server error' },
      502: { code: 'BAD_GATEWAY',            message: 'Bad gateway' },
      503: { code: 'SERVICE_UNAVAILABLE',    message: 'Layanan tidak tersedia' },
      504: { code: 'GATEWAY_TIMEOUT',        message: 'Gateway timeout' }
    }

    // ── Prisma / DB errors → pesan ramah user ─────────────────
    // PrismaClientInitializationError: DB tidak bisa direach (down/timeout)
    // PrismaClientKnownRequestError P1xxx: connection/timeout codes
    const isPrismaInit = error.name === 'PrismaClientInitializationError'
    const isPrismaTimeout = error.name === 'PrismaClientKnownRequestError' &&
      (error.code?.startsWith('P1') || error.message?.includes('timeout'))
    const isDbError = isPrismaInit || isPrismaTimeout ||
      error.message?.includes("Can't reach database") ||
      error.message?.includes('DB timeout')

    if (isDbError) {
      return reply.fail(
        'SERVICE_UNAVAILABLE',
        'Sistem sedang mengalami gangguan. Silakan coba beberapa saat lagi.',
        503
      )
    }

    const mapped = errorMap[statusCode]

    if (mapped) {
      // Untuk error yang sudah punya pesan spesifik (dari throw createError / reply.fail di route),
      // gunakan pesan aslinya jika bukan fallback generic Fastify
      const isFastifyGeneric = error.message === mapped.message ||
        ['FST_ERR', 'Not Found', 'Method Not Allowed'].some(p => error.message?.startsWith(p))

      const message = (!isFastifyGeneric && error.message)
        ? error.message
        : mapped.message

      return reply.fail(mapped.code, message, statusCode)
    }

    // Fallback untuk status yang tidak terdaftar
    return reply.fail(
      statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR',
      process.env.NODE_ENV === 'development' ? error.message : 'Terjadi kesalahan',
      statusCode
    )
  })
}

export const responseFormatter = fp(formatter, { name: 'responseFormatter' })
