/**
 * Investigate further: check cancellations after apply + StockLot updatedAt
 *
 * Hypothesis: BuyBill/SortingBill/StockTransfer cancellations after apply
 * could have deducted stock without appearing as new "consumption" events.
 *
 * READ-ONLY.
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/physical-count-apply-2026-07-09-and-10'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function round2(x) { return Math.round(x * 100) / 100 }

const APPLY_TIMESTAMP = new Date('2026-07-11T06:37:36.000Z')

const PRODUCTS = [
  { id: 'prod_mqgp9bspglewfbgukggj7wdy', name: 'ทองเหลืองหนา', expectedAfter: 7.92, current: 0 },
  { id: 'prod_mqgp9bmg24ygg55yytz9jphl', name: 'ทองเหลืองเนื้อแดง', expectedAfter: 1.34, current: 0.58 },
]

console.log('=== INVESTIGATE CANCELLATIONS + STOCKLOT UPDATES ===\n')

for (const p of PRODUCTS) {
  console.log(`\n========== ${p.name} (id=${p.id}) ==========`)
  console.log(`Expected after apply: ${p.expectedAfter} kg | Current: ${p.current} kg | Missing: ${round2(p.expectedAfter - p.current)} kg`)

  // ---- 1. All StockLots for this product, including those with remainingWeight=0 ----
  console.log(`\n--- All StockLots for ${p.name} ---`)
  const allLots = await db.stockLot.findMany({
    where: { productId: p.id },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true, createdAt: true, updatedAt: true },
    orderBy: { dateAdded: 'asc' },
  })
  console.log(`Total lots: ${allLots.length}`)
  let activeLots = 0
  let zeroLots = 0
  let updatedAfterApply = 0
  for (const lot of allLots) {
    if (lot.remainingWeight > 0) activeLots++
    if (lot.remainingWeight === 0) zeroLots++
    if (lot.updatedAt.getTime() > APPLY_TIMESTAMP.getTime()) {
      updatedAfterApply++
      console.log(`  ⚠️ lot.id=${lot.id} UPDATED AFTER APPLY`)
      console.log(`     remainingWeight=${lot.remainingWeight}, costPerKg=${lot.costPerKg}, dateAdded=${lot.dateAdded.toISOString()}, createdAt=${lot.createdAt.toISOString()}, updatedAt=${lot.updatedAt.toISOString()}`)
      console.log(`     source=${lot.source}, sourceId=${lot.sourceId ?? '—'}`)
    }
  }
  console.log(`Active lots (remainingWeight > 0): ${activeLots}`)
  console.log(`Zero lots (remainingWeight = 0): ${zeroLots}`)
  console.log(`Lots updated after apply: ${updatedAfterApply}`)

  // ---- 2. Cancelled BuyBills for this product (with cancellation timestamp) ----
  console.log(`\n--- Cancelled BuyBills for ${p.name} ---`)
  const cancelledBuyItems = await db.buyBillItem.findMany({
    where: { productId: p.id, buyBill: { isCancelled: true } },
    include: { buyBill: true },
  })
  for (const it of cancelledBuyItems) {
    const cancelledAfterApply = it.buyBill.cancelledAt && new Date(it.buyBill.cancelledAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = cancelledAfterApply ? '⚠️ CANCELLED AFTER APPLY' : 'cancelled before apply'
    console.log(`  [${flag}] billNo=${it.buyBill.billNumber ?? it.buyBill.externalBillNumber ?? '—'} | weight=${it.weight} | cancelledAt=${it.buyBill.cancelledAt?.toISOString() ?? '—'} | cancelReason=${it.buyBill.cancelReason ?? '—'}`)
  }

  // ---- 3. Cancelled SortingBills where this product is the SOURCE ----
  console.log(`\n--- Cancelled SortingBills (this product as SOURCE) ---`)
  const cancelledSortSources = await db.sortingBill.findMany({
    where: { sourceProductId: p.id, isCancelled: true },
  })
  for (const sb of cancelledSortSources) {
    const cancelledAfterApply = sb.cancelledAt && new Date(sb.cancelledAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = cancelledAfterApply ? '⚠️ CANCELLED AFTER APPLY' : 'cancelled before apply'
    console.log(`  [${flag}] billNo=${sb.billNumber ?? '—'} | sourceWeight=${sb.sourceWeight} | cancelledAt=${sb.cancelledAt?.toISOString() ?? '—'}`)
  }

  // ---- 4. Cancelled StockTransfers where this product is the SOURCE ----
  console.log(`\n--- Cancelled StockTransfers (this product as SOURCE) ---`)
  const cancelledTransferSources = await db.stockTransfer.findMany({
    where: { sourceProductId: p.id, isCancelled: true },
  })
  for (const tr of cancelledTransferSources) {
    const cancelledAfterApply = tr.cancelledAt && new Date(tr.cancelledAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = cancelledAfterApply ? '⚠️ CANCELLED AFTER APPLY' : 'cancelled before apply'
    console.log(`  [${flag}] billNo=${tr.billNumber ?? '—'} | sourceWeight=${tr.sourceWeight} | cancelledAt=${tr.cancelledAt?.toISOString() ?? '—'}`)
  }

  // ---- 5. Cancelled SellBills for this product ----
  console.log(`\n--- Cancelled SellBills (this product sold) ---`)
  const cancelledSellItems = await db.sellBillItem.findMany({
    where: { productId: p.id, sellBill: { isCancelled: true } },
    include: { sellBill: true },
  })
  for (const it of cancelledSellItems) {
    const cancelledAfterApply = it.sellBill.cancelledAt && new Date(it.sellBill.cancelledAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = cancelledAfterApply ? '⚠️ CANCELLED AFTER APPLY' : 'cancelled before apply'
    console.log(`  [${flag}] billNo=${it.sellBill.billNumber ?? it.sellBill.externalBillNumber ?? '—'} | weight=${it.weight} | cancelledAt=${it.sellBill.cancelledAt?.toISOString() ?? '—'}`)
  }

  // ---- 6. SortingBills where this product is OUTPUT and bill is cancelled ----
  console.log(`\n--- Cancelled SortingBills (this product as OUTPUT) ---`)
  const cancelledSortItems = await db.sortingBillItem.findMany({
    where: { productId: p.id, sortingBill: { isCancelled: true } },
    include: { sortingBill: true },
  })
  for (const it of cancelledSortItems) {
    const cancelledAfterApply = it.sortingBill.cancelledAt && new Date(it.sortingBill.cancelledAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = cancelledAfterApply ? '⚠️ CANCELLED AFTER APPLY' : 'cancelled before apply'
    console.log(`  [${flag}] billNo=${it.sortingBill.billNumber ?? '—'} | weight=${it.weight} | cancelledAt=${it.sortingBill.cancelledAt?.toISOString() ?? '—'}`)
  }

  // ---- 7. StockTransfers where this product is OUTPUT and bill is cancelled ----
  console.log(`\n--- Cancelled StockTransfers (this product as OUTPUT) ---`)
  const cancelledTransferItems = await db.stockTransferItem.findMany({
    where: { productId: p.id, stockTransfer: { isCancelled: true } },
    include: { stockTransfer: true },
  })
  for (const it of cancelledTransferItems) {
    const cancelledAfterApply = it.stockTransfer.cancelledAt && new Date(it.stockTransfer.cancelledAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = cancelledAfterApply ? '⚠️ CANCELLED AFTER APPLY' : 'cancelled before apply'
    console.log(`  [${flag}] billNo=${it.stockTransfer.billNumber ?? '—'} | weight=${it.weight} | cancelledAt=${it.stockTransfer.cancelledAt?.toISOString() ?? '—'}`)
  }
}

// ============ Additional check: total stock weight snapshot comparison ============
console.log('\n=== STOCK WEIGHT COMPARISON ===')
const totalStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
console.log(`Current total stock weight: ${round2(totalStockAgg._sum.remainingWeight ?? 0)} kg`)

// Previous baseline from Task 70 (after Task 69 fix, before ST-9 work)
console.log(`Previous baseline (Task 70 / 2026-07-09): 552,312.30 kg`)
console.log(`Delta: ${round2((totalStockAgg._sum.remainingWeight ?? 0) - 552312.3)} kg`)

// ============ Check for ALL cancelled bills after apply (global) ============
console.log('\n=== ALL CANCELLATIONS AFTER APPLY TIMESTAMP (global) ===')
const applyTime = APPLY_TIMESTAMP

const cancelledBuyBills = await db.buyBill.findMany({
  where: { isCancelled: true, cancelledAt: { gte: applyTime } },
  select: { id: true, billNumber: true, externalBillNumber: true, cancelledAt: true, cancelReason: true, cancelledBy: true },
})
console.log(`Cancelled BuyBills after apply: ${cancelledBuyBills.length}`)
for (const b of cancelledBuyBills) {
  console.log(`  ${b.billNumber ?? b.externalBillNumber ?? b.id} | cancelledAt=${b.cancelledAt?.toISOString()} | reason=${b.cancelReason ?? '—'} | by=${b.cancelledBy ?? '—'}`)
}

const cancelledSellBills = await db.sellBill.findMany({
  where: { isCancelled: true, cancelledAt: { gte: applyTime } },
  select: { id: true, billNumber: true, externalBillNumber: true, cancelledAt: true, cancelReason: true, cancelledBy: true },
})
console.log(`\nCancelled SellBills after apply: ${cancelledSellBills.length}`)
for (const b of cancelledSellBills) {
  console.log(`  ${b.billNumber ?? b.externalBillNumber ?? b.id} | cancelledAt=${b.cancelledAt?.toISOString()} | reason=${b.cancelReason ?? '—'} | by=${b.cancelledBy ?? '—'}`)
}

const cancelledSortingBills = await db.sortingBill.findMany({
  where: { isCancelled: true, cancelledAt: { gte: applyTime } },
  select: { id: true, billNumber: true, cancelledAt: true, cancelReason: true, cancelledBy: true, sourceProductId: true, sourceWeight: true },
})
console.log(`\nCancelled SortingBills after apply: ${cancelledSortingBills.length}`)
for (const b of cancelledSortingBills) {
  console.log(`  ${b.billNumber ?? b.id} | sourceProductId=${b.sourceProductId} | sourceWeight=${b.sourceWeight} | cancelledAt=${b.cancelledAt?.toISOString()} | by=${b.cancelledBy ?? '—'}`)
}

const cancelledTransfers = await db.stockTransfer.findMany({
  where: { isCancelled: true, cancelledAt: { gte: applyTime } },
  select: { id: true, billNumber: true, cancelledAt: true, cancelReason: true, cancelledBy: true, sourceProductId: true, sourceWeight: true },
})
console.log(`\nCancelled StockTransfers after apply: ${cancelledTransfers.length}`)
for (const b of cancelledTransfers) {
  console.log(`  ${b.billNumber ?? b.id} | sourceProductId=${b.sourceProductId} | sourceWeight=${b.sourceWeight} | cancelledAt=${b.cancelledAt?.toISOString()} | by=${b.cancelledBy ?? '—'}`)
}

console.log('\n=== INVESTIGATION DONE ===')
await db.$disconnect()
