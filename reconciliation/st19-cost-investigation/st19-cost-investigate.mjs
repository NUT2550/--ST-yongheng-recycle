/**
 * ST-19 Phase 3 — Cost Investigation (READ-ONLY)
 *
 * Goal: Find appropriate cost for products that need stock added, BEFORE applying
 * the correction draft (session cmrgli52j0000oslknzwk9gah)
 *
 * For each of 8 products (excl. ขี้กลึงทองแดง + ทองแดงติดเหล็ก + หม้อน้ำทองแดง):
 *   - Current active-lot average cost
 *   - Current active lot count
 *   - Latest valid BuyBill unit price (excl. cancelled)
 *   - Latest 5 valid BuyBill prices
 *   - Weighted average purchase cost last 30 days
 *   - Weighted average purchase cost last 90 days
 *   - Historical StockLot cost (most recent)
 *   - Cost from records BEFORE 09/07 Physical Count apply
 *   - Check for cancellations, adjustments, or zero-cost lots
 *
 * Exclude: canceled bills, reversed operations, test bills, invalid/import duplicates
 *
 * READ-ONLY — no DB writes.
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/st19-cost-investigation'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function round2(x) { return Math.round(x * 100) / 100 }
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ============ 8 products to investigate ============
const PRODUCTS = [
  { name: 'ทองเหลืองหนา', productId: 'prod_mqgp9bspglewfbgukggj7wdy', draftAvgCost: 0, draftDiff: 89.40, group: 'ทองเหลือง' },
  { name: 'ทองเหลืองเนื้อแดง', productId: 'prod_mqgp9bmg24ygg55yytz9jphl', draftAvgCost: 0, draftDiff: 3.08, group: 'ทองเหลือง' },
  { name: 'ทองแดงปอกเงา', productId: 'prod_mqgp9aevp2yb18adpkyr3qtr', draftAvgCost: 0, draftDiff: 182.75, group: 'ทองแดง' },
  { name: 'ทองแดงช็อต', productId: 'prod_mqgp9alick357v31bqqrlv43', draftAvgCost: 40, draftDiff: 149.94, group: 'ทองแดง' },
  { name: 'ทองแดงท่อ Candy', productId: 'cmr09vcvi001cl105spng6d2h', draftAvgCost: 0, draftDiff: 0.90, group: 'ทองแดง' },
  { name: 'ทองแดงใหญ่', productId: 'prod_mqgp9arb37xlm6b54b0xa44v', draftAvgCost: 275.86, draftDiff: 67.34, group: 'ทองแดง' },
  { name: 'ทองแดงเล็ก', productId: 'prod_mqgp9axign3hnk45ex03l4aw', draftAvgCost: 383.58, draftDiff: 25.52, group: 'ทองแดง' },
  { name: 'ทองแดงชุบ', productId: 'prod_mqgp9bgavns7vxc8rzrlsn65', draftAvgCost: 0, draftDiff: 2.40, group: 'ทองแดง' },
]

// 09/07 apply timestamp (use to identify "before 09/07 apply" records)
const APPLY_09_TIMESTAMP = new Date('2026-07-11T06:37:35.914Z')

console.log('=== ST-19 PHASE 3: COST INVESTIGATION (READ-ONLY) ===\n')

// ============ Verify DRAFT session status first ============
console.log('=== VERIFY DRAFT STATUS ===')
const session = await db.physicalCountSession.findUnique({
  where: { id: 'cmrgli52j0000oslknzwk9gah' },
  include: { items: { include: { product: { select: { id: true, name: true } } } } },
})
if (!session) {
  console.error(`❌ Session cmrgli52j0000oslknzwk9gah NOT FOUND`)
  process.exit(1)
}
console.log(`Session: ${session.id}`)
console.log(`  status: ${session.status} ${session.status === 'DRAFT' ? '✅' : '❌ NOT DRAFT'}`)
console.log(`  countDate: ${session.countDate.toISOString()}`)
console.log(`  items: ${session.items.length}`)
console.log(`  appliedAt: ${session.appliedAt ?? 'null (not applied)'} ✅`)
console.log(`  appliedById: ${session.appliedById ?? 'null'} ✅`)

if (session.status !== 'DRAFT') {
  console.error(`❌ ABORT — session is not DRAFT`)
  process.exit(1)
}

// Get draft items for comparison
const draftItems = new Map()
for (const item of session.items) {
  draftItems.set(item.productId, item)
}

// ============ STEP 1: Cost sources per product ============
console.log('\n\n=== STEP 1: COST SOURCES PER PRODUCT ===\n')

const costProfiles = []

for (const p of PRODUCTS) {
  console.log(`\n========== ${p.name} (id=${p.productId}) ==========`)

  const profile = {
    productName: p.name,
    productId: p.productId,
    group: p.group,
    draftAvgCost: p.draftAvgCost,
    draftDiff: p.draftDiff,
    draftValueDiff: round2(p.draftDiff * p.draftAvgCost),
    // Sources (filled below)
    currentActiveLotCount: 0,
    currentActiveLotAvgCost: 0,
    currentTotalStock: 0,
    latestBuyBillUnitPrice: null,
    latest5BuyBillPrices: [],
    weightedAvg30d: null,
    weightedAvg90d: null,
    historicalStockLotCostLatest: null,
    pre09JulStockLotCost: null,
    pre09JulStockWeight: null,
    pre09JulStockValue: null,
    hasZeroCostLots: false,
    hasCancelledBills: false,
    hasStockAdjustmentLots: false,
    hasHistoricalValidBills: false,
    // Recommendation (filled below)
    recommendedCost: null,
    costSource: null,
    reason: null,
    confidence: null,
    alternatives: [],
  }

  // ---- 1. Current active lots (remainingWeight > 0) ----
  console.log(`\n  [1] Current active StockLots (remainingWeight > 0):`)
  const activeLots = await db.stockLot.findMany({
    where: { productId: p.productId, remainingWeight: { gt: 0 } },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true },
    orderBy: { dateAdded: 'desc' },
  })
  profile.currentActiveLotCount = activeLots.length
  if (activeLots.length > 0) {
    const totalWeight = activeLots.reduce((s, l) => s + l.remainingWeight, 0)
    const totalCost = activeLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
    const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
    profile.currentActiveLotAvgCost = round2(avgCost)
    profile.currentTotalStock = round2(totalWeight)
    console.log(`     activeLots=${activeLots.length}, totalWeight=${round2(totalWeight)}, avgCost=${round2(avgCost)}`)
    for (const lot of activeLots.slice(0, 5)) {
      console.log(`       - lot.id=${lot.id}, remaining=${lot.remainingWeight}, costPerKg=${lot.costPerKg}, dateAdded=${lot.dateAdded.toISOString().split('T')[0]}, source=${lot.source}, sourceId=${lot.sourceId ?? '—'}`)
    }
  } else {
    console.log(`     no active lots (all depleted)`)
  }

  // ---- 2. ALL lots for this product (including depleted) — check for zero-cost + adjustments ----
  const allLots = await db.stockLot.findMany({
    where: { productId: p.productId },
    select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true, createdAt: true },
    orderBy: { dateAdded: 'desc' },
  })
  console.log(`\n  [2] All StockLots (incl. depleted): ${allLots.length}`)
  const zeroCostLots = allLots.filter(l => l.costPerKg === 0)
  const adjustmentLots = allLots.filter(l => l.source === 'STOCK_ADJUSTMENT')
  profile.hasZeroCostLots = zeroCostLots.length > 0
  profile.hasStockAdjustmentLots = adjustmentLots.length > 0
  console.log(`     zero-cost lots: ${zeroCostLots.length}`)
  console.log(`     STOCK_ADJUSTMENT lots: ${adjustmentLots.length}`)

  // Latest historical lot cost (regardless of remaining)
  if (allLots.length > 0) {
    profile.historicalStockLotCostLatest = allLots[0].costPerKg
    console.log(`     latest historical lot costPerKg: ${allLots[0].costPerKg} (lot added ${allLots[0].dateAdded.toISOString().split('T')[0]})`)
  }

  // ---- 3. Latest valid BuyBill prices (excl. cancelled) ----
  console.log(`\n  [3] BuyBill history (excl. cancelled):`)
  const buyItems = await db.buyBillItem.findMany({
    where: { productId: p.productId, buyBill: { isCancelled: false } },
    include: { buyBill: { select: { id: true, billNumber: true, externalBillNumber: true, date: true, isCancelled: true, createdAt: true } } },
    orderBy: { buyBill: { date: 'desc' } },
  })

  // Check if any cancelled bills exist (for flagging)
  const cancelledBuyItems = await db.buyBillItem.findMany({
    where: { productId: p.productId, buyBill: { isCancelled: true } },
    include: { buyBill: { select: { id: true, billNumber: true, externalBillNumber: true, date: true, isCancelled: true, cancelReason: true } } },
  })
  profile.hasCancelledBills = cancelledBuyItems.length > 0
  console.log(`     total valid buy records: ${buyItems.length}, cancelled records: ${cancelledBuyItems.length}`)
  if (cancelledBuyItems.length > 0) {
    console.log(`     ⚠️ Cancelled bills exist:`)
    for (const c of cancelledBuyItems.slice(0, 3)) {
      console.log(`        - ${c.buyBill.billNumber ?? c.buyBill.externalBillNumber ?? c.buyBill.id} | weight=${c.weight} | pricePerKg=${c.pricePerKg} | reason=${c.buyBill.cancelReason ?? '—'}`)
    }
  }
  profile.hasHistoricalValidBills = buyItems.length > 0

  if (buyItems.length > 0) {
    profile.latestBuyBillUnitPrice = buyItems[0].pricePerKg
    console.log(`     LATEST buy price: ${buyItems[0].pricePerKg} THB/kg (date: ${buyItems[0].buyBill.date.toISOString().split('T')[0]}, bill: ${buyItems[0].buyBill.billNumber ?? buyItems[0].buyBill.externalBillNumber ?? '—'})`)
    console.log(`     LATEST 5 buy prices:`)
    profile.latest5BuyBillPrices = buyItems.slice(0, 5).map(it => ({
      date: it.buyBill.date.toISOString().split('T')[0],
      billNumber: it.buyBill.billNumber ?? it.buyBill.externalBillNumber ?? '—',
      weight: it.weight,
      pricePerKg: it.pricePerKg,
    }))
    for (const it of profile.latest5BuyBillPrices) {
      console.log(`       - [${it.date}] ${it.billNumber} | weight=${it.weight} | pricePerKg=${it.pricePerKg}`)
    }

    // Weighted avg last 30 days
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const items30 = buyItems.filter(it => it.buyBill.date >= thirtyDaysAgo)
    if (items30.length > 0) {
      const totalW = items30.reduce((s, it) => s + it.weight, 0)
      const totalV = items30.reduce((s, it) => s + it.weight * it.pricePerKg, 0)
      profile.weightedAvg30d = round2(totalV / totalW)
      console.log(`     Weighted avg last 30d: ${profile.weightedAvg30d} THB/kg (across ${items30.length} bills, total ${round2(totalW)} kg)`)
    } else {
      console.log(`     No buy records in last 30 days`)
    }

    // Weighted avg last 90 days
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
    const items90 = buyItems.filter(it => it.buyBill.date >= ninetyDaysAgo)
    if (items90.length > 0) {
      const totalW = items90.reduce((s, it) => s + it.weight, 0)
      const totalV = items90.reduce((s, it) => s + it.weight * it.pricePerKg, 0)
      profile.weightedAvg90d = round2(totalV / totalW)
      console.log(`     Weighted avg last 90d: ${profile.weightedAvg90d} THB/kg (across ${items90.length} bills, total ${round2(totalW)} kg)`)
    } else {
      console.log(`     No buy records in last 90 days`)
    }
  } else {
    console.log(`     ❌ NO valid buy history for this product`)
  }

  // ---- 4. Pre-09/07 apply stock state ----
  // Reconstruct: what was the stock + cost BEFORE the 09/07 apply happened?
  // Approach: sum all StockLot entries created BEFORE APPLY_09_TIMESTAMP with their costPerKg (regardless of remaining)
  // Caveat: this overestimates because some lots may have been partially consumed by FIFO before that time
  // Better approach: take audit log "before" values for items in 09/07 session
  console.log(`\n  [4] Pre-09/07 apply state (from audit log):`)
  const auditLogs09 = await db.auditLog.findMany({
    where: { entityId: 'cmrdqgfru0000sn8fdmtjjnla', entityType: 'PHYSICAL_COUNT' },
    orderBy: { createdAt: 'asc' },
  })
  // Get the first audit log (which has the "before" state from the original stock)
  if (auditLogs09.length > 0) {
    const firstAudit = JSON.parse(auditLogs09[0].details)
    if (Array.isArray(firstAudit.adjustments)) {
      const adj = firstAudit.adjustments.find(a => a.productId === p.productId)
      if (adj) {
        console.log(`     09/07 audit log: before=${adj.before}, physical=${adj.physical}, after=${adj.after}, avgCost=${adj.avgCost}`)
        profile.pre09JulStockWeight = adj.before
        profile.pre09JulStockValue = round2(adj.before * adj.avgCost)
        profile.pre09JulStockLotCost = adj.avgCost
      } else {
        console.log(`     product not in 09/07 audit log (was not adjusted — diff was 0)`)
      }
    }
  }

  costProfiles.push(profile)
}

// ============ STEP 2: Anomaly checks ============
console.log('\n\n=== STEP 2: ANOMALY CHECKS ===\n')

// 2.1 ทองแดงช็อต AvgCost=40 — reasonable?
console.log('--- ทองแดงช็อต AvgCost=40.00 ---')
const copperShot = costProfiles.find(p => p.productName === 'ทองแดงช็อต')
console.log(`  Current active lots: ${copperShot.currentActiveLotCount}`)
console.log(`  Current active avgCost: ${copperShot.currentActiveLotAvgCost}`)
console.log(`  Latest buy price: ${copperShot.latestBuyBillUnitPrice ?? 'none'}`)
console.log(`  Weighted avg 30d: ${copperShot.weightedAvg30d ?? 'none'}`)
console.log(`  Weighted avg 90d: ${copperShot.weightedAvg90d ?? 'none'}`)
console.log(`  Latest historical lot cost: ${copperShot.historicalStockLotCostLatest ?? 'none'}`)
console.log(`  Pre-09/07 cost: ${copperShot.pre09JulStockLotCost ?? 'none'}`)

// 2.2 ทองแดงใหญ่ AvgCost=275.86 — what lot?
console.log('\n--- ทองแดงใหญ่ AvgCost=275.86 ---')
const copperBig = costProfiles.find(p => p.productName === 'ทองแดงใหญ่')
console.log(`  Current active lots: ${copperBig.currentActiveLotCount}`)
console.log(`  Current active avgCost: ${copperBig.currentActiveLotAvgCost}`)
console.log(`  Latest buy price: ${copperBig.latestBuyBillUnitPrice ?? 'none'}`)
console.log(`  Weighted avg 30d: ${copperBig.weightedAvg30d ?? 'none'}`)
console.log(`  Weighted avg 90d: ${copperBig.weightedAvg90d ?? 'none'}`)
console.log(`  Latest historical lot cost: ${copperBig.historicalStockLotCostLatest ?? 'none'}`)
console.log(`  Pre-09/07 cost: ${copperBig.pre09JulStockLotCost ?? 'none'}`)
// Show the active lots in detail
const copperBigActiveLots = await db.stockLot.findMany({
  where: { productId: copperBig.productId, remainingWeight: { gt: 0 } },
  select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true },
  orderBy: { dateAdded: 'asc' },
})
console.log(`  Active lots detail:`)
for (const lot of copperBigActiveLots) {
  console.log(`    - lot.id=${lot.id} | remaining=${lot.remainingWeight} | costPerKg=${lot.costPerKg} | dateAdded=${lot.dateAdded.toISOString().split('T')[0]} | source=${lot.source} | sourceId=${lot.sourceId ?? '—'}`)
}

// 2.3 ทองแดงเล็ก AvgCost=383.58 — what lot?
console.log('\n--- ทองแดงเล็ก AvgCost=383.58 ---')
const copperSmall = costProfiles.find(p => p.productName === 'ทองแดงเล็ก')
console.log(`  Current active lots: ${copperSmall.currentActiveLotCount}`)
console.log(`  Current active avgCost: ${copperSmall.currentActiveLotAvgCost}`)
console.log(`  Latest buy price: ${copperSmall.latestBuyBillUnitPrice ?? 'none'}`)
console.log(`  Weighted avg 30d: ${copperSmall.weightedAvg30d ?? 'none'}`)
console.log(`  Weighted avg 90d: ${copperSmall.weightedAvg90d ?? 'none'}`)
console.log(`  Latest historical lot cost: ${copperSmall.historicalStockLotCostLatest ?? 'none'}`)
console.log(`  Pre-09/07 cost: ${copperSmall.pre09JulStockLotCost ?? 'none'}`)
const copperSmallActiveLots = await db.stockLot.findMany({
  where: { productId: copperSmall.productId, remainingWeight: { gt: 0 } },
  select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true, source: true, sourceId: true },
  orderBy: { dateAdded: 'asc' },
})
console.log(`  Active lots detail:`)
for (const lot of copperSmallActiveLots) {
  console.log(`    - lot.id=${lot.id} | remaining=${lot.remainingWeight} | costPerKg=${lot.costPerKg} | dateAdded=${lot.dateAdded.toISOString().split('T')[0]} | source=${lot.source} | sourceId=${lot.sourceId ?? '—'}`)
}

// 2.4 Products with AvgCost=0 — any historical purchases?
console.log('\n--- Products with draft AvgCost=0 — historical buy check ---')
const zeroCostProducts = costProfiles.filter(p => p.draftAvgCost === 0)
for (const p of zeroCostProducts) {
  console.log(`\n  ${p.productName}:`)
  console.log(`    Current active lots: ${p.currentActiveLotCount}`)
  console.log(`    Total buy records (valid): ${p.latest5BuyBillPrices.length > 0 ? 'YES' : 'NO'} — ${p.latest5BuyBillPrices.length} latest shown`)
  console.log(`    Latest buy price: ${p.latestBuyBillUnitPrice ?? '—'}`)
  console.log(`    Weighted avg 30d: ${p.weightedAvg30d ?? '—'}`)
  console.log(`    Weighted avg 90d: ${p.weightedAvg90d ?? '—'}`)
  console.log(`    Latest historical lot cost: ${p.historicalStockLotCostLatest ?? '—'}`)
  console.log(`    Pre-09/07 cost: ${p.pre09JulStockLotCost ?? '—'}`)
  console.log(`    Has zero-cost lots: ${p.hasZeroCostLots ? 'YES ⚠️' : 'no'}`)
  console.log(`    Has STOCK_ADJUSTMENT lots: ${p.hasStockAdjustmentLots ? 'YES' : 'no'}`)
}

// 2.5 Depleted lots usable as reference cost?
console.log('\n--- Depleted lots usable as reference cost ---')
for (const p of costProfiles) {
  const depletedLots = await db.stockLot.findMany({
    where: { productId: p.productId, remainingWeight: 0, costPerKg: { gt: 0 } },
    select: { id: true, costPerKg: true, dateAdded: true, source: true },
    orderBy: { dateAdded: 'desc' },
    take: 3,
  })
  if (depletedLots.length > 0) {
    console.log(`  ${p.productName}: ${depletedLots.length} depleted lots with non-zero cost (top 3):`)
    for (const lot of depletedLots) {
      console.log(`    - lot.id=${lot.id} | costPerKg=${lot.costPerKg} | dateAdded=${lot.dateAdded.toISOString().split('T')[0]} | source=${lot.source}`)
    }
  } else {
    console.log(`  ${p.productName}: no depleted lots with non-zero cost`)
  }
}

// ============ STEP 3: Recommend cost basis ============
console.log('\n\n=== STEP 3: COST BASIS RECOMMENDATIONS ===\n')

for (const p of costProfiles) {
  console.log(`\n--- ${p.productName} ---`)

  // Decision tree:
  // 1. If pre09JulStockLotCost is non-zero and pre09JulStockWeight > 0 → use pre09JulStockLotCost (weighted avg before error)
  //    BUT only for products that were in 09/07 apply (which means their stock was wrongly deducted)
  // 2. Else if currentActiveLotAvgCost > 0 → use currentActiveLotAvgCost
  // 3. Else if weightedAvg30d > 0 → use weightedAvg30d
  // 4. Else if weightedAvg90d > 0 → use weightedAvg90d
  // 5. Else if latestBuyBillUnitPrice > 0 → use latestBuyBillUnitPrice
  // 6. Else if historicalStockLotCostLatest > 0 → use historicalStockLotCostLatest
  // 7. Else → Owner must define cost manually

  let recommended = null, source = null, reason = null, confidence = null, alternatives = []

  // Step 1: pre09JulStockLotCost (audit log "before" avgCost — represents the weighted avg of all lots at the time the error happened)
  if (p.pre09JulStockLotCost && p.pre09JulStockLotCost > 0 && p.pre09JulStockWeight > 0) {
    recommended = p.pre09JulStockLotCost
    source = `09/07 audit log "before" avgCost (was ${p.pre09JulStockWeight} kg @ ${p.pre09JulStockLotCost} THB/kg)`
    reason = `This is the weighted-average cost of the lots that existed BEFORE the 09/07 apply error occurred. Using this restores the cost basis that should have been on the stock we are now correcting.`
    confidence = p.pre09JulStockWeight > 10 ? 'High' : 'Medium'
    if (p.currentActiveLotAvgCost && p.currentActiveLotAvgCost > 0) alternatives.push({ cost: p.currentActiveLotAvgCost, source: 'Current active lot weighted avg' })
    if (p.weightedAvg30d && p.weightedAvg30d > 0) alternatives.push({ cost: p.weightedAvg30d, source: 'Weighted avg purchase last 30 days' })
    if (p.weightedAvg90d && p.weightedAvg90d > 0) alternatives.push({ cost: p.weightedAvg90d, source: 'Weighted avg purchase last 90 days' })
    if (p.latestBuyBillUnitPrice && p.latestBuyBillUnitPrice > 0) alternatives.push({ cost: p.latestBuyBillUnitPrice, source: 'Latest valid purchase price' })
  }
  // Step 2: currentActiveLotAvgCost
  else if (p.currentActiveLotAvgCost && p.currentActiveLotAvgCost > 0) {
    recommended = p.currentActiveLotAvgCost
    source = 'Current active lot weighted avg'
    reason = `Product has ${p.currentActiveLotCount} active lot(s) with non-zero total cost. Use current weighted average as cost basis.`
    confidence = p.currentActiveLotCount >= 3 ? 'High' : 'Medium'
    if (p.weightedAvg30d && p.weightedAvg30d > 0) alternatives.push({ cost: p.weightedAvg30d, source: 'Weighted avg purchase last 30 days' })
    if (p.weightedAvg90d && p.weightedAvg90d > 0) alternatives.push({ cost: p.weightedAvg90d, source: 'Weighted avg purchase last 90 days' })
    if (p.latestBuyBillUnitPrice && p.latestBuyBillUnitPrice > 0) alternatives.push({ cost: p.latestBuyBillUnitPrice, source: 'Latest valid purchase price' })
  }
  // Step 3: weightedAvg30d
  else if (p.weightedAvg30d && p.weightedAvg30d > 0) {
    recommended = p.weightedAvg30d
    source = 'Weighted avg purchase last 30 days'
    reason = `No active lots, but ${p.latest5BuyBillPrices.length} buy records in last 30 days. Use weighted average purchase cost.`
    confidence = 'Medium'
    if (p.weightedAvg90d && p.weightedAvg90d > 0) alternatives.push({ cost: p.weightedAvg90d, source: 'Weighted avg purchase last 90 days' })
    if (p.latestBuyBillUnitPrice && p.latestBuyBillUnitPrice > 0) alternatives.push({ cost: p.latestBuyBillUnitPrice, source: 'Latest valid purchase price' })
  }
  // Step 4: weightedAvg90d
  else if (p.weightedAvg90d && p.weightedAvg90d > 0) {
    recommended = p.weightedAvg90d
    source = 'Weighted avg purchase last 90 days'
    reason = `No active lots and no recent 30-day buys. Use 90-day weighted average.`
    confidence = 'Low'
    if (p.latestBuyBillUnitPrice && p.latestBuyBillUnitPrice > 0) alternatives.push({ cost: p.latestBuyBillUnitPrice, source: 'Latest valid purchase price' })
  }
  // Step 5: latestBuyBillUnitPrice
  else if (p.latestBuyBillUnitPrice && p.latestBuyBillUnitPrice > 0) {
    recommended = p.latestBuyBillUnitPrice
    source = 'Latest valid purchase price'
    reason = `No active lots, no recent weighted averages. Fall back to latest single purchase price.`
    confidence = 'Low'
  }
  // Step 6: historicalStockLotCostLatest
  else if (p.historicalStockLotCostLatest && p.historicalStockLotCostLatest > 0) {
    recommended = p.historicalStockLotCostLatest
    source = 'Latest historical StockLot cost (depleted)'
    reason = `No active lots and no valid buy records. Use most recent depleted lot cost as reference.`
    confidence = 'Low'
  }
  // Step 7: Owner must define
  else {
    recommended = null
    source = 'OWNER_MUST_DEFINE'
    reason = `No valid cost data found in DB. Owner must specify cost manually.`
    confidence = 'N/A'
  }

  p.recommendedCost = recommended
  p.costSource = source
  p.reason = reason
  p.confidence = confidence
  p.alternatives = alternatives

  console.log(`  Recommended: ${recommended ?? '(Owner must define)'} THB/kg`)
  console.log(`  Source: ${source}`)
  console.log(`  Confidence: ${confidence}`)
  if (alternatives.length > 0) {
    console.log(`  Alternatives:`)
    for (const alt of alternatives) {
      console.log(`    - ${alt.cost} THB/kg (${alt.source})`)
    }
  }
}

// ============ STEP 4: Revised Preview ============
console.log('\n\n=== STEP 4: REVISED PREVIEW ===\n')

const revisedRows = costProfiles.map(p => {
  const revisedAvgCost = p.recommendedCost ?? 0
  const revisedValueDiff = round2(p.draftDiff * revisedAvgCost)
  const draftValueDiff = round2(p.draftDiff * p.draftAvgCost)
  return {
    productName: p.productName,
    productId: p.productId,
    currentStock: p.currentTotalStock,
    physicalTarget: round2(p.currentTotalStock + p.draftDiff),
    difference: p.draftDiff,
    draftAvgCost: p.draftAvgCost,
    recommendedAvgCost: revisedAvgCost,
    costSource: p.costSource,
    confidence: p.confidence,
    draftValueDiff,
    revisedValueDiff,
    valueDiffDelta: round2(revisedValueDiff - draftValueDiff),
    expectedAfter: round2(p.currentTotalStock + p.draftDiff),
  }
})

console.log('# | Product | Current | Target | Diff | Draft Cost | Rec Cost | Source | Confidence | Draft ValDiff | Revised ValDiff | Delta')
let i = 1
let totalDraftValueDiff = 0
let totalRevisedValueDiff = 0
for (const r of revisedRows) {
  console.log(`${i} | ${r.productName} | ${r.currentStock} | ${r.physicalTarget} | ${r.difference} | ${r.draftAvgCost} | ${r.recommendedAvgCost} | ${r.costSource.substring(0, 50)} | ${r.confidence} | ${r.draftValueDiff} | ${r.revisedValueDiff} | ${r.valueDiffDelta}`)
  totalDraftValueDiff += r.draftValueDiff
  totalRevisedValueDiff += r.revisedValueDiff
  i++
}
console.log(`TOTAL | | | | | | | | | ${round2(totalDraftValueDiff)} | ${round2(totalRevisedValueDiff)} | ${round2(totalRevisedValueDiff - totalDraftValueDiff)}`)

// ============ Write outputs ============
console.log('\n\n=== WRITE OUTPUTS ===')

const jsonPath = path.join(OUTPUT_DIR, 'st19-cost-investigation.json')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  session: {
    id: session.id,
    status: session.status,
    countDate: session.countDate.toISOString(),
    appliedAt: session.appliedAt,
    appliedById: session.appliedById,
  },
  applyTimestamp09Jul: APPLY_09_TIMESTAMP.toISOString(),
  costProfiles,
  revisedPreview: revisedRows,
  totals: {
    totalDraftValueDiff: round2(totalDraftValueDiff),
    totalRevisedValueDiff: round2(totalRevisedValueDiff),
    delta: round2(totalRevisedValueDiff - totalDraftValueDiff),
  },
}, null, 2), 'utf-8')
console.log(`  ✓ st19-cost-investigation.json`)

// CSV
const csvCols = ['#','product_name','product_id','current_stock','physical_target','difference','draft_avg_cost','recommended_avg_cost','cost_source','confidence','draft_value_diff','revised_value_diff','value_diff_delta','expected_after']
const csvRows = [csvCols.join(',')]
let idx = 1
for (const r of revisedRows) {
  csvRows.push([idx++, r.productName, r.productId, r.currentStock, r.physicalTarget, r.difference, r.draftAvgCost, r.recommendedAvgCost ?? '', r.costSource, r.confidence, r.draftValueDiff, r.revisedValueDiff, r.valueDiffDelta, r.expectedAfter].map(csvEscape).join(','))
}
csvRows.push(['TOTAL','','','','','','','','','', round2(totalDraftValueDiff), round2(totalRevisedValueDiff), round2(totalRevisedValueDiff - totalDraftValueDiff), ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'st19-revised-preview.csv'), '\ufeff' + csvRows.join('\n'), 'utf-8')
console.log(`  ✓ st19-revised-preview.csv`)

console.log('\n=== ST-19 PHASE 3 DONE (READ-ONLY) ===')
console.log(`Session still DRAFT: ${session.status === 'DRAFT' ? '✅ YES' : '❌ NO'}`)
console.log(`Draft value difference total: ${round2(totalDraftValueDiff)} THB`)
console.log(`Revised value difference total: ${round2(totalRevisedValueDiff)} THB`)
console.log(`Delta (revised - draft): ${round2(totalRevisedValueDiff - totalDraftValueDiff)} THB`)

await db.$disconnect()
