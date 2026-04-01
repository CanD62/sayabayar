'use client'
/**
 * LogoIcon v2 — Receipt + Lightning bolt dengan detail
 *
 * Desain (dari referensi):
 * - Zigzag di ATAS dan BAWAH (seperti struk receipt)
 * - Petir besar bold + inner diagonal detail line
 * - 3 garis teks kiri & kanan (dekorasi struk)
 * - Spark kecil di sudut (electricity effect)
 * - Gradient hijau → biru (brand color)
 *
 * Usage: <LogoIcon size={22} />
 */
export default function LogoIcon({ size = 22 }) {
  const h = size
  const w = Math.round(size * 24 / 32)

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 24 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="bayar-lg" x1="0" y1="0" x2="24" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>

      {/*
        Receipt shape:
        - Zigzag ATAS: 5 gigi mengarah ke atas (peaks at y=0, valleys at y=5)
        - Sisi kiri & kanan: lurus
        - Zigzag BAWAH: 5 gigi mengarah ke bawah (peaks at y=27, valleys at y=32)
      */}
      <path
        d={[
          // Zigzag atas (5 teeth → up)
          'M 0,5',
          'L 2.4,0 L 4.8,5',
          'L 7.2,0 L 9.6,5',
          'L 12,0 L 14.4,5',
          'L 16.8,0 L 19.2,5',
          'L 21.6,0 L 24,5',
          // Sisi kanan
          'L 24,27',
          // Zigzag bawah (5 teeth → down)
          'L 21.6,32 L 19.2,27',
          'L 16.8,32 L 14.4,27',
          'L 12,32 L 9.6,27',
          'L 7.2,32 L 4.8,27',
          'L 2.4,32 L 0,27',
          // Sisi kiri
          'Z',
        ].join(' ')}
        fill="url(#bayar-lg)"
      />

      {/*
        Lightning bolt utama — bold, solid white
        Top tip: (15, 7) → diagonal curam ke kiri bawah → step → lower section
      */}
      <path
        d="M 15,7 L 7.5,17.5 L 12.5,17.5 L 9,25.5 L 16.5,15 L 11.5,15 Z"
        fill="white"
      />

      {/*
        Inner bolt detail line — diagonal cut yang terlihat di referensi
        Memberikan kedalaman / 3D effect pada petir
        Line tipis gradient di atas petir putih
      */}
      <path
        d="M 14,8 L 10.5,17.5 L 12.5,17.5 L 9,25.5 L 13,16 L 11,16 Z"
        fill="#0ea5e9"
        opacity="0.25"
      />

      {/* ── Dekorasi teks struk (kiri) ─────────────────────── */}
      <rect x="1.5" y="13"  width="4.5" height="1"   rx="0.5" fill="white" opacity="0.7" />
      <rect x="1.5" y="15.5" width="3.5" height="1"  rx="0.5" fill="white" opacity="0.7" />
      <rect x="1.5" y="18"  width="4.5" height="1"   rx="0.5" fill="white" opacity="0.7" />

      {/* ── Dekorasi teks struk (kanan) ────────────────────── */}
      <rect x="18"  y="17"  width="4.5" height="1"   rx="0.5" fill="white" opacity="0.7" />
      <rect x="18.5" y="19.5" width="3.5" height="1" rx="0.5" fill="white" opacity="0.7" />
      <rect x="18"  y="22"  width="4.5" height="1"   rx="0.5" fill="white" opacity="0.7" />

      {/* ── Spark kecil atas-kiri ──────────────────────────── */}
      <path
        d="M 4.5,7 L 3,9 L 4,9 L 2.5,11.5 L 5.5,8.5 L 4.5,8.5 Z"
        fill="white"
        opacity="0.9"
      />

      {/* ── Spark kecil bawah-kiri ────────────────────────── */}
      <path
        d="M 2.5,24 L 1.5,25.5 L 2.5,25.5 L 1.5,27 L 3.5,25 L 2.5,25 Z"
        fill="white"
        opacity="0.8"
      />

      {/* ── Spark kecil bawah-kanan ───────────────────────── */}
      <path
        d="M 20.5,24 L 19.5,25.5 L 20.5,25.5 L 19.5,27 L 21.5,25 L 20.5,25 Z"
        fill="white"
        opacity="0.8"
      />
    </svg>
  )
}
