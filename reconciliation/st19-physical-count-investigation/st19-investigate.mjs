/**
 * ST-19: Physical Count Investigation — READ-ONLY
 *
 * Owner confirmed current physical stock:
 *   ทองเหลือง:
 *     ทองเหลืองเนื้อแดง = 3.66 kg
 *     ทองเหลืองหนา = 89.40 kg
 *   ทองแดง:
 *     ทองแดงปอกเงา = 182.75 kg
 *     ทองแดงปอกช็อต = 153.74 kg   (note: "ปอกช็อต" — different from "ทองแดงช็อต")
 *     ทองแดงท่อ Candy = 0.90 kg
 *     ทองแดงใหญ่ = 75.42 kg
 *     ทองแดงเล็ก = 32.70 kg
 *     ทองแดงชุบ = 2.40 kg
 *     ขี้กลึงทองแดง = 0.00 kg
 *     ทองแดงติดเหล็ก = 0.00 kg
 *   Not included:
 *     หม้อน้ำทองแดง
 *
 * This script performs:
 *   Step 1-3: pull current production stock + verify Product IDs + System vs Physical table
 *   Step 4: check 09/07 Physical Count items (8.00 + 1.34) source
 *   Step 5: check if 8.00 + 1.34 came from daily receipts vs closing stock
 *   Step 6: hypothesis test — 6.34 kg from 07/07 — is it ทองเหลืองหนา?
 *   Step 7: build timeline (before Apply / target / after / receipts 10-11/07 / current)
 *
 * READ-ONLY — no DB writes.
 *
 * pgbouncer-safe: only sequential queries, no $transaction.
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/st19-physical-count-investigation'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function round2(x) { return Math.round(x * 100) / 100 }
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ============ Owner-declared physical stock ============
const OWNER_PHYSICAL = [
  // ทองเหลือง
  { name: 'ทองเหลืองเนื้อแดง', physical: 3.66, group: 'ทองเหลือง' },
  { name: 'ทองเหลืองหนา', physical: 89.40, group: 'ทองเหลือง' },
  // ทองแดง
  { name: 'ทองแดงปอกเงา', physical: 182.75, group: 'ทองแดง' },
  { name: 'ทองแดงปอกช็อต', physical: 153.74, group: 'ทองแดง' },
  { name: 'ทองแดงท่อ Candy', physical: 0.90, group: 'ทองแดง' },
  { name: 'ทองแดงใหญ่', physical: 75.42, group: 'ทองแดง' },
  { name: 'ทองแดงเล็ก', physical: 32.70, group: 'ทองแดง' },
  { name: 'ทองแดงชุบ', physical: 2.40, group: 'ทองแดง' },
  { name: 'ขี้กลึงทองแดง', physical: 0.00, group: 'ทองแดง' },
  { name: 'ทองแดงติดเหล็ก', physical: 0.00, group: 'ทองแดง' },
]

console.log('=== ST-19: PHYSICAL COUNT INVESTIGATION (READ-ONLY) ===\n')

// ============ STEP 1-3: Pull current production stock + verify Product IDs ============
console.log('=== STEP 1-3: VERIFY PRODUCTS AND CURRENT STOCK ===\n')

const productRows = []
const notFound = []
const ambiguous = []

for (const item of OWNER_PHYSICAL) {
  // Try exact match first
  const exact = await db.product.findMany({
    where: { name: item.name },
    include: { stockLots: { select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true } } },
  })

  if (exact.length === 0) {
    // Try contains — to flag ambiguous matches
    const partial = await db.product.findMany({
      where: { name: { contains: item.name } },
      include: { stockLots: { select: { id: true, remainingWeight: true, costPerKg: true } } },
    })
    if (partial.length === 0) {
      notFound.push(item)
      console.log(`❌ NOT FOUND: "${item.name}" (no exact or partial match)`)
      productRows.push({
        productName: item.name,
        productId: 'NOT_FOUND',
        group: item.group,
        systemWeight: null,
        averageCost: null,
        systemValue: null,
        lotCount: 0,
        physicalWeight: item.physical,
        differenceWeight: null,
        valueDifference: null,
        note: 'NOT FOUND in DB',
      })
      continue
    } else {
      for (const p of partial) {
        const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)
        const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
        const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
        ambiguous.push({ searchedFor: item.name, foundName: p.name, productId: p.id, totalWeight })
        console.log(`⚠️ AMBIGUOUS: searched "${item.name}" → found "${p.name}" (id=${p.id}, weight=${round2(totalWeight)})`)
        productRows.push({
          productName: p.name + ' (partial match for "' + item.name + '")',
          productId: p.id,
          group: item.group,
          systemWeight: round2(totalWeight),
          averageCost: round2(avgCost),
          systemValue: round2(totalCost),
          lotCount: p.stockLots.length,
          physicalWeight: item.physical,
          differenceWeight: round2(item.physical - totalWeight),
          valueDifference: round2((item.physical - totalWeight) * avgCost),
          note: 'AMBIGUOUS — partial name match',
        })
      }
      continue
    }
  }

  if (exact.length > 1) {
    console.log(`⚠️ MULTIPLE EXACT MATCHES for "${item.name}":`)
    for (const p of exact) {
      console.log(`   - id=${p.id}, name="${p.name}"`)
      ambiguous.push({ searchedFor: item.name, foundName: p.name, productId: p.id })
    }
  }

  // Single exact match (use first if multiple, but flag)
  const p = exact[0]
  const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)
  const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
  const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
  const diff = round2(item.physical - totalWeight)
  const valueDiff = round2(diff * avgCost)
  productRows.push({
    productName: p.name,
    productId: p.id,
    group: item.group,
    systemWeight: round2(totalWeight),
    averageCost: round2(avgCost),
    systemValue: round2(totalCost),
    lotCount: p.stockLots.length,
    physicalWeight: item.physical,
    differenceWeight: diff,
    valueDifference: valueDiff,
    note: exact.length > 1 ? `MULTIPLE EXACT MATCHES (${exact.length})` : 'OK',
  })
  console.log(`✅ ${p.name} (id=${p.id})`)
  console.log(`   system=${round2(totalWeight)} kg, physical=${item.physical} kg, diff=${diff} kg, avgCost=${round2(avgCost)}, valueDiff=${valueDiff} THB, lots=${p.stockLots.length}`)
}

// Also check for "ทองแดงช็อต" (the product used in 09/07 + 10/07) and "หม้อน้ำทองแดง" (excluded)
console.log('\n=== RELATED PRODUCTS — for context ===')
const relatedNames = ['ทองแดงช็อต', 'หม้อน้ำทองแดง', 'ทองแดงปอก', 'ทองแดงปอกช็อต']
for (const name of relatedNames) {
  const ps = await db.product.findMany({
    where: { name: { contains: name } },
    include: { stockLots: { select: { remainingWeight: true, costPerKg: true } } },
  })
  for (const p of ps) {
    const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)
    const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
    const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
    console.log(`  ${p.name} (id=${p.id}) — system=${round2(totalWeight)} kg, avgCost=${round2(avgCost)}, lots=${p.stockLots.length}`)
  }
}

// ============ STEP 4-5: Check 09/07 Physical Count items (8.00 + 1.34) source ============
console.log('\n\n=== STEP 4-5: 09/07 PHYSICAL COUNT — WERE 8.00 + 1.34 CLOSING STOCK OR DAILY RECEIPT? ===\n')

const SESSION_09 = 'cmrdqgfru0000sn8fdmtjjnla'
const session09 = await db.physicalCountSession.findUnique({
  where: { id: SESSION_09 },
  include: { items: { include: { product: { select: { id: true, name: true } } } } },
})

console.log(`09/07 session: ${session09.id}`)
console.log(`  countDate: ${session09.countDate.toISOString()}`)
console.log(`  createdAt: ${session09.createdAt.toISOString()}`)
console.log(`  status: ${session09.status}`)
console.log(`  note: ${session09.note ?? ''}`)
console.log(`\n  Items (with systemWeight snapshot stored at draft time):`)
for (const it of session09.items) {
  console.log(`    - ${it.product.name} (id=${it.productId})`)
  console.log(`      systemWeight (snapshot): ${it.systemWeight}`)
  console.log(`      physicalWeight: ${it.physicalWeight}`)
  console.log(`      differenceWeight: ${it.differenceWeight}`)
  console.log(`      averageCost: ${it.averageCost}`)
  console.log(`      valueDifference: ${it.valueDifference}`)
  console.log(`      note: ${it.note ?? ''}`)
}

// Check ทองเหลืองหนา and ทองเหลืองเนื้อแดง specifically
const items09Brass = session09.items.filter(it =>
  it.product.name === 'ทองเหลืองหนา' || it.product.name === 'ทองเหลืองเนื้อแดง'
)
console.log(`\n  Brass items in 09/07 session:`)
for (const it of items09Brass) {
  console.log(`    - ${it.product.name}: system=${it.systemWeight}, physical=${it.physicalWeight}, diff=${it.differenceWeight}`)
}

// Compare with audit log "before" values
console.log(`\n  Audit logs for 09/07 session:`)
const auditLogs09 = await db.auditLog.findMany({
  where: { entityId: SESSION_09, entityType: 'PHYSICAL_COUNT' },
  orderBy: { createdAt: 'asc' },
})
for (const log of auditLogs09) {
  const d = JSON.parse(log.details)
  console.log(`    ${log.createdAt.toISOString()} | type=${d.type} | adjustments=${d.adjustments?.length ?? 0}`)
  if (Array.isArray(d.adjustments)) {
    for (const a of d.adjustments) {
      if (a.productName === 'ทองเหลืองหนา' || a.productName === 'ทองเหลืองเนื้อแดง') {
        console.log(`      ${a.productName}: before=${a.before}, physical=${a.physical}, diff=${a.difference}, after=${a.after}`)
      }
    }
  }
}

// ============ STEP 5: Check daily receipts (BuyBillItem) — 07/07, 08/07, 09/07 ============
console.log('\n=== STEP 5: DAILY RECEIPTS (BuyBillItem) — 07/07, 08/07, 09/07 for brass products ===\n')

const brassProductIds = items09Brass.map(it => it.productId)
for (const pid of brassProductIds) {
  const p = await db.product.findUnique({ where: { id: pid }, select: { name: true } })
  console.log(`\n  ${p.name} (id=${pid})`)
  // All BuyBillItem entries for this product, dated 07/07-09/07
  const buyItems = await db.buyBillItem.findMany({
    where: { productId: pid, buyBill: { date: { gte: new Date('2026-07-06T00:00:00Z'), lte: new Date('2026-07-09T23:59:59Z') } } },
    include: { buyBill: { select: { id: true, billNumber: true, externalBillNumber: true, date: true, isCancelled: true, note: true } } },
    orderBy: { buyBill: { date: 'asc' } },
  })
  console.log(`    BuyBillItem entries 07/06-07/09: ${buyItems.length}`)
  for (const it of buyItems) {
    const date = it.buyBill.date.toISOString().split('T')[0]
    console.log(`    [${date}] bill=${it.buyBill.billNumber ?? it.buyBill.externalBillNumber ?? '—'} | weight=${it.weight} kg | cancelled=${it.buyBill.isCancelled}`)
  }

  // SortingBillItem where this product is OUTPUT (sorted from another source) — also adds stock
  const sortItems = await db.sortingBillItem.findMany({
    where: { productId: pid, sortingBill: { date: { gte: new Date('2026-07-06T00:00:00Z'), lte: new Date('2026-07-09T23:59:59Z') } } },
    include: { sortingBill: { select: { id: true, billNumber: true, date: true, isCancelled: true, sourceProductId: true, sourceWeight: true } } },
    orderBy: { sortingBill: { date: 'asc' } },
  })
  console.log(`    SortingBillItem (as output) 07/06-07/09: ${sortItems.length}`)
  for (const it of sortItems) {
    const date = it.sortingBill.date.toISOString().split('T')[0]
    console.log(`    [${date}] sortingBill=${it.sortingBill.billNumber ?? '—'} | weight=${it.weight} kg | cancelled=${it.sortingBill.isCancelled}`)
  }

  // StockTransferItem where this product is OUTPUT (dismantled output) — also adds stock
  const transferItems = await db.stockTransferItem.findMany({
    where: { productId: pid, stockTransfer: { date: { gte: new Date('2026-07-06T00:00:00Z'), lte: new Date('2026-07-09T23:59:59Z') } } },
    include: { stockTransfer: { select: { id: true, billNumber: true, date: true, isCancelled: true, businessType: true } } },
    orderBy: { stockTransfer: { date: 'asc' } },
  })
  console.log(`    StockTransferItem (as output) 07/06-07/09: ${transferItems.length}`)
  for (const it of transferItems) {
    const date = it.stockTransfer.date.toISOString().split('T')[0]
    console.log(`    [${date}] stockTransfer=${it.stockTransfer.billNumber ?? '—'} | weight=${it.weight} kg | businessType=${it.stockTransfer.businessType} | cancelled=${it.stockTransfer.isCancelled}`)
  }
}

// ============ STEP 6: Hypothesis test — 6.34 kg from 07/07 — is it ทองเหลืองหนา? ============
console.log('\n\n=== STEP 6: HYPOTHESIS TEST — 6.34 kg 07/07 ENTRIES ===\n')

// Search ALL products that received 6.34 kg on 07/07 (any product)
console.log('Searching all BuyBillItems weighing exactly 6.34 kg on 07/07/2026...')
const allBuyItems634 = await db.buyBillItem.findMany({
  where: { weight: 6.34, buyBill: { date: { gte: new Date('2026-07-07T00:00:00Z'), lt: new Date('2026-07-08T00:00:00Z') } } },
  include: { buyBill: { select: { id: true, billNumber: true, externalBillNumber: true, date: true, isCancelled: true, note: true } }, product: { select: { id: true, name: true } } },
})
console.log(`Found ${allBuyItems634.length} BuyBillItems with weight=6.34 kg on 07/07/2026:`)
for (const it of allBuyItems634) {
  console.log(`  - product="${it.product.name}" (id=${it.product.id}) | bill=${it.buyBill.billNumber ?? it.buyBill.externalBillNumber ?? '—'} | date=${it.buyBill.date.toISOString()} | cancelled=${it.buyBill.isCancelled}`)
}

// Also check SortingBillItem (output) with weight 6.34 on 07/07
console.log('\nSearching all SortingBillItems (output) weighing 6.34 kg on 07/07/2026...')
const allSortItems634 = await db.sortingBillItem.findMany({
  where: { weight: 6.34, sortingBill: { date: { gte: new Date('2026-07-07T00:00:00Z'), lt: new Date('2026-07-08T00:00:00Z') } } },
  include: { sortingBill: { select: { id: true, billNumber: true, date: true, isCancelled: true } }, product: { select: { id: true, name: true } } },
})
console.log(`Found ${allSortItems634.length} SortingBillItems with weight=6.34 kg on 07/07/2026:`)
for (const it of allSortItems634) {
  console.log(`  - product="${it.product.name}" (id=${it.product.id}) | sortingBill=${it.sortingBill.billNumber ?? '—'} | date=${it.sortingBill.date.toISOString()} | cancelled=${it.sortingBill.isCancelled}`)
}

// Also check StockTransferItem (output) with weight 6.34 on 07/07
console.log('\nSearching all StockTransferItems (output) weighing 6.34 kg on 07/07/2026...')
const allTransferItems634 = await db.stockTransferItem.findMany({
  where: { weight: 6.34, stockTransfer: { date: { gte: new Date('2026-07-07T00:00:00Z'), lt: new Date('2026-07-08T00:00:00Z') } } },
  include: { stockTransfer: { select: { id: true, billNumber: true, date: true, isCancelled: true, businessType: true } }, product: { select: { id: true, name: true } } },
})
console.log(`Found ${allTransferItems634.length} StockTransferItems with weight=6.34 kg on 07/07/2026:`)
for (const it of allTransferItems634) {
  console.log(`  - product="${it.product.name}" (id=${it.product.id}) | stockTransfer=${it.stockTransfer.billNumber ?? '—'} | date=${it.stockTransfer.date.toISOString()} | businessType=${it.stockTransfer.businessType} | cancelled=${it.stockTransfer.isCancelled}`)
}

// Also check the 08/07 Physical Count Draft (Task 66) which used 6.34 for ทองเหลืองหนา
console.log('\nChecking 08/07 Physical Count Draft (Task 66 — session cmrdae0vh0000sgmjvb5aiu0n):')
const draft08 = await db.physicalCountSession.findUnique({
  where: { id: 'cmrdae0vh0000sgmjvb5aiu0n' },
  include: { items: { include: { product: { select: { id: true, name: true } } } } },
})
if (draft08) {
  console.log(`  Draft 08/07 session: status=${draft08.status}, createdAt=${draft08.createdAt.toISOString()}`)
  console.log(`  note: ${draft08.note}`)
  console.log(`  Items:`)
  for (const it of draft08.items) {
    console.log(`    - ${it.product.name}: system=${it.systemWeight}, physical=${it.physicalWeight}, diff=${it.differenceWeight}`)
  }
}

// ============ STEP 7: Build timeline (before Apply / target / after / receipts 10-11/07 / current) ============
console.log('\n\n=== STEP 7: TIMELINE — ทองเหลืองหนา + ทองเหลืองเนื้อแดง ===\n')

const timelineRows = []

const APPLY_09_TIMESTAMP = new Date('2026-07-11T06:37:35.914Z')
const APPLY_09_AUDIT1 = new Date('2026-07-11T06:37:31.292Z')
const APPLY_09_AUDIT2 = new Date('2026-07-11T06:37:36.803Z')

for (const pid of brassProductIds) {
  const p = await db.product.findUnique({ where: { id: pid }, select: { name: true } })
  console.log(`\n  ===== ${p.name} (id=${pid}) =====`)

  // Get the 09/07 session item
  const item09 = session09.items.find(it => it.productId === pid)
  if (!item09) {
    console.log(`    No item in 09/07 session for this product — SKIP`)
    continue
  }
  console.log(`  [T1] System snapshot in 09/07 draft: ${item09.systemWeight} kg`)

  // Get the audit log "before" values (from both audit logs)
  let before1 = null, before2 = null, after1 = null, after2 = null
  for (const log of auditLogs09) {
    const d = JSON.parse(log.details)
    if (!Array.isArray(d.adjustments)) continue
    for (const a of d.adjustments) {
      if (a.productId === pid) {
        if (log.createdAt.getTime() === APPLY_09_AUDIT1.getTime()) {
          before1 = a.before; after1 = a.after
        } else if (log.createdAt.getTime() === APPLY_09_AUDIT2.getTime()) {
          before2 = a.before; after2 = a.after
        }
      }
    }
  }
  console.log(`  [T2] Audit log 1 (06:37:31): before=${before1}, after=${after1}`)
  console.log(`  [T2] Audit log 2 (06:37:36): before=${before2}, after=${after2}`)
  console.log(`  [T3] Physical target used: ${item09.physicalWeight} kg`)

  // Get receipts between APPLY_09 and now (10/07 + 11/07)
  const buyItemsAfter = await db.buyBillItem.findMany({
    where: { productId: pid, buyBill: { date: { gte: new Date('2026-07-09T23:59:59Z') } } },
    include: { buyBill: { select: { billNumber: true, externalBillNumber: true, date: true, isCancelled: true, createdAt: true } } },
    orderBy: { buyBill: { date: 'asc' } },
  })
  let totalBoughtAfter = 0
  console.log(`  [T4] BuyBill receipts dated 10/07 onward: ${buyItemsAfter.length}`)
  for (const it of buyItemsAfter) {
    const date = it.buyBill.date.toISOString().split('T')[0]
    const created = it.buyBill.createdAt.toISOString().split('T')[0]
    if (!it.buyBill.isCancelled) totalBoughtAfter += it.weight
    console.log(`    [${date}] billNo=${it.buyBill.billNumber ?? it.buyBill.externalBillNumber ?? '—'} | weight=${it.weight} | createdAt=${created} | cancelled=${it.buyBill.isCancelled}`)
  }
  console.log(`       Total receipts 10/07 onward (not cancelled): ${round2(totalBoughtAfter)} kg`)

  // Sort output (adds stock) after apply
  const sortItemsAfter = await db.sortingBillItem.findMany({
    where: { productId: pid, sortingBill: { date: { gte: new Date('2026-07-09T23:59:59Z') } } },
    include: { sortingBill: { select: { billNumber: true, date: true, isCancelled: true, createdAt: true } } },
    orderBy: { sortingBill: { date: 'asc' } },
  })
  let totalSortedAfter = 0
  console.log(`  [T4] SortingBill outputs dated 10/07 onward: ${sortItemsAfter.length}`)
  for (const it of sortItemsAfter) {
    const date = it.sortingBill.date.toISOString().split('T')[0]
    const created = it.sortingBill.createdAt.toISOString().split('T')[0]
    if (!it.sortingBill.isCancelled) totalSortedAfter += it.weight
    console.log(`    [${date}] sortingBill=${it.sortingBill.billNumber ?? '—'} | weight=${it.weight} | createdAt=${created} | cancelled=${it.sortingBill.isCancelled}`)
  }
  console.log(`       Total sort outputs 10/07 onward (not cancelled): ${round2(totalSortedAfter)} kg`)

  // StockTransfer output after apply
  const transferItemsAfter = await db.stockTransferItem.findMany({
    where: { productId: pid, stockTransfer: { date: { gte: new Date('2026-07-09T23:59:59Z') } } },
    include: { stockTransfer: { select: { billNumber: true, date: true, isCancelled: true, createdAt: true, businessType: true } } },
    orderBy: { stockTransfer: { date: 'asc' } },
  })
  let totalTransferOutAfter = 0
  console.log(`  [T4] StockTransfer outputs dated 10/07 onward: ${transferItemsAfter.length}`)
  for (const it of transferItemsAfter) {
    const date = it.stockTransfer.date.toISOString().split('T')[0]
    const created = it.stockTransfer.createdAt.toISOString().split('T')[0]
    if (!it.stockTransfer.isCancelled) totalTransferOutAfter += it.weight
    console.log(`    [${date}] stockTransfer=${it.stockTransfer.billNumber ?? '—'} | weight=${it.weight} | businessType=${it.stockTransfer.businessType} | createdAt=${created} | cancelled=${it.stockTransfer.isCancelled}`)
  }
  console.log(`       Total transfer outputs 10/07 onward (not cancelled): ${round2(totalTransferOutAfter)} kg`)

  // Sales / Sorting source / Transfer source = consumption (deduct stock) after apply
  const sellItemsAfter = await db.sellBillItem.findMany({
    where: { productId: pid, sellBill: { date: { gte: new Date('2026-07-09T23:59:59Z') } } },
    include: { sellBill: { select: { billNumber: true, externalBillNumber: true, date: true, isCancelled: true, createdAt: true } } },
    orderBy: { sellBill: { date: 'asc' } },
  })
  let totalSoldAfter = 0
  console.log(`  [T4] SellBill sales dated 10/07 onward: ${sellItemsAfter.length}`)
  for (const it of sellItemsAfter) {
    const date = it.sellBill.date.toISOString().split('T')[0]
    const created = it.sellBill.createdAt.toISOString().split('T')[0]
    if (!it.sellBill.isCancelled) totalSoldAfter += it.weight
    console.log(`    [${date}] sellBill=${it.sellBill.billNumber ?? it.sellBill.externalBillNumber ?? '—'} | weight=${it.weight} | createdAt=${created} | cancelled=${it.sellBill.isCancelled}`)
  }
  console.log(`       Total sold 10/07 onward (not cancelled): ${round2(totalSoldAfter)} kg`)

  const sortSourceAfter = await db.sortingBill.findMany({
    where: { sourceProductId: pid, date: { gte: new Date('2026-07-09T23:59:59Z') } },
    select: { billNumber: true, date: true, isCancelled: true, createdAt: true, sourceWeight: true },
    orderBy: { date: 'asc' },
  })
  let totalSortSourceAfter = 0
  console.log(`  [T4] SortingBill (as source) dated 10/07 onward: ${sortSourceAfter.length}`)
  for (const sb of sortSourceAfter) {
    const date = sb.date.toISOString().split('T')[0]
    const created = sb.createdAt.toISOString().split('T')[0]
    if (!sb.isCancelled) totalSortSourceAfter += sb.sourceWeight
    console.log(`    [${date}] sortingBill=${sb.billNumber ?? '—'} | sourceWeight=${sb.sourceWeight} | createdAt=${created} | cancelled=${sb.isCancelled}`)
  }
  console.log(`       Total sort source 10/07 onward (not cancelled): ${round2(totalSortSourceAfter)} kg`)

  const transferSourceAfter = await db.stockTransfer.findMany({
    where: { sourceProductId: pid, date: { gte: new Date('2026-07-09T23:59:59Z') } },
    select: { billNumber: true, date: true, isCancelled: true, createdAt: true, sourceWeight: true, businessType: true },
    orderBy: { date: 'asc' },
  })
  let totalTransferSourceAfter = 0
  console.log(`  [T4] StockTransfer (as source) dated 10/07 onward: ${transferSourceAfter.length}`)
  for (const tr of transferSourceAfter) {
    const date = tr.date.toISOString().split('T')[0]
    const created = tr.createdAt.toISOString().split('T')[0]
    if (!tr.isCancelled) totalTransferSourceAfter += tr.sourceWeight
    console.log(`    [${date}] stockTransfer=${tr.billNumber ?? '—'} | sourceWeight=${tr.sourceWeight} | businessType=${tr.businessType} | createdAt=${created} | cancelled=${tr.isCancelled}`)
  }
  console.log(`       Total transfer source 10/07 onward (not cancelled): ${round2(totalTransferSourceAfter)} kg`)

  // STOCK_ADJUSTMENT lots created after apply (from physical count apply or other adjustments)
  const adjLotsAfter = await db.stockLot.findMany({
    where: { productId: pid, source: 'STOCK_ADJUSTMENT', createdAt: { gte: APPLY_09_TIMESTAMP } },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, createdAt: true, sourceId: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`  [T4] STOCK_ADJUSTMENT lots created after 09/07 apply: ${adjLotsAfter.length}`)
  for (const lot of adjLotsAfter) {
    console.log(`    lot.id=${lot.id} | sourceId=${lot.sourceId ?? '—'} | remainingWeight=${lot.remainingWeight} | createdAt=${lot.createdAt.toISOString()}`)
  }

  // [T5] Current stock
  const lots = await db.stockLot.findMany({
    where: { productId: pid, remainingWeight: { gt: 0 } },
    select: { remainingWeight: true, costPerKg: true },
  })
  const currentStock = round2(lots.reduce((s, l) => s + l.remainingWeight, 0))
  console.log(`  [T5] Current live stock: ${currentStock} kg (across ${lots.length} active lots)`)

  // Compute expected current = after2 + receipts - consumption + adjustments
  const expectedCurrent = round2((after2 ?? after1 ?? 0) + totalBoughtAfter + totalSortedAfter + totalTransferOutAfter - totalSoldAfter - totalSortSourceAfter - totalTransferSourceAfter)
  console.log(`\n  [EXPECTED] after_apply (${after2 ?? after1}) + receipts (${round2(totalBoughtAfter + totalSortedAfter + totalTransferOutAfter)}) - consumption (${round2(totalSoldAfter + totalSortSourceAfter + totalTransferSourceAfter)})`)
  console.log(`            = ${expectedCurrent} kg`)
  console.log(`  [ACTUAL]   ${currentStock} kg`)
  console.log(`  [DELTA]    ${round2(currentStock - expectedCurrent)} kg`)

  timelineRows.push({
    productName: p.name,
    productId: pid,
    snapshotSystemWeight: item09.systemWeight,
    auditLog1Before: before1,
    auditLog1After: after1,
    auditLog2Before: before2,
    auditLog2After: after2,
    physicalTarget: item09.physicalWeight,
    receipts10JulOnward: round2(totalBoughtAfter + totalSortedAfter + totalTransferOutAfter),
    consumption10JulOnward: round2(totalSoldAfter + totalSortSourceAfter + totalTransferSourceAfter),
    currentStock,
    expectedCurrent,
    delta: round2(currentStock - expectedCurrent),
  })
}

// ============ Write outputs ============
console.log('\n\n=== WRITE OUTPUTS ===')

// CSV: System vs Physical
const csv1Cols = ['group','product_name','product_id','system_weight_kg','physical_weight_kg','difference_weight_kg','average_cost_per_kg','value_difference_thb','active_lots','note']
const csv1Rows = [csv1Cols.join(',')]
for (const r of productRows) {
  csv1Rows.push([
    r.group, r.productName, r.productId, r.systemWeight ?? '', r.physicalWeight,
    r.differenceWeight ?? '', r.averageCost ?? '', r.valueDifference ?? '',
    r.lotCount, r.note,
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'step1-3-system-vs-physical.csv'), '\ufeff' + csv1Rows.join('\n'), 'utf-8')
console.log(`  ✓ step1-3-system-vs-physical.csv`)

// JSON dump
const jsonPath = path.join(OUTPUT_DIR, 'st19-investigation.json')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  ownerPhysical: OWNER_PHYSICAL,
  productRows,
  notFound,
  ambiguous,
  session09: {
    id: session09.id,
    countDate: session09.countDate.toISOString(),
    createdAt: session09.createdAt.toISOString(),
    status: session09.status,
    note: session09.note,
    appliedAt: session09.appliedAt?.toISOString() ?? null,
    appliedById: session09.appliedById,
    items: session09.items.map(it => ({
      productId: it.productId,
      productName: it.product.name,
      systemWeight: it.systemWeight,
      physicalWeight: it.physicalWeight,
      differenceWeight: it.differenceWeight,
      averageCost: it.averageCost,
      valueDifference: it.valueDifference,
    })),
  },
  auditLogs09: auditLogs09.map(l => ({
    id: l.id,
    createdAt: l.createdAt.toISOString(),
    details: JSON.parse(l.details),
  })),
  sixPointThreeFourEntries: {
    buyItems: allBuyItems634.map(it => ({
      productName: it.product.name,
      productId: it.product.id,
      billNumber: it.buyBill.billNumber ?? it.buyBill.externalBillNumber,
      date: it.buyBill.date.toISOString(),
      cancelled: it.buyBill.isCancelled,
    })),
    sortItems: allSortItems634.map(it => ({
      productName: it.product.name,
      productId: it.product.id,
      sortingBillNumber: it.sortingBill.billNumber,
      date: it.sortingBill.date.toISOString(),
      cancelled: it.sortingBill.isCancelled,
    })),
    transferItems: allTransferItems634.map(it => ({
      productName: it.product.name,
      productId: it.product.id,
      stockTransferNumber: it.stockTransfer.billNumber,
      date: it.stockTransfer.date.toISOString(),
      businessType: it.stockTransfer.businessType,
      cancelled: it.stockTransfer.isCancelled,
    })),
  },
  draft08: draft08 ? {
    id: draft08.id,
    countDate: draft08.countDate.toISOString(),
    status: draft08.status,
    note: draft08.note,
    items: draft08.items.map(it => ({
      productId: it.productId,
      productName: it.product.name,
      systemWeight: it.systemWeight,
      physicalWeight: it.physicalWeight,
      differenceWeight: it.differenceWeight,
    })),
  } : null,
  timeline: timelineRows,
}, null, 2), 'utf-8')
console.log(`  ✓ st19-investigation.json`)

// CSV: Timeline for brass products
const csv2Cols = ['product_name','product_id','snapshot_system_weight','audit1_before','audit1_after','audit2_before','audit2_after','physical_target','receipts_10jul_onward','consumption_10jul_onward','current_stock','expected_current','delta']
const csv2Rows = [csv2Cols.join(',')]
for (const r of timelineRows) {
  csv2Rows.push([
    r.productName, r.productId, r.snapshotSystemWeight,
    r.auditLog1Before ?? '', r.auditLog1After ?? '',
    r.auditLog2Before ?? '', r.auditLog2After ?? '',
    r.physicalTarget, r.receipts10JulOnward, r.consumption10JulOnward,
    r.currentStock, r.expectedCurrent, r.delta,
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'step7-timeline-brass.csv'), '\ufeff' + csv2Rows.join('\n'), 'utf-8')
console.log(`  ✓ step7-timeline-brass.csv`)

console.log('\n=== ST-19 INVESTIGATION DONE (READ-ONLY) ===')
await db.$disconnect()
