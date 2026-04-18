'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { X, Search, Eye, ExternalLink } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_BADGE = {
  pending:        { label: 'Pending',    cls: 'badge-warning' },
  user_confirmed: { label: 'Konfirmasi', cls: 'badge-info' },
  paid:           { label: 'Lunas',      cls: 'badge-success' },
  expired:        { label: 'Expired',    cls: 'badge-danger' },
  cancelled:      { label: 'Batal',      cls: 'badge-danger' },
}

export default function AdminInvoicesPage() {
  const [invoices, setInvoices] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchInvoice, setSearchInvoice] = useState('')
  const [detailData, setDetailData] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const PER_PAGE = 20

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (searchInvoice.trim()) params.set('invoice_number', searchInvoice.trim())
      const res = await api.get(`/v1/admin/invoices?${params}`)
      setInvoices(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1); setPage(1) }, [filterStatus, dateFrom, dateTo, searchInvoice])
  useEffect(() => { load(page) }, [page])

  const openDetail = async (inv) => {
    setDetailLoading(true)
    setDetailData({ ...inv, _loading: true })
    try {
      const res = await api.get(`/v1/admin/invoices/${inv.id}`)
      setDetailData(res.data)
    } catch {
      setDetailData({ ...inv, _error: true })
    } finally {
      setDetailLoading(false)
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE)
  const totalVolume = invoices.filter(i => i.status === 'paid').reduce((s, i) => s + i.amount, 0)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoice</h1>
          <p className="page-subtitle">{total} invoice {filterStatus && `— filter: ${filterStatus}`}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="admin-filter-bar">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer', minWidth: 0 }}>
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="user_confirmed">Konfirmasi</option>
          <option value="paid">Lunas</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Batal</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <div style={{ position: 'relative', flex: '1 1 180px', minWidth: 0 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input type="text" placeholder="Cari invoice..." value={searchInvoice} onChange={e => setSearchInvoice(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: searchInvoice ? 30 : 10, paddingTop: 8, paddingBottom: 8, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', fontFamily: 'var(--font-sans)' }} />
          {searchInvoice && <button onClick={() => setSearchInvoice('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={12} /></button>}
        </div>
        {(filterStatus || dateFrom || dateTo || searchInvoice) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterStatus(''); setDateFrom(''); setDateTo(''); setSearchInvoice('') }}><X size={12} /> Reset</button>
        )}
        {totalVolume > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 700, whiteSpace: 'nowrap' }}>
            Volume: Rp {fmt(totalVolume)}
          </span>
        )}
      </div>

      <AdminTable
        columns={[
          { key: 'invoice', label: '#Invoice' },
          { key: 'merchant', label: 'Merchant' },
          { key: 'customer', label: 'Customer', hide: true },
          { key: 'amount', label: 'Nominal' },
          { key: 'channel', label: 'Channel', hide: true },
          { key: 'status', label: 'Status' },
          { key: 'created', label: 'Dibuat' },
          { key: 'action', label: '', hide: true },
        ]}
        data={invoices}
        loading={loading}
        emptyText="Tidak ada invoice"
        cardTitle={(inv) => {
          const sb = STATUS_BADGE[inv.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '1rem' }}>Rp {fmt(inv.amount)}</span>
              <span className={`badge ${sb.cls}`}>{sb.label}</span>
            </div>
          )
        }}
        cardAccent={(inv) => inv.status === 'paid' ? '#10b981' : inv.status === 'expired' ? '#ef4444' : inv.status === 'pending' ? '#f59e0b' : '#6366f1'}
        renderRow={(inv) => {
          const sb = STATUS_BADGE[inv.status] || {}
          return {
            onClick: () => openDetail(inv),
            cells: {
              invoice: (
                <>
                  <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{inv.invoice_number}</span>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{inv.source} · {inv.channel_preference}</div>
                </>
              ),
              merchant: (
                <>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{inv.client_name}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{inv.client_email}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                    Plan: {inv.client_plan_name || 'Free'}
                  </div>
                </>
              ),
              customer: inv.customer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>,
              amount: (
                <div>
                  <span style={{ fontWeight: 700 }}>Rp {fmt(inv.amount)}</span>
                  {inv.unique_code > 0 && <div style={{ fontSize: '0.65rem', color: '#f59e0b' }}>+{inv.unique_code} kode unik</div>}
                </div>
              ),
              channel: (
                <>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{inv.channel_type || '—'}</span>
                  {inv.channel_account && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{inv.channel_account}</div>}
                </>
              ),
              status: <span className={`badge ${sb.cls}`}>{sb.label}</span>,
              created: <span className="text-sm text-muted">{new Date(inv.created_at).toLocaleString('id-ID')}</span>,
              action: (
                <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }}
                  onClick={(e) => { e.stopPropagation(); openDetail(inv) }}>
                  <Eye size={13} /> Detail
                </button>
              ),
            }
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />

      {/* Detail Invoice Modal */}
      {detailData && (
        <div className="modal-overlay" onClick={() => setDetailData(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Invoice</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setDetailData(null)}><X size={18} /></button>
            </div>

            {detailData._loading ? (
              <div style={{ textAlign: 'center', padding: 32 }}><div className="spinner"></div></div>
            ) : (
              <>
                {/* Amount Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, padding: '12px 16px', background: 'var(--bg-card-hover)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: '1.3rem', fontWeight: 800 }}>Rp {fmt(detailData.amount)}</div>
                    {detailData.unique_code > 0 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                        + kode unik Rp {fmt(detailData.unique_code)} = <strong>Rp {fmt(detailData.amount_unique)}</strong>
                      </div>
                    )}
                  </div>
                  <span className={`badge ${(STATUS_BADGE[detailData.status] || {}).cls}`}>
                    {(STATUS_BADGE[detailData.status] || {}).label || detailData.status}
                  </span>
                </div>

                {/* Info Rows */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.82rem', marginBottom: 12 }}>
                  {[
                    ['Invoice', <span key="inv" className="font-mono">{detailData.invoice_number}</span>],
                    [
                      'Merchant',
                      <span key="m">
                        {detailData.client_name} <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>({detailData.client_email})</span>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                          Plan: {detailData.client_plan_name || 'Free'}
                        </div>
                      </span>
                    ],
                    detailData.customer_name && ['Customer', detailData.customer_name],
                    detailData.customer_email && ['Email Customer', detailData.customer_email],
                    detailData.description && ['Deskripsi', detailData.description],
                    ['Sumber', <span key="s" className="badge badge-info" style={{ fontSize: '0.65rem' }}>{detailData.source || '-'}</span>],
                    ['Preferensi', detailData.channel_preference],
                    detailData.redirect_url && ['Redirect URL', <span key="r" className="font-mono" style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}>{detailData.redirect_url}</span>],
                    detailData.payment_url && ['Payment URL', <a key="p" href={detailData.payment_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.72rem', color: 'var(--accent)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><ExternalLink size={11} /> Buka</a>],
                  ].filter(Boolean).map(([label, val], i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <span style={{ color: 'var(--text-muted)', flexShrink: 0, marginRight: 12 }}>{label}</span>
                      <span style={{ textAlign: 'right', fontWeight: 500 }}>{val}</span>
                    </div>
                  ))}
                </div>

                {/* Channel + Timing */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                  <div style={{ padding: 12, background: 'var(--bg-card-hover)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.65rem', marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Channel</div>
                    {detailData.payment_channel ? (
                      <div style={{ fontSize: '0.78rem' }}>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{detailData.payment_channel.channel_type} ({detailData.payment_channel.channel_owner})</div>
                        <div style={{ fontWeight: 700, marginTop: 2 }}>{detailData.payment_channel.account_name}</div>
                        <div className="font-mono" style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>{detailData.payment_channel.account_number}</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Belum dipilih</div>
                    )}
                  </div>
                  <div style={{ padding: 12, background: 'var(--bg-card-hover)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 700, fontSize: '0.65rem', marginBottom: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Waktu</div>
                    <div style={{ fontSize: '0.75rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div><span style={{ color: 'var(--text-muted)' }}>Dibuat: </span>{new Date(detailData.created_at).toLocaleString('id-ID')}</div>
                      {detailData.confirmed_at && <div><span style={{ color: 'var(--text-muted)' }}>Konfirmasi: </span>{new Date(detailData.confirmed_at).toLocaleString('id-ID')}</div>}
                      {detailData.paid_at && <div style={{ color: 'var(--success)', fontWeight: 600 }}>✓ Dibayar: {new Date(detailData.paid_at).toLocaleString('id-ID')}</div>}
                      <div><span style={{ color: 'var(--text-muted)' }}>Expired: </span>{new Date(detailData.expired_at).toLocaleString('id-ID')}</div>
                    </div>
                  </div>
                </div>

                {/* Transactions */}
                {detailData.transactions?.length > 0 && (
                  <div style={{ padding: 12, background: 'var(--bg-card-hover)', borderRadius: 10, border: '1px solid var(--border)', marginBottom: 12 }}>
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
                            <pre style={{ fontSize: '0.65rem', marginTop: 4, padding: 8, borderRadius: 6, background: 'var(--bg-primary)', overflow: 'auto', maxHeight: 150, color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                              {JSON.stringify(t.raw_data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                <div className="modal-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-ghost" onClick={() => setDetailData(null)}>Tutup</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
