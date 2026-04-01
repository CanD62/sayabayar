// apps/frontend/src/app/terms/page.js
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'

export const metadata = {
  title: 'Syarat & Ketentuan — Saya Bayar',
  description: 'Syarat dan ketentuan penggunaan layanan Saya Bayar, platform verifikasi pembayaran otomatis untuk bisnis Indonesia.',
}

const APP = 'Saya Bayar'
const DOMAIN = 'sayabayar.com'
const EMAIL = 'support@sayabayar.com'
const LAST_UPDATED = '29 Maret 2026'

export default function TermsPage() {
  return (
    <div className="lp">
      {/* Navbar */}
      <nav className="lp-nav">
        <div className="lp-container lp-nav-inner">
          <Link href="/" className="lp-logo">
            <LogoIcon size={22} /> {APP}
          </Link>
          <div className="lp-nav-actions">
            <Link href="/login" className="btn btn-ghost btn-sm">Masuk</Link>
            <Link href="/register" className="btn btn-primary btn-sm">Coba Gratis</Link>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="lp-container" style={{ paddingTop: 100, paddingBottom: 80 }}>
        <div style={{ maxWidth: 760, margin: '0 auto' }}>

          {/* Header */}
          <div style={{ marginBottom: 48, paddingBottom: 32, borderBottom: '1px solid var(--border)' }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              background: 'var(--accent-subtle)', border: '1px solid rgba(16,185,129,0.2)',
              borderRadius: 20, padding: '4px 14px', fontSize: '0.75rem',
              fontWeight: 600, color: 'var(--accent)', marginBottom: 16
            }}>
              📄 Dokumen Legal
            </div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1.2, marginBottom: 12 }}>
              Syarat & Ketentuan
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Terakhir diperbarui: <strong style={{ color: 'var(--text-secondary)' }}>{LAST_UPDATED}</strong>
              {' · '}Berlaku untuk semua pengguna <strong style={{ color: 'var(--text-secondary)' }}>{DOMAIN}</strong>
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

            {/* 1 */}
            <Section num="1" title="Definisi dan Pengenalan">
              <p>
                Selamat datang di <strong>{APP}</strong>, layanan verifikasi pembayaran otomatis yang dikelola oleh penyelenggara platform <strong>{DOMAIN}</strong> ("Kami", "Platform").
              </p>
              <p style={{ marginTop: 12 }}>
                Dengan mendaftar dan menggunakan layanan {APP}, Anda ("Pengguna" atau "Klien") menyatakan telah membaca, memahami, dan menyetujui Syarat & Ketentuan ini secara menyeluruh. Jika Anda tidak menyetujui ketentuan ini, harap tidak menggunakan layanan kami.
              </p>
              <DefinitionList items={[
                ['Platform', `Sistem, aplikasi web, dan API yang tersedia di ${DOMAIN}`],
                ['Klien', 'Individu atau badan usaha yang mendaftarkan akun di platform'],
                ['Invoice', 'Tagihan pembayaran yang dibuat oleh Klien untuk pelanggan mereka'],
                ['Pelanggan', 'Pihak ketiga yang melakukan pembayaran atas Invoice yang dibuat Klien'],
                ['Channel', 'Metode penerimaan pembayaran (rekening Bank atau QRIS)'],
                ['Channel Platform', 'Rekening milik Platform yang digunakan bersama oleh Klien plan gratis'],
                ['Channel Klien', 'Rekening pribadi milik Klien (tersedia di plan Berbayar)'],
                ['Settlement', 'Proses pencairan saldo ke rekening Klien'],
              ]} />
            </Section>

            {/* 2 */}
            <Section num="2" title="Layanan yang Diberikan">
              <p>
                {APP} menyediakan sistem verifikasi pembayaran otomatis yang memungkinkan Klien untuk:
              </p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>Membuat invoice pembayaran dengan nominal tertentu</li>
                <li>Menerima pembayaran melalui Transfer Bank dan Scan QRIS</li>
                <li>Mendapatkan notifikasi otomatis saat invoice lunas melalui webhook</li>
                <li>Mengelola saldo dan mengajukan penarikan dana</li>
                <li>Mengakses data transaksi melalui API</li>
              </ul>
              <SubTitle>2.1 Plan Gratis</SubTitle>
              <p>
                Pada plan Gratis, pembayaran diterima melalui <strong>Channel Platform</strong> (rekening Bank/QRIS milik {APP}). Dana yang masuk diakumulasi dalam saldo Klien dan dapat dicairkan setelah melewati masa holding <strong>H+2 (dua hari kerja)</strong> sejak pembayaran terdeteksi. Biaya penarikan sebesar <strong>Rp 2.500</strong> per transaksi.
              </p>
              <SubTitle>2.2 Plan Berbayar</SubTitle>
              <p>
                Klien plan Berbayar dapat mendaftarkan rekening Bank dan QRIS milik sendiri sebagai Channel Klien. Dana dari pembayaran masuk langsung ke rekening Klien tanpa melewati rekening Platform, sehingga tidak ada masa holding H+2 dan tidak ada biaya penarikan.
              </p>
              <SubTitle>2.3 Kode Unik</SubTitle>
              <p>
                Untuk membedakan setiap transaksi pada Channel yang sama, Platform menambahkan kode unik (1–999 Rupiah) pada nominal invoice. Kode unik ini menjadi bagian dari sistem pencocokan dan diteruskan sebagai bagian dari nominal yang diterima.
              </p>
            </Section>

            {/* 3 */}
            <Section num="3" title="Kewajiban dan Tanggung Jawab Klien">
              <p>Dengan menggunakan layanan ini, Klien bertanggung jawab untuk:</p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>Memberikan informasi akun yang akurat, lengkap, dan terkini</li>
                <li>Menjaga kerahasiaan kredensial login (email & password) dan API Key</li>
                <li>Memastikan bahwa penggunaan layanan sesuai dengan hukum yang berlaku di Indonesia</li>
                <li>Tidak menggunakan platform untuk transaksi yang melanggar hukum, penipuan, atau aktivitas ilegal</li>
                <li>Segera melaporkan kepada Kami jika terjadi akses tidak sah ke akun Klien</li>
                <li>Memastikan pelanggan Klien diberikan informasi yang benar mengenai tagihan yang harus dibayar</li>
              </ul>
              <SubTitle>3.1 Data Rekening (Channel Klien)</SubTitle>
              <p>
                Klien yang menyambungkan rekening pribadi bertanggung jawab memastikan rekening tersebut adalah milik sah Klien atau pihak yang diberi wewenang. Kami dapat menonaktifkan Channel yang terbukti menggunakan rekening tanpa izin.
              </p>
              <SubTitle>3.2 Webhook dan API</SubTitle>
              <p>
                Klien bertanggung jawab menjaga keamanan Webhook Secret dan API Key. Kami tidak bertanggung jawab atas kerugian akibat kebocoran yang disebabkan oleh kelalaian Klien.
              </p>
            </Section>

            {/* 4 */}
            <Section num="4" title="Proses Pembayaran dan Verifikasi">
              <SubTitle>4.1 Cara Kerja Verifikasi</SubTitle>
              <p>
                Platform secara otomatis memantau mutasi rekening Bank dan QRIS yang terdaftar. Saat transaksi terdeteksi dengan nominal yang cocok dengan invoice aktif, invoice dinyatakan lunas secara otomatis. Estimasi waktu verifikasi normal adalah <strong>kurang dari 60 detik</strong> sejak transfer berhasil.
              </p>
              <p style={{ marginTop: 12 }}>
                Kami tidak menjamin waktu verifikasi tertentu. Faktor seperti keterlambatan pada sistem bank, pemeliharaan layanan, atau kondisi teknis dapat mempengaruhi kecepatan verifikasi.
              </p>
              <SubTitle>4.2 Gagal Cocok (Unmatched Transaction)</SubTitle>
              <p>
                Jika pelanggan mentransfer nominal yang berbeda dari yang tertera (termasuk kode unik), transaksi akan masuk sebagai <em>unmatched</em> dan perlu ditinjau secara manual. {APP} tidak bertanggung jawab atas pembayaran yang salah nominal akibat kelalaian pelanggan.
              </p>
              <SubTitle>4.3 Masa Berlaku Invoice</SubTitle>
              <p>
                Invoice yang tidak dibayar dalam waktu yang ditentukan (default: 60 menit, dapat disesuaikan) akan otomatis berubah status menjadi <em>kedaluwarsa</em>. Pengembalian dana atas pembayaran yang masuk setelah invoice kedaluwarsa harus dikomunikasikan langsung antara Klien dan pelanggannya.
              </p>
            </Section>

            {/* 5 */}
            <Section num="5" title="Saldo, Settlement, dan Penarikan Dana">
              <SubTitle>5.1 Saldo Pending (Plan Gratis)</SubTitle>
              <p>
                Dana dari invoice yang lunas via Channel Platform akan dikreditkan sebagai <em>Saldo Pending</em>. Setelah melewati masa holding <strong>H+2</strong>, saldo otomatis dipindahkan ke <em>Saldo Tersedia</em> yang dapat ditarik.
              </p>
              <SubTitle>5.2 Pengajuan Penarikan</SubTitle>
              <p>
                Penarikan minimum adalah <strong>Rp 50.000</strong>. Penarikan diproses secara manual oleh tim {APP} dalam waktu kerja. Kami berhak memverifikasi identitas Klien sebelum memproses penarikan besar.
              </p>
              <SubTitle>5.3 Penolakan Penarikan</SubTitle>
              <p>
                Kami berhak menolak atau menunda penarikan jika ada indikasi penipuan, sengketa yang belum diselesaikan, atau pelanggaran terhadap Syarat & Ketentuan ini.
              </p>
              <SubTitle>5.4 Biaya Layanan</SubTitle>
              <p>
                Saat ini Platform tidak mengenakan biaya per transaksi. Hanya biaya penarikan sebesar <strong>Rp 2.500</strong> per pengajuan dikenakan untuk plan Gratis. Platform berhak mengubah struktur biaya dengan pemberitahuan minimal 30 hari sebelumnya.
              </p>
            </Section>

            {/* 6 */}
            <Section num="6" title="Langganan Berbayar">
              <p>
                Plan Berbayar dikenakan biaya <strong>Rp 99.000/bulan</strong>. Pembayaran dilakukan melalui invoice yang dibuat sistem, dapat dibayar via metode pembayaran yang tersedia. Langganan aktif selama 1 bulan sejak pembayaran terverifikasi.
              </p>
              <p style={{ marginTop: 12 }}>
                Perpanjangan langganan tidak bersifat otomatis. Klien perlu melakukan perpanjangan secara manual sebelum masa berlaku habis. Jika langganan tidak diperpanjang, akun otomatis kembali ke plan Gratis dan Channel Klien akan dinonaktifkan.
              </p>
            </Section>

            {/* 7 */}
            <Section num="7" title="Pembatasan Layanan dan Penangguhan Akun">
              <p>Kami berhak menangguhkan atau menghentikan akun Klien tanpa pemberitahuan sebelumnya jika:</p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Terdapat indikasi penggunaan layanan untuk aktivitas penipuan atau melanggar hukum</li>
                <li>Klien memberikan informasi palsu saat registrasi</li>
                <li>Terjadi penyalahgunaan API Key atau Webhook yang merugikan pihak lain</li>
                <li>Klien melanggar ketentuan yang tercantum dalam dokumen ini</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                Saldo yang tersedia pada akun yang ditangguhkan akan dibekukan sementara selama proses investigasi. Jika terbukti tidak ada pelanggaran, saldo akan dikembalikan.
              </p>
            </Section>

            {/* 8 */}
            <Section num="8" title="Batasan Tanggung Jawab">
              <p>
                {APP} adalah alat bantu verifikasi pembayaran, bukan lembaga keuangan atau perbankan. Kami tidak bertanggung jawab atas:
              </p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Keterlambatan verifikasi akibat gangguan teknis pada sistem bank pihak ketiga</li>
                <li>Kerugian bisnis akibat downtime layanan yang berada di luar kendali kami</li>
                <li>Transaksi yang tidak tercocokkan karena nominal pembayaran tidak tepat</li>
                <li>Sengketa transaksi antara Klien dan pelanggannya</li>
                <li>Kerugian akibat kebocoran API Key atau Webhook Secret oleh Klien</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                Total tanggung jawab Platform kepada Klien tidak akan melebihi jumlah yang dibayarkan Klien kepada Platform dalam 3 (tiga) bulan terakhir.
              </p>
            </Section>

            {/* 9 */}
            <Section num="9" title="Perubahan Layanan dan Syarat">
              <p>
                Kami berhak mengubah fitur, biaya, atau ketentuan layanan ini kapan saja. Perubahan yang signifikan akan diinformasikan kepada Klien melalui email terdaftar atau notifikasi di dashboard, minimal <strong>14 hari kalender</strong> sebelum berlaku.
              </p>
              <p style={{ marginTop: 12 }}>
                Penggunaan layanan yang berlanjut setelah perubahan berlaku dianggap sebagai persetujuan terhadap ketentuan yang baru.
              </p>
            </Section>

            {/* 10 */}
            <Section num="10" title="Hukum yang Berlaku">
              <p>
                Syarat & Ketentuan ini diatur oleh dan ditafsirkan sesuai dengan hukum yang berlaku di <strong>Republik Indonesia</strong>. Setiap sengketa yang timbul diselesaikan melalui musyawarah mufakat, dan jika tidak tercapai, akan diselesaikan melalui lembaga arbitrase atau pengadilan yang berwenang di Indonesia.
              </p>
            </Section>

            {/* 11 */}
            <Section num="11" title="Kontak">
              <p>
                Jika Anda memiliki pertanyaan mengenai Syarat & Ketentuan ini, silakan hubungi kami di:
              </p>
              <div style={{
                marginTop: 16, padding: '16px 20px',
                background: 'var(--accent-subtle)', borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(16,185,129,0.2)', display: 'flex', flexDirection: 'column', gap: 6
              }}>
                <div>📧 Email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a></div>
                <div>🌐 Website: <a href={`https://${DOMAIN}`}>{DOMAIN}</a></div>
              </div>
            </Section>

          </div>

          {/* Bottom nav */}
          <div style={{
            marginTop: 56, paddingTop: 32, borderTop: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12
          }}>
            <Link href="/" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              ← Kembali ke Beranda
            </Link>
            <div style={{ display: 'flex', gap: 20, fontSize: '0.85rem' }}>
              <Link href="/terms" style={{ color: 'var(--accent)' }}>Syarat & Ketentuan</Link>
              <Link href="/privacy" style={{ color: 'var(--text-muted)' }}>Kebijakan Privasi</Link>
            </div>
          </div>

        </div>
      </div>

      <LpFooter />
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ num, title, children }) {
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <div style={{
          width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
          background: 'var(--accent-subtle)', border: '1px solid rgba(16,185,129,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent)'
        }}>
          {num}
        </div>
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700 }}>{title}</h2>
      </div>
      <div style={{ paddingLeft: 44, color: 'var(--text-secondary)', lineHeight: 1.75, fontSize: '0.9rem' }}>
        {children}
      </div>
    </section>
  )
}

