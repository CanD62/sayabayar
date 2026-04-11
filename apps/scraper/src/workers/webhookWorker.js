// apps/scraper/src/workers/webhookWorker.js
// Delivers webhook notifications to client endpoints

import { Worker } from 'bullmq'
import { getRedisConnection, QUEUE_PREFIX } from '../queues.js'
import { getDb } from '@payment-gateway/shared/db'
import { generateWebhookSignature, decrypt } from '@payment-gateway/shared/crypto'
import { WEBHOOK } from '@payment-gateway/shared/constants'

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
        // Gunakan raw secret (terenkripsi di DB) sebagai HMAC key — standar industri
        // Fallback ke secretHash untuk webhook lama yang belum punya secretEncrypted
        const hmacKey   = endpoint.secretEncrypted
          ? decrypt(endpoint.secretEncrypted)
          : endpoint.secretHash
        const signature = generateWebhookSignature(payloadStr, hmacKey)

        const response = await fetch(endpoint.url, {
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
