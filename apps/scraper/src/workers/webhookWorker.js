// apps/scraper/src/workers/webhookWorker.js
// Delivers webhook notifications to client endpoints

import { Worker } from 'bullmq'
import { getRedisConnection, QUEUE_PREFIX } from '../queues.js'
import { getDb } from '@payment-gateway/shared/db'
import { generateWebhookSignature, decrypt } from '@payment-gateway/shared/crypto'
import { WEBHOOK } from '@payment-gateway/shared/constants'
import dns from 'node:dns/promises'
import net from 'node:net'

function isPrivateOrReservedIp(ip) {
  const version = net.isIP(ip)
  if (version === 4) {
    const [a, b] = ip.split('.').map(Number)
    if (a === 10 || a === 127 || a === 0) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a >= 224) return true
    return false
  }

  if (version === 6) {
    const v = ip.toLowerCase()
    if (v === '::1' || v === '::') return true
    if (v.startsWith('fc') || v.startsWith('fd')) return true
    if (v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb')) return true
    if (v.startsWith('2001:db8')) return true
    if (v.startsWith('::ffff:')) {
      const mapped = v.slice(7)
      return net.isIP(mapped) === 4 ? isPrivateOrReservedIp(mapped) : true
    }
    return false
  }

  return true
}

async function normalizeSafeWebhookUrl(rawUrl) {
  if (!rawUrl) return { ok: false, message: 'URL webhook kosong' }

  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    return { ok: false, message: 'URL webhook tidak valid' }
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, message: 'Protokol webhook harus http/https' }
  }

  if (parsed.username || parsed.password) {
    return { ok: false, message: 'Webhook URL tidak boleh mengandung kredensial' }
  }

  const host = parsed.hostname.toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, message: 'Host internal tidak diizinkan' }
  }

  if (net.isIP(host)) {
    return isPrivateOrReservedIp(host)
      ? { ok: false, message: 'IP private/internal tidak diizinkan' }
      : { ok: true, url: parsed.toString() }
  }

  try {
    const records = await dns.lookup(host, { all: true, verbatim: true })
    if (!records.length) return { ok: false, message: 'Host tidak dapat di-resolve' }
    if (records.some((r) => isPrivateOrReservedIp(r.address))) {
      return { ok: false, message: 'Host mengarah ke IP private/internal' }
    }
  } catch {
    return { ok: false, message: 'Host tidak dapat di-resolve' }
  }

  return { ok: true, url: parsed.toString() }
}

export function startWebhookWorker(concurrency = 3) {
  const worker = new Worker('webhook', async (job) => {
    const { invoiceId, event, clientId } = job.data
    const db = getDb()

    // ── Get invoice data ──────────────────────────────────
    const invoice = await db.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        paymentChannel: { select: { channelType: true, accountName: true } }
      }
    })

    if (!invoice) {
      console.log(`[WebhookWorker] Invoice ${invoiceId} not found, skipping`)
      return
    }

    // ── Get client webhook endpoints ──────────────────────
    const endpoints = await db.webhookEndpoint.findMany({
      where: {
        clientId,
        isActive: true
      }
    })

    // Filter endpoints that subscribe to this event
    const matchingEndpoints = endpoints.filter(ep => {
      const eventTypes = ep.eventTypes
      return Array.isArray(eventTypes) && eventTypes.includes(event)
    })

    if (matchingEndpoints.length === 0) {
      console.log(`[WebhookWorker] No endpoints for event "${event}" (client: ${clientId})`)
      return
    }

    // ── Build payload ─────────────────────────────────────
    const payload = {
      event,
      data: {
        invoice_id: invoice.id,
        invoice_number: invoice.invoiceNumber,
        amount: Number(invoice.amount),
        amount_unique: Number(invoice.amountUnique),
        status: invoice.status,
        payment_channel: invoice.paymentChannel.channelType,
        paid_at: invoice.paidAt?.toISOString()
      },
      timestamp: new Date().toISOString()
    }

    const payloadStr = JSON.stringify(payload)

    // ── Deliver to each endpoint ──────────────────────────
    for (const endpoint of matchingEndpoints) {
      const attemptNumber = job.attemptsMade + 1

      try {
        const safe = await normalizeSafeWebhookUrl(endpoint.url)
        if (!safe.ok) {
          await db.webhookLog.create({
            data: {
              webhookId: endpoint.id,
              invoiceId,
              httpStatus: null,
              responseBody: `BLOCKED_UNSAFE_WEBHOOK_URL: ${safe.message}`.slice(0, 500),
              attemptNumber
            }
          })
          console.warn(`[WebhookWorker] ⛔ Blocked unsafe webhook endpoint ${endpoint.url}: ${safe.message}`)
          continue
        }

        // Gunakan raw secret (terenkripsi di DB) sebagai HMAC key — standar industri
        // Fallback ke secretHash untuk webhook lama yang belum punya secretEncrypted
        const hmacKey   = endpoint.secretEncrypted
          ? decrypt(endpoint.secretEncrypted)
          : endpoint.secretHash
        const signature = generateWebhookSignature(payloadStr, hmacKey)

        const response = await fetch(safe.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Webhook-Signature': signature,
            'X-Webhook-Event': event,
            'User-Agent': 'PaymentGateway-Webhook/1.0'
          },
          body: payloadStr,
          signal: AbortSignal.timeout(10000)
        })

        const responseBody = await response.text().catch(() => '')

        // Log delivery
        await db.webhookLog.create({
          data: {
            webhookId: endpoint.id,
            invoiceId,
            httpStatus: response.status,
            responseBody: responseBody.slice(0, 500),
            attemptNumber
          }
        })

        if (response.ok) {
          console.log(`[WebhookWorker] ✅ Delivered to ${endpoint.url} (${response.status})`)
        } else {
          console.log(`[WebhookWorker] ⚠️ ${endpoint.url} responded ${response.status}`)
          if (attemptNumber < WEBHOOK.MAX_ATTEMPTS) {
            throw new Error(`Webhook returned ${response.status}`)
          }
        }

      } catch (error) {
        // Log failed delivery
        await db.webhookLog.create({
          data: {
            webhookId: endpoint.id,
            invoiceId,
            httpStatus: null,
            responseBody: error.message.slice(0, 500),
            attemptNumber
          }
        }).catch(() => {})

        if (attemptNumber < WEBHOOK.MAX_ATTEMPTS) {
          throw error // triggers BullMQ retry
        }
        console.error(`[WebhookWorker] ❌ Failed after ${attemptNumber} attempts: ${endpoint.url}`)
      }
    }

  }, {
    connection: getRedisConnection(),
    prefix: QUEUE_PREFIX,
    concurrency,
    stalledInterval: 30_000,  // cek stalled job setiap 30s
    maxStalledCount: 3,       // retry 3x sebelum dianggap failed
    settings: {
      backoffStrategy: (attemptsMade) => {
        return WEBHOOK.BACKOFF_DELAYS[attemptsMade - 1] || 21_600_000 // default 6h
      }
    }
  })

  worker.on('failed', (job, err) => {
    console.error(`[WebhookWorker] Job ${job.id} failed:`, err.message)
  })

  console.log(`[WebhookWorker] Started with concurrency: ${concurrency}`)
  return worker
}
