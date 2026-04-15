'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Send, RefreshCw, Check, X, AlertTriangle, Loader2, Clock, Ban, RotateCcw, TrendingUp, Coins, ArrowDown, Users } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_CONFIG = {
  pending:     { label: 'Pending',   cls: 'badge-warning' },
  processing:  { label: 'Proses',    cls: 'badge-info' },
  success:     { label: 'Berhasil',  cls: 'badge-success' },
  failed:      { label: 'Gagal',     cls: 'badge-danger' },
}

export default function AdminDisbursementsPage() {
  const toast = useToast()
  const [data, setData] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [retryLoading, setRetryLoading] = useState(null)
  const [stats, setStats] = useState(null)
  const PER_PAGE = 20

  const loadStats = useCallback(async () => {
    try {
      const res = await api.get('/v1/admin/disbursements/stats')
      setStats(res.data)
    } catch {}
  }, [])

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

  useEffect(() => { loadStats() }, [])
  useEffect(() => { load(1); setPage(1) }, [filterStatus])
  useEffect(() => { load(page) }, [page])

  const handleRetry = async (id) => {
    setRetryLoading(id)
    try {
      await api.post(`/v1/admin/disbursements/${id}/retry`)
      toast.success('Disbursement di-retry! 🔄')
      load(); loadStats()
    } catch (e) { toast.error(e.message) }
    finally { setRetryLoading(null) }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Disbursement Monitor</h1>
          <p className="page-subtitle">{total} disbursement{filterStatus ? ` (${filterStatus})` : ''}</p>
        </div>
        <button onClick={() => { load(page); loadStats() }} className="btn btn-ghost btn-sm"><RefreshCw size={14} /> Refresh</button>
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

      {/* Filters */}
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
              action: d.status === 'failed' ? (
                <button className="btn btn-sm btn-ghost" onClick={() => handleRetry(d.id)} disabled={retryLoading === d.id} style={{ color: '#f59e0b' }}>
                  {retryLoading === d.id ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} Retry
                </button>
              ) : null,
            },
            actions: d.status === 'failed' ? (
              <button className="btn btn-sm" onClick={() => handleRetry(d.id)} disabled={retryLoading === d.id}
                style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)', width: '100%', justifyContent: 'center' }}>
                {retryLoading === d.id ? <Loader2 size={12} className="spin" /> : <RotateCcw size={12} />} Retry Disbursement
              </button>
            ) : null,
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}
