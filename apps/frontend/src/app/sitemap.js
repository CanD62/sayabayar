// /src/app/sitemap.js
// Next.js App Router — auto-generates /sitemap.xml
// Docs: https://nextjs.org/docs/app/api-reference/file-conventions/metadata/sitemap

const SITE_URL = 'https://sayabayar.com'

export default function sitemap() {
  const now = new Date()

  return [
    // ── Landing page ─────────────────────────────────────────────────────────
    {
      url: SITE_URL,
      lastModified: now,
      changeFrequency: 'weekly',
      priority: 1.0,
    },

    // ── Auth pages ───────────────────────────────────────────────────────────
    {
      url: `${SITE_URL}/register`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.9,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified: now,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${SITE_URL}/forgot-password`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.3,
    },

    // ── Legal ─────────────────────────────────────────────────────────────────
    {
      url: `${SITE_URL}/terms`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified: now,
      changeFrequency: 'yearly',
      priority: 0.4,
    },
  ]
}
