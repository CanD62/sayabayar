'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { ShieldCheck, Eye, Check, X, AlertTriangle, Loader2, ChevronRight, Clock, Ban } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_BADGE = {
  pending:  { label: 'Menunggu', cls: 'badge-warning' },
  approved: { label: 'Approved', cls: 'badge-success' },
  rejected: { label: 'Ditolak',  cls: 'badge-danger' },
}

export default function AdminKycPage() {
  const toast = useToast()
  const [docs, setDocs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('pending')
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [showRejectForm, setShowRejectForm] = useState(false)
  const PER_PAGE = 20

  const load = useCallback(async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      const res = await api.get(`/v1/admin/kyc?${params}`)
      setDocs(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }, [page, filterStatus])

  useEffect(() => { load(1); setPage(1) }, [filterStatus])
  useEffect(() => { load(page) }, [page])

  const openDetail = async (doc) => {
    setDetailLoading(true)
    setSelected({ ...doc, _loading: true })
    setShowRejectForm(false)
    setRejectReason('')
    try {
      const res = await api.get(`/v1/admin/kyc/${doc.id}`)
      setSelected(res.data)
    } catch { setSelected(null) }
    finally { setDetailLoading(false) }
  }

  const handleApprove = async () => {
    if (!selected) return
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/kyc/${selected.id}/approve`)
      toast.success('KYC berhasil di-approve! ✓')
      setSelected(null)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setActionLoading(false) }
  }

  const handleReject = async () => {
    if (!selected || !rejectReason || rejectReason.length < 5) {
      toast.error('Alasan penolakan harus diisi (min 5 karakter)')
      return
    }
    setActionLoading(true)
    try {
      await api.post(`/v1/admin/kyc/${selected.id}/reject`, { reason: rejectReason })
      toast.success('KYC ditolak')
      setSelected(null)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setActionLoading(false) }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">KYC Review</h1>
          <p className="page-subtitle">{total} submission{filterStatus ? ` (${filterStatus})` : ''}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['pending', 'Menunggu'], ['approved', 'Approved'], ['rejected', 'Ditolak'], ['', 'Semua']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} className={`btn btn-sm ${filterStatus === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
      </div>

      <AdminTable
        columns={[
          { key: 'client', label: 'Merchant' },
          { key: 'full_name', label: 'Nama KTP' },
          { key: 'ktp_number', label: 'NIK', hide: true },
          { key: 'status', label: 'Status' },
          { key: 'created', label: 'Tanggal', hide: true },
          { key: 'action', label: '', width: 1 },
        ]}
        data={docs}
        loading={loading}
        emptyText="Tidak ada submission KYC"
        cardTitle={(d) => {
          const sb = STATUS_BADGE[d.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700 }}>{d.client_name}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{d.client_email}</div>
              </div>
              <span className={`badge ${sb.cls}`}>{sb.label}</span>
            </div>
          )
        }}
        cardAccent={(d) => d.status === 'pending' ? '#f59e0b' : d.status === 'approved' ? '#10b981' : '#ef4444'}
        renderRow={(d) => {
          const sb = STATUS_BADGE[d.status] || {}
          return {
            cells: {
              client: (<><div style={{ fontWeight: 600 }}>{d.client_name}</div><div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{d.client_email}</div></>),
              full_name: <span style={{ fontWeight: 600 }}>{d.full_name}</span>,
              ktp_number: <span className="font-mono" style={{ fontSize: '0.78rem' }}>{d.ktp_number}</span>,
              status: <span className={`badge ${sb.cls}`}>{sb.label}</span>,
              created: new Date(d.created_at).toLocaleDateString('id-ID'),
              action: (
                <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }} onClick={() => openDetail(d)}>
                  <Eye size={13} /> Review
                </button>
              ),
            },
            actions: (
              <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', width: '100%', justifyContent: 'center' }} onClick={() => openDetail(d)}>
                <Eye size={13} /> Review Detail
              </button>
            ),
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />

      {/* Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, maxHeight: '95vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={18} style={{ color: '#6366f1' }} /> Detail KYC
              </h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>

            {selected._loading || detailLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : (
              <>
                {/* Client info */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {[
                    ['Merchant', selected.client_name],
                    ['Email', selected.client_email],
                    ['Nama KTP', selected.full_name],
                    ['NIK', selected.ktp_number],
                    ['Status', <span key="s" className={`badge ${STATUS_BADGE[selected.status]?.cls}`}>{STATUS_BADGE[selected.status]?.label}</span>],
                    ['Diajukan', new Date(selected.created_at).toLocaleString('id-ID')],
                  ].map(([label, val], i) => (
                    <div key={i} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: '0.82rem' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 600 }}>{val}</div>
                    </div>
                  ))}
                </div>

                {/* Images */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Foto KTP</div>
                    {selected.ktp_image_url ? (
                      <a href={selected.ktp_image_url} target="_blank" rel="noopener noreferrer">
                        <img src={selected.ktp_image_url} alt="KTP" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', cursor: 'zoom-in' }} />
                      </a>
                    ) : (
                      <div style={{ padding: '32px 16px', textAlign: 'center', borderRadius: 10, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        Foto tidak tersedia
                      </div>
                    )}
                  </div>
                  <div>
                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>Foto Selfie</div>
                    {selected.selfie_image_url ? (
                      <a href={selected.selfie_image_url} target="_blank" rel="noopener noreferrer">
                        <img src={selected.selfie_image_url} alt="Selfie" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--border)', cursor: 'zoom-in' }} />
                      </a>
                    ) : (
                      <div style={{ padding: '32px 16px', textAlign: 'center', borderRadius: 10, border: '1px dashed var(--border)', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                        Foto tidak tersedia
                      </div>
                    )}
                  </div>
                </div>

                {/* Checklist reminder */}
                {selected.status === 'pending' && (
                  <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.15)', fontSize: '0.78rem', color: '#f59e0b' }}>
                    <strong>Verifikasi:</strong> Pastikan selfie menampilkan kertas dengan tulisan "SAYABAYAR.COM", tanggal hari ini, dan tanda tangan.
                  </div>
                )}

                {/* Rejection reason if rejected */}
                {selected.status === 'rejected' && selected.rejection_reason && (
                  <div style={{ padding: '12px 16px', borderRadius: 10, marginBottom: 16, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', fontSize: '0.82rem', color: '#ef4444' }}>
                    <strong>Alasan penolakan:</strong> {selected.rejection_reason}
                  </div>
                )}

                {/* Actions */}
                {selected.status === 'pending' && (
                  <div className="modal-actions">
                    {showRejectForm ? (
                      <div style={{ width: '100%' }}>
                        <label style={{ display: 'block', fontSize: '0.72rem', fontWeight: 600, color: 'var(--text-muted)', marginBottom: 6 }}>Alasan Penolakan</label>
                        <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} placeholder="Jelaskan alasan penolakan (min 5 karakter)..."
                          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minHeight: 80, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, justifyContent: 'flex-end' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setShowRejectForm(false)}>Batal</button>
                          <button className="btn btn-danger btn-sm" onClick={handleReject} disabled={actionLoading || rejectReason.length < 5}>
                            {actionLoading ? <Loader2 size={12} className="spin" /> : <Ban size={12} />} Tolak
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button className="btn btn-ghost" onClick={() => setShowRejectForm(true)}>
                          <X size={14} /> Tolak
                        </button>
                        <button className="btn btn-primary" onClick={handleApprove} disabled={actionLoading}>
                          {actionLoading ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Approve KYC
                        </button>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
