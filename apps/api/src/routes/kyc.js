// apps/api/src/routes/kyc.js
// KYC (Know Your Customer) routes for disbursement onboarding
// Upload KTP + selfie → admin review → approve/reject

import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { blockIfImpersonation } from './auth.js'

// Max file size: 5MB per file
const MAX_FILE_SIZE = 5 * 1024 * 1024

// Allowed MIME types
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export async function kycRoutes(fastify) {
  const db = fastify.db

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /kyc/status ───────────────────────────────────────
  // Cek status KYC user saat ini
  fastify.get('/status', async (request, reply) => {
    const client = request.client

    // Cek role dulu
    if (client.role !== 'disbursement_user') {
      return reply.success({
        eligible: false,
        role: client.role,
        message: 'Fitur disbursement belum diaktifkan untuk akun Anda. Hubungi admin.'
      })
    }

    const kyc = await db.kycDocument.findUnique({
      where: { clientId: client.id }
    })

    if (!kyc) {
      return reply.success({
        eligible: true,
        role: client.role,
        kyc_status: null,
        message: 'Silakan submit dokumen KYC untuk mulai menggunakan fitur Disbursement.'
      })
    }

    return reply.success({
      eligible: true,
      role: client.role,
      kyc_status: kyc.status,
      rejection_reason: kyc.rejectionReason || null,
      full_name: kyc.fullName,
      ktp_number: kyc.ktpNumber,
      submitted_at: kyc.createdAt,
      reviewed_at: kyc.reviewedAt,
    })
  })

  // ── POST /kyc/submit ──────────────────────────────────────
  // Submit KYC: upload KTP + selfie + data diri
  // Multipart form: ktp_image, selfie_image, full_name, ktp_number
  fastify.post('/submit', {
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '30 minutes',
        keyGenerator: (req) => `kyc:${req.client?.id || req.ip}`,
        errorResponseBuilder: () => ({
          success: false,
          error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Terlalu banyak percobaan. Coba lagi nanti.' }
        })
      }
    }
  }, async (request, reply) => {
    if (request.isImpersonation) return blockIfImpersonation(request, reply)
    const client = request.client

    // 1. Cek role
    if (client.role !== 'disbursement_user') {
      return reply.fail(
        'DISBURSEMENT_ROLE_REQUIRED',
        'Fitur disbursement belum diaktifkan untuk akun Anda.',
        403
      )
    }

    // 2. Cek apakah sudah ada KYC yang pending/approved
    const existingKyc = await db.kycDocument.findUnique({
      where: { clientId: client.id }
    })

    if (existingKyc?.status === 'approved') {
      return reply.fail('KYC_ALREADY_SUBMITTED', 'KYC Anda sudah diverifikasi.', 422)
    }

    if (existingKyc?.status === 'pending') {
      return reply.fail('KYC_ALREADY_SUBMITTED', 'KYC Anda sedang dalam proses review.', 422)
    }

    // 3. Parse multipart form
    const parts = request.parts()
    const fields = {}
    const files = {}

    for await (const part of parts) {
      if (part.type === 'file') {
        if (!ALLOWED_TYPES.includes(part.mimetype)) {
          return reply.fail('VALIDATION_ERROR', `File ${part.fieldname} harus berformat JPG, PNG, atau WebP.`, 400)
        }

        // Read file to buffer
        const chunks = []
        for await (const chunk of part.file) {
          chunks.push(chunk)
        }
        const buffer = Buffer.concat(chunks)

        if (buffer.length > MAX_FILE_SIZE) {
          return reply.fail('VALIDATION_ERROR', `File ${part.fieldname} terlalu besar (max 5MB).`, 400)
        }

        if (buffer.length === 0) {
          return reply.fail('VALIDATION_ERROR', `File ${part.fieldname} kosong.`, 400)
        }

        files[part.fieldname] = {
          buffer,
          mimetype: part.mimetype,
          filename: part.filename,
        }
      } else {
        fields[part.fieldname] = part.value
      }
    }

    // 4. Validasi fields
    const fullName = fields.full_name?.trim()
    const ktpNumber = fields.ktp_number?.trim()

    if (!fullName || fullName.length < 3) {
      return reply.fail('VALIDATION_ERROR', 'Nama lengkap wajib diisi (min 3 karakter).', 400)
    }

    if (!ktpNumber || !/^\d{16}$/.test(ktpNumber)) {
      return reply.fail('VALIDATION_ERROR', 'Nomor KTP harus 16 digit angka.', 400)
    }

    if (!files.ktp_image) {
      return reply.fail('VALIDATION_ERROR', 'Foto KTP wajib di-upload.', 400)
    }

    if (!files.selfie_image) {
      return reply.fail('VALIDATION_ERROR', 'Foto selfie wajib di-upload.', 400)
    }

    // 5. Upload ke MinIO
    if (!fastify.minio?.s3) {
      return reply.fail('INTERNAL_ERROR', 'File storage belum dikonfigurasi.', 500)
    }

    const ext = (mimetype) => {
      if (mimetype === 'image/png') return 'png'
      if (mimetype === 'image/webp') return 'webp'
      return 'jpg'
    }

    const ktpKey = `kyc/${client.id}/ktp.${ext(files.ktp_image.mimetype)}`
    const selfieKey = `kyc/${client.id}/selfie.${ext(files.selfie_image.mimetype)}`

    try {
      await Promise.all([
        fastify.minio.upload(ktpKey, files.ktp_image.buffer, files.ktp_image.mimetype),
        fastify.minio.upload(selfieKey, files.selfie_image.buffer, files.selfie_image.mimetype),
      ])
    } catch (err) {
      fastify.log.error(`[KYC] Upload failed: ${err.message}`)
      return reply.fail('INTERNAL_ERROR', 'Gagal meng-upload file. Coba lagi.', 500)
    }

    // 6. Upsert KYC document (jika rejected sebelumnya, update)
    const kycData = {
      ktpImagePath: ktpKey,
      selfieImagePath: selfieKey,
      fullName,
      ktpNumber,
      status: 'pending',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
    }

    let kyc
    if (existingKyc) {
      kyc = await db.kycDocument.update({
        where: { clientId: client.id },
        data: kycData,
      })
    } else {
      kyc = await db.kycDocument.create({
        data: { clientId: client.id, ...kycData },
      })
    }

    fastify.log.info(`[KYC] Submitted by ${client.email} (${client.id})`)

    return reply.success({
      kyc_status: kyc.status,
      message: 'Dokumen KYC berhasil di-submit. Mohon tunggu proses verifikasi (1x24 jam).',
      submitted_at: kyc.createdAt,
    }, 201)
  })
}
