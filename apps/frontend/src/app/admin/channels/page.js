'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useToast } from '@/components/Toast'
import { RefreshCw } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const CIRCUIT_BADGE = {
  closed:    { label: 'Normal',    cls: 'badge-success' },
  open:      { label: 'Open',     cls: 'badge-danger' },
  half_open: { label: 'Half-Open', cls: 'badge-warning' },
}

export default function AdminChannelsPage() {
  const toast = useToast()
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [actionId, setActionId] = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/v1/admin/channels')
      .then(r => setChannels(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (ch) => {
    setActionId(ch.id)
    try { const res = await api.patch(`/v1/admin/channels/${ch.id}`, { is_active: !ch.is_active }); toast.success(res.data.message); load() }
    catch (e) { toast.error(e.message) }
    finally { setActionId(null) }
  }

  const resetCircuit = async (ch) => {
    setActionId(ch.id)
    try { const res = await api.patch(`/v1/admin/channels/${ch.id}`, { reset_circuit: true }); toast.success(res.data.message); load() }
    catch (e) { toast.error(e.message) }
    finally { setActionId(null) }
  }

  const filtered = search
    ? channels.filter(c => c.account_name?.toLowerCase().includes(search.toLowerCase()) || c.client_name?.toLowerCase().includes(search.toLowerCase()) || c.channel_type?.includes(search.toLowerCase()))
    : channels

  const platformChannels = filtered.filter(c => c.channel_owner === 'platform')
  const clientChannels = filtered.filter(c => c.channel_owner === 'client')

  const channelColumns = [
    { key: 'type', label: 'Tipe' },
    { key: 'account', label: 'Akun' },
    { key: 'merchant', label: 'Merchant', hide: true },
    { key: 'circuit', label: 'Circuit' },
    { key: 'session', label: 'Session' },
    { key: 'pending', label: 'Pending' },
    { key: 'lastSuccess', label: 'Last Sukses', hide: true },
    { key: 'active', label: 'Status' },
    { key: 'action', label: 'Aksi', width: 1 },
  ]

  const renderChannel = (ch) => {
    const cb = CIRCUIT_BADGE[ch.circuit_state] || {}
    const busy = actionId === ch.id
    return {
      cells: {
        type: (
          <>
            <span className={`badge ${ch.channel_owner === 'platform' ? 'badge-info' : 'badge-warning'}`} style={{ fontSize: '0.65rem' }}>
              {ch.channel_owner === 'platform' ? 'Platform' : 'Merchant'}
            </span>{' '}
            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{ch.channel_type}</span>
          </>
        ),
        account: (
          <>
            <div style={{ fontWeight: 600 }}>{ch.account_name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{ch.account_number}</div>
          </>
        ),
        merchant: (
          <>
            <div style={{ fontWeight: 500 }}>{ch.client_name}</div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ch.client_email}</div>
          </>
        ),
        circuit: (
          <>
            <span className={`badge ${cb.cls}`}>{cb.label}</span>
            {ch.consecutive_errors > 0 && <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: 2 }}>{ch.consecutive_errors}x error</div>}
          </>
        ),
        session: (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: ch.session_active ? '#10b981' : '#6b7280', flexShrink: 0 }} />
              <span style={{ fontSize: '0.75rem', color: ch.session_active ? '#10b981' : 'var(--text-muted)' }}>{ch.session_active ? 'Login' : 'Offline'}</span>
            </div>
          </>
        ),
        pending: <span style={{ fontWeight: 700, color: ch.pending_invoices > 0 ? '#f59e0b' : 'var(--text-muted)' }}>{ch.pending_invoices}</span>,
        lastSuccess: ch.last_success_at ? <span className="text-sm text-muted">{new Date(ch.last_success_at).toLocaleString('id-ID')}</span> : '—',
        active: (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ch.is_active ? '#10b981' : '#ef4444', flexShrink: 0 }} />
            <span style={{ fontSize: '0.75rem', color: ch.is_active ? '#10b981' : '#ef4444' }}>{ch.is_active ? 'Aktif' : 'Pause'}</span>
          </div>
        ),
        action: (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'nowrap' }}>
            <button className="btn btn-sm" style={{ background: ch.is_active ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: ch.is_active ? '#ef4444' : '#10b981', border: `1px solid ${ch.is_active ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`, whiteSpace: 'nowrap' }} onClick={() => toggleActive(ch)} disabled={busy}>
              {ch.is_active ? 'Pause' : 'Aktifkan'}
            </button>
            {ch.circuit_state !== 'closed' && (
              <button className="btn btn-sm" style={{ background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', whiteSpace: 'nowrap' }} onClick={() => resetCircuit(ch)} disabled={busy}>Reset</button>
            )}
          </div>
        ),
      },
      actions: (
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn btn-sm" style={{ flex: 1, background: ch.is_active ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)', color: ch.is_active ? '#ef4444' : '#10b981', border: `1px solid ${ch.is_active ? 'rgba(239,68,68,0.2)' : 'rgba(16,185,129,0.2)'}`, justifyContent: 'center' }} onClick={() => toggleActive(ch)} disabled={busy}>
            {ch.is_active ? 'Pause' : 'Aktifkan'}
          </button>
          {ch.circuit_state !== 'closed' && (
            <button className="btn btn-sm" style={{ flex: 1, background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)', justifyContent: 'center' }} onClick={() => resetCircuit(ch)} disabled={busy}>Reset Circuit</button>
          )}
        </div>
      ),
    }
  }

  const cardTitle = (ch) => {
    const cb = CIRCUIT_BADGE[ch.circuit_state] || {}
    return (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>{ch.account_name}</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{ch.channel_type} · {ch.account_number}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: ch.is_active ? '#10b981' : '#ef4444' }} />
          <span className={`badge ${cb.cls}`}>{cb.label}</span>
        </div>
      </div>
    )
  }

  const cardAccent = (ch) => ch.circuit_state === 'open' ? '#ef4444' : ch.is_active ? '#10b981' : '#6b7280'

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Channel Monitor</h1>
          <p className="page-subtitle">{channels.length} channel — {channels.filter(c => c.circuit_state === 'open').length} circuit open</p>
        </div>
        <button onClick={load} className="btn btn-ghost" style={{ gap: 8 }}><RefreshCw size={14} /> Refresh</button>
      </div>

      <div className="admin-badges">
        {[
          { label: 'Total', val: channels.length, color: '#6366f1' },
          { label: 'Login', val: channels.filter(c => c.session_active).length, color: '#10b981' },
          { label: 'Circuit Open', val: channels.filter(c => c.circuit_state === 'open').length, color: '#ef4444' },
          { label: 'Pending', val: channels.reduce((s, c) => s + c.pending_invoices, 0), color: '#f59e0b' },
        ].map(({ label, val, color }) => (
          <div key={label} className="admin-badge" style={{ background: `${color}15`, border: `1px solid ${color}30`, color }}>
            {val} <span style={{ fontWeight: 400, opacity: 0.8 }}>{label}</span>
          </div>
        ))}
      </div>

      <div className="admin-filter-bar">
        <input type="text" placeholder="Cari nama, tipe..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: '1 1 200px', minWidth: 0, padding: '9px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 64 }}><div className="spinner" /></div>
      ) : (
        <>
          {platformChannels.length > 0 && (
            <>
              <div className="admin-section-label">Channel Platform ({platformChannels.length})</div>
              <div style={{ marginBottom: 20 }}>
                <AdminTable columns={channelColumns} data={platformChannels} renderRow={renderChannel} cardTitle={cardTitle} cardAccent={cardAccent} />
              </div>
            </>
          )}

          {clientChannels.length > 0 && (
            <>
              <div className="admin-section-label">Channel Merchant ({clientChannels.length})</div>
              <AdminTable columns={channelColumns} data={clientChannels} renderRow={renderChannel} cardTitle={cardTitle} cardAccent={cardAccent} />
            </>
          )}

          {filtered.length === 0 && (
            <div className="card" style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              Tidak ada channel ditemukan
            </div>
          )}
        </>
      )}
    </>
  )
}
