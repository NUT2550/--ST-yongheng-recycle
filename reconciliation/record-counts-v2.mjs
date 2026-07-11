import { PrismaClient } from '@prisma/client'
const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })
const label = process.argv[2] || 'current'
try {
  const [productCount, buyBillCount, sellBillCount, sortingBillCount, transferCount, stockLotCount] = await Promise.all([
    db.product.count(), db.buyBill.count(), db.sellBill.count(),
    db.sortingBill.count(), db.stockTransfer.count(), db.stockLot.count(),
  ])
  const stockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  const result = {
    label, timestamp: new Date().toISOString(),
    counts: { product: productCount, buyBill: buyBillCount, sellBill: sellBillCount, sortingBill: sortingBillCount, stockTransfer: transferCount, stockLot: stockLotCount },
    totalStockWeight: stockAgg._sum.remainingWeight ?? 0,
  }
  console.log(`=== DATA COUNTS (${label}) — ${result.timestamp} ===`)
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(20)} = ${v}`)
  console.log(`  ${'totalStockWeight'.padEnd(20)} = ${result.totalStockWeight}`)
  const fs = await import('fs')
  fs.writeFileSync(`/home/z/my-project/reconciliation/data-counts-${label}.json`, JSON.stringify(result, null, 2))
} catch (e) { console.error('❌:', e.message) }
finally { await db.$disconnect() }
