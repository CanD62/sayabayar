// scripts/debug-alaflip-browser.js
// Debug minimal: buka webview URL Alaflip dan ambil screenshot untuk lihat apa yang ditampilkan
// Usage: node --env-file=.env scripts/debug-alaflip-browser.js

import { getDb } from '../../packages/shared/src/db/index.js'
import { decrypt } from '../../packages/shared/src/crypto/index.js'
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')
    const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
    return JSON.parse(Buffer.from(pad, 'base64').toString())
  } catch { return null }
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; SM-G998B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36'

const db = getDb()

try {
  const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
  const token    = decrypt(provider.token)
  const payload  = decodeJwt(token)
  const userId   = provider.userId
  const deviceId = payload?.data?.device_identifier

  console.log('userId:', userId, '| deviceId:', deviceId?.slice(0,8))

  // Ambil webview URL
  const res = await fetch(
    `https://customer.flip.id/alaflip/api/v1/users/${userId}/webview-url`,
    {
      method: 'POST',
      headers: {
        'Authorization':      `Bearer ${token}`,
        'api-key':            'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
        'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
        'content-type':       'application/json',
        'accept-language':    'en-ID',
        'User-Agent':         'okhttp/4.10.0',
      },
      body: JSON.stringify({
        redirect_url: 'flip://home', url_type: 'linkage',
        expired_token_redirect_url: 'flip://home',
        no_cam_permission_url: 'flip://open-camera-permission',
      })
    }
  )
  const body = await res.json()
  const webviewUrl = body?.data?.url
  if (!webviewUrl) { console.error('Gagal ambil URL:', body); process.exit(1) }

  console.log('Webview URL length:', webviewUrl.length)

  // Buka browser — dengan headers yang sama
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })

  const aladinHeaders = {
    'x-client-id':      'c5751804-ff4c-4d22-a30d-e5c80722758f',
    'x-channel-id':     '6018',
    'x-partner-id':     'F2210240006',
    'x-requested-with': 'id.flip',
    'Accept-Language':  'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    ...(deviceId ? { 'x-device-id': deviceId } : {}),
  }

  const context = await browser.newContext({
    userAgent: MOBILE_UA,
    extraHTTPHeaders: aladinHeaders,
  })

  // Log semua request dan response
  const page = await context.newPage()

  page.on('request', req => {
    if (req.url().includes('flamingo') || req.url().includes('aladin')) {
      console.log('→ REQ:', req.method(), req.url().slice(0, 100))
    }
  })

  page.on('response', resp => {
    if (resp.url().includes('flamingo') || resp.url().includes('aladin')) {
      console.log('← RES:', resp.status(), resp.url().slice(0, 100))
    }
  })

  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      console.log('📍 Navigated to:', frame.url().slice(0, 120))
    }
  })

  // Route intercept: log outgoing headers
  await page.route('https://flamingo.aladinbank.id/**', route => {
    const req = route.request()
    const hdrs = req.headers()
    console.log('🔑 Headers sent to flamingo:', JSON.stringify({
      'x-client-id':      hdrs['x-client-id'],
      'x-channel-id':     hdrs['x-channel-id'],
      'x-partner-id':     hdrs['x-partner-id'],
      'x-device-id':      hdrs['x-device-id'],
      'x-requested-with': hdrs['x-requested-with'],
    }, null, 2))
    route.continue({
      headers: { ...hdrs, ...aladinHeaders, 'User-Agent': MOBILE_UA }
    })
  })

  console.log('\n🌐 Membuka URL di browser...')
  await page.goto(webviewUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await new Promise(r => setTimeout(r, 5000)) // tunggu 5 detik

  const finalUrl = page.url()
  console.log('\n📍 Final URL:', finalUrl)

  // Screenshot
  const ssPath = '/tmp/alaflip-debug.png'
  await page.screenshot({ path: ssPath, fullPage: true })
  console.log('📸 Screenshot saved:', ssPath)

  // Page content truncated
  const content = await page.content()
  const snippet = content.slice(0, 500).replace(/\s+/g, ' ')
  console.log('📄 Page HTML snippet:', snippet)

  // Cek elemen di halaman
  const hasPin = await page.$('input[type="tel"], input[inputmode="numeric"], input[data-input-otp]').then(Boolean).catch(() => false)
  const hasEmail = await page.$('input[type="email"]').then(Boolean).catch(() => false)
  const hasError = await page.$('[class*="error"], [class*="404"]').then(Boolean).catch(() => false)

  console.log('\n🔍 Elemen di halaman:')
  console.log('   PIN input  :', hasPin)
  console.log('   Email input:', hasEmail)
  console.log('   Error/404  :', hasError)

  // Tunggu 30 detik agar user bisa lihat browser
  console.log('\n⏳ Browser tetap terbuka 30 detik...')
  await new Promise(r => setTimeout(r, 30_000))
  await browser.close()

} catch (err) {
  console.error('❌ Error:', err.message)
  process.exit(1)
} finally {
  await db.$disconnect()
}
