import './globals.css'
import { AuthProvider } from '@/lib/AuthContext'
import { ToastProvider } from '@/components/Toast'
import WhatsAppButton from '@/components/WhatsAppButton'

const SITE_URL = 'https://sayabayar.com'

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Saya Bayar — Payment Gateway Tanpa Perantara',
    template: '%s | Saya Bayar',
  },
  description:
    'Buat invoice, pelanggan transfer BCA/QRIS, langsung lunas otomatis. Tanpa cek mutasi manual. Tanpa potongan per transaksi.',
  openGraph: {
    siteName: 'Saya Bayar',
    locale: 'id_ID',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
  },
  robots: {
    index: true,
    follow: true,
  },
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
