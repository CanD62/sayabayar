// Fix script: Koreksi settlement Disbursement Pro yang terlanjur masuk credit_pending
// Jalankan: node scripts/fix-disbursement-pro-settlement.js

import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

async function main() {
  // 1. Cari semua disbursement_user yang punya subscription aktif (Pro)
  const proClients = await db.client.findMany({
    where: {
      role: 'disbursement_user',
      subscriptions: { some: { status: 'active' } }
    },
    select: { id: true, name: true, email: true }
  })

  if (proClients.length === 0) {
    console.log('Tidak ada Disbursement Pro user. Selesai.')
    return
  }

  console.log(`Ditemukan ${proClients.length} Disbursement Pro user:`)
  proClients.forEach(c => console.log(`  - ${c.name} (${c.email})`))

  const proIds = proClients.map(c => c.id)

  // 2. Cari ledger entries yang salah: credit_pending untuk Disbursement Pro
  const wrongEntries = await db.balanceLedger.findMany({
    where: {
      clientId: { in: proIds },
      type: 'credit_pending',
      settledAt: null // belum di-settle
    },
    include: {
      invoice: { select: { invoiceNumber: true } }
    }
  })

  if (wrongEntries.length === 0) {
    console.log('Tidak ada entry yang perlu dikoreksi. Selesai.')
    return
  }

  console.log(`\nDitemukan ${wrongEntries.length} entry yang perlu dikoreksi:`)

  const now = new Date()

  for (const entry of wrongEntries) {
    const amount = Number(entry.amount)

    console.log(`  Fixing: ${entry.invoice?.invoiceNumber || entry.id} — Rp ${amount.toLocaleString('id-ID')}`)

    await db.$transaction([
      // Update ledger: credit_pending → credit_available
      db.balanceLedger.update({
        where: { id: entry.id },
        data: {
          type: 'credit_available',
          availableAt: now,
          settledAt: now,
          note: entry.note?.replace('settlement H+2', 'instan (koreksi disbursement pro)')
            || `Koreksi: instan (disbursement pro)`
        }
      }),

      // Pindahkan dari balancePending → balanceAvailable
      db.clientBalance.update({
        where: { clientId: entry.clientId },
        data: {
          balancePending:  { decrement: amount },
          balanceAvailable: { increment: amount }
        }
      })
    ])
  }

  console.log(`\n✅ Selesai! ${wrongEntries.length} entry dikoreksi.`)
}

main()
  .catch(e => { console.error('Error:', e); process.exit(1) })
  .finally(() => db.$disconnect())
