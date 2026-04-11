// apps/scraper/src/queues.js
// BullMQ Queue Definitions

import { Queue } from 'bullmq'

let connection = null

// Prefix isolates dev/prod queues when sharing the same Redis instance
const ENV = process.env.NODE_ENV || 'development'
export const QUEUE_PREFIX = ENV === 'production' ? 'bull' : `bull:${ENV}`

export function getRedisConnection() {
  if (!connection) {
    const url = new URL(process.env.REDIS_URL || 'redis://localhost:6379')
    connection = {
      host: url.hostname,
      port: parseInt(url.port) || 6379,
      password: url.password || undefined,
      maxRetriesPerRequest: null
    }
  }
  return connection
}

// ── Scrape Queue ──────────────────────────────────────────
// Job: { channelId, channelType, scrapingConfig, priority }
export const scrapeQueue = new Queue('scrape', {
  connection: getRedisConnection(),
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 }
  }
})

// ── Match Queue ───────────────────────────────────────────
// Job: { transactionId, channelId, amount, referenceNumber }
// attempts harus sama dengan MATCH.MAX_ATTEMPTS (5) di constants
export const matchQueue = new Queue('match', {
  connection: getRedisConnection(),
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    removeOnComplete: { count: 200 },
    removeOnFail: { count: 50 },
    attempts: 5,
    backoff: { type: 'fixed', delay: 30000 }
  }
})

// ── Webhook Queue ──────────────────────────────────────────
// Job: { invoiceId, event, clientId }
export const webhookQueue = new Queue('webhook', {
  connection: getRedisConnection(),
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    removeOnComplete: { count: 500 },
    removeOnFail: { count: 100 },
    attempts: 5,
    backoff: { type: 'custom' }
  }
})

// ── Flip Transfer Queue ────────────────────────────────────
// Job: { withdrawalId, triggeredBy: 'auto' | 'admin' }
// concurrency=1 — WAJIB sequential, tidak boleh paralel ke Flip
export const flipQueue = new Queue('flip', {
  connection: getRedisConnection(),
  prefix: QUEUE_PREFIX,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail:     { count: 50 },
    attempts:         3,   // max 3x retry jika Flip gangguan
    backoff: { type: 'exponential', delay: 30_000 } // 30s, 1m, 2m
  }
})

