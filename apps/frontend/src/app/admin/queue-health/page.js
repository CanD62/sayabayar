'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { RefreshCw, Activity, AlertTriangle, CheckCircle2, Clock3 } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Number(n || 0))

const STATE_BADGE = {
  idle: { label: 'Idle', cls: 'badge-info' },
  busy: { label: 'Busy', cls: 'badge-warning' },
  warning: { label: 'Warning', cls: 'badge-danger' },
  down: { label: 'Down', cls: 'badge-danger' },
}

export default function AdminQueueHealthPage() {
  const [loading, setLoading] = useState(true)
  const [health, setHealth] = useState(null)
  const [error, setError] = useState('')
  const [autoRefresh, setAutoRefresh] = useState(true)

  const load = async () => {
    setError('')
    setLoading(true)
    try {
      const res = await api.get('/v1/admin/queue-health')
      setHealth(res.data)
    } catch (err) {
      setError(err.message || 'Gagal memuat data queue health')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [autoRefresh])

  const rows = health?.queues || []
  const summary = health?.summary || { waiting: 0, active: 0, delayed: 0, failed: 0, completed: 0 }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Queue Health</h1>
          <p className="page-subtitle">
            Prefix: <span className="font-mono">{health?.queue_prefix || '—'}</span>
            {' '}• Redis: <strong style={{ color: health?.redis?.status === 'up' ? 'var(--success)' : 'var(--danger)' }}>{health?.redis?.status || '—'}</strong>
            {health?.redis?.latency_ms != null && <> ({health.redis.latency_ms}ms)</>}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAutoRefresh(v => !v)}>
            <Clock3 size={14} /> Auto 10s {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <button className="btn btn-ghost" onClick={load} style={{ gap: 8 }}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      <div className="admin-badges">
        <div className="admin-badge" style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
          {fmt(summary.waiting)} waiting
        </div>
        <div className="admin-badge" style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6' }}>
          {fmt(summary.active)} active
        </div>
        <div className="admin-badge" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
          {fmt(summary.delayed)} delayed
        </div>
        <div className="admin-badge" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          {fmt(summary.failed)} failed
        </div>
        <div className="admin-badge" style={{ background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981' }}>
          {fmt(summary.completed)} completed
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
          <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <AlertTriangle size={16} /> {error}
          </div>
        </div>
      )}

      <AdminTable
        columns={[
          { key: 'queue', label: 'Queue' },
          { key: 'state', label: 'Status' },
          { key: 'waiting', label: 'Waiting' },
          { key: 'active', label: 'Active' },
          { key: 'delayed', label: 'Delayed' },
          { key: 'failed', label: 'Failed' },
          { key: 'completed', label: 'Completed' },
        ]}
        data={rows}
        loading={loading}
        emptyText="Tidak ada data queue"
        cardTitle={(q) => {
          const sb = STATE_BADGE[q.state] || STATE_BADGE.idle
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>{q.queue}</div>
              <span className={`badge ${sb.cls}`}>{sb.label}</span>
            </div>
          )
        }}
        cardAccent={(q) => q.state === 'warning' || q.state === 'down' ? '#ef4444' : q.state === 'busy' ? '#f59e0b' : '#10b981'}
        renderRow={(q) => {
          const sb = STATE_BADGE[q.state] || STATE_BADGE.idle
          const c = q.counts || {}
          return {
            cells: {
              queue: <span className="font-mono" style={{ fontWeight: 700 }}>{q.queue}</span>,
              state: <span className={`badge ${sb.cls}`}>{sb.label}</span>,
              waiting: <span style={{ fontWeight: 600 }}>{fmt(c.waiting)}</span>,
              active: <span style={{ fontWeight: 600, color: (c.active || 0) > 0 ? '#3b82f6' : 'var(--text-muted)' }}>{fmt(c.active)}</span>,
              delayed: <span style={{ fontWeight: 600, color: (c.delayed || 0) > 0 ? '#a855f7' : 'var(--text-muted)' }}>{fmt(c.delayed)}</span>,
              failed: <span style={{ fontWeight: 700, color: (c.failed || 0) > 0 ? '#ef4444' : 'var(--text-muted)' }}>{fmt(c.failed)}</span>,
              completed: <span style={{ fontWeight: 600, color: (c.completed || 0) > 0 ? '#10b981' : 'var(--text-muted)' }}>{fmt(c.completed)}</span>,
            },
            actions: q.failed_samples?.length > 0 ? (
              <div style={{ width: '100%', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, background: 'rgba(239,68,68,0.05)', padding: 10 }}>
                {q.failed_samples.map((f) => (
                  <div key={`${q.queue}-${f.id}`} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      <span className="font-mono">#{f.id}</span> • {f.name} • attempt {f.attempts_made}
                    </div>
                    <div style={{ fontSize: '0.76rem', color: '#ef4444', marginTop: 2 }}>
                      {f.failed_reason || 'No reason'}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ width: '100%', fontSize: '0.76rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 size={13} color="#10b981" /> Tidak ada sample failed
              </div>
            )
          }
        }}
      />

      {health && (
        <div style={{ marginTop: 10, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
          Snapshot: {new Date(health.generated_at).toLocaleString('id-ID')} • API latency {health.latency_ms}ms
        </div>
      )}
    </>
  )
}

