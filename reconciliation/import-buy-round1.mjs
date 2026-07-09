/**
 * Task 62: Import Purchase Excel Files Round 1 — 2-4 July 2569
 * 
 * Dry-run + import safe bills only.
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/import-buy-round-1-2026-07-02-to-04'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const FILES = [
  '/home/z/my-project/upload/ซื้อ 2-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 3-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 4-7-2569 แบบละเอียด.xls',
]

function fixThai(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try { return new TextDecoder('windows-874').decode(Buffer.from(s, 'latin1')) } catch { return s }
  }
  return s
}
function normalize(s) {
  if (s == null) return ''
  let t = fixThai(s)
  t = t.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.replace(/แสตนเลส/g, 'สแตนเลส')
  t = t.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
  t = t.normalize('NFC')
  return t
}
function num(s) {
  if (s == null || s === '') return 0
  if (typeof s === 'number') return s
  const n = parseFloat(String(s).replace(/,/g, '').trim())
  return isNaN(n) ? 0 : n
}
function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// Owner-approved safe aliases (from Task 35/43)
const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
}

// Load product master
console.log('Loading product master...')
const allProducts = await db.product.findMany({ include: { category: true }, orderBy: { name: 'asc' } })
const productMap = new Map()
for (const p of allProducts) productMap.set(p.name.trim().normalize('NFC'), p)

function matchProduct(rawName) {
  const normalizedInput = rawName.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
  const trimmed = normalizedInput.trim().normalize('NFC')
  // 1. Exact
  if (productMap.has(trimmed)) return { product: productMap.get(trimmed), matchType: 'EXACT' }
  // 2. Safe alias
  const alias = SAFE_ALIASES[normalizedInput.trim()]?.normalize('NFC')
  if (alias && productMap.has(alias)) return { product: productMap.get(alias), matchType: 'ALIAS' }
  // 3. Contains (single result)
  const contains = allProducts.filter(p => {
    const pn = p.name.normalize('NFC')
    return pn.includes(trimmed) || trimmed.includes(pn)
  })
  if (contains.length === 1) return { product: contains[0], matchType: 'CONTAINS' }
  return { product: null, matchType: 'NOT_FOUND' }
}

// Check existing external bill numbers
console.log('Checking existing external bill numbers...')
const existingBills = await db.buyBill.findMany({ where: { externalBillNumber: { not: null } }, select: { externalBillNumber: true } })
const existingBillNums = new Set(existingBills.map(b => b.externalBillNumber))
console.log(`Existing external bill numbers: ${existingBillNums.size}`)

// ============ PARSE FILES ============
console.log('\n=== PARSING FILES ===')
const allBills = []
const dryRunRows = []
const unmatchedProductsSet = new Map()
const duplicateBillsList = []

for (const FILE of FILES) {
  const fileName = path.basename(FILE)
  console.log(`\n--- ${fileName} ---`)
  
  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
  console.log(`  Total rows: ${rows.length}`)
  
  // Detect format: check row 3
  const row3 = rows[3] || []
  const isFormatA = String(row3[0] || '').includes('ผู้ขาย') && !String(row3[2] || '').includes('ผู้ขาย')
  console.log(`  Format: ${isFormatA ? 'A (per-seller)' : 'B (per-product)'}`)
  
  let currentBill = null
  let currentSeller = ''
  let currentProductName = ''
  const fileBills = []
  
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
    if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
    
    if (isFormatA) {
      // Format A: per-seller
      // Seller: col 0 + col 1, no col 2, col 9 == null
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) {
        currentSeller = fixThai(String(fixed[1]))
        continue
      }
      // Bill header: col 1 = date, col 2 = bill number (A...), col 12 = total
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) {
        if (currentBill) fileBills.push(currentBill)
        currentBill = {
          fileName, externalBillNumber: String(fixed[2]).trim(),
          seller: currentSeller,
          date: fixThai(String(fixed[1])).trim(),
          note: fixed[4] ? fixThai(String(fixed[4])).trim() : '',
          items: [], totalWeight: 0, totalAmount: 0,
          excelTotalAmount: num(fixed[12]),
        }
        continue
      }
      // Item: col 2 = product code, col 3 = product name, col 9 = weight
      if (fixed[2] && fixed[3] && fixed[9] != null && currentBill) {
        const productName = fixThai(String(fixed[3])).trim()
        const weight = num(fixed[9])
        const pricePerKg = num(fixed[11])
        const amount = num(fixed[12])
        const match = matchProduct(productName)
        currentBill.items.push({
          productName, productCode: String(fixed[2]).trim(),
          productId: match.product?.id || null, matchedProductName: match.product?.name || null,
          weight, pricePerKg, amount, matched: !!match.product, matchType: match.matchType,
        })
        currentBill.totalWeight += weight
        currentBill.totalAmount += amount
      }
    } else {
      // Format B: per-product
      // Product summary: col 0 = 4-digit code, col 1 = name, col 9 = weight
      if (fixed[0] && /^\d{4}$/.test(String(fixed[0]).trim()) && fixed[1] && typeof fixed[1] === 'string' && fixed[9] != null) {
        currentProductName = fixThai(String(fixed[1])).trim()
        continue
      }
      // Transaction: col 0 = date, col 1 = bill number, col 9 = weight
      if (fixed[0] && fixed[1] && fixed[9] != null) {
        const dateStr = fixThai(String(fixed[0])).trim()
        const billNo = String(fixed[1]).trim()
        if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
          if (!currentBill || currentBill.externalBillNumber !== billNo) {
            if (currentBill) fileBills.push(currentBill)
            currentBill = {
              fileName, externalBillNumber: billNo,
              seller: String(fixed[3] ?? '').trim() || String(fixed[2] ?? '').trim(),
              date: dateStr,
              note: fixed[6] ? fixThai(String(fixed[6])).trim() : '',
              items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: 0,
            }
          }
          const weight = num(fixed[9])
          const pricePerKg = num(fixed[11])
          const amount = num(fixed[12])
          const productName = currentProductName || '(ไม่ระบุสินค้า)'
          const match = matchProduct(productName)
          currentBill.items.push({
            productName, productCode: String(fixed[0]).trim(),
            productId: match.product?.id || null, matchedProductName: match.product?.name || null,
            weight, pricePerKg, amount, matched: !!match.product, matchType: match.matchType,
          })
          currentBill.totalWeight += weight
          currentBill.totalAmount += amount
        }
      }
    }
  }
  if (currentBill) fileBills.push(currentBill)
  
  console.log(`  Bills found: ${fileBills.length}`)
  
  // Validate each bill
  for (const bill of fileBills) {
    bill.totalWeight = Math.round(bill.totalWeight * 100) / 100
    bill.totalAmount = Math.round(bill.totalAmount * 100) / 100
    bill.amountDiff = Math.round((bill.totalAmount - bill.excelTotalAmount) * 100) / 100
    
    // Check duplicates
    bill.isDuplicate = existingBillNums.has(bill.externalBillNumber)
    if (bill.isDuplicate) {
      duplicateBillsList.push({ fileName: bill.fileName, billNumber: bill.externalBillNumber, reason: 'Already exists in DB' })
    }
    
    // Check unmatched products
    bill.unmatchedItems = bill.items.filter(i => !i.matched)
    if (bill.unmatchedItems.length > 0) {
      for (const item of bill.unmatchedItems) {
        const key = item.productName
        if (!unmatchedProductsSet.has(key)) unmatchedProductsSet.set(key, { name: key, count: 0, files: new Set() })
        unmatchedProductsSet.get(key).count++
        unmatchedProductsSet.get(key).files.add(bill.fileName)
      }
    }
    
    // Determine if safe to import
    bill.safeToImport = !bill.isDuplicate && bill.unmatchedItems.length === 0 && bill.items.length > 0
    
    dryRunRows.push({
      fileName: bill.fileName,
      billNumber: bill.externalBillNumber,
      date: bill.date,
      seller: bill.seller,
      itemCount: bill.items.length,
      totalWeight: bill.totalWeight,
      totalAmount: bill.totalAmount,
      unmatchedCount: bill.unmatchedItems.length,
      isDuplicate: bill.isDuplicate,
      amountDiff: bill.amountDiff,
      safeToImport: bill.safeToImport,
      unmatchedNames: bill.unmatchedItems.map(i => i.productName).join('; '),
    })
    
    if (bill.safeToImport) {
      allBills.push(bill)
    }
  }
}

console.log(`\n=== DRY-RUN SUMMARY ===`)
console.log(`Total bills found: ${dryRunRows.length}`)
console.log(`Safe to import: ${allBills.length}`)
console.log(`Skipped (duplicate): ${dryRunRows.filter(r => r.isDuplicate).length}`)
console.log(`Skipped (unmatched): ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length}`)
console.log(`Unmatched product names: ${unmatchedProductsSet.size}`)

// ============ GENERATE DRY-RUN REPORTS ============
console.log('\n=== GENERATING REPORTS ===')

// 1. DRY_RUN_BUY_ROUND_1.csv
const dryCols = ['file_name','bill_number','date','seller','item_count','total_weight','total_amount','unmatched_count','is_duplicate','amount_diff','safe_to_import','unmatched_names']
const dryCsv = [dryCols.join(',')]
for (const r of dryRunRows) {
  dryCsv.push([r.fileName, r.billNumber, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.unmatchedCount, r.isDuplicate, r.amountDiff, r.safeToImport, r.unmatchedNames].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'DRY_RUN_BUY_ROUND_1.csv'), '\ufeff' + dryCsv.join('\n'), 'utf-8')
console.log('  ✓ DRY_RUN_BUY_ROUND_1.csv')

// 4. UNMATCHED_PRODUCTS_ROUND_1.csv
const unmatchedCols = ['No.','product_name','occurrence_count','files']
const unmatchedCsv = [unmatchedCols.join(',')]
let unmIdx = 1
for (const [name, info] of unmatchedProductsSet) {
  unmatchedCsv.push([unmIdx++, name, info.count, [...info.files].join('; ')].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_PRODUCTS_ROUND_1.csv'), '\ufeff' + unmatchedCsv.join('\n'), 'utf-8')
console.log('  ✓ UNMATCHED_PRODUCTS_ROUND_1.csv')

// 5. DUPLICATE_BILLS_ROUND_1.csv
const dupCols = ['file_name','bill_number','reason']
const dupCsv = [dupCols.join(',')]
for (const d of duplicateBillsList) {
  dupCsv.push([d.fileName, d.billNumber, d.reason].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'DUPLICATE_BILLS_ROUND_1.csv'), '\ufeff' + dupCsv.join('\n'), 'utf-8')
console.log('  ✓ DUPLICATE_BILLS_ROUND_1.csv')

// ============ IMPORT SAFE BILLS ============
console.log('\n=== IMPORTING SAFE BILLS ===')

// Record stock before
const preCounts = {
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
}
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0
console.log(`Before: BuyBills=${preCounts.buyBills}, StockLots=${preCounts.stockLots}, TotalStock=${preCounts.totalStockWeight} kg`)

const importedBills = []
const skippedBills = []

// Get auth token for API
const loginRes = await fetch('https://st-yongheng-recycle.vercel.app/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: '01', password: '2550' }),
})
const loginData = await loginRes.json()
const token = loginData.token

for (const bill of allBills) {
  console.log(`\n  Importing ${bill.externalBillNumber} (${bill.date}, ${bill.seller}, ${bill.items.length} items)...`)
  
  // Parse Thai date (dd/mm/yyyy Buddhist)
  const parts = bill.date.split('/')
  let ceYear = parseInt(parts[2])
  if (ceYear > 2400) ceYear -= 543
  const isoDate = new Date(ceYear, parseInt(parts[1]) - 1, parseInt(parts[0]), 10, 0, 0).toISOString()
  
  const payload = {
    externalBillNumber: bill.externalBillNumber,
    date: isoDate,
    isCredit: false,
    note: `ผู้ขาย: ${bill.seller}${bill.note ? ` | ${bill.note}` : ''} | นำเข้าจาก: ${bill.fileName}`,
    items: bill.items.filter(i => i.matched).map(i => ({
      productId: i.productId,
      productName: i.matchedProductName,
      weight: i.weight,
      pricePerKg: i.pricePerKg,
      totalAmount: i.amount,
    })),
  }
  
  try {
    const res = await fetch('https://st-yongheng-recycle.vercel.app/api/buy-bills', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    
    const data = await res.json()
    
    if (res.ok && (data.bill || data.id)) {
      const created = data.bill || data
      console.log(`    ✅ Created: ${created.id} (${created.billNumber || 'N/A'})`)
      importedBills.push({
        fileName: bill.fileName,
        externalBillNumber: bill.externalBillNumber,
        billNumber: created.billNumber || '',
        billId: created.id,
        date: bill.date,
        seller: bill.seller,
        itemCount: bill.items.length,
        totalWeight: bill.totalWeight,
        totalAmount: bill.totalAmount,
        status: 'IMPORTED',
      })
    } else {
      console.log(`    ❌ Error: ${data.error || 'Unknown'}`)
      skippedBills.push({
        fileName: bill.fileName,
        externalBillNumber: bill.externalBillNumber,
        reason: `API error: ${data.error || 'Unknown'}`,
        status: 'API_ERROR',
      })
    }
  } catch (e) {
    console.log(`    ❌ Fetch error: ${e.message}`)
    skippedBills.push({
      fileName: bill.fileName,
      externalBillNumber: bill.externalBillNumber,
      reason: `Fetch error: ${e.message}`,
      status: 'FETCH_ERROR',
    })
  }
}

// Record stock after
const postCounts = {
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
}
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0
console.log(`\nAfter: BuyBills=${postCounts.buyBills}, StockLots=${postCounts.stockLots}, TotalStock=${postCounts.totalStockWeight} kg`)
console.log(`Delta: BuyBills +${postCounts.buyBills - preCounts.buyBills}, StockLots +${postCounts.stockLots - preCounts.stockLots}, Stock +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg`)

// ============ GENERATE FINAL REPORTS ============
console.log('\n=== GENERATING FINAL REPORTS ===')

// 2. IMPORTED_BUY_BILLS_ROUND_1.csv
const impCols = ['file_name','external_bill_number','bill_number','bill_id','date','seller','item_count','total_weight','total_amount','status']
const impCsv = [impCols.join(',')]
for (const r of importedBills) {
  impCsv.push([r.fileName, r.externalBillNumber, r.billNumber, r.billId, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.status].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'IMPORTED_BUY_BILLS_ROUND_1.csv'), '\ufeff' + impCsv.join('\n'), 'utf-8')
console.log('  ✓ IMPORTED_BUY_BILLS_ROUND_1.csv')

// 3. SKIPPED_BUY_BILLS_ROUND_1.csv
const skipCols = ['file_name','external_bill_number','reason','status']
const skipCsv = [skipCols.join(',')]
for (const r of dryRunRows.filter(r => !r.safeToImport)) {
  let reason = []
  if (r.isDuplicate) reason.push('Duplicate bill number')
  if (r.unmatchedCount > 0) reason.push(`${r.unmatchedCount} unmatched products: ${r.unmatchedNames}`)
  skipCsv.push([r.fileName, r.billNumber, reason.join('; '), r.isDuplicate ? 'DUPLICATE' : 'UNMATCHED'].map(csvEscape).join(','))
}
for (const r of skippedBills) {
  skipCsv.push([r.fileName, r.externalBillNumber, r.reason, r.status].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SKIPPED_BUY_BILLS_ROUND_1.csv'), '\ufeff' + skipCsv.join('\n'), 'utf-8')
console.log('  ✓ SKIPPED_BUY_BILLS_ROUND_1.csv')

// 6. FINAL_REPORT.md
let md = `# Purchase Import Round 1 — 2-4 July 2569\n\n`
md += `**Task 62**: Import Purchase Excel Files Round 1\n\n`
md += `## Summary\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Files parsed | ${FILES.length} |\n`
md += `| Bills found | ${dryRunRows.length} |\n`
md += `| Bills imported | ${importedBills.length} |\n`
md += `| Bills skipped | ${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length} |\n`
md += `| Stock lots created | ${postCounts.stockLots - preCounts.stockLots} |\n`
md += `| Stock weight before | ${preCounts.totalStockWeight} kg |\n`
md += `| Stock weight after | ${postCounts.totalStockWeight} kg |\n`
md += `| Stock weight change | +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg |\n`
md += `| Unmatched products | ${unmatchedProductsSet.size} |\n`
md += `| Duplicate bills | ${duplicateBillsList.length} |\n`
md += `| Owner review needed | ${unmatchedProductsSet.size > 0 ? 'YES' : 'NO'} |\n\n`

md += `## Imported Bills\n\n`
if (importedBills.length === 0) {
  md += `(none)\n\n`
} else {
  md += `| Bill no | File | Date | Seller | Items | Weight (kg) | Amount (THB) | Bill ID |\n|---|---|---|---|---:|---:|---:|---|\n`
  for (const b of importedBills) {
    md += `| ${b.externalBillNumber} | ${b.fileName} | ${b.date} | ${b.seller} | ${b.itemCount} | ${b.totalWeight} | ${b.totalAmount} | ${b.billId} |\n`
  }
  md += `\n`
}

md += `## Skipped Bills\n\n`
const skippedDryRun = dryRunRows.filter(r => !r.safeToImport)
if (skippedDryRun.length === 0 && skippedBills.length === 0) {
  md += `(none)\n\n`
} else {
  md += `| Bill no | File | Reason |\n|---|---|---|\n`
  for (const r of skippedDryRun) {
    let reason = []
    if (r.isDuplicate) reason.push('Duplicate')
    if (r.unmatchedCount > 0) reason.push(`${r.unmatchedCount} unmatched: ${r.unmatchedNames}`)
    md += `| ${r.billNumber} | ${r.fileName} | ${reason.join('; ')} |\n`
  }
  for (const r of skippedBills) {
    md += `| ${r.externalBillNumber} | ${r.fileName} | ${r.reason} |\n`
  }
  md += `\n`
}

md += `## Unmatched Products\n\n`
if (unmatchedProductsSet.size === 0) {
  md += `(none — all products matched)\n\n`
} else {
  md += `| Product name | Count | Files |\n|---|---:|---|\n`
  for (const [name, info] of unmatchedProductsSet) {
    md += `| ${name} | ${info.count} | ${[...info.files].join(', ')} |\n`
  }
  md += `\n`
}

md += `## Stock Safety\n\n`
md += `| Metric | Before | After | Change |\n|---|---:|---:|---:|\n`
md += `| BuyBills | ${preCounts.buyBills} | ${postCounts.buyBills} | +${postCounts.buyBills - preCounts.buyBills} |\n`
md += `| StockLots | ${preCounts.stockLots} | ${postCounts.stockLots} | +${postCounts.stockLots - preCounts.stockLots} |\n`
md += `| Total stock weight | ${preCounts.totalStockWeight} | ${postCounts.totalStockWeight} | +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} |\n\n`

md += `**Purchase import round 1 completed. Only clean non-duplicate bills were imported.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

console.log('\n=== DONE ===')
console.log(`Bills imported: ${importedBills.length}`)
console.log(`Bills skipped: ${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length}`)
console.log(`Stock lots created: ${postCounts.stockLots - preCounts.stockLots}`)

await db.$disconnect()
