// packages/shared/src/crypto/index.js
import crypto from 'crypto'

const ALGORITHM = 'aes-256-gcm'

function getEncryptionKey() {
  const key = process.env.ENCRYPTION_KEY
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required')
  }
  return Buffer.from(key, 'hex') // 32 bytes (64 hex chars)
}

/**
 * Encrypt text using AES-256-GCM
 * @param {string} text - Plain text to encrypt
 * @returns {string} Base64 encoded encrypted string (iv + tag + ciphertext)
 */
export function encrypt(text) {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(12) // 96-bit IV for GCM
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const enc = Buffer.concat([
    cipher.update(String(text), 'utf8'),
    cipher.final()
  ])
  const tag = cipher.getAuthTag() // 16 bytes
  // Format: iv(12) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

/**
 * Decrypt AES-256-GCM encrypted text
 * @param {string} encoded - Base64 encoded encrypted string
 * @returns {string} Decrypted plain text
 */
export function decrypt(encoded) {
  const key = getEncryptionKey()
  const buf = Buffer.from(encoded, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([
    decipher.update(enc),
    decipher.final()
  ]).toString('utf8')
}

/**
 * SHA-256 hash
 * @param {string} text - Text to hash
 * @returns {string} Hex encoded hash
 */
export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex')
}

/**
 * Hash API key for storage (one-way)
 * @param {string} rawKey - Raw API key
 * @returns {string} SHA-256 hash of the key
 */
export function hashApiKey(rawKey) {
  return sha256(rawKey)
}

/**
 * Generate a random API key
 * @param {string} prefix - Key prefix (e.g. 'sk_live_', 'sk_test_')
 * @returns {string} Random API key with prefix
 */
export function generateApiKey(prefix = 'sk_live_') {
  const random = crypto.randomBytes(24).toString('hex') // 48 hex chars
  return `${prefix}${random}`
}

/**
 * Generate unique hash for transaction duplicate protection
 * SHA-256(channelId + referenceNumber + amount + date)
 * @param {string} channelId
 * @param {string} referenceNumber
 * @param {number} amount
 * @param {string} date
 * @returns {string} Hex encoded hash
 */
export function generateTransactionHash(channelId, referenceNumber, amount, date) {
  return sha256(`${channelId}${referenceNumber}${amount}${date}`)
}

/**
 * Generate HMAC-SHA256 signature for webhook payload
 * @param {string} payload - JSON string of webhook body
 * @param {string} secret - Webhook secret
 * @returns {string} Hex encoded HMAC signature
 */
export function generateWebhookSignature(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex')
}

/**
 * Generate random encryption key (for initial setup)
 * @returns {string} 64-char hex string (32 bytes)
 */
export function generateEncryptionKey() {
  return crypto.randomBytes(32).toString('hex')
}
