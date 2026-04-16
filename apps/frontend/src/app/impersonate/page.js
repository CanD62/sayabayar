'use client'
import { useEffect } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'

/**
 * /impersonate?token=xxx&name=Budi&email=budi@example.com
 *
 * Halaman perantara: set token impersonasi → simpan info sesi → redirect ke dashboard.
 * Tidak ada UI yang ditampilkan (hanya spinner), proses berlangsung di useEffect.
 */
export default function ImpersonatePage() {
  const params = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const token = params.get('token')
    const name  = params.get('name')
    const email = params.get('email')

    if (!token) {
      router.replace('/dashboard')
      return
    }

    // Set token ke ApiClient (in-memory)
    api.setToken(token)

    // Simpan flag impersonasi ke sessionStorage (hilang saat tab ditutup)
    // Tidak pakai localStorage agar sesi asli admin tidak terganggu
    sessionStorage.setItem('impersonation', JSON.stringify({
      name:  decodeURIComponent(name  || ''),
      email: decodeURIComponent(email || ''),
      exp:   Date.now() + 900 * 1000, // 15 menit dari sekarang (UTC ms)
    }))

    router.replace('/dashboard')
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
