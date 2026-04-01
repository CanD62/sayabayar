'use client'
import { useState, useEffect, Fragment } from 'react'
import { Plus, Link2, Trash2, Shield, BookOpen, ChevronDown, ChevronUp, FlaskConical, Loader2, CheckCircle2, XCircle, ClipboardList, RefreshCw } from 'lucide-react'
import { api } from '@/lib/api'
import { CopyButton, StepHeading, SecretReveal } from '@/components/ui'
import { useToast } from '@/components/Toast'
import ConfirmModal from '@/components/ConfirmModal'
import { SkeletonTable } from '@/components/Skeleton'


// ── Code Snippets ──────────────────────────────────────────────────────────────
const SNIPPETS = {
  'Node.js (Express)': {
    lang: 'javascript',
    code: `const express = require('express')
const crypto = require('crypto')
const app = express()

// PENTING: gunakan raw body, bukan JSON parsed
app.use('/webhook', express.raw({ type: 'application/json' }))

const WEBHOOK_SECRET = 'whsec_xxxx...' // secret dari dashboard

app.post('/webhook', (req, res) => {
  const signature = req.headers['x-webhook-signature']
  const payload   = req.body.toString()

  // Verifikasi signature — HMAC-SHA256 standar
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Invalid signature' })
  }

  const { event, data } = JSON.parse(payload)

  if (event === 'invoice.paid') {
    console.log('Invoice lunas:', data.invoice_number, '— Rp', data.amount)
    // → aktifkan akun, proses pesanan, kirim email konfirmasi
  } else if (event === 'invoice.expired') {
    console.log('Invoice kadaluarsa:', data.invoice_number)
    // → batalkan pesanan, kirim notifikasi ke customer
  } else if (event === 'invoice.cancelled') {
    console.log('Invoice dibatalkan:', data.invoice_number)
    // → kembalikan stok, refund jika perlu
  }

  res.json({ received: true })
})

app.listen(3000)`
  },
  'PHP': {
    lang: 'php',
    code: `<?php
$secret  = 'whsec_xxxx...'; // secret dari dashboard
$payload = file_get_contents('php://input');

// Verifikasi signature — HMAC-SHA256 standar
$signature = $_SERVER['HTTP_X_WEBHOOK_SIGNATURE'] ?? '';
$expected  = hash_hmac('sha256', $payload, $secret);

if (!hash_equals($expected, $signature)) {
    http_response_code(401);
    exit(json_encode(['error' => 'Invalid signature']));
}

$body  = json_decode($payload, true);
$event = $body['event'];
$data  = $body['data'];

if ($event === 'invoice.paid') {
    // Invoice berhasil dibayar
    error_log("Lunas: " . $data['invoice_number'] . " Rp " . $data['amount']);
    // → update_order_status($data['invoice_number'], 'paid');
} elseif ($event === 'invoice.expired') {
    // Invoice kadaluarsa
    error_log("Expired: " . $data['invoice_number']);
    // → update_order_status($data['invoice_number'], 'expired');
} elseif ($event === 'invoice.cancelled') {
    // Invoice dibatalkan
    error_log("Cancelled: " . $data['invoice_number']);
    // → update_order_status($data['invoice_number'], 'cancelled');
}

echo json_encode(['received' => true]);`
  },
  'Python (Flask)': {
    lang: 'python',
    code: `import hmac, hashlib
from flask import Flask, request, jsonify

app = Flask(__name__)

WEBHOOK_SECRET = 'whsec_xxxx...'  # secret dari dashboard

@app.route('/webhook', methods=['POST'])
def webhook():
    signature = request.headers.get('X-Webhook-Signature', '')
    payload   = request.get_data()  # raw bytes

    # Verifikasi signature — HMAC-SHA256 standar
    expected = hmac.new(
        WEBHOOK_SECRET.encode(),
        payload,
        hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        return jsonify(error='Invalid signature'), 401

    body  = request.get_json(force=True)
    event = body['event']
    data  = body['data']

    if event == 'invoice.paid':
        print(f"Lunas: {data['invoice_number']} — Rp {data['amount']}")
        # → aktifkan akun / proses pesanan
    elif event == 'invoice.expired':
        print(f"Expired: {data['invoice_number']}")
        # → batalkan pesanan
    elif event == 'invoice.cancelled':
        print(f"Cancelled: {data['invoice_number']}")
        # → kembalikan stok

    return jsonify(received=True)

if __name__ == '__main__':
    app.run(port=5000)`
  }
}

