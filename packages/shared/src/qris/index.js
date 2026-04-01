// packages/shared/src/qris/index.js
// QRIS EMVCo TLV parser — parse raw QRIS strings

/**
 * Parse a TLV (Tag-Length-Value) encoded string
 * EMVCo format: [Tag 2 chars][Length 2 chars][Value N chars]
 * @param {string} data - TLV encoded string
 * @returns {Map<string, string>} parsed tags
 */
export function parseTlv(data) {
  const tags = new Map()
  let i = 0
  while (i + 4 <= data.length) {
    const tag = data.substring(i, i + 2)
    const len = parseInt(data.substring(i + 2, i + 4), 10)
    if (isNaN(len) || i + 4 + len > data.length) break
    const value = data.substring(i + 4, i + 4 + len)
    tags.set(tag, value)
    i += 4 + len
  }
  return tags
}

/**
 * Extract useful info from a QRIS string
 * @param {string} qrisString - raw QRIS TLV string
 * @returns {{ merchantName: string, merchantId: string, merchantCity: string, categoryCode: string, rawData: string }}
 */
export function extractQrisInfo(qrisString) {
  if (!qrisString || typeof qrisString !== 'string') {
    throw new Error('QRIS data tidak valid')
  }

  const tags = parseTlv(qrisString)

  // Tag 59 = Merchant Name
  const merchantName = tags.get('59') || ''

  // Tag 60 = Merchant City
  const merchantCity = tags.get('60') || ''

  // Tag 52 = Merchant Category Code
  const categoryCode = tags.get('52') || ''

  // Extract NMID from tag 51 (QRIS domain) or tag 26-50 (merchant account info)
  let merchantId = ''

  // Try tag 51 first (ID.CO.QRIS.WWW domain — standard QRIS)
  const tag51 = tags.get('51')
  if (tag51) {
    const subTags = parseTlv(tag51)
    // Sub-tag 02 = Merchant PAN / NMID
    merchantId = subTags.get('02') || ''
  }

  // Fallback: try tags 26-45 for merchant account info
  if (!merchantId) {
    for (let t = 26; t <= 45; t++) {
      const tagStr = t.toString().padStart(2, '0')
      const tagVal = tags.get(tagStr)
      if (tagVal) {
        const subTags = parseTlv(tagVal)
        const nmid = subTags.get('02')
        if (nmid && nmid.length > 10) {
          merchantId = nmid
          break
        }
      }
    }
  }

  if (!merchantName) {
    throw new Error('Tidak dapat membaca nama merchant dari QRIS')
  }

  return {
    merchantName,
    merchantId,
    merchantCity,
    categoryCode,
    rawData: qrisString
  }
}

/**
 * Validate that a string looks like a valid QRIS payload
 * @param {string} data
 * @returns {boolean}
 */
export function isValidQris(data) {
  if (!data || typeof data !== 'string' || data.length < 50) return false
  // Must start with tag 00 (Payload Format Indicator)
  if (!data.startsWith('000201')) return false
  // Must contain tag 59 (Merchant Name)
  const tags = parseTlv(data)
  return tags.has('59')
}
