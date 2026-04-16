// apps/frontend/src/lib/disbursement.js
// Mirror dari packages/shared/src/constants/index.js — DISBURSEMENT config
// Tidak import langsung dari shared karena shared mengandung Prisma (server-only)

export const DISBURSEMENT = {
  MIN_AMOUNT:    10_000,
  MIN_DEPOSIT:   10_000,
  FEE_LOW:       2_500,   // transfer < FEE_THRESHOLD
  FEE_HIGH:      3_000,   // transfer >= FEE_THRESHOLD
  FEE_THRESHOLD: 250_000,
}

/** Hitung fee berdasarkan nominal transfer — sama persis dengan getDisbursementFee() di backend */
export function getDisbursementFee(amount) {
  return amount >= DISBURSEMENT.FEE_THRESHOLD
    ? DISBURSEMENT.FEE_HIGH
    : DISBURSEMENT.FEE_LOW
}
