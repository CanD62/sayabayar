// apps/api/src/services/email.js
// Nodemailer service — reset password & email verification
// Template: background putih, warna aksen emerald (#10b981) sesuai design system frontend
// Anti-spam: multipart/alternative, List-Unsubscribe, plain-text fallback

import nodemailer from 'nodemailer'

let _transporter = null

function getTransporter() {
  if (_transporter) return _transporter

  // Mailcow sebagai SMTP relay — DKIM signing dilakukan otomatis di level server.
  // Tidak perlu konfigurasi DKIM di nodemailer.
  _transporter = nodemailer.createTransport({
    host:   process.env.SMTP_HOST,
    port:   parseInt(process.env.SMTP_PORT || '587'),
    secure: parseInt(process.env.SMTP_PORT || '587') === 465,
    // 'name' dipakai sebagai EHLO hostname saat connect ke Mailcow.
    // Tanpa ini, Nodemailer fallback ke hostname OS (127.0.0.1) yang
    // menyebabkan helo=<127.0.0.1> di log dan berpotensi dianggap spam.
    name: process.env.SMTP_EHLO_NAME || process.env.SMTP_USER?.split('@')[1] || 'sayabayar.com',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: { rejectUnauthorized: false }
  })

  return _transporter
}

// ─── Logo SVG (sesuai LogoIcon.js frontend — receipt + lightning) ─────────────
// Gradient: #10b981 → #0ea5e9 (sama persis dengan LogoIcon.js)

const LOGO_SVG = `<svg width="22" height="31" viewBox="0 0 20 28" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lg" x1="0" y1="0" x2="20" y2="28" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#0ea5e9"/>
    </linearGradient>
  </defs>
  <path d="M 5,0 L 15,0 Q 20,0 20,5 L 20,22 L 17.5,26 L 15,22 L 12.5,26 L 10,22 L 7.5,26 L 5,22 L 2.5,26 L 0,22 L 0,5 Q 0,0 5,0 Z" fill="url(#lg)"/>
  <path d="M 13.5,2 L 6,13 L 11,13 L 6.5,22 L 15,11 L 10,11 Z" fill="white"/>
</svg>`

// ─── Shared HTML layout ──────────────────────────────────────────────────────

