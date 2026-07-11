/**
 * Physical Count Production — Investigate stock consumption AFTER 09/07 apply
 *
 * Discrepancy found:
 *   - ทองเหลืองหนา: audit log says 7.92 kg after apply, current = 0 kg (delta -7.92)
 *   - ทองเหลืองเนื้อแดง: audit log says 1.34 kg after apply, current = 0.58 kg (delta -0.76)
 *
 * Need to find:
 *   - SellBill / SortingBill / StockTransfer created AFTER 2026-07-11T06:37:36Z
 *     that consumed ทองเหลืองหนา or ทองเหลืองเนื้อแดง
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

// Products to investigate
const PRODUCTS_TO_INVESTIGATE = [
  { id: 'prod_mqgp9bspglewfbgukggj7wdy', name: 'ทองเหลืองหนา', expectedAfter: 7.92, current: 0 },
  { id: 'prod_mqgp9bmg24ygg55yytz9jphl', name: 'ทองเหลืองเนื้อแดง', expectedAfter: 1.34, current: 0.58 },
]

console.log('=== INVESTIGATE POST-APPLY CONSUMPTION ===\n')
console.log(`Apply timestamp cutoff: ${APPLY_TIMESTAMP.toISOString()}\n`)

const findings = []

for (const p of PRODUCTS_TO_INVESTIGATE) {
  console.log(`\n=== ${p.name} (id=${p.id}) ===`)
  console.log(`Expected after 09/07 apply: ${p.expectedAfter} kg`)
  console.log(`Current: ${p.current} kg`)
  console.log(`Missing: ${round2(p.expectedAfter - p.current)} kg`)

  const productFinding = { product: p.name, productId: p.id, expectedAfter: p.expectedAfter, current: p.current, missing: round2(p.expectedAfter - p.current), consumptionEvents: [] }

  // ---- 1. SellBillItem (sold) ----
  const sellItems = await db.sellBillItem.findMany({
    where: { productId: p.id },
    include: { sellBill: { select: { id: true, billNumber: true, externalBillNumber: true, date: true, createdAt: true, isCancelled: true, customerId: true, note: true } } },
    orderBy: { sellBill: { createdAt: 'asc' } },
  })
  console.log(`\nSellBillItem records: ${sellItems.length}`)
  for (const it of sellItems) {
    const createdAfterApply = new Date(it.sellBill.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] sellBill.id=${it.sellBill.id} | billNo=${it.sellBill.billNumber ?? it.sellBill.externalBillNumber ?? '—'} | date=${it.sellBill.date.toISOString().split('T')[0]} | createdAt=${it.sellBill.createdAt.toISOString()} | weight=${it.weight} kg | cancelled=${it.sellBill.isCancelled}`)
    if (createdAfterApply && !it.sellBill.isCancelled) {
      productFinding.consumptionEvents.push({
        type: 'SELL_BILL',
        billId: it.sellBill.id,
        billNumber: it.sellBill.billNumber ?? it.sellBill.externalBillNumber,
        date: it.sellBill.date.toISOString(),
        createdAt: it.sellBill.createdAt.toISOString(),
        weight: it.weight,
        cancelled: it.sellBill.isCancelled,
      })
    }
  }

  // ---- 2. SortingBillItem (output from sorting) ----
  const sortItems = await db.sortingBillItem.findMany({
    where: { productId: p.id },
    include: { sortingBill: { select: { id: true, billNumber: true, date: true, createdAt: true, isCancelled: true, sourceProductId: true, sourceWeight: true, note: true } } },
    orderBy: { sortingBill: { createdAt: 'asc' } },
  })
  console.log(`\nSortingBillItem (as output) records: ${sortItems.length}`)
  for (const it of sortItems) {
    const createdAfterApply = new Date(it.sortingBill.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] sortingBill.id=${it.sortingBill.id} | billNo=${it.sortingBill.billNumber ?? '—'} | date=${it.sortingBill.date.toISOString().split('T')[0]} | createdAt=${it.sortingBill.createdAt.toISOString()} | weight=${it.weight} kg | cancelled=${it.sortingBill.isCancelled}`)
    if (createdAfterApply && !it.sortingBill.isCancelled) {
      productFinding.consumptionEvents.push({
        type: 'SORTING_BILL_OUTPUT',
        billId: it.sortingBill.id,
        billNumber: it.sortingBill.billNumber,
        date: it.sortingBill.date.toISOString(),
        createdAt: it.sortingBill.createdAt.toISOString(),
        weight: it.weight,
        cancelled: it.sortingBill.isCancelled,
      })
    }
  }

  // ---- 3. SortingBill source (consumed as input to sorting) ----
  const sortSources = await db.sortingBill.findMany({
    where: { sourceProductId: p.id },
    select: { id: true, billNumber: true, date: true, createdAt: true, isCancelled: true, sourceWeight: true, note: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`\nSortingBill (as source/input) records: ${sortSources.length}`)
  for (const sb of sortSources) {
    const createdAfterApply = new Date(sb.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] sortingBill.id=${sb.id} | billNo=${sb.billNumber ?? '—'} | date=${sb.date.toISOString().split('T')[0]} | createdAt=${sb.createdAt.toISOString()} | sourceWeight=${sb.sourceWeight} kg | cancelled=${sb.isCancelled}`)
    if (createdAfterApply && !sb.isCancelled) {
      productFinding.consumptionEvents.push({
        type: 'SORTING_BILL_SOURCE',
        billId: sb.id,
        billNumber: sb.billNumber,
        date: sb.date.toISOString(),
        createdAt: sb.createdAt.toISOString(),
        weight: sb.sourceWeight,
        cancelled: sb.isCancelled,
      })
    }
  }

  // ---- 4. StockTransfer source (consumed as input to transfer/dismantle) ----
  const transferSources = await db.stockTransfer.findMany({
    where: { sourceProductId: p.id },
    select: { id: true, billNumber: true, date: true, createdAt: true, isCancelled: true, sourceWeight: true, businessType: true, roomNumber: true, note: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`\nStockTransfer (as source/input) records: ${transferSources.length}`)
  for (const tr of transferSources) {
    const createdAfterApply = new Date(tr.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] stockTransfer.id=${tr.id} | billNo=${tr.billNumber ?? '—'} | date=${tr.date.toISOString().split('T')[0]} | createdAt=${tr.createdAt.toISOString()} | sourceWeight=${tr.sourceWeight} kg | businessType=${tr.businessType ?? '—'} | cancelled=${tr.isCancelled}`)
    if (createdAfterApply && !tr.isCancelled) {
      productFinding.consumptionEvents.push({
        type: 'STOCK_TRANSFER_SOURCE',
        billId: tr.id,
        billNumber: tr.billNumber,
        date: tr.date.toISOString(),
        createdAt: tr.createdAt.toISOString(),
        weight: tr.sourceWeight,
        businessType: tr.businessType,
        cancelled: tr.isCancelled,
      })
    }
  }

  // ---- 5. StockTransferItem (output from dismantle/transfer) ----
  const transferItems = await db.stockTransferItem.findMany({
    where: { productId: p.id },
    include: { stockTransfer: { select: { id: true, billNumber: true, date: true, createdAt: true, isCancelled: true, businessType: true, roomNumber: true, note: true } } },
    orderBy: { stockTransfer: { createdAt: 'asc' } },
  })
  console.log(`\nStockTransferItem (as output) records: ${transferItems.length}`)
  for (const it of transferItems) {
    const createdAfterApply = new Date(it.stockTransfer.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] stockTransfer.id=${it.stockTransfer.id} | billNo=${it.stockTransfer.billNumber ?? '—'} | date=${it.stockTransfer.date.toISOString().split('T')[0]} | createdAt=${it.stockTransfer.createdAt.toISOString()} | weight=${it.weight} kg | businessType=${it.stockTransfer.businessType ?? '—'} | cancelled=${it.stockTransfer.isCancelled}`)
    if (createdAfterApply && !it.stockTransfer.isCancelled) {
      productFinding.consumptionEvents.push({
        type: 'STOCK_TRANSFER_OUTPUT',
        billId: it.stockTransfer.id,
        billNumber: it.stockTransfer.billNumber,
        date: it.stockTransfer.date.toISOString(),
        createdAt: it.stockTransfer.createdAt.toISOString(),
        weight: it.weight,
        businessType: it.stockTransfer.businessType,
        cancelled: it.stockTransfer.isCancelled,
      })
    }
  }

  // ---- 6. BuyBillItem (purchased — should INCREASE stock, not decrease) ----
  const buyItems = await db.buyBillItem.findMany({
    where: { productId: p.id },
    include: { buyBill: { select: { id: true, billNumber: true, externalBillNumber: true, date: true, createdAt: true, isCancelled: true } } },
    orderBy: { buyBill: { createdAt: 'asc' } },
  })
  console.log(`\nBuyBillItem (purchased — adds stock) records: ${buyItems.length}`)
  for (const it of buyItems) {
    const createdAfterApply = new Date(it.buyBill.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] buyBill.id=${it.buyBill.id} | billNo=${it.buyBill.billNumber ?? it.buyBill.externalBillNumber ?? '—'} | date=${it.buyBill.date.toISOString().split('T')[0]} | createdAt=${it.buyBill.createdAt.toISOString()} | weight=${it.weight} kg | cancelled=${it.buyBill.isCancelled}`)
    if (createdAfterApply && !it.buyBill.isCancelled) {
      productFinding.consumptionEvents.push({
        type: 'BUY_BILL',
        billId: it.buyBill.id,
        billNumber: it.buyBill.billNumber ?? it.buyBill.externalBillNumber,
        date: it.buyBill.date.toISOString(),
        createdAt: it.buyBill.createdAt.toISOString(),
        weight: it.weight,
        cancelled: it.buyBill.isCancelled,
      })
    }
  }

  // ---- 7. StockLot STOCK_ADJUSTMENT after apply (would indicate another physical count adjustment) ----
  const adjLots = await db.stockLot.findMany({
    where: { productId: p.id, source: 'STOCK_ADJUSTMENT' },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, createdAt: true, sourceId: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`\nSTOCK_ADJUSTMENT lots: ${adjLots.length}`)
  for (const lot of adjLots) {
    const createdAfterApply = new Date(lot.createdAt).getTime() > APPLY_TIMESTAMP.getTime()
    const flag = createdAfterApply ? '⚠️ AFTER APPLY' : 'before apply'
    console.log(`  [${flag}] lot.id=${lot.id} | sourceId=${lot.sourceId ?? '—'} | dateAdded=${lot.dateAdded.toISOString()} | createdAt=${lot.createdAt.toISOString()} | remainingWeight=${lot.remainingWeight} kg | costPerKg=${lot.costPerKg}`)
  }

  findings.push(productFinding)
}

// ============ Summary ============
console.log('\n=== SUMMARY: POST-APPLY CONSUMPTION EVENTS ===')
for (const f of findings) {
  console.log(`\n${f.product}: expected ${f.expectedAfter}, current ${f.current}, missing ${f.missing} kg`)
  if (f.consumptionEvents.length === 0) {
    console.log(`  No consumption events found after apply — INVESTIGATE FURTHER`)
  } else {
    let totalConsumed = 0
    let totalAdded = 0
    for (const ev of f.consumptionEvents) {
      const isConsume = ev.type === 'SELL_BILL' || ev.type === 'SORTING_BILL_SOURCE' || ev.type === 'STOCK_TRANSFER_SOURCE'
      const isAdd = ev.type === 'BUY_BILL' || ev.type === 'SORTING_BILL_OUTPUT' || ev.type === 'STOCK_TRANSFER_OUTPUT'
      const sign = isConsume ? '-' : (isAdd ? '+' : '?')
      console.log(`  ${sign} ${ev.weight} kg | ${ev.type} | ${ev.billNumber ?? ev.billId} | ${ev.createdAt} | cancelled=${ev.cancelled}`)
      if (isConsume) totalConsumed += ev.weight
      if (isAdd) totalAdded += ev.weight
    }
    console.log(`  TOTAL consumed: ${round2(totalConsumed)} kg, TOTAL added: ${round2(totalAdded)} kg, NET: ${round2(totalAdded - totalConsumed)} kg`)
    console.log(`  Missing from audit log: ${f.missing} kg`)
    console.log(`  Reconciliation: expected_after + net = ${round2(f.expectedAfter + totalAdded - totalConsumed)} kg, actual current = ${f.current} kg`)
  }
}

// ============ Write JSON report ============
const jsonPath = path.join(OUTPUT_DIR, 'step-investigate-consumption.json')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  applyTimestamp: APPLY_TIMESTAMP.toISOString(),
  findings,
}, null, 2), 'utf-8')
console.log(`\n✅ JSON written: ${jsonPath}`)

await db.$disconnect()
