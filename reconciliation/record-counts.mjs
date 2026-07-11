/**
 * Record pre-fix and post-fix data counts to verify no stock/bill data changed.
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const label = process.argv[2] || 'current'

try {
  const [
    productCount,
    buyBillCount,
    sellBillCount,
    sortingBillCount,
    transferCount,
    stockLotCount,
    buyItemCount,
    sellItemCount,
    sortingItemCount,
    transferItemCount,
    customerCount,
    employeeCount,
  ] = await Promise.all([
    db.product.count(),
    db.buyBill.count(),
    db.sellBill.count(),
    db.sortingBill.count(),
    db.stockTransfer.count(),
    db.stockLot.count(),
    db.buyBillItem.count(),
    db.sellBillItem.count(),
    db.sortingBillItem.count(),
    db.stockTransferItem.count(),
    db.customer.count(),
    db.employee.count(),
  ])

  // Total stock weight
  const stockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  const totalStockWeight = stockAgg._sum.remainingWeight ?? 0

  const result = {
    label,
    timestamp: new Date().toISOString(),
    counts: {
      product: productCount,
      buyBill: buyBillCount,
      sellBill: sellBillCount,
      sortingBill: sortingBillCount,
      stockTransfer: transferCount,
      stockLot: stockLotCount,
      buyBillItem: buyItemCount,
      sellBillItem: sellItemCount,
      sortingBillItem: sortingItemCount,
      stockTransferItem: transferItemCount,
      customer: customerCount,
      employee: employeeCount,
    },
    totalStockWeight,
  }

  console.log(`=== DATA COUNTS (${label}) — ${result.timestamp} ===`)
  for (const [k, v] of Object.entries(result.counts)) {
    console.log(`  ${k.padEnd(20)} = ${v}`)
  }
  console.log(`  ${'totalStockWeight'.padEnd(20)} = ${totalStockWeight}`)

  const fs = await import('fs')
  const filename = `/home/z/my-project/reconciliation/data-counts-${label}.json`
  fs.writeFileSync(filename, JSON.stringify(result, null, 2))
  console.log(`\nSaved to ${filename}`)
} catch (e) {
  console.error('❌ DB error:', e.message)
} finally {
  await db.$disconnect()
}