function baseLayout({ preheader, title, bodyContent }) {
  return `<!DOCTYPE html>
<html lang="id" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <title>${title}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"/>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    * { box-sizing: border-box; }
    body, html { margin: 0; padding: 0; }
    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 15px;
      line-height: 1.6;
      color: #1e293b;
      background-color: #f1f5f9;
      -webkit-font-smoothing: antialiased;
    }
    img { border: 0; display: block; }
    table { border-collapse: collapse !important; }

    .wrapper {
      width: 100%;
      background-color: #f1f5f9;
      padding: 40px 16px 56px;
    }
    .container { max-width: 560px; margin: 0 auto; }

    /* Logo area */
    .header-logo {
      text-align: center;
      margin-bottom: 24px;
    }
    .logo-inner {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    /* Logo wordmark — gradient teks sama persis dengan .logo-text di sidebar */
    .logo-text {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    /* Card */
    .card {
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }

    /* Top accent bar — gradient sama dengan --gradient-primary frontend */
    .card-accent {
      height: 3px;
      background: linear-gradient(90deg, #10b981 0%, #06b6d4 100%);
    }

    /* Card body */
    .card-body { padding: 40px; }

    h1 {
      font-size: 22px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.3px;
      margin: 0 0 4px;
    }
    .greeting {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
      margin: 0 0 16px;
    }
    p { margin: 0 0 16px; font-size: 14px; color: #475569; line-height: 1.75; }
    strong { color: #0f172a; }

    /* CTA Button — warna --accent & --accent-hover dari frontend */
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn {
      display: inline-block;
      padding: 14px 40px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: #ffffff !important;
      text-decoration: none;
      border-radius: 10px;
      font-size: 15px;
      font-weight: 700;
      letter-spacing: 0.1px;
      box-shadow: 0 4px 16px rgba(16,185,129,0.30);
    }

    /* Info box — warna --accent-subtle + --border-focus */
    .info-box {
      background: rgba(16,185,129,0.08);
      border: 1px solid rgba(16,185,129,0.25);
      border-left: 4px solid #10b981;
      border-radius: 8px;
      padding: 14px 18px;
      margin: 20px 0;
      font-size: 13px;
      color: #475569;
      line-height: 1.7;
    }
    .info-box strong { color: #065f46; }

    /* Warning box — warna --warning dari frontend */
    .warning-box {
      background: rgba(245,158,11,0.08);
      border: 1px solid rgba(245,158,11,0.25);
      border-left: 4px solid #f59e0b;
      border-radius: 8px;
      padding: 14px 18px;
      margin: 20px 0;
      font-size: 13px;
      color: #78350f;
      line-height: 1.7;
    }
    .warning-box strong { color: #92400e; }

    /* Divider */
    .divider { border: none; border-top: 1px solid #e2e8f0; margin: 24px 0; }

    /* Fallback link */
    .link-fallback { font-size: 12px; color: #94a3b8; word-break: break-all; line-height: 1.6; }
    .link-fallback a { color: #10b981; text-decoration: none; }

    /* Footer */
    .footer { text-align: center; margin-top: 24px; }
    .footer p { font-size: 12px; color: #94a3b8; margin: 0 0 4px; }
    .footer a { color: #64748b; text-decoration: none; }

    @media only screen and (max-width: 600px) {
      .card-body { padding: 28px 20px; }
    }
  </style>
</head>
<body>
  <!-- Preheader (preview text di inbox, disembunyikan) -->
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;color:#f1f5f9;line-height:1px;">
    ${preheader}&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;&nbsp;&#8203;
  </div>

  <div class="wrapper">
    <div class="container">

      <!-- Logo -->
      <div class="header-logo">
        <span class="logo-inner">
          ${LOGO_SVG}
          <span class="logo-text">SayaBayar</span>
        </span>
      </div>

      <!-- Card -->
      <div class="card">
        <div class="card-accent"></div>
        <div class="card-body">
          ${bodyContent}
        </div>
      </div>

      <!-- Footer -->
      <div class="footer">
        <p>&copy; ${new Date().getFullYear()} SayaBayar &mdash; Platform Penerimaan Pembayaran Otomatis</p>
        <p><a href="mailto:${process.env.SMTP_USER}">Hubungi Support</a></p>
      </div>

    </div>
  </div>
</body>
</html>`
}

// ─── Plain text fallback ─────────────────────────────────────────────────────

function plainText({ name, intro, actionLabel, actionUrl, expiry, warning }) {
  return [
    `Halo ${name},`,
    ``,
    intro,
    ``,
    `${actionLabel}:`,
    actionUrl,
    ``,
    `Link berlaku selama ${expiry}.`,
    warning ? `\n${warning}` : ``,
    `---`,
    `SayaBayar — Platform Penerimaan Pembayaran`,
    process.env.FRONTEND_URL || 'https://sayabayar.com',
    ``,
    `\u00A9 ${new Date().getFullYear()} SayaBayar. Semua hak dilindungi.`
  ].join('\n')
}

// ─── Template: Verifikasi Email ──────────────────────────────────────────────