const EVENT_INFO = [
  { event: 'invoice.paid', desc: 'Invoice berhasil dibayar oleh customer', badge: 'success' },
  { event: 'invoice.expired', desc: 'Invoice melewati batas waktu pembayaran', badge: 'warning' },
  { event: 'invoice.cancelled', desc: 'Invoice dibatalkan oleh merchant', badge: 'danger' },
]

const PAYLOAD_EXAMPLE = `{
  "event": "invoice.paid",
  "data": {
    "invoice_id": "clx9abc123",
    "invoice_number": "INV-2024-001",
    "amount": 150000,
    "amount_unique": 150123,
    "status": "paid",
    "payment_channel": "BCA",
    "paid_at": "2024-03-27T03:00:00.000Z"
  },
  "timestamp": "2024-03-27T03:00:05.000Z"
}`


// ── Usage Guide Component ──────────────────────────────────────────────────────
function UsageGuide() {
  const [open, setOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('Node.js (Express)')

  return (
    <div className="card mb-4">
      {/* Header — clickable toggle */}
      <button
        onClick={() => setOpen(v => !v)}
        style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 0, color: 'inherit', textAlign: 'left' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <BookOpen size={18} style={{ color: 'var(--primary)' }} />
          <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Cara Penggunaan Webhook</span>
        </div>
        {open ? <ChevronUp size={16} style={{ color: 'var(--text-muted)' }} /> : <ChevronDown size={16} style={{ color: 'var(--text-muted)' }} />}
      </button>

      {open && (
        <div style={{ marginTop: 20 }}>

          {/* Step 1 */}
          <StepHeading n={1} title="Daftarkan URL endpoint di aplikasi Anda" />
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Klik <strong>Tambah Webhook</strong> di atas, isi URL server Anda (harus HTTPS di production) dan pilih event yang ingin diterima. Simpan <strong>secret key</strong> yang muncul — hanya ditampilkan sekali.
          </p>

          {/* Step 2 */}
          <StepHeading n={2} title="Terima dan verifikasi request dari Saya Bayar" />
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            Setiap kali event terjadi, server Saya Bayar akan mengirim <code>HTTP POST</code> ke URL Anda dengan header berikut:
          </p>
          <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '12px 14px', marginBottom: 16, fontFamily: 'monospace', fontSize: '0.8rem', lineHeight: 1.7, overflowX: 'auto' }}>
            <div style={{ minWidth: 280 }}>
              <div><span style={{ color: 'var(--text-muted)' }}>Content-Type:</span> application/json</div>
              <div><span style={{ color: 'var(--text-muted)' }}>X-Webhook-Signature:</span> sha256_hash_dari_payload</div>
              <div><span style={{ color: 'var(--text-muted)' }}>X-Webhook-Event:</span> invoice.paid</div>
            </div>
          </div>

          {/* Payload example — full bleed scrollable on mobile */}
          <p className="text-sm text-muted" style={{ marginBottom: 8 }}>Contoh payload JSON yang diterima:</p>
          <div style={{ position: 'relative', marginBottom: 20, margin: '0 -16px 20px', padding: '0 16px' }}>
            <div style={{ position: 'relative' }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 2 }}><CopyButton text={PAYLOAD_EXAMPLE} /></div>
              <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', borderRadius: 8 }}>
                <pre style={{ background: 'var(--bg-input)', padding: '12px 14px', paddingRight: 60, fontSize: '0.78rem', margin: 0, lineHeight: 1.6, minWidth: 280 }}>{PAYLOAD_EXAMPLE}</pre>
              </div>
            </div>
          </div>

          {/* Step 3 */}
          <StepHeading n={3} title="Verifikasi signature & proses event" />
          <p className="text-sm text-muted" style={{ marginBottom: 12 }}>
            <strong>Selalu verifikasi signature</strong> sebelum memproses data, agar request tidak bisa dipalsukan. Pilih bahasa yang Anda gunakan:
          </p>

          {/* Language tabs + code block — full bleed on mobile */}
          <div style={{ display: 'flex', gap: 4, marginBottom: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch', scrollbarWidth: 'none' }}>
            {Object.keys(SNIPPETS).map(lang => {
              const shortLabel = lang === 'Node.js (Express)' ? 'Node.js' : lang === 'Python (Flask)' ? 'Python' : lang
              return (
                <button key={lang} onClick={() => setActiveTab(lang)}
                  style={{
                    padding: '6px 14px', borderRadius: '6px 6px 0 0', fontSize: '0.8rem', border: 'none', cursor: 'pointer',
                    fontWeight: activeTab === lang ? 600 : 400, whiteSpace: 'nowrap', flexShrink: 0,
                    background: activeTab === lang ? 'var(--bg-input)' : 'transparent',
                    color: activeTab === lang ? 'var(--text-primary)' : 'var(--text-muted)',
                    borderBottom: activeTab === lang ? '2px solid var(--primary)' : '2px solid transparent'
                  }}>
                  {shortLabel}
                </button>
              )
            })}
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
          <StepHeading n={4} title="Referensi Events" style={{ marginTop: 20 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            {EVENT_INFO.map(e => (
              <div key={e.event} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                <span className={`badge badge-${e.badge}`} style={{ fontFamily: 'monospace', fontSize: '0.75rem', flexShrink: 0 }}>{e.event}</span>
                <span className="text-sm text-muted" style={{ flex: 1, minWidth: 160 }}>{e.desc}</span>
              </div>
            ))}
          </div>

          {/* Tip */}
          <div style={{ marginTop: 20, background: 'color-mix(in srgb, var(--primary) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--primary) 25%, transparent)', borderRadius: 8, padding: '10px 14px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
            💡 <strong>Tips testing lokal:</strong> Gunakan{' '}
            <a href="https://webhook.site" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>webhook.site</a>{' '}
            atau <code>ngrok</code> untuk mendapat URL publik saat development, sehingga Anda bisa langsung melihat payload yang masuk tanpa deploy ke server.
          </div>
        </div>
      )}
    </div>
  )
}


// ── Log Panel Component ────────────────────────────────────────────────────────
function LogPanel({ webhookId, onClose }) {
  const [logs, setLogs] = useState([])
  const [loadingLogs, setLoadingLogs] = useState(true)

  const fetchLogs = () => {
    setLoadingLogs(true)
    api.get(`/v1/webhooks/${webhookId}/logs?per_page=10`)
      .then(r => setLogs(r.data || []))
      .catch(() => setLogs([]))
      .finally(() => setLoadingLogs(false))
  }

  useEffect(() => { fetchLogs() }, [webhookId])

  const fmt = (iso) => {
    if (!iso) return '-'
    return new Date(iso).toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '12px 16px', marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: '0.82rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <ClipboardList size={14} /> Log Pengiriman (10 terbaru)
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={fetchLogs} title="Refresh log"
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>
            <RefreshCw size={13} />
          </button>
          <button onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px 8px', borderRadius: 4, color: 'var(--text-muted)', fontSize: '0.8rem' }}>✕</button>
        </div>
      </div>

      {loadingLogs ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: '0.82rem', padding: '8px 0' }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Memuat log...
        </div>
      ) : logs.length === 0 ? (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: 0 }}>Belum ada log pengiriman.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {logs.map(log => (
            <div key={log.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: '0.8rem', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
              {log.http_status
                ? <span className={`badge badge-${log.http_status >= 200 && log.http_status < 300 ? 'success' : 'danger'}`} style={{ fontSize: '0.72rem', minWidth: 40, textAlign: 'center' }}>
                    {log.http_status}
                  </span>
                : <span className="badge badge-warning" style={{ fontSize: '0.72rem' }}>ERR</span>
              }
              <span style={{ color: 'var(--text-muted)', minWidth: 60 }}>#{log.attempt_number}</span>
              <span style={{ flex: 1, color: 'var(--text-secondary)', fontFamily: 'monospace', fontSize: '0.75rem' }}>
                {log.invoice_number || '-'}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>{fmt(log.sent_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function WebhooksPage() {
  const toast = useToast()
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [createdSecret, setCreatedSecret] = useState(null)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [testModal, setTestModal] = useState(null) // { webhook, event, phase: 'select'|'loading'|'result', result }
  const [form, setForm] = useState({ url: '', event_types: ['invoice.paid'] })
  const [expandedLog, setExpandedLog] = useState(null) // webhookId yang sedang dibuka lognya

  const load = () => { api.get('/v1/webhooks').then(r => setWebhooks(r.data)).finally(() => setLoading(false)) }
  useEffect(load, [])

  const toggleEvent = (event) => {
    const types = form.event_types.includes(event)
      ? form.event_types.filter(e => e !== event)
      : [...form.event_types, event]
    setForm({ ...form, event_types: types })
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    try {
      const res = await api.post('/v1/webhooks', form)
      setCreatedSecret(res.data.secret)
      setShowModal(false)
      setForm({ url: '', event_types: ['invoice.paid'] })
      toast.success('Webhook berhasil ditambahkan')
      load()
    } catch (err) {
      toast.error(err.message || 'Gagal menambahkan webhook')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      await api.del(`/v1/webhooks/${deleteTarget.id}`)
      setDeleteTarget(null)
      toast.success('Webhook berhasil dihapus')
      load()
    } catch (err) { toast.error(err.message) }
  }

  const openTest = (w) => setTestModal({ webhook: w, event: 'invoice.paid', phase: 'select', result: null })

  const sendTest = async (evt) => {
    if (!testModal) return
    setTestModal(m => ({ ...m, phase: 'loading', result: null }))
    try {
      const res = await api.post(`/v1/webhooks/${testModal.webhook.id}/test`, { event: evt })
      setTestModal(m => ({ ...m, phase: 'result', result: res.data }))
    } catch (err) {
      setTestModal(m => ({ ...m, phase: 'result', result: { error: err.message, success: false } }))
    }
  }

  const toggleLog = (id) => setExpandedLog(prev => prev === id ? null : id)

  if (loading) return <SkeletonTable rows={3} cols={4} />

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Webhook</h1>
          <p className="page-subtitle">Terima notifikasi realtime untuk event pembayaran</p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          <Plus size={16} /> Tambah Webhook
        </button>
      </div>


      {createdSecret && (
        <div className="card mb-4" style={{ borderColor: 'var(--success)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Shield size={18} style={{ color: 'var(--success)' }} />
            <h3 style={{ color: 'var(--success)', fontSize: '0.95rem', fontWeight: 600, margin: 0 }}>Webhook Secret</h3>
          </div>
          <p className="text-sm text-muted" style={{ marginBottom: 8 }}>Simpan secret ini — hanya ditampilkan sekali!</p>
          <div style={{ position: 'relative' }}>
            <code className="font-mono" style={{ background: 'var(--bg-input)', padding: '10px 14px', paddingRight: 70, borderRadius: 6, display: 'block', wordBreak: 'break-all' }}>{createdSecret}</code>
            <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: 8 }}>
              <CopyButton text={createdSecret} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm mt-2" onClick={() => setCreatedSecret(null)}>Tutup</button>
        </div>
      )}

      <div className="card mobile-cards">
        {webhooks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><Link2 size={48} strokeWidth={1} /></div>
            <div className="empty-state-text">Belum ada webhook endpoint</div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>URL</th><th>Events</th><th>Status</th><th></th></tr></thead>
                <tbody>
                  {webhooks.map(w => (
                    <Fragment key={w.id}>
                      <tr>
                        <td className="font-mono text-sm">{w.url}</td>
                        <td>{w.event_types?.map(e => <span key={e} className="badge badge-info" style={{ marginRight: 4 }}>{e}</span>)}</td>
                        <td><span className={`badge badge-${w.is_active ? 'success' : 'danger'}`}>{w.is_active ? 'Aktif' : 'Off'}</span></td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => toggleLog(w.id)} title="Lihat log"
                              style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, border:'none', cursor:'pointer', fontSize:'0.8rem', background: expandedLog === w.id ? 'var(--bg-input)' : 'transparent', color: expandedLog === w.id ? 'var(--text-primary)' : 'var(--text-muted)', border: '1px solid var(--border)' }}>
                              <ClipboardList size={14} />
                            </button>
                            <button onClick={() => openTest(w)} title="Test webhook"
                              style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:6, border:'none', cursor:'pointer', fontSize:'0.8rem', background:'#2563eb', color:'#fff' }}>
                              <FlaskConical size={14} />
                            </button>
                            <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(w)}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedLog === w.id && (
                        <tr key={`${w.id}-log`}>
                          <td colSpan={4} style={{ padding: '0 0 12px' }}>
                            <LogPanel webhookId={w.id} onClose={() => setExpandedLog(null)} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {webhooks.map(w => (
              <div className="mobile-card" key={w.id}>
                <div className="mobile-card-header">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mobile-card-title" style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{w.url}</div>
                  </div>
                  <span className={`badge badge-${w.is_active ? 'success' : 'danger'}`}>{w.is_active ? 'Aktif' : 'Off'}</span>
                </div>
                <div className="mobile-card-row" style={{ flexWrap: 'wrap', gap: 4 }}>
                  {w.event_types?.map(e => <span key={e} className="badge badge-info" style={{ fontSize: '0.65rem' }}>{e}</span>)}
                </div>
                <div className="mobile-card-actions">
                  <button onClick={() => toggleLog(w.id)}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:6, border:'1px solid var(--border)', cursor:'pointer', fontSize:'0.82rem', background: expandedLog === w.id ? 'var(--bg-input)' : 'transparent', color: 'var(--text-secondary)', fontWeight:500 }}>
                    <ClipboardList size={14} /> Log
                  </button>
                  <button onClick={() => openTest(w)}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:6, border:'none', cursor:'pointer', fontSize:'0.82rem', background:'#2563eb', color:'#fff', fontWeight:500 }}>
                    <FlaskConical size={14} /> Test
                  </button>
                  <button className="btn btn-danger btn-sm" onClick={() => setDeleteTarget(w)}>
                    <Trash2 size={14} /> Hapus
                  </button>
                </div>
                {expandedLog === w.id && <LogPanel webhookId={w.id} onClose={() => setExpandedLog(null)} />}
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
            <h3 className="modal-title">Tambah Webhook</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">URL Endpoint *</label>
                <input type="url" className="form-input" placeholder="https://api.yourapp.com/webhook" value={form.url}
                  onChange={e => setForm({ ...form, url: e.target.value })} required />
              </div>
              <div className="form-group">
                <label className="form-label">Events</label>
                <div className="flex gap-3" style={{ flexWrap: 'wrap' }}>
                  {['invoice.paid', 'invoice.expired', 'invoice.cancelled'].map(evt => (
                    <label key={evt} className="flex items-center gap-2 text-sm" style={{ cursor: 'pointer' }}>
                      <input type="checkbox" checked={form.event_types.includes(evt)} onChange={() => toggleEvent(evt)} />
                      {evt}
                    </label>
                  ))}
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn btn-primary">Tambah</button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Hapus Webhook?"
        message={deleteTarget ? `Webhook ${deleteTarget.url} akan dihapus permanen.` : ''}
        confirmText="Ya, Hapus"
      />

      {/* Test Modal */}
      {testModal && (
        <div className="modal-overlay" onClick={() => setTestModal(null)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FlaskConical size={18} /> Test Webhook
            </h3>
            <p className="text-sm text-muted" style={{ marginBottom: 12, wordBreak: 'break-all', fontFamily: 'monospace', fontSize: '0.8rem' }}>
              {testModal.webhook.url}
            </p>

            {/* Phase: select event */}
            {testModal.phase === 'select' && (
              <div className="form-group">
                <label className="form-label">Pilih Event</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {['invoice.paid', 'invoice.expired', 'invoice.cancelled'].map(evt => (
                    <label key={evt} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '8px 12px', borderRadius: 6, border: `1px solid ${testModal.event === evt ? 'var(--primary)' : 'var(--border)'}`, background: testModal.event === evt ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent' }}>
                      <input type="radio" name="testEvent" value={evt}
                        checked={testModal.event === evt}
                        onChange={() => setTestModal(m => ({ ...m, event: evt }))} />
                      <code style={{ fontSize: '0.82rem' }}>{evt}</code>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* Phase: loading */}
            {testModal.phase === 'loading' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '20px 0', color: 'var(--text-muted)' }}>
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
                <span className="text-sm">Mengirim <code>{testModal.event}</code>...</span>
              </div>
            )}

            {/* Phase: result */}
            {testModal.phase === 'result' && testModal.result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="text-sm text-muted">Event: <code style={{ fontSize: '0.82rem' }}>{testModal.event}</code></div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {testModal.result.success
                    ? <CheckCircle2 size={20} style={{ color: 'var(--success)', flexShrink: 0 }} />
                    : <XCircle size={20} style={{ color: 'var(--danger)', flexShrink: 0 }} />}
                  <div>
                    {testModal.result.http_status && (
                      <span className={`badge badge-${testModal.result.success ? 'success' : 'danger'}`} style={{ fontSize: '0.85rem', marginRight: 8 }}>
                        HTTP {testModal.result.http_status}
                      </span>
                    )}
                    {testModal.result.latency_ms != null && (
                      <span className="text-sm text-muted">{testModal.result.latency_ms} ms</span>
                    )}
                  </div>
                </div>

                {testModal.result.error && (
                  <div style={{ background: 'color-mix(in srgb, var(--danger) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--danger) 25%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: '0.8rem', color: 'var(--danger)' }}>
                    {testModal.result.error}
                  </div>
                )}

                {testModal.result.response !== undefined && (
                  <div>
                    <div className="text-sm text-muted" style={{ marginBottom: 4 }}>Response Body:</div>
                    <pre style={{ background: 'var(--bg-input)', borderRadius: 6, padding: '10px 12px', fontSize: '0.78rem', overflowX: 'auto', margin: 0, maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                      {testModal.result.response
                        ? (() => { try { return JSON.stringify(JSON.parse(testModal.result.response), null, 2) } catch { return testModal.result.response } })()
                        : '(kosong)'}
                    </pre>
                  </div>
                )}

                {testModal.result.http_status === 401 && (
                  <div style={{ background: 'color-mix(in srgb, var(--warning, #f59e0b) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--warning, #f59e0b) 30%, transparent)', borderRadius: 6, padding: '8px 12px', fontSize: '0.8rem' }}>
                    ⚠️ <strong>401 Unauthorized</strong> — Pastikan kode verifikasi signature di endpoint Anda sudah benar.
                  </div>
                )}
              </div>
            )}

            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setTestModal(null)}>Tutup</button>
              {testModal.phase !== 'loading' && (
                <button className="btn btn-primary" onClick={() => {
                  if (testModal.phase === 'result') {
                    setTestModal(m => ({ ...m, phase: 'select', result: null }))
                  } else {
                    sendTest(testModal.event)
                  }
                }}>
                  <FlaskConical size={14} />
                  {testModal.phase === 'result' ? 'Coba Lagi' : 'Kirim Test'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
