/**
 * Physical Count Production — Step 2/3: VERIFY POST-APPLY STOCK STATE
 *
 * Context:
 *   - 09/07 session (cmrdqgfru0000sn8fdmtjjnla) is ALREADY APPLIED with 2 audit logs
 *   - 10/07 session (cmrfzuu1b0002la044u1ikzzd) is ALREADY APPLIED with 1 audit log
 *
 * Per owner instruction:
 *   - ห้าม Apply ซ้ำ (do not re-apply)
 *   - ตรวจผลและรายงานหลักฐานแทน (verify and report evidence instead)
 *
 * This script verifies:
 *   1. For each item in both sessions, current stock matches expected post-apply value
 *   2. No negative StockLots in DB
 *   3. Audit log before/after values are consistent
 *   4. Reports any discrepancy
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

const OUTPUT_DIR = '/home/z/my-project/reconciliation/physical-count-apply-2026-07-09-and-10'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function round2(x) { return Math.round(x * 100) / 100 }
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ============ Sessions to verify ============
const SESSION_09 = 'cmrdqgfru0000sn8fdmtjjnla' // 09/07/2569 — APPLIED, 8 items
const SESSION_10 = 'cmrfzuu1b0002la044u1ikzzd' // 10/07/2569 — APPLIED, 1 item (ทองแดงช็อต 3.8 kg)

console.log('=== STEP 2/3: VERIFY POST-APPLY STOCK STATE ===\n')

// ============ Load both sessions with items ============
const session09 = await db.physicalCountSession.findUnique({
  where: { id: SESSION_09 },
  include: { items: { include: { product: { select: { id: true, name: true } } } } },
})
if (!session09) {
  console.error(`❌ 09/07 session ${SESSION_09} not found`)
  process.exit(1)
}
console.log(`09/07 session: status=${session09.status}, appliedAt=${session09.appliedAt?.toISOString()}, appliedById=${session09.appliedById}`)
console.log(`  appliedNote: ${session09.appliedNote ?? ''}`)
console.log(`  itemCount: ${session09.items.length}`)

const session10 = await db.physicalCountSession.findUnique({
  where: { id: SESSION_10 },
  include: { items: { include: { product: { select: { id: true, name: true } } } } },
})
if (!session10) {
  console.error(`❌ 10/07 session ${SESSION_10} not found`)
  process.exit(1)
}
console.log(`\n10/07 session: status=${session10.status}, appliedAt=${session10.appliedAt?.toISOString()}, appliedById=${session10.appliedById}`)
console.log(`  appliedNote: ${session10.appliedNote ?? ''}`)
console.log(`  itemCount: ${session10.items.length}`)

// ============ Compute current stock for each product ============
// Use a Map to combine 09/07 items + 10/07 items (in case a product appears in both)
const productVerificationMap = new Map()

for (const item of session09.items) {
  if (productVerificationMap.has(item.productId)) continue // skip dupes (10/07 will be merged below)
  productVerificationMap.set(item.productId, {
    productId: item.productId,
    productName: item.product.name,
    sessions: ['09/07'],
    physicalFromSession09: item.physicalWeight,
    physicalFromSession10: null,
    auditLogExpectedAfter: null, // filled later from audit logs
  })
}
for (const item of session10.items) {
  const existing = productVerificationMap.get(item.productId)
  if (existing) {
    existing.sessions.push('10/07')
    existing.physicalFromSession10 = item.physicalWeight
  } else {
    productVerificationMap.set(item.productId, {
      productId: item.productId,
      productName: item.product.name,
      sessions: ['10/07'],
      physicalFromSession09: null,
      physicalFromSession10: item.physicalWeight,
      auditLogExpectedAfter: null,
    })
  }
}

// ============ Load audit logs to get expected after-values ============
const auditLogs09 = await db.auditLog.findMany({
  where: { entityId: SESSION_09, entityType: 'PHYSICAL_COUNT' },
  orderBy: { createdAt: 'asc' },
})
console.log(`\n09/07 audit logs: ${auditLogs09.length}`)
for (const log of auditLogs09) {
  const d = JSON.parse(log.details)
  console.log(`  ${log.createdAt.toISOString()} | type=${d.type} | adjustments=${d.adjustments?.length ?? 0} | deductedLots=${d.deductedLotCount}`)
}

const auditLogs10 = await db.auditLog.findMany({
  where: { entityId: SESSION_10, entityType: 'PHYSICAL_COUNT' },
  orderBy: { createdAt: 'asc' },
})
console.log(`\n10/07 audit logs: ${auditLogs10.length}`)
for (const log of auditLogs10) {
  const d = JSON.parse(log.details)
  console.log(`  ${log.createdAt.toISOString()} | type=${d.type} | adjustments=${d.adjustments?.length ?? 0} | deductedLots=${d.deductedLotCount} | createdLots=${d.createdLotIds?.length ?? 0}`)
}

// Get the FINAL "after" value for each product from the LAST audit log that mentions it
// (last audit log wins, since it represents the final state)
function applyAuditLogsToMap(logs, map) {
  for (const log of logs) {
    const d = JSON.parse(log.details)
    if (!Array.isArray(d.adjustments)) continue
    for (const adj of d.adjustments) {
      const entry = map.get(adj.productId)
      if (!entry) continue
      // Last-write-wins: later audit log overrides
      entry.auditLogExpectedAfter = adj.after
    }
  }
}
applyAuditLogsToMap(auditLogs09, productVerificationMap)
applyAuditLogsToMap(auditLogs10, productVerificationMap)

// ============ Re-fetch LIVE stock for each product ============
console.log('\n=== CURRENT STOCK VERIFICATION (live DB) ===\n')
const verificationRows = []
let allMatch = true

for (const [productId, entry] of productVerificationMap) {
  const lots = await db.stockLot.findMany({
    where: { productId, remainingWeight: { gt: 0 } },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true },
    orderBy: { dateAdded: 'asc' },
  })
  const allLots = await db.stockLot.findMany({
    where: { productId },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true },
    orderBy: { dateAdded: 'asc' },
  })
  const totalWeight = round2(lots.reduce((s, l) => s + l.remainingWeight, 0))
  const totalCost = round2(lots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0))
  const avgCost = totalWeight > 0 ? round2(totalCost / totalWeight) : 0

  const expectedAfter = entry.auditLogExpectedAfter
  const matches = expectedAfter === null ? null : (Math.abs(totalWeight - expectedAfter) < 0.01)

  if (matches === false) allMatch = false

  const row = {
    productId,
    productName: entry.productName,
    sessions: entry.sessions.join('+'),
    physicalFromSession09: entry.physicalFromSession09,
    physicalFromSession10: entry.physicalFromSession10,
    auditLogExpectedAfter: expectedAfter,
    currentStockWeight: totalWeight,
    currentActiveLots: lots.length,
    currentTotalLots: allLots.length,
    currentAvgCost: avgCost,
    matches: matches === null ? 'N/A' : (matches ? '✅ MATCH' : '❌ MISMATCH'),
    deltaVsExpected: expectedAfter === null ? null : round2(totalWeight - expectedAfter),
    stockAdjustmentLots: allLots.filter(l => l.source === 'STOCK_ADJUSTMENT').length,
  }
  verificationRows.push(row)

  console.log(`${row.productName} (${row.sessions})`)
  console.log(`  Physical (09/07): ${row.physicalFromSession09 ?? '—'} | Physical (10/07): ${row.physicalFromSession10 ?? '—'}`)
  console.log(`  Audit log expected after: ${row.auditLogExpectedAfter}`)
  console.log(`  Current live stock: ${row.currentStockWeight} kg across ${row.currentActiveLots} active lots (total ${row.currentTotalLots} lots, ${row.stockAdjustmentLots} STOCK_ADJUSTMENT)`)
  console.log(`  Avg cost: ${row.currentAvgCost} THB/kg`)
  console.log(`  Match: ${row.matches}${row.deltaVsExpected !== null ? ` (delta=${row.deltaVsExpected})` : ''}`)
  console.log()
}

// ============ Check for negative StockLots (global) ============
console.log('=== NEGATIVE STOCKLOT CHECK (global) ===')
const negativeLots = await db.stockLot.findMany({
  where: { remainingWeight: { lt: 0 } },
  select: { id: true, productId: true, remainingWeight: true, source: true, sourceId: true },
})
console.log(`Negative StockLots: ${negativeLots.length}`)
for (const lot of negativeLots) {
  console.log(`  ❌ lot.id=${lot.id}, productId=${lot.productId}, remainingWeight=${lot.remainingWeight}, source=${lot.source}, sourceId=${lot.sourceId ?? ''}`)
}

// ============ Per-product negative StockLots check (for the 8+1 products) ============
console.log('\n=== PER-PRODUCT NEGATIVE LOT CHECK (09/07 + 10/07 affected products) ===')
for (const [productId, entry] of productVerificationMap) {
  const neg = await db.stockLot.count({ where: { productId, remainingWeight: { lt: 0 } } })
  if (neg > 0) {
    console.log(`  ❌ ${entry.productName}: ${neg} negative lots`)
  } else {
    console.log(`  ✅ ${entry.productName}: 0 negative lots`)
  }
}

// ============ Global safety snapshot ============
console.log('\n=== SAFETY SNAPSHOT ===')
const totalStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
const totalStockLotCount = await db.stockLot.count()
const totalNegativeLots = await db.stockLot.count({ where: { remainingWeight: { lt: 0 } } })
const buyBillCount = await db.buyBill.count()
const sellBillCount = await db.sellBill.count()
const sortingBillCount = await db.sortingBill.count()
const stockTransferCount = await db.stockTransfer.count()
const productCount = await db.product.count()
const sessionCount = await db.physicalCountSession.count()

console.log(`Total stock weight: ${round2(totalStockAgg._sum.remainingWeight ?? 0)} kg`)
console.log(`StockLot count: ${totalStockLotCount}`)
console.log(`Negative StockLots (global): ${totalNegativeLots}`)
console.log(`BuyBill count: ${buyBillCount}`)
console.log(`SellBill count: ${sellBillCount}`)
console.log(`SortingBill count: ${sortingBillCount}`)
console.log(`StockTransfer count: ${stockTransferCount}`)
console.log(`Product count: ${productCount}`)
console.log(`PhysicalCountSession count: ${sessionCount}`)

// ============ Check 08/07 sessions are UNTOUCHED (still DRAFT) ============
console.log('\n=== 08/07 SESSIONS — VERIFY UNTOUCHED ===')
const sessions08 = await db.physicalCountSession.findMany({
  where: { countDate: { gte: new Date('2026-07-08T00:00:00Z'), lt: new Date('2026-07-09T00:00:00Z') } },
  select: { id: true, status: true, appliedAt: true, appliedById: true, group: true, note: true, _count: { select: { items: true } } },
})
for (const s of sessions08) {
  const untouched = s.status === 'DRAFT' && s.appliedAt === null && s.appliedById === null
  console.log(`  ${s.id} | group=${s.group} | status=${s.status} | appliedAt=${s.appliedAt ?? '—'} | items=${s._count.items} | ${untouched ? '✅ UNTOUCHED' : '❌ MODIFIED'}`)
}

// ============ Write CSV report ============
const csvCols = [
  'product_id','product_name','sessions','physical_09_07','physical_10_07',
  'audit_log_expected_after','current_stock_weight','current_active_lots','current_total_lots',
  'current_avg_cost','stock_adjustment_lots','delta_vs_expected','match'
]
const csvRows = [csvCols.join(',')]
for (const r of verificationRows) {
  csvRows.push([
    r.productId, r.productName, r.sessions, r.physicalFromSession09 ?? '', r.physicalFromSession10 ?? '',
    r.auditLogExpectedAfter ?? '', r.currentStockWeight, r.currentActiveLots, r.currentTotalLots,
    r.currentAvgCost, r.stockAdjustmentLots, r.deltaVsExpected ?? '', r.matches,
  ].map(csvEscape).join(','))
}
const csvPath = path.join(OUTPUT_DIR, 'step2-3-verify-post-apply.csv')
fs.writeFileSync(csvPath, '\ufeff' + csvRows.join('\n'), 'utf-8')
console.log(`\n✅ CSV written: ${csvPath}`)

// ============ Write JSON report ============
const jsonPath = path.join(OUTPUT_DIR, 'step2-3-verify-post-apply.json')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  sessions: {
    '09/07': {
      sessionId: SESSION_09,
      status: session09.status,
      appliedAt: session09.appliedAt?.toISOString() ?? null,
      appliedById: session09.appliedById,
      appliedNote: session09.appliedNote,
      auditLogCount: auditLogs09.length,
    },
    '10/07': {
      sessionId: SESSION_10,
      status: session10.status,
      appliedAt: session10.appliedAt?.toISOString() ?? null,
      appliedById: session10.appliedById,
      appliedNote: session10.appliedNote,
      auditLogCount: auditLogs10.length,
    },
  },
  allStockMatchesAuditLog: allMatch,
  negativeStockLotsGlobal: totalNegativeLots,
  safetySnapshot: {
    totalStockWeight: round2(totalStockAgg._sum.remainingWeight ?? 0),
    stockLotCount: totalStockLotCount,
    negativeLots: totalNegativeLots,
    buyBillCount, sellBillCount, sortingBillCount, stockTransferCount, productCount,
    sessionCount,
  },
  sessions08Untouched: sessions08.map(s => ({
    id: s.id, status: s.status, appliedAt: s.appliedAt, appliedById: s.appliedById,
    group: s.group, itemCount: s._count.items,
    untouched: s.status === 'DRAFT' && s.appliedAt === null && s.appliedById === null,
  })),
  verification: verificationRows,
  auditLogs09: auditLogs09.map(l => ({
    id: l.id, createdAt: l.createdAt.toISOString(), details: JSON.parse(l.details),
  })),
  auditLogs10: auditLogs10.map(l => ({
    id: l.id, createdAt: l.createdAt.toISOString(), details: JSON.parse(l.details),
  })),
}, null, 2), 'utf-8')
console.log(`✅ JSON written: ${jsonPath}`)

console.log('\n=== STEP 2/3 DONE (READ-ONLY VERIFICATION) ===')
console.log(`All stock matches audit log expected values: ${allMatch ? '✅ YES' : '❌ NO — investigate'}`)
console.log(`Negative StockLots: ${totalNegativeLots}`)

await db.$disconnect()
