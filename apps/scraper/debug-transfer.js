#!/usr/bin/env node
// apps/scraper/debug-transfer.js
// Debug script — test alur PIN transfer Alaflip + eksekusi transfer sungguhan via Playwright
//
// Jalankan dari ROOT workspace (bayar/):
//   node --env-file=.env apps/scraper/debug-transfer.js              ← manual PIN, DRY RUN
//   node --env-file=.env apps/scraper/debug-transfer.js <PIN>        ← auto PIN, DRY RUN
//   node --env-file=.env apps/scraper/debug-transfer.js <PIN> <NOREK> <BANK> <NAMA> <AMOUNT>  ← TRANSFER SUNGGUHAN
//
// Contoh:
//   node --env-file=.env apps/scraper/debug-transfer.js 123456
//   node --env-file=.env apps/scraper/debug-transfer.js 123456 0806174097 bca "Puput Candra" 10000

import { chromium } from 'playwright'
import { getDb } from '@payment-gateway/shared/db'
import { decrypt } from '@payment-gateway/shared/crypto'

const FLIP_HOST    = 'flip.id'
const CUSTOMER_API = 'https://customer.flip.id'
const MOBILE_UA    = 'Mozilla/5.0 (Linux; Android 13; SM-G998B Build/TE1A.240213.009; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.123 Mobile Safari/537.36'

const [,, pinArg, norekArg, bankArg, namaArg, amountArg] = process.argv
const autoMode   = !!pinArg
const dryRun     = !norekArg   // kalau tidak ada norek = dry run (hanya test PIN)
const amount     = parseInt(amountArg || '10000')

console.log(`\n🔄 Debug Transfer Alaflip`)
console.log(`Mode PIN  : ${autoMode ? `🤖 AUTO (PIN=${pinArg})` : '🖱️  MANUAL (masukan PIN di browser)'}`)
console.log(`Mode Exec : ${dryRun ? '🧪 DRY RUN (hanya ambil nonce, tidak transfer)' : `💸 TRANSFER SUNGGUHAN → ${norekArg} (${bankArg}) Rp ${amount.toLocaleString('id-ID')}`}`)
console.log('─'.repeat(60))

// ── Step 0: Ambil provider dari DB ─────────────────────────
const db = getDb()
const provider = await db.paymentProvider.findUnique({ where: { providerName: 'flip' } })
if (!provider) { console.error('❌ Provider flip tidak ditemukan'); process.exit(1) }

const flipToken = decrypt(provider.token)
const aladinPin = autoMode ? pinArg : decrypt(provider.pin)
const userId    = provider.userId

function decodeJwt(t) {
  try {
    const b64 = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=')
    return JSON.parse(Buffer.from(pad, 'base64').toString())
  } catch { return null }
}
const payload  = decodeJwt(flipToken)
const deviceId = payload?.data?.device_identifier

console.log(`👤 userId: ${userId}`)
console.log(`📱 deviceId: ${deviceId?.slice(0, 12)}...`)

// ── Step 1: GET charge/challenge dari Flip ──────────────────
console.log(`\n⏳ [1] Ambil charge/challenge (amount=${amount})...`)
const challengeRes = await fetch(
  `${CUSTOMER_API}/alaflip/api/v1/payments/charge/challenge?amount=${amount}&currency=IDR&expired_token_redirect_url=flip%3A%2F%2Fhome&product_name=TRANSFER`,
  {
    method: 'GET',
    headers: {
      'Authorization':      `Bearer ${flipToken}`,
      'api-key':            'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
      'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
      ...(deviceId ? { 'x-device-id': deviceId } : {}),
      'content-type':       'application/json',
      'accept-language':    'en-ID',
      'content-language':   'en-ID',
      'User-Agent':         'okhttp/4.10.0',
    }
  }
)
const challengeBody = await challengeRes.json().catch(() => ({}))
if (!challengeBody?.data?.challenge_url) {
  console.error('❌ charge/challenge gagal:', JSON.stringify(challengeBody))
  process.exit(1)
}

const challengeUrl = challengeBody.data.challenge_url
const partnerRefId = challengeBody.data.partner_reference_id
const wvHeaders    = challengeBody.data.headers || {}

console.log(`✅ challenge_url: ${challengeUrl.slice(0, 80)}...`)
console.log(`   partner_reference_id: ${partnerRefId}`)
console.log(`   headers: ${Object.keys(wvHeaders).join(', ')}`)

