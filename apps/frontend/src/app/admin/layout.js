'use client'
import { useEffect, useState } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, Users, Wallet, Receipt,
  Settings, Building2, LogOut, ShieldCheck,
  ArrowLeftRight, Activity, BookOpen, Send, Crown
} from 'lucide-react'
import LogoIcon from '@/components/LogoIcon'

const ADMIN_NAV = [
  { href: '/admin',              label: 'Dashboard',    icon: LayoutDashboard, exact: true },
  { href: '/admin/merchants',    label: 'Merchant',     icon: Users },
  { href: '/admin/subscriptions',label: 'Langganan',    icon: Crown },
  { href: '/admin/invoices',     label: 'Invoice',      icon: Receipt },
  { href: '/admin/transactions', label: 'Transaksi',    icon: ArrowLeftRight },
  { href: '/admin/withdrawals',  label: 'Withdrawal',   icon: Wallet },
  { href: '/admin/kyc',          label: 'KYC Review',   icon: ShieldCheck },
  { href: '/admin/disbursements',label: 'Disbursement', icon: Send },
  { href: '/admin/channels',     label: 'Channel',      icon: Building2 },
  { href: '/admin/scraping-logs',label: 'Scraping Log',  icon: Activity },
  { href: '/admin/ledger',       label: 'Ledger',       icon: BookOpen },
  { href: '/admin/webhook-logs', label: 'Webhook Log',  icon: Send },
  { href: '/admin/settings',     label: 'Pengaturan',   icon: Settings },
]

export default function AdminLayout({ children }) {
  const { user, loading, logout } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(() => {
    if (!loading) {
      if (!user) { router.push('/login'); return }
      if (!user.is_admin) { router.push('/dashboard'); return }
    }
  }, [user, loading, router])

  if (loading) return <div className="loading"><div className="spinner" /></div>
  if (!user?.is_admin) return null

  const initials = user.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className="layout">
      <button className="mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
        {sidebarOpen ? '✕' : '☰'}
      </button>
      <div className={`sidebar-overlay ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)} />
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <LogoIcon size={20} />
          <span className="logo-text">Admin Panel</span>
        </div>

        {/* Admin badge */}
        <div style={{
          margin: '0 12px 12px',
          padding: '6px 12px',
          borderRadius: 8,
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.2)',
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: '0.72rem', fontWeight: 700, color: '#ef4444',
          textTransform: 'uppercase', letterSpacing: '0.05em',
        }}>
          <ShieldCheck size={13} /> Platform Admin
        </div>

        <nav className="sidebar-nav">
          {ADMIN_NAV.map(item => {
            const Icon = item.icon
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${active ? 'active' : ''}`}
                onClick={() => setSidebarOpen(false)}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* Back to merchant dashboard */}
        <div style={{ padding: '0 12px', marginTop: 8 }}>
          <Link href="/dashboard" className="btn btn-ghost btn-sm" style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }} onClick={() => setSidebarOpen(false)}>
            ← Dashboard Merchant
          </Link>
        </div>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar" style={{ background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
              {initials}
            </div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user.name}</div>
              <div className="sidebar-user-plan" style={{ color: '#ef4444' }}>Administrator</div>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%', marginTop: 8 }} onClick={logout}>
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}
