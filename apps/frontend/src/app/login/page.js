'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth, useRedirectIfAuthenticated } from '@/lib/AuthContext'
import { api } from '@/lib/api'
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'
import GoogleSignInButton from '@/components/GoogleSignInButton'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [resendLoading, setResendLoading] = useState(false)
  const [resendMsg, setResendMsg] = useState('')
  const { login, loginWithGoogle } = useAuth()
  const router = useRouter()

  // Redirect ke dashboard jika sudah authenticated
  const { loading: authLoading } = useRedirectIfAuthenticated()
  if (authLoading) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setErrorCode('')
    setResendMsg('')
    setLoading(true)
    try {
      await login(email, password)
      router.push('/dashboard')
    } catch (err) {
      setError(err.message || 'Login gagal')
      setErrorCode(err.code || '')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async (idToken) => {
    setError('')
    setErrorCode('')
    setLoading(true)
    try {
      await loginWithGoogle(idToken)
      router.push('/dashboard')
    } catch (err) {
      setError(err.message || 'Login dengan Google gagal')
    } finally {
      setLoading(false)
    }
  }

  const handleResendVerification = async () => {
    if (!email) return
    setResendLoading(true)
    setResendMsg('')
    try {
      await api.post('/v1/auth/resend-verification', { email })
      setResendMsg('Email verifikasi telah dikirim. Silakan cek inbox Anda.')
    } catch (err) {
      setResendMsg(err.message || 'Gagal mengirim email.')
    } finally {
      setResendLoading(false)
    }
  }

  const isUnverified = errorCode === 'EMAIL_NOT_VERIFIED'

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <LogoIcon size={22} />
          <span className="logo-text">Saya Bayar</span>
        </div>
        <h1 className="auth-title">Selamat Datang</h1>
        <p className="auth-subtitle">Masuk ke dashboard Anda</p>

        {error && (
          <div className="error-msg">
            {error}
            {isUnverified && (
              <div style={{ marginTop: 10 }}>
                <button
                  onClick={handleResendVerification}
                  disabled={resendLoading || !email}
                  style={{
                    background: 'none', border: '1px solid currentColor',
                    borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
                    fontSize: 13, color: 'inherit', fontWeight: 600,
                    opacity: resendLoading || !email ? 0.6 : 1
                  }}
                >
                  {resendLoading ? 'Mengirim...' : '📨 Kirim Ulang Email Verifikasi'}
                </button>
              </div>
            )}
          </div>
        )}

        {resendMsg && (
          <div className="error-msg" style={{
            background: 'rgba(34,197,94,0.1)',
            borderColor: '#22c55e',
            color: '#15803d'
          }}>
            {resendMsg}
          </div>
        )}

        {/* Google Sign-In */}
        <GoogleSignInButton onToken={handleGoogle} label="signin_with" />

        <div className="auth-divider">
          <span>atau masuk dengan email</span>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input
              type="email"
              className="form-input"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>Password</label>
              <Link
                href="/forgot-password"
                style={{ fontSize: 13, color: 'var(--primary)', textDecoration: 'none', fontWeight: 500 }}
              >
                Lupa password?
              </Link>
            </div>
            <input
              type="password"
              className="form-input"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
            {loading ? 'Masuk...' : 'Masuk'}
          </button>
        </form>

        <div className="auth-footer">
          Belum punya akun? <Link href="/register">Daftar di sini</Link>
        </div>
      </div>
    </div>
  )
}
