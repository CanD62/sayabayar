// apps/scraper/src/scrapers/qrisBcaSession.js
// Session persistence untuk QRIS BCA — simpan cookies + localStorage ke Redis
// Token BCA: 30 menit (auto-refresh), hard expiry 8 jam dari login.
// Kita pakai expiry 7 jam untuk margin aman sebelum hard expiry.

import Redis from 'ioredis'

const SESSION_EXPIRY_SECONDS = 7 * 60 * 60  // 7 jam
const REDIS_KEY_PREFIX = 'bca:session:'

let redisClient = null

function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: 2,
      connectTimeout: 5000,
      retryStrategy(times) {
        if (times > 3) return null  // Stop retry setelah 3x — session bersifat optional
        return Math.min(times * 200, 1000)
      }
    })
    redisClient.on('error', (err) => {
      if (err.code !== 'ECONNREFUSED' && err.code !== 'ETIMEDOUT') {
        console.error('[BCA Session] Redis error:', err.message)
      }
    })
  }
  return redisClient
}

/**
 * Simpan cookies + localStorage ke Redis setelah login berhasil.
 * @param {string} channelId
 * @param {import('playwright').Page} page
 */
export async function saveSession(channelId, page) {
  try {
    const redis = getRedisClient()
    if (redis.status === 'end' || redis.status === 'close') return

    const cookies = await page.context().cookies()
    const localStorage = await page.evaluate(() => {
      const data = {}
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i)
        data[key] = window.localStorage.getItem(key)
      }
      return data
    }).catch(() => ({}))

    const sessionData = {
      cookies,
      localStorage,
      savedAt: Date.now()
    }

    const key = REDIS_KEY_PREFIX + channelId
    await redis.set(key, JSON.stringify(sessionData), 'EX', SESSION_EXPIRY_SECONDS)
    console.log(`[BCA Session] ✅ Session saved (${cookies.length} cookies, ${Object.keys(localStorage).length} localStorage keys)`)
  } catch (err) {
    console.log(`[BCA Session] ⚠️ Failed to save session: ${err.message}`)
  }
}

/**
 * Ambil session data dari Redis TANPA navigasi.
 * Caller bertanggung jawab untuk restore cookies + localStorage ke page.
 *
 * Dipisah dari navigasi agar qrisBca.js bisa:
 *   1. Restore cookies (sebelum goto)
 *   2. goto(HOME_URL, commit) — satu request ke BCA
 *   3. Set localStorage (setelah commit, sebelum Angular run)
 *   4. Wait untuk Angular render tabel (verifikasi)
 *
 * = SATU round-trip ke BCA, bukan dua (LOGIN_URL + HOME_URL).
 *
 * @param {string} channelId
 * @returns {Promise<{cookies: Array, localStorage: object, savedAt: number}|null>}
 */
export async function loadSession(channelId) {
  try {
    const redis = getRedisClient()
    if (redis.status === 'end' || redis.status === 'close') return null

    const key = REDIS_KEY_PREFIX + channelId
    const raw = await redis.get(key)
    if (!raw) {
      console.log('[BCA Session] No saved session found')
      return null
    }

    const sessionData = JSON.parse(raw)
    const ageSeconds = (Date.now() - sessionData.savedAt) / 1000
    const remainingHours = ((SESSION_EXPIRY_SECONDS - ageSeconds) / 3600).toFixed(1)

    console.log(`[BCA Session] ✅ Session data loaded (age: ${Math.floor(ageSeconds / 60)}m, expires in: ${remainingHours}h)`)
    return sessionData
  } catch (err) {
    console.log(`[BCA Session] ⚠️ Failed to load session: ${err.message}`)
    return null
  }
}

/**
 * Hapus session dari Redis (saat logout atau invalid_grant).
 * @param {string} channelId
 */
export async function clearSession(channelId) {
  try {
    const redis = getRedisClient()
    if (redis.status === 'end' || redis.status === 'close') return
    await redis.del(REDIS_KEY_PREFIX + channelId)
    console.log('[BCA Session] 🗑️ Session cleared from Redis')
  } catch (err) {
    console.log(`[BCA Session] ⚠️ Failed to clear session: ${err.message}`)
  }
}
