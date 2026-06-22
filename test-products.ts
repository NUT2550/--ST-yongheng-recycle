import { PrismaClient } from '@prisma/client'

const SUPABASE_POOLER_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'

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