const authorization         = wvHeaders['X-AUTHORIZATION'] || ''
const authorizationCustomer = wvHeaders['X-AUTHORIZATION-CUSTOMER'] || ''
const wvDeviceId            = wvHeaders['X-DEVICE-ID'] || deviceId || ''
const authorizeReqId        = new URL(challengeUrl).searchParams.get('authorize_request_id') || ''

console.log(`   x-authorization: ${authorization ? '✅' : '❌'}`)
console.log(`   authorize_request_id: ${authorizeReqId.slice(0, 20)}...`)

// ── Step 2: Buka browser ────────────────────────────────────
console.log('\n⏳ [2] Membuka browser Playwright...')
const browser = await chromium.launch({ headless: false, args: ['--no-sandbox'] })
const context  = await browser.newContext({
  userAgent: MOBILE_UA,
  extraHTTPHeaders: {
    'Accept-Language':    'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    'x-requested-with':   'id.flip',
    'sec-ch-ua':          '"Android WebView";v="109", "Chromium";v="109", "Not?A_Brand";v="24"',
    'sec-ch-ua-mobile':   '?1',
    'sec-ch-ua-platform': '"Android"',
  }
})

// Set cookies flamingo
await context.addCookies(
  [
    { name: 'authorization',          value: authorization },
    { name: 'authorization-customer', value: authorizationCustomer },
    { name: 'deviceId',               value: wvDeviceId },
    { name: 'authorizeRequestId',     value: encodeURIComponent(authorizeReqId) },
  ]
  .filter(c => c.value)
  .map(c => ({ ...c, domain: 'flamingo.aladinbank.id', path: '/', secure: true, httpOnly: false, sameSite: 'Lax' }))
)
console.log(`   cookies set: authorization, authorization-customer, deviceId, authorizeRequestId`)

const page = await context.newPage()

// Monitor non-static requests
page.on('request',  req => {
  const url = req.url()
  if ((url.includes('flamingo') || url.includes('aladinbank')) && !url.includes('_next') && !url.includes('.woff') && !url.includes('/image?')) {
    console.log(`   → ${req.method()} ${url.slice(0, 100)}`)
  }
})
page.on('response', async res => {
  const url = res.url()
  if ((url.includes('flamingo') || url.includes('aladinbank')) && !url.includes('_next') && !url.includes('.woff') && !url.includes('/image?')) {
    const status = res.status()
    let extra = ''
    if (status !== 200) {
      extra = ` | ${(await res.text().catch(() => '')).slice(0, 120)}`
    }
    console.log(`   ← ${status} ${url.slice(0, 100)}${extra}`)
  }
})

// ── Step 3: Intercept PIN response ─────────────────────────
let pinResult = null
const pinResponseCapture = new Promise((resolve, reject) => {
  page.route('**/api/whitelabel/v1/transaction/auth/pin', async (route) => {
    console.log('\n📍 PIN auth request dicegat!')
    try {
      const response = await route.fetch()
      const body = await response.json().catch(() => ({}))
      console.log(`   Response: ${JSON.stringify(body).slice(0, 200)}`)
      pinResult = body?.data
      await route.fulfill({ response })
      resolve()
    } catch (e) {
      await route.continue()
      reject(e)
    }
  })
  // Timeout 120s untuk manual mode
  setTimeout(() => reject(new Error('Timeout 120s menunggu PIN response')), 120_000)
})

// ── Step 4: Buka challenge URL ──────────────────────────────
console.log('\n⏳ [3] Membuka challenge URL (PIN form)...')
await page.goto(challengeUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})
console.log(`   URL: ${page.url().slice(0, 100)}`)

// ── Step 5: Tunggu PIN form ─────────────────────────────────
const pinInput = await page.waitForSelector(
  'input[data-input-otp="true"], input[inputmode="numeric"][maxlength="1"], input[type="tel"]',
  { timeout: 15_000 }
).catch(() => null)

if (!pinInput) {
  console.warn('⚠️  Form PIN tidak ditemukan!')
  await page.screenshot({ path: '/tmp/debug-transfer-noinput.png' })
  console.log('   Screenshot: /tmp/debug-transfer-noinput.png')
  await browser.close()
  await db.$disconnect()
  process.exit(1)
}
console.log('✅ Form PIN ditemukan!')

