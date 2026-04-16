'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * /impersonate?token=xxx&name=Budi&email=budi@example.com
 *
 * Halaman perantara: simpan token impersonasi ke sessionStorage → redirect dashboard.
 * TIDAK langsung api.setToken() karena AuthContext akan race-condition dengan /restore.
 * AuthContext akan cek sessionStorage dan pakai token ini sebagai gantinya.
 */
export default function ImpersonatePage() {
  const router = useRouter()

  useEffect(() => {
    const search = new URLSearchParams(window.location.search)
    const token = search.get('token')
    const name  = search.get('name')
    const email = search.get('email')

    if (!token) {
      router.replace('/dashboard')
      return
    }

    // Simpan token + info sesi ke sessionStorage
    // AuthContext akan membaca ini dan skip /restore
    sessionStorage.setItem('impersonation', JSON.stringify({
      token,
      name:  decodeURIComponent(name  || ''),
      email: decodeURIComponent(email || ''),
      exp:   Date.now() + 900 * 1000,
    }))

    // Full page navigation agar AuthContext re-mount dan baca sessionStorage
    window.location.href = '/dashboard'
  }, [])

  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg-primary)', flexDirection: 'column', gap: 16
    }}>
      <div className="spinner" style={{ width: 36, height: 36 }} />
      <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Memuat sesi...</div>
    </div>
  )
}
