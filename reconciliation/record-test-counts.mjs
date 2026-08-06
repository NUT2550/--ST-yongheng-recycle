import { PrismaClient } from '@prisma/client'
import { requireDbUrl } from '../scripts/lib/require-db-url.mjs'
const SUPABASE_URL = requireDbUrl('SUPABASE_URL')
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })
const label = process.argv[2] || 'current'
try {
  const [products, stockLots, buyBills, sellBills, sortingBills, transfers, physicalSessions, physicalItems] = await Promise.all([
    db.product.count(), db.stockLot.count(), db.buyBill.count(), db.sellBill.count(),
    db.sortingBill.count(), db.stockTransfer.count(),
    db.physicalCountSession.count(), db.physicalCountItem.count(),
  ])
  const stockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  const result = {
    label, timestamp: new Date().toISOString(),
    counts: { products, stockLots, buyBills, sellBills, sortingBills, transfers, physicalSessions, physicalItems },
    totalStockWeight: stockAgg._sum.remainingWeight ?? 0,
  }
  console.log(`=== DATA COUNTS (${label}) — ${result.timestamp} ===`)
  for (const [k, v] of Object.entries(result.counts)) console.log(`  ${k.padEnd(20)} = ${v}`)
  console.log(`  ${'totalStockWeight'.padEnd(20)} = ${result.totalStockWeight}`)
  const fs = await import('fs')
  fs.writeFileSync(`/home/z/my-project/reconciliation/data-counts-${label}.json`, JSON.stringify(result, null, 2))
} catch (e) { console.error('❌:', e.message) }
finally { await db.$disconnect() }
