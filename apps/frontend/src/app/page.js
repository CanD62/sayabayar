'use client'
import { useRedirectIfAuthenticated } from '@/lib/AuthContext'
import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'

import {
  Shield, Bell, BarChart3, CreditCard, Clock, Zap,
  ArrowRight, CheckCircle, Star, FileText, TrendingUp,
  Send, CircleCheckBig, XCircle, Wallet, Building2, ChevronDown
} from 'lucide-react'
import LogoIcon from '@/components/LogoIcon'

const APP = process.env.NEXT_PUBLIC_APP_NAME || 'Saya Bayar'

const FEATURES = [
  {
    icon: Zap,
    title: 'Verifikasi Pembayaran Otomatis',
    desc: 'Begitu pelanggan transfer, sistem langsung mencocokkan dan invoice otomatis lunas. Tidak perlu cek mutasi, tidak perlu konfirmasi manual.',
  },
  {
    icon: CreditCard,
    title: 'BANK dan QRIS',
    desc: 'Terima pembayaran via transfer BANK dan QRIS. Pelanggan pilih yang paling mudah, Anda terima langsung.',
  },
  {
    icon: Building2,
    title: 'Dana Langsung ke Rekening Anda (BERBAYAR)',
    desc: 'Tambah rekening sendiri (BCA & QRIS). Dana masuk 100% langsung ke rekening Anda — tanpa perantara, tanpa potongan.',
  },
  {
    icon: Bell,
    title: 'Webhook Realtime',
    desc: 'Notifikasi instan ke server Anda setiap invoice lunas. Cocok untuk integrasi toko online, SaaS, atau sistem otomasi.',
  },
  {
    icon: BarChart3,
    title: 'Dashboard Terpusat',
    desc: 'Buat, pantau, dan kelola semua invoice dari satu halaman. Status realtime, riwayat transaksi lengkap.',
  },
  {
    icon: Clock,
    title: 'Jalan 24 Jam Otomatis',
    desc: 'Sistem bekerja non-stop, tidak kenal hari libur. Pembayaran tengah malam pun langsung terverifikasi tanpa ada yang jaga.',
  },
]

const STEPS = [
  {
    num: '01',
    icon: FileText,
    title: 'Buat Invoice',
    desc: 'Masukkan nominal, sistem langsung buat link pembayaran. Selesai dalam hitungan detik, siap dikirim ke pelanggan.',
  },
  {
    num: '02',
    icon: Send,
    title: 'Pelanggan Transfer',
    desc: 'Pelanggan buka link dan transfer via BANK atau QRIS sesuai nominal. Tidak perlu konfirmasi manual.',
  },
  {
    num: '03',
    icon: CircleCheckBig,
    title: 'Lunas Otomatis',
    desc: 'Sistem mencocokkan pembayaran dan update status secara otomatis. Anda tidak perlu melakukan apa pun.',
  },
]

const STATS = [
  { value: '10.000+', label: 'Invoice Diproses' },
  { value: '99.9%', label: 'Uptime' },
  { value: '<10 detik', label: 'Waktu Verifikasi' },
  { value: '500+', label: 'Bisnis Terdaftar' },
]

const TESTIMONIALS = [
  {
    name: 'Andi Pratama',
    role: 'Owner, TokoDigital.id',
    text: 'Dulu cek mutasi manual tiap hari. Sekarang semua otomatis, hemat banyak waktu.',
    avatar: 'AP',
  },
  {
    name: 'Sari Dewi',
    role: 'Pemilik Toko Online',
    text: 'Tinggal kirim invoice, pelanggan bayar, langsung lunas. Tidak perlu repot konfirmasi satu per satu.',
    avatar: 'SD',
  },
  {
    name: 'Rizky Fauzan',
    role: 'Developer Freelance',
    text: 'Webhook langsung jalan ke sistem saya. Setup cepat dan stabil. Rekomen banget untuk yang butuh integrasi.',
    avatar: 'RF',
  },
]

