/**
 * Task 67 Step 1b: Re-search with correct field names.
 * SortingBill fields: date (not transactionDate), sourceWeight (not inputWeight), roomNumber (not room). No `type` field.
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const TARGETS = ['TRN-2569-00006', 'TRN-2569-00008', 'TRN-2569-00009']

function fmt(d) { return d ? new Date(d).toISOString() : null }
function pad(s) { return String(s).padEnd(22) }

console.log('=== STEP 1b: SEARCH DB FOR TARGET BILLS (correct fields) ===\n')

// Search SortingBill
console.log('--- Searching SortingBill (คัดแยก) ---')
const sortingBills = await db.sortingBill.findMany({
  where: { billNumber: { in: TARGETS } },
  include: { items: true, sourceProduct: { select: { name: true } } },
})
console.log(`Found ${sortingBills.length} in SortingBill`)
for (const b of sortingBills) {
  console.log(`\n  ${'='.repeat(60)}`)
  console.log(`  billNumber:     ${b.billNumber}`)
  console.log(`  id:             ${b.id}`)
  console.log(`  model/table:    SortingBill (คัดแยก)`)
  console.log(`  date:           ${fmt(b.date)}`)
  console.log(`  createdAt:      ${fmt(b.createdAt)}`)
  console.log(`  roomNumber:     ${b.roomNumber}`)
  console.log(`  sourceProduct:  ${b.sourceProduct?.name} (${b.sourceProductId})`)
  console.log(`  sourceWeight:   ${b.sourceWeight} kg`)
  console.log(`  weighedTotal:   ${b.weighedTotal}`)
  console.log(`  lossWeight:     ${b.lossWeight}`)
  console.log(`  isCancelled:    ${b.isCancelled}, cancelledAt: ${fmt(b.cancelledAt)}`)
  console.log(`  note:           ${b.note}`)
  console.log(`  items count:    ${b.items.length} (outputs)`)
  console.log(`  item roles/products: ${b.items.map(i => `${i.product?.name || i.productId}(${i.weight}kg)`).join(', ')}`)
}

// Search StockTransfer
console.log('\n--- Searching StockTransfer (แกะของ/ย้ายสต็อก) ---')
const stockTransfers = await db.stockTransfer.findMany({
  where: { billNumber: { in: TARGETS } },
  include: { items: true, sourceProduct: { select: { name: true } } },
})
console.log(`Found ${stockTransfers.length} in StockTransfer`)
for (const b of stockTransfers) {
  console.log(`\n  ${'='.repeat(60)}`)
  console.log(`  billNumber:     ${b.billNumber}`)
  console.log(`  id:             ${b.id}`)
  console.log(`  model/table:    StockTransfer (แกะของ/ย้ายสต็อก)`)
  console.log(`  date:           ${fmt(b.date)}`)
  console.log(`  createdAt:      ${fmt(b.createdAt)}`)
  console.log(`  roomNumber:     ${b.roomNumber}`)
  console.log(`  sourceProduct:  ${b.sourceProduct?.name} (${b.sourceProductId})`)
  console.log(`  sourceWeight:   ${b.sourceWeight} kg`)
  console.log(`  lossWeight:     ${b.lossWeight}`)
  console.log(`  isCancelled:    ${b.isCancelled}, cancelledAt: ${fmt(b.cancelledAt)}`)
  console.log(`  note:           ${b.note}`)
  console.log(`  items count:    ${b.items.length} (outputs)`)
}

// Summary
console.log('\n=== SUMMARY ===')
for (const t of TARGETS) {
  const sb = sortingBills.find(b => b.billNumber === t)
  const st = stockTransfers.find(b => b.billNumber === t)
  if (sb) console.log(`  ${t}: EXISTS in SortingBill | date=${fmt(sb.date)?.split('T')[0]} | room=${sb.roomNumber} | source=${sb.sourceProduct?.name} | cancelled=${sb.isCancelled}`)
  else if (st) console.log(`  ${t}: EXISTS in StockTransfer | date=${fmt(st.date)?.split('T')[0]} | room=${st.roomNumber} | source=${st.sourceProduct?.name} | cancelled=${st.isCancelled}`)
  else console.log(`  ${t}: NOT FOUND in either table`)
}

// Also list ALL recent SortingBills and StockTransfers (July 2026) for context
console.log('\n--- ALL SortingBills in July 2026 (by date desc) ---')
const julySorting = await db.sortingBill.findMany({
  where: { date: { gte: new Date('2026-07-01T00:00:00'), lte: new Date('2026-07-31T23:59:59') } },
  select: { id: true, billNumber: true, date: true, createdAt: true, roomNumber: true, sourceProductId: true, sourceWeight: true, isCancelled: true },
  orderBy: { date: 'desc' },
})
console.log(`Count: ${julySorting.length}`)
for (const b of julySorting) console.log(`  ${b.billNumber || '(none)'} | date=${fmt(b.date)?.split('T')[0]} | created=${fmt(b.createdAt)?.split('T')[0]} | room=${b.roomNumber} | src=${b.sourceProductId} | wt=${b.sourceWeight} | cancelled=${b.isCancelled}`)

console.log('\n--- ALL StockTransfers in July 2026 (by date desc) ---')
const julyTransfers = await db.stockTransfer.findMany({
  where: { date: { gte: new Date('2026-07-01T00:00:00'), lte: new Date('2026-07-31T23:59:59') } },
  select: { id: true, billNumber: true, date: true, createdAt: true, roomNumber: true, sourceProductId: true, sourceWeight: true, isCancelled: true },
  orderBy: { date: 'desc' },
})
console.log(`Count: ${julyTransfers.length}`)
for (const b of julyTransfers) console.log(`  ${b.billNumber || '(none)'} | date=${fmt(b.date)?.split('T')[0]} | created=${fmt(b.createdAt)?.split('T')[0]} | room=${b.roomNumber} | src=${b.sourceProductId} | wt=${b.sourceWeight} | cancelled=${b.isCancelled}`)

await db.$disconnect()
