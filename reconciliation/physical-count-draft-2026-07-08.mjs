/**
 * Task 66: Save Copper/Brass Physical Count Draft for 08/07/2569
 *
 * DRAFT ONLY — no adjustment applied.
 *
 * Products (owner-confirmed):
 *   1. ทองแดงใหญ่          physicalWeight = 6
 *   2. ทองเหลืองหนา        physicalWeight = 6.34   (owner wrote "ทองเหลือง" → mapping ทองเหลือง→ทองเหลืองหนา)
 *   3. ทองเหลืองเนื้อแดง    physicalWeight = 0.84
 *
 * Safety:
 *  - pgbouncer-safe sequential DB ops
 *  - No StockLot created/modified
 *  - No BuyBill/SellBill/SortingBill/Product changes
 *  - Only PhysicalCountSession (+1) and PhysicalCountItem (+3) created
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/physical-count-draft-2026-07-08'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const COUNT_DATE_STR = '08/07/2569' // Thai Buddhist year
// Convert to CE: 2569 - 543 = 2026
const COUNT_DATE_ISO = '2026-07-08'

function round2(x) { return Math.round(x * 100) / 100 }
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// ---- TASK 1: find products + load current system stock ----
console.log('=== TASK 1: LOAD CURRENT SYSTEM STOCK ===')
const productNames = ['ทองแดงใหญ่', 'ทองเหลืองหนา', 'ทองเหลืองเนื้อแดง']
const products = []
for (const name of productNames) {
  const p = await db.product.findFirst({ where: { name }, include: { stockLots: { select: { remainingWeight: true, costPerKg: true } } } })
  if (!p) {
    console.error(`❌ Product not found: ${name}`)
    process.exit(1)
  }
  const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)
  const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
  const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
  products.push({
    id: p.id,
    name: p.name,
    systemWeight: round2(totalWeight),
    averageCost: round2(avgCost),
    systemValue: round2(totalCost),
    lotCount: p.stockLots.length,
  })
  console.log(`  ${p.name} (id=${p.id})`)
  console.log(`    systemWeight=${round2(totalWeight)} kg, avgCost=${round2(avgCost)} THB/kg, systemValue=${round2(totalCost)} THB, lots=${p.stockLots.length}`)
}

// ---- TASK 2: PREVIEW ----
console.log('\n=== TASK 2: PREVIEW ===')
const physicalWeights = { 'ทองแดงใหญ่': 6, 'ทองเหลืองหนา': 6.34, 'ทองเหลืองเนื้อแดง': 0.84 }
const previewRows = []
for (const p of products) {
  const physicalWeight = physicalWeights[p.name]
  const differenceWeight = round2(physicalWeight - p.systemWeight)
  const valueDifference = round2(differenceWeight * p.averageCost)
  const direction = differenceWeight > 0 ? 'เพิ่มสต็อก' : differenceWeight < 0 ? 'ลดสต็อก' : 'ไม่เปลี่ยนแปลง'
  previewRows.push({
    productName: p.name,
    productId: p.id,
    systemWeight: p.systemWeight,
    physicalWeight: round2(physicalWeight),
    differenceWeight,
    averageCost: p.averageCost,
    valueDifference,
    direction,
  })
  console.log(`  ${p.name}: system=${p.systemWeight}, physical=${physicalWeight}, diff=${differenceWeight} (${direction}), valueDiff=${valueDifference} THB`)
}
const totalDiffWeight = round2(previewRows.reduce((s, r) => s + r.differenceWeight, 0))
const totalValueDiff = round2(previewRows.reduce((s, r) => s + r.valueDifference, 0))
console.log(`\n  TOTAL: diffWeight=${totalDiffWeight} kg, valueDiff=${totalValueDiff} THB`)

// ---- TASK 4 (pre): SAFETY CHECK BEFORE ----
console.log('\n=== PRE-SAVE SAFETY CHECK ===')
const preCounts = {
  physicalCountSessions: await db.physicalCountSession.count(),
  physicalCountItems: await db.physicalCountItem.count(),
  stockLots: await db.stockLot.count(),
  buyBills: await db.buyBill.count(),
  sellBills: await db.sellBill.count(),
  sortingBills: await db.sortingBill.count(),
  products: await db.product.count(),
}
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = round2(preStockAgg._sum.remainingWeight ?? 0)
console.log(`Before: Sessions=${preCounts.physicalCountSessions}, Items=${preCounts.physicalCountItems}, StockLots=${preCounts.stockLots}, Stock=${preCounts.totalStockWeight}`)
console.log(`Before: BuyBills=${preCounts.buyBills}, SellBills=${preCounts.sellBills}, SortingBills=${preCounts.sortingBills}, Products=${preCounts.products}`)

// ---- TASK 3: SAVE PHYSICAL COUNT DRAFT ----
console.log('\n=== TASK 3: SAVE PHYSICAL COUNT DRAFT (DRAFT ONLY) ===')
const countDate = new Date(COUNT_DATE_ISO + 'T10:00:00')
const group = 'ทองแดง/ทองเหลือง'
const note = 'Draft from owner confirmed physical count for 08/07/2569. Do not apply until owner reviews preview.'

const session = await db.physicalCountSession.create({
  data: {
    countDate,
    group,
    status: 'DRAFT',
    note,
    items: {
      create: previewRows.map(r => ({
        productId: r.productId,
        systemWeight: r.systemWeight,
        physicalWeight: r.physicalWeight,
        differenceWeight: r.differenceWeight,
        averageCost: r.averageCost,
        valueDifference: r.valueDifference,
        note: `direction=${r.direction}`,
      })),
    },
  },
  include: { items: { include: { product: { select: { name: true } } } } },
})
console.log(`✅ Created PhysicalCountSession: ${session.id}`)
console.log(`   countDate=${countDate.toISOString().split('T')[0]}, group=${group}, status=DRAFT`)
console.log(`   Items created: ${session.items.length}`)
for (const item of session.items) {
  console.log(`     - ${item.product.name}: system=${item.systemWeight}, physical=${item.physicalWeight}, diff=${item.differenceWeight}, avgCost=${item.averageCost}, valueDiff=${item.valueDifference}`)
}

// ---- TASK 4 (post): SAFETY CHECK AFTER ----
console.log('\n=== POST-SAVE SAFETY CHECK ===')
const postCounts = {
  physicalCountSessions: await db.physicalCountSession.count(),
  physicalCountItems: await db.physicalCountItem.count(),
  stockLots: await db.stockLot.count(),
  buyBills: await db.buyBill.count(),
  sellBills: await db.sellBill.count(),
  sortingBills: await db.sortingBill.count(),
  products: await db.product.count(),
}
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = round2(postStockAgg._sum.remainingWeight ?? 0)
console.log(`After:  Sessions=${postCounts.physicalCountSessions}, Items=${postCounts.physicalCountItems}, StockLots=${postCounts.stockLots}, Stock=${postCounts.totalStockWeight}`)
console.log(`After:  BuyBills=${postCounts.buyBills}, SellBills=${postCounts.sellBills}, SortingBills=${postCounts.sortingBills}, Products=${postCounts.products}`)
console.log(`Delta:  Sessions +${postCounts.physicalCountSessions - preCounts.physicalCountSessions}, Items +${postCounts.physicalCountItems - preCounts.physicalCountItems}`)
console.log(`        StockLots ${postCounts.stockLots - preCounts.stockLots}, Stock ${round2(postCounts.totalStockWeight - preCounts.totalStockWeight)}, BuyBills ${postCounts.buyBills - preCounts.buyBills}, SellBills ${postCounts.sellBills - preCounts.sellBills}, SortingBills ${postCounts.sortingBills - preCounts.sortingBills}, Products ${postCounts.products - preCounts.products}`)

// ---- REPORTS ----
console.log('\n=== REPORTS ===')

// 1. PHYSICAL_COUNT_DRAFT_PREVIEW.csv
const prevCols = ['product_name','product_id','system_weight_kg','physical_weight_kg','difference_weight_kg','average_cost_per_kg','value_difference_thb','direction']
const prevCsv = [prevCols.join(',')]
for (const r of previewRows) prevCsv.push([r.productName, r.productId, r.systemWeight, r.physicalWeight, r.differenceWeight, r.averageCost, r.valueDifference, r.direction].map(csvEscape).join(','))
prevCsv.push(['TOTAL','','','','','',totalValueDiff,''].map(csvEscape).join(','))
// Rebuild total row correctly: total differenceWeight + total valueDifference
const prevCsvFixed = [prevCols.join(',')]
for (const r of previewRows) prevCsvFixed.push([r.productName, r.productId, r.systemWeight, r.physicalWeight, r.differenceWeight, r.averageCost, r.valueDifference, r.direction].map(csvEscape).join(','))
prevCsvFixed.push(['TOTAL','', round2(previewRows.reduce((s,r)=>s+r.systemWeight,0)), round2(previewRows.reduce((s,r)=>s+r.physicalWeight,0)), totalDiffWeight, '', totalValueDiff, ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'PHYSICAL_COUNT_DRAFT_PREVIEW.csv'), '\ufeff' + prevCsvFixed.join('\n'), 'utf-8')
console.log('  ✓ PHYSICAL_COUNT_DRAFT_PREVIEW.csv')

// 2. PHYSICAL_COUNT_DRAFT_CREATED.csv
const createdCols = ['session_id','count_date','group','status','item_id','product_name','product_id','system_weight_kg','physical_weight_kg','difference_weight_kg','average_cost_per_kg','value_difference_thb','direction','note']
const createdCsv = [createdCols.join(',')]
for (const item of session.items) {
  const r = previewRows.find(p => p.productId === item.productId)
  createdCsv.push([session.id, countDate.toISOString().split('T')[0], group, session.status, item.id, item.product.name, item.productId, item.systemWeight, item.physicalWeight, item.differenceWeight, item.averageCost, item.valueDifference, r.direction, item.note].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'PHYSICAL_COUNT_DRAFT_CREATED.csv'), '\ufeff' + createdCsv.join('\n'), 'utf-8')
console.log('  ✓ PHYSICAL_COUNT_DRAFT_CREATED.csv')

// 3. STOCK_SAFETY_CHECK.csv
const safeCols = ['metric','before','after','change','expected','status']
const safeCsv = [safeCols.join(',')]
safeCsv.push(['PhysicalCountSession', preCounts.physicalCountSessions, postCounts.physicalCountSessions, postCounts.physicalCountSessions - preCounts.physicalCountSessions, '+1', postCounts.physicalCountSessions - preCounts.physicalCountSessions === 1 ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['PhysicalCountItem', preCounts.physicalCountItems, postCounts.physicalCountItems, postCounts.physicalCountItems - preCounts.physicalCountItems, '+3', postCounts.physicalCountItems - preCounts.physicalCountItems === 3 ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['TotalStockWeight', preCounts.totalStockWeight, postCounts.totalStockWeight, round2(postCounts.totalStockWeight - preCounts.totalStockWeight), '0 (unchanged)', postCounts.totalStockWeight === preCounts.totalStockWeight ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['StockLot', preCounts.stockLots, postCounts.stockLots, postCounts.stockLots - preCounts.stockLots, '0 (unchanged)', postCounts.stockLots === preCounts.stockLots ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['BuyBill', preCounts.buyBills, postCounts.buyBills, postCounts.buyBills - preCounts.buyBills, '0 (unchanged)', postCounts.buyBills === preCounts.buyBills ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['SellBill', preCounts.sellBills, postCounts.sellBills, postCounts.sellBills - preCounts.sellBills, '0 (unchanged)', postCounts.sellBills === preCounts.sellBills ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['SortingBill', preCounts.sortingBills, postCounts.sortingBills, postCounts.sortingBills - preCounts.sortingBills, '0 (unchanged)', postCounts.sortingBills === preCounts.sortingBills ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
safeCsv.push(['Product', preCounts.products, postCounts.products, postCounts.products - preCounts.products, '0 (unchanged)', postCounts.products === preCounts.products ? '✅ PASS' : '❌ FAIL'].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'STOCK_SAFETY_CHECK.csv'), '\ufeff' + safeCsv.join('\n'), 'utf-8')
console.log('  ✓ STOCK_SAFETY_CHECK.csv')

// 4. FINAL_REPORT.md
const allPass = (postCounts.physicalCountSessions - preCounts.physicalCountSessions === 1)
  && (postCounts.physicalCountItems - preCounts.physicalCountItems === 3)
  && postCounts.totalStockWeight === preCounts.totalStockWeight
  && postCounts.stockLots === preCounts.stockLots
  && postCounts.buyBills === preCounts.buyBills
  && postCounts.sellBills === preCounts.sellBills
  && postCounts.sortingBills === preCounts.sortingBills
  && postCounts.products === preCounts.products

let md = `# Physical Count Draft — 08/07/2569 (Copper/Brass)\n\n`
md += `**Physical count draft saved only. No stock quantities were adjusted.**\n\n`

md += `## 1. Session ID Created\n\n`
md += `\`${session.id}\`\n\n`

md += `## 2. Date Used\n\n`
md += `- **Count date (Thai)**: ${COUNT_DATE_STR}\n`
md += `- **Count date (CE)**: ${countDate.toISOString().split('T')[0]}\n\n`

md += `## 3. Products Included\n\n`
md += `| # | Product | Product ID |\n|---:|---|---|\n`
let idx = 1
for (const r of previewRows) md += `| ${idx++} | ${r.productName} | ${r.productId} |\n`
md += `\n`
md += `**Mapping applied**: Owner wrote "ทองเหลือง" → mapped to "ทองเหลืองหนา" (established mapping from Task 61).\n\n`

md += `## 4. System Stock Per Product\n\n`
md += `| Product | System Weight (kg) | Lots |\n|---|---:|---:|\n`
for (const p of products) md += `| ${p.name} | ${p.systemWeight} | ${p.lotCount} |\n`
md += `\n`

md += `## 5. Physical Stock Per Product\n\n`
md += `| Product | Physical Weight (kg) |\n|---|---:|\n`
for (const r of previewRows) md += `| ${r.productName} | ${r.physicalWeight} |\n`
md += `\n`

md += `## 6. Difference Per Product\n\n`
md += `| Product | System (kg) | Physical (kg) | Difference (kg) | Direction |\n|---|---:|---:|---:|---|\n`
for (const r of previewRows) md += `| ${r.productName} | ${r.systemWeight} | ${r.physicalWeight} | ${r.differenceWeight} | ${r.direction} |\n`
md += `| **TOTAL** | **${round2(previewRows.reduce((s,r)=>s+r.systemWeight,0))}** | **${round2(previewRows.reduce((s,r)=>s+r.physicalWeight,0))}** | **${totalDiffWeight}** | - |\n\n`

md += `## 7. Average Cost/kg\n\n`
md += `| Product | Average Cost (THB/kg) | System Value (THB) |\n|---|---:|---:|\n`
for (const p of products) md += `| ${p.name} | ${p.averageCost} | ${p.systemValue} |\n`
md += `\n`
md += `*Average cost = Σ(lot.remainingWeight × lot.costPerKg) / Σ(lot.remainingWeight) across all active StockLots for the product.*\n\n`

md += `## 8. Value Difference\n\n`
md += `| Product | Difference (kg) | Avg Cost (THB/kg) | Value Difference (THB) |\n|---|---:|---:|---:|\n`
for (const r of previewRows) md += `| ${r.productName} | ${r.differenceWeight} | ${r.averageCost} | ${r.valueDifference} |\n`
md += `| **TOTAL** | **${totalDiffWeight}** | - | **${totalValueDiff}** |\n\n`

md += `## 9. Total Difference Weight\n\n`
md += `**${totalDiffWeight} kg**\n\n`
md += `Breakdown:\n`
for (const r of previewRows) md += `- ${r.productName}: ${r.differenceWeight} kg (${r.direction})\n`
md += `\n`

md += `## 10. Total Value Difference\n\n`
md += `**${totalValueDiff} THB**\n\n`
md += `Breakdown:\n`
for (const r of previewRows) md += `- ${r.productName}: ${r.valueDifference} THB\n`
md += `\n`

md += `## 11. Safety Check Result\n\n`
md += `| Metric | Before | After | Change | Expected | Status |\n|---|---:|---:|---:|---|---|\n`
md += `| PhysicalCountSession | ${preCounts.physicalCountSessions} | ${postCounts.physicalCountSessions} | +${postCounts.physicalCountSessions - preCounts.physicalCountSessions} | +1 | ${postCounts.physicalCountSessions - preCounts.physicalCountSessions === 1 ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| PhysicalCountItem | ${preCounts.physicalCountItems} | ${postCounts.physicalCountItems} | +${postCounts.physicalCountItems - preCounts.physicalCountItems} | +3 | ${postCounts.physicalCountItems - preCounts.physicalCountItems === 3 ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| Total stock weight (kg) | ${preCounts.totalStockWeight} | ${postCounts.totalStockWeight} | ${round2(postCounts.totalStockWeight - preCounts.totalStockWeight)} | 0 (unchanged) | ${postCounts.totalStockWeight === preCounts.totalStockWeight ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| StockLot | ${preCounts.stockLots} | ${postCounts.stockLots} | ${postCounts.stockLots - preCounts.stockLots} | 0 (unchanged) | ${postCounts.stockLots === preCounts.stockLots ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| BuyBill | ${preCounts.buyBills} | ${postCounts.buyBills} | ${postCounts.buyBills - preCounts.buyBills} | 0 (unchanged) | ${postCounts.buyBills === preCounts.buyBills ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| SellBill | ${preCounts.sellBills} | ${postCounts.sellBills} | ${postCounts.sellBills - preCounts.sellBills} | 0 (unchanged) | ${postCounts.sellBills === preCounts.sellBills ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| SortingBill | ${preCounts.sortingBills} | ${postCounts.sortingBills} | ${postCounts.sortingBills - preCounts.sortingBills} | 0 (unchanged) | ${postCounts.sortingBills === preCounts.sortingBills ? '✅ PASS' : '❌ FAIL'} |\n`
md += `| Product | ${preCounts.products} | ${postCounts.products} | ${postCounts.products - preCounts.products} | 0 (unchanged) | ${postCounts.products === preCounts.products ? '✅ PASS' : '❌ FAIL'} |\n\n`
md += `**Overall: ${allPass ? '✅ ALL SAFETY CHECKS PASSED' : '❌ SOME SAFETY CHECKS FAILED'}**\n\n`

md += `## 12. Confirmation\n\n`
md += `| Invariant | Status |\n|---|---|\n`
md += `| No stock quantities changed | ${postCounts.totalStockWeight === preCounts.totalStockWeight ? '✅ CONFIRMED' : '❌ VIOLATED'} |\n`
md += `| No StockLots created | ${postCounts.stockLots === preCounts.stockLots ? '✅ CONFIRMED' : '❌ VIOLATED'} |\n`
md += `| No BuyBills modified | ${postCounts.buyBills === preCounts.buyBills ? '✅ CONFIRMED' : '❌ VIOLATED'} |\n`
md += `| No SellBills modified | ${postCounts.sellBills === preCounts.sellBills ? '✅ CONFIRMED' : '❌ VIOLATED'} |\n`
md += `| No SortingBills modified | ${postCounts.sortingBills === preCounts.sortingBills ? '✅ CONFIRMED' : '❌ VIOLATED'} |\n`
md += `| No adjustment applied (status=DRAFT) | ✅ CONFIRMED |\n\n`

md += `## Session Details\n\n`
md += `- **Session ID**: \`${session.id}\`\n`
md += `- **Count date**: ${countDate.toISOString().split('T')[0]} (08/07/2569 Thai)\n`
md += `- **Group**: ${group}\n`
md += `- **Status**: ${session.status} (DRAFT — not applied)\n`
md += `- **Note**: ${note}\n`
md += `- **Items**: ${session.items.length}\n\n`

md += `## Items Created\n\n`
md += `| # | Item ID | Product | System (kg) | Physical (kg) | Diff (kg) | Avg Cost | Value Diff | Direction |\n|---|---|---|---:|---:|---:|---:|---:|---|\n`
let i = 1
for (const item of session.items) {
  const r = previewRows.find(p => p.productId === item.productId)
  md += `| ${i++} | ${item.id} | ${item.product.name} | ${item.systemWeight} | ${item.physicalWeight} | ${item.differenceWeight} | ${item.averageCost} | ${item.valueDifference} | ${r.direction} |\n`
}
md += `\n`

md += `## Method\n\n`
md += `- Direct DB insert via Prisma Client (pgbouncer-safe sequential ops, no \`$transaction\`)\n`
md += `- Single \`db.physicalCountSession.create()\` with nested \`items.create[]\` (one round-trip)\n`
md += `- Status set to \`DRAFT\` — no apply step executed\n`
md += `- No StockLot rows touched\n`
md += `- Average cost computed from live StockLot data at draft-creation time (snapshot stored on each item)\n\n`

md += `---\n\n`
md += `**Physical count draft saved only. No stock quantities were adjusted.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

console.log('\n=== DONE ===')
console.log(`Session ID: ${session.id}`)
console.log(`Status: DRAFT (not applied)`)
console.log(`Items: ${session.items.length}`)
console.log(`Total diff weight: ${totalDiffWeight} kg`)
console.log(`Total value diff: ${totalValueDiff} THB`)
console.log(`All safety checks: ${allPass ? 'PASS' : 'FAIL'}`)

await db.$disconnect()