const FAQ_ITEMS = [
  {
    q: 'Kenapa tidak pakai payment gateway biasa?',
    a: 'Payment gateway umumnya mengenakan biaya per transaksi dan dana tidak langsung masuk ke rekening Anda. Dengan sistem ini, Anda bisa menerima pembayaran langsung tanpa potongan dan tanpa menunggu pencairan.',
    highlight: true,
  },
  {
    q: 'Ini payment gateway atau cuma cek mutasi?',
    a: 'Ini adalah sistem pembayaran otomatis yang memungkinkan Anda menerima transfer dan memverifikasinya secara otomatis menggunakan invoice. Anda tidak perlu cek mutasi manual — semua proses berjalan otomatis.',
  },
  {
    q: 'Apakah dana masuk ke rekening saya?',
    a: 'Untuk pengguna BERBAYAR, dana langsung masuk ke rekening Anda tanpa perantara. Untuk versi Gratis, dana masuk ke saldo platform — tersedia untuk dicairkan setelah H+2 (2 hari kerja) dengan biaya withdraw Rp 2.500 per pencairan.',
  },
  {
    q: 'Apakah ada biaya per transaksi?',
    a: 'Tidak ada biaya per transaksi (0%). Anda hanya membayar biaya langganan untuk versi BERBAYAR, tanpa potongan dari setiap pembayaran yang masuk.',
  },
  {
    q: 'Bagaimana sistem mengetahui pembayaran sudah masuk?',
    a: 'Sistem mencocokkan nominal transfer pelanggan dengan invoice yang Anda buat. Setelah cocok, status invoice otomatis berubah menjadi lunas tanpa perlu konfirmasi manual.',
  },
  {
    q: 'Kenapa ada selisih nominal (kode unik)?',
    a: 'Selisih kecil (biasanya 2–3 digit) ditambahkan ke nominal invoice agar setiap pembayaran bisa diidentifikasi secara otomatis tanpa konfirmasi manual. Selisih ini menjadi pendapatan platform di versi Gratis, dan tidak dikenakan pada versi BERBAYAR karena dana langsung masuk ke rekening Anda.',
  },
  {
    q: 'Berapa lama verifikasi pembayaran?',
    a: 'Verifikasi biasanya berlangsung dalam hitungan detik setelah pembayaran masuk. Sistem berjalan otomatis 24 jam tanpa henti.',
  },
  {
    q: 'Apakah aman digunakan?',
    a: 'Sistem dirancang hanya untuk membaca data mutasi yang diperlukan untuk verifikasi pembayaran. Data Anda tetap aman dan tidak digunakan untuk hal lain.',
  },
  {
    q: 'Apakah bisa digunakan untuk bisnis saya?',
    a: 'Bisa digunakan untuk berbagai kebutuhan — dari toko online, jasa, hingga aplikasi SaaS. Selama menerima pembayaran via transfer atau QRIS, sistem ini bisa langsung digunakan.',
  },
  {
    q: 'Apakah perlu integrasi teknis?',
    a: 'Tidak wajib. Anda bisa langsung menggunakan dashboard untuk membuat invoice. Untuk kebutuhan lanjutan, tersedia webhook untuk integrasi ke sistem Anda.',
  },
  {
    q: 'Apa perbedaan versi gratis dan BERBAYAR?',
    a: 'Versi gratis menggunakan channel pembayaran dari platform. Versi BERBAYAR memungkinkan Anda menggunakan rekening sendiri dan menerima dana langsung tanpa perantara.',
  },
]

function FaqItem({ q, a, highlight }) {
  const [open, setOpen] = useState(false)
  return (
    <div
      onClick={() => setOpen(o => !o)}
      style={{
        borderRadius: 12,
        border: highlight
          ? '1px solid rgba(16,185,129,0.4)'
          : '1px solid rgba(255,255,255,0.07)',
        background: highlight
          ? 'rgba(16,185,129,0.06)'
          : 'rgba(255,255,255,0.03)',
        padding: '16px 20px',
        cursor: 'pointer',
        transition: 'border-color 0.2s, background 0.2s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <span style={{
          fontWeight: 600,
          fontSize: '0.95rem',
          color: highlight ? '#10b981' : 'var(--text-primary)',
          lineHeight: 1.4,
        }}>
          {highlight && '❗ '}{q}
        </span>
        <ChevronDown
          size={18}
          style={{
            flexShrink: 0,
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.25s ease',
          }}
        />
      </div>
      {open && (
        <p style={{
          marginTop: 12,
          fontSize: '0.875rem',
          color: 'var(--text-muted)',
          lineHeight: 1.7,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          paddingTop: 12,
        }}>
          {a}
        </p>
      )}
    </div>
  )
}