function buildVerificationEmail(name, verifyUrl) {
  const bodyContent = `
    <h1>Verifikasi Email Anda</h1>
    <p class="greeting">Halo, ${name}! 👋</p>

    <p>
      Terima kasih telah mendaftar di <strong>SayaBayar</strong>.
      Satu langkah lagi — verifikasi email Anda untuk mengaktifkan akun dan mulai menerima pembayaran.
    </p>

    <div class="btn-wrap">
      <a href="${verifyUrl}" class="btn" target="_blank" rel="noopener noreferrer">
        ✓ &nbsp;Verifikasi Email Saya
      </a>
    </div>

    <div class="info-box">
      <strong>⏰ Link berlaku 24 jam</strong><br/>
      Setelah 24 jam, link ini kadaluarsa. Anda bisa meminta link baru melalui halaman login.
    </div>

    <hr class="divider"/>

    <p class="link-fallback">
      Jika tombol tidak berfungsi, salin link ini ke browser:<br/>
      <a href="${verifyUrl}">${verifyUrl}</a>
    </p>

    <hr class="divider"/>

    <p style="font-size:12px; color:#94a3b8; margin:0;">
      Jika Anda tidak pernah mendaftar di SayaBayar, abaikan email ini.
      Akun tidak akan aktif tanpa verifikasi.
    </p>
  `

  return {
    html: baseLayout({
      preheader: `Verifikasi email Anda untuk mengaktifkan akun SayaBayar`,
      title: 'Verifikasi Email — SayaBayar',
      bodyContent
    }),
    text: plainText({
      name,
      intro: 'Terima kasih telah mendaftar di SayaBayar! Klik link berikut untuk memverifikasi email dan mengaktifkan akun Anda.',
      actionLabel: 'Verifikasi Email',
      actionUrl: verifyUrl,
      expiry: '24 jam',
      warning: 'Jika Anda tidak pernah mendaftar di SayaBayar, abaikan email ini.'
    })
  }
}

// ─── Template: Reset Password ────────────────────────────────────────────────

function buildResetPasswordEmail(name, resetUrl) {
  const bodyContent = `
    <h1>Reset Password</h1>
    <p class="greeting">Halo, ${name}!</p>

    <p>
      Kami menerima permintaan untuk mereset password akun <strong>SayaBayar</strong>
      yang terhubung dengan email ini. Klik tombol di bawah untuk membuat password baru.
    </p>

    <div class="btn-wrap">
      <a href="${resetUrl}" class="btn" target="_blank" rel="noopener noreferrer">
        🔒 &nbsp;Reset Password Saya
      </a>
    </div>

    <div class="info-box">
      <strong>⏰ Link berlaku 1 jam</strong><br/>
      Setelah 1 jam, link kadaluarsa dan Anda perlu meminta reset password baru.
    </div>

    <div class="warning-box">
      <strong>⚠️ Bukan Anda yang meminta ini?</strong><br/>
      Abaikan email ini. Password Anda tidak akan berubah dan akun tetap aman.
    </div>

    <hr class="divider"/>

    <p class="link-fallback">
      Jika tombol tidak berfungsi, salin link ini ke browser:<br/>
      <a href="${resetUrl}">${resetUrl}</a>
    </p>
  `

  return {
    html: baseLayout({
      preheader: `Permintaan reset password akun SayaBayar Anda — link berlaku 1 jam`,
      title: 'Reset Password — SayaBayar',
      bodyContent
    }),
    text: plainText({
      name,
      intro: 'Kami menerima permintaan reset password untuk akun SayaBayar Anda. Klik link berikut untuk membuat password baru.',
      actionLabel: 'Reset Password',
      actionUrl: resetUrl,
      expiry: '1 jam',
      warning: 'Jika Anda tidak meminta reset password, abaikan email ini. Password Anda tidak akan berubah.'
    })
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Kirim email verifikasi ke user baru
 */
export async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/verify-email?token=${token}`
  const { html, text } = buildVerificationEmail(name, verifyUrl)

  await getTransporter().sendMail({
    from:    process.env.SMTP_FROM || `"SayaBayar" <${process.env.SMTP_USER}>`,
    to:      email,
    subject: `Konfirmasi Email Anda — SayaBayar`,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<mailto:${process.env.SMTP_USER}?subject=unsubscribe>`
    }
  })
}

/**
 * Kirim email reset password
 */
export async function sendPasswordResetEmail(email, name, token) {
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${token}`
  const { html, text } = buildResetPasswordEmail(name, resetUrl)

  await getTransporter().sendMail({
    from:    process.env.SMTP_FROM || `"SayaBayar" <${process.env.SMTP_USER}>`,
    to:      email,
    subject: `Permintaan Reset Password — SayaBayar`,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<mailto:${process.env.SMTP_USER}?subject=unsubscribe>`
    }
  })
}
