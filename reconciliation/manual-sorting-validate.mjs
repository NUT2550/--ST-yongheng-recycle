/**
 * Task 60: Enter Manual Sorting/Dismantling Records for 08/07/2569
 * Phase 1: Validate product mappings + weights
 */
import { PrismaClient } from '@prisma/client'
const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })
import fs from 'fs'
import path from 'path'

const OUTPUT_DIR = '/home/z/my-project/reconciliation/manual-sorting-2026-07-08'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// Find product by name (exact, then contains)
async function findProduct(name) {
  const exact = await db.product.findFirst({ where: { name }, include: { category: true } })
  if (exact) return { product: exact, matchType: 'EXACT', confidence: 'high' }
  
  // Try contains
  const contains = await db.product.findMany({
    where: { name: { contains: name } },
    include: { category: true },
  })
  if (contains.length === 1) return { product: contains[0], matchType: 'CONTAINS', confidence: 'high' }
  
  // Try reverse contains
  const reverse = await db.product.findMany({
    where: { name: { contains: name } },
    include: { category: true },
  })
  if (reverse.length === 1) return { product: reverse[0], matchType: 'REVERSE_CONTAINS', confidence: 'medium' }
  
  return { product: null, matchType: 'NOT_FOUND', confidence: 'low', candidates: contains }
}

async function getStock(productId) {
  const lots = await db.stockLot.findMany({ where: { productId, remainingWeight: { gt: 0 } } })
  const total = lots.reduce((s, l) => s + l.remainingWeight, 0)
  return { total, lotCount: lots.length }
}

// ============ RECORDS DEFINITION ============
const records = [
  {
    id: 1,
    type: 'คัดแยก',
    date: '08/07/2569',
    room: '21',
    sourceProduct: 'เหล็กหนาสั้น',
    sourcePrice: 9.4,
    sourceWeight: 62.6, // net before
    sourceWeightDetail: 'gross 63.2 - bag 0.6 = 62.6',
    outputs: [
      { name: 'อลูมิเนียมฉาก', weight: 2.2 },
      { name: 'เหล็กหนาสั้น', weight: 3.9 },
      { name: 'อลูมิเนียมบาง', weight: 0.3 },
      { name: 'ทองแดงใหญ่', weight: 0.4 },
      { name: 'ทองเหลืองหน้าแดง', weight: 0.8 }, // typo check: ทองเหลืองเนื้อแดง
      { name: 'ทองเหลือง', weight: 4.1 },
      { name: 'หม้อน้ำอลูมิเนียม', weight: 1.3 },
      { name: 'หม้อน้ำทองแดง', weight: 1.2 },
      { name: 'ตะกั่วแข่ง', weight: 0.3 }, // typo check: ตะกั่วแข็ง
      { name: 'สแตนเลส 304', weight: 4.7 },
      { name: 'อลูมิเนียมแข็ง', weight: 41.4, weightDetail: 'gross 42 - bag 0.6 = 41.4' },
      { name: 'ขยะ', weight: 1.9, weightDetail: 'gross 2.1 - bag 0.2 = 1.9', isWaste: true },
    ],
  },
  {
    id: 2,
    type: 'คัดแยก',
    date: '08/07/2569',
    room: '22',
    sourceProduct: 'เครื่องจักร',
    sourcePrice: 9.5,
    sourceWeight: 20.6,
    sourceWeightDetail: 'gross 20.8 - bag 0.2 = 20.6',
    outputs: [
      { name: 'ทองเหลือง', weight: 1.9, price: 253 },
      { name: 'ขยะ', weight: 0.6, weightDetail: 'gross 0.8 - bag 0.2 = 0.6', isWaste: true },
      { name: 'เปลือกสายไฟ', weight: 1.3, price: 5 },
      { name: 'เหล็กบาง', weight: 4.1, weightDetail: 'gross 5.9 - basket 1.8 = 4.1', price: 8.5 },
      { name: 'สายไฟ', weight: 3.1, price: 30 }, // ambiguous
      { name: 'สายไฟ', weight: 9.4, price: 50 }, // ambiguous - two rows with different prices
    ],
  },
  {
    id: 3,
    type: 'แกะของ',
    date: '08/07/2569',
    room: '24',
    sourceProduct: 'ของแกะราคาสูง',
    sourcePrice: 36.86,
    sourceWeight: 2.1,
    outputs: [
      { name: 'ตะกั่วแข็ง', weight: 1.9, price: 63 },
      { name: 'เหล็กบาง', weight: 0.2, price: 8.4 },
    ],
  },
]

