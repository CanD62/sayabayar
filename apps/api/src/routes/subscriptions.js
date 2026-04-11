// apps/api/src/routes/subscriptions.js
import { authenticate, checkClientStatus } from '../middleware/authenticate.js'
import { INVOICE } from '@payment-gateway/shared/constants'
import { randomBytes } from 'crypto'

/** Generate a cryptographically random 16-char URL-safe payment token */
function generatePaymentToken() {
  return randomBytes(12).toString('base64url')
}

// Platform client ID — must match seed-platform.js
const PLATFORM_CLIENT_ID = 'platform-owner-000000000000000'

function generateInvoiceNumber() {
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  return `SUB-${date}-${rand}`
}

/**
 * Create invoice with retry on invoiceNumber collision (P2002)
 */
async function createInvoiceWithRetry(db, data, maxRetries = 5) {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await db.invoice.create({ data })
    } catch (err) {
      const isUniqueViolation = err.code === 'P2002' &&
        err.meta?.target?.includes('invoiceNumber')
      if (!isUniqueViolation || attempt === maxRetries - 1) throw err
      // Regenerate invoice number with extra entropy on retries
      const now = new Date()
      const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
      const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
      const ms = String(now.getMilliseconds()).padStart(3, '0')
      data.invoiceNumber = `SUB-${date}-${rand}${ms}`
    }
  }
}

export async function subscriptionRoutes(fastify) {
  const db = fastify.db

  fastify.addHook('preHandler', authenticate)
  fastify.addHook('preHandler', checkClientStatus)

  // ── GET /subscriptions/plans ────────────────────────────
  fastify.get('/plans', async (request, reply) => {
    const plans = await db.subscriptionPlan.findMany({
      where: { isActive: true },
      orderBy: { monthlyPrice: 'asc' }
    })

    return reply.success(plans.map(p => ({
      id: p.id,
      name: p.name,
      plan_type: p.planType,
      monthly_price: Number(p.monthlyPrice),
      max_channels: p.maxChannels,
      can_add_own_channel: p.canAddOwnChannel,
      withdraw_fee: Number(p.withdrawFee)
    })))
  })

  // ── GET /subscriptions/current ──────────────────────────
  fastify.get('/current', async (request, reply) => {
    const sub = await db.clientSubscription.findFirst({
      where: { clientId: request.client.id, status: 'active' },
      include: { plan: true },
      orderBy: { createdAt: 'desc' }
    })

    if (!sub) {
      return reply.success({ plan: null, message: 'Belum ada langganan aktif' })
    }

    return reply.success({
      id: sub.id,
      plan: {
        id: sub.plan.id,
        name: sub.plan.name,
        plan_type: sub.plan.planType,
        monthly_price: Number(sub.plan.monthlyPrice),
        max_channels: sub.plan.maxChannels,
        can_add_own_channel: sub.plan.canAddOwnChannel,
        withdraw_fee: Number(sub.plan.withdrawFee)
      },
      status: sub.status,
      current_period_start: sub.currentPeriodStart,
      current_period_end: sub.currentPeriodEnd
    })
  })

  // ── POST /subscriptions/upgrade ─────────────────────────
  // Self-checkout: creates an invoice to platform channel
  // When invoice is paid → webhook auto-activates subscription
  fastify.post('/upgrade', {
    schema: {
      body: {
        type: 'object',
        required: ['plan_id'],
        properties: {
          plan_id: { type: 'string' }
        }
      }
    }
  }, async (request, reply) => {
    const { plan_id } = request.body

    const plan = await db.subscriptionPlan.findUnique({ where: { id: plan_id } })
    if (!plan || !plan.isActive) {
      return reply.fail('PLAN_NOT_FOUND', 'Plan tidak ditemukan', 404)
    }

    if (plan.planType === 'free') {
      // Downgrade to free — activate immediately
      await db.clientSubscription.updateMany({
        where: { clientId: request.client.id, status: 'active' },
        data: { status: 'expired' }
      })

      const sub = await db.clientSubscription.create({
        data: {
          clientId: request.client.id,
          planId: plan.id,
          status: 'active',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date('2099-12-31')
        }
      })

      console.log(`[Subscription] ✅ ${request.client.name} → Free`)
      return reply.success({ status: 'activated', plan_name: plan.name }, 201)
    }

    // Paid plan → create invoice for payment
    // Check if there's already a pending subscription invoice
    const existingInvoice = await db.invoice.findFirst({
      where: {
        clientId: request.client.id,
        description: { startsWith: 'Langganan' },
        status: { in: ['pending', 'user_confirmed'] }
      }
    })

    if (existingInvoice) {
      return reply.success({
        status: 'pending_payment',
        invoice_number: existingInvoice.invoiceNumber,
        payment_url: existingInvoice.paymentUrl,
        amount: Number(existingInvoice.amount),
        message: 'Invoice langganan sudah ada, silakan bayar'
      })
    }

    // Create subscription invoice (channel dipilih saat bayar)
    const invoiceNumber = generateInvoiceNumber()
    const paymentToken = generatePaymentToken()
    const expiredAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
    const amount = Number(plan.monthlyPrice)
    const frontendBaseUrl = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/["']/g, '').split(/[\s,]+/).map(o => o.trim().replace(/\/$/, '')).filter(Boolean)[0]
    const paymentUrl = `${frontendBaseUrl}/pay/${paymentToken}`

    const invoice = await createInvoiceWithRetry(db, {
      clientId: request.client.id,
      invoiceNumber,
      amount,
      uniqueCode: 0,
      amountUnique: amount,
      description: `Langganan ${plan.name} - 1 bulan`,
      source: 'dashboard',
      paymentUrl,
      paymentToken,
      expiredAt
    })

    console.log(`[Subscription] 📋 Invoice ${invoiceNumber} created for ${request.client.name} (Rp ${amount})`)

    return reply.success({
      status: 'pending_payment',
      invoice_number: invoice.invoiceNumber,
      payment_url: invoice.paymentUrl,
      amount: Number(invoice.amount),
      message: 'Silakan bayar untuk mengaktifkan langganan'
    }, 201)
  })

  // NOTE: POST /subscriptions/activate — DIHAPUS (tidak aman).
  // Subscription activation dilakukan langsung oleh matchWorker via DB
  // saat invoice SUB- berhasil dibayar — tanpa melewati API ini.
  // Kalau diperlukan untuk admin override, tambahkan di admin route
  // yang dilindungi INTERNAL_SECRET terpisah.
}
