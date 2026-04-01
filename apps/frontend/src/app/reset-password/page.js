'use client'
import { useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'

function ResetPasswordForm() {
  const searchParams  = useSearchParams()
  const router        = useRouter()
  const token         = searchParams.get('token')

  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [success, setSuccess]     = useState(false)
  const [error, setError]         = useState('')

  // Token tidak ada di URL
  if (!token) {
    return (
      <div className="auth-layout">
        <div className="auth-card">
          <div className="auth-logo">
            <LogoIcon size={22} />
            <span className="logo-text">Saya Bayar</span>
          </div>
          <div style={{ textAlign: 'center', padding: '16px 0' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
            <h1 className="auth-title">Link Tidak Valid</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
              Link reset password ini tidak valid atau sudah kadaluarsa.
            </p>
            <Link href="/forgot-password" className="btn btn-primary" style={{ display: 'inline-block' }}>
              Minta Link Baru
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Berhasil reset
  if (success) {
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
              background: 'linear-gradient(135deg, #22c55e, #16a34a)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              margin: '0 auto 20px', fontSize: 28
            }}>
              ✓
            </div>
            <h1 className="auth-title" style={{ marginBottom: 8 }}>Password Berhasil Diubah!</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
              Silakan login dengan password baru Anda.
            </p>
            <Link href="/login" className="btn btn-primary" style={{ display: 'inline-block' }}>
              Masuk Sekarang
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password !== confirm) {
      return setError('Konfirmasi password tidak cocok.')
    }
    if (password.length < 8) {
      return setError('Password minimal 8 karakter.')
    }

    setLoading(true)
    try {
      await api.post('/v1/auth/reset-password', { token, password })
      setSuccess(true)
    } catch (err) {
      setError(err.message || 'Terjadi kesalahan. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <LogoIcon size={22} />
          <span className="logo-text">Saya Bayar</span>
        </div>
        <h1 className="auth-title">Buat Password Baru</h1>
        <p className="auth-subtitle">Masukkan password baru untuk akun Anda.</p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Password Baru</label>
            <input
              type="password"
              id="new-password"
              className="form-input"
              placeholder="Minimal 8 karakter"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              autoFocus
            />
          </div>
          <div className="form-group">
            <label className="form-label">Konfirmasi Password</label>
            <input
              type="password"
              id="confirm-password"
              className="form-input"
              placeholder="Ulangi password baru"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={8}
            />
          </div>

          {/* Password strength hint */}
          {password.length > 0 && (
            <div style={{
              fontSize: 12, marginTop: -8, marginBottom: 16,
              color: password.length >= 8 ? '#22c55e' : '#f97316'
            }}>
              {password.length >= 8 ? '✓ Password cukup kuat' : `Kurang ${8 - password.length} karakter lagi`}
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Menyimpan...' : 'Simpan Password Baru'}
          </button>
        </form>

        <div className="auth-footer">
          <Link href="/login">← Kembali ke halaman login</Link>
        </div>
      </div>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  )
}
