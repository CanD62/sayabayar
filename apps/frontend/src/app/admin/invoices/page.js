'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { X, Search } from 'lucide-react'
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
            }
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}
