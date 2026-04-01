// apps/frontend/src/lib/qris.js
// Client-side QRIS utilities: QR code decode + TLV parse

import jsQR from 'jsqr'

/**
 * Decode a QR code from an image file
 * @param {File} file - image file (PNG, JPG, etc.)
 * @returns {Promise<string>} decoded QR string
 */
export async function decodeQrFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const code = jsQR(imageData.data, imageData.width, imageData.height)
        if (code) {
          resolve(code.data)
        } else {
          reject(new Error('QR code tidak terdeteksi. Pastikan gambar jelas dan tidak terpotong.'))
        }
      }
      img.onerror = () => reject(new Error('Gagal membaca file gambar'))
      img.src = reader.result
    }
    reader.onerror = () => reject(new Error('Gagal membaca file'))
    reader.readAsDataURL(file)
  })
}

/**
 * Parse TLV (Tag-Length-Value) encoded string
 * @param {string} data
 * @returns {Map<string, string>}
 */
function parseTlv(data) {
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
 * Extract merchant info from QRIS string
 * @param {string} qrisString
 * @returns {{ merchantName: string, merchantId: string, merchantCity: string, valid: boolean }}
 */
export function parseQrisString(qrisString) {
  try {
    if (!qrisString || !qrisString.startsWith('000201')) {
      return { merchantName: '', merchantId: '', merchantCity: '', valid: false }
    }

    const tags = parseTlv(qrisString)
    const merchantName = tags.get('59') || ''
    const merchantCity = tags.get('60') || ''

    let merchantId = ''
    const tag51 = tags.get('51')
    if (tag51) {
      const sub = parseTlv(tag51)
      merchantId = sub.get('02') || ''
    }
    if (!merchantId) {
      for (let t = 26; t <= 45; t++) {
        const v = tags.get(t.toString().padStart(2, '0'))
        if (v) {
          const sub = parseTlv(v)
          const id = sub.get('02')
          if (id && id.length > 10) { merchantId = id; break }
        }
      }
    }

    return {
      merchantName,
      merchantId,
      merchantCity,
      valid: !!merchantName
    }
  } catch {
    return { merchantName: '', merchantId: '', merchantCity: '', valid: false }
  }
}
