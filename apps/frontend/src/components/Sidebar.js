'use client'
import { useAuth } from '@/lib/AuthContext'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import {
  LayoutDashboard, FileText, Building2, Wallet,
  Star, Link2, KeyRound, UserCog, LogOut, Menu, ShieldCheck, Send
} from 'lucide-react'
import LogoIcon from '@/components/LogoIcon'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/invoices', label: 'Invoice', icon: FileText },
  { href: '/dashboard/channels', label: 'Channel', icon: Building2 },
  { href: '/dashboard/balance', label: 'Saldo', icon: Wallet },
  { href: '/dashboard/disbursement', label: 'Disbursement', icon: Send, requireRole: 'disbursement_user' },
  { href: '/dashboard/billing', label: 'Billing', icon: Star },
  { href: '/dashboard/webhooks', label: 'Webhook', icon: Link2 },
  { href: '/dashboard/api-keys', label: 'API Keys', icon: KeyRound },
  { href: '/dashboard/profile', label: 'Profil', icon: UserCog },
]

export default function Sidebar({ isOpen, onClose }) {
  const { user, logout } = useAuth()
  const pathname = usePathname()

  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <>
      <div className={`sidebar-overlay ${isOpen ? 'open' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
        <div className="sidebar-logo">
          <LogoIcon size={20} />
          <span className="logo-text">Saya Bayar</span>
        </div>

        <nav className="sidebar-nav">
          {NAV_ITEMS
            .filter(item => !item.requireRole || user?.role === item.requireRole)
            .map(item => {
            const Icon = item.icon
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`sidebar-link ${pathname === item.href ? 'active' : ''}`}
                onClick={onClose}
              >
                <Icon size={18} />
                {item.label}
              </Link>
            )
          })}
          {/* Admin link — only visible to platform admin */}
          {user?.is_admin && (
            <Link
              href="/admin"
              className={`sidebar-link ${pathname.startsWith('/admin') ? 'active' : ''}`}
              onClick={onClose}
              style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)', marginTop: 8 }}
            >
              <ShieldCheck size={18} />
              Admin Panel
            </Link>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="sidebar-user-avatar">{initials}</div>
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{user?.name}</div>
              <div className="sidebar-user-plan">{user?.plan?.name || 'Free'}</div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: 8 }}
            onClick={logout}
          >
            <LogOut size={14} />
            Logout
          </button>
        </div>
      </aside>
    </>
  )
}