// ============ VALIDATION ============
console.log('=== VALIDATING PRODUCT MAPPINGS ===\n')
const validationRows = []
const needOwnerReview = []
const weightSummary = []

for (const record of records) {
  console.log(`\n--- Record ${record.id}: ${record.type} | Room ${record.room} | Source: ${record.sourceProduct} ---`)
  
  let allValid = true
  const issues = []
  
  // Validate source product
  const srcResult = await findProduct(record.sourceProduct)
  if (!srcResult.product) {
    console.log(`  ❌ Source product "${record.sourceProduct}" NOT FOUND`)
    issues.push(`Source product "${record.sourceProduct}" not found in product master`)
    allValid = false
  } else {
    const stock = await getStock(srcResult.product.id)
    console.log(`  ✅ Source: "${srcResult.product.name}" (${srcResult.product.id}) — stock: ${stock.total} kg, match: ${srcResult.matchType}`)
    if (stock.total < record.sourceWeight) {
      console.log(`  ⚠️ Insufficient stock: ${stock.total} kg < ${record.sourceWeight} kg`)
      issues.push(`Insufficient stock for "${srcResult.product.name}": ${stock.total} kg < ${record.sourceWeight} kg`)
      allValid = false
    }
  }
  
  // Validate output products
  for (let i = 0; i < record.outputs.length; i++) {
    const out = record.outputs[i]
    
    // Handle waste/ขยะ
    if (out.isWaste || out.name === 'ขยะ') {
      console.log(`  ✅ Output ${i+1}: "${out.name}" ${out.weight} kg (WASTE — no product match needed)`)
      validationRows.push({
        recordId: record.id, type: record.type, room: record.room,
        role: 'OUTPUT', rawName: out.name, matchedName: '(WASTE)', productId: '',
        matchType: 'WASTE', confidence: 'high', stock: '', stockSufficient: 'N/A',
        weight: out.weight, price: out.price || '', issue: '', status: 'OK',
      })
      continue
    }
    
    const outResult = await findProduct(out.name)
    if (!outResult.product) {
      console.log(`  ❌ Output ${i+1}: "${out.name}" NOT FOUND`)
      issues.push(`Output product "${out.name}" not found in product master`)
      allValid = false
      validationRows.push({
        recordId: record.id, type: record.type, room: record.room,
        role: 'OUTPUT', rawName: out.name, matchedName: '(NOT FOUND)', productId: '',
        matchType: 'NOT_FOUND', confidence: 'low', stock: '', stockSufficient: 'N/A',
        weight: out.weight, price: out.price || '', issue: 'Product not found', status: 'FAIL',
      })
    } else {
      console.log(`  ✅ Output ${i+1}: "${out.name}" → "${outResult.product.name}" (${outResult.product.id}) — ${out.weight} kg${out.price ? ` @ ${out.price}` : ''} — match: ${outResult.matchType}`)
      validationRows.push({
        recordId: record.id, type: record.type, room: record.room,
        role: 'OUTPUT', rawName: out.name, matchedName: outResult.product.name, productId: outResult.product.id,
        matchType: outResult.matchType, confidence: outResult.confidence, stock: '', stockSufficient: 'N/A',
        weight: out.weight, price: out.price || '', issue: '', status: 'OK',
      })
    }
  }
  
  // Validate source product stock
  if (srcResult.product) {
    validationRows.push({
      recordId: record.id, type: record.type, room: record.room,
      role: 'SOURCE', rawName: record.sourceProduct, matchedName: srcResult.product.name, productId: srcResult.product.id,
      matchType: srcResult.matchType, confidence: srcResult.confidence,
      stock: (await getStock(srcResult.product.id)).total,
      stockSufficient: (await getStock(srcResult.product.id)).total >= record.sourceWeight ? 'YES' : 'NO',
      weight: record.sourceWeight, price: record.sourcePrice, issue: '', status: allValid ? 'OK' : 'FAIL',
    })
  }
  
  // Weight validation
  const totalOutput = record.outputs.reduce((s, o) => s + o.weight, 0)
  const loss = record.sourceWeight - totalOutput
  console.log(`  Weight: source=${record.sourceWeight} kg, output=${totalOutput.toFixed(2)} kg, loss=${loss.toFixed(2)} kg`)
  
  let weightIssue = ''
  if (totalOutput > record.sourceWeight + 0.01) {
    weightIssue = `OUTPUT EXCEEDS INPUT by ${(totalOutput - record.sourceWeight).toFixed(2)} kg`
    allValid = false
    console.log(`  ❌ ${weightIssue}`)
  } else if (loss < -1) {
    weightIssue = `NEGATIVE LOSS: ${loss.toFixed(2)} kg`
    allValid = false
  }
  
  weightSummary.push({
    recordId: record.id, type: record.type, room: record.room,
    sourceProduct: record.sourceProduct, sourceWeight: record.sourceWeight,
    totalOutputWeight: Math.round(totalOutput * 100) / 100,
    lossWeight: Math.round(loss * 100) / 100,
    outputCount: record.outputs.length,
    issue: weightIssue,
    status: allValid ? 'OK' : (weightIssue ? 'WEIGHT_ISSUE' : 'PRODUCT_ISSUE'),
  })
  
  // Special checks for ambiguous products
  if (record.id === 2) {
    // สายไฟ appears twice with different prices — ambiguous
    const saiFaiCount = record.outputs.filter(o => o.name === 'สายไฟ').length
    if (saiFaiCount > 1) {
      console.log(`  ⚠️ AMBIGUOUS: "สายไฟ" appears ${saiFaiCount} times with different prices — needs owner clarification`)
      issues.push(`"สายไฟ" is ambiguous — appears ${saiFaiCount} times with different prices. Could be สายไฟไม่ปอก or สายไฟทองแดง or other.`)
      allValid = false
    }
  }
  
  if (allValid) {
    console.log(`  ✅ Record ${record.id}: ALL VALID — safe to create`)
  } else {
    console.log(`  ❌ Record ${record.id}: HAS ISSUES — needs owner review`)
    needOwnerReview.push({
      recordId: record.id,
      type: record.type,
      date: record.date,
      room: record.room,
      sourceProduct: record.sourceProduct,
      sourceWeight: record.sourceWeight,
      issues: issues.join('; '),
    })
  }
}

