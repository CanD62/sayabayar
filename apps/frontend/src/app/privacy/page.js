// apps/frontend/src/app/privacy/page.js
import Link from 'next/link'
import LogoIcon from '@/components/LogoIcon'

export const metadata = {
  title: 'Kebijakan Privasi — Saya Bayar',
  description: 'Kebijakan privasi Saya Bayar menjelaskan bagaimana kami mengumpulkan, menggunakan, dan melindungi data pribadi pengguna.',
}

const APP = 'Saya Bayar'
const DOMAIN = 'sayabayar.com'
const EMAIL = 'support@sayabayar.com'
const LAST_UPDATED = '29 Maret 2026'

export default function PrivacyPage() {
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
              🔒 Privasi & Data
            </div>
            <h1 style={{ fontSize: '2rem', fontWeight: 800, lineHeight: 1.2, marginBottom: 12 }}>
              Kebijakan Privasi
            </h1>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              Terakhir diperbarui: <strong style={{ color: 'var(--text-secondary)' }}>{LAST_UPDATED}</strong>
              {' · '}Berlaku untuk semua pengguna <strong style={{ color: 'var(--text-secondary)' }}>{DOMAIN}</strong>
            </p>
          </div>

          {/* Highlight box */}
          <div style={{
            marginBottom: 40, padding: '16px 20px',
            background: 'rgba(16,185,129,0.06)',
            border: '1px solid rgba(16,185,129,0.15)',
            borderRadius: 'var(--radius-md)',
            fontSize: '0.88rem', color: 'var(--text-secondary)', lineHeight: 1.7
          }}>
            <strong style={{ color: 'var(--accent)' }}>Singkatnya:</strong>{' '}
            Kami mengumpulkan data yang diperlukan untuk menjalankan layanan verifikasi pembayaran. Kami tidak menjual data Anda kepada pihak ketiga. Data sensitif seperti kredensial akun bank dienkripsi sebelum disimpan.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 40 }}>

            {/* 1 */}
            <Section num="1" title="Data yang Kami Kumpulkan">
              <SubTitle>1.1 Data yang Anda Berikan</SubTitle>
              <p>Saat mendaftar dan menggunakan layanan, kami mengumpulkan:</p>
              <DataTable items={[
                ['Nama lengkap', 'Identifikasi akun dan tampilan di dashboard'],
                ['Alamat email', 'Login, notifikasi, dan komunikasi layanan'],
                ['Nomor telepon', 'Opsional — kontak tambahan'],
                ['Password', 'Disimpan dalam bentuk hash (bcrypt) yang tidak dapat dibalik'],
                ['Data rekening bank', 'Username & password internet banking untuk Channel Klien — dienkripsi AES-256-GCM'],
                ['Data QRIS', 'String QRIS TLV untuk generate QR Code pembayaran'],
                ['Informasi pelanggan invoice', 'Nama dan email pelanggan yang dimasukkan saat membuat invoice (opsional)'],
              ]} />

              <SubTitle>1.2 Data yang Dikumpulkan Otomatis</SubTitle>
              <p>Saat menggunakan platform, sistem secara otomatis mencatat:</p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Alamat IP dan browser saat akses dashboard</li>
                <li>Log aktivitas (login, buat invoice, webhook delivery)</li>
                <li>Data mutasi transaksi dari rekening yang terdaftar</li>
                <li>Waktu dan status setiap operasi</li>
              </ul>

              <SubTitle>1.3 Data yang Tidak Kami Kumpulkan</SubTitle>
              <ul style={{ marginTop: 8, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Informasi kartu kredit/debit</li>
                <li>Data biometrik (sidik jari, wajah)</li>
                <li>Riwayat penelusuran web di luar platform kami</li>
                <li>Data lokasi secara real-time</li>
              </ul>
            </Section>

            {/* 2 */}
            <Section num="2" title="Cara Kami Menggunakan Data">
              <p>Data yang kami kumpulkan digunakan semata-mata untuk:</p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Menjalankan layanan verifikasi</strong> — memantau mutasi rekening dan mencocokkan dengan invoice aktif</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Autentikasi</strong> — memverifikasi identitas Anda saat login</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Notifikasi webhook</strong> — mengirimkan pemberitahuan pembayaran ke endpoint yang Anda daftarkan</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Manajemen saldo</strong> — mencatat dan memproses penarikan dana</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Keamanan platform</strong> — mendeteksi aktivitas mencurigakan dan mencegah penipuan</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Peningkatan layanan</strong> — menganalisis pola penggunaan secara agregat (anonim)</li>
              </ul>
            </Section>

            {/* 3 */}
            <Section num="3" title="Keamanan Data">
              <SubTitle>3.1 Enkripsi</SubTitle>
              <p>Data sensitif Anda dilindungi dengan lapisan keamanan berikut:</p>
              <div style={{
                marginTop: 16, borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', overflow: 'hidden'
              }}>
                {[
                  ['Password akun', 'Bcrypt hash (tidak dapat dibalik)', 'var(--success)'],
                  ['Kredensial rekening bank', 'AES-256-GCM enkripsi end-to-end', 'var(--success)'],
                  ['Webhook Secret', 'Disimpan terenkripsi, hanya ditampilkan sekali saat dibuat', 'var(--success)'],
                  ['API Key', 'SHA-256 hash — raw key hanya ditampilkan saat pertama dibuat', 'var(--success)'],
                  ['Koneksi data', 'TLS/HTTPS untuk semua komunikasi', 'var(--success)'],
                ].map(([item, method, color], i, arr) => (
                  <div key={item} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                  }}>
                    <div style={{
                      padding: '10px 16px', fontSize: '0.82rem', fontWeight: 600,
                      color: 'var(--text-primary)', borderRight: '1px solid var(--border)'
                    }}>{item}</div>
                    <div style={{
                      padding: '10px 16px', fontSize: '0.82rem',
                      color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6
                    }}>
                      <span style={{ color, fontSize: '0.7rem' }}>●</span> {method}
                    </div>
                  </div>
                ))}
              </div>

              <SubTitle>3.2 Akses Data Internal</SubTitle>
              <p>
                Hanya staf teknis yang memiliki kewenangan terbatas yang dapat mengakses data sistem, itupun hanya untuk keperluan pemeliharaan dan penanganan masalah. Kredensial rekening bank Anda tidak dapat dibaca dalam bentuk plaintext oleh siapapun, termasuk tim kami.
              </p>

              <SubTitle>3.3 Tanggung Jawab Anda</SubTitle>
              <p>
                Keamanan akun Anda juga bergantung pada langkah yang Anda ambil. Gunakan password yang kuat, jangan bagikan API Key kepada pihak yang tidak terpercaya, dan segera hubungi kami jika mencurigai adanya akses tidak sah.
              </p>
            </Section>

            {/* 4 */}
            <Section num="4" title="Berbagi Data dengan Pihak Ketiga">
              <p>
                Kami <strong>tidak menjual, menyewakan, atau membagikan</strong> data pribadi Anda kepada pihak ketiga untuk tujuan komersial.
              </p>
              <p style={{ marginTop: 12 }}>
                Data Anda hanya dibagikan dalam kondisi berikut:
              </p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Penyedia infrastruktur</strong> — server hosting, database, dan Redis yang kami gunakan untuk menjalankan platform. Penyedia ini tunduk pada perjanjian kerahasiaan.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Webhook endpoint Anda sendiri</strong> — data invoice yang Anda konfigurasikan untuk dikirim ke server Anda melalui sistem webhook.
                </li>
                <li>
                  <strong style={{ color: 'var(--text-primary)' }}>Kewajiban hukum</strong> — jika diwajibkan oleh hukum, peraturan, atau perintah pengadilan yang berlaku di Indonesia.
                </li>
              </ul>
            </Section>

            {/* 5 */}
            <Section num="5" title="Cookie dan Penyimpanan Lokal">
              <p>Platform menggunakan mekanisme berikut untuk fungsionalitas layanan:</p>
              <div style={{
                marginTop: 16, borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border)', overflow: 'hidden'
              }}>
                {[
                  ['Cookie httpOnly', 'Refresh token untuk mempertahankan sesi login', 'Wajib untuk fungsi login'],
                  ['Memory (JavaScript)', 'Access token JWT selama sesi browser aktif', 'Keamanan — tidak disimpan ke localStorage'],
                ].map(([type, use, note], i, arr) => (
                  <div key={type} style={{
                    display: 'grid', gridTemplateColumns: '160px 1fr 1fr',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                    fontSize: '0.82rem'
                  }}>
                    <div style={{
                      padding: '10px 14px', fontWeight: 600, color: 'var(--accent)',
                      background: 'var(--accent-subtle)', borderRight: '1px solid var(--border)'
                    }}>{type}</div>
                    <div style={{ padding: '10px 14px', color: 'var(--text-secondary)', borderRight: '1px solid var(--border)' }}>{use}</div>
                    <div style={{ padding: '10px 14px', color: 'var(--text-muted)', fontStyle: 'italic' }}>{note}</div>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: 12 }}>
                Kami tidak menggunakan cookie pelacak atau analytics pihak ketiga (Google Analytics, Facebook Pixel, dsb.).
              </p>
            </Section>

            {/* 6 */}
            <Section num="6" title="Hak Anda atas Data">
              <p>Sebagai Pengguna, Anda memiliki hak untuk:</p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <li><strong style={{ color: 'var(--text-primary)' }}>Mengakses</strong> data pribadi Anda yang kami simpan melalui dashboard atau dengan menghubungi kami</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Memperbarui</strong> informasi profil Anda kapan saja melalui dashboard</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Menghapus</strong> akun dan data Anda — hubungi kami untuk memulai proses penghapusan. Kami akan menghapus data dalam 30 hari, kecuali data yang diwajibkan disimpan oleh hukum</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Portabilitas</strong> — meminta ekspor data invoice dan transaksi dalam format yang dapat dibaca</li>
                <li><strong style={{ color: 'var(--text-primary)' }}>Mencabut izin</strong> — menonaktifkan Channel dan menghentikan pemantauan rekening kapan saja</li>
              </ul>
              <p style={{ marginTop: 12 }}>
                Untuk mengajukan permintaan terkait data, kirimkan email ke <a href={`mailto:${EMAIL}`}>{EMAIL}</a> dengan subjek "Permintaan Data - [nama akun Anda]".
              </p>
            </Section>

            {/* 7 */}
            <Section num="7" title="Retensi Data">
              <p>Kami menyimpan data Anda selama akun aktif. Setelah akun dihapus:</p>
              <ul style={{ marginTop: 12, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <li>Data profil dan kredensial dihapus dalam <strong>30 hari</strong></li>
                <li>Log transaksi dapat disimpan hingga <strong>1 tahun</strong> untuk keperluan audit dan kepatuhan hukum</li>
                <li>Log webhook dihapus dalam <strong>90 hari</strong> setelah akun ditutup</li>
              </ul>
            </Section>

            {/* 8 */}
            <Section num="8" title="Perubahan Kebijakan Privasi">
              <p>
                Kami dapat memperbarui Kebijakan Privasi ini dari waktu ke waktu. Perubahan material akan diberitahukan melalui email terdaftar minimal <strong>14 hari</strong> sebelum berlaku. Kebijakan terbaru selalu tersedia di halaman ini.
              </p>
            </Section>

            {/* 9 */}
            <Section num="9" title="Hukum yang Berlaku">
              <p>
                Kebijakan Privasi ini diatur berdasarkan hukum yang berlaku di <strong>Republik Indonesia</strong>, termasuk namun tidak terbatas pada Undang-Undang No. 27 Tahun 2022 tentang Perlindungan Data Pribadi (UU PDP).
              </p>
            </Section>

            {/* 10 */}
            <Section num="10" title="Hubungi Kami">
              <p>
                Jika Anda memiliki pertanyaan, kekhawatiran, atau permintaan terkait privasi data Anda, silakan hubungi kami:
              </p>
              <div style={{
                marginTop: 16, padding: '16px 20px',
                background: 'var(--accent-subtle)', borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(16,185,129,0.2)', display: 'flex', flexDirection: 'column', gap: 6
              }}>
                <div>📧 Email: <a href={`mailto:${EMAIL}`}>{EMAIL}</a></div>
                <div>🌐 Website: <a href={`https://${DOMAIN}`}>{DOMAIN}</a></div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
                  Kami berusaha merespons setiap permintaan dalam 2 hari kerja.
                </div>
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
              <Link href="/terms" style={{ color: 'var(--text-muted)' }}>Syarat & Ketentuan</Link>
              <Link href="/privacy" style={{ color: 'var(--accent)' }}>Kebijakan Privasi</Link>
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

function DataTable({ items }) {
  return (
    <div style={{
      marginTop: 16, borderRadius: 'var(--radius-md)',
      border: '1px solid var(--border)', overflow: 'hidden'
    }}>
      {items.map(([field, purpose], i) => (
        <div key={field} style={{
          display: 'grid', gridTemplateColumns: '200px 1fr',
          borderBottom: i < items.length - 1 ? '1px solid var(--border)' : 'none',
        }}>
          <div style={{
            padding: '10px 16px', fontWeight: 600, fontSize: '0.82rem',
            color: 'var(--accent)', background: 'var(--accent-subtle)',
            borderRight: '1px solid var(--border)'
          }}>{field}</div>
          <div style={{ padding: '10px 16px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>{purpose}</div>
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
