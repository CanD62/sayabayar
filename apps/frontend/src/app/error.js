'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { Zap, RefreshCw, Home, AlertTriangle } from 'lucide-react'

export default function Error({ error, reset }) {
  useEffect(() => {
    // Log error to monitoring in production
    console.error('[App Error]', error)
  }, [error])

  return (
    <div className="error-page-root">
      {/* Ambient glow — danger variant */}
      <div className="error-glow error-glow-500" />

      <div className="error-page-content">
        {/* Logo */}
        <Link href="/" className="error-page-logo">
          <Zap size={20} />
          <span className="logo-text">Saya Bayar</span>
        </Link>

        {/* Icon */}
        <div className="error-icon-wrap error-icon-danger">
          <AlertTriangle size={52} strokeWidth={1.5} />
        </div>

        {/* Message */}
        <h1 className="error-page-title">Ada yang Tidak Beres</h1>
        <p className="error-page-desc">
          Terjadi kesalahan yang tidak terduga. Tim kami sudah otomatis
          mendapat notifikasi. Coba muat ulang halaman ini.
        </p>

        {/* Error detail (dev only) */}
        {error?.message && (
          <div className="error-detail-box">
            <code>{error.message}</code>
          </div>
        )}

        {/* Actions */}
        <div className="error-page-actions">
          <button onClick={reset} className="btn btn-primary">
            <RefreshCw size={16} />
            Coba Lagi
          </button>
          <Link href="/" className="btn btn-ghost">
            <Home size={16} />
            Kembali ke Beranda
          </Link>
        </div>

        <p className="error-page-hint">
          Kode error: <code>500</code> · Internal error
        </p>
      </div>
    </div>
  )
}
