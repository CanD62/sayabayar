// scripts/test-alaflip-activate.js
// CLI test untuk aktivasi Alaflip — data diambil dari DB
// Usage: node --env-file=.env scripts/test-alaflip-activate.js
// (jalankan dari root: /Users/cand62/Documents/htdocs/bayar)

import { createDecipheriv } from 'node:crypto'
import { getDb } from '../packages/shared/src/db/index.js'
import { decrypt } from '../packages/shared/src/crypto/index.js'
import { activateAlaflip } from '../apps/scraper/src/scrapers/flipBrowser.js'

// ── Decode JWT payload ──────────────────────────────────────
function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
    return JSON.parse(Buffer.from(pad, 'base64').toString())
  } catch { return null }
}

// ── Main ────────────────────────────────────────────────────
const db = getDb()

try {
  console.log('📦 Mengambil data dari DB...')
  const provider = await db.paymentProvider.findUnique({
    where: { providerName: 'flip' }
  })

  if (!provider) {
    console.error('❌ Provider "flip" tidak ditemukan di DB')
    process.exit(1)
  }

  const token = decrypt(provider.token)
  const pin = decrypt(provider.pin)
  const payload = decodeJwt(token)
  const userId = provider.userId || String(payload?.data?.id || '')
  const deviceId = payload?.data?.device_identifier

  console.log('✅ Data provider:')
  console.log('   userId   :', userId)
  console.log('   deviceId :', deviceId)
  console.log('   email    :', provider.email)
  console.log('   tokenExp :', payload?.exp ? new Date(payload.exp * 1000).toLocaleString('id-ID') : 'N/A')
  console.log('   tokenOK  :', payload?.exp ? (payload.exp > Date.now() / 1000 ? '✅ valid' : '❌ expired') : '❓')

  if (!userId) { console.error('❌ userId kosong — login Flip dulu'); process.exit(1) }
  if (!pin) { console.error('❌ PIN belum dikonfigurasi'); process.exit(1) }

  if (payload?.exp && payload.exp <= Date.now() / 1000) {
    console.warn('⚠️  Token sudah expired — seamlessSign mungkin invalid. Refresh token dulu jika 404.')
  }

  // ── Step 1: Ambil webview URL dari Flip ──────────────────
  console.log('\n🌐 Mengambil webview URL dari Flip...')
  const webviewRes = await fetch(
    `https://customer.flip.id/alaflip/api/v1/users/${userId}/webview-url`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
        'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
        'content-type': 'application/json',
        'accept-language': 'en-ID',
        'content-language': 'en-ID',
        'Host': 'customer.flip.id',
        'User-Agent': 'okhttp/4.10.0',
      },
      body: JSON.stringify({
        redirect_url: 'flip://home',
        url_type: 'linkage',
        expired_token_redirect_url: 'flip://home',
        no_cam_permission_url: 'flip://open-camera-permission',
      })
    }
  )

  const webviewBody = await webviewRes.json()
  console.log('   HTTP status :', webviewRes.status)

  if (!webviewBody?.data?.url) {
    console.error('❌ Gagal ambil webview URL:', JSON.stringify(webviewBody))
    process.exit(1)
  }

  const webviewUrl = webviewBody.data.url
  console.log('   URL preview :', webviewUrl.slice(0, 100) + '...')

  // ── Step 2: Cek status Alaflip ───────────────────────────
  console.log('\n📊 Cek status Alaflip saat ini...')
  const statusRes = await fetch(
    `https://customer.flip.id/alaflip/api/v1/users/${userId}/status`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
        'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
        'content-type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/4.10.0',
      }
    }
  )
  const statusBody = await statusRes.json()
  console.log('   status:', statusBody?.data?.status || statusBody?.error?.message || JSON.stringify(statusBody))

  // ── Step 3: Jalankan aktivasi Playwright ─────────────────
  console.log('\n🎭 Memulai Playwright activation...')
  console.log('   (Browser akan terbuka — lihat layar)')
  const start = Date.now()

  await activateAlaflip(webviewUrl, pin, deviceId)

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)
  console.log(`\n✅ Aktivasi selesai (${elapsed}s)`)

  // ── Step 4: Verifikasi status setelah aktivasi ────────────
  console.log('\n📊 Verifikasi status Alaflip setelah aktivasi...')
  const afterRes = await fetch(
    `https://customer.flip.id/alaflip/api/v1/users/${userId}/status`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
        'api-key': 'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
        'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
        'content-type': 'application/x-www-form-urlencoded',
        'User-Agent': 'okhttp/4.10.0',
      }
    }
  )
  const afterBody = await afterRes.json()
  const finalStatus = afterBody?.data?.status
  console.log('   status akhir:', finalStatus || JSON.stringify(afterBody))

  if (finalStatus === 'SUCCESS_REGISTER') {
    console.log('\n🎉 Alaflip AKTIF — siap digunakan untuk transfer!')
  } else {
    console.warn('\n⚠️  Status belum SUCCESS_REGISTER. Mungkin perlu cek manual.')
  }

} catch (err) {
  console.error('\n❌ Error:', err.message)
  if (err.stack) console.error(err.stack)
  process.exit(1)
} finally {
  await db.$disconnect()
}