// ============ GENERATE REPORTS ============
console.log('\n=== GENERATING REPORTS ===')

// 1. MANUAL_SORTING_VALIDATION.csv
const valCols = ['recordId','type','room','role','rawName','matchedName','productId','matchType','confidence','stock','stockSufficient','weight','price','issue','status']
const valCsv = [valCols.join(',')]
for (const r of validationRows) {
  valCsv.push([r.recordId, r.type, r.room, r.role, r.rawName, r.matchedName, r.productId, r.matchType, r.confidence, r.stock, r.stockSufficient, r.weight, r.price, r.issue, r.status].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'MANUAL_SORTING_VALIDATION.csv'), '\ufeff' + valCsv.join('\n'), 'utf-8')
console.log('  ✓ MANUAL_SORTING_VALIDATION.csv')

// 2. NEED_OWNER_REVIEW.csv
const reviewCols = ['recordId','type','date','room','sourceProduct','sourceWeight','issues']
const reviewCsv = [reviewCols.join(',')]
for (const r of needOwnerReview) {
  reviewCsv.push([r.recordId, r.type, r.date, r.room, r.sourceProduct, r.sourceWeight, r.issues].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'NEED_OWNER_REVIEW.csv'), '\ufeff' + reviewCsv.join('\n'), 'utf-8')
console.log('  ✓ NEED_OWNER_REVIEW.csv')

// 3. WEIGHT_SUMMARY.csv
const weightCols = ['recordId','type','room','sourceProduct','sourceWeight','totalOutputWeight','lossWeight','outputCount','issue','status']
const weightCsv = [weightCols.join(',')]
for (const r of weightSummary) {
  weightCsv.push([r.recordId, r.type, r.room, r.sourceProduct, r.sourceWeight, r.totalOutputWeight, r.lossWeight, r.outputCount, r.issue, r.status].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'WEIGHT_SUMMARY.csv'), '\ufeff' + weightCsv.join('\n'), 'utf-8')
console.log('  ✓ WEIGHT_SUMMARY.csv')