// ── Step 6: Ketik atau tunggu PIN ──────────────────────────
if (autoMode) {
  await pinInput.focus()
  await new Promise(r => setTimeout(r, 500))
  for (const digit of aladinPin) {
    await page.keyboard.type(digit, { delay: 150 })
  }
  console.log('✅ PIN diketik — menunggu response...')
} else {
  console.log('\n🖱️  MODE MANUAL — silakan ketik PIN di browser (120 detik)...')
}

// ── Step 7: Tunggu nonce ────────────────────────────────────
try {
  await pinResponseCapture
} catch (e) {
  console.error(`\n❌ ${e.message}`)
  await browser.close()
  await db.$disconnect()
  process.exit(1)
}

await browser.close()

if (!pinResult?.nonce) {
  console.error('\n❌ Nonce tidak ada di response:', JSON.stringify(pinResult))
  await db.$disconnect()
  process.exit(1)
}

const nonce       = pinResult.nonce
const referenceId = pinResult.partner_reference_no

console.log(`\n✅ PIN sukses!`)
console.log(`   nonce            : ${nonce.slice(0, 30)}...`)
console.log(`   partner_reference: ${referenceId}`)

// ── Step 8: Eksekusi transfer (jika bukan dry run) ─────────
if (dryRun) {
  console.log('\n─'.repeat(60))
  console.log('🧪 DRY RUN selesai — tidak ada transfer yang dieksekusi')
  console.log('\nUntuk transfer sungguhan, jalankan dengan argumen lengkap:')
  console.log(`  node --env-file=.env apps/scraper/debug-transfer.js <PIN> <NOREK> <BANK> <NAMA> <AMOUNT>`)
  console.log(`\nContoh:`)
  console.log(`  node --env-file=.env apps/scraper/debug-transfer.js 123456 0806174097 bca "Puput Candra" 10000`)
} else {
  console.log(`\n⏳ [4] Eksekusi transfer → ${norekArg} (${bankArg}) Rp ${amount.toLocaleString('id-ID')}...`)

  const idempotencyKey = `${userId}_${Math.floor(Date.now() / 1000)}`
  const body = new URLSearchParams({
    account_number:           norekArg,
    beneficiary_bank:         bankArg,
    beneficiary_name:         namaArg,
    amount:                   String(amount),
    service_type:             '7',
    remark:                   '',
    beneficiary_phone_number: 'undefined',
    fee:                      '0',
    beneficiary_account:      JSON.stringify({ save_beneficiary: true, id: null, nickname: '' }),
    covered_fee:              '6500',
    beneficiary_bank_type:    'bank_account',
    sender_bank_type:         'wallet_account',
    sender_bank:              'superflip',
    payment_method:           JSON.stringify([{
      sender_bank:      'superflip',
      sender_bank_type: 'wallet_account',
      pin:              nonce,
      reference_id:     referenceId,
      device_id:        wvDeviceId,
    }])
  })

  const transferRes = await fetch('https://flip.id/api/v2/forward-transfers', {
    method: 'POST',
    headers: {
      'Authorization':   `Bearer ${flipToken}`,
      'api-key':         'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
      'idempotency-key': idempotencyKey,
      'content-type':    'application/x-www-form-urlencoded',
      'accept-language': 'en-ID',
      'content-language':'en-ID',
      'User-Agent':      'okhttp/4.10.0',
    },
    body
  })

  const transferBody = await transferRes.json().catch(() => ({}))

  console.log(`\n─`.repeat(60))
  if (transferRes.ok && (transferBody.status === 'PROCESSED' || transferBody.status === 'DONE' || transferBody.id)) {
    console.log(`🎉 TRANSFER BERHASIL!`)
    console.log(`   ID          : ${transferBody.id}`)
    console.log(`   Status      : ${transferBody.status}`)
    console.log(`   Amount      : Rp ${Number(transferBody.amount || amount).toLocaleString('id-ID')}`)
    console.log(`   Penerima    : ${transferBody.beneficiary_name} (${transferBody.beneficiary_bank?.toUpperCase()})`)
    console.log(`   Nomor       : ${transferBody.account_number}`)
  } else {
    console.log(`❌ TRANSFER GAGAL (HTTP ${transferRes.status})`)
    console.log(`   Response: ${JSON.stringify(transferBody).slice(0, 400)}`)
  }
}

await db.$disconnect()
