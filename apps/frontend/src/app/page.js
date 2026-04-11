// Server Component — NO 'use client'
import LandingShell from './_landing-shell'

const SITE_URL = 'https://sayabayar.com'
const APP_NAME = 'Saya Bayar'

// ── Per-page metadata (overrides layout.js defaults) ─────────────────────────
export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: `${APP_NAME} — Payment Gateway Tanpa Perantara`,
  description:
    'Buat invoice dalam hitungan detik, pelanggan transfer BCA atau QRIS, sistem langsung mencocokkan otomatis. Tanpa cek mutasi manual, tanpa potongan per transaksi. Gratis untuk mulai.',
  keywords: [
    'payment gateway indonesia',
    'invoice otomatis',
    'verifikasi transfer BCA',
    'QRIS otomatis',
    'terima pembayaran online',
    'tanpa potongan fee',
    'cek mutasi otomatis',
    'invoice BCA QRIS',
    'saya bayar',
    'payment gateway UMKM',
  ],
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: APP_NAME,
    title: `${APP_NAME} — Terima Pembayaran Otomatis Tanpa Potongan`,
    description:
      'Invoice otomatis, verifikasi transfer BCA/QRIS real-time, dana langsung ke rekening Anda. Gratis untuk mulai. Upgrade ke Pro untuk kontrol penuh.',

    locale: 'id_ID',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${APP_NAME} — Terima Pembayaran Otomatis`,
    description:
      'Invoice BCA/QRIS otomatis. Dana langsung ke rekening Anda. Tanpa potongan fee per transaksi.',

  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
}

// ── JSON-LD Structured Data ───────────────────────────────────────────────────
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}/#organization`,
      name: APP_NAME,
      url: SITE_URL,
      logo: {
        '@type': 'ImageObject',
        url: `${SITE_URL}/logo.png`,
        width: 512,
        height: 512,
      },
      description:
        'Platform verifikasi pembayaran otomatis untuk UMKM dan bisnis online Indonesia. Terima transfer bank dan QRIS secara otomatis tanpa cek mutasi manual.',
      areaServed: 'ID',
      serviceType: 'Payment Verification Service',
      sameAs: [],
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: SITE_URL,
      name: APP_NAME,
      publisher: { '@id': `${SITE_URL}/#organization` },
      inLanguage: 'id-ID',
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
        },
        'query-input': 'required name=search_term_string',
      },
    },
    {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/#webpage`,
      url: SITE_URL,
      name: `${APP_NAME} — Terima Pembayaran Otomatis, Dana Langsung ke Rekening`,
      isPartOf: { '@id': `${SITE_URL}/#website` },
      about: { '@id': `${SITE_URL}/#organization` },
      description:
        'Buat invoice, pelanggan transfer BCA atau QRIS, sistem otomatis mencocokkan pembayaran. Tanpa cek mutasi, tanpa potongan per transaksi.',
      inLanguage: 'id-ID',
      breadcrumb: {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Beranda',
            item: SITE_URL,
          },
        ],
      },
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}/#app`,
      name: APP_NAME,
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web',
      url: SITE_URL,
      description:
        'Sistem invoice dan verifikasi pembayaran otomatis via transfer bank BCA dan QRIS untuk bisnis Indonesia. Tidak perlu cek mutasi manual.',
      featureList: [
        'Verifikasi pembayaran otomatis',
        'Invoice BCA Transfer',
        'Invoice QRIS',
        'Webhook realtime',
        'Dashboard terpusat',
        'API key',
        'Notifikasi instan',
      ],
      screenshot: `${SITE_URL}/logo.png`,
      offers: [
        {
          '@type': 'Offer',
          name: 'Gratis',
          price: '0',
          priceCurrency: 'IDR',
          description:
            'Mulai gratis dengan channel platform. Cocok untuk bisnis kecil dan testing. Limit invoice Rp 490.000.',
        },
        {
          '@type': 'Offer',
          name: 'Pro',
          price: '99000',
          priceCurrency: 'IDR',
          description:
            'Dana langsung ke rekening Anda. Tanpa potongan per transaksi. Tanpa batas volume bulanan.',
        },
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}/#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Kenapa tidak pakai payment gateway biasa?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Payment gateway umumnya mengenakan biaya per transaksi dan dana tidak langsung masuk ke rekening Anda. Dengan Saya Bayar, Anda bisa menerima pembayaran langsung tanpa potongan dan tanpa menunggu pencairan.',
          },
        },
        {
          '@type': 'Question',
          name: 'Ini payment gateway atau cuma cek mutasi?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Saya Bayar adalah sistem pembayaran otomatis yang memungkinkan Anda menerima transfer dan memverifikasinya secara otomatis menggunakan invoice. Anda tidak perlu cek mutasi manual — semua proses berjalan otomatis.',
          },
        },
        {
          '@type': 'Question',
          name: 'Apakah dana masuk ke rekening saya?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Untuk pengguna Pro, dana langsung masuk ke rekening Anda tanpa perantara. Untuk versi Gratis, dana masuk ke saldo platform dan tersedia untuk dicairkan setelah H+2 dengan biaya withdraw Rp 2.500 per pencairan.',
          },
        },
        {
          '@type': 'Question',
          name: 'Apakah ada biaya per transaksi?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Tidak ada biaya per transaksi (0%). Anda hanya membayar biaya langganan untuk versi Pro, tanpa potongan dari setiap pembayaran yang masuk.',
          },
        },
        {
          '@type': 'Question',
          name: 'Bagaimana sistem mengetahui pembayaran sudah masuk?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Sistem mencocokkan nominal transfer pelanggan dengan invoice yang Anda buat. Setelah cocok, status invoice otomatis berubah menjadi lunas tanpa perlu konfirmasi manual dari Anda.',
          },
        },
        {
          '@type': 'Question',
          name: 'Berapa lama verifikasi pembayaran?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Verifikasi biasanya berlangsung dalam hitungan detik setelah pembayaran masuk. Sistem berjalan otomatis 24 jam tanpa henti, termasuk hari libur.',
          },
        },
        {
          '@type': 'Question',
          name: 'Apakah aman digunakan?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Sistem Saya Bayar dirancang hanya untuk membaca data mutasi yang diperlukan untuk verifikasi pembayaran. Data Anda tetap aman, terenkripsi, dan tidak digunakan untuk hal lain.',
          },
        },
        {
          '@type': 'Question',
          name: 'Apa perbedaan versi gratis dan Pro?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Versi Gratis menggunakan channel platform dan cocok untuk bisnis kecil atau testing — ada batas nominal per invoice (maks Rp 490.000) dan volume bulanan (maks Rp 5 juta/bulan). Versi Pro memungkinkan Anda menghubungkan rekening sendiri, menerima dana langsung tanpa perantara, dan tanpa batas volume.',
          },
        },
      ],
    },
  ],
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function HomePage() {
  return (
    <>
      {/* Structured Data untuk Google Rich Results */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <LandingShell />
    </>
  )
}
