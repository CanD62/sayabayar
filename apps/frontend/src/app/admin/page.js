'use client'
import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { Users, Receipt, Wallet, Building2, TrendingUp, AlertCircle, CheckCircle2, Clock, Zap, ZapOff } from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(Math.round(n))

function StatCard({ icon: Icon, label, value, sub, color = '#10b981', prefix = '' }) {
  return (
    <div className="admin-stat-card" style={{
      background: 'rgba(26,28,36,0.8)',
      border: '1px solid rgba(40,44,54,0.8)',
      borderRadius: 16,
      padding: '20px 24px',
      backdropFilter: 'blur(12px)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: color, borderRadius: '16px 16px 0 0' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={20} color={color} />
        </div>
      </div>
      <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1, marginBottom: 4 }}>
        {prefix}{typeof value === 'number' ? fmt(value) : value}
      </div>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: sub ? 6 : 0 }}>
        {label}
      </div>
      {sub && <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{sub}</div>}
    </div>
  )
}

function MiniBar({ data }) {
  if (!data?.length) return null
  const maxVol = Math.max(...data.map(d => d.volume), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 60 }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: '100%', background: i === data.length - 1 ? '#10b981' : 'rgba(16,185,129,0.3)',
            borderRadius: 4,
            height: `${Math.max(4, Math.round((d.volume / maxVol) * 50))}px`,
            transition: 'height 0.3s ease',
          }} />
          <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)' }}>
            {new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null)
  const [withdrawals, setWithdrawals] = useState([])
  const [loading, setLoading] = useState(true)
  const [toggling, setToggling] = useState(false)

  const load = async () => {
    try {
      const [s, w] = await Promise.all([
        api.get('/v1/admin/stats'),
        api.get('/v1/admin/withdrawals?status=pending&per_page=5'),
      ])
      setStats(s.data)
      setWithdrawals(w.data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleAutoProcess = async () => {
    if (!stats) return
    setToggling(true)
    try {
      const res = await api.patch('/v1/admin/provider/auto-process', {
        enabled: !stats.system.flip_auto_process
      })
      setStats(s => ({ ...s, system: { ...s.system, flip_auto_process: res.data.auto_process } }))
    } catch (e) {
      console.error(e)
    } finally {
      setToggling(false)
    }
  }

  if (loading) return <div style={{ textAlign: 'center', padding: 80 }}><div className="spinner" /></div>

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Admin Dashboard</h1>
          <p className="page-subtitle">Platform overview — {new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        </div>
        <button
          className={`btn ${stats?.system.flip_auto_process ? 'btn-danger' : 'btn-primary'}`}
          onClick={toggleAutoProcess}
          disabled={toggling}
          style={{ gap: 8 }}
        >
          {stats?.system.flip_auto_process ? <><ZapOff size={16} /> Auto-Process ON</> : <><Zap size={16} /> Auto-Process OFF</>}
        </button>
      </div>

      {/* Stat Grid */}
      <div className="admin-stats-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
        <StatCard icon={Users} label="Total Merchant" value={stats?.merchants.total} sub={`${stats?.merchants.suspended} suspended`} color="#6366f1" />
        <StatCard icon={Receipt} label="Invoice Hari Ini" value={stats?.invoices.today} sub={`Bulan ini: ${fmt(stats?.invoices.this_month || 0)}`} color="#f59e0b" />
        <StatCard icon={TrendingUp} label="Volume Hari Ini" value={stats?.invoices.paid_today_volume} sub={`${fmt(stats?.invoices.paid_today_count || 0)} invoice lunas`} color="#10b981" prefix="Rp " />
        <StatCard icon={TrendingUp} label="Volume Bulan Ini" value={stats?.invoices.paid_month_volume} sub={`${fmt(stats?.invoices.paid_month_count || 0)} invoice lunas`} color="#10b981" prefix="Rp " />
        <StatCard icon={Wallet} label="Saldo Flip" value={stats?.balances.flip_balance ?? '—'} sub={stats?.system.flip_email} color="#8b5cf6" prefix={stats?.balances.flip_balance != null ? 'Rp ' : ''} />
        <StatCard icon={AlertCircle} label="Withdrawal Pending" value={stats?.withdrawals.pending_count} sub={`Volume bulan: Rp ${fmt(stats?.withdrawals.month_volume || 0)}`} color="#ef4444" />
        <StatCard icon={Building2} label="Channel Aktif" value={stats?.system.active_channels} color="#06b6d4" />
        <StatCard icon={Wallet} label="Saldo Merchant" value={stats?.balances.total_merchant_available} sub={`Pending: Rp ${fmt(stats?.balances.total_merchant_pending || 0)}`} color="#fbbf24" prefix="Rp " />
        <StatCard icon={TrendingUp} label="Pendapatan Platform" value={stats?.revenue?.unique_code_month} sub="Kode unik bulan ini" color="#f472b6" prefix="Rp " />
        <StatCard icon={TrendingUp} label="Pendapatan Langganan" value={stats?.revenue?.subscription_month} sub={`${fmt(stats?.revenue?.subscription_count || 0)} merchant bulan ini`} color="#a78bfa" prefix="Rp " />
      </div>

      {/* 2-column: chart + pending withdrawals */}
      <div className="admin-dashboard-bottom">
        {/* 7-day volume chart */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span>Volume 7 Hari Terakhir</span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 400 }}>
              Total: Rp {fmt(stats?.chart_7d?.reduce((s, d) => s + d.volume, 0) || 0)}
            </span>
          </div>
          <MiniBar data={stats?.chart_7d} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 4, marginTop: 12 }}>
            {stats?.chart_7d?.map((d, i) => (
              <div key={i} style={{ textAlign: 'center', fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                {d.count > 0 && <div style={{ color: '#10b981', fontWeight: 700 }}>{d.count}</div>}
              </div>
            ))}
          </div>
        </div>

        {/* Pending withdrawals */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ fontWeight: 700, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} color="#ef4444" /> Withdrawal Perlu Aksi
            </span>
            <a href="/admin/withdrawals" style={{ fontSize: '0.75rem', color: 'var(--accent)', textDecoration: 'none' }}>Lihat semua →</a>
          </div>
          {withdrawals.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              <CheckCircle2 size={28} color="#10b981" style={{ marginBottom: 8 }} />
              <div>Tidak ada withdrawal pending</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {withdrawals.map(w => (
                <div key={w.id} style={{
                  padding: '10px 12px', borderRadius: 10,
                  background: 'rgba(239,68,68,0.05)',
                  border: '1px solid rgba(239,68,68,0.15)',
                  fontSize: '0.8rem',
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2, flexWrap: 'wrap', gap: 4 }}>
                    <span style={{ fontWeight: 700 }}>Rp {fmt(w.amount_received)}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.72rem' }}>
                      <Clock size={10} style={{ display: 'inline', marginRight: 3 }} />
                      {new Date(w.requested_at).toLocaleDateString('id-ID')}
                    </span>
                  </div>
                  <div style={{ color: 'var(--text-secondary)' }}>{w.client_name} → {w.destination_bank} {w.destination_account}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
