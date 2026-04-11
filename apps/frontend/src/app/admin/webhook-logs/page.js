'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { X, RefreshCw } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

export default function AdminWebhookLogsPage() {
  const [logs, setLogs] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [filterSuccess, setFilterSuccess] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const PER_PAGE = 20

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, per_page: PER_PAGE })
      if (filterSuccess) params.set('success', filterSuccess)
      if (dateFrom) params.set('date_from', dateFrom)
      if (dateTo) params.set('date_to', dateTo)
      const res = await api.get(`/v1/admin/webhook-logs?${params}`)
      setLogs(res.data)
      setTotal(res.pagination?.total || 0)
    } finally { setLoading(false) }
  }

  useEffect(() => { load(1); setPage(1) }, [filterSuccess, dateFrom, dateTo])
  useEffect(() => { load(page) }, [page])

  const totalPages = Math.ceil(total / PER_PAGE)
  const successCount = logs.filter(l => l.http_status >= 200 && l.http_status < 300).length
  const failCount = logs.filter(l => !l.http_status || l.http_status >= 300 || l.http_status < 200).length
  const successRate = logs.length > 0 ? Math.round((successCount / logs.length) * 100) : 0

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Webhook Log</h1>
          <p className="page-subtitle">{total} total webhook</p>
        </div>
        <button onClick={() => load(page)} className="btn btn-ghost" style={{ gap: 8 }}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="admin-badges">
        {[
          { label: 'Sukses', val: successCount, color: '#10b981' },
          { label: 'Gagal', val: failCount, color: '#ef4444' },
          { label: 'Rate', val: `${successRate}%`, color: successRate >= 90 ? '#10b981' : successRate >= 70 ? '#f59e0b' : '#ef4444' },
        ].map(({ label, val, color }) => (
          <div key={label} className="admin-badge" style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
            {val} <span style={{ fontWeight: 400, opacity: 0.8 }}>{label}</span>
          </div>
        ))}
      </div>

      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {[['', 'Semua'], ['true', 'Sukses'], ['false', 'Gagal']].map(([val, label]) => (
            <button key={val} onClick={() => setFilterSuccess(val)} className={`btn btn-sm ${filterSuccess === val ? 'btn-primary' : 'btn-ghost'}`}>{label}</button>
          ))}
        </div>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>—</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', minWidth: 0 }} />
        {(filterSuccess || dateFrom || dateTo) && (
          <button className="btn btn-sm btn-ghost" onClick={() => { setFilterSuccess(''); setDateFrom(''); setDateTo('') }}><X size={12} /> Reset</button>
        )}
      </div>

      <AdminTable
        columns={[
          { key: 'invoice', label: 'Invoice' },
          { key: 'merchant', label: 'Merchant' },
          { key: 'url', label: 'URL', hide: true },
          { key: 'http', label: 'HTTP' },
          { key: 'attempt', label: 'Attempt' },
          { key: 'response', label: 'Response', hide: true },
          { key: 'sent', label: 'Dikirim' },
        ]}
        data={logs}
        loading={loading}
        emptyText="Tidak ada log webhook"
        cardTitle={(log) => {
          const isOk = log.http_status >= 200 && log.http_status < 300
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span className="font-mono" style={{ fontSize: '0.82rem', fontWeight: 700 }}>{log.invoice_number}</span>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Rp {fmt(log.invoice_amount)}</div>
              </div>
              <span className={`badge ${isOk ? 'badge-success' : 'badge-danger'}`}>{log.http_status || 'N/A'}</span>
            </div>
          )
        }}
        cardAccent={(log) => (log.http_status >= 200 && log.http_status < 300) ? '#10b981' : '#ef4444'}
        renderRow={(log) => {
          const isOk = log.http_status >= 200 && log.http_status < 300
          return {
            rowStyle: { background: isOk ? undefined : 'rgba(239,68,68,0.03)' },
            cells: {
              invoice: (<><span className="font-mono" style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>{log.invoice_number}</span><div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>Rp {fmt(log.invoice_amount)}</div></>),
              merchant: log.client_name || '—',
              url: <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--text-muted)' }} title={log.webhook_url}>{log.webhook_url}</span>,
              http: <span className={`badge ${isOk ? 'badge-success' : 'badge-danger'}`}>{log.http_status || 'N/A'}</span>,
              attempt: <span style={{ color: log.attempt_number > 1 ? '#f59e0b' : 'var(--text-muted)' }}>{log.attempt_number}</span>,
              response: log.response_body ? <span style={{ fontSize: '0.68rem', fontFamily: 'monospace', color: 'var(--text-muted)' }}>{log.response_body}</span> : '—',
              sent: <span className="text-sm text-muted">{new Date(log.sent_at).toLocaleString('id-ID')}</span>,
            }
          }
        }}
        pagination={totalPages > 1 ? { page, totalPages, onPrev: () => setPage(p => p - 1), onNext: () => setPage(p => p + 1) } : null}
      />
    </>
  )
}
