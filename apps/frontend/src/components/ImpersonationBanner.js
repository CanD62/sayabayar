'use client'
import { useState, useEffect, useRef } from 'react'
import { ShieldAlert, X, Clock } from 'lucide-react'
import { api } from '@/lib/api'

/**
 * ImpersonationBanner — banner merah sticky di atas dashboard.
 * Muncul saat sessionStorage berisi flag 'impersonation'.
 * Menampilkan countdown hingga sesi berakhir dan tombol "Keluar".
 */
export default function ImpersonationBanner() {
  const [session, setSession] = useState(null)
  const [timeLeft, setTimeLeft] = useState('')
  const bannerRef = useRef(null)

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('impersonation')
      if (raw) setSession(JSON.parse(raw))
    } catch { }
  }, [])

  // Sync CSS variable with actual banner height (supports wrapped text on mobile)
  useEffect(() => {
    const root = document.documentElement
    const syncHeight = () => {
      const h = bannerRef.current?.offsetHeight || 0
      root.style.setProperty('--impersonation-banner-height', `${h}px`)
    }

    if (!session) {
      root.style.removeProperty('--impersonation-banner-height')
      return
    }

    syncHeight()
    const ro = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(syncHeight)
      : null
    if (ro && bannerRef.current) ro.observe(bannerRef.current)
    window.addEventListener('resize', syncHeight)

    return () => {
      if (ro) ro.disconnect()
      window.removeEventListener('resize', syncHeight)
      root.style.removeProperty('--impersonation-banner-height')
    }
  }, [session])

  // Countdown real-time
  useEffect(() => {
    if (!session?.exp) return
    const tick = () => {
      const diff = session.exp - Date.now()
      if (diff <= 0) {
        setTimeLeft('Sesi berakhir')
        handleExit()
        return
      }
      const m = Math.floor(diff / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setTimeLeft(`${m}:${String(s).padStart(2, '0')}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [session])

  const handleExit = () => {
    sessionStorage.removeItem('impersonation')
    api.clearToken()
    window.close()
    // fallback: jika window.close() tidak bekerja (bukan pop-up), redirect ke login
    setTimeout(() => { window.location.href = '/login' }, 300)
  }

  if (!session) return null

  return (
    <div ref={bannerRef} style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(90deg, #dc2626, #b91c1c)',
      color: '#fff', padding: '10px 20px',
      display: 'flex', alignItems: 'center', gap: 12,
      fontSize: '0.84rem', fontWeight: 600,
      boxShadow: '0 2px 12px rgba(220,38,38,0.4)',
    }}>
      <ShieldAlert size={16} style={{ flexShrink: 0 }} />

      <span style={{ flex: 1 }}>
        🔴 Sedang melihat sebagai:{' '}
        <strong>{session.name || session.email}</strong>
        {session.name && session.email && (
          <span style={{ fontWeight: 400, opacity: 0.85 }}> ({session.email})</span>
        )}
        {' '}— Sesi admin, aksi destruktif diblokir
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, opacity: 0.9 }}>
        <Clock size={13} />
        <span style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{timeLeft}</span>
      </div>

      <button
        onClick={handleExit}
        style={{
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.35)',
          borderRadius: 8, color: '#fff', cursor: 'pointer',
          padding: '4px 14px', fontSize: '0.8rem', fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'background 0.15s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.32)'}
        onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
        title="Keluar dari sesi Login As"
      >
        <X size={13} /> Keluar
      </button>
    </div>
  )
}
