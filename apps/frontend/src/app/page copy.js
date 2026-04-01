'use client'
import { useRedirectIfAuthenticated } from '@/lib/AuthContext'
import { useState, useEffect } from 'react'
import Link from 'next/link'

import {
  Shield, Bell, BarChart3, CreditCard, Clock, Zap,
  ArrowRight, CheckCircle, Star, FileText, TrendingUp,
  Send, CircleCheckBig, XCircle, Wallet, Building2
} from 'lucide-react'
import LogoIcon from '@/components/LogoIcon'

const APP = process.env.NEXT_PUBLIC_APP_NAME || 'Saya Bayar'

const FEATURES = [
  {
    icon: Zap,
    title: 'Auto-Verifikasi Pembayaran',
    desc: 'Mutasi bank dicek otomatis setiap saat. Begitu pelanggan transfer, invoice langsung lunas. Tanpa Anda angkat jari.',
  },
  {
    icon: CreditCard,
    title: 'BANK dan QRIS',
    desc: 'Dukung transfer BANK dan QRIS. Pelanggan pilih yang paling nyaman.',
  },
  {
    icon: Building2,
    title: 'Rekening Sendiri (Pro)',
    desc: 'Pengguna berbayar bisa tambah channel rekening sendiri. Dana 100% Langsung ke Rekening Anda.',
  },
  {
    icon: Bell,
    title: 'Webhook Realtime',
    desc: 'Notifikasi dikirim instan ke server Anda saat invoice lunas. Cocok untuk integrasi toko online, SaaS, atau bot.',
  },
  {
    icon: BarChart3,
    title: 'Dashboard Invoice',
    desc: 'Buat, pantau, dan kelola semua invoice dari satu halaman. Status realtime, riwayat lengkap.',
  },
  {
    icon: Clock,
    title: 'Aktif 24 Jam',
    desc: 'Sistem bekerja non-stop. Pembayaran terverifikasi tengah malam sekalipun, tanpa ada yang jaga.',
  },
]

const STEPS = [
  {
    num: '01',
    icon: FileText,
    title: 'Buat Invoice',
    desc: 'Isi nama pelanggan dan nominal. Klik Buat. Selesai dalam 10 detik. Link pembayaran siap dikirim.',
  },
  {
    num: '02',
    icon: Send,
    title: 'Pelanggan Transfer',
    desc: 'Pelanggan buka link, lihat nomor rekening dan nominal, lalu transfer. Bisa Transfer BANK atau scan QRIS.',
  },
  {
    num: '03',
    icon: CircleCheckBig,
    title: 'Invoice Lunas Otomatis',
    desc: 'Dalam hitungan detik sistem mencocokkan pembayaran. Invoice lunas, webhook dikirim, saldo masuk.',
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
    text: 'Dulu saya cek mutasi BCA manual tiap pagi. Sekarang invoice langsung lunas otomatis. Hemat 2 jam sehari.',
    avatar: 'AP',
  },
  {
    name: 'Sari Dewi',
    role: 'Pemilik Toko Online',
    text: 'Mudah banget. Buat invoice, kirim link ke pelanggan, done. Saldo masuk dan bisa dicairkan. Tidak perlu teknis.',
    avatar: 'SD',
  },
  {
    name: 'Rizky Fauzan',
    role: 'Developer Freelance',
    text: 'Webhook-nya langsung ke sistem saya. Setup 10 menit sudah jalan. Plan berbayarnya worth it banget.',
    avatar: 'RF',
  },
]

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

const PAYMENT_TOASTS = [
  { channel: 'BCA Transfer' },
  { channel: 'QRIS' },
  { channel: 'BCA Transfer' },
  { channel: 'QRIS GoPay' },
  { channel: 'BCA Transfer' },
  { channel: 'QRIS' },
  { channel: 'BCA Transfer' },
  { channel: 'QRIS GoPay' },
  { channel: 'BCA Transfer' },
  { channel: 'QRIS' },
]


const fmt = (n) => new Intl.NumberFormat('id-ID').format(n)

