/**
 * Shared formatting utilities
 * Dipakai di semua halaman dashboard agar konsisten dan tidak copy-paste
 */

/** Format angka ke Rupiah tanpa simbol: 1234567 → "1.234.567" */
export const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

/** Format angka ke Rupiah dengan prefix: 1234567 → "Rp 1.234.567" */
export const fmtRp = (n) => `Rp ${fmt(n)}`

/** Format ISO date ke locale Indonesia: "2024-03-27T03:00:00.000Z" → "27 Mar 2024, 10.00" */
export const fmtDate = (iso) => {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('id-ID')
}

/** Format ISO date ke tanggal saja: "2024-03-27T03:00:00.000Z" → "27 Maret 2024" */
export const fmtDateOnly = (iso) => {
  if (!iso) return '-'
  return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

/**
 * Map invoice status ke label dan badge color
 * Satu definisi untuk semua halaman
 */
export const INVOICE_STATUS = {
  pending:        { label: 'Menunggu',    badge: 'warning' },
  user_confirmed: { label: 'Proses',      badge: 'info'    },
  paid:           { label: 'Lunas',       badge: 'success' },
  expired:        { label: 'Expired',     badge: 'danger'  },
  cancelled:      { label: 'Batal',       badge: 'danger'  },
}

/** Helper: ambil status info, fallback ke danger badge */
export const getInvoiceStatus = (status) =>
  INVOICE_STATUS[status] || { label: status, badge: 'danger' }
