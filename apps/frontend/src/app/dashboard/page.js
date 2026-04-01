'use client'
import { useState, useEffect } from 'react'
import { FileText, Wallet, Clock, TrendingUp, ArrowDownRight } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { useInvoiceEvents } from '@/lib/InvoiceEventContext'
import { SkeletonStatGrid, SkeletonTable } from '@/components/Skeleton'

import { fmt, getInvoiceStatus } from '@/lib/format'


export default function DashboardPage() {
  const { user } = useAuth()
  const invoiceEvents = useInvoiceEvents()
  const [balance, setBalance] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    Promise.all([
      api.get('/v1/balance'),
      api.get('/v1/invoices?per_page=5')
    ]).then(([b, i]) => {
      setBalance(b.data)
      setInvoices(i.data)
    }).finally(() => setLoading(false))
  }
  useEffect(load, [])

  // ── SSE: auto-refresh stats + Invoice Terbaru ─────────────
  useEffect(() => {
    if (!invoiceEvents) return
    return invoiceEvents.onEvent((eventName) => {
      if (['invoice.paid', 'invoice.expired', 'invoice.cancelled', 'balance.settled', 'data.reload'].includes(eventName)) {
        load()
      }
    })
  }, [invoiceEvents])

  if (loading) return (<><SkeletonStatGrid count={4} /><SkeletonTable rows={5} cols={5} /></>)

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">Selamat datang, {user?.name}</p>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card">
          <Wallet size={32} className="stat-icon" />
          <div className="stat-label">Saldo Available</div>
          <div className="stat-value">Rp {fmt(balance?.balance_available || 0)}</div>
        </div>
        <div className="stat-card">
          <Clock size={32} className="stat-icon" />
          <div className="stat-label">Saldo Pending</div>
          <div className="stat-value">Rp {fmt(balance?.balance_pending || 0)}</div>
          <div className="stat-suffix">Akan cair H+2</div>
        </div>
        <div className="stat-card">
          <TrendingUp size={32} className="stat-icon" />
          <div className="stat-label">Total Earned</div>
          <div className="stat-value">Rp {fmt(balance?.total_earned || 0)}</div>
        </div>
        <div className="stat-card">
          <ArrowDownRight size={32} className="stat-icon" />
          <div className="stat-label">Total Withdrawn</div>
          <div className="stat-value">Rp {fmt(balance?.total_withdrawn || 0)}</div>
        </div>
      </div>

      <div className="card mobile-cards">
        <div className="card-header" style={{ padding: '16px 20px 0' }}>
          <h2 className="card-title">Invoice Terbaru</h2>
        </div>
        {invoices.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon"><FileText size={48} strokeWidth={1} /></div>
            <div className="empty-state-text">Belum ada invoice</div>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#Invoice</th><th>Customer</th><th>Amount</th><th>Status</th><th>Waktu</th></tr>
                </thead>
                <tbody>
                  {invoices.map(inv => {
                    const s = getInvoiceStatus(inv.status)
                    return (
                      <tr key={inv.id} className={`row-${inv.status}`}>
                        <td className="font-mono">{inv.invoice_number}</td>
                        <td>{inv.customer_name || '-'}</td>
                        <td>Rp {fmt(inv.amount)}</td>
                        <td><span className={`badge badge-${s.badge}`}>{s.label}</span></td>
                        <td className="text-sm text-muted">{new Date(inv.created_at).toLocaleString('id-ID')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {invoices.map(inv => {
              const s = getInvoiceStatus(inv.status)
              return (
                <div className="mobile-card" key={inv.id}>
                  <div className="mobile-card-header">
                    <div>
                      <div className="mobile-card-title">Rp {fmt(inv.amount)}</div>
                      <div className="text-sm text-muted" style={{ marginTop: 2 }}>{inv.invoice_number}</div>
                    </div>
                    <span className={`badge badge-${s.badge}`}>{s.label}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Customer</span>
                    <span>{inv.customer_name || '-'}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">Waktu</span>
                    <span className="text-sm">{new Date(inv.created_at).toLocaleString('id-ID')}</span>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </>
  )
}
