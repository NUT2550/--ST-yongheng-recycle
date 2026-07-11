/**
 * Physical Count Production — Step 1: Read-only verification
 *
 * Goal: Inspect ALL PhysicalCountSession rows for 08/07, 09/07, 10/07 (CE: 2026-07-08, 2026-07-09, 2026-07-10)
 *   - status (DRAFT / APPLIED)
 *   - session ID, countDate, createdAt, appliedAt, appliedById, reversalOfId
 *   - item count + product names
 *   - related AuditLog entries (PHYSICAL_COUNT)
 *
 * This script writes NO data. Read-only.
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

// ============ Load all sessions ============
console.log('=== STEP 1: READ-ONLY VERIFICATION ===\n')

const allSessions = await db.physicalCountSession.findMany({
  include: {
    items: {
      include: { product: { select: { id: true, name: true } } },
    },
  },
  orderBy: { countDate: 'asc' },
})

console.log(`Total PhysicalCountSession rows: ${allSessions.length}\n`)

// ============ Group by date (CE) ============
const byDate = new Map()
for (const s of allSessions) {
  const ceDate = s.countDate.toISOString().split('T')[0]
  if (!byDate.has(ceDate)) byDate.set(ceDate, [])
  byDate.get(ceDate).push(s)
}

// ============ Find 08/07, 09/07, 10/07 ============
const targetDates = ['2026-07-08', '2026-07-09', '2026-07-10']
const summary = []

for (const dateStr of targetDates) {
  const sessions = byDate.get(dateStr) || []
  console.log(`\n=== Date ${dateStr} (${sessions.length} session(s)) ===`)
  for (const s of sessions) {
    console.log(`  Session ID: ${s.id}`)
    console.log(`    countDate: ${s.countDate.toISOString()}`)
    console.log(`    createdAt: ${s.createdAt.toISOString()}`)
    console.log(`    group: ${s.group}`)
    console.log(`    status: ${s.status}`)
    console.log(`    appliedAt: ${s.appliedAt ? s.appliedAt.toISOString() : '(not applied)'}`)
    console.log(`    appliedById: ${s.appliedById ?? '(not applied)'}`)
    console.log(`    reversalOfId: ${s.reversalOfId ?? '(not a reversal)'}`)
    console.log(`    note: ${s.note ?? ''}`)
    console.log(`    appliedNote: ${s.appliedNote ?? ''}`)
    console.log(`    items: ${s.items.length}`)
    for (const it of s.items) {
      console.log(`      - productId=${it.productId}, product=${it.product.name}, system=${it.systemWeight}, physical=${it.physicalWeight}, diff=${it.differenceWeight}, avgCost=${it.averageCost}, valueDiff=${it.valueDifference}`)
    }
    summary.push({
      date: dateStr,
      sessionId: s.id,
      countDate: s.countDate.toISOString(),
      createdAt: s.createdAt.toISOString(),
      group: s.group,
      status: s.status,
      appliedAt: s.appliedAt ? s.appliedAt.toISOString() : '',
      appliedById: s.appliedById ?? '',
      reversalOfId: s.reversalOfId ?? '',
      itemCount: s.items.length,
      items: s.items.map(it => ({
        itemId: it.id,
        productId: it.productId,
        productName: it.product.name,
        systemWeight: it.systemWeight,
        physicalWeight: it.physicalWeight,
        differenceWeight: it.differenceWeight,
        averageCost: it.averageCost,
        valueDifference: it.valueDifference,
      })),
    })
  }
}

// ============ Also list OTHER dates (for context — not used) ============
console.log('\n=== ALL OTHER SESSIONS (for context) ===')
for (const [dateStr, sessions] of byDate.entries()) {
  if (targetDates.includes(dateStr)) continue
  for (const s of sessions) {
    console.log(`  ${dateStr} | ${s.id} | status=${s.status} | group=${s.group} | items=${s.items.length}`)
    summary.push({
      date: dateStr,
      sessionId: s.id,
      countDate: s.countDate.toISOString(),
      createdAt: s.createdAt.toISOString(),
      group: s.group,
      status: s.status,
      appliedAt: s.appliedAt ? s.appliedAt.toISOString() : '',
      appliedById: s.appliedById ?? '',
      reversalOfId: s.reversalOfId ?? '',
      itemCount: s.items.length,
      items: s.items.map(it => ({
        itemId: it.id,
        productId: it.productId,
        productName: it.product.name,
        systemWeight: it.systemWeight,
        physicalWeight: it.physicalWeight,
        differenceWeight: it.differenceWeight,
        averageCost: it.averageCost,
        valueDifference: it.valueDifference,
      })),
    })
  }
}

// ============ AuditLog: all PHYSICAL_COUNT entries ============
console.log('\n=== ALL PHYSICAL_COUNT AuditLog entries ===')
const auditLogs = await db.auditLog.findMany({
  where: { entityType: 'PHYSICAL_COUNT' },
  orderBy: { createdAt: 'asc' },
})
console.log(`Total PHYSICAL_COUNT audit logs: ${auditLogs.length}`)
for (const log of auditLogs) {
  console.log(`  ${log.createdAt.toISOString()} | action=${log.action} | entityId=${log.entityId} | userId=${log.userId ?? ''} | userName=${log.userName ?? ''}`)
  if (log.details) {
    try {
      const d = JSON.parse(log.details)
      console.log(`    type=${d.type ?? ''}, sessionId=${d.sessionId ?? ''}, countDate=${d.countDate ?? ''}, group=${d.group ?? ''}`)
      if (Array.isArray(d.adjustments)) {
        console.log(`    adjustments (${d.adjustments.length}):`)
        for (const a of d.adjustments) {
          console.log(`      - ${a.productName}: before=${a.before}, physical=${a.physical}, diff=${a.difference}, after=${a.after}, avgCost=${a.avgCost}`)
        }
      }
    } catch {
      console.log(`    details(raw): ${log.details.substring(0, 200)}`)
    }
  }
}

// ============ Find all products named "ทองแดงช็อต" (for 10/07) ============
console.log('\n=== PRODUCTS NAMED "ทองแดงช็อต" ===')
const copperShotProducts = await db.product.findMany({
  where: { name: { contains: 'ทองแดงช็อต' } },
  include: { stockLots: { select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true } } },
})
console.log(`Found ${copperShotProducts.length} matching product(s):`)
for (const p of copperShotProducts) {
  const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)
  const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
  const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
  console.log(`  id=${p.id}, name="${p.name}", activeLots=${p.stockLots.filter(l => l.remainingWeight > 0).length}, totalWeight=${round2(totalWeight)}, avgCost=${round2(avgCost)}`)
}

// Exact match
const exactMatch = copperShotProducts.filter(p => p.name === 'ทองแดงช็อต')
console.log(`\nExact match (name === "ทองแดงช็อต"): ${exactMatch.length}`)
for (const p of exactMatch) {
  console.log(`  id=${p.id}, name="${p.name}"`)
}

// ============ Summary safety snapshot (read-only) ============
console.log('\n=== SAFETY SNAPSHOT (read-only) ===')
const totalStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
const negativeLots = await db.stockLot.count({ where: { remainingWeight: { lt: 0 } } })
const stockLotCount = await db.stockLot.count()
const buyBillCount = await db.buyBill.count()
const sellBillCount = await db.sellBill.count()
const sortingBillCount = await db.sortingBill.count()
const stockTransferCount = await db.stockTransfer.count()
const productCount = await db.product.count()

console.log(`Total stock weight: ${round2(totalStockAgg._sum.remainingWeight ?? 0)} kg`)
console.log(`StockLot count: ${stockLotCount}`)
console.log(`Negative StockLots: ${negativeLots}`)
console.log(`BuyBill count: ${buyBillCount}`)
console.log(`SellBill count: ${sellBillCount}`)
console.log(`SortingBill count: ${sortingBillCount}`)
console.log(`StockTransfer count: ${stockTransferCount}`)
console.log(`Product count: ${productCount}`)

// ============ Write JSON dump ============
const dumpPath = path.join(OUTPUT_DIR, 'step1-sessions-verify.json')
fs.writeFileSync(dumpPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  totalSessions: allSessions.length,
  totalAuditLogs: auditLogs.length,
  copperShotProducts: copperShotProducts.map(p => ({
    id: p.id,
    name: p.name,
    categoryId: p.categoryId,
    activeLots: p.stockLots.filter(l => l.remainingWeight > 0).length,
    totalWeight: round2(p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)),
    avgCost: round2(p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0) / Math.max(1, p.stockLots.reduce((s, l) => s + l.remainingWeight, 0))),
  })),
  safetySnapshot: {
    totalStockWeight: round2(totalStockAgg._sum.remainingWeight ?? 0),
    stockLotCount,
    negativeLots,
    buyBillCount,
    sellBillCount,
    sortingBillCount,
    stockTransferCount,
    productCount,
  },
  sessions: summary,
  auditLogs: auditLogs.map(log => ({
    id: log.id,
    createdAt: log.createdAt.toISOString(),
    action: log.action,
    entityId: log.entityId,
    userId: log.userId,
    userName: log.userName,
    details: log.details ? JSON.parse(log.details) : null,
  })),
}, null, 2), 'utf-8')
console.log(`\n✅ JSON dump written: ${dumpPath}`)

// ============ Write CSV summary ============
const csvCols = ['date','session_id','count_date','created_at','group','status','applied_at','applied_by_id','reversal_of_id','item_count','items_summary']
const csvRows = [csvCols.join(',')]
for (const s of summary) {
  const itemsSummary = s.items.map(it => `${it.productName}(${it.physicalWeight}kg)`).join('; ')
  csvRows.push([s.date, s.sessionId, s.countDate, s.createdAt, s.group, s.status, s.appliedAt, s.appliedById, s.reversalOfId, s.itemCount, itemsSummary].map(csvEscape).join(','))
}
const csvPath = path.join(OUTPUT_DIR, 'step1-sessions-verify.csv')
fs.writeFileSync(csvPath, '\ufeff' + csvRows.join('\n'), 'utf-8')
console.log(`✅ CSV summary written: ${csvPath}`)

console.log('\n=== STEP 1 DONE (READ-ONLY) ===')
await db.$disconnect()
