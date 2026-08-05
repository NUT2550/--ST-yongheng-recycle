import { PrismaClient } from '@prisma/client'

import { requireDbUrl } from './scripts/lib/require-db-url.mjs'
const SUPABASE_POOLER_URL = requireDbUrl('SUPABASE_POOLER_URL')
const db = new PrismaClient({
  datasources: { db: { url: SUPABASE_POOLER_URL } },
})

try {
  const products = await db.product.findMany({ include: { category: true }, orderBy: { categoryId: 'asc' } })
  for (const p of products) {
    console.log(`${p.id} | ${p.name} | ${p.category.name}`)
  }
} catch (e) {
  console.error('Error:', e.message)
} finally {
  await db.$disconnect()
}
