#!/usr/bin/env node
// packages/shared/seed-flip-provider.js
// Helper: insert/update data PaymentProvider Flip ke DB (encrypted)
//
// Cara jalankan dari ROOT project:
//   node --env-file=.env packages/shared/seed-flip-provider.js \
//     --email=akun@flip.id \
//     --token=BEARER_TOKEN_FLIP \
//     --pin=123456

import { encrypt } from './src/crypto/index.js'
import { getDb, disconnectDb } from './src/db/index.js'

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=')
      return [k, v.join('=')]
    })
)

const email = args.email
const token = args.token
const pin   = args.pin

if (!email || !token || !pin) {
  console.error('Usage:')
  console.error('  node --env-file=.env packages/shared/seed-flip-provider.js --email=X --token=Y --pin=Z')
  console.error('')
  console.error('  --email   Email akun Flip')
  console.error('  --token   Bearer token Flip aktif (dari sesi login)')
  console.error('  --pin     6 digit PIN Flip')
  process.exit(1)
}

if (!/^\d{6}$/.test(pin)) {
  console.error('PIN harus 6 digit angka')
  process.exit(1)
}

const db = getDb()

try {
  const encryptedToken = encrypt(token)
  const encryptedPin   = encrypt(pin)

  // tokenExpiresAt di-set 1 jam → di-refresh otomatis saat digunakan
  const tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000)

  const result = await db.paymentProvider.upsert({
    where:  { providerName: 'flip' },
    create: {
      providerName:   'flip',
      email,
      token:          encryptedToken,
      pin:            encryptedPin,
      tokenExpiresAt,
      autoProcess:    false
    },
    update: {
      email,
      token:          encryptedToken,
      pin:            encryptedPin,
      tokenExpiresAt
    }
  })

  console.log('✅ PaymentProvider "flip" berhasil disimpan:')
  console.log(`   ID:            ${result.id}`)
  console.log(`   Email:         ${result.email}`)
  console.log(`   Auto Process:  ${result.autoProcess}`)
  console.log(`   Token expires: ${result.tokenExpiresAt?.toISOString()}`)
  console.log('')
  console.log('ℹ️  Token akan di-refresh otomatis saat pertama kali digunakan.')
  console.log('   Pastikan token yang diinput masih aktif.')

} catch (err) {
  console.error('❌ Error:', err.message)
  process.exit(1)
} finally {
  await disconnectDb()
}