// Bulatkan ke ribuan agar terlihat wajar
function randomAmount(channel) {
  const isQris = channel.toLowerCase().includes('qris')
  const min = 10000
  const max = isQris ? 500000 : 10000000
  const raw = Math.floor(Math.random() * (max - min + 1)) + min
  // Bulatkan ke 1000
  return Math.round(raw / 1000) * 1000
}

function randomInvoice() {
  const d = new Date()
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const num = String(Math.floor(1000 + Math.random() * 8999))
  return `INV-${ymd}-${num}`
}

function randomTime() {
  const r = Math.random()
  if (r < 0.35) return 'baru saja dibayar ✓'
  const secs = Math.floor(5 + Math.random() * 55)
  return `${secs} detik yang lalu ✓`
}

function PaymentToast() {
  const [visible, setVisible] = useState(false)
  const [current, setCurrent] = useState(null)

  useEffect(() => {
    const firstDelay = setTimeout(() => show(0), 3000)
    return () => clearTimeout(firstDelay)
  }, [])

  function show(i) {
    const base = PAYMENT_TOASTS[i % PAYMENT_TOASTS.length]
    setCurrent({ ...base, name: randomName(), amount: randomAmount(base.channel), invoice: randomInvoice(), time: randomTime() })
    setVisible(true)

    // Sembunyikan setelah 3.5 detik
    const hideTimer = setTimeout(() => {
      setVisible(false)
      // Tampilkan berikutnya setelah 4-7 detik
      const next = i + 1
      const delay = 4000 + Math.random() * 3000
      const nextTimer = setTimeout(() => show(next), delay)
      return () => clearTimeout(nextTimer)
    }, 3500)

    return () => clearTimeout(hideTimer)
  }

  if (!current) return null

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: 24,
        zIndex: 9999,
        transform: visible ? 'translateY(0)' : 'translateY(120%)',
        opacity: visible ? 1 : 0,
        transition: 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1), opacity 0.3s ease',
        pointerEvents: visible ? 'auto' : 'none',
        maxWidth: 300,
      }}
    >
      <div style={{
        background: 'rgba(15,17,24,0.92)',
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
          <div style={{ fontSize: '0.68rem', color: 'rgba(148,163,184,0.6)', marginTop: 1 }}>{current.time}</div>
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
            <Zap size={14} /> Verifikasi pembayaran otomatis untuk bisnis Indonesia
          </div>
          <h1 className="lp-hero-title">
            Pelanggan Transfer,<br />
            <span className="lp-gradient-text">Invoice Lunas Sendiri</span>
          </h1>
          <p className="lp-hero-subtitle">
            Buat invoice dalam 10 detik. Pelanggan bayar via BANK, atau QRIS.
            Sistem mencocokkan pembayaran otomatis — tanpa Anda cek mutasi.
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
            <h2 className="lp-section-title">Anda Masih Cek Mutasi Manual?</h2>
            <p className="lp-section-subtitle">Ini yang membuat pebisnis online buang waktu setiap hari</p>
          </div>
          <div className="lp-problem-grid">
            <div className="lp-problem-card">
              <div className="lp-problem-icon lp-problem-icon-danger"><XCircle size={20} /></div>
              <h3>Cek Mutasi Tiap Hari</h3>
              <p>Login iBanking, scroll ratusan baris mutasi, cocokkan satu per satu dengan orderan. Berulang tiap hari, membuang waktu berjam-jam.</p>
            </div>
            <div className="lp-problem-card">
              <div className="lp-problem-icon lp-problem-icon-danger"><XCircle size={20} /></div>
              <h3>Salah Konfirmasi</h3>
              <p>Salah nominal, terlewat transfer, orderan tidak diproses. Pelanggan komplain, kepercayaan turun, reputasi bisnis yang jadi taruhan.</p>
            </div>
            <div className="lp-problem-card lp-problem-card-solution">
              <div className="lp-problem-icon lp-problem-icon-success">
                <CheckCircle size={20} />
              </div>
              <h3>Solusinya: {APP}</h3>
              <p>Invoice dibuat, pelanggan transfer, status berubah lunas otomatis. Anda fokus jualan — bukan fokus cek mutasi.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── Cara Kerja ───────────────────────────── */}
      <section className="lp-section" id="cara-kerja">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Simpel. 3 Langkah. Selesai.</h2>
            <p className="lp-section-subtitle">Tidak perlu teknis, tidak perlu setting ribet</p>
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
            <p className="lp-section-subtitle">Dari invoice sederhana sampai integrasi webhook — sudah ada semua</p>
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

      {/* ── Pricing ──────────────────────────────── */}
      <section className="lp-section" id="harga">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Harga Transparan, Tanpa Kejutan</h2>
            <p className="lp-section-subtitle">Mulai gratis, upgrade kalau sudah butuh lebih</p>
          </div>
          <div className="lp-pricing">

            {/* Gratis */}
            <div className="lp-pricing-card">
              <div className="lp-pricing-name">Gratis</div>
              <div className="lp-pricing-price">Rp 0 <span>/bulan</span></div>
              <p className="text-sm text-muted" style={{ marginBottom: 20 }}>
                Cocok untuk mulai coba atau bisnis kecil
              </p>
              <ul className="lp-pricing-features">
                <li><CheckCircle size={16} /> Invoice unlimited</li>
                <li><CheckCircle size={16} /> Auto-verifikasi pembayaran</li>
                <li><CheckCircle size={16} /> Transfer BANK & QRIS (channel platform)</li>
                <li><CheckCircle size={16} /> Webhook notifikasi realtime</li>
                <li><CheckCircle size={16} /> API key untuk integrasi</li>
                <li><CheckCircle size={16} /> Tanpa biaya per transaksi</li>
                <li className="lp-pricing-note"><Wallet size={14} /> Dana masuk ke saldo — cairkan kapan saja (Rp 2.500/pencairan)</li>
                <li className="lp-pricing-note" style={{ marginTop: 4, opacity: 0.8 }}><Shield size={14} /> Nominal ditambah beberapa digit agar pembayaran terverifikasi otomatis</li>
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
                Untuk bisnis yang butuh kontrol penuh atas pembayaran
              </p>
              <ul className="lp-pricing-features">
                <li><CheckCircle size={16} /> Semua fitur Gratis</li>
                <li><CheckCircle size={16} /> Tambah channel rekening sendiri</li>
                <li><CheckCircle size={16} /> Dana 100% langsung ke rekening Anda</li>
                <li><CheckCircle size={16} /> Termasuk digit verifikasi — semuanya milik Anda</li>
                <li><CheckCircle size={16} /> BANK: BCA · QRIS: BCA & GoPay</li>
                <li><CheckCircle size={16} /> Channel platform tetap aktif (backup)</li>
                <li><CheckCircle size={16} /> Tanpa biaya pencairan</li>
                <li><CheckCircle size={16} /> Prioritas support</li>
              </ul>
              <Link href="/register" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                Langganan Sekarang <ArrowRight size={16} />
              </Link>
            </div>

          </div>

          {/* Note bawah pricing */}
          <p style={{ textAlign: 'center', marginTop: 20, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            ✦ Setiap invoice ditambahkan nominal verifikasi kecil agar sistem mencocokkan pembayaran secara otomatis.
          </p>
        </div>
      </section>

      {/* ── Testimonials ─────────────────────────── */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-section-header">
            <h2 className="lp-section-title">Kata Mereka yang Sudah Pakai</h2>
            <p className="lp-section-subtitle">Pebisnis dan developer yang hemat waktu setiap harinya</p>
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

      {/* ── CTA Final ───────────────────────────── */}
      <section className="lp-cta">
        <div className="lp-container" style={{ textAlign: 'center' }}>
          <h2 className="lp-cta-title">
            Besok Masih Mau Cek Mutasi Manual?
          </h2>
          <p className="lp-cta-subtitle">
            Daftar sekarang, buat invoice pertama Anda dalam 5 menit. Gratis, Tanpa perlu teknis.
          </p>
          <Link href="/register" className="btn btn-primary btn-lg">
            Coba {APP} Gratis <ArrowRight size={18} />
          </Link>
          <div className="lp-cta-trust">
            <span><CheckCircle size={14} /> Gratis untuk memulai</span>
            <span><CheckCircle size={14} /> Setup 5 menit</span>
            <span><CheckCircle size={14} /> Tanpa perlu teknis</span>
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
              Invoice otomatis & verifikasi pembayaran untuk bisnis Indonesia.<br />
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
