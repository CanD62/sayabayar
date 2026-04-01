'use client'

import { RefreshCw, ShieldAlert } from 'lucide-react'

// global-error MUST include its own <html> + <body>
// because it replaces the root layout on fatal errors
export default function GlobalError({ error, reset }) {
  return (
    <html lang="id">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Terjadi Kesalahan Kritis | Saya Bayar</title>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap');
          *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
          body {
            font-family: 'Inter', -apple-system, sans-serif;
            background: #0d0e12;
            color: #f0f2f5;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            text-align: center;
            padding: 24px;
          }
          .wrap { max-width: 480px; width: 100%; }
          .icon-wrap {
            width: 80px; height: 80px;
            border-radius: 50%;
            background: rgba(239,68,68,0.12);
            border: 1px solid rgba(239,68,68,0.25);
            display: flex; align-items: center; justify-content: center;
            margin: 0 auto 24px;
            color: #ef4444;
          }
          h1 { font-size: 1.75rem; font-weight: 800; margin-bottom: 12px; }
          p { font-size: 0.9rem; color: #9ca3b0; margin-bottom: 32px; line-height: 1.6; }
          button {
            display: inline-flex; align-items: center; gap: 8px;
            padding: 12px 24px;
            background: #10b981; color: #fff;
            border: none; border-radius: 8px;
            font-size: 0.9rem; font-weight: 600;
            cursor: pointer; font-family: inherit;
            transition: background 0.2s;
          }
          button:hover { background: #059669; }
          .hint { font-size: 0.75rem; color: #5f6877; margin-top: 20px; }
          code { font-size: 0.7rem; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px; }
        `}</style>
      </head>
      <body>
        <div className="wrap">
          <div className="icon-wrap">
            <ShieldAlert size={36} strokeWidth={1.5} />
          </div>
          <h1>Terjadi Kesalahan Kritis</h1>
          <p>
            Aplikasi mengalami masalah yang tidak bisa dipulihkan secara otomatis.
            Muat ulang halaman untuk mencoba kembali.
          </p>
          <button onClick={reset}>
            <RefreshCw size={16} />
            Muat Ulang Halaman
          </button>
          <p className="hint">
            {error?.message && <><code>{error.message}</code><br /></>}
            Jika masalah berlanjut, hubungi dukungan kami.
          </p>
        </div>
      </body>
    </html>
  )
}
