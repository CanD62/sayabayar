'use client'
import { useEffect, useState, useRef, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'

function VerifyEmailContent() {
  const searchParams = useSearchParams()
  const token        = searchParams.get('token')

  const [status, setStatus] = useState('loading') // 'loading' | 'success' | 'error' | 'no_token'
  const [message, setMessage] = useState('')
  const calledRef = useRef(false)

  useEffect(() => {
    if (!token) {
      setStatus('no_token')
      return
    }
    // Guard: jangan panggil dua kali di React Strict Mode / double render
    if (calledRef.current) return
    calledRef.current = true

    const verify = async () => {
      try {
        const res = await api.request(`/v1/auth/verify-email?token=${token}`)
        setMessage(res.data?.message || 'Email berhasil diverifikasi!')
        setStatus('success')
      } catch (err) {
        setMessage(err.message || 'Verifikasi gagal. Link mungkin sudah kadaluarsa.')
        setStatus('error')
      }
    }

    verify()
  }, [token])

  const iconMap = {
    loading: { emoji: null, bg: '#6366f1', label: 'Memverifikasi...' },
    success: { emoji: '✓',  bg: 'linear-gradient(135deg, #22c55e, #16a34a)' },
    error:   { emoji: '✕',  bg: 'linear-gradient(135deg, #ef4444, #dc2626)' },
    no_token:{ emoji: '⚠️', bg: 'linear-gradient(135deg, #f97316, #ea580c)' },
  }

  const ic = iconMap[status]

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <LogoIcon size={22} />
          <span className="logo-text">Saya Bayar</span>
        </div>

        <div style={{ textAlign: 'center', padding: '8px 0 24px' }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: ic.bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 20px', fontSize: 28,
            transition: 'background 0.3s'
          }}>
            {status === 'loading' ? (
              <div style={{
                width: 28, height: 28, border: '3px solid rgba(255,255,255,0.3)',
                borderTopColor: '#fff', borderRadius: '50%',
                animation: 'spin 0.8s linear infinite'
              }} />
            ) : ic.emoji}
          </div>

          {status === 'loading' && (
            <>
              <h1 className="auth-title" style={{ marginBottom: 8 }}>Memverifikasi Email</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                Mohon tunggu sebentar...
              </p>
            </>
          )}

          {status === 'success' && (
            <>
              <h1 className="auth-title" style={{ marginBottom: 8, color: '#16a34a' }}>Email Terverifikasi!</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                {message}
              </p>
              <Link href="/login" className="btn btn-primary" style={{ display: 'inline-block' }}>
                Masuk ke Dashboard
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <h1 className="auth-title" style={{ marginBottom: 8 }}>Verifikasi Gagal</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                {message}
              </p>
              <Link href="/register" className="btn btn-primary" style={{ display: 'inline-block', marginBottom: 12 }}>
                Daftar Ulang
              </Link>
              <br />
              <Link href="/login" style={{ fontSize: 13, color: 'var(--primary)' }}>
                Sudah punya akun? Masuk di sini
              </Link>
            </>
          )}

          {status === 'no_token' && (
            <>
              <h1 className="auth-title" style={{ marginBottom: 8 }}>Link Tidak Valid</h1>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
                Link verifikasi ini tidak valid. Pastikan Anda mengklik link dari email yang kami kirim.
              </p>
              <Link href="/register" className="btn btn-primary" style={{ display: 'inline-block' }}>
                Kembali ke Registrasi
              </Link>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailContent />
    </Suspense>
  )
}
