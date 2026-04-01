import Link from 'next/link'
import { LayoutDashboard, ArrowLeft, FileQuestion } from 'lucide-react'

export default function DashboardNotFound() {
  return (
    <div className="error-page-inner">
      {/* Decorative icon */}
      <div className="error-icon-wrap error-icon-muted">
        <FileQuestion size={56} strokeWidth={1.2} />
      </div>

      <h1 className="error-inner-title">Halaman Tidak Ditemukan</h1>
      <p className="error-inner-desc">
        Bagian dashboard yang Anda cari tidak tersedia atau sudah dipindahkan.
      </p>

      <div className="error-page-actions">
        <Link href="/dashboard" className="btn btn-primary">
          <LayoutDashboard size={16} />
          Ke Dashboard
        </Link>
        <Link href="/dashboard/invoices" className="btn btn-ghost">
          <ArrowLeft size={16} />
          Invoice Saya
        </Link>
      </div>

      <p className="error-page-hint">
        Kode error: <code>404</code> · Halaman tidak ditemukan dalam dashboard
      </p>
    </div>
  )
}
