'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

const CIRCUIT_BADGE = {
  closed:    { label: 'Normal',     cls: 'badge-success' },
  open:      { label: 'Open',       cls: 'badge-danger' },
  half_open: { label: 'Half-Open',  cls: 'badge-warning' },
}
const OWNER_BADGE = {
  platform: { label: 'Platform', cls: 'badge-info' },
  client:   { label: 'Merchant', cls: 'badge-warning' },
}

export default function AdminChannelsPage() {
  const [channels, setChannels] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')

  useEffect(() => {
    api.get('/v1/admin/channels')
      .then(r => setChannels(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = search
    ? channels.filter(c =>
        c.account_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.client_name?.toLowerCase().includes(search.toLowerCase()) ||
        c.channel_type?.includes(search.toLowerCase())
      )
    : channels

  const platformChannels = filtered.filter(c => c.channel_owner === 'platform')
  const clientChannels   = filtered.filter(c => c.channel_owner === 'client')

  const ChannelRow = ({ ch }) => {
    const cb = CIRCUIT_BADGE[ch.circuit_state] || {}
    const ob = OWNER_BADGE[ch.channel_owner] || {}
    return (
      <tr>
        <td>
          <span className={`badge ${ob.cls}`} style={{ fontSize: '0.65rem' }}>{ob.label}</span>{' '}
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginLeft: 4 }}>{ch.channel_type}</span>
        </td>
        <td>
          <div style={{ fontWeight: 600 }}>{ch.account_name}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontFamily: 'monospace' }}>{ch.account_number}</div>
        </td>
        <td>
          <div style={{ fontWeight: 500 }}>{ch.client_name}</div>
          <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{ch.client_email}</div>
        </td>
        <td>
          <span className={`badge ${cb.cls}`}>{cb.label}</span>
          {ch.consecutive_errors > 0 && (
            <div style={{ fontSize: '0.68rem', color: '#ef4444', marginTop: 2 }}>{ch.consecutive_errors}x error</div>
          )}
          {ch.last_error_message && (
            <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: 2, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={ch.last_error_message}>
              {ch.last_error_message}
            </div>
          )}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ch.session_active ? '#10b981' : '#6b7280', flexShrink: 0 }} />
            <span style={{ fontSize: '0.75rem', color: ch.session_active ? '#10b981' : 'var(--text-muted)' }}>
              {ch.session_active ? 'Login' : 'Offline'}
            </span>
          </div>
          {ch.session_updated_at && (
            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
              {new Date(ch.session_updated_at).toLocaleString('id-ID')}
            </div>
          )}
        </td>
        <td style={{ textAlign: 'center', fontWeight: 700, color: ch.pending_invoices > 0 ? '#f59e0b' : 'var(--text-muted)' }}>
          {ch.pending_invoices}
        </td>
        <td className="text-sm text-muted">
          {ch.last_success_at ? new Date(ch.last_success_at).toLocaleString('id-ID') : '—'}
        </td>
        <td>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: ch.is_active ? '#10b981' : '#ef4444', flexShrink: 0 }} />
            <span style={{ fontSize: '0.75rem', color: ch.is_active ? '#10b981' : '#ef4444' }}>
              {ch.is_active ? 'Aktif' : 'Pause'}
            </span>
          </div>
        </td>
      </tr>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Channel Monitor</h1>
          <p className="page-subtitle">{channels.length} channel total — {channels.filter(c => c.circuit_state === 'open').length} circuit open</p>
        </div>
      </div>

      {/* Summary badges */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          { label: 'Total', val: channels.length, color: '#6366f1' },
          { label: 'Login', val: channels.filter(c => c.session_active).length, color: '#10b981' },
          { label: 'Circuit Open', val: channels.filter(c => c.circuit_state === 'open').length, color: '#ef4444' },
          { label: 'Pending Invoice', val: channels.reduce((s, c) => s + c.pending_invoices, 0), color: '#f59e0b' },
        ].map(({ label, val, color }) => (
          <div key={label} style={{ padding: '8px 16px', borderRadius: 10, background: `${color}15`, border: `1px solid ${color}30`, fontSize: '0.82rem', fontWeight: 700, color }}>
            {val} <span style={{ fontWeight: 400, opacity: 0.8 }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16 }}>
        <input type="text" placeholder="Cari nama akun, merchant, tipe channel..." value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: '100%', maxWidth: 400, boxSizing: 'border-box', padding: '9px 14px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem', outline: 'none' }}
        />
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 64 }}><div className="spinner" /></div>
      ) : (
        <>
          {/* Platform channels */}
          {platformChannels.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8, marginTop: 4 }}>
                Channel Platform ({platformChannels.length})
              </div>
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="table-wrap">
                  <table>
                    <thead><tr>
                      <th>Tipe</th><th>Akun</th><th>Merchant</th><th>Circuit</th>
                      <th>Session</th><th>Pending</th><th>Last Sukses</th><th>Status</th>
                    </tr></thead>
                    <tbody>{platformChannels.map(ch => <ChannelRow key={ch.id} ch={ch} />)}</tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* Client channels */}
          {clientChannels.length > 0 && (
            <>
              <div style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                Channel Merchant ({clientChannels.length})
              </div>
              <div className="card">
                <div className="table-wrap">
                  <table>
                    <thead><tr>
                      <th>Tipe</th><th>Akun</th><th>Merchant</th><th>Circuit</th>
                      <th>Session</th><th>Pending</th><th>Last Sukses</th><th>Status</th>
                    </tr></thead>
                    <tbody>{clientChannels.map(ch => <ChannelRow key={ch.id} ch={ch} />)}</tbody>
                  </table>
                </div>
              </div>
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
