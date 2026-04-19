'use client'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { RefreshCw, ShieldAlert, Clock3 } from 'lucide-react'
import AdminTable from '@/components/AdminTable'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(Number(n || 0)))
const FIXABLE_ISSUE = 'INVOICE_PAID_MISSING_LEDGER_CREDIT'

const DOMAIN_TABS = [
  { key: 'all', label: 'Semua Domain' },
  { key: 'invoice_ledger', label: 'Invoice vs Ledger' },
  { key: 'withdrawal_provider', label: 'Withdrawal vs Provider' },
  { key: 'disbursement_provider', label: 'Disbursement vs Provider' },
]

const SEVERITY_BADGE = {
  low: { label: 'Low', cls: 'badge-info' },
  medium: { label: 'Medium', cls: 'badge-warning' },
  high: { label: 'High', cls: 'badge-danger' },
}

export default function AdminReconciliationPage() {
  const [domain, setDomain] = useState('all')
  const [severity, setSeverity] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [payload, setPayload] = useState(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(null)
  const [actionState, setActionState] = useState({ issueId: '', mode: '' })
  const perPage = 20

  const load = async (p = page, d = domain, s = severity) => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(p), per_page: String(perPage), domain: d })
      if (s) params.set('severity', s)
      const res = await api.get(`/v1/admin/reconciliation?${params.toString()}`)
      setPayload(res)
    } catch (err) {
      setError(err.message || 'Gagal memuat data reconciliation')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(1, domain, severity); setPage(1) }, [domain, severity])
  useEffect(() => { load(page, domain, severity) }, [page])

  const summary = payload?.data?.summary || {
    invoice_ledger: { count: 0, impact_amount: 0 },
    withdrawal_provider: { count: 0, impact_amount: 0 },
    disbursement_provider: { count: 0, impact_amount: 0 },
    total: { count: 0, impact_amount: 0 }
  }
  const rows = payload?.data?.data || []
  const pg = payload?.data?.pagination || { page: 1, total_pages: 1, total: 0 }
  const isActionLoading = (issueId, mode) => actionState.issueId === issueId && actionState.mode === mode

  const runDry = async (row) => {
    setNotice('')
    setError('')
    setActionState({ issueId: row.id, mode: 'dry' })
    try {
      const res = await api.post('/v1/admin/reconciliation/dry-run', {
        issue_id: row.id,
        issue_type: row.issue_type,
        entity_id: row.entity_id,
      })
      setPreview(res?.data?.preview || null)
      setNotice('Dry-run berhasil. Preview siap untuk dieksekusi.')
    } catch (err) {
      setError(err.message || 'Dry-run gagal')
    } finally {
      setActionState({ issueId: '', mode: '' })
    }
  }

  const runExecute = async (row) => {
    setNotice('')
    setError('')
    const typed = window.prompt(`Ketik FIX untuk menjalankan aksi pada ${row.reference || row.entity_id}`)
    if (typed !== 'FIX') return

    setActionState({ issueId: row.id, mode: 'execute' })
    try {
      const res = await api.post('/v1/admin/reconciliation/execute', {
        issue_id: row.id,
        issue_type: row.issue_type,
        entity_id: row.entity_id,
        confirm_text: 'FIX',
      })
      setNotice(res?.data?.message || 'Execute fix berhasil.')
      setPreview(null)
      await load(page, domain, severity)
    } catch (err) {
      setError(err.message || 'Execute fix gagal')
    } finally {
      setActionState({ issueId: '', mode: '' })
    }
  }

  const renderActionButtons = (row) => {
    const fixable = row.issue_type === FIXABLE_ISSUE
    if (!fixable) {
      return (
        <button className="btn btn-sm btn-ghost" disabled title="Belum didukung untuk issue ini">
          Soon
        </button>
      )
    }
    return (
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          className="btn btn-sm btn-ghost"
          disabled={isActionLoading(row.id, 'dry')}
          onClick={() => runDry(row)}
        >
          {isActionLoading(row.id, 'dry') ? 'Dry-run…' : 'Dry-run'}
        </button>
        <button
          className="btn btn-sm btn-primary"
          disabled={isActionLoading(row.id, 'execute')}
          onClick={() => runExecute(row)}
        >
          {isActionLoading(row.id, 'execute') ? 'Executing…' : 'Execute'}
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Reconciliation</h1>
          <p className="page-subtitle">
            Deteksi selisih invoice/ledger/provider (read-only, dry-run).
          </p>
        </div>
        <button className="btn btn-ghost" style={{ gap: 8 }} onClick={() => load(page, domain, severity)}>
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      <div className="admin-badges">
        <div className="admin-badge" style={{ background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.3)', color: '#3b82f6' }}>
          {fmt(summary.invoice_ledger.count)} invoice↔ledger
        </div>
        <div className="admin-badge" style={{ background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b' }}>
          {fmt(summary.withdrawal_provider.count)} withdrawal↔provider
        </div>
        <div className="admin-badge" style={{ background: 'rgba(168,85,247,0.15)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7' }}>
          {fmt(summary.disbursement_provider.count)} disbursement↔provider
        </div>
        <div className="admin-badge" style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
          Rp {fmt(summary.total.impact_amount)} impacted
        </div>
      </div>

      <div className="admin-filter-bar">
        <div className="admin-filter-pills">
          {DOMAIN_TABS.map(t => (
            <button key={t.key} className={`btn btn-sm ${domain === t.key ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setDomain(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          style={{ padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
        >
          <option value="">Semua Severity</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {notice && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(16,185,129,0.35)', background: 'rgba(16,185,129,0.08)' }}>
          <div style={{ color: '#10b981', fontWeight: 600 }}>{notice}</div>
        </div>
      )}

      {error && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)' }}>
          <div style={{ color: '#ef4444', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
            <ShieldAlert size={16} /> {error}
          </div>
        </div>
      )}

      {preview && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 700 }}>Preview Dry-run</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setPreview(null)}>Tutup</button>
          </div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: 10 }}>
            {preview.reference} • {preview.issue_type}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ fontSize: '0.82rem' }}>
              Ledger baru: <strong>{preview?.after_snapshot?.ledger_to_create?.type || '-'}</strong> • Rp {fmt(preview?.after_snapshot?.ledger_to_create?.amount || 0)}
            </div>
            <div style={{ fontSize: '0.82rem' }}>
              Balance Pending: <strong>Rp {fmt(preview?.before_snapshot?.balances?.balance_pending || 0)}</strong> → <strong>Rp {fmt(preview?.after_snapshot?.balances_after?.balance_pending || 0)}</strong>
            </div>
            <div style={{ fontSize: '0.82rem' }}>
              Balance Available: <strong>Rp {fmt(preview?.before_snapshot?.balances?.balance_available || 0)}</strong> → <strong>Rp {fmt(preview?.after_snapshot?.balances_after?.balance_available || 0)}</strong>
            </div>
            <div style={{ fontSize: '0.82rem' }}>
              Total Earned: <strong>Rp {fmt(preview?.before_snapshot?.balances?.total_earned || 0)}</strong> → <strong>Rp {fmt(preview?.after_snapshot?.balances_after?.total_earned || 0)}</strong>
            </div>
          </div>
        </div>
      )}

      <AdminTable
        columns={[
          { key: 'domain', label: 'Domain' },
          { key: 'issue', label: 'Issue Type' },
          { key: 'severity', label: 'Severity' },
          { key: 'entity', label: 'Entity' },
          { key: 'impact', label: 'Impact' },
          { key: 'reason', label: 'Reason' },
          { key: 'detected', label: 'Detected At' },
          { key: 'action', label: 'Fix Cepat' },
        ]}
        data={rows}
        loading={loading}
        emptyText="Tidak ada mismatch untuk filter ini"
        cardTitle={(r) => {
          const sev = SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.low
          return (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>{r.domain}</div>
              <span className={`badge ${sev.cls}`}>{sev.label}</span>
            </div>
          )
        }}
        cardAccent={(r) => r.severity === 'high' ? '#ef4444' : r.severity === 'medium' ? '#f59e0b' : '#3b82f6'}
        renderRow={(r) => {
          const sev = SEVERITY_BADGE[r.severity] || SEVERITY_BADGE.low
          return {
            cells: {
              domain: <span style={{ fontSize: '0.78rem', fontWeight: 700 }}>{r.domain}</span>,
              issue: <span className="font-mono" style={{ fontSize: '0.72rem' }}>{r.issue_type}</span>,
              severity: <span className={`badge ${sev.cls}`}>{sev.label}</span>,
              entity: (
                <div style={{ lineHeight: 1.35 }}>
                  <div style={{ fontWeight: 700 }}>{r.entity_type}</div>
                  <div className="font-mono" style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{r.reference || r.entity_id}</div>
                </div>
              ),
              impact: <span style={{ fontWeight: 700, color: '#ef4444' }}>Rp {fmt(r.impact_amount)}</span>,
              reason: <span style={{ fontSize: '0.76rem' }}>{r.reason}</span>,
              detected: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  <Clock3 size={12} /> {new Date(r.detected_at).toLocaleString('id-ID')}
                </span>
              ),
              action: (
                renderActionButtons(r)
              ),
            },
            actions: (
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
                {renderActionButtons(r)}
              </div>
            )
          }
        }}
        pagination={pg.total_pages > 1 ? {
          page: pg.page,
          totalPages: pg.total_pages,
          onPrev: () => setPage(p => Math.max(1, p - 1)),
          onNext: () => setPage(p => Math.min(pg.total_pages, p + 1))
        } : null}
      />
    </>
  )
}
