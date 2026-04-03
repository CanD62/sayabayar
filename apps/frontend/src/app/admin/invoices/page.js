'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Search, X } from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_BADGE = {
  pending:        { label: 'Pending',    cls: 'badge-warning' },
  user_confirmed: { label: 'Konfirmasi', cls: 'badge-info' },
  paid:           { label: 'Lunas',      cls: 'badge-success' },
  expired:        { label: 'Expired',    cls: 'badge-danger' },
  cancelled:      { label: 'Batal',      cls: 'badge-danger' },
}

export default function AdminInvoicesPage() {
  const [invoices, setInvoices]   = useState([])
  const [total, setTotal]         = useState(0)
  const [loading, setLoading]     = useState(true)
  const [page, setPage]           = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom]   = useState('')
  const [dateTo, setDateTo]       = useState('')
  const PER_PAGE = 20

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo)   params.set('date_to', dateTo)
      const res = await api.get(`/v1/admin/invoices?${params}`)
      setInvoices(res.data)
      setTotal(res.pagination?.total || 0)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1); setPage(1) }, [filterStatus, dateFrom, dateTo])
  useEffect(() => { load(page) }, [page])

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
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', cursor: 'pointer' }}>
          <option value="">Semua Status</option>
          <option value="pending">Pending</option>
          <option value="user_confirmed">Konfirmasi</option>
          <option value="paid">Lunas</option>
          <option value="expired">Expired</option>
          <option value="cancelled">Batal</option>
        </select>

        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem' }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem' }} />

        {(filterStatus || dateFrom || dateTo) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterStatus(''); setDateFrom(''); setDateTo('') }}>
            <X size={12} /> Reset
          </button>
        )}

        {totalVolume > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: '0.82rem', color: 'var(--accent)', fontWeight: 700 }}>
            Volume: Rp {fmt(totalVolume)}
          </span>
        )}
      </div>

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>
              <th>#Invoice</th>
              <th>Merchant</th>
              <th>Customer</th>
              <th>Nominal</th>
              <th>Channel</th>
              <th>Status</th>
              <th>Dibuat</th>
            </tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32 }}><div className="spinner" /></td></tr>
              ) : invoices.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 32, color: 'var(--text-muted)' }}>Tidak ada invoice</td></tr>
              ) : invoices.map(inv => {
                const sb = STATUS_BADGE[inv.status] || {}
                return (
                  <tr key={inv.id}>
                    <td>
                      <span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{inv.invoice_number}</span>
                      <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{inv.source} · {inv.channel_preference}</div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{inv.client_name}</div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{inv.client_email}</div>
                      <span style={{
                        display: 'inline-block', marginTop: 3,
                        fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.05em',
                        padding: '1px 6px', borderRadius: 99, textTransform: 'uppercase',
                        background: inv.client_plan_type === 'free'
                          ? 'rgba(148,163,184,0.15)' : 'rgba(16,185,129,0.15)',
                        color: inv.client_plan_type === 'free'
                          ? 'var(--text-muted)' : '#10b981',
                        border: `1px solid ${inv.client_plan_type === 'free' ? 'rgba(148,163,184,0.2)' : 'rgba(16,185,129,0.3)'}`,
                      }}>
                        {inv.client_plan_type === 'free' ? 'Gratis' : 'Pro'}
                      </span>
                    </td>
                    <td style={{ fontSize: '0.82rem' }}>
                      {inv.customer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      {inv.customer_email && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{inv.customer_email}</div>}
                    </td>
                    <td style={{ fontWeight: 700 }}>Rp {fmt(inv.amount)}</td>
                    <td style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {inv.channel_type || '—'}
                      {inv.channel_account && <div>{inv.channel_account}</div>}
                    </td>
                    <td><span className={`badge ${sb.cls}`}>{sb.label}</span></td>
                    <td className="text-sm text-muted">{new Date(inv.created_at).toLocaleString('id-ID')}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: '16px 24px' }}>
            <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <span style={{ padding: '6px 12px', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{page} / {totalPages}</span>
            <button className="btn btn-sm btn-ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        )}
      </div>
    </>
  )
}