// ── Social Proof Toast ────────────────────────────────────────────────────────
const FIRST_NAMES = [
  'Andi', 'Siti', 'Budi', 'Dewi', 'Reza', 'Maya', 'Tono', 'Lisa',
  'Agus', 'Rina', 'Hendra', 'Fitri', 'Dani', 'Novi', 'Wahyu', 'Ayu',
  'Bayu', 'Citra', 'Eko', 'Fani', 'Gilang', 'Hani', 'Irwan', 'Jeni',
]
const MID_NAMES = [
  'Kusuma', 'Putri', 'Rahayu', 'Santoso', 'Wibowo', 'Pratama',
  'Nugroho', 'Hidayat', 'Saputra', 'Lestari', 'Permata', 'Wijaya',
]
const LAST_NAMES = [
  'Dewi', 'Ningrum', 'Sari', 'Utama', 'Putra', 'Wati',
  'Yanti', 'Susanto', 'Andriani', 'Setiawan', 'Kurniawan', 'Arifin',
]

function randomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)]
  const r = Math.random()
  if (r < 0.3) {
    // 30%: 1 kata saja — "Maya"
    return first
  } else if (r < 0.75) {
    // 45%: 2 kata — "Maya Kusuma"
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
    return `${first} ${last}`
  } else {
    // 25%: 3 kata — "Maya Kusuma Dewi"
    const mid = MID_NAMES[Math.floor(Math.random() * MID_NAMES.length)]
    const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)]
    return `${first} ${mid} ${last}`
  }
}

// Channel pool — dipilih random, bukan berurutan
const CHANNELS = ['BCA Transfer', 'QRIS BCA', 'QRIS GoPay', 'BCA Transfer', 'QRIS GoPay']

const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

function randomAmount(channel) {
  const isQris = channel.toLowerCase().includes('qris')
  const min = 15000
  const max = isQris ? 450000 : 8500000
  const raw = Math.floor(Math.random() * (max - min + 1)) + min
  // Bulatkan ke ribuan agar terlihat wajar
  return Math.round(raw / 1000) * 1000
}

function randomInvoice() {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const num = String(Math.floor(1000 + Math.random() * 8999))
  return `INV-${ymd}-${num}`
}

