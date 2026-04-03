// /src/app/robots.js
// Next.js App Router — auto-generates /robots.txt
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/robots

const SITE_URL = 'https://sayabayar.com'

export default function robots() {
  return {
    rules: [
      {
        // Izinkan semua bot untuk halaman publik
        userAgent: '*',
        allow: '/',
        disallow: [
          '/dashboard/',   // halaman butuh login
          '/admin/',       // halaman admin
          '/api/',         // API endpoints
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
