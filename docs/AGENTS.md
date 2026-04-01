# Aturan untuk AI Agent

## WAJIB BACA SEBELUM MULAI

Sebelum mengerjakan APAPUN di project ini, baca dulu file berikut:

```
/Users/cand62/Documents/htdocs/bayar/CONTEXT.md
```

File CONTEXT.md berisi:
- Arsitektur lengkap monorepo
- Database schema dan relasi antar model
- Business logic kritis (unique code, matching, settlement, dll)
- Pola kode yang sudah disepakati (response format, auth, encrypt/decrypt)
- Keputusan desain yang sudah FINAL — jangan diubah tanpa diskusi
- Redis key patterns
- Terminologi yang dipakai di UI

## Stack

- **API:** Node.js ESM + Fastify v5 + Prisma
- **Frontend:** Next.js 15 (App Router)
- **Scraper:** Node.js ESM + Playwright + BullMQ
- **DB:** MySQL/MariaDB
- **Cache/Queue:** Redis + BullMQ

## Quick Reference

| Service | Port | Start |
|---|---|---|
| API | 3001 | `pnpm dev:api` |
| Scraper | 3002 | `pnpm dev:scraper` |
| Frontend | 3000 | `pnpm dev:frontend` |
| All | - | `pnpm dev` |

## Hal yang TIDAK boleh diubah tanpa diskusi

1. Schema database (`packages/shared/prisma/schema.prisma`)
2. Response format API (`{ success, data/error, meta }`)
3. Auth flow (token in-memory only, bukan localStorage)
4. Unique code collision logic (Redis distributed lock)
5. Redis key naming convention (lihat CONTEXT.md section 6)