function SubTitle({ children }) {
  return (
    <h3 style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: 16, marginBottom: 8 }}>
      {children}
    </h3>
  )
}

function DefinitionList({ items }) {
  return (
    <div style={{
      marginTop: 16, borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)', overflow: 'hidden'
    }}>
      {items.map(([term, def], i) => (
        <div key={term} style={{
          display: 'grid', gridTemplateColumns: '160px 1fr',
          borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{
            padding: '10px 16px', fontWeight: 600, fontSize: '0.82rem',
            color: 'var(--accent)', background: 'var(--accent-subtle)',
            borderRight: '1px solid var(--border)'
          }}>{term}</div>
          <div style={{ padding: '10px 16px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{def}</div>
        </div>
      ))}
    </div>
  )
}

function LpFooter() {
  return (
    <footer className="lp-footer">
      <div className="lp-container lp-footer-inner">
        <div className="lp-footer-brand">
          <div className="lp-logo" style={{ marginBottom: 8 }}>
            <LogoIcon size={20} /> Saya Bayar
          </div>
          <p className="text-sm text-muted">
            Invoice otomatis & verifikasi pembayaran untuk bisnis Indonesia.
          </p>
        </div>
        <div className="lp-footer-links">
          <div>
            <h4>Produk</h4>
            <a href="/#cara-kerja">Cara Kerja</a>
            <a href="/#fitur">Fitur</a>
            <a href="/#harga">Harga</a>
          </div>
          <div>
            <h4>Legal</h4>
            <Link href="/terms">Syarat & Ketentuan</Link>
            <Link href="/privacy">Kebijakan Privasi</Link>
          </div>
        </div>
      </div>
      <div className="lp-container">
        <div className="lp-footer-bottom">
          © {new Date().getFullYear()} Saya Bayar · sayabayar.com · All rights reserved.
        </div>
      </div>
    </footer>
  )
}
