'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const MONTH_NAMES = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'Mei', '06': 'Jun',
  '07': 'Jul', '08': 'Agu', '09': 'Sep', '10': 'Okt', '11': 'Nov', '12': 'Des',
}

const SUB_STATUS = {
  active:        { label: 'Aktif',           cls: 'badge-success' },
  expiring_soon: { label: 'Segera Habis',    cls: 'badge-warning' },
  expired:       { label: 'Expired',         cls: 'badge-danger' },
}

function formatMonth(key) {
  const [year, month] = key.split('-')
  return `${MONTH_NAMES[month] || month} ${year}`
}

export default function AdminSubscriptionsPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [expandedMonth, setExpandedMonth] = useState(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.get('/v1/admin/subscriptions?months=6')
      setData(res.data)
    } catch { }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1 className="page-title">Langganan</h1>
            <p className="page-subtitle">Memuat data...</p>
          </div>
        </div>
        <div style={{ textAlign: 'center', padding: 64 }}><div className="spinner" /></div>
      </>
    )
  }

  if (!data) return null
  const { summary, subscribers, monthly_report } = data

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Langganan</h1>
          <p className="page-subtitle">Laporan subscriber & revenue bulanan</p>
        </div>
        <button onClick={load} className="btn btn-ghost" style={{ gap: 8 }}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* ── Stats Cards ─────────────────────────────── */}
      <div className="admin-stats-grid">
        {[
          { label: 'Subscriber Aktif', val: summary.active_subscribers, color: '#10b981' },
          { label: 'Segera Habis', val: summary.expiring_soon, color: summary.expiring_soon > 0 ? '#f59e0b' : '#6b7280', sub: '≤ 7 hari' },
          { label: 'Revenue Bulan Ini', val: summary.this_month_revenue, color: '#6366f1', prefix: 'Rp ', sub: `${summary.this_month_count} pembayaran` },
          { label: 'Renewal Rate', val: `${summary.renewal_rate}%`, color: summary.renewal_rate >= 80 ? '#10b981' : summary.renewal_rate >= 50 ? '#f59e0b' : '#ef4444', sub: `${summary.renewed_count}/${summary.last_month_count} renew` },
        ].map(({ label, val, color, prefix, sub }) => (
          <div key={label} className="admin-stat-card" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
            <div className="admin-stat-value" style={{ color }}>{prefix || ''}{typeof val === 'number' ? fmt(val) : val}</div>
            <div className="admin-stat-label">{label}</div>
            {sub && <div className="admin-stat-sub" style={{ color }}>{sub}</div>}
          </div>
        ))}
      </div>

      {/* ── Subscriber Aktif ────────────────────────── */}
      {subscribers.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div className="admin-section-label">Subscriber Aktif ({subscribers.length})</div>
          <AdminTable
            columns={[
              { key: 'merchant', label: 'Merchant' },
              { key: 'plan', label: 'Plan' },
              { key: 'harga', label: 'Harga' },
              { key: 'periode', label: 'Periode', hide: true },
              { key: 'sisa', label: 'Sisa' },
              { key: 'status', label: 'Status' },
            ]}
            data={subscribers}
            cardTitle={(s) => (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{s.client_name}</div>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{s.client_email}</div>
                </div>
                <span className={`badge ${(SUB_STATUS[s.status] || {}).cls}`}>{(SUB_STATUS[s.status] || {}).label}</span>
              </div>
            )}
            cardAccent={(s) => s.status === 'expiring_soon' ? '#f59e0b' : s.status === 'expired' ? '#ef4444' : '#10b981'}
            renderRow={(s) => {
              const st = SUB_STATUS[s.status] || {}
              return {
                rowStyle: {
                  background: s.status === 'expiring_soon' ? 'rgba(245,158,11,0.04)' : s.status === 'expired' ? 'rgba(239,68,68,0.04)' : undefined
                },
                cells: {
                  merchant: (
                    <>
                      <div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{s.client_name}</div>
                      <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{s.client_email}</div>
                    </>
                  ),
                  plan: s.plan_name,
                  harga: <span style={{ fontWeight: 600 }}>Rp {fmt(s.monthly_price)}</span>,
                  periode: (
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                      {new Date(s.period_start).toLocaleDateString('id-ID')} — {new Date(s.period_end).toLocaleDateString('id-ID')}
                    </span>
                  ),
                  sisa: (
                    <span style={{
                      fontSize: '0.85rem', fontWeight: 800, fontFamily: 'monospace',
                      color: s.days_left <= 0 ? '#ef4444' : s.days_left <= 7 ? '#f59e0b' : '#10b981',
                    }}>
                      {s.days_left <= 0 ? 'Habis!' : `${s.days_left}h`}
                    </span>
                  ),
                  status: (
                    <>
                      <span className={`badge ${st.cls}`}>{st.label}</span>
                      {s.status === 'expiring_soon' && (
                        <div style={{ fontSize: '0.65rem', color: '#f59e0b', marginTop: 2 }}>
                          <AlertTriangle size={10} style={{ verticalAlign: 'middle' }} /> Renew
                        </div>
                      )}
                    </>
                  ),
                }
              }
            }}
          />
        </div>
      )}

      {/* ── Revenue Bulanan ──────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div className="admin-section-label">Revenue Bulanan (6 Bulan Terakhir)</div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {monthly_report.map(m => {
            const isExpanded = expandedMonth === m.month
            const hasDetail = m.merchants.length > 0
            return (
              <div key={m.month} style={{ borderBottom: '1px solid var(--border)' }}>
                {/* Row header — clickable */}
                <div
                  onClick={() => hasDetail && setExpandedMonth(isExpanded ? null : m.month)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '12px 16px', cursor: hasDetail ? 'pointer' : 'default',
                    background: isExpanded ? 'rgba(99,102,241,0.05)' : undefined,
                    transition: 'background 0.15s ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{formatMonth(m.month)}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{m.count}x · {m.merchants.length} merchant</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 800, color: m.revenue > 0 ? '#10b981' : 'var(--text-muted)', fontSize: '0.95rem' }}>
                      Rp {fmt(m.revenue)}
                    </span>
                    {hasDetail && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--accent)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0)' }}>▼</span>
                    )}
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && hasDetail && (
                  <div style={{ padding: '0 16px 12px', borderTop: '1px solid var(--border)', background: 'rgba(99,102,241,0.03)' }}>
                    <div className="admin-section-label" style={{ padding: '10px 0 6px' }}>Detail {formatMonth(m.month)}</div>
                    {m.merchants.map((mc, i) => (
                      <div key={i} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8,
                        fontSize: '0.82rem', flexWrap: 'wrap', gap: 6, marginBottom: 4,
                      }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 600 }}>{mc.client_name}</span>
                          <span style={{ color: 'var(--text-muted)', marginLeft: 8, fontSize: '0.72rem' }}>{mc.client_email}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span className="font-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{mc.invoice_number}</span>
                          <span style={{ fontWeight: 700, color: '#10b981' }}>Rp {fmt(mc.amount)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
