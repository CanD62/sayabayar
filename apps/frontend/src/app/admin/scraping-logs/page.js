'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { X, RefreshCw } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const STATUS_CONFIG = {
  success:   { label: 'Sukses',    cls: 'badge-success' },
  transient: { label: 'Transient', cls: 'badge-warning' },
  fatal:     { label: 'Fatal',     cls: 'badge-danger' },
}

export default function AdminScrapingLogsPage() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterStatus, setFilterStatus] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const PER_PAGE = 30

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterStatus) params.set('status', filterStatus)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await api.get(`/v1/admin/scraping-logs?${params}`)
      setLogs(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1); setPage(1) }, [filterStatus, dateFrom, dateTo])
  useEffect(() => { load(page) }, [page])

  const totalPages = Math.ceil(total / PER_PAGE)
  const successCount = logs.filter(l => l.status === 'success').length
  const fatalCount = logs.filter(l => l.status === 'fatal').length
  const avgDuration = logs.length > 0 ? Math.round(logs.filter(l => l.duration_ms).reduce((s, l) => s + l.duration_ms, 0) / Math.max(1, logs.filter(l => l.duration_ms).length)) : 0
  const totalTxNew = logs.reduce((s, l) => s + (l.tx_new || 0), 0)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Scraping Log</h1>
          <p className="page-subtitle">{total} total log</p>
        </div>
        <button onClick={() => load(page)} className="btn btn-ghost" style={{ gap: 8 }}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="admin-badges">
        {[
          { label: 'Sukses', val: successCount, color: '#10b981' },
          { label: 'Fatal', val: fatalCount, color: '#ef4444' },
          { label: 'Avg', val: `${fmt(avgDuration)}ms`, color: '#6366f1' },
          { label: 'TX Baru', val: totalTxNew, color: '#f59e0b' },
        ].map(({ label, val, color }) => (
          <div key={label} className="admin-badge" style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
            {val} <span style={{ fontWeight: 400, opacity: 0.8 }}>{label}</span>
          </div>
        ))}
      </div>

      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['success', 'Sukses'], ['transient', 'Transient'], ['fatal', 'Fatal']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterStatus(val)} className={`btn btn-sm ${filterStatus === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        {(filterStatus || dateFrom || dateTo) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterStatus(''); setDateFrom(''); setDateTo('') }}><X size={12} /> Reset</button>
        )}
      </div>

      <AdminTable
        columns={[
          { key: 'channel', label: 'Channel' },
          { key: 'status', label: 'Status' },
          { key: 'txFound', label: 'TX Found' },
          { key: 'txNew', label: 'TX New' },
          { key: 'duration', label: 'Durasi' },
          { key: 'error', label: 'Error' },
          { key: 'time', label: 'Waktu' },
        ]}
        data={logs}
        loading={loading}
        emptyText="Tidak ada log"
        cardTitle={(log) => {
          const s = STATUS_CONFIG[log.status] || {}
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '0.88rem' }}>{log.channel_account || '—'}</div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{log.channel_type}</div>
              </div>
              <span className={`badge ${s.cls}`}>{s.label}</span>
            </div>
          )
        }}
        cardAccent={(log) => log.status === 'fatal' ? '#ef4444' : log.status === 'success' ? '#10b981' : '#f59e0b'}
        renderRow={(log) => {
          const s = STATUS_CONFIG[log.status] || {}
          return {
            rowStyle: { background: log.status === 'fatal' ? 'rgba(239,68,68,0.04)' : log.status === 'success' ? 'rgba(16,185,129,0.03)' : undefined },
            cells: {
              channel: (<><div style={{ fontWeight: 600, fontSize: '0.82rem' }}>{log.channel_account || '—'}</div><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{log.channel_type}</div></>),
              status: <span className={`badge ${s.cls}`}>{s.label}</span>,
              txFound: <span style={{ fontWeight: 600, color: log.tx_found > 0 ? 'var(--text-primary)' : 'var(--text-muted)' }}>{log.tx_found}</span>,
              txNew: <span style={{ fontWeight: 700, color: log.tx_new > 0 ? '#10b981' : 'var(--text-muted)' }}>{log.tx_new}</span>,
              duration: <span style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: 'var(--text-muted)' }}>{log.duration_ms != null ? `${fmt(log.duration_ms)}ms` : '—'}</span>,
              error: log.error_message ? <span style={{ fontSize: '0.72rem', color: '#ef4444' }}>{log.error_type ? `[${log.error_type}] ` : ''}{log.error_message}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>,
              time: <span className="text-sm text-muted">{new Date(log.scraped_at).toLocaleString('id-ID')}</span>,
            }
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}
