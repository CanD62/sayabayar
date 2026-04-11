'use client'
import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { X, AlertTriangle } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const TYPE_CONFIG = {
  credit_pending:   { label: 'Credit Pending',   cls: 'badge-warning', prefix: '+' },
  credit_available: { label: 'Credit Available',  cls: 'badge-success', prefix: '+' },
  debit_withdraw:   { label: 'Debit Withdraw',    cls: 'badge-danger',  prefix: '−' },
}

function Countdown({ targetDate }) {
  const [timeLeft, setTimeLeft] = useState('')

  useEffect(() => {
    const calc = () => {
      const now = new Date()
      const target = new Date(targetDate)
      const diff = target - now
      if (diff <= 0) { setTimeLeft('Siap settle'); return }
      const days = Math.floor(diff / (1000 * 60 * 60 * 24))
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
      const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setTimeLeft(days > 0 ? `${days}h ${hours}j ${mins}m` : hours > 0 ? `${hours}j ${mins}m` : `${mins}m`)
    }
    calc()
    const interval = setInterval(calc, 60_000)
    return () => clearInterval(interval)
  }, [targetDate])

  const isReady = new Date(targetDate) <= new Date()
  return (
    <span style={{ fontSize: '0.75rem', fontWeight: 600, fontFamily: 'monospace', color: isReady ? '#10b981' : '#f59e0b', background: isReady ? 'rgba(16,185,129,0.1)' : 'rgba(245,158,11,0.08)', padding: '2px 8px', borderRadius: 6 }}>
      {isReady ? '✓ ' : '⏳ '}{timeLeft}
    </span>
  )
}

function SettlementCell({ entry }) {
  if (entry.type === 'credit_pending' && !entry.settled_at) {
    return (
      <div>
        <Countdown targetDate={entry.available_at} />
        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2 }}>
          {new Date(entry.available_at).toLocaleString('id-ID')}
        </div>
      </div>
    )
  }
  if (entry.settled_at) {
    return <span style={{ color: '#10b981', fontSize: '0.82rem' }}>✓ {new Date(entry.settled_at).toLocaleDateString('id-ID')}</span>
  }
  return <span style={{ color: 'var(--text-muted)' }}>—</span>
}

