// apps/api/src/plugins/redis.js
// Redis plugin — non-blocking, API tetap jalan meskipun Redis down
import fp from 'fastify-plugin'
import Redis from 'ioredis'

async function redis(fastify) {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 3000,
    retryStrategy: (times) => {
      if (times > 3) return null  // stop after 3 retries, don't loop forever
      return Math.min(times * 1000, 3000)
    },
    lazyConnect: false,           // connect immediately in background
    enableOfflineQueue: true      // queue commands while disconnected
  })

  let connected = false

  client.on('connect', () => {
    connected = true
    fastify.log.info('Redis connected')
  })

  client.on('error', (err) => {
    // Only log once, not every retry
    if (connected) {
      fastify.log.error('Redis disconnected: ' + err.message)
      connected = false
    }
  })

  client.on('end', () => {
    connected = false
  })

  // Decorate with a proxy that falls back gracefully
  const safeRedis = {
    get status() { return client.status },
    get: (...args) => client.get(...args).catch(() => null),
    set: (...args) => client.set(...args).catch(() => 'OK'),
    setex: (...args) => client.setex(...args).catch(() => 'OK'),
    del: (...args) => client.del(...args).catch(() => 0),
    incr: (...args) => client.incr(...args).catch(() => 0),
    expire: (...args) => client.expire(...args).catch(() => 0),
    expireat: (...args) => client.expireat(...args).catch(() => 0),
    ttl: (...args) => client.ttl(...args).catch(() => -1),
    publish: (...args) => client.publish(...args).catch(() => 0),
    pipeline: () => {
      const p = client.pipeline()
      const origExec = p.exec.bind(p)
      p.exec = () => origExec().catch(() => [])
      return p
    },
    on: (...args) => client.on(...args),
    quit: () => client.quit().catch(() => {}),
    duplicate: (options) => client.duplicate(options)
  }

  fastify.decorate('redis', safeRedis)

  fastify.addHook('onClose', async () => {
    await client.quit().catch(() => {})
  })
}

export const redisPlugin = fp(redis, { name: 'redis' })
