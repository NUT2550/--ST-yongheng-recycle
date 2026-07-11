/**
 * ST-19 Correction — Step 1 + Step 2 (READ-ONLY VERIFICATION)
 *
 * Step 1: Verify 10 product mappings (read-only, no DB writes)
 *   - Search each active Product by exact name
 *   - Verify single match per name (no ambiguity)
 *   - Confirm "ทองแดงช็อต" matches the product used in 10/07 apply (id=prod_mqgp9alick357v31bqqrlv43)
 *   - Confirm "หม้อน้ำทองแดง" is NOT in the list (must be excluded)
 *   - Get current system stock for each
 *
 * Step 2: Check if a DRAFT session already exists for countDate 11/07/2569
 *   with note containing "Corrective physical count from Owner-confirmed"
 *   - If exists with exact match (10 items, exact weights) → use existing draft, don't recreate
 *   - If exists with mismatch → STOP, report
 *   - If not exists → proceed to Step 3 (separate script)
 *
 * READ-ONLY — no DB writes in this script.
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
const OWNER_PHYSICAL = [
  // ทองเหลือง
  { name: 'ทองเหลืองหนา', physical: 89.40, group: 'ทองเหลือง' },
  { name: 'ทองเหลืองเนื้อแดง', physical: 3.66, group: 'ทองเหลือง' },
  // ทองแดง
  { name: 'ทองแดงปอกเงา', physical: 182.75, group: 'ทองแดง' },
  { name: 'ทองแดงช็อต', physical: 153.74, group: 'ทองแดง' }, // Owner's "ทองแดงปอกช็อต" → map to "ทองแดงช็อต"
  { name: 'ทองแดงท่อ Candy', physical: 0.90, group: 'ทองแดง' },
  { name: 'ทองแดงใหญ่', physical: 75.42, group: 'ทองแดง' },
  { name: 'ทองแดงเล็ก', physical: 32.70, group: 'ทองแดง' },
  { name: 'ทองแดงชุบ', physical: 2.40, group: 'ทองแดง' },
  { name: 'ขี้กลึงทองแดง', physical: 0.00, group: 'ทองแดง' },
  { name: 'ทองแดงติดเหล็ก', physical: 0.00, group: 'ทองแดง' },
]

// 10/07 apply used this product id for "ทองแดงช็อต"
const EXPECTED_COPPER_SHOT_ID = 'prod_mqgp9alick357v31bqqrlv43'

console.log('=== ST-19 CORRECTION — STEP 1 + STEP 2 (READ-ONLY) ===\n')

// ============ STEP 1: Verify product mappings ============
console.log('=== STEP 1: VERIFY PRODUCT MAPPINGS ===\n')

const verifiedProducts = []
const mappingErrors = []

for (const item of OWNER_PHYSICAL) {
  const exact = await db.product.findMany({
    where: { name: item.name },
    include: {
      stockLots: { select: { id: true, remainingWeight: true, costPerKg: true, dateAdded: true } },
      category: { select: { id: true, name: true, type: true } },
    },
  })

  if (exact.length === 0) {
    mappingErrors.push({ item, error: `NOT FOUND: "${item.name}" not in DB` })
    console.log(`❌ NOT FOUND: "${item.name}"`)
    continue
  }

  if (exact.length > 1) {
    mappingErrors.push({ item, error: `AMBIGUOUS: ${exact.length} products with exact name "${item.name}"`, candidates: exact.map(p => ({ id: p.id, name: p.name })) })
    console.log(`❌ AMBIGUOUS: ${exact.length} products with exact name "${item.name}"`)
    for (const p of exact) console.log(`   - id=${p.id}, name="${p.name}"`)
    continue
  }

  const p = exact[0]
  const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0)
  const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0)
  const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0
  const activeLots = p.stockLots.filter(l => l.remainingWeight > 0).length

  const verified = {
    name: p.name,
    productId: p.id,
    categoryId: p.categoryId,
    categoryName: p.category.name,
    categoryType: p.category.type,
    systemWeight: round2(totalWeight),
    averageCost: round2(avgCost),
    systemValue: round2(totalCost),
    lotCount: p.stockLots.length,
    activeLots,
    physicalWeight: item.physical,
    group: item.group,
    differenceWeight: round2(item.physical - totalWeight),
    valueDifference: round2((item.physical - totalWeight) * avgCost),
    expectedAfter: item.physical, // after apply = physical target
  }
  verifiedProducts.push(verified)

  console.log(`✅ ${p.name} (id=${p.id})`)
  console.log(`   category=${p.category.name} (${p.category.type})`)
  console.log(`   system=${verified.systemWeight} kg, avgCost=${verified.averageCost}, lots=${p.stockLots.length} (active ${activeLots})`)
  console.log(`   physical=${item.physical} kg, diff=${verified.differenceWeight} kg, valueDiff=${verified.valueDifference} THB`)
}

// ============ Verify ทองแดงช็อต matches 10/07 product ============
console.log('\n=== VERIFY ทองแดงช็อต matches 10/07 product ===')
const copperShot = verifiedProducts.find(p => p.name === 'ทองแดงช็อต')
if (!copperShot) {
  mappingErrors.push({ error: 'ทองแดงช็อต not in verified list' })
  console.log('❌ ทองแดงช็อต NOT in verified list')
} else if (copperShot.productId !== EXPECTED_COPPER_SHOT_ID) {
  mappingErrors.push({ error: `ทองแดงช็อต id mismatch: got ${copperShot.productId}, expected ${EXPECTED_COPPER_SHOT_ID}` })
  console.log(`❌ ID mismatch: got ${copperShot.productId}, expected ${EXPECTED_COPPER_SHOT_ID}`)
} else {
  console.log(`✅ ทองแดงช็อต id=${copperShot.productId} matches 10/07 apply product`)
  console.log(`   Current system stock: ${copperShot.systemWeight} kg`)
  console.log(`   Physical target: ${copperShot.physicalWeight} kg`)
  console.log(`   Difference: ${copperShot.differenceWeight} kg`)
  console.log(`   Expected after Apply: ${copperShot.expectedAfter} kg`)
}

// ============ Verify หม้อน้ำทองแดง is NOT in the list ============
console.log('\n=== VERIFY หม้อน้ำทองแดง is EXCLUDED ===')
const radiatorCopper = verifiedProducts.find(p => p.name === 'หม้อน้ำทองแดง')
if (radiatorCopper) {
  mappingErrors.push({ error: 'หม้อน้ำทองแดง should NOT be in the verified list' })
  console.log('❌ หม้อน้ำทองแดง IS in the list (must be excluded)')
} else {
  console.log('✅ หม้อน้ำทองแดง is NOT in the list (correctly excluded)')
}

// ============ Verify count = 10, no duplicates ============
console.log('\n=== VERIFY COUNT + UNIQUENESS ===')
console.log(`Total verified: ${verifiedProducts.length}`)
if (verifiedProducts.length !== 10) {
  mappingErrors.push({ error: `Expected 10 products, got ${verifiedProducts.length}` })
  console.log(`❌ Expected 10 products, got ${verifiedProducts.length}`)
} else {
  console.log(`✅ Exactly 10 products verified`)
}

const productIds = verifiedProducts.map(p => p.productId)
const uniqueIds = new Set(productIds)
if (uniqueIds.size !== productIds.length) {
  const dups = productIds.filter((id, i) => productIds.indexOf(id) !== i)
  mappingErrors.push({ error: `Duplicate product IDs: ${dups.join(', ')}` })
  console.log(`❌ Duplicate product IDs: ${dups.join(', ')}`)
} else {
  console.log(`✅ All 10 product IDs are unique`)
}

// ============ Display summary table ============
console.log('\n=== SUMMARY TABLE ===')
console.log('# | Product Name | Product ID | Group | System (kg) | Physical (kg) | Diff (kg) | AvgCost | ValueDiff (THB) | After (kg)')
let i = 1
for (const p of verifiedProducts) {
  console.log(`${i} | ${p.name} | ${p.productId} | ${p.group} | ${p.systemWeight} | ${p.physicalWeight} | ${p.differenceWeight} | ${p.averageCost} | ${p.valueDifference} | ${p.expectedAfter}`)
  i++
}

const totalSystem = round2(verifiedProducts.reduce((s, p) => s + p.systemWeight, 0))
const totalPhysical = round2(verifiedProducts.reduce((s, p) => s + p.physicalWeight, 0))
const totalDiff = round2(verifiedProducts.reduce((s, p) => s + p.differenceWeight, 0))
const totalValueDiff = round2(verifiedProducts.reduce((s, p) => s + p.valueDifference, 0))
console.log(`TOTAL | (10 products) | — | — | ${totalSystem} | ${totalPhysical} | ${totalDiff} | — | ${totalValueDiff} | ${totalPhysical}`)

// ============ STEP 2: Check for existing 11/07 DRAFT session ============
console.log('\n\n=== STEP 2: CHECK EXISTING 11/07/2569 DRAFT SESSION ===\n')

const startDate = new Date('2026-07-11T00:00:00Z')
const endDate = new Date('2026-07-12T00:00:00Z')

const existingSessions = await db.physicalCountSession.findMany({
  where: { countDate: { gte: startDate, lt: endDate } },
  include: {
    items: {
      include: { product: { select: { id: true, name: true } } },
    },
  },
  orderBy: { createdAt: 'asc' },
})

console.log(`Found ${existingSessions.length} existing session(s) with countDate = 11/07/2569`)

let matchingExisting = null
let conflictExisting = null

for (const sess of existingSessions) {
  console.log(`\n  Session: ${sess.id}`)
  console.log(`    status: ${sess.status}`)
  console.log(`    group: ${sess.group}`)
  console.log(`    note: ${sess.note ?? ''}`)
  console.log(`    items: ${sess.items.length}`)
  console.log(`    createdAt: ${sess.createdAt.toISOString()}`)

  // Check if note matches
  const noteMatch = sess.note?.includes('Corrective physical count from Owner-confirmed') ?? false
  console.log(`    note matches "Corrective physical count" pattern: ${noteMatch}`)

  // Check if items match Owner's expected list
  if (sess.items.length === 10) {
    const allMatch = sess.items.every(item => {
      const expected = verifiedProducts.find(p => p.productId === item.productId)
      if (!expected) return false
      return item.physicalWeight === expected.physicalWeight
    })
    if (allMatch && noteMatch) {
      matchingExisting = sess
      console.log(`    ✅ This session EXACTLY matches Owner's expected list — DO NOT recreate`)
    } else if (allMatch) {
      console.log(`    ⚠️ Items match but note doesn't match expected pattern`)
      conflictExisting = sess
    } else {
      console.log(`    ⚠️ Items DO NOT match Owner's expected list`)
      conflictExisting = sess
    }
  } else {
    console.log(`    ⚠️ Item count = ${sess.items.length} (expected 10)`)
    conflictExisting = sess
  }
}

// ============ Final decision ============
console.log('\n=== STEP 2 DECISION ===')
if (mappingErrors.length > 0) {
  console.log(`❌ STOP — mapping errors found (${mappingErrors.length}):`)
  for (const err of mappingErrors) {
    console.log(`   - ${err.error}`)
  }
  console.log(`\n⚠️ DO NOT proceed to Step 3 — Owner must resolve mapping issues first`)
} else if (matchingExisting) {
  console.log(`✅ Existing matching DRAFT found: ${matchingExisting.id}`)
  console.log(`   → Use existing draft, DO NOT recreate`)
  console.log(`   → Skip Step 3, proceed to Step 4 (Live Preview)`)
} else if (conflictExisting) {
  console.log(`⚠️ Existing 11/07 session found but with mismatch:`)
  console.log(`   Session: ${conflictExisting.id}`)
  console.log(`   status: ${conflictExisting.status}`)
  console.log(`\n❌ STOP — Owner must resolve conflict`)
  console.log(`   Per instruction: "หากข้อมูลใดไม่ตรง... ให้หยุดและรายงาน ห้ามเดา"`)
} else {
  console.log(`✅ No existing 11/07 session found`)
  console.log(`✅ All 10 product mappings verified`)
  console.log(`\n→ PROCEED to Step 3: Create new DRAFT session`)
}

// ============ Write outputs ============
console.log('\n=== WRITE OUTPUTS ===')
const jsonPath = path.join(OUTPUT_DIR, 'step1-2-verify-mappings.json')
fs.writeFileSync(jsonPath, JSON.stringify({
  generatedAt: new Date().toISOString(),
  ownerPhysical: OWNER_PHYSICAL,
  verifiedProducts,
  mappingErrors,
  expectedCopperShotId: EXPECTED_COPPER_SHOT_ID,
  copperShotMatch: copperShot ? copperShot.productId === EXPECTED_COPPER_SHOT_ID : false,
  radiatorCopperExcluded: !radiatorCopper,
  totalSystem,
  totalPhysical,
  totalDiff,
  totalValueDiff,
  existingSessions11Jul: existingSessions.map(s => ({
    id: s.id,
    countDate: s.countDate.toISOString(),
    status: s.status,
    group: s.group,
    note: s.note,
    itemCount: s.items.length,
    createdAt: s.createdAt.toISOString(),
    items: s.items.map(it => ({
      productId: it.productId,
      productName: it.product.name,
      systemWeight: it.systemWeight,
      physicalWeight: it.physicalWeight,
      differenceWeight: it.differenceWeight,
      averageCost: it.averageCost,
      valueDifference: it.valueDifference,
    })),
  })),
  matchingExisting: matchingExisting ? matchingExisting.id : null,
  conflictExisting: conflictExisting ? {
    id: conflictExisting.id,
    status: conflictExisting.status,
    itemCount: conflictExisting.items.length,
  } : null,
  decision: mappingErrors.length > 0 ? 'STOP_MAPPING_ERRORS'
    : matchingExisting ? 'USE_EXISTING_DRAFT'
    : conflictExisting ? 'STOP_CONFLICT'
    : 'PROCEED_TO_STEP_3',
}, null, 2), 'utf-8')
console.log(`  ✓ step1-2-verify-mappings.json`)

// CSV
const csvCols = ['#','group','product_name','product_id','category_name','system_weight_kg','physical_weight_kg','difference_weight_kg','average_cost_per_kg','value_difference_thb','expected_after_kg','active_lots','total_lots']
const csvRows = [csvCols.join(',')]
let idx = 1
for (const p of verifiedProducts) {
  csvRows.push([idx++, p.group, p.name, p.productId, p.categoryName, p.systemWeight, p.physicalWeight, p.differenceWeight, p.averageCost, p.valueDifference, p.expectedAfter, p.activeLots, p.lotCount].map(csvEscape).join(','))
}
csvRows.push(['TOTAL','','(10 products)','','', totalSystem, totalPhysical, totalDiff, '', totalValueDiff, totalPhysical, '', ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'step1-2-verify-mappings.csv'), '\ufeff' + csvRows.join('\n'), 'utf-8')
console.log(`  ✓ step1-2-verify-mappings.csv`)

console.log('\n=== STEP 1 + 2 DONE (READ-ONLY) ===')
await db.$disconnect()