export default function AdminLedgerPage() {
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterType, setFilterType] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [stats, setStats] = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [merchantBalances, setMerchantBalances] = useState(null)
  const [mbLoading, setMbLoading] = useState(true)
  const PER_PAGE = 20

  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    try { const res = await api.get('/v1/admin/ledger-stats'); setStats(res.data) } catch { }
    finally { setStatsLoading(false) }
  }, [])

  const loadMerchantBalances = useCallback(async () => {
    setMbLoading(true)
    try { const res = await api.get('/v1/admin/merchant-balances?min_balance=52500'); setMerchantBalances(res.data) } catch { }
    finally { setMbLoading(false) }
  }, [])

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterType) params.set('type', filterType)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await api.get(`/v1/admin/ledger?${params}`)
      setEntries(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { loadStats(); loadMerchantBalances() }, [])
  useEffect(() => { load(1); setPage(1) }, [filterType, dateFrom, dateTo])
  useEffect(() => { load(page) }, [page])

  const totalPages = Math.ceil(total / PER_PAGE)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Balance Ledger</h1>
          <p className="page-subtitle">{total} entri mutasi saldo</p>
        </div>
      </div>

      {/* Stats */}
      {!statsLoading && stats && (
        <div className="admin-stats-grid">
          {[
            { label: 'Saldo Pending', val: stats.total_pending, color: '#f59e0b', prefix: 'Rp ' },
            { label: 'Saldo Available', val: stats.total_available, color: '#10b981', prefix: 'Rp ' },
            { label: 'Total Earned', val: stats.total_earned, color: '#6366f1', prefix: 'Rp ' },
            { label: 'Total Withdrawn', val: stats.total_withdrawn, color: '#ef4444', prefix: 'Rp ' },
            { label: 'Menunggu Settlement', val: stats.pending_settlements, color: '#f59e0b', sub: `Rp ${fmt(stats.pending_settlements_amount)}` },
          ].map(({ label, val, color, prefix, sub }) => (
            <div key={label} className="admin-stat-card" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
              <div className="admin-stat-value" style={{ color }}>{prefix || ''}{fmt(val)}</div>
              <div className="admin-stat-label">{label}</div>
              {sub && <div className="admin-stat-sub" style={{ color }}>{sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* Merchant Balances */}
      {!mbLoading && merchantBalances && merchantBalances.merchants.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div className="admin-alert-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.78rem', color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              <AlertTriangle size={14} />
              Merchant Siap Tarik — Rp {fmt(merchantBalances.total_needed)}
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>(saldo ≥ Rp 52.500)</span>
          </div>
          <AdminTable
            columns={[
              { key: 'merchant', label: 'Merchant' },
              { key: 'available', label: 'Available' },
              { key: 'pending', label: 'Pending' },
              { key: 'earned', label: 'Earned', hide: true },
              { key: 'withdrawn', label: 'Withdrawn', hide: true },
            ]}
            data={merchantBalances.merchants}
            cardTitle={(m) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{m.client_name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.client_email}</div>
                </div>
                <span style={{ fontWeight: 800, color: '#10b981', fontSize: '1rem' }}>Rp {fmt(m.balance_available)}</span>
              </div>
            )}
            renderRow={(m) => ({
              cells: {
                merchant: (
                  <>
                    <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{m.client_name}</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{m.client_email}</div>
                  </>
                ),
                available: <span style={{ fontWeight: 800, color: '#10b981' }}>Rp {fmt(m.balance_available)}</span>,
                pending: <span style={{ color: '#f59e0b', fontWeight: 600 }}>Rp {fmt(m.balance_pending)}</span>,
                earned: <span className="text-sm text-muted">Rp {fmt(m.total_earned)}</span>,
                withdrawn: <span className="text-sm text-muted">Rp {fmt(m.total_withdrawn)}</span>,
              }
            })}
          />
        </div>
      )}

      {/* Filters */}
      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['credit_pending', 'Credit Pending'], ['credit_available', 'Credit Available'], ['debit_withdraw', 'Debit Withdraw']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterType(val)} className={`btn btn-sm ${filterType === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        {(filterType || dateFrom || dateTo) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterType(''); setDateFrom(''); setDateTo('') }}><X size={12} /> Reset</button>
        )}
      </div>

      {/* Ledger Table */}
      <div className="admin-section-label">Riwayat Mutasi</div>
      <AdminTable
        columns={[
          { key: 'merchant', label: 'Merchant' },
          { key: 'type', label: 'Tipe' },
          { key: 'amount', label: 'Nominal' },
          { key: 'ref', label: 'Referensi' },
          { key: 'note', label: 'Catatan', hide: true },
          { key: 'settlement', label: 'Settlement' },
          { key: 'created', label: 'Dibuat', hide: true },
        ]}
        data={entries}
        loading={loading}
        emptyText="Tidak ada entri"
        cardTitle={(entry) => {
          const tc = TYPE_CONFIG[entry.type] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{entry.client_name}</div>
                <span className={`badge ${tc.cls}`} style={{ marginTop: 4 }}>{tc.label}</span>
              </div>
              <span style={{ fontWeight: 800, color: entry.type === 'debit_withdraw' ? '#ef4444' : '#10b981', fontSize: '1rem' }}>
                {tc.prefix}Rp {fmt(entry.amount)}
              </span>
            </div>
          )
        }}
        cardAccent={(entry) => entry.type === 'debit_withdraw' ? '#ef4444' : entry.type === 'credit_pending' ? '#f59e0b' : '#10b981'}
        renderRow={(entry) => {
          const tc = TYPE_CONFIG[entry.type] || {}
          return {
            cells: {
              merchant: (
                <>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{entry.client_name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{entry.client_email}</div>
                </>
              ),
              type: <span className={`badge ${tc.cls}`}>{tc.label}</span>,
              amount: <span style={{ fontWeight: 700, color: entry.type === 'debit_withdraw' ? '#ef4444' : '#10b981' }}>{tc.prefix}Rp {fmt(entry.amount)}</span>,
              ref: entry.invoice_number ? <span className="font-mono" style={{ fontSize: '0.78rem' }}>{entry.invoice_number}</span> : entry.withdrawal_info ? <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>WD: {entry.withdrawal_info}</span> : '—',
              note: entry.note || '—',
              settlement: <SettlementCell entry={entry} />,
              created: <span className="text-sm text-muted">{new Date(entry.created_at).toLocaleString('id-ID')}</span>,
            }
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}
