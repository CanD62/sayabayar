'use client'
import { useState } from 'react'
import { api } from '@/lib/api'
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.post('/v1/auth/forgot-password', { email })
      setSubmitted(true)
    } catch (err) {
      setError(err.message || 'Terjadi kesalahan. Coba lagi.')
    } finally {
      setLoading(false)
    }
  }

  // ── State: email terkirim ────────────────────────────────
  if (submitted) {
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
              📬
            </div>
            <h1 className="auth-title" style={{ marginBottom: 8 }}>Cek Email Anda</h1>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 4 }}>
              Jika email <strong>{email}</strong> terdaftar,
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              link reset password telah dikirimkan.
            </p>
          </div>

          <div style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 10, padding: '16px 20px',
            fontSize: 13, color: 'var(--text-muted)',
            marginBottom: 20, lineHeight: 1.7
          }}>
            <strong style={{ color: 'var(--text)' }}>📋 Tips:</strong><br />
            • Cek folder <strong>spam/junk</strong> jika tidak ada di inbox<br />
            • Link berlaku selama <strong>1 jam</strong><br />
            • Hanya satu link aktif pada satu waktu
          </div>

          <div className="auth-footer">
            <Link href="/login">← Kembali ke halaman login</Link>
          </div>
        </div>
      </div>
    )
  }

  // ── State: form input email ──────────────────────────────
  return (
    <div className="auth-layout">
      <div className="auth-card">
        <div className="auth-logo">
          <LogoIcon size={22} />
          <span className="logo-text">Saya Bayar</span>
        </div>
        <h1 className="auth-title">Lupa Password</h1>
        <p className="auth-subtitle">
          Masukkan email Anda dan kami akan mengirimkan link untuk membuat password baru.
        </p>

        {error && <div className="error-msg">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Alamat Email</label>
            <input
              type="email"
              id="forgot-email"
              className="form-input"
              placeholder="email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={loading}
          >
            {loading ? 'Mengirim...' : 'Kirim Link Reset Password'}
          </button>
        </form>

        <div className="auth-footer">
          Ingat password? <Link href="/login">Masuk di sini</Link>
        </div>
      </div>
    </div>
  )
}
