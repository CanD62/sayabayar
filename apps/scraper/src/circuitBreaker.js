// apps/scraper/src/circuitBreaker.js
// Circuit Breaker: CLOSED → OPEN → HALF_OPEN

import { CIRCUIT_BREAKER } from '@payment-gateway/shared/constants'
import { getDb } from '@payment-gateway/shared/db'

/**
 * Check if channel circuit is open (should NOT scrape)
 * @param {string} channelId
 * @returns {boolean} true if circuit allows scraping
 */
export async function canScrape(channelId) {
  const db = getDb()
  const state = await db.channelState.findUnique({ where: { channelId } })

  if (!state) return true // no state = assume OK

  if (state.circuitState === 'closed') return true

  if (state.circuitState === 'open') {
    // Check cooldown
    const elapsed = Date.now() - new Date(state.circuitOpenedAt).getTime()
    if (elapsed >= CIRCUIT_BREAKER.COOLDOWN_MS) {
      // Transition to HALF_OPEN — allow one attempt
      await db.channelState.update({
        where: { channelId },
        data: { circuitState: 'half_open' }
      })
      console.log(`[CircuitBreaker] ${channelId}: OPEN → HALF_OPEN (cooldown expired)`)
      return true
    }
    return false // still in cooldown
  }

  // half_open → allow
  return true
}

/**
 * Record scraping success — reset circuit to CLOSED
 * @param {string} channelId
 */
export async function recordSuccess(channelId) {
  const db = getDb()
  await db.channelState.update({
    where: { channelId },
    data: {
      circuitState: 'closed',
      consecutiveErrors: 0,
      lastSuccessAt: new Date(),
      lastScrapedAt: new Date(),
      lastErrorType: null,
      lastErrorMessage: null
    }
  })
}

/**
 * Record scraping error — increment counter, possibly open circuit
 * @param {string} channelId
 * @param {'fatal'|'transient'|'empty_result'} errorType
 * @param {string} errorMessage
 */
export async function recordError(channelId, errorType, errorMessage) {
  const db = getDb()
  const state = await db.channelState.findUnique({ where: { channelId } })
  const consecutiveErrors = (state?.consecutiveErrors || 0) + 1

  const data = {
    consecutiveErrors,
    lastErrorAt: new Date(),
    lastErrorType: errorType,
    lastErrorMessage: errorMessage.slice(0, 500),
    lastScrapedAt: new Date()
  }

  // Fatal errors → open circuit immediately
  if (errorType === 'fatal') {
    data.circuitState = 'open'
    data.circuitOpenedAt = new Date()
    console.log(`[CircuitBreaker] ${channelId}: → OPEN (fatal error: ${errorMessage})`)
  }
  // Transient errors → open circuit after threshold
  else if (consecutiveErrors >= CIRCUIT_BREAKER.ERROR_THRESHOLD) {
    data.circuitState = 'open'
    data.circuitOpenedAt = new Date()
    console.log(`[CircuitBreaker] ${channelId}: → OPEN (${consecutiveErrors} consecutive errors)`)
  }
  // Half-open failed → back to OPEN
  else if (state?.circuitState === 'half_open') {
    data.circuitState = 'open'
    data.circuitOpenedAt = new Date()
    console.log(`[CircuitBreaker] ${channelId}: HALF_OPEN → OPEN (probe failed)`)
  }

  await db.channelState.update({
    where: { channelId },
    data
  })
}

/**
 * Classify error type from error message
 * @param {Error} error
 * @returns {'fatal'|'transient'}
 */
export function classifyError(error) {
  const msg = error.message?.toLowerCase() || ''

  // Fatal: credential errors, blocked account
  if (msg.includes('login failed') || msg.includes('password') ||
      msg.includes('blocked') || msg.includes('suspended') ||
      msg.includes('invalid_grant') || msg.includes('invalid credentials')) {
    return 'fatal'
  }

  // Everything else is transient
  return 'transient'
}
