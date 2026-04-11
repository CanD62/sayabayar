'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { Search, X, UserCheck, UserX, Star, ChevronRight } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_BADGE = {
  active:    { label: 'Aktif',    cls: 'badge-success' },
  suspended: { label: 'Suspend',  cls: 'badge-danger' },
  inactive:  { label: 'Inactive', cls: 'badge-warning' },
}
const PLAN_BADGE = {
  free:         { label: 'Gratis',   cls: 'badge-info' },
  subscription: { label: 'Berbayar', cls: 'badge-success' },
}

export default function AdminMerchantsPage() {
  const toast = useToast()
  const [clients, setClients] = useState([])
  const [plans, setPlans] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterPlan, setFilterPlan] = useState('')
  const [selected, setSelected] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [showPlanModal, setShowPlanModal] = useState(false)
  const PER_PAGE = 20

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (search) params.set('search', search)
      if (filterStatus) params.set('status', filterStatus)
      if (filterPlan) params.set('plan', filterPlan)
      const res = await api.get(`/v1/admin/clients?${params}`)
      setClients(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1); setPage(1) }, [search, filterStatus, filterPlan])
  useEffect(() => { load(page) }, [page])
  useEffect(() => { api.get('/v1/admin/plans').then(r => setPlans(r.data || [])).catch(() => {}) }, [])

  const openDetail = async (c) => {
    setDetailLoading(true)
    setSelected({ ...c, _loading: true })
    try { const res = await api.get(`/v1/admin/clients/${c.id}`); setSelected(res.data) }
    catch { setSelected(null) }
    finally { setDetailLoading(false) }
  }

  const toggleStatus = async () => {
    if (!selected) return
    const newStatus = selected.status === 'active' ? 'suspended' : 'active'
    setActionLoading(true)
    try {
      await api.patch(`/v1/admin/clients/${selected.id}/status`, { status: newStatus })
      toast.success(`Merchant ${newStatus === 'suspended' ? 'di-suspend' : 'diaktifkan'}`)
      setSelected(s => ({ ...s, status: newStatus }))
      load()
    } catch (e) { toast.error(e.message) }
    finally { setActionLoading(false) }
  }

  const changePlan = async (planId) => {
    setActionLoading(true)
    try {
      const res = await api.patch(`/v1/admin/clients/${selected.id}/plan`, { plan_id: planId })
      toast.success(res.data.message)
      setShowPlanModal(false)
      const updated = await api.get(`/v1/admin/clients/${selected.id}`)
      setSelected(updated.data)
      load()
    } catch (e) { toast.error(e.message) }
    finally { setActionLoading(false) }
  }

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Merchant</h1>
          <p className="page-subtitle">{total} merchant terdaftar</p>
        </div>
      </div>

      {/* Toolbar */}
      <div className="admin-filter-bar">
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 0 }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }} />
          <input type="text" placeholder="Cari nama atau email..." value={search} onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 36, paddingRight: search ? 36 : 14, paddingTop: 9, paddingBottom: 9, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none', fontFamily: 'var(--font-sans)' }}
          />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={13} /></button>}
        </div>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer', minWidth: 0 }}>
          <option value="">Semua Status</option>
          <option value="active">Aktif</option>
          <option value="suspended">Suspended</option>
        </select>
        <select value={filterPlan} onChange={e => setFilterPlan(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer', minWidth: 0 }}>
          <option value="">Semua Plan</option>
          <option value="free">Gratis</option>
          <option value="subscription">Berbayar</option>
        </select>
      </div>

      <AdminTable
        columns={[
          { key: 'merchant', label: 'Merchant' },
          { key: 'plan', label: 'Plan' },
          { key: 'status', label: 'Status' },
          { key: 'saldo', label: 'Saldo' },
          { key: 'invoice_count', label: 'Invoice' },
          { key: 'daftar', label: 'Daftar', hide: true },
          { key: 'action', label: '', width: 1 },
        ]}
        data={clients}
        loading={loading}
        emptyText="Tidak ada data"
        cardTitle={(c) => {
          const sb = STATUS_BADGE[c.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{c.name}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{c.email}</div>
              </div>
              <span className={`badge ${sb.cls}`}>{sb.label}</span>
            </div>
          )
        }}
        cardAccent={(c) => c.status === 'active' ? '#10b981' : '#ef4444'}
        renderRow={(c) => {
          const sb = STATUS_BADGE[c.status] || {}
          const pb = PLAN_BADGE[c.plan?.plan_type] || { label: '—', cls: '' }
          return {
            cells: {
              merchant: (<><div style={{ fontWeight: 600 }}>{c.name}</div><div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{c.email}</div></>),
              plan: <span className={`badge ${pb.cls}`}>{pb.label}</span>,
              status: <span className={`badge ${sb.cls}`}>{sb.label}</span>,
              saldo: <span style={{ fontWeight: 600 }}>Rp {fmt(c.balance_available)}</span>,
              invoice_count: c.invoice_count,
              daftar: new Date(c.created_at).toLocaleDateString('id-ID'),
              action: (
                <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }} onClick={() => openDetail(c)}>
                  <ChevronRight size={13} /> Detail
                </button>
              ),
            },
            actions: (
              <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', width: '100%', justifyContent: 'center' }} onClick={() => openDetail(c)}>
                <ChevronRight size={13} /> Lihat Detail
              </button>
            ),
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />

      {/* Detail Modal */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 600, maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Merchant</h3>
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(null)}><X size={18} /></button>
            </div>

            {selected._loading || detailLoading ? (
              <div style={{ textAlign: 'center', padding: 40 }}><div className="spinner" /></div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
                  {[
                    ['Nama', selected.name],
                    ['Email', selected.email],
                    ['Phone', selected.phone || '—'],
                    ['Auth', selected.auth_provider],
                    ['Status', <span key="s" className={`badge ${STATUS_BADGE[selected.status]?.cls}`}>{STATUS_BADGE[selected.status]?.label}</span>],
                    ['Plan', selected.subscriptions?.[0]?.plan_name || '—'],
                    ['Daftar', new Date(selected.created_at).toLocaleDateString('id-ID')],
                    ['Invoice', selected.counts?.invoices],
                  ].map(([label, val], i) => (
                    <div key={i} style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, fontSize: '0.82rem' }}>
                      <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontWeight: 600 }}>{val}</div>
                    </div>
                  ))}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
                  {[
                    ['Saldo Tersedia', selected.balance?.available, '#10b981'],
                    ['Saldo Pending', selected.balance?.pending, '#f59e0b'],
                    ['Total Earned', selected.balance?.total_earned, '#6366f1'],
                  ].map(([label, val, color]) => (
                    <div key={label} style={{ padding: '10px 12px', background: 'rgba(255,255,255,0.03)', borderRadius: 8, textAlign: 'center' }}>
                      <div style={{ fontSize: '1rem', fontWeight: 800, color }}>{`Rp ${fmt(val || 0)}`}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginTop: 2 }}>{label}</div>
                    </div>
                  ))}
                </div>

                {selected.recent_invoices?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div className="admin-section-label">Invoice Terakhir</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {selected.recent_invoices.slice(0, 5).map(inv => (
                        <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 10px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, flexWrap: 'wrap', gap: 6 }}>
                          <span className="font-mono" style={{ color: 'var(--text-secondary)' }}>{inv.invoice_number}</span>
                          <span style={{ fontWeight: 600 }}>Rp {fmt(inv.amount)}</span>
                          <span className={`badge badge-${inv.status === 'paid' ? 'success' : inv.status === 'expired' ? 'danger' : 'warning'}`} style={{ fontSize: '0.6rem' }}>{inv.status}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setShowPlanModal(true)}>
                    <Star size={14} /> Ganti Plan
                  </button>
                  <button className={`btn ${selected.status === 'active' ? 'btn-danger' : 'btn-primary'}`} onClick={toggleStatus} disabled={actionLoading}>
                    {selected.status === 'active' ? <><UserX size={14} /> Suspend</> : <><UserCheck size={14} /> Aktifkan</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Change Plan Modal */}
      {showPlanModal && (
        <div className="modal-overlay" onClick={() => setShowPlanModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h3 className="modal-title">Ganti Plan Merchant</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 16 }}>
              Pilih plan baru untuk <strong>{selected?.name}</strong>
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
              {plans.map(plan => (
                <button key={plan.id} className="btn btn-ghost" style={{ justifyContent: 'space-between', padding: '12px 16px' }} onClick={() => changePlan(plan.id)} disabled={actionLoading}>
                  <span style={{ fontWeight: 700 }}>{plan.name}</span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {plan.plan_type === 'free' ? 'Gratis' : `Rp ${fmt(plan.monthly_price)}/bln`} · max {plan.max_channels} channel
                  </span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowPlanModal(false)}>Batal</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
