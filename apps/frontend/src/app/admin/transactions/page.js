'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { X, Link2, AlertTriangle, Search } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_CONFIG = {
  matched:   { label: 'Matched',   cls: 'badge-success' },
  unmatched: { label: 'Unmatched', cls: 'badge-warning' },
  manual:    { label: 'Manual',    cls: 'badge-danger' },
  duplicate: { label: 'Duplicate', cls: 'badge-info' },
}

export default function AdminTransactionsPage() {
  const toast = useToast()
  const [transactions, setTransactions] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchAmount, setSearchAmount] = useState('')
  const [matchTarget, setMatchTarget] = useState(null)
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [matchLoading, setMatchLoading] = useState(false)
  const PER_PAGE = 20

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('match_status', filterStatus)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      if (searchAmount) params.set('amount', searchAmount)
      const res = await api.get(`/v1/admin/transactions?${params}`)
      setTransactions(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1); setPage(1) }, [filterStatus, dateFrom, dateTo, searchAmount])
  useEffect(() => { load(page) }, [page])

  const handleMatch = async () => {
    if (!matchTarget || !invoiceSearch.trim()) return
    setMatchLoading(true)
    try {
      const res = await api.patch(`/v1/admin/transactions/${matchTarget.id}/match`, { invoice_number: invoiceSearch.trim() })
      toast.success(res.data.message)
      setMatchTarget(null); setInvoiceSearch(''); load()
    } catch (e) { toast.error(e.response?.data?.error?.message || e.message) }
    finally { setMatchLoading(false) }
  }

  const totalPages = Math.ceil(total / PER_PAGE)
  const manualCount = transactions.filter(t => t.match_status === 'manual').length
  const unmatchedCount = transactions.filter(t => t.match_status === 'unmatched').length

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Transaksi</h1>
          <p className="page-subtitle">{total} transaksi terdeteksi</p>
        </div>
      </div>

      {(manualCount > 0 || unmatchedCount > 0) && (
        <div className="admin-badges">
          {unmatchedCount > 0 && (
            <div className="admin-badge" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b' }}>
              {unmatchedCount} Unmatched
            </div>
          )}
          {manualCount > 0 && (
            <div className="admin-badge" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}>
              <AlertTriangle size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {manualCount} Review
            </div>
          )}
        </div>
      )}

      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['matched', 'Matched'], ['unmatched', 'Unmatched'], ['manual', 'Manual'], ['duplicate', 'Duplicate']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} className={`btn btn-sm ${filterStatus === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <div style={{ position: 'relative', minWidth: 130 }}>
          <Search size={13} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input type="number" placeholder="Cari nominal..." value={searchAmount} onChange={e => setSearchAmount(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 30, paddingRight: 10, paddingTop: 8, paddingBottom: 8, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', fontFamily: 'var(--font-sans)' }} />
        </div>
        {(filterStatus || dateFrom || dateTo || searchAmount) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterStatus(''); setDateFrom(''); setDateTo(''); setSearchAmount('') }}><X size={12} /> Reset</button>
        )}
      </div>

      <AdminTable
        columns={[
          { key: 'ref', label: 'Reference' },
          { key: 'amount', label: 'Nominal' },
          { key: 'channel', label: 'Channel' },
          { key: 'status', label: 'Status' },
          { key: 'invoice', label: 'Invoice' },
          { key: 'attempt', label: 'Attempt', hide: true },
          { key: 'detected', label: 'Terdeteksi' },
          { key: 'action', label: 'Aksi', width: 1 },
        ]}
        data={transactions}
        loading={loading}
        emptyText="Tidak ada transaksi"
        cardTitle={(tx) => {
          const s = STATUS_CONFIG[tx.match_status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '1rem' }}>Rp {fmt(tx.amount)}</span>
              <span className={`badge ${s.cls}`}>{s.label}</span>
            </div>
          )
        }}
        cardAccent={(tx) => tx.match_status === 'matched' ? '#10b981' : tx.match_status === 'manual' ? '#ef4444' : tx.match_status === 'unmatched' ? '#f59e0b' : '#6366f1'}
        renderRow={(tx) => {
          const s = STATUS_CONFIG[tx.match_status] || {}
          return {
            cells: {
              ref: <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{tx.reference_number || tx.id.slice(0, 8) + '...'}</span>,
              amount: <span style={{ fontWeight: 700 }}>Rp {fmt(tx.amount)}</span>,
              channel: (<><div style={{ fontSize: '0.78rem' }}>{tx.channel_type || '—'}</div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{tx.channel_account}</div></>),
              status: <span className={`badge ${s.cls}`}>{s.label}</span>,
              invoice: tx.invoice_number ? <span className="font-mono" style={{ fontSize: '0.75rem', color: '#10b981' }}>{tx.invoice_number}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>,
              attempt: tx.match_attempt,
              detected: <span className="text-sm text-muted">{new Date(tx.detected_at).toLocaleString('id-ID')}</span>,
              action: ['unmatched', 'manual'].includes(tx.match_status) ? (
                <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }} onClick={() => { setMatchTarget(tx); setInvoiceSearch('') }}>
                  <Link2 size={12} /> Match
                </button>
              ) : null,
            },
            actions: ['unmatched', 'manual'].includes(tx.match_status) ? (
              <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', width: '100%', justifyContent: 'center' }} onClick={() => { setMatchTarget(tx); setInvoiceSearch('') }}>
                <Link2 size={12} /> Manual Match
              </button>
            ) : null,
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />

      {/* Manual Match Modal */}
      {matchTarget && (
        <div className="modal-overlay" onClick={() => setMatchTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Manual Match</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setMatchTarget(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: '12px 16px', background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 10, marginBottom: 16, fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Rp {fmt(matchTarget.amount)}</div>
              <div style={{ color: 'var(--text-muted)' }}>Ref: {matchTarget.reference_number || '—'} · {matchTarget.channel_type}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Nomor Invoice</label>
              <input type="text" className="form-input" placeholder="Ketik nomor invoice, e.g. INV-..." value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} autoFocus />
              <p style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>Invoice harus berstatus pending.</p>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginBottom: 16 }}>⚠ Proses ini tidak bisa dibatalkan.</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setMatchTarget(null)}>Batal</button>
              <button className="btn btn-primary" onClick={handleMatch} disabled={matchLoading || !invoiceSearch.trim()} style={{ gap: 8 }}>
                {matchLoading ? 'Memproses...' : <><Link2 size={14} /> Match</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
