'use client'
import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useRedirectIfAuthenticated } from '@/lib/AuthContext'
import { api } from '@/lib/api'
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'
import GoogleSignInButton from '@/components/GoogleSignInButton'
import Script from 'next/script'

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_CF_TURNSTILE_SITE_KEY || ''
const TURNSTILE_ENABLED = !!TURNSTILE_SITE_KEY

export default function RegisterPage() {
  // ── Semua hooks wajib di atas sebelum return apapun ──
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  const [registeredEmail, setRegisteredEmail] = useState(null)
  const [turnstileToken, setTurnstileToken] = useState(null)
  const [turnstileReady, setTurnstileReady] = useState(false)

  const widgetRef = useRef(null)
  const widgetIdRef = useRef(null)

  const { register, loginWithGoogle } = useAuth()
  const router = useRouter()
  const { loading: authLoading } = useRedirectIfAuthenticated()

  // handleScriptLoad harus di atas semua return
  const handleScriptLoad = useCallback(() => {
    if (!TURNSTILE_ENABLED || !widgetRef.current || !window.turnstile) return
    widgetIdRef.current = window.turnstile.render(widgetRef.current, {
      sitekey: TURNSTILE_SITE_KEY,
      theme: 'dark',
      callback: (token) => setTurnstileToken(token),
      'expired-callback': () => setTurnstileToken(null),
      'error-callback': () => setTurnstileToken(null),
    })
    setTurnstileReady(true)
  }, [])

  // ── Early returns setelah semua hooks ────────────────
  if (authLoading) return null

  const resetTurnstile = () => {
    setTurnstileToken(null)
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
    }
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (TURNSTILE_ENABLED && !turnstileToken) {
      setError('Selesaikan tantangan keamanan terlebih dahulu.')
      return
    }

    setLoading(true)
    try {
      const res = await register(name, email, password, turnstileToken)
      setRegisteredEmail(res.email || email)
    } catch (err) {
      setError(err.message || 'Registrasi gagal')
      resetTurnstile()
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async (idToken) => {
    setError('')
    setLoading(true)
    try {
      await loginWithGoogle(idToken)
      router.push('/dashboard')
    } catch (err) {
      setError(err.message || 'Daftar dengan Google gagal')
    } finally {
      setLoading(false)
    }
  }

  const handleResend = async () => {
    if (!registeredEmail) return
    setResendLoading(true)
    setResendMsg('')
    try {
      await api.post('/v1/auth/resend-verification', { email: registeredEmail })
      setResendMsg('Email verifikasi telah dikirim ulang. Silakan cek inbox Anda.')
    } catch (err) {
      setResendMsg(err.message || 'Gagal mengirim ulang email.')
    } finally {
      setResendLoading(false)
    }
  }

  // ── State: setelah register berhasil ─────────────────
  if (registeredEmail) {
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
              background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: 28
            }}>
              ✉️
            </div>
            <h1 className="auth-title" style={{ marginBottom: 8 }}>Cek Email Anda</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>
              Kami mengirimkan link verifikasi ke:
            </p>
            <p style={{ fontWeight: 600, color: 'var(--text)', fontSize: 15, marginBottom: 20 }}>
              {registeredEmail}
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.7 }}>
              Klik link di email tersebut untuk mengaktifkan akun Anda.
              Link berlaku selama <strong>24 jam</strong>.
            </p>
          </div>

          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px',
            fontSize: 13, color: 'var(--text-muted)',
            marginBottom: 20
          }}>
            <strong style={{ color: 'var(--text)' }}>Tidak menerima email?</strong><br />
            Cek folder spam/junk Anda, atau klik tombol di bawah untuk mengirim ulang.
          </div>

          {resendMsg && (
            <div className="error-msg" style={{
              background: resendMsg.includes('Gagal') ? undefined : 'rgba(34,197,94,0.1)',
              borderColor: resendMsg.includes('Gagal') ? undefined : '#22c55e',
              color: resendMsg.includes('Gagal') ? undefined : '#15803d'
            }}>
              {resendMsg}
            </div>
          )}

          <button
            onClick={handleResend}
            disabled={resendLoading}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 12 }}
          >
            {resendLoading ? 'Mengirim...' : '📨 Kirim Ulang Email Verifikasi'}
          </button>

          <div className="auth-footer">
            <Link href="/login">← Kembali ke halaman login</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── State: form registrasi ────────────────────────────
  return (
    <>
      {TURNSTILE_ENABLED && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          onLoad={handleScriptLoad}
          strategy="afterInteractive"
        />
      )}

      <div className="auth-layout">
        <div className="auth-card">
          <div className="auth-logo">
            <LogoIcon size={22} />
            <span className="logo-text">Saya Bayar</span>
          </div>
          <h1 className="auth-title">Buat Akun</h1>
          <p className="auth-subtitle">Daftar untuk mulai menerima pembayaran</p>

          {error && <div className="error-msg">{error}</div>}

          <GoogleSignInButton onToken={handleGoogle} label="signup_with" />

          <div className="auth-divider">
            <span>atau daftar dengan email</span>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Nama</label>
              <input type="text" className="form-input" placeholder="Nama lengkap" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input type="email" className="form-input" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input type="password" className="form-input" placeholder="Minimal 8 karakter" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
            </div>

            {TURNSTILE_ENABLED && (
              <div style={{ marginBottom: 16 }}>
                <div ref={widgetRef} />
                {!turnstileReady && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                    Memuat verifikasi keamanan...
                  </div>
                )}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%' }}
              disabled={loading || (TURNSTILE_ENABLED && !turnstileToken)}
            >
              {loading ? 'Mendaftar...' : 'Daftar'}
            </button>
          </form>

          <div className="auth-footer">
            Sudah punya akun? <Link href="/login">Masuk di sini</Link>
          </div>
        </div>
      </div>
    </>
  )
}
