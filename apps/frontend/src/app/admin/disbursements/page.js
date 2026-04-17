'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Send, RefreshCw, Check, X, AlertTriangle, Loader2, Clock, Ban, RotateCcw, TrendingUp, Coins, ArrowDown, Users, Search as SearchIcon } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_CONFIG = {
  pending:     { label: 'Pending',   cls: 'badge-warning' },
  processing:  { label: 'Proses',    cls: 'badge-info' },
  success:     { label: 'Berhasil',  cls: 'badge-success' },
  failed:      { label: 'Gagal',     cls: 'badge-danger' },
}

const DEPOSIT_STATUS = {
  pending:   { label: 'Pending',    cls: 'badge-warning' },
  confirmed: { label: 'Confirmed',  cls: 'badge-info' },
  done:      { label: 'Done',       cls: 'badge-success' },
  expired:   { label: 'Expired',    cls: 'badge-secondary' },
  failed:    { label: 'Gagal',      cls: 'badge-danger' },
}

// ═══════════════════════════════════════════════════
// TAB: Disbursements (existing)
// ═══════════════════════════════════════════════════
function DisbursementsTab() {
  const toast = useToast()
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [retryLoading, setRetryLoading] = useState(null)
  const [checkLoading, setCheckLoading] = useState(null)
  const PER_PAGE = 20

  const load = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      const res = await api.get(`/v1/admin/disbursements?${params}`)
      setData(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }, [page, filterStatus])

  useEffect(() => { load(1); setPage(1) }, [filterStatus])
  useEffect(() => { load(page) }, [page])

  const handleRetry = async (id) => {
    setRetryLoading(id)
    try {
      await api.post(`/v1/admin/disbursements/${id}/retry`)
      toast.success('Disbursement di-retry! 🔄')
      load()
    } catch (e) { toast.error(e.message) }
    finally { setRetryLoading(null) }
  }

  const handleCheckFlip = async (id) => {
    setCheckLoading(id)
    try {
      const res = await api.post(`/v1/admin/disbursements/${id}/check-flip`)
      if (res.data.flip_status === 'DONE') {
        toast.success(res.data.message || 'Verified DONE ✅')
      } else if (['CANCELLED', 'FAILED', 'REJECTED'].includes(res.data.flip_status)) {
        toast.error(res.data.message || `Flip: ${res.data.flip_status} — saldo di-refund`)
      } else {
        toast.info(res.data.message || `Status Flip: ${res.data.flip_status}`)
      }
      load(page)
    } catch (e) { toast.error(e.message) }
    finally { setCheckLoading(null) }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['pending', 'Pending'], ['processing', 'Proses'], ['success', 'Berhasil'], ['failed', 'Gagal']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} className={`btn btn-sm ${filterStatus === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
      </div>

      <AdminTable
        columns={[
          { key: 'client', label: 'Client' },
          { key: 'destination', label: 'Tujuan' },
          { key: 'amount', label: 'Nominal', hide: true },
          { key: 'status', label: 'Status' },
          { key: 'source', label: 'Source', hide: true },
          { key: 'date', label: 'Tanggal', hide: true },
          { key: 'action', label: '', width: 1 },
        ]}
        data={data}
        loading={loading}
        emptyText="Belum ada disbursement"
        cardTitle={(d) => {
          const sc = STATUS_CONFIG[d.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{d.destination_bank} — {d.destination_account}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{d.client_name}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '0.92rem' }}>Rp {fmt(d.amount)}</div>
                <span className={`badge ${sc.cls}`} style={{ marginTop: 2 }}>{sc.label}</span>
              </div>
            </div>
          )
        }}
        cardAccent={(d) => d.status === 'success' ? '#10b981' : d.status === 'failed' ? '#ef4444' : d.status === 'processing' ? '#3b82f6' : '#f59e0b'}
        renderRow={(d) => {
          const sc = STATUS_CONFIG[d.status] || {}
          return {
            cells: {
              client: (<><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{d.client_name}</div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{d.client_email}</div></>),
              destination: (<><div className="font-mono" style={{ fontWeight: 600, fontSize: '0.85rem' }}>{d.destination_bank} — {d.destination_account}</div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{d.destination_name}</div></>),
              amount: (<><div style={{ fontWeight: 700, fontFamily: 'monospace' }}>Rp {fmt(d.amount)}</div><div style={{ fontSize: '0.68rem', color: '#f59e0b' }}>+Rp {fmt(d.fee)} fee</div></>),
              status: (
                <div>
                  <span className={`badge ${sc.cls}`}>{sc.label}</span>
                  {d.failure_reason && <div style={{ fontSize: '0.65rem', color: '#ef4444', marginTop: 2, maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.failure_reason}>{d.failure_reason}</div>}
                </div>
              ),
              source: <span className="badge badge-secondary" style={{ fontSize: '0.68rem' }}>{d.source}</span>,
              date: (<><div style={{ fontSize: '0.78rem' }}>{new Date(d.created_at).toLocaleDateString('id-ID')}</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{new Date(d.created_at).toLocaleTimeString('id-ID')}</div></>),
              action: (
                <div style={{ display: 'flex', gap: 4 }}>
                  {d.flip_trx_id && (
                    <button className="btn btn-sm btn-ghost" onClick={() => handleCheckFlip(d.id)} disabled={checkLoading === d.id}
                      style={{ color: '#3b82f6', whiteSpace: 'nowrap' }}>
                      {checkLoading === d.id ? <Loader2 size={12} className="spin" /> : <SearchIcon size={12} />} Cek Flip
                    </button>
                  )}
                  {d.status === 'failed' && (
                    <button className="btn btn-sm btn-ghost" onClick={() => handleRetry(d.id)} disabled={retryLoading === d.id} style={{ color: '#f59e0b' }}>
                      {retryLoading === d.id ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} Retry
                    </button>
                  )}
                </div>
              ),
            },
            actions: (
              <div style={{ display: 'flex', gap: 6, width: '100%' }}>
                {d.flip_trx_id && (
                  <button className="btn btn-sm" onClick={() => handleCheckFlip(d.id)} disabled={checkLoading === d.id}
                    style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', flex: 1, justifyContent: 'center' }}>
                    {checkLoading === d.id ? <Loader2 size={12} className="spin" /> : <SearchIcon size={12} />} Cek Flip
                  </button>
                )}
                {d.status === 'failed' && (
                  <button className="btn btn-sm" onClick={() => handleRetry(d.id)} disabled={retryLoading === d.id}
                    style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)', flex: 1, justifyContent: 'center' }}>
                    {retryLoading === d.id ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} Retry
                  </button>
                )}
              </div>
            ),
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}

// ═══════════════════════════════════════════════════
// TAB: Deposits (new)
// ═══════════════════════════════════════════════════
function DepositsTab() {
  const toast = useToast()
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [checkLoading, setCheckLoading] = useState(null)
  const PER_PAGE = 20

  const load = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      const res = await api.get(`/v1/admin/deposits?${params}`)
      setData(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }, [page, filterStatus])

  useEffect(() => { load(1); setPage(1) }, [filterStatus])
  useEffect(() => { load(page) }, [page])

  const handleCheckFlip = async (id) => {
    setCheckLoading(id)
    try {
      const res = await api.post(`/v1/admin/deposits/${id}/check-flip`)
      if (res.data.status === 'done') {
        toast.success(res.data.message || 'Deposit berhasil diproses! ✅')
      } else {
        toast.info(res.data.message || `Status Flip: ${res.data.flip_status}`)
      }
      load(page)
    } catch (e) {
      toast.error(e.message || 'Gagal cek Flip')
    } finally {
      setCheckLoading(null)
    }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['pending', 'Pending'], ['confirmed', 'Confirmed'], ['done', 'Done'], ['expired', 'Expired'], ['failed', 'Gagal']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} className={`btn btn-sm ${filterStatus === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
      </div>

      <AdminTable
        columns={[
          { key: 'client', label: 'Client' },
          { key: 'amount', label: 'Nominal' },
          { key: 'bank', label: 'Bank', hide: true },
          { key: 'flip_id', label: 'Flip ID', hide: true },
          { key: 'status', label: 'Status' },
          { key: 'date', label: 'Tanggal', hide: true },
          { key: 'action', label: '', width: 1 },
        ]}
        data={data}
        loading={loading}
        emptyText="Belum ada deposit"
        cardTitle={(d) => {
          const sc = DEPOSIT_STATUS[d.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{d.client_name}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{d.sender_bank?.toUpperCase()} · {d.flip_topup_id || '-'}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 800, fontFamily: 'monospace', fontSize: '0.92rem' }}>Rp {fmt(d.amount)}</div>
                <span className={`badge ${sc.cls}`} style={{ marginTop: 2 }}>{sc.label}</span>
              </div>
            </div>
          )
        }}
        cardAccent={(d) => d.status === 'done' ? '#10b981' : d.status === 'confirmed' ? '#3b82f6' : d.status === 'pending' ? '#f59e0b' : '#6b7280'}
        renderRow={(d) => {
          const sc = DEPOSIT_STATUS[d.status] || {}
          const canCheck = ['pending', 'confirmed'].includes(d.status) && d.flip_topup_id
          return {
            cells: {
              client: (<><div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{d.client_name}</div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{d.client_email}</div></>),
              amount: (
                <div>
                  <div style={{ fontWeight: 700, fontFamily: 'monospace' }}>Rp {fmt(d.amount)}</div>
                  {d.unique_code > 0 && <div style={{ fontSize: '0.68rem', color: '#f59e0b' }}>+{d.unique_code} kode unik</div>}
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>Transfer: Rp {fmt(d.total_transfer)}</div>
                </div>
              ),
              bank: <span style={{ fontWeight: 600, fontSize: '0.85rem', textTransform: 'uppercase' }}>{d.sender_bank}</span>,
              flip_id: <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{d.flip_topup_id || '-'}</span>,
              status: <span className={`badge ${sc.cls}`}>{sc.label}</span>,
              date: (<><div style={{ fontSize: '0.78rem' }}>{new Date(d.created_at).toLocaleDateString('id-ID')}</div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{new Date(d.created_at).toLocaleTimeString('id-ID')}</div></>),
              action: canCheck ? (
                <button className="btn btn-sm btn-ghost" onClick={() => handleCheckFlip(d.id)} disabled={checkLoading === d.id}
                  style={{ color: '#3b82f6', whiteSpace: 'nowrap' }}>
                  {checkLoading === d.id ? <Loader2 size={12} className="spin" /> : <SearchIcon size={12} />} Cek Flip
                </button>
              ) : null,
            },
            actions: canCheck ? (
              <button className="btn btn-sm" onClick={() => handleCheckFlip(d.id)} disabled={checkLoading === d.id}
                style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)', width: '100%', justifyContent: 'center' }}>
                {checkLoading === d.id ? <Loader2 size={12} className="spin" /> : <SearchIcon size={12} />} Cek Status Flip
              </button>
            ) : null,
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}

// ═══════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════
export default function AdminDisbursementsPage() {
  const [tab, setTab] = useState('disbursements')
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.get('/v1/admin/disbursements/stats').then(r => setStats(r.data)).catch(() => {})
  }, [])

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Disbursement Monitor</h1>
          <p className="page-subtitle">Kelola disbursement dan deposit user</p>
        </div>
        <button onClick={() => api.get('/v1/admin/disbursements/stats').then(r => setStats(r.data))} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div className="card" style={{ padding: '16px 18px', background: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05))' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(99,102,241,0.15)', color: '#818cf8', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><TrendingUp size={14} /></div>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Revenue Platform</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.2rem', color: '#818cf8', fontFamily: 'monospace' }}>Rp {fmt(stats.platform_revenue)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>Kode unik + biaya transfer</div>
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Coins size={14} /></div>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Kode Unik</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#f59e0b', fontFamily: 'monospace' }}>Rp {fmt(stats.deposits.unique_code_revenue)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{stats.deposits.done} deposit selesai</div>
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(16,185,129,0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Send size={14} /></div>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Biaya Transfer</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#10b981', fontFamily: 'monospace' }}>Rp {fmt(stats.disbursements.fee_revenue)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{stats.disbursements.success} berhasil · Rp {fmt(stats.disbursements.total_disbursed)} disbursed</div>
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(16,185,129,0.15)', color: '#10b981', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><ArrowDown size={14} /></div>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Deposit</span>
            </div>
            <div style={{ fontWeight: 800, fontSize: '1.1rem', color: 'var(--text-primary)', fontFamily: 'monospace' }}>Rp {fmt(stats.deposits.total_deposited)}</div>
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>{stats.deposits.total} request deposit</div>
          </div>

          <div className="card" style={{ padding: '16px 18px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: 'rgba(139,92,246,0.15)', color: '#a78bfa', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Users size={14} /></div>
              <span style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</span>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 2 }}>
              <span style={{ fontSize: '0.75rem' }}><span style={{ fontWeight: 800, color: '#f59e0b' }}>{stats.disbursements.pending}</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>pending</span></span>
              <span style={{ fontSize: '0.75rem' }}><span style={{ fontWeight: 800, color: '#ef4444' }}>{stats.disbursements.failed}</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>gagal</span></span>
              <span style={{ fontSize: '0.75rem' }}><span style={{ fontWeight: 800, color: '#a78bfa' }}>{stats.active_users}</span> <span style={{ color: 'var(--text-muted)', fontSize: '0.65rem' }}>user</span></span>
            </div>
          </div>
        </div>
      )}

      {/* Tab Switcher */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {[
          { key: 'disbursements', label: 'Disbursements', icon: <Send size={13} /> },
          { key: 'deposits', label: 'Deposits', icon: <ArrowDown size={13} /> },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '10px 18px', fontSize: '0.82rem', fontWeight: tab === t.key ? 700 : 500,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.key ? 'var(--color-primary)' : 'var(--text-muted)',
              borderBottom: tab === t.key ? '2px solid var(--color-primary)' : '2px solid transparent',
              marginBottom: -1, transition: 'all 0.15s',
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {tab === 'disbursements' && <DisbursementsTab />}
      {tab === 'deposits' && <DepositsTab />}
    </>
  )
}
