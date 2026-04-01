// apps/scraper/src/lib/flipClient.js
// ESM adaptation dari example_scapre/flipjs/lib/flip.js
// HTTP client untuk Flip Personal API

const FLIP_HOST = 'flip.id'

// Header standar Flip Personal (dari reverse engineering mobile app)
function buildHeaders(token, contentType = 'application/x-www-form-urlencoded', host = FLIP_HOST, idempotency = null) {
  const headers = {
    'authorization':      `Bearer ${token}`,
    'api-key':            'EDdwAw954mv4VyjpXLXZ5pRehJNXNmhsqdMbPFyaDq28aAhz',
    'x-device-id':        '0e5e4950-14cf-4ad9-a5ef-5cf11fb641f4',
    'x-internal-api-key': 'VlhObGNsQnliMlpwYkdWQmJtUkJkWFJvWlc1MGFXTmhkR2x2YmxObGNuWnBZMlU2T1RBNQ==',
    'accept-language':    'id-ID',
    'content-language':   'id-ID',
    'content-type':       contentType,
    'Host':               host,
    'Connection':         'Keep-Alive',
    'User-Agent':         'okhttp/5.0.0-alpha.3'
  }
  if (idempotency !== null) {
    headers['idempotency-key'] = String(idempotency)
  }
  return headers
}

async function request(url, method = 'GET', body = null, contentType = 'application/x-www-form-urlencoded', host = FLIP_HOST, token, idempotency = null) {
  const options = {
    method,
    headers: buildHeaders(token, contentType, host, idempotency),
    timeout: 30_000
  }
  if (body) options.body = body

  const res  = await fetch(url, options)
  const text = await res.text()

  let parsed
  try { parsed = JSON.parse(text) } catch { parsed = { raw: text } }

  return parsed
}

// ── Refresh token (PUT /auth/token) ───────────────────────
export async function refreshToken(token) {
  return request(
    'https://flip.id/api/v3/auth/token',
    'PUT',
    new URLSearchParams({ version: '360' }),
    'application/x-www-form-urlencoded;charset=utf-8',
    FLIP_HOST,
    token
  )
}

// ── Info akun ─────────────────────────────────────────────
export async function infoAkun(token) {
  return request('https://flip.id/api/v1/user/info', 'GET', null, 'application/x-www-form-urlencoded', FLIP_HOST, token)
}

// ── Saldo Aladin ──────────────────────────────────────────
export async function saldoAladin(userId, token) {
  return request(
    `https://api.flip.id/alaflip/api/v1/users/${userId}/balance`,
    'GET', null, 'application/x-www-form-urlencoded', 'api.flip.id', token
  )
}

// ── Get token transfer (challenge Aladin) ─────────────────
export async function getTokenTransfer(amount, token) {
  const url = `https://api.flip.id/alaflip/api/v1/payments/charge/challenge?amount=${amount}&currency=IDR&expired_token_redirect_url=flip://home&product_name=TRANSFER`
  return request(url, 'GET', null, 'application/json', 'api.flip.id', token)
}

// ── Transfer bank via Aladin ───────────────────────────────
export async function transferBank({ accountNumber, bank, amount, beneficiaryName, pin, referenceId, deviceId }, token) {
  const idempotency = Math.floor(Date.now() / 1000)
  const body = new URLSearchParams({
    account_number:     accountNumber,
    beneficiary_bank:   bank,
    beneficiary_name:   beneficiaryName,
    amount:             String(Math.round(amount)),
    service_type:       '7',
    remark:             '',
    beneficiary_phone_number: 'undefined',
    fee:                '0',
    beneficiary_account: JSON.stringify({ avatar: null, save_beneficiary: true, id: null, nickname: '' }),
    covered_fee:        '6500',
    beneficiary_bank_type: 'bank_account',
    sender_bank_type:   'wallet_account',
    sender_bank:        'superflip',
    payment_method:     JSON.stringify([{
      sender_bank:      'superflip',
      sender_bank_type: 'wallet_account',
      pin:              pin,
      reference_id:     referenceId,
      device_id:        deviceId
    }])
  })

  return request(
    'https://flip.id/api/v2/forward-transfers',
    'POST',
    body,
    'application/x-www-form-urlencoded; charset=utf-8',
    FLIP_HOST,
    token,
    idempotency
  )
}
