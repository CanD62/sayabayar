'use client'
import { useState, useEffect } from 'react'
import { Plus, KeyRound, Trash2, BookOpen, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '@/lib/api'
import { fmt } from '@/lib/format'
import { CopyButton, StepHeading, SecretReveal, Modal } from '@/components/ui'
import { useToast } from '@/components/Toast'
import ConfirmModal from '@/components/ConfirmModal'
import { SkeletonTable } from '@/components/Skeleton'

// ── Code Snippets ──────────────────────────────────────────────────────────────
const SNIPPETS = {
  'Node.js': {
    lang: 'javascript',
    code: `const API_KEY = 'sk_live_xxxx...' // API key dari dashboard
const BASE    = 'https://api.sayabayar.com/v1'
const headers = { 'Content-Type': 'application/json', 'X-API-Key': API_KEY }

// ── Buat invoice baru
// channel_preference: 'platform' (default) | 'client' (plan berbayar + channel aktif)
// expired_minutes: 60–10080 (default 1440 = 24 jam)
const res = await fetch(\`\${BASE}/invoices\`, {
  method: 'POST', headers,
  body: JSON.stringify({
    customer_name:      'Budi Santoso',
    customer_email:     'budi@example.com',
    amount:             150000,
    description:        'Pembelian produk X',
    channel_preference: 'platform', // 'client' = dana langsung ke rekening Anda
  })
})
const invoice = await res.json()
console.log('Payment URL:', invoice.data.payment_url)

// ── List invoice (filter status, halaman)
const list = await fetch(\`\${BASE}/invoices?status=pending&page=1\`, { headers })
const { data } = await list.json()

// ── Detail & status invoice (bisa pakai id atau invoice_number)
const detail = await fetch(\`\${BASE}/invoices/\${invoice.data.id}\`, { headers })
const inv = await detail.json()
console.log('Status:', inv.data.status) // pending | paid | expired

// ── List webhook
const wh = await fetch(\`\${BASE}/webhooks\`, { headers })
console.log(await wh.json())

// ── Cek saldo
const bal = await fetch(\`\${BASE}/balance\`, { headers })
const { data: balance } = await bal.json()
console.log('Saldo tersedia:', balance.balance_available)`
  },
  'PHP': {
    lang: 'php',
    code: `<?php
$api_key = 'sk_live_xxxx...';
$base    = 'https://api.sayabayar.com/v1';

function apiFetch(string $url, string $api_key, array $opts = []): array {
    $ch = curl_init($url);
    $headers = ["Content-Type: application/json", "X-API-Key: $api_key"];
    curl_setopt_array($ch, $opts + [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_TIMEOUT        => 15,
    ]);
    $raw = curl_exec($ch);
    if ($raw === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new \\RuntimeException("cURL error: $err");
    }
    curl_close($ch);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

// ── Buat invoice baru
// channel_preference: 'platform' (default) | 'client' (plan berbayar + channel aktif)
// expired_minutes  : 60–10080, default 1440 (24 jam)
$invoice = apiFetch("$base/invoices", $api_key, [
    CURLOPT_POST       => true,
    CURLOPT_POSTFIELDS => json_encode([
        'customer_name'      => 'Budi Santoso',
        'customer_email'     => 'budi@example.com',
        'amount'             => 150000,
        'description'        => 'Pembelian produk X',
        'channel_preference' => 'platform', // 'client' = dana langsung ke rekening Anda
    ])
]);
echo "URL: " . $invoice['data']['payment_url'] . "\\n";

// ── List invoice
$list = apiFetch("$base/invoices?status=pending&page=1", $api_key);

// ── Detail invoice (bisa pakai id atau invoice_number)
$id     = $invoice['data']['id']; // atau 'INV-YYYYMMDD-XXXX'
$detail = apiFetch("$base/invoices/$id", $api_key);
echo "Status: " . $detail['data']['status'] . "\\n";

// ── Cek saldo
$bal = apiFetch("$base/balance", $api_key);
echo "Saldo: " . $bal['data']['balance_available'];`
  },
  'Python': {
    lang: 'python',
    code: `import requests

API_KEY = 'sk_live_xxxx...'
BASE    = 'https://api.sayabayar.com/v1'
AUTH    = {'X-API-Key': API_KEY, 'Content-Type': 'application/json'}

# ── Buat invoice baru
# channel_preference: 'platform' (default) | 'client' (plan berbayar + channel aktif)
invoice = requests.post(f'{BASE}/invoices', headers=AUTH, json={
    'customer_name':      'Budi Santoso',
    'customer_email':     'budi@example.com',
    'amount':             150000,
    'description':        'Pembelian produk X',
    'channel_preference': 'platform',  # 'client' = dana langsung ke rekening Anda
}).json()
print('URL:', invoice['data']['payment_url'])

# ── List invoice (filter & pagination)
items = requests.get(f'{BASE}/invoices', headers=AUTH,
    params={'status': 'pending', 'page': 1}).json()

# ── Detail & status invoice (bisa pakai id atau invoice_number)
inv_id = invoice['data']['id']  # atau 'INV-YYYYMMDD-XXXX'
detail = requests.get(f'{BASE}/invoices/{inv_id}', headers=AUTH).json()
print('Status:', detail['data']['status'])  # pending | paid | expired

# ── List webhook
webhooks = requests.get(f'{BASE}/webhooks', headers=AUTH).json()

# ── Cek saldo
balance = requests.get(f'{BASE}/balance', headers=AUTH).json()
print('Saldo:', balance['data']['balance_available'])`
  },
  'cURL': {
    lang: 'bash',
    code: `API_KEY="sk_live_xxxx..."
BASE="https://api.sayabayar.com/v1"

# ── Buat invoice baru
# channel_preference: 'platform' (default) | 'client' (plan berbayar + channel aktif)
curl -X POST "$BASE/invoices" \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: $API_KEY" \\
  -d '{
    "customer_name":      "Budi Santoso",
    "customer_email":     "budi@example.com",
    "amount":             150000,
    "description":        "Pembelian produk X",
    "channel_preference": "platform"
  }'

# ── List invoice (filter status + halaman)
curl "$BASE/invoices?status=pending&page=1" \\
  -H "X-API-Key: $API_KEY"

# ── Detail & status invoice (bisa pakai id atau invoice_number)
curl "$BASE/invoices/{invoice_id_atau_INV-YYYYMMDD-XXXX}" \\
  -H "X-API-Key: $API_KEY"

# ── List webhook endpoint
curl "$BASE/webhooks" \\
  -H "X-API-Key: $API_KEY"

# ── Cek saldo merchant
curl "$BASE/balance" \\
  -H "X-API-Key: $API_KEY"`
  }
}


// ── Response Examples ──────────────────────────────────────────────────────────
const RESPONSE_EXAMPLES = {
  'POST /invoices': {
    type: 'success',
    label: '201 Created',
    json: `{
  "success": true,
  "data": {
    "id":             "clx9abc123",
    "invoice_number": "INV-20240327-0042",
    "amount":         150000,
    "amount_unique":  150000,
    "unique_code":    0,
    "payment_url":    "https://sayabayar.com/pay/INV-20240327-0042",
    "status":         "pending",
    "expired_at":     "2026-03-27T05:00:00.000+07:00",
    "created_at":     "2026-03-27T04:00:00.000+07:00"
  },
  "meta": {
    "request_id": "982431b3-882c-4d5d-b87b-2b5edd3498ee",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'GET /invoices': {
    type: 'success',
    label: '200 OK',
    json: `{
  "success": true,
  "data": [
    {
      "id":             "clx9abc123",
      "invoice_number": "INV-20240327-0042",
      "customer_name":  "Budi Santoso",
      "amount":         150000,
      "amount_unique":  150000,
      "status":         "paid",
      "payment_url":    "https://sayabayar.com/pay/INV-20240327-0042",
      "expired_at":     "2026-03-27T05:00:00.000+07:00",
      "paid_at":        "2026-03-27T04:32:10.000+07:00",
      "created_at":     "2026-03-27T04:00:00.000+07:00"
    }
  ],
  "pagination": {
    "page":        1,
    "per_page":    20,
    "total":       1,
    "total_pages": 1
  },
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'GET /invoices/:id': {
    type: 'success',
    label: '200 OK',
    json: `{
  "success": true,
  "data": {
    "id":             "clx9abc123",
    "invoice_number": "INV-20240327-0042",
    "customer_name":  "Budi Santoso",
    "customer_email": "budi@example.com",
    "amount":         150000,
    "amount_unique":  150000,
    "unique_code":    0,
    "description":    "Pembelian produk X",
    "status":         "paid",
    "source":         "api",
    "payment_url":    "https://sayabayar.com/pay/INV-20240327-0042",
    "payment_channel": {
      "id":             "ch_bca_01",
      "channel_type":   "BCA",
      "account_name":   "PT Contoh",
      "account_number": "1234567890"
    },
    "transactions": [
      {
        "id":               "tx_abc",
        "amount":           150000,
        "reference_number": "REF20240327001",
        "match_status":     "matched",
        "detected_at":      "2026-03-27T04:32:00.000+07:00"
      }
    ],
    "expired_at":   "2026-03-27T05:00:00.000+07:00",
    "paid_at":      "2026-03-27T04:32:10.000+07:00",
    "confirmed_at": null,
    "created_at":   "2026-03-27T04:00:00.000+07:00"
  },
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'GET /webhooks': {
    type: 'success',
    label: '200 OK',
    json: `{
  "success": true,
  "data": [
    {
      "id":          "wh_abc123",
      "url":         "https://api.yourapp.com/webhook",
      "event_types": ["invoice.paid", "invoice.expired"],
      "is_active":   true,
      "created_at":  "2026-03-27T04:00:00.000+07:00"
    }
  ],
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'GET /balance': {
    type: 'success',
    label: '200 OK',
    json: `{
  "success": true,
  "data": {
    "balance_pending":   25000,
    "balance_available": 500000,
    "total_earned":      2500000,
    "total_withdrawn":   2000000
  },
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'Error — 401': {
    type: 'error',
    label: '401 Unauthorized',
    json: `{
  "success": false,
  "error": {
    "code":    "UNAUTHORIZED",
    "message": "API key tidak valid atau tidak aktif",
    "details": null
  },
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'Error — 422': {
    type: 'error',
    label: '422 Validasi',
    json: `{
  "success": false,
  "error": {
    "code":    "VALIDATION_ERROR",
    "message": "Validasi gagal",
    "details": [
      { "field": "amount", "message": "Amount harus lebih dari 0" }
    ]
  },
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  },
  'Error — 429': {
    type: 'error',
    label: '429 Rate Limit',
    json: `{
  "success": false,
  "error": {
    "code":    "RATE_LIMIT_EXCEEDED",
    "message": "Terlalu banyak request",
    "details": null
  },
  "meta": {
    "request_id": "a1b2c3d4-...",
    "timestamp":  "2026-03-27T04:00:00.000+07:00"
  }
}`
  }
}

function ResponseExamples() {
  const [active, setActive] = useState('POST /invoices')
  const current = RESPONSE_EXAMPLES[active]
  return (
    <div>
      <div style={{ display: 'flex', gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none', flexWrap: 'wrap' }}>
        {Object.entries(RESPONSE_EXAMPLES).map(([key, val]) => (
          <button key={key} onClick={() => setActive(key)}
            style={{
              padding: '5px 11px', borderRadius: '6px 6px 0 0', fontSize: '0.75rem', border: 'none', cursor: 'pointer',
              whiteSpace: 'nowrap', flexShrink: 0,
              fontWeight: active === key ? 600 : 400,
              background: active === key ? 'var(--bg-input)' : 'transparent',
              color: active === key
                ? (val.type === 'error' ? 'var(--danger)' : 'var(--success)')
                : 'var(--text-muted)',
              borderBottom: active === key
                ? `2px solid ${val.type === 'error' ? 'var(--danger)' : 'var(--success)'}`
                : '2px solid transparent'
            }}>
            {key}
          </button>
        ))}
      </div>
      <div style={{ margin: '0 -16px', padding: '0 16px' }}>
        <div style={{ position: 'relative' }}>
          <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1, display: 'flex', alignItems: 'center', gap: 6 }}>
            {current.label && (
              <span className={`badge badge-${current.type === 'error' ? 'danger' : 'success'}`} style={{ fontSize: '0.7rem' }}>
                {current.label}
              </span>
            )}
            <CopyButton text={current.json} />
          </div>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '0 6px 6px 6px' }}>
            <pre style={{
              background: current.type === 'error'
                ? 'color-mix(in srgb, var(--danger) 6%, var(--bg-input))'
                : 'color-mix(in srgb, var(--success) 6%, var(--bg-input))',
              padding: '14px', paddingRight: 80, fontSize: '0.78rem', margin: 0, lineHeight: 1.65, minWidth: 300
            }}>
              {current.json}
            </pre>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Usage Guide ────────────────────────────────────────────────────────────────
function UsageGuide() {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('Node.js')

  return (
    <div className="card mb-4">
      <button onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, color: 'inherit', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BookOpen size={18} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Cara Penggunaan API</span>
        </div>
        {open ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
      </button>

      {open && (
        <div style={{ marginTop: 20 }}>

          {/* Step 1 */}
          <StepHeading n={1} title="Generate API Key" />
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Klik <strong>Generate Key</strong> di atas, beri label deskriptif (misal: <code>Production</code> atau <code>Staging</code>), lalu <strong>simpan key</strong> yang muncul — hanya ditampilkan sekali dan tidak bisa dilihat lagi.
          </p>

          {/* Step 2 */}
          <StepHeading n={2} title="Kirim request dengan header X-API-Key" />
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Sertakan API key di setiap request menggunakan header <code>X-API-Key</code>. Semua endpoint memerlukan autentikasi ini.
          </p>
          <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.7, overflowX: 'auto' }}>
            <div style={{ minWidth: 260 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>X-API-Key:</span> sk_live_xxxx...</div>
              <div><span style={{ color: 'var(--text-muted)' }}>Content-Type:</span> application/json</div>
            </div>
          </div>

          {/* Step 3 — Contoh kode */}
          <StepHeading n={3} title="Contoh request — Buat & cek status Invoice" />
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Pilih bahasa pemrograman Anda:
          </p>

          {/* Tabs */}
          <div style={{ display: 'flex', gap: 4, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            {Object.keys(SNIPPETS).map(lang => (
              <button key={lang} onClick={() => setActiveTab(lang)}
                style={{
                  padding: '6px 14px', borderRadius: '6px 6px 0 0', fontSize: '0.8rem', border: 'none', cursor: 'pointer',
                  fontWeight: activeTab === lang ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0,
                  background: activeTab === lang ? 'var(--bg-input)' : 'transparent',
                  color: activeTab === lang ? 'var(--text-primary)' : 'var(--text-muted)',
                  borderBottom: activeTab === lang ? '2px solid var(--primary)' : '2px solid transparent'
                }}>
                {lang}
              </button>
            ))}
          </div>
          <div style={{ margin: '0 -16px', padding: '0 16px' }}>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}><CopyButton text={SNIPPETS[activeTab].code} /></div>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: '0 6px 6px 6px' }}>
                <pre style={{ background: 'var(--bg-input)', padding: '14px', paddingRight: 60, fontSize: '0.78rem', margin: 0, lineHeight: 1.65, minWidth: 300 }}>
                  {SNIPPETS[activeTab].code}
                </pre>
              </div>
            </div>
          </div>

          {/* Step 4 */}
          <StepHeading n={4} title="Referensi Endpoint" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
            {[
              { method: 'POST', path: '/v1/invoices', desc: 'Buat invoice baru' },
              { method: 'GET', path: '/v1/invoices', desc: 'List semua invoice (query: status, page)' },
              { method: 'GET', path: '/v1/invoices/:id', desc: 'Detail & status invoice' },
              { method: 'GET', path: '/v1/webhooks', desc: 'List webhook endpoint' },
              { method: 'GET', path: '/v1/balance', desc: 'Cek saldo merchant' },
            ].map(e => (
              <div key={`${e.method}-${e.path}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <span className={`badge badge-${e.method === 'POST' ? 'success' : 'info'}`} style={{ fontFamily: 'monospace', fontSize: '0.72rem', flexShrink: 0 }}>{e.method}</span>
                <code style={{ fontSize: '0.78rem', flexShrink: 0 }}>{e.path}</code>
                <span className="text-sm text-muted">{e.desc}</span>
              </div>
            ))}
          </div>

          {/* Step 5 — Format Response */}
          <StepHeading n={5} title="Format Response" />
          <p className="text-sm text-muted" style={{ marginBottom: 10 }}>
            Semua response menggunakan format JSON yang konsisten dengan field <code>success</code>, <code>data</code>, dan <code>meta</code>.
          </p>
          <ResponseExamples />

          {/* Tip */}
          <div style={{ marginTop: 20, background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            💡 <strong>Tips keamanan:</strong> Jangan hardcode API key di kode frontend. Simpan di environment variable server (<code>.env</code>) dan panggil API dari backend saja. Gunakan label berbeda untuk setiap environment (<code>Production</code>, <code>Staging</code>, <code>Development</code>).
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ApiKeysPage() {
  const toast = useToast()
  const [keys, setKeys] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [createdKey, setCreatedKey] = useState(null)
  const [label, setLabel] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)

  const load = () => { api.get('/v1/api-keys').then(r => setKeys(r.data)).finally(() => setLoading(false)) }
  useEffect(load, [])

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const res = await api.post('/v1/api-keys', { label })
      setCreatedKey(res.data.key)
      setShowModal(false)
      setLabel('')
      toast.success('API Key berhasil dibuat')
      load()
    } catch (err) {
      toast.error(err.message || 'Gagal membuat API key')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.del(`/v1/api-keys/${deleteTarget.id}`)
      setDeleteTarget(null)
      toast.success('API Key dinonaktifkan')
      load()
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return <SkeletonTable rows={3} cols={5} />

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">API Keys</h1>
          <p className="page-subtitle">Kelola API keys untuk integrasi</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Generate Key
        </button>
      </div>

      <SecretReveal
        label="API Key Baru"
        value={createdKey}
        icon={<KeyRound size={18} />}
        onClose={() => setCreatedKey(null)}
      />

      <div className="card mobile-cards">
        {keys.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><KeyRound size={48} strokeWidth={1} /></div>
            <div className="empty-state-text">Belum ada API key</div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Label</th><th>Status</th><th>Last Used</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  {keys.map(k => (
                    <tr key={k.id}>
                      <td>{k.label || '-'}</td>
                      <td><span className={`badge badge-${k.is_active ? 'success' : 'danger'}`}>{k.is_active ? 'Aktif' : 'Off'}</span></td>
                      <td className="text-sm text-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString('id-ID') : 'Belum dipakai'}</td>
                      <td className="text-sm text-muted">{new Date(k.created_at).toLocaleString('id-ID')}</td>
                      <td>
                        {k.is_active && (
                          <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(k)}>
                            <Trash2 size={14} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {keys.map(k => (
              <div className="mobile-card" key={k.id}>
                <div className="mobile-card-header">
                  <div className="mobile-card-title">{k.label || 'Tanpa Label'}</div>
                  <span className={`badge badge-${k.is_active ? 'success' : 'danger'}`}>{k.is_active ? 'Aktif' : 'Off'}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Terakhir Dipakai</span>
                  <span className="text-sm text-muted">{k.last_used_at ? new Date(k.last_used_at).toLocaleString('id-ID') : 'Belum dipakai'}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">Dibuat</span>
                  <span className="text-sm text-muted">{new Date(k.created_at).toLocaleString('id-ID')}</span>
                </div>
                {k.is_active && (
                  <div className="mobile-card-actions">
                    <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(k)}>
                      <Trash2 size={14} /> Nonaktifkan
                    </button>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Usage Guide */}
      <div style={{ marginTop: 24 }}><UsageGuide /></div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Generate API Key</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Label (opsional)</label>
                <input type="text" className="form-input" placeholder="Production key" value={label} onChange={e => setLabel(e.target.value)} />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">Generate</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Nonaktifkan API Key?"
        message={deleteTarget ? `API Key "${deleteTarget.label || 'tanpa label'}" akan dinonaktifkan. Key tidak bisa digunakan lagi.` : ''}
        confirmText="Ya, Nonaktifkan"
      />
    </>
  )
}
