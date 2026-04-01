// apps/scraper/src/sessionStore.js
// Redis-based session status tracking for browser pool
// Allows API service to read session state and send management commands

import IORedis from 'ioredis'

let redis = null

function getRedis() {
  if (!redis) {
    redis = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      lazyConnect: false
    })
  }
  return redis
}

const SESSION_TTL = 4 * 60 * 60 // 4 hours

/**
 * Update session status in Redis (called by browserPool)
 */
export async function setSessionStatus(channelId, isLoggedIn) {
  const r = getRedis()
  const data = JSON.stringify({
    isLoggedIn,
    updatedAt: new Date().toISOString()
  })
  await r.setex(`pg:session:${channelId}`, SESSION_TTL, data)
}

/**
 * Get session status from Redis (called by API)
 */
export async function getSessionStatus(channelId) {
  const r = getRedis()
  const data = await r.get(`pg:session:${channelId}`)
  if (!data) return { isLoggedIn: false, updatedAt: null }
  return JSON.parse(data)
}

/**
 * Get all session statuses (batch)
 */
export async function getAllSessionStatuses(channelIds) {
  const r = getRedis()
  const pipeline = r.pipeline()
  for (const id of channelIds) {
    pipeline.get(`pg:session:${id}`)
  }
  const results = await pipeline.exec()

  const statuses = {}
  channelIds.forEach((id, i) => {
    const [err, data] = results[i]
    if (data) {
      statuses[id] = JSON.parse(data)
    } else {
      statuses[id] = { isLoggedIn: false, updatedAt: null }
    }
  })
  return statuses
}

/**
 * Send management command (called by API)
 * Scraper scheduler picks this up
 */
export async function sendCommand(channelId, command) {
  const r = getRedis()
  // command: 'force_logout' | 'clean_browser'
  await r.setex(`pg:cmd:${channelId}`, 300, command) // expires in 5 min
}

/**
 * Check and consume pending command (called by scraper scheduler)
 */
export async function consumeCommand(channelId) {
  const r = getRedis()
  const cmd = await r.get(`pg:cmd:${channelId}`)
  if (cmd) {
    await r.del(`pg:cmd:${channelId}`)
  }
  return cmd // null | 'force_logout' | 'clean_browser'
}

/**
 * Clear session status (called on logout/clean)
 */
export async function clearSessionStatus(channelId) {
  const r = getRedis()
  await r.del(`pg:session:${channelId}`)
}

export async function closeSessionStore() {
  if (redis) {
    await redis.quit()
    redis = null
  }
}
