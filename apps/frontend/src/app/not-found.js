import Link from 'next/link'
import { Zap, Home, ArrowLeft, Search } from 'lucide-react'

export const metadata = {
  title: '404 — Halaman Tidak Ditemukan | Saya Bayar',
}

export default function NotFound() {
  return (
    <div className="error-page-root">
      {/* Ambient glow */}
      <div className="error-glow error-glow-404" />

      <div className="error-page-content">
        {/* Logo */}
        <Link href="/" className="error-page-logo">
          <Zap size={20} />
          <span className="logo-text">Saya Bayar</span>
        </Link>

        {/* 404 Number */}
        <div className="error-code-wrap">
          <span className="error-code-num">4</span>
          <span className="error-code-zero">
            <Search size={64} strokeWidth={1.5} />
          </span>
          <span className="error-code-num">4</span>
        </div>

        {/* Message */}
        <h1 className="error-page-title">Halaman Tidak Ditemukan</h1>
        <p className="error-page-desc">
          Hmm, sepertinya halaman yang Anda cari sudah dipindah, dihapus,
          atau memang tidak pernah ada. Kembali ke jalur yang benar yuk!
        </p>

        {/* Actions */}
        <div className="error-page-actions">
          <Link href="/" className="btn btn-primary">
            <Home size={16} />
            Kembali ke Beranda
          </Link>
          <Link href="/dashboard" className="btn btn-ghost">
            <ArrowLeft size={16} />
            Dashboard
          </Link>
        </div>

        {/* Breadcrumb hint */}
        <p className="error-page-hint">
          Kode error: <code>404</code> · Halaman tidak ditemukan
        </p>
      </div>
    </div>
  )
}
