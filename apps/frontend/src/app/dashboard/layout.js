'use client'
import { useState, useEffect, useRef } from 'react'
import { useAuth } from '@/lib/AuthContext'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/Toast'
import Sidebar from '@/components/Sidebar'
import ImpersonationBanner from '@/components/ImpersonationBanner'
import { InvoiceEventProvider, useInvoiceEvents } from '@/lib/InvoiceEventContext'
import { api } from '@/lib/api'

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

function DashboardLayoutInner({ children }) {
  const { user, loading, tokenVersion } = useAuth()
  const router = useRouter()
  const toast = useToast()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const esRef = useRef(null)

  const invoiceEvents = useInvoiceEvents()

  // ── SSE: realtime invoice notifications ──────────────────
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
          toast.success(
            `🎉 Invoice ${event.invoice_number} LUNAS — Rp ${fmt(event.amount)}`,
            { duration: 8000 }
          )
        } else if (event.event === 'invoice.expired') {
          toast.error(
            `⏰ Invoice ${event.invoice_number} telah expired`,
            { duration: 6000 }
          )
        } else if (event.event === 'invoice.cancelled') {
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
  }, [user, tokenVersion])

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
  }, [user, tokenVersion])

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

  return (
    <>
      <ImpersonationBanner />
      <div className="layout" style={{ paddingTop: typeof window !== 'undefined' && sessionStorage.getItem('impersonation') ? 42 : 0 }}>
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
