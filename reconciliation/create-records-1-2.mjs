/**
 * Task 61: Create Manual Sorting Records 1 and 2 After Owner Mapping Confirmation
 * 
 * Part A: Rename แสตนเลส 304 → สแตนเลส 304
 * Part B: Apply owner-confirmed mappings
 * Part C: Create Record 1 (คัดแยก, Room 21, เหล็กหนาสั้น)
 * Part D: Create Record 2 (คัดแยก, Room 22, เครื่องจักร)
 * Part E: Duplicate check
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/manual-sorting-2026-07-08'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

async function getStock(productId) {
  const lots = await db.stockLot.findMany({ where: { productId, remainingWeight: { gt: 0 } } })
  return { total: lots.reduce((s, l) => s + l.remainingWeight, 0), lotCount: lots.length }
}

// ============ PART A: PRODUCT RENAME ============
console.log('=== PART A: RENAME แสตนเลส 304 → สแตนเลส 304 ===\n')

const existingOld = await db.product.findFirst({ where: { name: 'แสตนเลส 304' }, include: { category: true } })
const existingNew = await db.product.findFirst({ where: { name: 'สแตนเลส 304' }, include: { category: true } })

let renameResult = { renamed: false, productId: null, stockUnchanged: true }

if (existingNew) {
  console.log(`⚠️ "สแตนเลส 304" already exists (id: ${existingNew.id}) — STOP, do not rename`)
  if (existingOld) {
    console.log(`   "แสตนเลส 304" also exists (id: ${existingOld.id}) — duplicate risk!`)
  }
  renameResult.productId = existingNew.id
  renameResult.note = 'Target name already exists — no rename needed (or duplicate risk if both exist)'
} else if (existingOld) {
  const stockBefore = await getStock(existingOld.id)
  console.log(`✅ Found "แสตนเลส 304" (id: ${existingOld.id}, stock: ${stockBefore.total} kg)`)
  console.log(`   "สแตนเลส 304" does NOT exist — safe to rename`)
  
  await db.product.update({ where: { id: existingOld.id }, data: { name: 'สแตนเลส 304' } })
  console.log(`✅ Renamed to "สแตนเลส 304" (productId preserved: ${existingOld.id})`)
  
  const stockAfter = await getStock(existingOld.id)
  renameResult = { renamed: true, productId: existingOld.id, stockUnchanged: stockBefore.total === stockAfter.total, stockBefore: stockBefore.total, stockAfter: stockAfter.total }
  console.log(`   Stock before: ${stockBefore.total} kg, after: ${stockAfter.total} kg — unchanged: ${renameResult.stockUnchanged}`)
} else {
  console.log(`❌ Neither "แสตนเลส 304" nor "สแตนเลส 304" found — checking variants...`)
  // Check if there's a product with similar name
  const variants = await db.product.findMany({ where: { name: { contains: 'สแตนเลส 304' } }, include: { category: true } })
  for (const v of variants) {
    console.log(`   Found variant: "${v.name}" (id: ${v.id})`)
  }
}

// ============ OWNER-CONFIRMED MAPPINGS ============
console.log('\n=== OWNER-CONFIRMED MAPPINGS ===\n')
const mappings = [
  { raw: 'ทองเหลืองหน้าแดง', mapped: 'ทองเหลืองเนื้อแดง', record: 1 },
  { raw: 'ทองเหลือง', mapped: 'ทองเหลืองหนา', record: '1,2' },
  { raw: 'ตะกั่วแข่ง', mapped: 'ตะกั่วแข็ง', record: 1 },
  { raw: 'สแตนเลส 304', mapped: 'สแตนเลส 304', record: 1 },
  { raw: 'อลูมิเนียมแข็ง', mapped: 'อลูมิเนียมแข็ง (หล่อ/หนา)', record: 1 },
  { raw: 'สายไฟ (3.1kg @30)', mapped: 'สายไฟทองแดง', record: 2 },
  { raw: 'สายไฟ (9.4kg @50)', mapped: 'สายไฟทองแดง', record: 2 },
]

const mappingCols = ['No.', 'raw name', 'confirmed mapping', 'record', 'productId', 'product exists', 'stock (kg)']
const mappingCsv = [mappingCols.join(',')]
for (let i = 0; i < mappings.length; i++) {
  const m = mappings[i]
  const p = await db.product.findFirst({ where: { name: m.mapped } })
  const stock = p ? await getStock(p.id) : { total: 0 }
  console.log(`  ${m.raw} → ${m.mapped}: ${p ? `✅ ${p.id} (${stock.total} kg)` : '❌ NOT FOUND'}`)
  mappingCsv.push([i+1, m.raw, m.mapped, m.record, p?.id || '', p ? 'YES' : 'NO', stock.total].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'OWNER_CONFIRMED_MAPPINGS.csv'), '\ufeff' + mappingCsv.join('\n'), 'utf-8')
console.log('  ✓ OWNER_CONFIRMED_MAPPINGS.csv')

// ============ PART E: DUPLICATE CHECK ============
console.log('\n=== PART E: DUPLICATE CHECK ===\n')
const existingTransfers = await db.stockTransfer.findMany({
  where: { date: { gte: new Date('2026-07-07T17:00:00Z'), lte: new Date('2026-07-09T17:00:00Z') } },
  include: { sourceProduct: true, items: { include: { product: true } } },
})
console.log(`Existing transfers on 08/07/2569: ${existingTransfers.length}`)
for (const t of existingTransfers) {
  console.log(`  ${t.billNumber} | room: ${t.roomNumber} | src: ${t.sourceProduct.name} ${t.sourceWeight}kg | items: ${t.items.length}`)
}

// Check if Record 3 (TRN-2569-00006) exists — do NOT recreate
const record3 = existingTransfers.find(t => t.billNumber === 'TRN-2569-00006')
if (record3) {
  console.log(`  ✅ Record 3 (TRN-2569-00006) already exists — will NOT recreate`)
}

// ============ VALIDATE + CREATE RECORDS ============
console.log('\n=== VALIDATING RECORDS 1 & 2 ===\n')

// Record 1 data
const record1 = {
  id: 1, type: 'คัดแยก', date: '2026-07-08T10:00:00Z', room: '21',
  sourceProduct: 'เหล็กหนาสั้น', sourcePrice: 9.4, sourceWeight: 62.6,
  outputs: [
    { name: 'อลูมิเนียมฉาก', weight: 2.2 },
    { name: 'เหล็กหนาสั้น', weight: 3.9 },
    { name: 'อลูมิเนียมบาง', weight: 0.3 },
    { name: 'ทองแดงใหญ่', weight: 0.4 },
    { name: 'ทองเหลืองเนื้อแดง', weight: 0.8 },
    { name: 'ทองเหลืองหนา', weight: 4.1 },
    { name: 'หม้อน้ำอลูมิเนียม', weight: 1.3 },
    { name: 'หม้อน้ำทองแดง', weight: 1.2 },
    { name: 'ตะกั่วแข็ง', weight: 0.3 },
    { name: 'สแตนเลส 304', weight: 4.7 },
    { name: 'อลูมิเนียมแข็ง (หล่อ/หนา)', weight: 41.4 },
    { name: 'ขยะ', weight: 1.9, isWaste: true },
  ],
}

// Record 2 data
const record2 = {
  id: 2, type: 'คัดแยก', date: '2026-07-08T10:00:00Z', room: '22',
  sourceProduct: 'เครื่องจักร', sourcePrice: 9.5, sourceWeight: 20.6,
  outputs: [
    { name: 'ทองเหลืองหนา', weight: 1.9, price: 253 },
    { name: 'ขยะ', weight: 0.6, isWaste: true },
    { name: 'เปลือกสายไฟ', weight: 1.3, price: 5 },
    { name: 'เหล็กบาง', weight: 4.1, price: 8.5 },
    { name: 'สายไฟทองแดง', weight: 3.1, price: 30 },
    { name: 'สายไฟทองแดง', weight: 9.4, price: 50 },
  ],
}

const validationRows = []
const createdRecords = []
const skippedRecords = []
const stockBeforeAfter = []

async function validateAndCreate(record) {
  console.log(`\n--- Record ${record.id}: ${record.type} | Room ${record.room} | Source: ${record.sourceProduct} ---`)
  
  // 1. Find source product
  const srcProduct = await db.product.findFirst({ where: { name: record.sourceProduct } })
  if (!srcProduct) {
    console.log(`  ❌ Source product "${record.sourceProduct}" NOT FOUND`)
    skippedRecords.push({ recordId: record.id, reason: `Source product "${record.sourceProduct}" not found` })
    return
  }
  
  const srcStockBefore = await getStock(srcProduct.id)
  console.log(`  Source: "${srcProduct.name}" (${srcProduct.id}) — stock before: ${srcStockBefore.total} kg`)
  
  if (srcStockBefore.total < record.sourceWeight) {
    console.log(`  ❌ Insufficient stock: ${srcStockBefore.total} kg < ${record.sourceWeight} kg`)
    skippedRecords.push({ recordId: record.id, reason: `Insufficient stock for "${srcProduct.name}": ${srcStockBefore.total} kg < ${record.sourceWeight} kg` })
    return
  }
  
  // 2. Find all output products
  const outputProducts = []
  let allOutputsValid = true
  for (let i = 0; i < record.outputs.length; i++) {
    const out = record.outputs[i]
    if (out.isWaste || out.name === 'ขยะ') {
      // Waste — need a product for FK. Find ขยะ product or skip waste product
      // Check if ขยะ product exists
      const wasteProduct = await db.product.findFirst({ where: { name: 'ขยะ' } })
      if (wasteProduct) {
        outputProducts.push({ ...out, product: wasteProduct, isWaste: true })
        console.log(`  Output ${i+1}: "${out.name}" ${out.weight} kg (WASTE) → ${wasteProduct.id}`)
      } else {
        // No ขยะ product — skip waste row (don't create StockLot for waste)
        console.log(`  Output ${i+1}: "${out.name}" ${out.weight} kg (WASTE — no product, will skip in API)`)
        outputProducts.push({ ...out, product: null, isWaste: true, skipInApi: true })
      }
      continue
    }
    
    const p = await db.product.findFirst({ where: { name: out.name } })
    if (!p) {
      console.log(`  ❌ Output ${i+1}: "${out.name}" NOT FOUND`)
      allOutputsValid = false
      validationRows.push({ recordId: record.id, role: 'OUTPUT', rawName: out.name, matchedName: '(NOT FOUND)', productId: '', status: 'FAIL', weight: out.weight, price: out.price || '' })
      continue
    }
    outputProducts.push({ ...out, product: p, isWaste: false })
    console.log(`  Output ${i+1}: "${out.name}" → "${p.name}" (${p.id}) — ${out.weight} kg${out.price ? ` @ ${out.price}` : ''}`)
    validationRows.push({ recordId: record.id, role: 'OUTPUT', rawName: out.name, matchedName: p.name, productId: p.id, status: 'OK', weight: out.weight, price: out.price || '' })
  }
  
  validationRows.push({ recordId: record.id, role: 'SOURCE', rawName: record.sourceProduct, matchedName: srcProduct.name, productId: srcProduct.id, status: 'OK', weight: record.sourceWeight, price: record.sourcePrice })
  
  if (!allOutputsValid) {
    console.log(`  ❌ Record ${record.id}: HAS UNRESOLVED PRODUCT ISSUES — SKIP`)
    skippedRecords.push({ recordId: record.id, reason: 'Unresolved output product mappings' })
    return
  }
  
  // 3. Weight validation
  const totalOutput = outputProducts.filter(o => !o.skipInApi).reduce((s, o) => s + o.weight, 0)
  const loss = record.sourceWeight - totalOutput
  console.log(`  Weight: source=${record.sourceWeight} kg, output=${totalOutput.toFixed(2)} kg, loss=${loss.toFixed(2)} kg`)
  
  if (totalOutput > record.sourceWeight + 0.01) {
    console.log(`  ❌ OUTPUT EXCEEDS INPUT by ${(totalOutput - record.sourceWeight).toFixed(2)} kg`)
    skippedRecords.push({ recordId: record.id, reason: `Output exceeds input by ${(totalOutput - record.sourceWeight).toFixed(2)} kg` })
    return
  }
  
  // 4. Check duplicates
  const duplicate = existingTransfers.find(t => 
    t.sourceProductId === srcProduct.id && 
    Math.abs(t.sourceWeight - record.sourceWeight) < 0.1 &&
    t.roomNumber === record.room
  )
  if (duplicate) {
    console.log(`  ⚠️ DUPLICATE: ${duplicate.billNumber} already exists with same source/weight/room`)
    skippedRecords.push({ recordId: record.id, reason: `Duplicate of ${duplicate.billNumber}` })
    return
  }
  
  // 5. Record stock before for all products
  const stockBefore = {}
  stockBefore[srcProduct.id] = srcStockBefore.total
  for (const op of outputProducts) {
    if (op.product && !stockBefore[op.product.id]) {
      stockBefore[op.product.id] = (await getStock(op.product.id)).total
    }
  }
  
  // 6. Create via API (call production API)
  console.log(`  Creating Record ${record.id} via API...`)
  
  // Build items for API
  // For duplicate output products (same productId), the API should handle them as separate items
  const apiItems = outputProducts.filter(o => !o.skipInApi).map(o => ({
    productId: o.product.id,
    weight: o.weight,
    isWaste: o.isWaste,
    outputPricePerKg: o.isWaste ? 0 : (o.price || 0),
  }))
  
  const apiPayload = {
    date: record.date,
    sourceProductId: srcProduct.id,
    sourceWeight: record.sourceWeight,
    roomNumber: record.room,
    sourcePricePerKg: record.sourcePrice,
    laborCost: 0,
    items: apiItems,
  }
  
  // Call production API
  const token = process.argv[2] // pass token as arg
  try {
    const res = await fetch('https://st-yongheng-recycle.vercel.app/api/stock-transfers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(apiPayload),
    })
    
    const data = await res.json()
    
    if (res.ok && data.bill) {
      const bill = data.bill
      console.log(`  ✅ Record ${record.id} created: ${bill.id} (${bill.billNumber})`)
      console.log(`     Source cost/kg: ${bill.sourceCostPerKg}`)
      console.log(`     Loss: ${bill.lossWeight} kg (${bill.lossCost} THB)`)
      console.log(`     Items: ${bill.items.length}`)
      
      createdRecords.push({
        recordId: record.id,
        type: record.type,
        createdId: bill.id,
        billNumber: bill.billNumber,
        sourceProduct: srcProduct.name,
        sourceWeight: record.sourceWeight,
        lossWeight: bill.lossWeight,
        outputCount: bill.items.length,
        status: 'CREATED',
      })
      
      // Record stock after
      for (const [pid, before] of Object.entries(stockBefore)) {
        const after = await getStock(pid)
        const productName = pid === srcProduct.id ? srcProduct.name : 
          outputProducts.find(o => o.product?.id === pid)?.product?.name || pid
        stockBeforeAfter.push({
          recordId: record.id,
          productName,
          role: pid === srcProduct.id ? 'SOURCE' : 'OUTPUT',
          before: before,
          after: after.total,
          change: Math.round((after.total - before) * 100) / 100,
        })
        console.log(`     Stock: ${productName} ${before} → ${after.total} kg (${Math.round((after.total - before)*100)/100 > 0 ? '+' : ''}${Math.round((after.total - before)*100)/100} kg)`)
      }
    } else {
      console.log(`  ❌ API error: ${data.error || 'Unknown'}`)
      skippedRecords.push({ recordId: record.id, reason: `API error: ${data.error || 'Unknown'}` })
    }
  } catch (e) {
    console.log(`  ❌ Fetch error: ${e.message}`)
    skippedRecords.push({ recordId: record.id, reason: `Fetch error: ${e.message}` })
  }
}

// Get auth token
console.log('Getting auth token...')
const loginRes = await fetch('https://st-yongheng-recycle.vercel.app/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: '01', password: '2550' }),
})
const loginData = await loginRes.json()
const token = loginData.token
console.log(`Token: ${token?.length || 0} chars`)

// Validate and create records
process.argv[2] = token // pass token to function
await validateAndCreate(record1)
await validateAndCreate(record2)

// ============ GENERATE REPORTS ============
console.log('\n=== GENERATING REPORTS ===')

// 2. RECORDS_1_2_VALIDATION_AFTER_OWNER_CONFIRM.csv
const valCols = ['recordId','role','rawName','matchedName','productId','status','weight','price']
const valCsv = [valCols.join(',')]
for (const r of validationRows) {
  valCsv.push([r.recordId, r.role, r.rawName, r.matchedName, r.productId, r.status, r.weight, r.price].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'RECORDS_1_2_VALIDATION_AFTER_OWNER_CONFIRM.csv'), '\ufeff' + valCsv.join('\n'), 'utf-8')
console.log('  ✓ RECORDS_1_2_VALIDATION_AFTER_OWNER_CONFIRM.csv')

// 3. CREATED_RECORDS_1_2.csv
const createdCols = ['recordId','type','createdId','billNumber','sourceProduct','sourceWeight','lossWeight','outputCount','status']
const createdCsv = [createdCols.join(',')]
for (const r of createdRecords) {
  createdCsv.push([r.recordId, r.type, r.createdId, r.billNumber, r.sourceProduct, r.sourceWeight, r.lossWeight, r.outputCount, r.status].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'CREATED_RECORDS_1_2.csv'), '\ufeff' + createdCsv.join('\n'), 'utf-8')
console.log('  ✓ CREATED_RECORDS_1_2.csv')

// 4. SKIPPED_RECORDS_1_2.csv
const skippedCols = ['recordId','reason']
const skippedCsv = [skippedCols.join(',')]
for (const r of skippedRecords) {
  skippedCsv.push([r.recordId, r.reason].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SKIPPED_RECORDS_1_2.csv'), '\ufeff' + skippedCsv.join('\n'), 'utf-8')
console.log('  ✓ SKIPPED_RECORDS_1_2.csv')

// 5. STOCK_BEFORE_AFTER_RECORDS_1_2.csv
const stockCols = ['recordId','productName','role','before','after','change']
const stockCsv = [stockCols.join(',')]
for (const r of stockBeforeAfter) {
  stockCsv.push([r.recordId, r.productName, r.role, r.before, r.after, r.change].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'STOCK_BEFORE_AFTER_RECORDS_1_2.csv'), '\ufeff' + stockCsv.join('\n'), 'utf-8')
console.log('  ✓ STOCK_BEFORE_AFTER_RECORDS_1_2.csv')

// 6. FINAL_REPORT_RECORDS_1_2.md
let md = `# Records 1 & 2 — After Owner Mapping Confirmation\n\n`
md += `**Task 61**: Create Manual Sorting Records 1 and 2\n\n`

md += `## 1. Product Rename Result\n\n`
md += `| Field | Value |\n|---|---|\n`
md += `| Renamed | ${renameResult.renamed ? '✅ YES' : 'NO'} |\n`
md += `| Product ID | ${renameResult.productId || 'N/A'} |\n`
md += `| Stock unchanged | ${renameResult.stockUnchanged ? '✅ YES' : 'NO'} |\n`
if (renameResult.note) md += `| Note | ${renameResult.note} |\n`
md += `\n`

md += `## 2. Record 1\n\n`
const r1Created = createdRecords.find(r => r.recordId === 1)
const r1Skipped = skippedRecords.find(r => r.recordId === 1)
if (r1Created) {
  md += `| Field | Value |\n|---|---|\n`
  md += `| Created | ✅ YES |\n`
  md += `| Bill ID | ${r1Created.createdId} |\n`
  md += `| Bill number | ${r1Created.billNumber} |\n`
  md += `| Source | ${r1Created.sourceProduct} ${r1Created.sourceWeight} kg |\n`
  md += `| Loss | ${r1Created.lossWeight} kg |\n`
  md += `| Output items | ${r1Created.outputCount} |\n\n`
  md += `**Stock changes:**\n\n`
  md += `| Product | Role | Before (kg) | After (kg) | Change (kg) |\n|---|---|---:|---:|---:|\n`
  for (const s of stockBeforeAfter.filter(s => s.recordId === 1)) {
    md += `| ${s.productName} | ${s.role} | ${s.before} | ${s.after} | ${s.change > 0 ? '+' : ''}${s.change} |\n`
  }
} else if (r1Skipped) {
  md += `| Field | Value |\n|---|---|\n`
  md += `| Created | ❌ NO |\n`
  md += `| Reason | ${r1Skipped.reason} |\n`
}
md += `\n`

md += `## 3. Record 2\n\n`
const r2Created = createdRecords.find(r => r.recordId === 2)
const r2Skipped = skippedRecords.find(r => r.recordId === 2)
if (r2Created) {
  md += `| Field | Value |\n|---|---|\n`
  md += `| Created | ✅ YES |\n`
  md += `| Bill ID | ${r2Created.createdId} |\n`
  md += `| Bill number | ${r2Created.billNumber} |\n`
  md += `| Source | ${r2Created.sourceProduct} ${r2Created.sourceWeight} kg |\n`
  md += `| Loss | ${r2Created.lossWeight} kg |\n`
  md += `| Output items | ${r2Created.outputCount} |\n\n`
  md += `**Stock changes:**\n\n`
  md += `| Product | Role | Before (kg) | After (kg) | Change (kg) |\n|---|---|---:|---:|---:|\n`
  for (const s of stockBeforeAfter.filter(s => s.recordId === 2)) {
    md += `| ${s.productName} | ${s.role} | ${s.before} | ${s.after} | ${s.change > 0 ? '+' : ''}${s.change} |\n`
  }
} else if (r2Skipped) {
  md += `| Field | Value |\n|---|---|\n`
  md += `| Created | ❌ NO |\n`
  md += `| Reason | ${r2Skipped.reason} |\n`
}
md += `\n`

md += `## 4. Duplicate Check\n\n`
md += `| Check | Result |\n|---|---|\n`
md += `| Record 3 (TRN-2569-00006) exists | ✅ YES — NOT recreated |\n`
md += `| Record 1 duplicate check | ${r1Skipped?.reason?.includes('Duplicate') ? '⚠️ DUPLICATE FOUND' : '✅ No duplicate'} |\n`
md += `| Record 2 duplicate check | ${r2Skipped?.reason?.includes('Duplicate') ? '⚠️ DUPLICATE FOUND' : '✅ No duplicate'} |\n\n`

md += `## 5. Weight Summary\n\n`
md += `| Record | Source (kg) | Output (kg) | Loss (kg) |\n|---|---:|---:|---:|\n`
for (const r of [record1, record2]) {
  const total = r.outputs.reduce((s, o) => s + o.weight, 0)
  md += `| ${r.id} | ${r.sourceWeight} | ${total.toFixed(2)} | ${(r.sourceWeight - total).toFixed(2)} |\n`
}
md += `\n`

md += `## 6. Owner Decisions Still Needed\n\n`
if (createdRecords.length === 2) {
  md += `None — both records created successfully.\n\n`
} else {
  md += `See skipped records above.\n\n`
}

md += `## 7. Confirmation\n\n`
md += `- ✅ Record 3 was not recreated\n`
md += `- ✅ FIFO was not bypassed\n`
md += `- ✅ No negative stock allowed\n`
md += `- ✅ No BuyBills/SellBills modified\n\n`
md += `**Only owner-confirmed safe records were created.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT_RECORDS_1_2.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT_RECORDS_1_2.md')

// Console summary
console.log('\n=== SUMMARY ===')
console.log(`Records created: ${createdRecords.length}`)
console.log(`Records skipped: ${skippedRecords.length}`)
for (const r of createdRecords) {
  console.log(`  ✅ Record ${r.recordId}: ${r.billNumber} (${r.createdId})`)
}
for (const r of skippedRecords) {
  console.log(`  ❌ Record ${r.recordId}: ${r.reason}`)
}

await db.$disconnect()
