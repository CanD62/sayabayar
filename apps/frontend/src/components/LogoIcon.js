'use client'
/**
 * LogoIcon — Custom logo: receipt/struk + lightning bolt
 *
 * Desain: rounded top corners, sisi lurus, bottom zigzag (seperti struk printer)
 * + petir di dalam → "pembayaran secepat kilat"
 *
 * Usage: <LogoIcon size={22} />
 */
export default function LogoIcon({ size = 22 }) {
  const h = size
  const w = Math.round(size * (20 / 28))

  return (
    <svg
      width={w}
      height={h}
      viewBox="0 0 20 28"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="bayar-lg" x1="0" y1="0" x2="20" y2="28" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10b981" />
          <stop offset="100%" stopColor="#0ea5e9" />
        </linearGradient>
      </defs>

      {/*
        Receipt shape:
        - Sudut atas: rounded (radius 2)
        - Sisi kiri & kanan: LURUS (bukan baterai!)
        - Bawah: zigzag 4 gigi ke bawah (seperti struk printer yang robek)
      */}
      <path
        d={[
          'M 5,0 L 15,0 Q 20,0 20,5',   // atas kanan rounded
          'L 20,22',                       // sisi kanan lurus
          // zigzag bawah — 4 gigi mengarah ke bawah
          'L 17.5,26 L 15,22',
          'L 12.5,26 L 10,22',
          'L 7.5,26 L 5,22',
          'L 2.5,26 L 0,22',
          'L 0,5 Q 0,0 5,0 Z',            // sisi kiri lurus + atas kiri rounded
        ].join(' ')}
        fill="url(#bayar-lg)"
      />

      {/*
        Lightning bolt — style ⚡ emoji/Apple: top spike sempit, diagonal curam
        Bukan slash datar. Upper: x=12-14 (sempit), tengah melebar ke kiri (x=6)
        Matching logo.png reference
      */}
      <path
        d="M 13.5,2 L 6,13 L 11,13 L 6.5,22 L 15,11 L 10,11 Z"
        fill="white"
        opacity="1"
      />
    </svg>
  )
}
