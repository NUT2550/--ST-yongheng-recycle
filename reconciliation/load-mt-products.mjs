/**
 * Load all MetalTrack products + categories from production DB
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

try {
  const categories = await db.productCategory.findMany({
    include: { products: { orderBy: { sortOrder: 'asc' } } },
    orderBy: { sortOrder: 'asc' },
  })
  console.log('=== METALTRACK CATEGORIES + PRODUCTS ===')
  const all = []
  for (const cat of categories) {
    console.log(`\n[${cat.id}] ${cat.name} (${cat.type}) — ${cat.products.length} products`)
    for (const p of cat.products) {
      all.push({
        id: p.id,
        name: p.name,
        categoryId: cat.id,
        categoryName: cat.name,
        categoryType: cat.type,
      })
      console.log(`  ${p.id} | ${p.name}`)
    }
  }
  console.log(`\nTotal MetalTrack products: ${all.length}`)

  const fs = await import('fs')
  fs.writeFileSync('/home/z/my-project/reconciliation/mt-products.json', JSON.stringify(all, null, 2))
  console.log('Saved to mt-products.json')
} catch (e) {
  console.error('❌ DB error:', e.message)
} finally {
  await db.$disconnect()
}
