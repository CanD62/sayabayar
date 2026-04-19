'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { useToast } from '@/components/Toast'
import Sidebar from '@/components/Sidebar'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import LogoIcon from '@/components/LogoIcon'
import { InvoiceEventProvider, useInvoiceEvents } from '@/lib/InvoiceEventContext'
import { api } from '@/lib/api'
import { Plus, Bell } from 'lucide-react'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

function DashboardLayoutInner({ children }) {
  const { user, loading, tokenVersion } = useAuth()
  const router = useRouter()
  const toast = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [mobileNotifications, setMobileNotifications] = useState([])
  const [notifOpen, setNotifOpen] = useState(false)
  const esRef = useRef(null)
  const notifRef = useRef(null)

  const invoiceEvents = useInvoiceEvents()
  const NOTIF_STORAGE_KEY = 'pg:mobile:notifications:v1'

  // ── SSE: realtime invoice notifications ──────────────────
  const pushInvoiceNotification = useCallback((event) => {
    if (!event?.event || !event?.invoice_number) return
    if (!['invoice.paid', 'invoice.expired', 'invoice.cancelled'].includes(event.event)) return

    const title = event.event === 'invoice.paid'
      ? `Invoice ${event.invoice_number} lunas`
      : event.event === 'invoice.expired'
        ? `Invoice ${event.invoice_number} expired`
        : `Invoice ${event.invoice_number} dibatalkan`

    const subtitle = event.event === 'invoice.paid'
      ? `Rp ${fmt(event.amount || 0)}`
      : 'Periksa detail invoice di daftar'

    const item = {
      id: `${event.event}:${event.invoice_number}:${Date.now()}`,
      event: event.event,
      invoice_number: event.invoice_number,
      title,
      subtitle,
      created_at: Date.now(),
      read: false
    }

    setMobileNotifications(prev => [item, ...prev].slice(0, 20))
  }, [])

  const pushBalanceNotification = useCallback((event) => {
    if (event?.event !== 'balance.settled') return

    const item = {
      id: `balance:settled:${event.client_id || 'me'}:${event.amount || 0}:${Date.now()}`,
      event: 'balance.settled',
      title: 'Saldo settled siap ditarik',
      subtitle: `Rp ${fmt(event.amount || 0)}`,
      created_at: Date.now(),
      read: false
    }

    setMobileNotifications(prev => [item, ...prev].slice(0, 20))
  }, [])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) setMobileNotifications(parsed.slice(0, 20))
    } catch {}
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(mobileNotifications.slice(0, 20)))
    } catch {}
  }, [mobileNotifications])

  useEffect(() => {
    if (!notifOpen) return
    setMobileNotifications(prev => prev.map(n => ({ ...n, read: true })))
  }, [notifOpen])

  useEffect(() => {
    const onDocClick = (e) => {
      if (!notifRef.current) return
      if (!notifRef.current.contains(e.target)) setNotifOpen(false)
    }
    const onEsc = (e) => {
      if (e.key === 'Escape') setNotifOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onEsc)
    }
  }, [])

  useEffect(() => {
    if (!user) return

    const token = api.getToken()
    if (!token) return

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const url = `${API_URL}/v1/invoices/events?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es

    // Deteksi reconnect: onopen pertama = initial connect, berikutnya = reconnect
    let isFirstOpen = true
    es.onopen = () => {
      if (isFirstOpen) { isFirstOpen = false; return }
      // Reconnect → mungkin ada event yang terlewat → refresh data
      invoiceEvents?.emit('data.reload', {})
    }

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        invoiceEvents?.emit(event.event, event)
        if (event.event === 'invoice.paid') {
          pushInvoiceNotification(event)
          toast.success(
            `🎉 Invoice ${event.invoice_number} LUNAS — Rp ${fmt(event.amount)}`,
            { duration: 8000 }
          )
        } else if (event.event === 'invoice.expired') {
          pushInvoiceNotification(event)
          toast.error(
            `⏰ Invoice ${event.invoice_number} telah expired`,
            { duration: 6000 }
          )
        } else if (event.event === 'invoice.cancelled') {
          pushInvoiceNotification(event)
          toast.error(
            `🚫 Invoice ${event.invoice_number} dibatalkan`,
            { duration: 5000 }
          )
        }
      } catch {}
    }

    es.onerror = () => {
      // SSE auto-reconnects natively — onopen will fire when reconnected.
      // Token expiry is handled by tokenVersion dep: when api.js refreshes the token,
      // tokenVersion bumps, this effect re-runs, and a new EventSource is created
      // with the fresh token in the URL.
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [user, tokenVersion, pushInvoiceNotification])

  // ── SSE: realtime balance settlement notifications ────────
  useEffect(() => {
    if (!user) return

    const token = api.getToken()
    if (!token) return

    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'
    const url = `${API_URL}/v1/balance/events?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)

    let isFirstOpen = true
    es.onopen = () => {
      if (isFirstOpen) { isFirstOpen = false; return }
      invoiceEvents?.emit('data.reload', {})
    }

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data)
        invoiceEvents?.emit(event.event, event)
        if (event.event === 'balance.settled') {
          pushBalanceNotification(event)
          toast.success(
            `💰 Saldo Rp ${fmt(event.amount)} siap ditarik!`,
            { duration: 8000 }
          )
        }
      } catch {}
    }

    es.onerror = () => {
      // SSE auto-reconnects natively — onopen will fire when reconnected
    }

    return () => { es.close() }
  }, [user, tokenVersion, pushBalanceNotification])

  // ── Visibility: reload data saat user kembali ke tab ─────
  useEffect(() => {
    if (!user) return
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        invoiceEvents?.emit('data.reload', {})
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [user, invoiceEvents])

  useEffect(() => {
    if (!loading && !user) {
      router.push('/login')
    }
  }, [user, loading, router])

  if (loading) {
    return <div className="loading"><div className="spinner"></div></div>
  }

  if (!user) return null
  const initials = user?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || 'U'
  const unreadCount = mobileNotifications.filter(n => !n.read).length

  return (
    <>
      <ImpersonationBanner />
      <div className="layout">
        <div className="mobile-brand-bar">
          <LogoIcon size={24} />
          <span className="logo-text">Saya Bayar</span>
        </div>
        <div className="mobile-nav-bar">
          <div className="mobile-nav-actions">
            <Link href="/dashboard/invoices" className="mobile-nav-btn mobile-nav-btn-primary" title="Buat Invoice">
              <Plus size={14} />
              <span>Invoice</span>
            </Link>

            <div className="mobile-notif-wrap" ref={notifRef}>
              <button type="button" className="mobile-nav-btn" title="Notifikasi" onClick={() => setNotifOpen(v => !v)}>
                {unreadCount > 0 && <span className="mobile-notif-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                <Bell size={16} />
              </button>

              {notifOpen && (
                <div className="mobile-notif-panel">
                  <div className="mobile-notif-panel-head">
                    <strong>Notifikasi Invoice</strong>
                    <button type="button" className="mobile-notif-clear" onClick={() => setMobileNotifications([])}>Hapus</button>
                  </div>

                  {mobileNotifications.length === 0 ? (
                    <div className="mobile-notif-empty">Belum ada notifikasi.</div>
                  ) : (
                    mobileNotifications.map(n => (
                      <Link
                        key={n.id}
                        href="/dashboard/invoices"
                        className={`mobile-notif-item ${n.read ? '' : 'unread'}`}
                        onClick={() => setNotifOpen(false)}
                      >
                        <div className="mobile-notif-title">{n.title}</div>
                        <div className="mobile-notif-sub">{n.subtitle}</div>
                        <div className="mobile-notif-time">{new Date(n.created_at).toLocaleString('id-ID')}</div>
                      </Link>
                    ))
                  )}
                </div>
              )}
            </div>

            <Link href="/dashboard/profile" className="mobile-avatar-btn" title="Profil">
              {initials}
            </Link>
          </div>
        </div>
        <button className="mobile-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
          {sidebarOpen ? '✕' : '☰'}
        </button>
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <main className="main-content">
          {children}
        </main>
      </div>
    </>
  )
}

export default function DashboardLayout({ children }) {
  return (
    <InvoiceEventProvider>
      <DashboardLayoutInner>{children}</DashboardLayoutInner>
    </InvoiceEventProvider>
  )
}
