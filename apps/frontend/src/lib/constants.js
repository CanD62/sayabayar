// apps/frontend/src/lib/constants.js
// Konstanta frontend yang dipakai di berbagai halaman

/**
 * Daftar bank & e-wallet yang didukung untuk transfer/penarikan.
 * Sumber: Flip API /list_bank → supportedBanks (exclude eCommerces saja)
 * Diurutkan: popularBanks dulu → bank lainnya alfabet → e-wallet alfabet.
 * Kode sesuai format Flip (lowercase/underscore).
 *
 * Catatan: SeaBank tidak tersedia di Flip Personal API.
 */
export const SUPPORTED_BANKS = [
  // ── Bank Populer (urutan dari Flip popularBanks) ──────────
  { code: 'bca', name: 'BCA', popular: true, isEwallet: false },
  { code: 'bri', name: 'BRI', popular: true, isEwallet: false },
  { code: 'mandiri', name: 'Mandiri', popular: true, isEwallet: false },
  { code: 'bni', name: 'BNI', popular: true, isEwallet: false },
  { code: 'kesejahteraan_ekonomi', name: 'SeaBank/Bank BKE', popular: true, isEwallet: false },
  // ── Bank Lainnya (alfabet) ────────────────────────────────
  { code: 'bjb', name: 'BJB (Bank Jabar Banten)', popular: false, isEwallet: false },
  { code: 'bsm', name: 'BSI (Bank Syariah Indonesia)', popular: false, isEwallet: false },
  { code: 'btn', name: 'BTN', popular: false, isEwallet: false },
  { code: 'tabungan_pensiunan_nasional', name: 'BTPN Jenius', popular: false, isEwallet: false },
  { code: 'cimb', name: 'CIMB Niaga', popular: false, isEwallet: false },
  { code: 'danamon', name: 'Bank Danamon', popular: false, isEwallet: false },
  { code: 'dbs', name: 'DBS Indonesia', popular: false, isEwallet: false },
  { code: 'dki', name: 'Bank DKI Jakarta', popular: false, isEwallet: false },
  { code: 'muamalat', name: 'Bank Muamalat', popular: false, isEwallet: false },
  { code: 'permata', name: 'Bank Permata', popular: false, isEwallet: false },
  // ── E-Wallet ──────────────────────────────────────────────
  // { code: 'dana', name: 'DANA', popular: false, isEwallet: true },
  // { code: 'gopay', name: 'GoPay', popular: false, isEwallet: true },
  // { code: 'linkaja', name: 'LinkAja', popular: false, isEwallet: true },
  // { code: 'ovo', name: 'OVO', popular: false, isEwallet: true },
  // { code: 'shopeepay', name: 'ShopeePay', popular: false, isEwallet: true },
]
