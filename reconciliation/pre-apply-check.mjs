import { PrismaClient } from '@prisma/client'
const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const targets = [
  // Renames
  'เหล็กเส้น 6 หุน (1.8m ขึ้นไป)',
  'อลูมิเนียมแข็ง',
  'แสตนเลส 304 (ยาว)',
  // Category change
  'แผงวงจรเขียว',
  // Nickel
  'นิกเกิล',
  'นิกเกิล(สแตนเลส)',
  // Aluminum wire (Rule 1)
  'อลูมิเนียมสายไฟ',
  'สายไฟอลูมิเนียม',
  // Aluminum lid (Rule 2)
  'อลูมิเนียมฝา',
  'อลูมิเนียมฝาไม่แกะ',
  // ก้านเบรค (Rule 4)
  'อลูมิเนียมแข็งก้านเบรค',
  'อลูมิเนียมแข็งก้ามเบรค',
  // Other creates
  'แหนบ', 'เหล็กคัดขาย', 'อลูมิเนียมล้อแม็ค', 'ขี้กลึงอลูมิเนียม', 'ฟรอยไม่ติดพลาสติก',
  'ฝาเนียมเผา', 'สายไฟทองแดง', 'เบิกใช้งานภายในบริษัท',
]

console.log('=== PRE-APPLY STATE CHECK ===\n')
for (const name of targets) {
  const p = await db.product.findFirst({ where: { name }, include: { category: true } })
  if (p) {
    const stock = await db.stockLot.aggregate({ where: { productId: p.id }, _sum: { remainingWeight: true }, _count: true })
    const buyItem = await db.buyBillItem.count({ where: { productId: p.id } })
    const sellItem = await db.sellBillItem.count({ where: { productId: p.id } })
    const sortSource = await db.sortingBill.count({ where: { sourceProductId: p.id } })
    const sortItem = await db.sortingBillItem.count({ where: { productId: p.id } })
    const transferSource = await db.stockTransfer.count({ where: { sourceProductId: p.id } })
    const transferItem = await db.stockTransferItem.count({ where: { productId: p.id } })
    const movement = buyItem + sellItem + sortSource + sortItem + transferSource + transferItem
    console.log(`  "${name}" → EXISTS`)
    console.log(`     id=${p.id}, cat=${p.category.name}, stock=${stock._sum.remainingWeight ?? 0} kg (${stock._count} lots), movement=${movement > 0}`)
    if (movement > 0) console.log(`     movement: buy=${buyItem} sell=${sellItem} sortSrc=${sortSource} sortItem=${sortItem} trnSrc=${transferSource} trnItem=${transferItem}`)
  } else {
    console.log(`  "${name}" → NOT FOUND (will create)`)
  }
}

// Get stainless category ID
const stainless = await db.productCategory.findFirst({ where: { name: 'แสตนเลส' } })
console.log(`\nStainless category: ${stainless.id}`)

await db.$disconnect()
