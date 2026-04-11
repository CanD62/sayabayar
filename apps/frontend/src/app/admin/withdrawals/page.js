'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { CheckCircle2, XCircle, Clock, AlertCircle, X } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_CONFIG = {
  pending:    { label: 'Pending',    cls: 'badge-warning' },
  processing: { label: 'Processing', cls: 'badge-info' },
  processed:  { label: 'Processed',  cls: 'badge-success' },
  failed:     { label: 'Gagal',      cls: 'badge-danger' },
  rejected:   { label: 'Ditolak',    cls: 'badge-danger' },
}

export default function AdminWithdrawalsPage() {
  const toast = useToast()
  const [withdrawals, setWithdrawals] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [rejectTarget, setRejectTarget] = useState(null)
  const [rejectReason, setRejectReason] = useState('')
  const [actionId, setActionId] = useState(null)
  const PER_PAGE = 20

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      const res = await api.get(`/v1/admin/withdrawals?${params}`)
      setWithdrawals(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1); setPage(1) }, [filterStatus])
  useEffect(() => { load(page) }, [page])

  const handleProcess = async (id) => {
    setActionId(id)
    try { await api.post(`/v1/admin/withdrawals/${id}/process`); toast.success('Withdrawal dijadwalkan untuk diproses'); load() }
    catch (e) { toast.error(e.message) }
    finally { setActionId(null) }
  }

  const handleReject = async () => {
    if (!rejectTarget) return
    setActionId(rejectTarget.id)
    try {
      await api.post(`/v1/admin/withdrawals/${rejectTarget.id}/reject`, { reason: rejectReason || 'Ditolak oleh admin' })
      toast.success('Withdrawal ditolak, saldo dikembalikan')
      setRejectTarget(null); setRejectReason(''); load()
    } catch (e) { toast.error(e.message) }
    finally { setActionId(null) }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Withdrawal</h1>
          <p className="page-subtitle">{total} total withdrawal</p>
        </div>
      </div>

      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['pending', 'Pending'], ['failed', 'Gagal'], ['processing', 'Processing'], ['processed', 'Selesai'], ['rejected', 'Ditolak']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} className={`btn btn-sm ${filterStatus === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
      </div>

      <AdminTable
        columns={[
          { key: 'merchant', label: 'Merchant' },
          { key: 'amount', label: 'Jumlah' },
          { key: 'destination', label: 'Tujuan' },
          { key: 'status', label: 'Status' },
          { key: 'requested', label: 'Tgl. Request' },
          { key: 'action', label: 'Aksi', width: 1 },
        ]}
        data={withdrawals}
        loading={loading}
        emptyText="Tidak ada withdrawal"
        cardTitle={(w) => {
          const s = STATUS_CONFIG[w.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 800, fontSize: '1rem' }}>Rp {fmt(w.amount_received)}</span>
              <span className={`badge ${s.cls}`}>{s.label}</span>
            </div>
          )
        }}
        cardAccent={(w) => w.status === 'processed' ? '#10b981' : w.status === 'pending' ? '#f59e0b' : '#ef4444'}
        renderRow={(w) => {
          const s = STATUS_CONFIG[w.status] || {}
          const canAct = ['pending', 'failed'].includes(w.status)
          return {
            cells: {
              merchant: (<><div style={{ fontWeight: 600 }}>{w.client_name}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.client_email}</div></>),
              amount: (<><div style={{ fontWeight: 700 }}>Rp {fmt(w.amount_received)}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Didebit: Rp {fmt(w.amount)}</div></>),
              destination: (<><div style={{ fontWeight: 600 }}>{w.destination_bank} {w.destination_account}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{w.destination_name}</div></>),
              status: (
                <>
                  <span className={`badge ${s.cls}`}>{s.label}</span>
                  {w.rejection_reason && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>"{w.rejection_reason}"</div>}
                  {w.flip_trx_id && <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>Flip: {w.flip_trx_id}</div>}
                </>
              ),
              requested: <span className="text-sm text-muted">{new Date(w.requested_at).toLocaleString('id-ID')}</span>,
              action: canAct ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
                  <button className="btn btn-sm" style={{ background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }} onClick={() => handleProcess(w.id)} disabled={actionId === w.id}>✓ Proses</button>
                  <button className="btn btn-sm" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }} onClick={() => setRejectTarget(w)} disabled={actionId === w.id}>✕ Tolak</button>
                </div>
              ) : null,
            },
            actions: canAct ? (
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-sm" style={{ flex: 1, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)', justifyContent: 'center' }} onClick={() => handleProcess(w.id)} disabled={actionId === w.id}>✓ Proses</button>
                <button className="btn btn-sm" style={{ flex: 1, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', justifyContent: 'center' }} onClick={() => setRejectTarget(w)} disabled={actionId === w.id}>✕ Tolak</button>
              </div>
            ) : null,
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />

      {/* Reject modal */}
      {rejectTarget && (
        <div className="modal-overlay" onClick={() => setRejectTarget(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 className="modal-title" style={{ margin: 0, color: '#ef4444' }}>Tolak Withdrawal</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setRejectTarget(null)}><X size={18} /></button>
            </div>
            <div style={{ padding: '12px 16px', background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, marginBottom: 16, fontSize: '0.82rem' }}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>Rp {fmt(rejectTarget.amount_received)} — {rejectTarget.client_name}</div>
              <div style={{ color: 'var(--text-muted)' }}>{rejectTarget.destination_bank} {rejectTarget.destination_account} a.n. {rejectTarget.destination_name}</div>
            </div>
            <div className="form-group">
              <label className="form-label">Alasan penolakan</label>
              <input type="text" className="form-input" placeholder="Rekening tidak valid, dll..." value={rejectReason} onChange={e => setRejectReason(e.target.value)} />
            </div>
            <div style={{ fontSize: '0.78rem', color: '#f59e0b', marginBottom: 16 }}>⚠ Saldo Rp {fmt(rejectTarget.amount)} akan dikembalikan ke merchant.</div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setRejectTarget(null)}>Batal</button>
              <button className="btn btn-danger" onClick={handleReject} disabled={!!actionId}>{actionId ? 'Memproses...' : 'Ya, Tolak & Kembalikan Saldo'}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
