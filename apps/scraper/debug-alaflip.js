// apps/scraper/debug-alaflip.js
// Usage:
//   node --env-file=../../.env debug-alaflip.js           <- manual: buka browser, input PIN sendiri
//   node --env-file=../../.env debug-alaflip.js 123456    <- otomatis input PIN 123456
// (jalankan dari: apps/scraper/)

import { getDb } from '@payment-gateway/shared/db'
import { decrypt } from '@payment-gateway/shared/crypto'
import { chromium } from 'playwright'

function decodeJwt(token) {
  try {
    const b64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
    return JSON.parse(Buffer.from(pad, 'base64').toString())
  } catch { return null }
}

// UA persis seperti di HAR (Android 13 WebView)
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 13; sdk_gphone64_arm64 Build/TE1A.240213.009; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36'

// PIN dari argumen CLI — jika tidak ada, mode manual (user input sendiri di browser)
const CLI_PIN = process.argv[2] || null
console.log(CLI_PIN ? `🤖 Mode otomatis — PIN dari arg: ${CLI_PIN[0]}${'*'.repeat(CLI_PIN.length - 1)}` : '👆 Mode manual — PIN harus diinput sendiri di browser')

const db = getDb()

try {
  const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
  const token    = decrypt(provider.token)
  const payload  = decodeJwt(token)
  const userId   = provider.userId
  const deviceId = payload?.data?.device_identifier

  console.log('userId  :', userId)
  console.log('deviceId:', deviceId)
  console.log('tokenExp:', payload?.exp ? new Date(payload.exp * 1000).toLocaleString('id-ID') : 'N/A')

  // ── Step 1: Ambil webview URL dari Flip ───────────────────
  // Response sudah include X-AUTHORIZATION dan semua headers yang dibutuhkan WebView!
  console.log('\n🌐 [1] Ambil webview URL dari Flip...')
  const wvRes = await fetch(
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
  const wvBody = await wvRes.json()
  const webviewUrl  = wvBody?.data?.url
  const wvHeaders   = wvBody?.data?.headers || {}
  const aladInToken = wvHeaders['X-AUTHORIZATION'] || null

  if (!webviewUrl) { console.error('❌ Gagal ambil webview URL:', JSON.stringify(wvBody)); process.exit(1) }
  console.log('   URL:', webviewUrl.slice(0, 100) + '...')
  console.log('   X-AUTHORIZATION:', aladInToken ? '✅ ada' : '❌ tidak ada')
  console.log('   Headers dari webview-url:', JSON.stringify(Object.keys(wvHeaders)))

  // ── Step 2: Buka browser ──────────────────────────────────
  console.log('\n🎭 [2] Membuka Chromium...')
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })

  // Gunakan headers dari webview-url response (persis yang Flip app pakai)
  const aladinHeaders = {
    'Accept':                 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language':        'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control':          'no-cache',
    'Pragma':                 'no-cache',
    'sec-ch-ua':              '"Android WebView";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile':       '?1',
    'sec-ch-ua-platform':     '"Android"',
    'sec-fetch-dest':         'document',
    'sec-fetch-mode':         'navigate',
    'sec-fetch-site':         'none',
    'sec-fetch-user':         '?1',
    'upgrade-insecure-requests': '1',
    'x-requested-with':       'id.flip',
    // Header dari webview-url response (lowercase untuk HTTP)
    'x-authorization': wvHeaders['X-AUTHORIZATION'] || undefined,
    'x-device-id':     wvHeaders['X-DEVICE-ID']     || deviceId  || undefined,
    'x-client-id':     wvHeaders['X-CLIENT-ID']      || undefined,
    'x-channel-id':    wvHeaders['X-CHANNEL-ID']     || undefined,
    'x-partner-id':    wvHeaders['X-PARTNER-ID']     || undefined,
  }
  // Hapus key undefined
  Object.keys(aladinHeaders).forEach(k => aladinHeaders[k] === undefined && delete aladinHeaders[k])
  console.log('   x-authorization set:', aladInToken ? '✅ YA' : '❌ TIDAK')

  const context = await browser.newContext({ userAgent: MOBILE_UA, extraHTTPHeaders: aladinHeaders })
  const page    = await context.newPage()

  // Log request/response penting
  page.on('request', req => {
    const u = req.url()
    if (u.includes('flamingo') || u.includes('aladin.id')) {
      if (!u.includes('_next/static') && !u.includes('woff') && !u.includes('image?url'))
        console.log('→', req.method(), u.slice(0, 100))
    }
  })
  page.on('response', async resp => {
    const u = resp.url()
    if (u.includes('flamingo') || u.includes('aladin.id')) {
      if (!u.includes('_next/static') && !u.includes('woff') && !u.includes('image?url')) {
        let body = ''
        try {
          const ct = resp.headers()['content-type'] || ''
          if (ct.includes('json')) body = '| ' + (await resp.text().catch(() => '')).slice(0, 150)
        } catch {}
        console.log('←', resp.status(), u.slice(0, 100), body)
      }
    }
  })
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) console.log('📍 Nav:', frame.url().slice(0, 120))
  })
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[JS error]', msg.text().slice(0, 150))
  })

  // Route intercept: inject x-authorization ke semua document request ke flamingo
  await page.route('https://flamingo.aladinbank.id/**', route => {
    const req = route.request()
    const hdrs = { ...req.headers(), 'User-Agent': MOBILE_UA }
    if (aladInToken && req.resourceType() === 'document') {
      hdrs['x-authorization'] = aladInToken
    }
    route.continue({ headers: hdrs })
  })

  // ── Buka webview URL ──────────────────────────────────────
  console.log('\n🚀 [4] Membuka get-auth-code URL...')
  await page.goto(webviewUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })

  // Cek cookies yang di-set server — kalau berhasil akan ada 'authorization'
  const cookies = await context.cookies('https://flamingo.aladinbank.id')
  const authCookie = cookies.find(c => c.name === 'authorization')
  console.log('\n🍪 Cookies dari flamingo:')
  cookies.forEach(c => console.log(`   ${c.name} = ${c.value.slice(0,40)}...`))
  console.log('   authorization cookie:', authCookie ? '✅ SET — /api/shield harusnya 200!' : '❌ TIDAK ADA')

  if (!authCookie) {
    console.error('❌ Cookie authorization tidak ada — aktivasi tidak bisa dilanjutkan')
    await page.screenshot({ path: '/tmp/alaflip-debug.png', fullPage: true })
    await browser.close()
    process.exit(1)
  }

  // ── Step 5: Tunggu navigasi ke /authentication/login ──────
  console.log('\n⏳ [5] Menunggu halaman login Aladin...')
  try {
    await page.waitForURL(url => url.includes('/authentication/login'), { timeout: 20_000 })
    console.log('✅ Di halaman login!')
  } catch {
    console.log('⚠️  Belum di /authentication/login — cek final URL')
  }

  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
  console.log('📍 URL saat ini:', page.url().slice(0, 100))

  // Screenshot sebelum input PIN
  await page.screenshot({ path: '/tmp/alaflip-before-pin.png', fullPage: true })
  console.log('📸 Screenshot: /tmp/alaflip-before-pin.png')

  // ── Step 6: Tunggu form PIN muncul ───────────────────────
  console.log('\n🔑 [6] Menunggu form PIN...')
  const PIN = decrypt(provider.pin)

  let pinInput = null
  try {
    // Coba selector OTP dulu (paling spesifik), lalu fallback
    pinInput = await page.waitForSelector(
      'input[data-input-otp="true"], input[inputmode="numeric"][maxlength="1"], input[type="tel"]',
      { timeout: 15_000 }
    )
    console.log('✅ Form PIN ditemukan!')
  } catch {
    console.error('❌ Form PIN tidak muncul dalam 15 detik')
    await page.screenshot({ path: '/tmp/alaflip-debug.png', fullPage: true })
    const inputs = await page.$$eval('input', els => els.map(e => ({
      type: e.type, inputmode: e.inputMode, maxlength: e.maxLength,
      name: e.name, id: e.id, dataOtp: e.dataset.inputOtp
    })))
    console.log('   Inputs di halaman:', JSON.stringify(inputs))
    console.log('\n⏳ Browser terbuka 120 detik untuk inspeksi manual...')
    await new Promise(r => setTimeout(r, 120_000))
    await browser.close()
    process.exit(1)
  }

  // ── Step 7: Route intercept storage.googleapis.com ─────────────
  // Setelah PIN benar, JS Aladin akan navigate ke:
  // https://storage.googleapis.com/...?code=xxx  
  // Kita intercept & ABORT navigasi agar native Flip app tidak consume code duluan
  // Code kita ambil dari request URL sebelum browser navigate
  console.log('\n🛡️  [7] Setup route intercept storage.googleapis.com...')
  let oauthCode = null
  const codeCapture = new Promise((resolve) => {
    page.route('https://storage.googleapis.com/**', async (route) => {
      const url = route.request().url()
      console.log('   🎯 Intercepted:', url.slice(0, 120))
      const codeMatch = url.match(/[?&]code=([^&]+)/)
      if (codeMatch) {
        oauthCode = decodeURIComponent(codeMatch[1])
        console.log('   ✅ Code captured! length:', oauthCode.length)
        console.log('   Code preview:', oauthCode.slice(0, 50) + '...')
      }
      await route.abort()  // jangan navigate — native app tidak intercept
      resolve()
    })
  })

  // ── Step 8: Input PIN ─────────────────────────────────────
  if (CLI_PIN) {
    const PIN = CLI_PIN
    console.log(`\n🔢 [8] Auto-type PIN (${PIN.length} digit)...`)
    await pinInput.focus()
    await page.waitForTimeout(500)
    for (const digit of PIN) {
      await page.keyboard.type(digit, { delay: 150 })
    }
    console.log('   PIN terketik — menunggu intercept storage.googleapis.com...')
  } else {
    console.log('\n👆 [8] Mode manual — silakan input PIN di browser sekarang...')
    console.log('   (menunggu intercept storage.googleapis.com, max 120 detik)')
  }

  // ── Step 9: Tunggu code tercapture ─────────────────────────
  console.log('\n⏳ [9] Menunggu code dari storage.googleapis.com...')
  try {
    await Promise.race([
      codeCapture,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 120s')), 120_000))
    ])
    if (!oauthCode) {
      console.error('   ❌ Code tidak ada di URL — cek request URL di atas')
      console.log('\n⏳ Browser terbuka 60 detik untuk inspeksi manual...')
      await new Promise(r => setTimeout(r, 60_000))
    }
  } catch (e) {
    console.error('   ❌ Timeout/error:', e.message)
    await page.screenshot({ path: '/tmp/alaflip-debug.png', fullPage: true })
    console.log('\n⏳ Browser terbuka 60 detik untuk inspeksi manual...')
    await new Promise(r => setTimeout(r, 60_000))
  }

  await browser.close()
  console.log('🔒 Browser ditutup')

  // ── Step 10: Kirim auth-code ke Flip API ─────────────────
  console.log('\n📡 [10] POST auth-code ke Flip...')
  const authCodeRes = await fetch(
    `https://customer.flip.id/alaflip/api/v1/users/${userId}/auth-code`,
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
      body: JSON.stringify({ auth_code: oauthCode })
    }
  )
  const authCodeBody = await authCodeRes.json()
  console.log('   status HTTP:', authCodeRes.status)
  console.log('   response:', JSON.stringify(authCodeBody))

  // ── Step 11: Verifikasi status Alaflip ────────────────────
  console.log('\n📊 [11] Verifikasi status Alaflip...')
  await new Promise(r => setTimeout(r, 2000)) // tunggu 2s propagasi
  const finalStatusRes = await fetch(
    `https://customer.flip.id/alaflip/api/v1/users/${userId}/status`,
    {
      headers: {
        'Authorization':      `Bearer ${token}`,
        'api-key':            'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
        'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
        'content-type':       'application/x-www-form-urlencoded',
        'User-Agent':         'okhttp/4.10.0',
      }
    }
  )
  const finalStatusBody = await finalStatusRes.json()
  const finalStatus = finalStatusBody?.data?.status
  console.log('   Status:', finalStatus)

  if (finalStatus === 'SUCCESS_REGISTER' || finalStatus === 'SUCCESS') {
    console.log('\n🎉 AKTIVASI ALAFLIP BERHASIL! Status:', finalStatus)
  } else {
    console.log('\n⚠️  Status masih:', finalStatus, '— mungkin perlu waktu propagasi')
  }

} catch (err) {
  console.error('❌', err.message)
  if (err.stack) console.error(err.stack.split('\n').slice(0,3).join('\n'))
  process.exit(1)
} finally {
  await db.$disconnect()
}
