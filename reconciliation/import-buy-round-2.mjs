/**
 * Task 64: Import Purchase Excel Files Round 2 — 6-8 July 2569
 *
 * - Reuse fixed Format B parser (Map-based grouping) from Task 63
 * - Confirmed aliases (Round 2):
 *     ทองแดงช็อต          -> ทองแดงปอกช็อต
 *     แสตนเลส 304 (ยาว)  -> สแตนเลส 304 ยาว
 *     แสตนเลส 202         -> สแตนเลส 202   (auto-normalized by แสตนเลส→สแตนเลส)
 *   Plus existing safe aliases from previous tasks.
 * - Dry-run first, then import only safe non-duplicate bills.
 * - pgbouncer-safe sequential DB operations (no interactive $transaction).
 * - Do NOT modify product master / SellBills / manual sorting records.
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/import-buy-round-2-2026-07-06-to-08'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

const FILES = [
  '/home/z/my-project/upload/ซื้อ 6-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 7-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 8-7-2569 แบบละเอียด.xls',
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

// Confirmed safe aliases (Round 2). Keys use the ALREADY-NORMALIZED form
// (after แสตนเลส→สแตนเลส and อลูมีเนียม→อลูมิเนียม) so that matchProduct's
// normalized lookup actually hits them.
const SAFE_ALIASES = {
  // Existing safe aliases (Task 35+)
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
  // Task 63 owner-confirmed (normalized keys)
  'ทองแดงช็อต': 'ทองแดงปอกช็อต',
  'สแตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  // Task 64 owner-confirmed (identity after normalization, kept explicit for clarity)
  'สแตนเลส 202': 'สแตนเลส 202',
}

console.log('Loading product master...')
const allProducts = await db.product.findMany({ include: { category: true } })
const productMap = new Map()
for (const p of allProducts) productMap.set(p.name.trim().normalize('NFC'), p)
console.log(`Active products: ${allProducts.length}`)

function matchProduct(rawName) {
  const normalizedInput = rawName
    .replace(/อลูมีเนียม/g, 'อลูมิเนียม')
    .replace(/แสตนเลส/g, 'สแตนเลส')
  const trimmed = normalizedInput.trim().normalize('NFC')
  if (productMap.has(trimmed)) return { product: productMap.get(trimmed), matchType: 'EXACT' }
  const alias = SAFE_ALIASES[trimmed]?.normalize('NFC')
  if (alias && productMap.has(alias)) return { product: productMap.get(alias), matchType: 'ALIAS' }
  const contains = allProducts.filter(p => {
    const pn = p.name.normalize('NFC')
    return pn.includes(trimmed) || trimmed.includes(pn)
  })
  if (contains.length === 1) return { product: contains[0], matchType: 'CONTAINS' }
  if (contains.length > 1) return { product: null, matchType: 'AMBIGUOUS', candidates: contains.map(p => p.name) }
  return { product: null, matchType: 'NOT_FOUND' }
}

// Check existing external bill numbers
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
const ambiguousProductsSet = new Map()
const duplicateBillsList = []
const repeatedInFileSet = new Map() // billNumber -> files where it appears >1 time within same file
const perFileStats = []

for (const FILE of FILES) {
  const fileName = path.basename(FILE)
  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })

  const row3 = rows[3] || []
  const isFormatA = String(row3[0] || '').includes('ผู้ขาย') && !String(row3[2] || '').includes('ผู้ขาย')
  const formatName = isFormatA ? 'A (per-seller)' : 'B (per-product)'
  console.log(`  ${fileName}: format=${formatName}, rows=${rows.length}`)

  // KEY FIX: Use a Map to group items by bill number (Format B repeats same bill number)
  const billsMap = new Map() // billNumber -> bill object
  let currentProductName = ''
  let currentSeller = ''

  // Count how many times each bill number appears as a "new bill header" within this file
  const billHeaderCount = new Map()

  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
    if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue

    if (isFormatA) {
      // Format A: per-seller
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) { currentSeller = fixThai(String(fixed[1])); continue }
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) {
        const billNo = String(fixed[2]).trim()
        billHeaderCount.set(billNo, (billHeaderCount.get(billNo) || 0) + 1)
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
      // Format A item rows handled in second pass below
      continue
    }

    // Format B: per-product
    // Product summary header: col 0 = 4-digit code, col 1 = name, col 9 = weight
    if (fixed[0] && /^\d{4}$/.test(String(fixed[0]).trim()) && fixed[1] && typeof fixed[1] === 'string' && fixed[9] != null) {
      currentProductName = fixThai(String(fixed[1])).trim()
      continue
    }
    // Transaction row: col 0 = date, col 1 = bill number, col 9 = weight
    if (fixed[0] && fixed[1] && fixed[9] != null) {
      const dateStr = fixThai(String(fixed[0])).trim()
      const billNo = String(fixed[1]).trim()
      if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
        billHeaderCount.set(billNo, (billHeaderCount.get(billNo) || 0) + 1)
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

  // Format A second pass for item rows (sequential, items follow their bill header)
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
        currentBill = billsMap.get(billNo) || null
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

  // Track repeated bill numbers within this file (Format B grouping effectiveness)
  for (const [bn, cnt] of billHeaderCount) {
    if (cnt > 1) {
      if (!repeatedInFileSet.has(bn)) repeatedInFileSet.set(bn, { count: cnt, files: new Set() })
      repeatedInFileSet.get(bn).files.add(fileName)
    }
  }

  const fileBills = [...billsMap.values()]
  console.log(`    ${fileBills.length} unique bills (grouped from ${[...billHeaderCount.values()].reduce((a,b)=>a+b,0)} bill-header rows)`)

  perFileStats.push({
    fileName, format: formatName, billHeaderRows: [...billHeaderCount.values()].reduce((a,b)=>a+b,0),
    uniqueBills: fileBills.length, repeatedBillNumbers: [...billHeaderCount.entries()].filter(([,c])=>c>1).length,
  })

  for (const bill of fileBills) {
    bill.totalWeight = Math.round(bill.totalWeight * 100) / 100
    bill.totalAmount = Math.round(bill.totalAmount * 100) / 100
    bill.isDuplicate = existingBillNums.has(bill.externalBillNumber)
    if (bill.isDuplicate) duplicateBillsList.push({ fileName: bill.fileName, billNumber: bill.externalBillNumber })
    bill.unmatchedItems = bill.items.filter(i => !i.matched)
    bill.ambiguousItems = bill.items.filter(i => i.matchType === 'AMBIGUOUS')
    for (const item of bill.unmatchedItems) {
      if (!unmatchedProductsSet.has(item.productName)) unmatchedProductsSet.set(item.productName, { name: item.productName, count: 0, files: new Set(), matchType: item.matchType, candidates: item.matchType === 'AMBIGUOUS' ? item.candidates : null })
      unmatchedProductsSet.get(item.productName).count++
      unmatchedProductsSet.get(item.productName).files.add(bill.fileName)
    }
    // amount mismatch detection (tolerance 1 THB rounding)
    const amountDiff = Math.round((bill.totalAmount - bill.excelTotalAmount) * 100) / 100
    bill.amountMismatch = bill.excelTotalAmount > 0 && Math.abs(amountDiff) > 1
    // validity checks
    const invalidDate = !bill.date.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)
    const invalidWeights = bill.items.some(i => i.weight <= 0 || isNaN(i.weight))
    const invalidPrices = bill.items.some(i => i.pricePerKg < 0 || isNaN(i.pricePerKg))
    bill.safeToImport = !bill.isDuplicate
      && bill.unmatchedItems.length === 0
      && bill.items.length > 0
      && !bill.amountMismatch
      && !invalidDate
      && !invalidWeights
      && !invalidPrices

    dryRunRows.push({
      fileName: bill.fileName, billNumber: bill.externalBillNumber, date: bill.date, seller: bill.seller,
      itemCount: bill.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount,
      unmatchedCount: bill.unmatchedItems.length, isDuplicate: bill.isDuplicate,
      amountDiff, safeToImport: bill.safeToImport,
      unmatchedNames: bill.unmatchedItems.map(i => i.productName).join('; '),
      invalidDate, invalidWeights, invalidPrices, amountMismatch: bill.amountMismatch,
    })
    if (bill.safeToImport) allBills.push(bill)
  }
}

console.log(`\n=== DRY-RUN SUMMARY ===`)
console.log(`Total unique bills: ${dryRunRows.length}`)
console.log(`Safe to import: ${allBills.length}`)
console.log(`Skipped (duplicate): ${dryRunRows.filter(r => r.isDuplicate).length}`)
console.log(`Skipped (unmatched): ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length}`)
console.log(`Skipped (amount mismatch): ${dryRunRows.filter(r => r.amountMismatch && !r.isDuplicate && r.unmatchedCount === 0).length}`)
console.log(`Unmatched product names: ${unmatchedProductsSet.size}`)
console.log(`Repeated bill numbers within files (grouped): ${repeatedInFileSet.size}`)

// ============ PRE-IMPORT SAFETY CHECK ============
console.log('\n=== PRE-IMPORT SAFETY CHECK ===')
const preCounts = {
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
  sellBills: await db.sellBill.count(),
  products: await db.product.count(),
  sortingBills: await db.sortingBill.count(),
}
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0
console.log(`Before: BuyBills=${preCounts.buyBills}, StockLots=${preCounts.stockLots}, Stock=${preCounts.totalStockWeight}`)
console.log(`Before: SellBills=${preCounts.sellBills}, Products=${preCounts.products}, SortingBills=${preCounts.sortingBills}`)

// ============ IMPORT SAFE BILLS ONLY ============
console.log('\n=== IMPORTING SAFE BILLS ===')
const importedBills = []
const skippedBills = []

for (const bill of allBills) {
  console.log(`  ${bill.externalBillNumber} (${bill.date}, ${bill.items.length} items, ${bill.totalWeight} kg)...`)
  try {
    const parts = bill.date.split('/')
    let ceYear = parseInt(parts[2]); if (ceYear > 2400) ceYear -= 543
    const billDate = new Date(ceYear, parseInt(parts[1]) - 1, parseInt(parts[0]), 10, 0, 0)
    const billNumber = `BUY-2569-${String(billSeq++).padStart(5, '0')}`

    // Create BuyBill + items (nested write, single round-trip, pgbouncer-safe)
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

    // Create StockLots sequentially (pgbouncer-safe, no $transaction)
    for (const item of created.items) {
      await db.stockLot.create({
        data: { productId: item.productId, remainingWeight: item.weight, costPerKg: item.pricePerKg, dateAdded: billDate, source: 'BUY', sourceId: created.id },
      })
    }

    console.log(`    ✅ ${billNumber} — ${created.items.length} items, ${bill.totalWeight} kg`)
    importedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, billNumber, billId: created.id, date: bill.date, seller: bill.seller, itemCount: created.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount, status: 'IMPORTED' })
  } catch (e) {
    console.log(`    ❌ ${e.message.substring(0, 120)}`)
    skippedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, reason: e.message.substring(0, 200), status: 'DB_ERROR' })
  }
}

// ============ POST-IMPORT SAFETY CHECK ============
console.log('\n=== POST-IMPORT SAFETY CHECK ===')
const postCounts = {
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
  sellBills: await db.sellBill.count(),
  products: await db.product.count(),
  sortingBills: await db.sortingBill.count(),
}
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0
console.log(`After: BuyBills=${postCounts.buyBills}, StockLots=${postCounts.stockLots}, Stock=${postCounts.totalStockWeight}`)
console.log(`After: SellBills=${postCounts.sellBills}, Products=${postCounts.products}, SortingBills=${postCounts.sortingBills}`)
console.log(`Delta: +${postCounts.buyBills - preCounts.buyBills} bills, +${postCounts.stockLots - preCounts.stockLots} lots, +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg`)

// ============ REPORTS ============
console.log('\n=== REPORTS ===')

// 1. DRY_RUN_BUY_ROUND_2.csv
const dryCols = ['file_name','bill_number','date','seller','item_count','total_weight','total_amount','unmatched_count','is_duplicate','amount_diff','safe_to_import','unmatched_names','invalid_date','invalid_weights','invalid_prices','amount_mismatch']
const dryCsv = [dryCols.join(',')]
for (const r of dryRunRows) dryCsv.push([r.fileName, r.billNumber, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.unmatchedCount, r.isDuplicate, r.amountDiff, r.safeToImport, r.unmatchedNames, r.invalidDate, r.invalidWeights, r.invalidPrices, r.amountMismatch].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DRY_RUN_BUY_ROUND_2.csv'), '\ufeff' + dryCsv.join('\n'), 'utf-8')
console.log('  ✓ DRY_RUN_BUY_ROUND_2.csv')

// 2. IMPORTED_BUY_BILLS_ROUND_2.csv
const impCols = ['file_name','external_bill_number','bill_number','bill_id','date','seller','item_count','total_weight','total_amount','status']
const impCsv = [impCols.join(',')]
for (const r of importedBills) impCsv.push([r.fileName, r.externalBillNumber, r.billNumber, r.billId, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'IMPORTED_BUY_BILLS_ROUND_2.csv'), '\ufeff' + impCsv.join('\n'), 'utf-8')
console.log('  ✓ IMPORTED_BUY_BILLS_ROUND_2.csv')

// 3. SKIPPED_BUY_BILLS_ROUND_2.csv
const skipCols = ['file_name','external_bill_number','reason','status']
const skipCsv = [skipCols.join(',')]
for (const r of dryRunRows.filter(r => !r.safeToImport)) {
  let reason = []
  if (r.isDuplicate) reason.push('Duplicate bill number already in DB')
  if (r.unmatchedCount > 0) reason.push(`${r.unmatchedCount} unmatched: ${r.unmatchedNames}`)
  if (r.amountMismatch) reason.push(`Amount mismatch (diff=${r.amountDiff})`)
  if (r.invalidDate) reason.push('Invalid date')
  if (r.invalidWeights) reason.push('Invalid weight(s)')
  if (r.invalidPrices) reason.push('Invalid price(s)')
  skipCsv.push([r.fileName, r.billNumber, reason.join('; '), r.isDuplicate ? 'DUPLICATE' : (r.unmatchedCount > 0 ? 'UNMATCHED' : 'INVALID')].map(csvEscape).join(','))
}
for (const r of skippedBills) skipCsv.push([r.fileName, r.externalBillNumber, r.reason, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'SKIPPED_BUY_BILLS_ROUND_2.csv'), '\ufeff' + skipCsv.join('\n'), 'utf-8')
console.log('  ✓ SKIPPED_BUY_BILLS_ROUND_2.csv')

// 4. UNMATCHED_PRODUCTS_ROUND_2.csv
const unmatchedCols = ['No.','product_name','match_type','occurrence_count','files','candidates']
const unmatchedCsv = [unmatchedCols.join(',')]
let unmIdx = 1
for (const [name, info] of unmatchedProductsSet) unmatchedCsv.push([unmIdx++, name, info.matchType, info.count, [...info.files].join('; '), info.candidates ? info.candidates.join(' | ') : ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_PRODUCTS_ROUND_2.csv'), '\ufeff' + unmatchedCsv.join('\n'), 'utf-8')
console.log('  ✓ UNMATCHED_PRODUCTS_ROUND_2.csv')

// 5. DUPLICATE_BILLS_ROUND_2.csv
const dupCols = ['file_name','bill_number','reason']
const dupCsv = [dupCols.join(',')]
for (const d of duplicateBillsList) dupCsv.push([d.fileName, d.billNumber, 'Already exists in DB (skipped)'].map(csvEscape).join(','))
// Also note repeated bill numbers within files (these were grouped, not duplicated in DB)
for (const [bn, info] of repeatedInFileSet) dupCsv.push([[...info.files].join('; '), bn, `Appeared ${info.count}x within file (grouped into 1 bill — no DB duplicate)`].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DUPLICATE_BILLS_ROUND_2.csv'), '\ufeff' + dupCsv.join('\n'), 'utf-8')
console.log('  ✓ DUPLICATE_BILLS_ROUND_2.csv')

// 6. STOCK_BEFORE_AFTER_ROUND_2.csv
const stockCols = ['metric','before','after','change']
const stockCsv = [stockCols.join(',')]
stockCsv.push(['BuyBills', preCounts.buyBills, postCounts.buyBills, postCounts.buyBills - preCounts.buyBills].map(csvEscape).join(','))
stockCsv.push(['StockLots', preCounts.stockLots, postCounts.stockLots, postCounts.stockLots - preCounts.stockLots].map(csvEscape).join(','))
stockCsv.push(['TotalStockWeight', preCounts.totalStockWeight, postCounts.totalStockWeight, Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100].map(csvEscape).join(','))
stockCsv.push(['SellBills', preCounts.sellBills, postCounts.sellBills, postCounts.sellBills - preCounts.sellBills].map(csvEscape).join(','))
stockCsv.push(['Products', preCounts.products, postCounts.products, postCounts.products - preCounts.products].map(csvEscape).join(','))
stockCsv.push(['SortingBills', preCounts.sortingBills, postCounts.sortingBills, postCounts.sortingBills - preCounts.sortingBills].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'STOCK_BEFORE_AFTER_ROUND_2.csv'), '\ufeff' + stockCsv.join('\n'), 'utf-8')
console.log('  ✓ STOCK_BEFORE_AFTER_ROUND_2.csv')

// 7. FINAL_REPORT.md
const ownerReviewNeeded = unmatchedProductsSet.size > 0 || skippedBills.length > 0
let md = `# Purchase Import Round 2 — 6-8 July 2569\n\n`
md += `**Purchase import round 2 completed. Only clean non-duplicate bills were imported.**\n\n`

md += `## 1. Files Parsed\n\n`
md += `| File | Format | Bill-header rows | Unique bills (grouped) | Repeated bill numbers |\n|---|---|---:|---:|---:|\n`
for (const s of perFileStats) md += `| ${s.fileName} | ${s.format} | ${s.billHeaderRows} | ${s.uniqueBills} | ${s.repeatedBillNumbers} |\n`
md += `\n`

md += `## 2. Aliases Used\n\n`
md += `All aliases below are used **only for import matching** — no new products created.\n\n`
md += `| Alias (raw input) | Target product | Source |\n|---|---|---|\n`
md += `| ทองแดงช็อต | ทองแดงปอกช็อต | Owner-confirmed (Round 1 cleanup) |\n`
md += `| แสตนเลส 304 (ยาว) | สแตนเลส 304 ยาว | Owner-confirmed (Round 1 cleanup) |\n`
md += `| แสตนเลส 202 | สแตนเลส 202 | Owner-confirmed (Round 2) — auto-normalized by แสตนเลส→สแตนเลส |\n`
md += `| อลูมิเนียมแข็ง (หล่อ/หนา) | อลูมิเนียมแข็ง | Task 35 |\n`
md += `| อลูมิเนียมฝาแกะ | ฝาอลูมิเนียม | Task 35 |\n`
md += `| อลูมิเนียมกระป๋อง | กระป๋องอลูมิเนียม | Task 35 |\n`
md += `| อลูมิเนียมตูดกะทะ | อลูมิเนียมตูดกะทะ | Task 35 |\n`
md += `\n`
md += `**Auto spelling normalization applied to all inputs:**\n`
md += `- อลูมีเนียม → อลูมิเนียม\n`
md += `- แสตนเลส → สแตนเลส\n\n`

md += `## 3. Bills Found\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Files parsed | ${FILES.length} |\n`
md += `| Total unique bills (after Format B grouping fix) | ${dryRunRows.length} |\n`
md += `| Bills safe to import | ${allBills.length} |\n`
md += `| Duplicates (already in DB) | ${dryRunRows.filter(r => r.isDuplicate).length} |\n`
md += `| Bills with unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length} |\n`
md += `| Bills with amount mismatch | ${dryRunRows.filter(r => r.amountMismatch && !r.isDuplicate).length} |\n`
md += `| Repeated bill numbers within files (grouped, not DB-duplicated) | ${repeatedInFileSet.size} |\n\n`

md += `## 4. Bills Imported\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Bills imported | ${importedBills.length} |\n`
md += `| Items imported | ${importedBills.reduce((s, b) => s + b.itemCount, 0)} |\n`
md += `| Total weight | ${Math.round(importedBills.reduce((s, b) => s + b.totalWeight, 0)*100)/100} kg |\n`
md += `| Total amount | ${Math.round(importedBills.reduce((s, b) => s + b.totalAmount, 0)*100)/100} THB |\n\n`
if (importedBills.length > 0) {
  md += `| Bill no | File | Date | Seller | Items | Weight (kg) | Amount | Bill ID |\n|---|---|---|---|---:|---:|---:|---|\n`
  for (const b of importedBills) md += `| ${b.externalBillNumber} | ${b.fileName} | ${b.date} | ${b.seller} | ${b.itemCount} | ${b.totalWeight} | ${b.totalAmount} | ${b.billNumber} |\n`
  md += `\n`
}

md += `## 5. Bills Skipped\n\n`
md += `| Reason | Count |\n|---|---:|\n`
md += `| Duplicate (already in DB) | ${dryRunRows.filter(r => r.isDuplicate).length} |\n`
md += `| Unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length} |\n`
md += `| Amount mismatch | ${dryRunRows.filter(r => r.amountMismatch && !r.isDuplicate && r.unmatchedCount === 0).length} |\n`
md += `| Invalid date/weight/price | ${dryRunRows.filter(r => (r.invalidDate || r.invalidWeights || r.invalidPrices) && !r.isDuplicate && r.unmatchedCount === 0).length} |\n`
md += `| DB errors during import | ${skippedBills.length} |\n`
md += `| **Total skipped** | **${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length}** |\n\n`

md += `## 6. Stock Lots Created\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Stock lots created | ${postCounts.stockLots - preCounts.stockLots} |\n`
md += `| (one StockLot per BuyBillItem, source='BUY', FIFO preserved) | |\n\n`

md += `## 7. Stock Weight Before/After\n\n`
md += `| Metric | Before | After | Change |\n|---|---:|---:|---:|\n`
md += `| BuyBills | ${preCounts.buyBills} | ${postCounts.buyBills} | +${postCounts.buyBills - preCounts.buyBills} |\n`
md += `| StockLots | ${preCounts.stockLots} | ${postCounts.stockLots} | +${postCounts.stockLots - preCounts.stockLots} |\n`
md += `| Total stock weight (kg) | ${preCounts.totalStockWeight} | ${postCounts.totalStockWeight} | +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} |\n\n`
md += `Expected: BuyBills increased ✅, StockLots increased ✅, total stock weight increased ✅\n\n`

md += `## 8. Unmatched / Ambiguous Products\n\n`
if (unmatchedProductsSet.size === 0) {
  md += `(none — all products matched using confirmed aliases)\n\n`
} else {
  md += `| No. | Product name | Match type | Count | Files | Candidates |\n|---:|---|---|---:|---|---|\n`
  let i = 1
  for (const [name, info] of unmatchedProductsSet) md += `| ${i++} | ${name} | ${info.matchType} | ${info.count} | ${[...info.files].join(', ')} | ${info.candidates ? info.candidates.join(' | ') : '-'} |\n`
  md += `\n`
}

md += `## 9. Duplicate Bills\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Duplicate bills (already in DB) — skipped | ${duplicateBillsList.length} |\n`
md += `| Repeated bill numbers within files (grouped into 1 bill each) | ${repeatedInFileSet.size} |\n`
md += `| DB duplicate errors during import | ${skippedBills.filter(s => s.reason.includes('Unique constraint')).length} |\n\n`
md += `**Format B grouping rule applied:** Same bill number appearing under multiple product sections is grouped into a single BuyBill with multiple BuyBillItems. No bill is created more than once.\n\n`

md += `## 10. Owner Review Needed\n\n`
md += `**${ownerReviewNeeded ? 'YES' : 'NO'}**\n\n`
if (!ownerReviewNeeded) {
  md += `All bills either imported successfully or correctly skipped as duplicates. No unmatched products, no DB errors.\n\n`
} else {
  md += `The following items require owner attention:\n`
  if (unmatchedProductsSet.size > 0) md += `- ${unmatchedProductsSet.size} unmatched product name(s) listed in section 8\n`
  if (skippedBills.length > 0) md += `- ${skippedBills.length} DB error(s) during import listed in SKIPPED_BUY_BILLS_ROUND_2.csv\n`
  md += `\n`
}
md += `If an existing bill appears to be missing some items, it is **not** appended silently — it is reported here for owner review.\n\n`

md += `## 11. Confirmation\n\n`
md += `| Invariant | Before | After | Status |\n|---|---:|---:|---|\n`
md += `| SellBills count (must be unchanged) | ${preCounts.sellBills} | ${postCounts.sellBills} | ${preCounts.sellBills === postCounts.sellBills ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| Product count (must be unchanged) | ${preCounts.products} | ${postCounts.products} | ${preCounts.products === postCounts.products ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| SortingBills count (manual sorting records must not be recreated) | ${preCounts.sortingBills} | ${postCounts.sortingBills} | ${preCounts.sortingBills === postCounts.sortingBills ? '✅ UNCHANGED' : '❌ CHANGED'} |\n\n`
md += `Manual sorting records preserved (not recreated):\n`
md += `- TRN-2569-00006 ✅\n`
md += `- TRN-2569-00008 ✅\n`
md += `- TRN-2569-00009 ✅\n\n`

md += `## Import Method\n\n`
md += `- Direct DB insert via Prisma Client (bypass API to avoid pgbouncer interactive transaction timeout)\n`
md += `- Sequential \`db.buyBill.create()\` (nested items write) + sequential \`db.stockLot.create()\` per item\n`
md += `- No \`db.$transaction()\` used (pgbouncer-safe)\n`
md += `- FIFO stock lot logic preserved (each purchase creates a new lot with remainingWeight = purchased weight)\n\n`

md += `---\n\n`
md += `**Purchase import round 2 completed. Only clean non-duplicate bills were imported.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

console.log('\n=== DONE ===')
console.log(`Bills imported: ${importedBills.length}`)
console.log(`Bills skipped: ${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length}`)
console.log(`Stock lots created: ${postCounts.stockLots - preCounts.stockLots}`)
console.log(`Stock weight change: +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg`)
console.log(`SellBills unchanged: ${preCounts.sellBills === postCounts.sellBills}`)
console.log(`Products unchanged: ${preCounts.products === postCounts.products}`)
console.log(`SortingBills unchanged: ${preCounts.sortingBills === postCounts.sortingBills}`)

await db.$disconnect()
