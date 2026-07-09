/**
 * Task 63: Cleanup Purchase Import Round 1 After Owner Mapping Confirmation
 * 
 * - Add owner-confirmed aliases: ทองแดงช็อต→ทองแดงปอกช็อต, แสตนเลส 304 (ยาว)→สแตนเลส 304 ยาว
 * - Fix Format B repeated bill grouping: group all rows with same bill number into one BuyBill
 * - Import only safe remaining non-duplicate bills
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/import-buy-round-1-cleanup-2026-07-02-to-04'
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

// Owner-confirmed safe aliases (including Task 63 new mappings)
const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
  // Task 63 owner-confirmed:
  'ทองแดงช็อต': 'ทองแดงปอกช็อต',
  'แสตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
}

console.log('Loading product master...')
const allProducts = await db.product.findMany({ include: { category: true } })
const productMap = new Map()
for (const p of allProducts) productMap.set(p.name.trim().normalize('NFC'), p)

function matchProduct(rawName) {
  const normalizedInput = rawName.replace(/อลูมีเนียม/g, 'อลูมิเนียม').replace(/แสตนเลส/g, 'สแตนเลส')
  const trimmed = normalizedInput.trim().normalize('NFC')
  if (productMap.has(trimmed)) return { product: productMap.get(trimmed), matchType: 'EXACT' }
  const alias = SAFE_ALIASES[normalizedInput.trim()]?.normalize('NFC')
  if (alias && productMap.has(alias)) return { product: productMap.get(alias), matchType: 'ALIAS' }
  const contains = allProducts.filter(p => {
    const pn = p.name.normalize('NFC')
    return pn.includes(trimmed) || trimmed.includes(pn)
  })
  if (contains.length === 1) return { product: contains[0], matchType: 'CONTAINS' }
  return { product: null, matchType: 'NOT_FOUND' }
}

// Check existing
console.log('Checking existing external bill numbers...')
const existingBills = await db.buyBill.findMany({ where: { externalBillNumber: { not: null } }, select: { externalBillNumber: true } })
const existingBillNums = new Set(existingBills.map(b => b.externalBillNumber))
console.log(`Existing external bill numbers: ${existingBillNums.size}`)

// Get max bill number sequence
const lastBuyBill = await db.buyBill.findFirst({ where: { billNumber: { not: null } }, orderBy: { billNumber: 'desc' }, select: { billNumber: true } })
let billSeq = 1
if (lastBuyBill?.billNumber) {
  const m = lastBuyBill.billNumber.match(/BUY-2569-(\d+)/)
  if (m) billSeq = parseInt(m[1]) + 1
}
console.log(`Next bill sequence: BUY-2569-${String(billSeq).padStart(5, '0')}`)

// ============ PARSE WITH FORMAT B GROUPING FIX ============
console.log('\n=== PARSING (with Format B grouping fix) ===')
const allBills = []
const dryRunRows = []
const unmatchedProductsSet = new Map()
const duplicateBillsList = []

for (const FILE of FILES) {
  const fileName = path.basename(FILE)
  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
  
  const row3 = rows[3] || []
  const isFormatA = String(row3[0] || '').includes('ผู้ขาย') && !String(row3[2] || '').includes('ผู้ขาย')
  
  // KEY FIX: Use a Map to group items by bill number (Format B can repeat same bill number)
  const billsMap = new Map() // billNumber → bill object
  let currentProductName = ''
  let currentSeller = ''
  
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
    if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
    
    if (isFormatA) {
      // Format A: per-seller
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) { currentSeller = fixThai(String(fixed[1])); continue }
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) {
        const billNo = String(fixed[2]).trim()
        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, {
            fileName, externalBillNumber: billNo, seller: currentSeller,
            date: fixThai(String(fixed[1])).trim(),
            note: fixed[4] ? fixThai(String(fixed[4])).trim() : '',
            items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: num(fixed[12]),
          })
        }
        continue
      }
      if (fixed[2] && fixed[3] && fixed[9] != null) {
        const billNo = String(fixed[2]).trim()
        // In Format A, bill number is in col 2 for bill header rows, but item rows have product code in col 2
        // So we need to find the current bill differently — use the last bill header seen
        // Actually in Format A, item rows have col 2 = product code, col 3 = product name
        // We need to track which bill we're currently in
        // Let's use the first bill in the map as "current" — but this won't work for multiple bills
        // Actually Format A puts items right after the bill header, so we can track currentBillNo
        // Let me re-approach: track currentBillNo separately
        // This is handled by the order of rows — items follow their bill header
        // So we need a currentBillNo variable
        // (This is the same issue as before — Format A uses sequential bill headers followed by items)
        // For Format A, the old approach worked. The grouping fix is mainly for Format B.
        // Let's keep Format A as-is (sequential) and only fix Format B (Map-based grouping)
      }
      // For Format A, items are added to the last-created bill
      // We need to track the last bill number
      // Actually, let me just use a simpler approach for Format A:
      // Track currentBillNo as the last bill header seen
      // (This is already what the old code did — it used currentBill variable)
      // For Format A, let's keep the old approach
      continue // Format A is handled below
    }
    
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
        // KEY FIX: Group by bill number — if bill already exists in map, add item to it
        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, {
            fileName, externalBillNumber: billNo,
            seller: String(fixed[3] ?? '').trim() || String(fixed[2] ?? '').trim(),
            date: dateStr,
            note: fixed[6] ? fixThai(String(fixed[6])).trim() : '',
            items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: 0,
          })
        }
        const bill = billsMap.get(billNo)
        const productName = currentProductName || '(ไม่ระบุสินค้า)'
        const match = matchProduct(productName)
        bill.items.push({
          productName, productCode: String(fixed[0]).trim(),
          productId: match.product?.id || null, matchedProductName: match.product?.name || null,
          weight: num(fixed[9]), pricePerKg: num(fixed[11]), amount: num(fixed[12]),
          matched: !!match.product, matchType: match.matchType,
        })
        bill.totalWeight += num(fixed[9])
        bill.totalAmount += num(fixed[12])
      }
    }
  }
  
  // For Format A, use the old sequential approach
  if (isFormatA) {
    let currentBill = null
    currentSeller = ''
    currentProductName = ''
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || []
      const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
      if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) { currentSeller = fixThai(String(fixed[1])); continue }
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) {
        const billNo = String(fixed[2]).trim()
        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, {
            fileName, externalBillNumber: billNo, seller: currentSeller,
            date: fixThai(String(fixed[1])).trim(),
            note: fixed[4] ? fixThai(String(fixed[4])).trim() : '',
            items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: num(fixed[12]),
          })
        }
        currentBill = billsMap.get(billNo)
        continue
      }
      if (fixed[2] && fixed[3] && fixed[9] != null && currentBill) {
        const productName = fixThai(String(fixed[3])).trim()
        const match = matchProduct(productName)
        currentBill.items.push({
          productName, productCode: String(fixed[2]).trim(),
          productId: match.product?.id || null, matchedProductName: match.product?.name || null,
          weight: num(fixed[9]), pricePerKg: num(fixed[11]), amount: num(fixed[12]),
          matched: !!match.product, matchType: match.matchType,
        })
        currentBill.totalWeight += num(fixed[9])
        currentBill.totalAmount += num(fixed[12])
      }
    }
  }
  
  // Convert map to array
  const fileBills = [...billsMap.values()]
  console.log(`  ${fileName}: ${fileBills.length} unique bills (after grouping fix)`)
  
  for (const bill of fileBills) {
    bill.totalWeight = Math.round(bill.totalWeight * 100) / 100
    bill.totalAmount = Math.round(bill.totalAmount * 100) / 100
    bill.isDuplicate = existingBillNums.has(bill.externalBillNumber)
    if (bill.isDuplicate) duplicateBillsList.push({ fileName: bill.fileName, billNumber: bill.externalBillNumber })
    bill.unmatchedItems = bill.items.filter(i => !i.matched)
    if (bill.unmatchedItems.length > 0) {
      for (const item of bill.unmatchedItems) {
        if (!unmatchedProductsSet.has(item.productName)) unmatchedProductsSet.set(item.productName, { name: item.productName, count: 0, files: new Set() })
        unmatchedProductsSet.get(item.productName).count++
        unmatchedProductsSet.get(item.productName).files.add(bill.fileName)
      }
    }
    bill.safeToImport = !bill.isDuplicate && bill.unmatchedItems.length === 0 && bill.items.length > 0
    
    dryRunRows.push({
      fileName: bill.fileName, billNumber: bill.externalBillNumber, date: bill.date, seller: bill.seller,
      itemCount: bill.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount,
      unmatchedCount: bill.unmatchedItems.length, isDuplicate: bill.isDuplicate,
      amountDiff: Math.round((bill.totalAmount - bill.excelTotalAmount) * 100) / 100,
      safeToImport: bill.safeToImport, unmatchedNames: bill.unmatchedItems.map(i => i.productName).join('; '),
    })
    if (bill.safeToImport) allBills.push(bill)
  }
}

console.log(`\n=== DRY-RUN SUMMARY ===`)
console.log(`Total unique bills: ${dryRunRows.length}`)
console.log(`Safe to import: ${allBills.length}`)
console.log(`Skipped (duplicate): ${dryRunRows.filter(r => r.isDuplicate).length}`)
console.log(`Skipped (unmatched): ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length}`)
console.log(`Unmatched product names: ${unmatchedProductsSet.size}`)

// ============ IMPORT ============
console.log('\n=== IMPORTING ===')
const preCounts = {
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
  sellBills: await db.sellBill.count(),
  products: await db.product.count(),
}
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0
console.log(`Before: BuyBills=${preCounts.buyBills}, StockLots=${preCounts.stockLots}, Stock=${preCounts.totalStockWeight}`)

const importedBills = []
const skippedBills = []

for (const bill of allBills) {
  console.log(`  ${bill.externalBillNumber} (${bill.date}, ${bill.items.length} items, ${bill.totalWeight} kg)...`)
  try {
    const parts = bill.date.split('/')
    let ceYear = parseInt(parts[2]); if (ceYear > 2400) ceYear -= 543
    const billDate = new Date(ceYear, parseInt(parts[1]) - 1, parseInt(parts[0]), 10, 0, 0)
    const billNumber = `BUY-2569-${String(billSeq++).padStart(5, '0')}`
    
    const created = await db.buyBill.create({
      data: {
        billNumber, externalBillNumber: bill.externalBillNumber, date: billDate, isCredit: false,
        note: `ผู้ขาย: ${bill.seller}${bill.note ? ` | ${bill.note}` : ''} | นำเข้าจาก: ${bill.fileName}`,
        totalAmount: bill.totalAmount,
        items: { create: bill.items.filter(i => i.matched).map(i => ({
          productId: i.productId, weight: i.weight, pricePerKg: i.pricePerKg, totalAmount: i.amount,
        })) },
      }, include: { items: true },
    })
    
    for (const item of created.items) {
      await db.stockLot.create({
        data: { productId: item.productId, remainingWeight: item.weight, costPerKg: item.pricePerKg, dateAdded: billDate, source: 'BUY', sourceId: created.id },
      })
    }
    
    console.log(`    ✅ ${billNumber} — ${created.items.length} items`)
    importedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, billNumber, billId: created.id, date: bill.date, seller: bill.seller, itemCount: created.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount, status: 'IMPORTED' })
  } catch (e) {
    console.log(`    ❌ ${e.message.substring(0, 100)}`)
    skippedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, reason: e.message.substring(0, 200), status: 'DB_ERROR' })
  }
}

const postCounts = {
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
  sellBills: await db.sellBill.count(),
  products: await db.product.count(),
}
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0
console.log(`After: BuyBills=${postCounts.buyBills}, StockLots=${postCounts.stockLots}, Stock=${postCounts.totalStockWeight}`)
console.log(`Delta: +${postCounts.buyBills - preCounts.buyBills} bills, +${postCounts.stockLots - preCounts.stockLots} lots, +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg`)

// ============ REPORTS ============
console.log('\n=== REPORTS ===')

// 1. CLEANUP_DRY_RUN.csv
const dryCols = ['file_name','bill_number','date','seller','item_count','total_weight','total_amount','unmatched_count','is_duplicate','amount_diff','safe_to_import','unmatched_names']
const dryCsv = [dryCols.join(',')]
for (const r of dryRunRows) dryCsv.push([r.fileName, r.billNumber, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.unmatchedCount, r.isDuplicate, r.amountDiff, r.safeToImport, r.unmatchedNames].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'CLEANUP_DRY_RUN.csv'), '\ufeff' + dryCsv.join('\n'), 'utf-8')
console.log('  ✓ CLEANUP_DRY_RUN.csv')

// 2. CLEANUP_IMPORTED_BILLS.csv
const impCols = ['file_name','external_bill_number','bill_number','bill_id','date','seller','item_count','total_weight','total_amount','status']
const impCsv = [impCols.join(',')]
for (const r of importedBills) impCsv.push([r.fileName, r.externalBillNumber, r.billNumber, r.billId, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'CLEANUP_IMPORTED_BILLS.csv'), '\ufeff' + impCsv.join('\n'), 'utf-8')
console.log('  ✓ CLEANUP_IMPORTED_BILLS.csv')

// 3. CLEANUP_SKIPPED_BILLS.csv
const skipCols = ['file_name','external_bill_number','reason','status']
const skipCsv = [skipCols.join(',')]
for (const r of dryRunRows.filter(r => !r.safeToImport)) {
  let reason = []
  if (r.isDuplicate) reason.push('Duplicate bill number')
  if (r.unmatchedCount > 0) reason.push(`${r.unmatchedCount} unmatched: ${r.unmatchedNames}`)
  skipCsv.push([r.fileName, r.billNumber, reason.join('; '), r.isDuplicate ? 'DUPLICATE' : 'UNMATCHED'].map(csvEscape).join(','))
}
for (const r of skippedBills) skipCsv.push([r.fileName, r.externalBillNumber, r.reason, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'CLEANUP_SKIPPED_BILLS.csv'), '\ufeff' + skipCsv.join('\n'), 'utf-8')
console.log('  ✓ CLEANUP_SKIPPED_BILLS.csv')

// 4. CLEANUP_DUPLICATES.csv
const dupCols = ['file_name','bill_number','reason']
const dupCsv = [dupCols.join(',')]
for (const d of duplicateBillsList) dupCsv.push([d.fileName, d.billNumber, 'Already exists in DB'].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'CLEANUP_DUPLICATES.csv'), '\ufeff' + dupCsv.join('\n'), 'utf-8')
console.log('  ✓ CLEANUP_DUPLICATES.csv')

// 5. CLEANUP_STILL_NEED_OWNER_REVIEW.csv
const reviewCols = ['product_name','occurrence_count','files']
const reviewCsv = [reviewCols.join(',')]
for (const [name, info] of unmatchedProductsSet) reviewCsv.push([name, info.count, [...info.files].join('; ')].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'CLEANUP_STILL_NEED_OWNER_REVIEW.csv'), '\ufeff' + reviewCsv.join('\n'), 'utf-8')
console.log('  ✓ CLEANUP_STILL_NEED_OWNER_REVIEW.csv')

// 6. CLEANUP_STOCK_BEFORE_AFTER.csv
const stockCols = ['metric','before','after','change']
const stockCsv = [stockCols.join(',')]
stockCsv.push(['BuyBills', preCounts.buyBills, postCounts.buyBills, postCounts.buyBills - preCounts.buyBills].map(csvEscape).join(','))
stockCsv.push(['StockLots', preCounts.stockLots, postCounts.stockLots, postCounts.stockLots - preCounts.stockLots].map(csvEscape).join(','))
stockCsv.push(['TotalStockWeight', preCounts.totalStockWeight, postCounts.totalStockWeight, Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100].map(csvEscape).join(','))
stockCsv.push(['SellBills', preCounts.sellBills, postCounts.sellBills, postCounts.sellBills - preCounts.sellBills].map(csvEscape).join(','))
stockCsv.push(['Products', preCounts.products, postCounts.products, postCounts.products - preCounts.products].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'CLEANUP_STOCK_BEFORE_AFTER.csv'), '\ufeff' + stockCsv.join('\n'), 'utf-8')
console.log('  ✓ CLEANUP_STOCK_BEFORE_AFTER.csv')

// 7. FINAL_REPORT.md
let md = `# Purchase Round 1 Cleanup — After Owner Mapping Confirmation\n\n`
md += `## 1. Aliases Added/Used\n\n`
md += `| Alias | Target product | Source |\n|---|---|---|\n`
md += `| ทองแดงช็อต | ทองแดงปอกช็อต | Task 63 owner-confirmed |\n`
md += `| แสตนเลส 304 (ยาว) | สแตนเลส 304 ยาว | Task 63 owner-confirmed |\n`
md += `| อลูมิเนียมแข็ง (หล่อ/หนา) | อลูมิเนียมแข็ง | Task 35 |\n`
md += `| อลูมิเนียมฝาแกะ | ฝาอลูมิเนียม | Task 35 |\n`
md += `| อลูมิเนียมกระป๋อง | กระป๋องอลูมิเนียม | Task 35 |\n`
md += `| อลูมิเนียมตูดกะทะ | อลูมิเนียมตูดกะทะ | Task 35 |\n\n`

md += `## 2. Format B Repeated Bill Grouping Fix\n\n`
md += `**Fixed**: Format B files repeat the same bill number under different product summary sections. The parser now uses a Map to group all rows with the same bill number into one BuyBill with multiple BuyBillItems.\n\n`
md += `| File | Bills before fix (Task 62) | Bills after fix (Task 63) |\n|---|---:|---:|\n`
for (const FILE of FILES) {
  const fn = path.basename(FILE)
  const before = fn.includes('2-7') ? 13 : fn.includes('3-7') ? 39 : 53
  const after = dryRunRows.filter(r => r.fileName === fn).length
  md += `| ${fn} | ${before} | ${after} |\n`
}
md += `\n`

md += `## 3. Bills Found for Cleanup\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Total unique bills (after grouping fix) | ${dryRunRows.length} |\n`
md += `| Safe to import | ${allBills.length} |\n`
md += `| Duplicates (already in DB) | ${dryRunRows.filter(r => r.isDuplicate).length} |\n`
md += `| Unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length} |\n\n`

md += `## 4. Bills Imported\n\n`
md += `| Count | Value |\n|---|---:|\n`
md += `| Bills imported | ${importedBills.length} |\n`
md += `| Items imported | ${importedBills.reduce((s, b) => s + b.itemCount, 0)} |\n`
md += `| Total weight | ${importedBills.reduce((s, b) => s + b.totalWeight, 0)} kg |\n`
md += `| Total amount | ${importedBills.reduce((s, b) => s + b.totalAmount, 0)} THB |\n\n`
if (importedBills.length > 0) {
  md += `| Bill no | File | Date | Seller | Items | Weight | Amount |\n|---|---|---|---|---:|---:|---:|\n`
  for (const b of importedBills) md += `| ${b.externalBillNumber} | ${b.fileName} | ${b.date} | ${b.seller} | ${b.itemCount} | ${b.totalWeight} | ${b.totalAmount} |\n`
  md += `\n`
}

md += `## 5. Bills Skipped\n\n`
md += `| Reason | Count |\n|---|---:|\n`
md += `| Duplicate (already in DB) | ${dryRunRows.filter(r => r.isDuplicate).length} |\n`
md += `| Unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length} |\n`
md += `| DB errors | ${skippedBills.length} |\n\n`

md += `## 6. Remaining Unmatched/Ambiguous Products\n\n`
if (unmatchedProductsSet.size === 0) {
  md += `(none — all products matched after owner-confirmed aliases)\n\n`
} else {
  md += `| Product | Count | Files |\n|---|---:|---|\n`
  for (const [name, info] of unmatchedProductsSet) md += `| ${name} | ${info.count} | ${[...info.files].join(', ')} |\n`
  md += `\n`
}

md += `## 7. Duplicate Bill Handling\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Duplicate bills found | ${duplicateBillsList.length} |\n`
md += `| Duplicates skipped (not imported) | ${duplicateBillsList.length} |\n`
md += `| Previously imported (Task 62) | 16 |\n`
md += `| New imports this task | ${importedBills.length} |\n\n`

md += `## 8. Stock Before/After\n\n`
md += `| Metric | Before | After | Change |\n|---|---:|---:|---:|\n`
md += `| BuyBills | ${preCounts.buyBills} | ${postCounts.buyBills} | +${postCounts.buyBills - preCounts.buyBills} |\n`
md += `| StockLots | ${preCounts.stockLots} | ${postCounts.stockLots} | +${postCounts.stockLots - preCounts.stockLots} |\n`
md += `| Total stock weight | ${preCounts.totalStockWeight} | ${postCounts.totalStockWeight} | +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} |\n\n`

md += `## 9. Confirmation: No SellBills Modified\n\n`
md += `SellBills before: ${preCounts.sellBills} → after: ${postCounts.sellBills} — **${preCounts.sellBills === postCounts.sellBills ? 'UNCHANGED ✅' : 'CHANGED ❌'}**\n\n`

md += `## 10. Confirmation: No Product Master Modified\n\n`
md += `Products before: ${preCounts.products} → after: ${postCounts.products} — **${preCounts.products === postCounts.products ? 'UNCHANGED ✅' : 'CHANGED ❌'}**\n\n`

md += `**Purchase round 1 cleanup completed. Only safe remaining non-duplicate bills were imported.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

console.log('\n=== DONE ===')
console.log(`Bills imported: ${importedBills.length}`)
console.log(`Bills skipped: ${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length}`)
console.log(`Stock lots created: ${postCounts.stockLots - preCounts.stockLots}`)
console.log(`Stock weight change: +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg`)
console.log(`SellBills unchanged: ${preCounts.sellBills === postCounts.sellBills}`)
console.log(`Products unchanged: ${preCounts.products === postCounts.products}`)

await db.$disconnect()