function PaymentToast() {
  const [visible, setVisible] = useState(false)
  const [current, setCurrent] = useState(null)
  const [elapsed, setElapsed]   = useState(0)   // detik sejak toast muncul (live counter)

  const hideTimer = useRef(null)
  const nextTimer = useRef(null)
  const tickTimer = useRef(null)

  // Cleanup semua timer saat unmount
  useEffect(() => {
    // Delay pertama acak: 2-5 detik (tidak selalu tepat 3 detik)
    const init = setTimeout(() => scheduleShow(), 2000 + Math.random() * 3000)
    return () => {
      clearTimeout(init)
      clearTimeout(hideTimer.current)
      clearTimeout(nextTimer.current)
      clearInterval(tickTimer.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function scheduleShow() {
    // Pilih channel secara acak penuh, bukan iterasi
    const channel = CHANNELS[Math.floor(Math.random() * CHANNELS.length)]
    setCurrent({
      channel,
      name:    randomName(),
      amount:  randomAmount(channel),
      invoice: randomInvoice(),
    })
    setElapsed(0)
    setVisible(true)

    // Live counter — tick setiap detik
    let sec = 0
    clearInterval(tickTimer.current)
    tickTimer.current = setInterval(() => { sec++; setElapsed(sec) }, 1000)

    // Berapa lama toast muncul: 3–5 detik (acak)
    const visibleMs = 3000 + Math.random() * 2000
    hideTimer.current = setTimeout(() => {
      clearInterval(tickTimer.current)
      setVisible(false)

      // Jeda sebelum toast berikutnya: 7–18 detik (acak & lebih bervariasi)
      const gapMs = 7000 + Math.random() * 11000
      nextTimer.current = setTimeout(() => scheduleShow(), gapMs)
    }, visibleMs)
  }

  const timeLabel = elapsed === 0
    ? 'baru saja dibayar ✓'
    : `${elapsed} detik yang lalu ✓`

  if (!current) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: 24,
        zIndex: 9999,
        transform: visible ? 'translateY(0)' : 'translateY(130%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.45s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease',
        pointerEvents: visible ? 'auto' : 'none',
        maxWidth: 300,
      }}
    >
      <div style={{
        background: 'rgba(15,17,24,0.93)',
        backdropFilter: 'blur(16px)',
        border: '1px solid rgba(16,185,129,0.25)',
        borderRadius: 14,
        padding: '12px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 0 1px rgba(16,185,129,0.1)',
      }}>
        {/* Icon */}
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: 'rgba(16,185,129,0.15)',
          border: '1px solid rgba(16,185,129,0.3)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <CircleCheckBig size={18} style={{ color: '#10b981' }} />
        </div>
        {/* Text */}
        <div>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f1f5f9', lineHeight: 1.3, fontFamily: 'monospace' }}>
            {current.invoice}
          </div>
          <div style={{ fontSize: '0.82rem', color: '#10b981', fontWeight: 700, marginTop: 2 }}>
            Rp {fmt(current.amount)}
            <span style={{ fontSize: '0.68rem', color: 'rgba(16,185,129,0.7)', fontWeight: 400, marginLeft: 5 }}>
              via {current.channel}
            </span>
          </div>
          <div style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.55)', marginTop: 2 }}>
            {timeLabel}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function HomePage() {
  const { loading } = useRedirectIfAuthenticated()
  if (loading) return null

  return (
    <div className="lp">
      <PaymentToast />

      {/* ── Navbar ───────────────────────────────── */}
      <nav className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link href="/" className="lp-logo">
            <LogoIcon size={22} /> {APP}
          </Link>
          <div className="lp-nav-links">
            <a href="#cara-kerja">Cara Kerja</a>
            <a href="#fitur">Fitur</a>
            <a href="#harga">Harga</a>
            <a href="#faq">FAQ</a>
          </div>
          <div className="lp-nav-actions">
            <Link href="/login" className="btn btn-ghost btn-sm">Masuk</Link>
            <Link href="/register" className="btn btn-primary btn-sm">Coba Gratis</Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ─────────────────────────────────── */}
      <section className="lp-hero">
        <div className="lp-container">
          <div className="lp-hero-badge">
            <Zap size={14} /> Terima pembayaran langsung ke rekening — tanpa fee, tanpa cek mutasi
          </div>
          <h1 className="lp-hero-title">
            Tanpa Payment Gateway,<br />
            <span className="lp-gradient-text">Dana Langsung ke Rekening Anda</span>
          </h1>
          <p className="lp-hero-subtitle">
            Buat invoice dalam hitungan detik. Pelanggan bayar, sistem otomatis mencocokkan tanpa perlu cek mutasi.
            Mulai gratis, upgrade ke PRO untuk menerima dana langsung ke rekening Anda tanpa potongan dari platform.
          </p>
          <div className="lp-hero-actions">
            <Link href="/register" className="btn btn-primary btn-lg">
              Mulai Gratis Sekarang <ArrowRight size={18} />
            </Link>
            <a href="#cara-kerja" className="btn btn-ghost btn-lg">
              Lihat Cara Kerja
            </a>
          </div>
          <div className="lp-hero-stats">
            {STATS.map(s => (
              <div key={s.label} className="lp-hero-stat">
                <div className="lp-hero-stat-value">{s.value}</div>
                <div className="lp-hero-stat-label">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Masalah ──────────────────────────────── */}
      <section className="lp-section" style={{ paddingBottom: 0 }}>
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Masih Cek Mutasi Satu-Satu Setiap Hari?</h2>
            <p className="lp-section-subtitle">Buang waktu, rawan salah, dan bikin pelanggan nunggu.</p>
          </div>
          <div className="lp-problem-grid">
            <div className="lp-problem-card">
              <div className="lp-problem-icon lp-problem-icon-danger"><XCircle size={20} /></div>
              <h3>Cek Mutasi Tiap Hari</h3>
              <p>Login iBanking, scroll mutasi, cocokin satu per satu. Dilakukan berulang — membuang waktu berjam-jam setiap harinya.</p>
            </div>
            <div className="lp-problem-card">
              <div className="lp-problem-icon lp-problem-icon-danger"><XCircle size={20} /></div>
              <h3>Salah Konfirmasi</h3>
              <p>Nominal mirip, transfer terlewat, pelanggan komplain. Satu kesalahan kecil bisa merusak kepercayaan yang sudah dibangun lama.</p>
            </div>
            <div className="lp-problem-card lp-problem-card-solution">
              <div className="lp-problem-icon lp-problem-icon-success">
                <CheckCircle size={20} />
              </div>
              <h3>Semua Jadi Otomatis</h3>
              <p>Pembayaran langsung terdeteksi dan invoice otomatis lunas. Anda fokus jualan — bukan fokus cek mutasi.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Cara Kerja ───────────────────────────── */}
      <section className="lp-section" id="cara-kerja">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Simpel. 3 Langkah. Selesai.</h2>
            <p className="lp-section-subtitle">Tidak perlu teknis. Tidak perlu setting ribet. Langsung bisa digunakan.</p>
          </div>
          <div className="lp-steps">
            {STEPS.map((step, i) => {
              const StepIcon = step.icon
              return (
                <div key={step.num} className="lp-step">
                  <div className="lp-step-num">{step.num}</div>
                  <div className="lp-step-icon"><StepIcon size={28} /></div>
                  <h3 className="lp-step-title">{step.title}</h3>
                  <p className="lp-step-desc">{step.desc}</p>
                  {i < STEPS.length - 1 && <div className="lp-step-arrow"><ArrowRight size={20} /></div>}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Fitur ────────────────────────────────── */}
      <section className="lp-section" id="fitur">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Semua yang Anda Butuhkan</h2>
            <p className="lp-section-subtitle">Dana langsung ke rekening Anda, tanpa biaya per transaksi, berjalan otomatis 24 jam</p>
          </div>
          <div className="lp-features">
            {FEATURES.map(f => {
              const Icon = f.icon
              return (
                <div key={f.title} className="lp-feature-card">
                  <div className="lp-feature-icon"><Icon size={24} /></div>
                  <h3 className="lp-feature-title">{f.title}</h3>
                  <p className="lp-feature-desc">{f.desc}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ── Trust / Security ─────────────────────── */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Keamanan &amp; Transparansi</h2>
            <p className="lp-section-subtitle">Sistem kami dirancang agar data dan dana Anda selalu aman</p>
          </div>
          <div className="lp-features" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
            <div className="lp-feature-card">
              <div className="lp-feature-icon"><Shield size={24} /></div>
              <h3 className="lp-feature-title">Sistem Hanya Membaca Mutasi</h3>
              <p className="lp-feature-desc">Tidak ada akses transfer keluar. Sistem hanya membaca data mutasi untuk mencocokkan pembayaran secara otomatis.</p>
            </div>
            <div className="lp-feature-card">
              <div className="lp-feature-icon"><CheckCircle size={24} /></div>
              <h3 className="lp-feature-title">Data Terenkripsi</h3>
              <p className="lp-feature-desc">Semua data disimpan dengan enkripsi. Kredensial Anda tidak pernah disimpan dalam bentuk terbuka.</p>
            </div>
            <div className="lp-feature-card">
              <div className="lp-feature-icon"><Zap size={24} /></div>
              <h3 className="lp-feature-title">Tidak Perlu Cek Manual</h3>
              <p className="lp-feature-desc">Verifikasi berjalan otomatis 24 jam. Tidak ada human error, tidak ada pembayaran yang terlewat.</p>
            </div>
            <div className="lp-feature-card">
              <div className="lp-feature-icon"><TrendingUp size={24} /></div>
              <h3 className="lp-feature-title">Digunakan oleh Banyak Bisnis</h3>
              <p className="lp-feature-desc">Dari toko online, SaaS, hingga freelancer — ribuan invoice diproses setiap harinya dengan aman dan stabil.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────── */}
      <section className="lp-section" id="harga">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Harga Transparan, Tanpa Kejutan</h2>
            <p className="lp-section-subtitle">Mulai gratis, upgrade saat bisnis Anda butuh kontrol penuh</p>
          </div>
          <div className="lp-pricing">

            {/* Gratis */}
            <div className="lp-pricing-card">
              <div className="lp-pricing-name">Gratis</div>
              <div className="lp-pricing-price">Rp 0 <span>/bulan</span></div>
              <p className="text-sm text-muted" style={{ marginBottom: 20 }}>
                Mulai tanpa biaya, cocok untuk testing atau bisnis kecil
              </p>
              <ul className="lp-pricing-features">
                <li><CheckCircle size={16} /> Invoice unlimited</li>
                <li><CheckCircle size={16} /> Auto verifikasi pembayaran</li>
                <li><CheckCircle size={16} /> Channel platform (BANK &amp; QRIS)</li>
                <li><CheckCircle size={16} /> Tanpa biaya per transaksi</li>
                <li><CheckCircle size={16} /> Webhook &amp; API key</li>
                <li className="lp-pricing-note"><Wallet size={14} /> Dana masuk ke saldo platform — tersedia H+2, withdraw fee Rp 2.500/pencairan</li>
                <li className="lp-pricing-note" style={{ marginTop: 4, opacity: 0.8 }}><Shield size={14} /> Nominal invoice + kode unik 2–3 digit untuk verifikasi otomatis</li>
              </ul>
              <Link href="/register" className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }}>
                Mulai Gratis
              </Link>
            </div>

            {/* Berbayar */}
            <div className="lp-pricing-card lp-pricing-card-featured">
              <div className="lp-pricing-badge">Terpopuler</div>
              <div className="lp-pricing-name">Berbayar</div>
              <div className="lp-pricing-price">Rp 99.000 <span>/bulan</span></div>
              <p className="text-sm text-muted" style={{ marginBottom: 20 }}>
                Untuk bisnis yang butuh kontrol penuh — dana langsung masuk ke rekening Anda
              </p>
              <ul className="lp-pricing-features">
                <li><CheckCircle size={16} /> Semua fitur Gratis</li>
                <li><CheckCircle size={16} /> Tambah rekening sendiri (BCA &amp; QRIS)</li>
                <li><CheckCircle size={16} /> Dana langsung masuk ke rekening Anda</li>
                <li><CheckCircle size={16} /> Tanpa biaya per transaksi (0%)</li>
                <li><CheckCircle size={16} /> Channel platform sebagai backup</li>
                <li><CheckCircle size={16} /> Prioritas support</li>
              </ul>
              <Link href="/register" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Langganan Sekarang <ArrowRight size={16} />
              </Link>
            </div>

          </div>

          {/* Note bawah pricing */}
          <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            ✦ Tidak ada potongan fee seperti payment gateway lainnya. Dana Anda, rekening Anda, langsung masuk.
          </p>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────── */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Kata Mereka yang Sudah Pakai</h2>
            <p className="lp-section-subtitle">Bisnis dari berbagai industri yang sudah beralih ke sistem otomatis</p>
          </div>
          <div className="lp-testimonials">
            {TESTIMONIALS.map(t => (
              <div key={t.name} className="lp-testimonial-card">
                <div className="lp-testimonial-stars">
                  {[...Array(5)].map((_, i) => <Star key={i} size={14} fill="var(--warning)" color="var(--warning)" />)}
                </div>
                <p className="lp-testimonial-text">"{t.text}"</p>
                <div className="lp-testimonial-author">
                  <div className="lp-testimonial-avatar">{t.avatar}</div>
                  <div>
                    <div className="lp-testimonial-name">{t.name}</div>
                    <div className="lp-testimonial-role">{t.role}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────── */}
      <section className="lp-section" id="faq">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Pertanyaan yang Sering Ditanyakan</h2>
            <p className="lp-section-subtitle">Jawaban jujur, tanpa basa-basi</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760, margin: '0 auto' }}>
            {FAQ_ITEMS.map((item, i) => (
              <FaqItem key={i} {...item} />
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA Final ───────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-container" style={{ textAlign: 'center' }}>
          <h2 className="lp-cta-title">
            Masih Mau Cek Mutasi Manual Besok?
          </h2>
          <p className="lp-cta-subtitle">
            Mulai gratis hari ini. Setup hanya 5 menit.
          </p>
          <Link href="/register" className="btn btn-primary btn-lg">
            Coba Gratis Sekarang <ArrowRight size={18} />
          </Link>
          <div className="lp-cta-trust">
            <span><CheckCircle size={14} /> Tanpa biaya</span>
            <span><CheckCircle size={14} /> Tanpa ribet</span>
            <span><CheckCircle size={14} /> Langsung bisa digunakan</span>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────── */}
      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div className="lp-footer-brand">
            <div className="lp-logo" style={{ marginBottom: 8 }}>
              <LogoIcon size={20} /> {APP}
            </div>
            <p className="text-sm text-muted">
              Terima pembayaran langsung ke rekening — otomatis, tanpa fee, tanpa cek mutasi.<br />
              <span style={{ marginTop: 4, display: 'block' }}>sayabayar.com</span>
            </p>
          </div>
          <div className="lp-footer-links">
            <div>
              <h4>Produk</h4>
              <a href="#cara-kerja">Cara Kerja</a>
              <a href="#fitur">Fitur</a>
              <a href="#harga">Harga</a>
            </div>
            <div>
              <h4>Legal</h4>
              <Link href="/terms">Syarat &amp; Ketentuan</Link>
              <Link href="/privacy">Kebijakan Privasi</Link>
            </div>
            <div>
              <h4>Akun</h4>
              <Link href="/login">Masuk</Link>
              <Link href="/register">Daftar Gratis</Link>
            </div>
          </div>
        </div>
        <div className="lp-container">
          <div className="lp-footer-bottom">
            © {new Date().getFullYear()} {APP} · sayabayar.com · All rights reserved.
          </div>
        </div>
      </footer>

    </div>
  )
}