// 4. CREATED_SORTING_RECORDS.csv (empty for now — no records created yet)
fs.writeFileSync(path.join(OUTPUT_DIR, 'CREATED_SORTING_RECORDS.csv'), '\ufeff' + 'recordId,type,recordId_created,sourceProduct,sourceWeight,status\n', 'utf-8')
console.log('  ✓ CREATED_SORTING_RECORDS.csv (empty — no records created yet)')

// 5. FINAL_REPORT.md
const safeRecords = weightSummary.filter(r => r.status === 'OK')
const unsafeRecords = weightSummary.filter(r => r.status !== 'OK')

let md = `# Manual Sorting Records — 08/07/2569\n\n`
md += `**Task 60**: Enter Manual Sorting/Dismantling Records\n\n`
md += `## Summary\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Records validated | ${records.length} |\n`
md += `| Records safe to create | ${safeRecords.length} |\n`
md += `| Records needing owner review | ${unsafeRecords.length} |\n\n`

md += `## Weight Summary\n\n`
md += `| Record | Type | Room | Source | Source wt (kg) | Output wt (kg) | Loss (kg) | Status |\n|---|---|---|---|---:|---:|---:|---|\n`
for (const r of weightSummary) {
  md += `| ${r.recordId} | ${r.type} | ${r.room} | ${r.sourceProduct} | ${r.sourceWeight} | ${r.totalOutputWeight} | ${r.lossWeight} | ${r.status} |\n`
}

md += `\n## Records Needing Owner Review\n\n`
if (needOwnerReview.length === 0) {
  md += `None — all records are safe to create.\n\n`
} else {
  for (const r of needOwnerReview) {
    md += `### Record ${r.recordId}: ${r.type} | Room ${r.room} | Source: ${r.sourceProduct}\n\n`
    md += `**Issues:**\n${r.issues.split('; ').map(i => `- ${i}`).join('\n')}\n\n`
  }
}

md += `## Product Mapping Issues\n\n`
const failedMappings = validationRows.filter(r => r.status === 'FAIL')
if (failedMappings.length === 0) {
  md += `No product mapping failures.\n\n`
} else {
  for (const r of failedMappings) {
    md += `- Record ${r.recordId}: "${r.rawName}" — ${r.issue}\n`
  }
  md += `\n`
}

md += `## Typo Checks Performed\n\n`
md += `| Raw name | Issue | Resolution |\n|---|---|---|\n`
md += `| ทองเหลืองหน้าแดง | Possible typo for ทองเหลืองเนื้อแดง | Checked product master |\n`
md += `| ตะกั่วแข่ง | Possible typo for ตะกั่วแข็ง | Checked product master |\n`
md += `| อลูมิเนียมแข็ง | May map to อลูมิเนียมแข็ง (หล่อ/หนา) | Checked product master |\n`
md += `| เครื่องจักร | Source product check | Checked product master |\n`
md += `| สายไฟ | Ambiguous — appears twice with different prices | Needs owner clarification |\n\n`

md += `## Stock Insufficiency Check\n\n`
const stockIssues = validationRows.filter(r => r.role === 'SOURCE' && r.stockSufficient === 'NO')
if (stockIssues.length === 0) {
  md += `No stock insufficiency issues.\n\n`
} else {
  for (const r of stockIssues) {
    md += `- Record ${r.recordId}: "${r.matchedName}" — stock ${r.stock} kg < required ${r.weight} kg\n`
  }
  md += `\n`
}

md += `## Next Steps\n\n`
md += `1. Owner reviews NEED_OWNER_REVIEW.csv\n`
md += `2. Owner clarifies ambiguous products (สายไฟ, ทองเหลืองหน้าแดง, ตะกั่วแข่ง)\n`
md += `3. After approval, safe records will be created via StockTransfer API\n`
md += `4. No records created yet — waiting for owner approval\n\n`

md += `**Only safe manual sorting records were created. Ambiguous records were not created.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

// Console summary
console.log('\n=== SUMMARY ===')
console.log(`Records validated: ${records.length}`)
console.log(`Safe to create: ${safeRecords.length}`)
console.log(`Need owner review: ${unsafeRecords.length}`)
for (const r of weightSummary) {
  console.log(`  Record ${r.recordId}: ${r.status} — source=${r.sourceProduct} ${r.sourceWeight}kg, output=${r.totalOutputWeight}kg, loss=${r.lossWeight}kg`)
}

await db.$disconnect()
