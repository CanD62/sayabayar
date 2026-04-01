// packages/shared/src/db/index.js
// Singleton Prisma Client — shared between API and Scraper

import { PrismaClient } from '@prisma/client'

let prisma

/**
 * Get or create a Prisma Client instance (singleton pattern)
 * Prevents multiple connections in development with hot-reload
 * @returns {PrismaClient}
 */
export function getDb() {
  if (!prisma) {
    const base = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['warn', 'error']
    })

    // Wrap all queries with an 8-second timeout.
    // Without this, Prisma hangs for 30-60s when DB is temporarily unreachable
    // (e.g., WiFi hiccup to remote 192.168.50.4 server).
    prisma = base.$extends({
      query: {
        $allModels: {
          async $allOperations({ operation, model, args, query }) {
            const TIMEOUT_MS = 8_000
            const timeout = new Promise((_, reject) =>
              setTimeout(
                () => reject(Object.assign(
                  new Error(`DB timeout: ${model}.${operation}`),
                  { code: 'QUERY_TIMEOUT' }
                )),
                TIMEOUT_MS
              )
            )
            return Promise.race([query(args), timeout])
          }
        }
      }
    })
  }
  return prisma
}

/**
 * Disconnect Prisma Client (for graceful shutdown)
 */
export async function disconnectDb() {
  if (prisma) {
    await prisma.$disconnect()
    prisma = null
  }
}

export { PrismaClient }
