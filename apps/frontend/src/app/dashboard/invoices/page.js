'use client'
import { useState, useEffect, useRef } from 'react'
import { Plus, Share2, Ban, FileText, Eye, X, Search, Receipt, Clock, CheckCircle2, XCircle, AlertCircle, Layers, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { useInvoiceEvents } from '@/lib/InvoiceEventContext'
import ConfirmModal from '@/components/ConfirmModal'
import ShareModal from '@/components/ShareModal'
import { SkeletonTable } from '@/components/Skeleton'

import { fmt, getInvoiceStatus, INVOICE_STATUS } from '@/lib/format'


const STAT_CONFIG = [
  { key: '', label: 'Semua', Icon: Layers, color: '#10b981', glow: 'rgba(16,185,129,0.2)' },
  { key: 'pending', label: 'Menunggu', Icon: Clock, color: '#f59e0b', glow: 'rgba(245,158,11,0.2)' },
  { key: 'user_confirmed', label: 'Proses', Icon: AlertCircle, color: '#06b6d4', glow: 'rgba(6,182,212,0.2)' },
  { key: 'paid', label: 'Lunas', Icon: CheckCircle2, color: '#10b981', glow: 'rgba(16,185,129,0.2)' },
  { key: 'expired', label: 'Expired', Icon: XCircle, color: '#ef4444', glow: 'rgba(239,68,68,0.2)' },
  { key: 'cancelled', label: 'Batal', Icon: Ban, color: '#a78bfa', glow: 'rgba(167,139,250,0.2)' },
]

export default function InvoicesPage() {
  const toast = useToast()
  const invoiceEvents = useInvoiceEvents()
  const detailDataRef = useRef(null)
  const [invoices, setInvoices] = useState([])
  const [canAddOwnChannel, setCanAddOwnChannel] = useState(false)
  const [hasOwnChannel, setHasOwnChannel] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [creating, setCreating] = useState(false)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [shareTarget, setShareTarget] = useState(null)
  const [detailData, setDetailData] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [form, setForm] = useState({ amount: '', description: '', customer_name: '', customer_email: '', channel_preference: 'platform' })
  const [errors, setErrors] = useState({})
  const [stats, setStats] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [search, setSearch] = useState('')

  const openDetail = async (inv) => {
    setDetailLoading(true)
    setDetailData({ ...inv, _loading: true })
    detailDataRef.current = inv
    try {
      const res = await api.get(`/v1/invoices/${inv.id}`)
      setDetailData(res.data)
      detailDataRef.current = res.data
    } catch {
      setDetailData({ ...inv, _error: true })
    } finally {
      setDetailLoading(false)
    }
  }

  const load = (status = filterStatus) => {
    const invUrl = status ? `/v1/invoices?status=${status}` : '/v1/invoices'
    Promise.all([
      api.get(invUrl),
      api.get('/v1/subscriptions/current'),
      api.get('/v1/channels'),
      api.get('/v1/invoices/stats')
    ]).then(([inv, sub, ch, st]) => {
      setInvoices(inv.data)
      const canOwn = sub.data?.plan?.can_add_own_channel === true
      const ownChannels = (ch.data || []).filter(c => c.is_active && c.channel_owner === 'client')
      setCanAddOwnChannel(canOwn)
      setHasOwnChannel(ownChannels.length > 0)
      setStats(st.data)
    }).finally(() => setLoading(false))
  }
  useEffect(() => { load(filterStatus) }, [filterStatus])

  useEffect(() => {
    if (!invoiceEvents) return
    return invoiceEvents.onEvent((eventName, payload) => {
      if (['invoice.paid', 'invoice.expired', 'invoice.cancelled', 'data.reload'].includes(eventName)) {
        load()
        if (payload?.invoice_id && detailDataRef.current?.id === payload.invoice_id) {
          api.get(`/v1/invoices/${payload.invoice_id}`)
            .then(res => setDetailData(res.data))
            .catch(() => { })
        }
      }
    })
  }, [invoiceEvents])

  const validate = () => {
    const e = {}
    const amount = parseFloat(form.amount)
    if (!form.amount || isNaN(amount)) e.amount = 'Masukkan nominal yang valid'
    else if (amount < 1000) e.amount = 'Minimal Rp 1.000'
    else if (amount > 100000000) e.amount = 'Maksimal Rp 100.000.000'
    if (form.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.customer_email)) {
      e.customer_email = 'Format email tidak valid'
    }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setCreating(true)
    try {
      await api.post('/v1/invoices', {
        amount: parseFloat(form.amount),
        channel_preference: form.channel_preference || 'platform',
        description: form.description || undefined,
        customer_name: form.customer_name || undefined,
        customer_email: form.customer_email || undefined,
      })
      setShowCreate(false)
      setErrors({})
      toast.success('Invoice berhasil dibuat')
      load()
    } catch (err) {
      setErrors({ submit: err.message || 'Gagal membuat invoice' })
    } finally {
      setCreating(false)
    }
  }

  const handleChannelPrefChange = (value) => {
    if (value === 'client' && !hasOwnChannel) {
      toast.warning('Anda belum menambahkan channel. Tambahkan dulu di menu Channel Pembayaran.')
      return
    }
    setForm(f => ({ ...f, channel_preference: value }))
  }

  const handleCancel = async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await api.del(`/v1/invoices/${cancelTarget.id}`)
      setCancelTarget(null)
      toast.success('Invoice berhasil dibatalkan')
      load()
    } catch (err) {
      toast.error(err.message || 'Gagal membatalkan invoice')
    } finally {
      setCancelling(false)
    }
  }

  const getStatCount = (key) => {
    if (!stats) return 0
    if (key === '') return Object.values(stats).reduce((a, b) => a + b, 0)
    return stats[key] ?? 0
  }

  const searchLower = search.toLowerCase()
  const filteredInvoices = search
    ? invoices.filter(inv =>
      inv.invoice_number?.toLowerCase().includes(searchLower) ||
      inv.customer_name?.toLowerCase().includes(searchLower) ||
      inv.customer_email?.toLowerCase().includes(searchLower) ||
      String(inv.amount).includes(search)
    )
    : invoices

  if (loading) return <SkeletonTable rows={5} cols={5} />

  return (
    <>
      {/* ── Page Header ──────────────────────────────── */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice</h1>
          <p className="page-subtitle">Kelola dan pantau invoice pembayaran Anda</p>
        </div>
        <button className="btn btn-primary" onClick={() => {
          const defaultPref = canAddOwnChannel && hasOwnChannel ? 'client' : 'platform'
          setForm({ amount: '', description: '', customer_name: '', customer_email: '', channel_preference: defaultPref })
          setErrors({})
          setShowCreate(true)
        }}>
          <Plus size={16} /> Buat Invoice
        </button>
      </div>

      {/* ── Stat Cards ───────────────────────────────── */}
      {stats && (
        <div className="inv-stat-grid">
          {STAT_CONFIG.map(({ key, label, Icon, color, glow }) => {
            const active = filterStatus === key
            const count = getStatCount(key)
            return (
              <button
                key={key}
                onClick={() => setFilterStatus(key)}
                style={{
                  background: active
                    ? `linear-gradient(135deg, ${color}22 0%, ${color}11 100%)`
                    : 'rgba(26,28,36,0.7)',
                  border: `1px solid ${active ? color + '55' : 'rgba(40,44,54,0.8)'}`,
                  borderRadius: 14,
                  padding: '14px 12px',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all 0.2s ease',
                  boxShadow: active ? `0 4px 20px ${glow}` : 'none',
                  backdropFilter: 'blur(12px)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {/* top accent bar */}
                {active && (
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 2, background: color, borderRadius: '14px 14px 0 0' }} />
                )}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 8,
                    background: `${color}18`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                  }}>
                    <Icon size={14} color={color} />
                  </div>
                </div>
                <div style={{ fontSize: '1.6rem', fontWeight: 800, color: active ? color : 'var(--text-primary)', lineHeight: 1, marginBottom: 4 }}>
                  {count}
                </div>
                <div style={{ fontSize: '0.7rem', fontWeight: 600, color: active ? color : 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  {label}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Toolbar: Search + Filter Pill ────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
          <Search size={14} style={{
            position: 'absolute', left: 12, top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)', pointerEvents: 'none',
          }} />
          <input
            type="text"
            placeholder="Cari invoice, customer, nominal..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              width: '100%', boxSizing: 'border-box',
              paddingLeft: 36, paddingRight: search ? 36 : 14,
              paddingTop: 9, paddingBottom: 9,
              border: '1px solid var(--border)',
              borderRadius: 10,
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontSize: '0.82rem',
              outline: 'none',
              fontFamily: 'var(--font-sans)',
              transition: 'border-color 0.2s',
            }}
            onFocus={e => e.target.style.borderColor = 'var(--accent)'}
            onBlur={e => e.target.style.borderColor = 'var(--border)'}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{
              position: 'absolute', right: 10, top: '50%',
              transform: 'translateY(-50%)',
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', lineHeight: 1, padding: 0,
            }}>
              <X size={13} />
            </button>
          )}
        </div>

        {filterStatus && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '6px 14px', borderRadius: 99,
            background: 'rgba(16,185,129,0.1)',
            border: '1px solid rgba(16,185,129,0.25)',
            color: 'var(--accent)',
            fontSize: '0.78rem', fontWeight: 600, whiteSpace: 'nowrap',
          }}>
            Filter: {INVOICE_STATUS[filterStatus]?.label || filterStatus}
            <button onClick={() => setFilterStatus('')} style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: 0, lineHeight: 1, color: 'inherit', opacity: 0.7, display: 'flex',
            }}>
              <X size={11} />
            </button>
          </span>
        )}

        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {filteredInvoices.length} invoice
        </span>
      </div>

      {/* ── Table / Mobile Cards ────────────────── */}
      <div className="card mobile-cards">
        {filteredInvoices.length === 0 ? (
          <div className="empty-state" style={{ padding: '60px 24px' }}>
            <div className="empty-state-icon">
              <Receipt size={48} strokeWidth={1} />
            </div>
            <div className="empty-state-text">
              {search ? `Tidak ada hasil untuk "${search}"` : 'Belum ada invoice'}
            </div>
            {!search && (
              <button className="btn btn-primary" style={{ marginTop: 4 }} onClick={() => {
                const defaultPref = canAddOwnChannel && hasOwnChannel ? 'client' : 'platform'
                setForm({ amount: '', description: '', customer_name: '', customer_email: '', channel_preference: defaultPref })
                setErrors({})
                setShowCreate(true)
              }}>
                <Plus size={16} /> Buat Invoice Pertama
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#Invoice</th>
                    <th>Customer</th>
                    <th>Nominal</th>
                    <th>Status</th>
                    <th>Dibuat</th>
                    <th style={{ width: 1 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInvoices.map(inv => {
                    const s = getInvoiceStatus(inv.status)
                    return (
                      <tr key={inv.id} className={`row-${inv.status}`}>
                        <td>
                          <span className="font-mono" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            {inv.invoice_number}
                          </span>
                        </td>
                        <td style={{ fontWeight: 500 }}>{inv.customer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                        <td style={{ fontWeight: 700 }}>Rp {fmt(inv.amount)}</td>
                        <td><span className={`badge badge-${s.badge}`}>{s.label}</span></td>
                        <td className="text-sm text-muted">{new Date(inv.created_at).toLocaleString('id-ID')}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button
                              className="btn btn-sm"
                              style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', borderColor: 'rgba(99,102,241,0.2)', border: '1px solid' }}
                              onClick={() => openDetail(inv)}
                            >
                              <Eye size={13} /> Detail
                            </button>
                            {inv.status === 'pending' && inv.payment_url && (
                              <a
                                href={inv.payment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-sm"
                                style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', borderColor: 'rgba(251,191,36,0.2)', border: '1px solid', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                              >
                                <ExternalLink size={13} /> Buka
                              </a>
                            )}
                            {(inv.status === 'pending' || inv.status === 'user_confirmed') && (
                              <button
                                className="btn btn-sm"
                                style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', borderColor: 'rgba(16,185,129,0.2)', border: '1px solid' }}
                                onClick={() => setShareTarget(inv)}
                              >
                                <Share2 size={13} /> Bagikan
                              </button>
                            )}

                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="mobile-cards">
              {filteredInvoices.map(inv => {
                const s = getInvoiceStatus(inv.status)
                return (
                  <div className="mobile-card" key={inv.id} style={{ marginBottom: 10, borderRadius: 12, padding: '14px 16px' }}>
                    <div className="mobile-card-header">
                      <div>
                        <div className="mobile-card-title" style={{ fontWeight: 700 }}>Rp {fmt(inv.amount)}</div>
                        <div className="text-sm text-muted font-mono" style={{ marginTop: 2, fontSize: '0.72rem' }}>{inv.invoice_number}</div>
                      </div>
                      <span className={`badge badge-${s.badge}`}>{s.label}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Customer</span>
                      <span style={{ fontWeight: 500 }}>{inv.customer_name || '—'}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">Waktu</span>
                      <span className="text-sm text-muted">{new Date(inv.created_at).toLocaleString('id-ID')}</span>
                    </div>
                    <div className="mobile-card-actions">
                      <button
                        className="btn btn-sm"
                        style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}
                        onClick={() => openDetail(inv)}
                      >
                        <Eye size={13} /> Detail
                      </button>
                      {inv.status === 'pending' && inv.payment_url && (
                        <a
                          href={inv.payment_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="btn btn-sm"
                          style={{ background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)', display: 'inline-flex', alignItems: 'center', gap: 4, textDecoration: 'none' }}
                        >
                          <ExternalLink size={13} /> Buka
                        </a>
                      )}
                      {(inv.status === 'pending' || inv.status === 'user_confirmed') && (
                        <button
                          className="btn btn-sm"
                          style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}
                          onClick={() => setShareTarget(inv)}
                        >
                          <Share2 size={13} /> Bagikan
                        </button>
                      )}

                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* ── Create Invoice Modal ──────────────────────── */}
      {showCreate && (
        <div className="modal-overlay" onClick={() => { setShowCreate(false); setErrors({}) }}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Buat Invoice Baru</h3>
            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label className="form-label">Jumlah (Rp) *</label>
                <input type="text" className="form-input" placeholder="100.000" inputMode="numeric"
                  value={form.amount ? fmt(form.amount) : ''}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g, '')
                    setForm({ ...form, amount: raw })
                    setErrors({ ...errors, amount: null })
                  }}
                  required />
                {form.amount && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--accent)', marginTop: 4, fontWeight: 600 }}>
                    = Rp {fmt(form.amount)}
                  </div>
                )}
                {errors.amount && <span className="form-error">{errors.amount}</span>}
              </div>
              {canAddOwnChannel && (
                <div className="form-group">
                  <label className="form-label">Channel Pembayaran</label>
                  <select className="form-input" value={form.channel_preference}
                    onChange={e => handleChannelPrefChange(e.target.value)}>
                    <option value="platform">Channel Platform (Saya Bayar)</option>
                    <option value="client">Channel Saya</option>
                  </select>
                  <div className="text-sm text-muted" style={{ marginTop: 4 }}>
                    {form.channel_preference === 'client'
                      ? '✓ Dana masuk langsung ke rekening Anda'
                      : 'Dana masuk ke saldo → withdraw ke rekening Anda'}
                  </div>
                  {!hasOwnChannel && (
                    <div style={{ marginTop: 6, fontSize: '0.75rem', color: 'var(--warning)' }}>
                      ⚠ Belum ada channel aktif. <a href="/dashboard/channels" style={{ color: 'inherit', textDecoration: 'underline' }}>Tambahkan channel</a>
                    </div>
                  )}
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Customer Name</label>
                <input type="text" className="form-input" placeholder="Nama pelanggan" value={form.customer_name}
                  onChange={e => setForm({ ...form, customer_name: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Email</label>
                <input type="email" className="form-input" placeholder="email@customer.com" value={form.customer_email}
                  onChange={e => { setForm({ ...form, customer_email: e.target.value }); setErrors({ ...errors, customer_email: null }) }} />
                {errors.customer_email && <span className="form-error">{errors.customer_email}</span>}
              </div>
              <div className="form-group">
                <label className="form-label">Deskripsi</label>
                <input type="text" className="form-input" placeholder="Pembayaran untuk..." value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              {errors.submit && <div className="form-error-box">{errors.submit}</div>}
              <div className="modal-actions">
                <button type="button" className="btn btn-ghost" onClick={() => { setShowCreate(false); setErrors({}) }}>Batal</button>
                <button type="submit" className="btn btn-primary" disabled={creating}>
                  {creating ? 'Memproses...' : 'Buat Invoice'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Detail Invoice Modal ──────────────────────── */}
      {detailData && (
        <div className="modal-overlay" onClick={() => setDetailData(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Invoice</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailData(null)}><X size={18} /></button>
            </div>

            {detailData._loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><div className="spinner"></div></div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>Rp {fmt(detailData.amount)}</div>
                    {detailData.unique_code > 0 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        + digit verifikasi Rp {fmt(detailData.unique_code)} = <strong>Rp {fmt(detailData.amount_unique)}</strong>
                      </div>
                    )}
                  </div>
                  <span className={`badge badge-${getInvoiceStatus(detailData.status).badge}`}>
                    {getInvoiceStatus(detailData.status).label}
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem', marginBottom: 12 }}>
                  {[
                    ['Invoice', <span className="font-mono">{detailData.invoice_number}</span>],
                    detailData.customer_name && ['Customer', detailData.customer_name],
                    detailData.customer_email && ['Email', detailData.customer_email],
                    detailData.description && ['Deskripsi', detailData.description],
                    ['Sumber', <span className="badge badge-info" style={{ fontSize: '0.65rem' }}>{detailData.source || '-'}</span>],
                  ].filter(Boolean).map(([label, val], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginRight: 12 }}>{label}</span>
                      <span style={{ textAlign: 'right', fontWeight: 500 }}>{val}</span>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.65rem', marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Channel</div>
                    {detailData.payment_channel ? (
                      <div style={{ fontSize: '0.78rem' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{detailData.payment_channel.channel_type}</div>
                        <div style={{ fontWeight: 700, marginTop: 2 }}>{detailData.payment_channel.account_name}</div>
                        <div className="font-mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{detailData.payment_channel.account_number}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Belum dipilih</div>
                    )}
                  </div>
                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.65rem', marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Waktu</div>
                    <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>Dibuat: </span>{new Date(detailData.created_at).toLocaleString('id-ID')}</div>
                      {detailData.confirmed_at && <div><span style={{ color: 'var(--text-muted)' }}>Konfirmasi: </span>{new Date(detailData.confirmed_at).toLocaleString('id-ID')}</div>}
                      {detailData.paid_at && <div style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Dibayar: {new Date(detailData.paid_at).toLocaleString('id-ID')}</div>}
                      <div><span style={{ color: 'var(--text-muted)' }}>Expired: </span>{new Date(detailData.expired_at).toLocaleString('id-ID')}</div>
                    </div>
                  </div>
                </div>

                {detailData.transactions?.length > 0 && (
                  <div style={{ padding: 12, background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 12 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.65rem', marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Transaksi Terdeteksi</div>
                    {detailData.transactions.map(t => (
                      <div key={t.id} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: 2 }}>
                          <span style={{ fontWeight: 700 }}>Rp {fmt(t.amount)}</span>
                          <span className={`badge badge-${t.match_status === 'matched' ? 'success' : 'warning'}`} style={{ fontSize: '0.6rem' }}>{t.match_status}</span>
                        </div>
                        {t.raw_data?.payer_name && <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>Pengirim: {t.raw_data.payer_name}</div>}
                        {t.reference_number && <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Ref: {t.reference_number}</div>}
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Terdeteksi: {new Date(t.detected_at).toLocaleString('id-ID')}</div>
                        {t.raw_data && (
                          <details style={{ marginTop: 4 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.7rem', color: 'var(--accent)' }}>Raw Data</summary>
                            <pre style={{ fontSize: '0.65rem', marginTop: 4, padding: 8, borderRadius: 6, background: 'rgba(0,0,0,0.3)', overflow: 'auto', maxHeight: 150, color: 'var(--text-secondary)' }}>
                              {JSON.stringify(t.raw_data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 8 }}>
                  {(detailData.status === 'pending' || detailData.status === 'user_confirmed') && (
                    <button className="btn btn-danger" onClick={() => { setCancelTarget(detailData); setDetailData(null) }}>
                      <Ban size={14} /> Batalkan
                    </button>
                  )}
                  <button className="btn btn-ghost" onClick={() => setDetailData(null)}>Tutup</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmModal
        open={!!cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancel}
        title="Batalkan Invoice?"
        message={cancelTarget ? `Invoice ${cancelTarget.invoice_number} sebesar Rp ${fmt(cancelTarget.amount)} akan dibatalkan. Tindakan ini tidak bisa dikembalikan.` : ''}
        confirmText="Ya, Batalkan"
        loading={cancelling}
      />

      <ShareModal open={!!shareTarget} onClose={() => setShareTarget(null)} invoice={shareTarget} />
    </>
  )
}
