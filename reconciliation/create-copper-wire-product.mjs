import { PrismaClient } from '@prisma/client'
const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })
try {
  // Check if already exists
  const existing = await db.product.findFirst({ where: { name: 'ทองแดงเส้น' } })
  if (existing) {
    console.log(`ทองแดงเส้น already exists: ${existing.id}`)
    process.exit(0)
  }
  
  // Get copper category
  const cat = await db.productCategory.findFirst({ where: { name: 'ทองแดง' } })
  if (!cat) { console.log('❌ Category ทองแดง not found'); process.exit(1) }
  
  // Get max sortOrder in copper category
  const maxSort = await db.product.aggregate({ where: { categoryId: cat.id }, _max: { sortOrder: true } })
  
  // Create product
  const product = await db.product.create({
    data: {
      name: 'ทองแดงเส้น',
      categoryId: cat.id,
      defaultBuyPrice: 0,
      sortOrder: (maxSort._max.sortOrder ?? 0) + 1,
    },
  })
  console.log(`✅ Created ทองแดงเส้น: ${product.id}, category: ทองแดง, sortOrder: ${product.sortOrder}`)
} catch (e) { console.error('❌:', e.message) }
finally { await db.$disconnect() }
