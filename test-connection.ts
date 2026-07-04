import { PrismaClient } from '@prisma/client'

const SUPABASE_POOLER_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'

const db = new PrismaClient({
  datasources: { db: { url: SUPABASE_POOLER_URL } },
})

try {
  const count = await db.product.count()
  console.log('Connected! Product count:', count)
  const cats = await db.productCategory.findMany()
  console.log('Categories:', cats.map(c => `${c.id}=${c.name}`).join(', '))
  const steelCat = await db.productCategory.findFirst({ where: { name: 'เหล็ก' } })
  console.log('Steel category:', steelCat)
  const employees = await db.employee.findMany()
  console.log('Employees:', employees.map(e => `${e.id}=${e.name}`).join(', '))
} catch (e) {
  console.error('Error:', e.message)
} finally {
  await db.$disconnect()
}
