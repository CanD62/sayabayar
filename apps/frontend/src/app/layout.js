import './globals.css'
import { AuthProvider } from '@/lib/AuthContext'
import { ToastProvider } from '@/components/Toast'
import WhatsAppButton from '@/components/WhatsAppButton'

export const metadata = {
  title: 'Saya Bayar — Invoice & Verifikasi Pembayaran Otomatis',
  description: 'Buat invoice, pelanggan transfer BCA/QRIS, langsung lunas otomatis. Tanpa cek mutasi manual.',
}

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>
        <AuthProvider>
          <ToastProvider>
            {children}
            <WhatsAppButton />
          </ToastProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
