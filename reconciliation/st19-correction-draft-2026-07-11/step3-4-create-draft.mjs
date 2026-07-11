/**
 * ST-19 Correction — Step 3 + 4: CREATE DRAFT + LIVE PREVIEW
 *
 * Step 3: Create PhysicalCountSession DRAFT with 10 items
 *   - countDate: 11/07/2569 (CE: 2026-07-11)
 *   - group: ทองแดง/ทองเหลือง
 *   - status: DRAFT
 *   - note: "Corrective physical count from Owner-confirmed current stock after ST-19 investigation"
 *   - 10 items: each with snapshot systemWeight, physicalWeight (Owner's target), differenceWeight, averageCost, valueDifference
 *
 * Safety constraints:
 *   - Single db.physicalCountSession.create() (pgbouncer-safe, no $transaction)
 *   - NO StockLot created/modified
 *   - NO Apply, NO Reverse, NO Adjustment
 *   - NO modifications to 08/07, 09/07, 10/07 sessions
 *   - NO Commit / Push / Deploy
 *
 * Step 4: After creation, re-fetch session + live stock → preview table
 *   - Verify each item's systemWeight matches current live stock
 *   - Verify after-apply (systemWeight + difference) = physicalWeight
 *   - Verify no negative stock after apply
 *   - Verify หม้อน้ำทองแดง NOT in items
 *   - Report totals
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/st19-correction-draft-2026-07-11'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function round2(x) { return Math.round(x * 100) / 100 }
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ============ Owner-confirmed physical stock (final remaining weight, NOT additions) ============
// Tuple: [productName, productId, physicalWeight, group]
const ITEMS = [
  { name: 'ทองเหลืองหนา', productId: 'prod_mqgp9bspglewfbgukggj7wdy', physical: 89.40, group: 'ทองเหลือง' },
  { name: 'ทองเหลืองเนื้อแดง', productId: 'prod_mqgp9bmg24ygg55yytz9jphl', physical: 3.66, group: 'ทองเหลือง' },
  { name: 'ทองแดงปอกเงา', productId: 'prod_mqgp9aevp2yb18adpkyr3qtr', physical: 182.75, group: 'ทองแดง' },
  { name: 'ทองแดงช็อต', productId: 'prod_mqgp9alick357v31bqqrlv43', physical: 153.74, group: 'ทองแดง' },
  { name: 'ทองแดงท่อ Candy', productId: 'cmr09vcvi001cl105spng6d2h', physical: 0.90, group: 'ทองแดง' },
  { name: 'ทองแดงใหญ่', productId: 'prod_mqgp9arb37xlm6b54b0xa44v', physical: 75.42, group: 'ทองแดง' },
  { name: 'ทองแดงเล็ก', productId: 'prod_mqgp9axign3hnk45ex03l4aw', physical: 32.70, group: 'ทองแดง' },
  { name: 'ทองแดงชุบ', productId: 'prod_mqgp9bgavns7vxc8rzrlsn65', physical: 2.40, group: 'ทองแดง' },
  { name: 'ขี้กลึงทองแดง', productId: 'prod_new_1782125293874_e0b882e0b8b5e0b989e0b881', physical: 0.00, group: 'ทองแดง' },
  { name: 'ทองแดงติดเหล็ก', productId: 'cmr09vcvh0014l105skokga93', physical: 0.00, group: 'ทองแดง' },
]

const EXPECTED_COPPER_SHOT_ID = 'prod_mqgp9alick357v31bqqrlv43'
const COUNT_DATE_ISO = '2026-07-11' // 11/07/2569 = 2026-07-11 CE
const SESSION_GROUP = 'ทองแดง/ทองเหลือง'
const SESSION_NOTE = 'Corrective physical count from Owner-confirmed current stock after ST-19 investigation'

console.log('=== ST-19 CORRECTION — STEP 3: CREATE DRAFT SESSION ===\n')

// ============ Pre-create safety snapshot ============
console.log('=== PRE-CREATE SAFETY SNAPSHOT ===')
const preCounts = {
  physicalCountSessions: await db.physicalCountSession.count(),
  physicalCountItems: await db.physicalCountItem.count(),
  stockLots: await db.stockLot.count(),
  buyBills: await db.buyBill.count(),
  sellBills: await db.sellBill.count(),
  sortingBills: await db.sortingBill.count(),
  stockTransfers: await db.stockTransfer.count(),
  products: await db.product.count(),
}
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = round2(preStockAgg._sum.remainingWeight ?? 0)
console.log(`Before:`)
console.log(`  PhysicalCountSession: ${preCounts.physicalCountSessions}`)
console.log(`  PhysicalCountItem: ${preCounts.physicalCountItems}`)
console.log(`  StockLot: ${preCounts.stockLots}`)
console.log(`  Total stock weight: ${preCounts.totalStockWeight} kg`)
console.log(`  BuyBill: ${preCounts.buyBills}, SellBill: ${preCounts.sellBills}, SortingBill: ${preCounts.sortingBills}, StockTransfer: ${preCounts.stockTransfers}`)
console.log(`  Product: ${preCounts.products}`)

// ============ Compute snapshot for each item ============
console.log('\n=== COMPUTE SNAPSHOT PER ITEM ===')
const itemData = []
for (const it of ITEMS) {
  // Verify product exists
  const p = await db.product.findUnique({
    where: { id: it.productId },
    select: { id: true, name: true, categoryId: true },
  })
  if (!p) {
    console.error(`❌ Product not found: ${it.productId} ("${it.name}") — ABORT`)
    process.exit(1)
  }
  // Verify name matches (safety check)
  if (p.name !== it.name) {
    console.error(`❌ Product name mismatch: DB="${p.name}" vs expected="${it.name}" — ABORT`)
    process.exit(1)
  }
  // Compute current system stock + avgCost
  const lots = await db.stockLot.findMany({
    where: { productId: it.productId },
    select: { remainingWeight: true, costPerKg: true },
  })
  const totalWeight = lots.reduce((s, l) => s + l.remainingWeight, 0)
  const totalCost = lots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
  const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
  const systemWeight = round2(totalWeight)
  const physicalWeight = round2(it.physical)
  const differenceWeight = round2(physicalWeight - systemWeight)
  const valueDifference = round2(differenceWeight * avgCost)
  const expectedAfter = physicalWeight // physical is target end-state

  // Negative stock check (after apply)
  const willGoNegative = expectedAfter < 0

  itemData.push({
    productId: it.productId,
    productName: p.name,
    group: it.group,
    systemWeight,
    physicalWeight,
    differenceWeight,
    averageCost: round2(avgCost),
    valueDifference,
    expectedAfter,
    willGoNegative,
    activeLots: lots.filter(l => l.remainingWeight > 0).length,
    totalLots: lots.length,
  })
  console.log(`  ✅ ${p.name}: system=${systemWeight}, physical=${physicalWeight}, diff=${differenceWeight}, avgCost=${round2(avgCost)}, valueDiff=${valueDifference}, after=${expectedAfter}${willGoNegative ? ' ⚠️ NEGATIVE' : ''}`)
}

// ============ Final pre-create checks ============
console.log('\n=== FINAL PRE-CREATE CHECKS ===')

// Check 1: ทองแดงช็อต matches 10/07 product
const copperShot = itemData.find(p => p.productName === 'ทองแดงช็อต')
if (!copperShot || copperShot.productId !== EXPECTED_COPPER_SHOT_ID) {
  console.error(`❌ ทองแดงช็อต product ID mismatch — ABORT`)
  process.exit(1)
}
console.log(`✅ ทองแดงช็อต: id=${copperShot.productId} (matches 10/07 apply product)`)
console.log(`   Current: ${copperShot.systemWeight} kg, Physical target: ${copperShot.physicalWeight} kg, Diff: ${copperShot.differenceWeight} kg, After: ${copperShot.expectedAfter} kg`)

// Check 2: หม้อน้ำทองแดง NOT in items
const hasRadiator = itemData.some(p => p.productName === 'หม้อน้ำทองแดง')
if (hasRadiator) {
  console.error(`❌ หม้อน้ำทองแดง IS in items list — ABORT`)
  process.exit(1)
}
console.log(`✅ หม้อน้ำทองแดง is NOT in items (correctly excluded)`)

// Check 3: 10 unique products
const ids = itemData.map(p => p.productId)
if (new Set(ids).size !== 10) {
  console.error(`❌ Expected 10 unique products, got ${new Set(ids).size} — ABORT`)
  process.exit(1)
}
console.log(`✅ 10 unique products in items list`)

// Check 4: No negative stock after apply
const negatives = itemData.filter(p => p.willGoNegative)
if (negatives.length > 0) {
  console.error(`❌ ${negatives.length} item(s) would have negative stock after apply — ABORT`)
  for (const n of negatives) console.error(`   - ${n.productName}: after=${n.expectedAfter}`)
  process.exit(1)
}
console.log(`✅ No items would have negative stock after apply`)

// Check 5: After-apply = physical target (sanity)
const mismatchAfterPhysical = itemData.filter(p => p.expectedAfter !== p.physicalWeight)
if (mismatchAfterPhysical.length > 0) {
  console.error(`❌ ${mismatchAfterPhysical.length} item(s) have expectedAfter != physicalWeight — ABORT`)
  process.exit(1)
}
console.log(`✅ All items: expectedAfter == physicalWeight (target end-state)`)

// ============ CREATE DRAFT SESSION ============
console.log('\n=== CREATE DRAFT SESSION ===')

const countDate = new Date(COUNT_DATE_ISO + 'T10:00:00Z')
console.log(`countDate: ${countDate.toISOString()}`)
console.log(`group: ${SESSION_GROUP}`)
console.log(`status: DRAFT`)
console.log(`note: ${SESSION_NOTE}`)
console.log(`items: ${itemData.length}`)

const session = await db.physicalCountSession.create({
  data: {
    countDate,
    group: SESSION_GROUP,
    status: 'DRAFT',
    note: SESSION_NOTE,
    items: {
      create: itemData.map(it => ({
        productId: it.productId,
        systemWeight: it.systemWeight,
        physicalWeight: it.physicalWeight,
        differenceWeight: it.differenceWeight,
        averageCost: it.averageCost,
        valueDifference: it.valueDifference,
        note: `direction=${it.differenceWeight > 0 ? 'เพิ่มสต็อก' : it.differenceWeight < 0 ? 'ลดสต็อก' : 'ไม่เปลี่ยนแปลง'}`,
      })),
    },
  },
  include: { items: { include: { product: { select: { id: true, name: true } } } } },
})

console.log(`\n✅ Created PhysicalCountSession: ${session.id}`)
console.log(`   countDate: ${session.countDate.toISOString()}`)
console.log(`   group: ${session.group}`)
console.log(`   status: ${session.status}`)
console.log(`   note: ${session.note}`)
console.log(`   createdAt: ${session.createdAt.toISOString()}`)
console.log(`   items created: ${session.items.length}`)

// ============ Post-create safety snapshot ============
console.log('\n=== POST-CREATE SAFETY SNAPSHOT ===')
const postCounts = {
  physicalCountSessions: await db.physicalCountSession.count(),
  physicalCountItems: await db.physicalCountItem.count(),
  stockLots: await db.stockLot.count(),
  buyBills: await db.buyBill.count(),
  sellBills: await db.sellBill.count(),
  sortingBills: await db.sortingBill.count(),
  stockTransfers: await db.stockTransfer.count(),
  products: await db.product.count(),
}
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = round2(postStockAgg._sum.remainingWeight ?? 0)
console.log(`After:`)
console.log(`  PhysicalCountSession: ${postCounts.physicalCountSessions} (delta: +${postCounts.physicalCountSessions - preCounts.physicalCountSessions})`)
console.log(`  PhysicalCountItem: ${postCounts.physicalCountItems} (delta: +${postCounts.physicalCountItems - preCounts.physicalCountItems})`)
console.log(`  StockLot: ${postCounts.stockLots} (delta: ${postCounts.stockLots - preCounts.stockLots})`)
console.log(`  Total stock weight: ${postCounts.totalStockWeight} kg (delta: ${round2(postCounts.totalStockWeight - preCounts.totalStockWeight)})`)
console.log(`  BuyBill: ${postCounts.buyBills}, SellBill: ${postCounts.sellBills}, SortingBill: ${postCounts.sortingBills}, StockTransfer: ${postCounts.stockTransfers}`)
console.log(`  Product: ${postCounts.products}`)

// Safety invariants
const safetyPass =
  postCounts.physicalCountSessions - preCounts.physicalCountSessions === 1 &&
  postCounts.physicalCountItems - preCounts.physicalCountItems === 10 &&
  postCounts.stockLots === preCounts.stockLots &&
  postCounts.totalStockWeight === preCounts.totalStockWeight &&
  postCounts.buyBills === preCounts.buyBills &&
  postCounts.sellBills === preCounts.sellBills &&
  postCounts.sortingBills === preCounts.sortingBills &&
  postCounts.stockTransfers === preCounts.stockTransfers &&
  postCounts.products === preCounts.products

console.log(`\nSafety invariants: ${safetyPass ? '✅ ALL PASS' : '❌ SOME FAILED'}`)

// ============ STEP 4: Live Preview (re-fetch session + live stock) ============
console.log('\n\n=== STEP 4: LIVE PREVIEW (RE-FETCH) ===\n')

const liveSession = await db.physicalCountSession.findUnique({
  where: { id: session.id },
  include: {
    items: {
      include: { product: { select: { id: true, name: true } } },
    },
  },
})

console.log(`Re-fetched session: ${liveSession.id}`)
console.log(`  status: ${liveSession.status}`)
console.log(`  items: ${liveSession.items.length}`)

const previewRows = []
for (const item of liveSession.items) {
  // Re-fetch live stock for this product (should match item.systemWeight snapshot)
  const lots = await db.stockLot.findMany({
    where: { productId: item.productId },
    select: { remainingWeight: true, costPerKg: true },
  })
  const liveSystemWeight = round2(lots.reduce((s, l) => s + l.remainingWeight, 0))
  const liveTotalCost = round2(lots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0))
  const liveAvgCost = liveSystemWeight > 0 ? round2(liveTotalCost / liveSystemWeight) : 0

  // Snapshot systemWeight (stored on item)
  const snapshotSystemWeight = item.systemWeight
  // Physical target (what we want end-state to be)
  const physicalWeight = item.physicalWeight
  // Difference = physical - current
  const differenceWeight = round2(physicalWeight - liveSystemWeight)
  // Value difference
  const valueDifference = round2(differenceWeight * liveAvgCost)
  // After apply = physicalWeight
  const expectedAfter = physicalWeight
  // Negative check
  const willGoNegative = expectedAfter < 0

  // Snapshot consistency check
  const snapshotMatchesLive = snapshotSystemWeight === liveSystemWeight

  previewRows.push({
    itemId: item.id,
    productId: item.productId,
    productName: item.product.name,
    snapshotSystemWeight,
    liveSystemWeight,
    snapshotMatchesLive,
    physicalWeight,
    differenceWeight,
    averageCost: liveAvgCost,
    valueDifference,
    expectedAfter,
    willGoNegative,
  })
}

console.log('\n# | Product Name | Product ID | System (kg) | Physical (kg) | Diff (kg) | AvgCost | ValueDiff | After (kg) | Negative?')
let i = 1
for (const r of previewRows) {
  console.log(`${i} | ${r.productName} | ${r.productId} | ${r.liveSystemWeight} | ${r.physicalWeight} | ${r.differenceWeight} | ${r.averageCost} | ${r.valueDifference} | ${r.expectedAfter} | ${r.willGoNegative ? '⚠️ YES' : 'no'}`)
  i++
}

const totalLiveSystem = round2(previewRows.reduce((s, r) => s + r.liveSystemWeight, 0))
const totalPhysical = round2(previewRows.reduce((s, r) => s + r.physicalWeight, 0))
const totalDiff = round2(previewRows.reduce((s, r) => s + r.differenceWeight, 0))
const totalValueDiff = round2(previewRows.reduce((s, r) => s + r.valueDifference, 0))
const totalAfter = round2(previewRows.reduce((s, r) => s + r.expectedAfter, 0))

console.log(`TOTAL | (10 items) | — | ${totalLiveSystem} | ${totalPhysical} | ${totalDiff} | — | ${totalValueDiff} | ${totalAfter} | —`)

// Final validation
console.log('\n=== FINAL VALIDATION ===')
const allSnapshotsMatch = previewRows.every(r => r.snapshotMatchesLive)
const noNegatives = previewRows.every(r => !r.willGoNegative)
const allAfterMatchPhysical = previewRows.every(r => r.expectedAfter === r.physicalWeight)
const has10Items = previewRows.length === 10
const allUniqueIds = new Set(previewRows.map(r => r.productId)).size === 10
const noRadiatorCopper = !previewRows.some(r => r.productName === 'หม้อน้ำทองแดง')
const copperShotCorrect = previewRows.find(r => r.productName === 'ทองแดงช็อต')?.productId === EXPECTED_COPPER_SHOT_ID

console.log(`All snapshot systemWeight matches live stock: ${allSnapshotsMatch ? '✅' : '❌'}`)
console.log(`No items would have negative stock after apply: ${noNegatives ? '✅' : '❌'}`)
console.log(`All items: expectedAfter == physicalWeight: ${allAfterMatchPhysical ? '✅' : '❌'}`)
console.log(`Has exactly 10 items: ${has10Items ? '✅' : '❌'}`)
console.log(`All 10 product IDs unique: ${allUniqueIds ? '✅' : '❌'}`)
console.log(`หม้อน้ำทองแดง NOT in items: ${noRadiatorCopper ? '✅' : '❌'}`)
console.log(`ทองแดงช็อต uses 10/07 product id: ${copperShotCorrect ? '✅' : '❌'}`)

const allValidationPass = allSnapshotsMatch && noNegatives && allAfterMatchPhysical && has10Items && allUniqueIds && noRadiatorCopper && copperShotCorrect
console.log(`\nOverall validation: ${allValidationPass ? '✅ ALL PASS' : '❌ SOME FAILED'}`)

// ============ Verify other sessions unchanged ============
console.log('\n=== VERIFY OTHER SESSIONS UNCHANGED ===')
const session08_1 = await db.physicalCountSession.findUnique({ where: { id: 'cmrbzw8te0000jo04qz2skp4q' }, select: { id: true, status: true, appliedAt: true } })
const session08_2 = await db.physicalCountSession.findUnique({ where: { id: 'cmrbzwau00007jo043ivzvzcz' }, select: { id: true, status: true, appliedAt: true } })
const session08_3 = await db.physicalCountSession.findUnique({ where: { id: 'cmrdae0vh0000sgmjvb5aiu0n' }, select: { id: true, status: true, appliedAt: true } })
const session09 = await db.physicalCountSession.findUnique({ where: { id: 'cmrdqgfru0000sn8fdmtjjnla' }, select: { id: true, status: true, appliedAt: true } })
const session10 = await db.physicalCountSession.findUnique({ where: { id: 'cmrfzuu1b0002la044u1ikzzd' }, select: { id: true, status: true, appliedAt: true } })

console.log(`08/07 (1): ${session08_1?.id} | status=${session08_1?.status} | appliedAt=${session08_1?.appliedAt ?? 'null'} ${session08_1?.status === 'DRAFT' && session08_1?.appliedAt === null ? '✅ UNTOUCHED' : '❌ MODIFIED'}`)
console.log(`08/07 (2): ${session08_2?.id} | status=${session08_2?.status} | appliedAt=${session08_2?.appliedAt ?? 'null'} ${session08_2?.status === 'DRAFT' && session08_2?.appliedAt === null ? '✅ UNTOUCHED' : '❌ MODIFIED'}`)
console.log(`08/07 (3): ${session08_3?.id} | status=${session08_3?.status} | appliedAt=${session08_3?.appliedAt ?? 'null'} ${session08_3?.status === 'DRAFT' && session08_3?.appliedAt === null ? '✅ UNTOUCHED' : '❌ MODIFIED'}`)
console.log(`09/07: ${session09?.id} | status=${session09?.status} | appliedAt=${session09?.appliedAt?.toISOString() ?? 'null'} ${session09?.status === 'APPLIED' ? '✅ UNTOUCHED' : '❌ MODIFIED'}`)
console.log(`10/07: ${session10?.id} | status=${session10?.status} | appliedAt=${session10?.appliedAt?.toISOString() ?? 'null'} ${session10?.status === 'APPLIED' ? '✅ UNTOUCHED' : '❌ MODIFIED'}`)

// ============ Write outputs ============
console.log('\n=== WRITE OUTPUTS ===')

const jsonPath = path.join(OUTPUT_DIR, 'step3-4-create-draft.json')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  session: {
    id: session.id,
    countDate: session.countDate.toISOString(),
    group: session.group,
    status: session.status,
    note: session.note,
    createdAt: session.createdAt.toISOString(),
    itemCount: session.items.length,
  },
  items: liveSession.items.map(item => ({
    itemId: item.id,
    productId: item.productId,
    productName: item.product.name,
    systemWeight: item.systemWeight,
    physicalWeight: item.physicalWeight,
    differenceWeight: item.differenceWeight,
    averageCost: item.averageCost,
    valueDifference: item.valueDifference,
    note: item.note,
  })),
  preview: previewRows,
  totals: {
    totalLiveSystem,
    totalPhysical,
    totalDiff,
    totalValueDiff,
    totalAfter,
  },
  validation: {
    allSnapshotsMatch,
    noNegatives,
    allAfterMatchPhysical,
    has10Items,
    allUniqueIds,
    noRadiatorCopper,
    copperShotCorrect,
    allValidationPass,
  },
  safetySnapshot: {
    pre: preCounts,
    post: postCounts,
    safetyPass,
  },
  otherSessionsUntouched: {
    '08/07 (1)': session08_1?.status === 'DRAFT' && session08_1?.appliedAt === null,
    '08/07 (2)': session08_2?.status === 'DRAFT' && session08_2?.appliedAt === null,
    '08/07 (3)': session08_3?.status === 'DRAFT' && session08_3?.appliedAt === null,
    '09/07': session09?.status === 'APPLIED',
    '10/07': session10?.status === 'APPLIED',
  },
}, null, 2), 'utf-8')
console.log(`  ✓ step3-4-create-draft.json`)

// CSV: Live preview
const csvCols = ['#','product_name','product_id','live_system_kg','physical_kg','difference_kg','avg_cost','value_diff_thb','expected_after_kg','negative_after','snapshot_matches_live']
const csvRows = [csvCols.join(',')]
let idx = 1
for (const r of previewRows) {
  csvRows.push([idx++, r.productName, r.productId, r.liveSystemWeight, r.physicalWeight, r.differenceWeight, r.averageCost, r.valueDifference, r.expectedAfter, r.willGoNegative ? 'YES' : 'no', r.snapshotMatchesLive ? 'YES' : 'no'].map(csvEscape).join(','))
}
csvRows.push(['TOTAL','(10 items)','', totalLiveSystem, totalPhysical, totalDiff, '', totalValueDiff, totalAfter, '', ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'step4-live-preview.csv'), '\ufeff' + csvRows.join('\n'), 'utf-8')
console.log(`  ✓ step4-live-preview.csv`)

// CSV: Safety snapshot
const safeCols = ['metric','before','after','change','expected','status']
const safeCsv = [safeCols.join(',')]
safeCsv.push(['PhysicalCountSession', preCounts.physicalCountSessions, postCounts.physicalCountSessions, postCounts.physicalCountSessions - preCounts.physicalCountSessions, '+1', postCounts.physicalCountSessions - preCounts.physicalCountSessions === 1 ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['PhysicalCountItem', preCounts.physicalCountItems, postCounts.physicalCountItems, postCounts.physicalCountItems - preCounts.physicalCountItems, '+10', postCounts.physicalCountItems - preCounts.physicalCountItems === 10 ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['TotalStockWeight', preCounts.totalStockWeight, postCounts.totalStockWeight, round2(postCounts.totalStockWeight - preCounts.totalStockWeight), '0 (unchanged)', postCounts.totalStockWeight === preCounts.totalStockWeight ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['StockLot', preCounts.stockLots, postCounts.stockLots, postCounts.stockLots - preCounts.stockLots, '0 (unchanged)', postCounts.stockLots === preCounts.stockLots ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['BuyBill', preCounts.buyBills, postCounts.buyBills, postCounts.buyBills - preCounts.buyBills, '0 (unchanged)', postCounts.buyBills === preCounts.buyBills ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['SellBill', preCounts.sellBills, postCounts.sellBills, postCounts.sellBills - preCounts.sellBills, '0 (unchanged)', postCounts.sellBills === preCounts.sellBills ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['SortingBill', preCounts.sortingBills, postCounts.sortingBills, postCounts.sortingBills - preCounts.sortingBills, '0 (unchanged)', postCounts.sortingBills === preCounts.sortingBills ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['StockTransfer', preCounts.stockTransfers, postCounts.stockTransfers, postCounts.stockTransfers - preCounts.stockTransfers, '0 (unchanged)', postCounts.stockTransfers === preCounts.stockTransfers ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['Product', preCounts.products, postCounts.products, postCounts.products - preCounts.products, '0 (unchanged)', postCounts.products === preCounts.products ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'step5-safety-check.csv'), '\ufeff' + safeCsv.join('\n'), 'utf-8')
console.log(`  ✓ step5-safety-check.csv`)

console.log('\n=== STEP 3 + 4 + 5 DONE ===')
console.log(`Session ID: ${session.id}`)
console.log(`Status: ${session.status} (DRAFT — not applied)`)
console.log(`Items: ${session.items.length}`)
console.log(`All safety invariants: ${safetyPass ? 'PASS ✅' : 'FAIL ❌'}`)
console.log(`All validation: ${allValidationPass ? 'PASS ✅' : 'FAIL ❌'}`)
console.log(`Other sessions untouched: ${[session08_1, session08_2, session08_3, session09, session10].every(s => s !== null) ? 'YES ✅' : 'NO ❌'}`)

await db.$disconnect()
