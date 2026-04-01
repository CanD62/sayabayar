import { Zap } from 'lucide-react'

export default function Loading() {
  return (
    <div className="loading-page-root">
      {/* Background glow */}
      <div className="error-glow error-glow-404" />

      <div className="loading-page-content">
        {/* Logo */}
        <div className="loading-logo">
          <Zap size={28} color="var(--accent)" />
          <span className="logo-text" style={{ fontSize: '1.5rem', fontWeight: 800 }}>
            Saya Bayar
          </span>
        </div>

        {/* Spinner */}
        <div className="loading-spinner-wrap">
          <div className="loading-ring" />
          <div className="loading-ring loading-ring-2" />
        </div>

        <p className="loading-page-text">Memuat halaman…</p>
      </div>
    </div>
  )
}
