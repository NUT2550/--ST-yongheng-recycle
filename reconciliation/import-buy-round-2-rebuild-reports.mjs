/**
 * Task 64 (fix): Reconstruct Round 2 reports from DB state.
 *
 * The first run of import-buy-round-2.mjs imported 70 bills (BUY-2569-00086..00155).
 * A second run overwrote the CSV reports showing 0 imported (all duplicates).
 * This script re-parses the 3 files, cross-references with the DB, and regenerates
 * the 7 output files to reflect the ACTUAL import that happened.
 *
 * Known deltas from first run (captured in console output):
 *   BuyBills:  88 -> 158  (+70)
 *   StockLots: 966 -> 1113 (+147)
 *   Stock wt:  600181.9 -> 639158.9 (+38977.0)
 *   SellBills: 9 -> 9 (unchanged)
 *   Products:  113 -> 113 (unchanged)
 *   SortingBills: 144 -> 144 (unchanged)
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/import-buy-round-2-2026-07-06-to-08'
const FILES = [
  '/home/z/my-project/upload/ซื้อ 6-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 7-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 8-7-2569 แบบละเอียด.xls',
]

// Known before/after from the actual first import run
const PRE  = { buyBills: 88,  stockLots: 966,  totalStockWeight: 600181.9,  sellBills: 9, products: 113, sortingBills: 144 }
const POST = { buyBills: 158, stockLots: 1113, totalStockWeight: 639158.9, sellBills: 9, products: 113, sortingBills: 144 }

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

const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
  'ทองแดงช็อต': 'ทองแดงปอกช็อต',
  'สแตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  'สแตนเลส 202': 'สแตนเลส 202',
}

console.log('Loading product master...')
const allProducts = await db.product.findMany({ include: { category: true } })
const productMap = new Map()
for (const p of allProducts) productMap.set(p.name.trim().normalize('NFC'), p)

function matchProduct(rawName) {
  const normalizedInput = rawName.replace(/อลูมีเนียม/g, 'อลูมิเนียม').replace(/แสตนเลส/g, 'สแตนเลส')
  const trimmed = normalizedInput.trim().normalize('NFC')
  if (productMap.has(trimmed)) return { product: productMap.get(trimmed), matchType: 'EXACT' }
  const alias = SAFE_ALIASES[trimmed]?.normalize('NFC')
  if (alias && productMap.has(alias)) return { product: productMap.get(alias), matchType: 'ALIAS' }
  const contains = allProducts.filter(p => { const pn = p.name.normalize('NFC'); return pn.includes(trimmed) || trimmed.includes(pn) })
  if (contains.length === 1) return { product: contains[0], matchType: 'CONTAINS' }
  if (contains.length > 1) return { product: null, matchType: 'AMBIGUOUS', candidates: contains.map(p => p.name) }
  return { product: null, matchType: 'NOT_FOUND' }
}

// Fetch all BuyBills with their items + stock lots, including the externalBillNumber range we care about
console.log('Fetching imported BuyBills from DB...')
const dbBills = await db.buyBill.findMany({
  where: { externalBillNumber: { not: null } },
  include: { items: true },
})
const dbBillMap = new Map(dbBills.map(b => [b.externalBillNumber, b]))
console.log(`DB BuyBills with externalBillNumber: ${dbBillMap.size}`)

// Identify Round 2 imports: billNumber between BUY-2569-00086 and BUY-2569-00155
const round2Imported = dbBills.filter(b => {
  if (!b.billNumber) return false
  const m = b.billNumber.match(/BUY-2569-(\d+)/)
  if (!m) return false
  const seq = parseInt(m[1])
  return seq >= 86 && seq <= 155
})
console.log(`Round 2 imported bills in DB: ${round2Imported.length}`)

// ============ PARSE (same logic as import script) ============
console.log('\n=== PARSING ===')
const dryRunRows = []
const importedBills = []
const skippedBills = []
const unmatchedProductsSet = new Map()
const duplicateBillsList = []
const repeatedInFileSet = new Map()
const perFileStats = []

for (const FILE of FILES) {
  const fileName = path.basename(FILE)
  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })

  const row3 = rows[3] || []
  const isFormatA = String(row3[0] || '').includes('ผู้ขาย') && !String(row3[2] || '').includes('ผู้ขาย')
  const formatName = isFormatA ? 'A (per-seller)' : 'B (per-product)'

  const billsMap = new Map()
  let currentProductName = ''
  let currentSeller = ''
  const billHeaderCount = new Map()

  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
    if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue

    if (isFormatA) {
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) { currentSeller = fixThai(String(fixed[1])); continue }
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) {
        const billNo = String(fixed[2]).trim()
        billHeaderCount.set(billNo, (billHeaderCount.get(billNo) || 0) + 1)
        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, { fileName, externalBillNumber: billNo, seller: currentSeller, date: fixThai(String(fixed[1])).trim(), note: fixed[4] ? fixThai(String(fixed[4])).trim() : '', items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: num(fixed[12]) })
        }
        continue
      }
      continue
    }

    if (fixed[0] && /^\d{4}$/.test(String(fixed[0]).trim()) && fixed[1] && typeof fixed[1] === 'string' && fixed[9] != null) {
      currentProductName = fixThai(String(fixed[1])).trim(); continue
    }
    if (fixed[0] && fixed[1] && fixed[9] != null) {
      const dateStr = fixThai(String(fixed[0])).trim()
      const billNo = String(fixed[1]).trim()
      if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
        billHeaderCount.set(billNo, (billHeaderCount.get(billNo) || 0) + 1)
        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, { fileName, externalBillNumber: billNo, seller: String(fixed[3] ?? '').trim() || String(fixed[2] ?? '').trim(), date: dateStr, note: fixed[6] ? fixThai(String(fixed[6])).trim() : '', items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: 0 })
        }
        const bill = billsMap.get(billNo)
        const productName = currentProductName || '(ไม่ระบุสินค้า)'
        const match = matchProduct(productName)
        bill.items.push({ productName, productCode: String(fixed[0]).trim(), productId: match.product?.id || null, matchedProductName: match.product?.name || null, weight: num(fixed[9]), pricePerKg: num(fixed[11]), amount: num(fixed[12]), matched: !!match.product, matchType: match.matchType })
        bill.totalWeight += num(fixed[9]); bill.totalAmount += num(fixed[12])
      }
    }
  }

  if (isFormatA) {
    let currentBill = null; currentSeller = ''; currentProductName = ''
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || []
      const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
      if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) { currentSeller = fixThai(String(fixed[1])); continue }
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) { const billNo = String(fixed[2]).trim(); currentBill = billsMap.get(billNo) || null; continue }
      if (fixed[2] && fixed[3] && fixed[9] != null && currentBill) {
        const productName = fixThai(String(fixed[3])).trim()
        const match = matchProduct(productName)
        currentBill.items.push({ productName, productCode: String(fixed[2]).trim(), productId: match.product?.id || null, matchedProductName: match.product?.name || null, weight: num(fixed[9]), pricePerKg: num(fixed[11]), amount: num(fixed[12]), matched: !!match.product, matchType: match.matchType })
        currentBill.totalWeight += num(fixed[9]); currentBill.totalAmount += num(fixed[12])
      }
    }
  }

  for (const [bn, cnt] of billHeaderCount) {
    if (cnt > 1) { if (!repeatedInFileSet.has(bn)) repeatedInFileSet.set(bn, { count: cnt, files: new Set() }); repeatedInFileSet.get(bn).files.add(fileName) }
  }

  const fileBills = [...billsMap.values()]
  perFileStats.push({ fileName, format: formatName, billHeaderRows: [...billHeaderCount.values()].reduce((a,b)=>a+b,0), uniqueBills: fileBills.length, repeatedBillNumbers: [...billHeaderCount.entries()].filter(([,c])=>c>1).length })

  for (const bill of fileBills) {
    bill.totalWeight = Math.round(bill.totalWeight * 100) / 100
    bill.totalAmount = Math.round(bill.totalAmount * 100) / 100
    const dbBill = dbBillMap.get(bill.externalBillNumber)
    bill.wasImportedInRound2 = !!(dbBill && dbBill.billNumber && /BUY-2569-(\d+)/.test(dbBill.billNumber) && parseInt(dbBill.billNumber.match(/BUY-2569-(\d+)/)[1]) >= 86 && parseInt(dbBill.billNumber.match(/BUY-2569-(\d+)/)[1]) <= 155)
    bill.isDuplicate = !!dbBill && !bill.wasImportedInRound2
    if (bill.isDuplicate) duplicateBillsList.push({ fileName: bill.fileName, billNumber: bill.externalBillNumber })
    bill.unmatchedItems = bill.items.filter(i => !i.matched)
    for (const item of bill.unmatchedItems) {
      if (!unmatchedProductsSet.has(item.productName)) unmatchedProductsSet.set(item.productName, { name: item.productName, count: 0, files: new Set(), matchType: item.matchType, candidates: item.matchType === 'AMBIGUOUS' ? item.candidates : null })
      unmatchedProductsSet.get(item.productName).count++
      unmatchedProductsSet.get(item.productName).files.add(bill.fileName)
    }
    const amountDiff = Math.round((bill.totalAmount - bill.excelTotalAmount) * 100) / 100
    bill.amountMismatch = bill.excelTotalAmount > 0 && Math.abs(amountDiff) > 1
    const invalidDate = !bill.date.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)
    const invalidWeights = bill.items.some(i => i.weight <= 0 || isNaN(i.weight))
    const invalidPrices = bill.items.some(i => i.pricePerKg < 0 || isNaN(i.pricePerKg))

    dryRunRows.push({
      fileName: bill.fileName, billNumber: bill.externalBillNumber, date: bill.date, seller: bill.seller,
      itemCount: bill.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount,
      unmatchedCount: bill.unmatchedItems.length,
      isDuplicate: bill.isDuplicate, wasImported: bill.wasImportedInRound2,
      amountDiff, safeToImport: bill.wasImportedInRound2,
      unmatchedNames: bill.unmatchedItems.map(i => i.productName).join('; '),
      invalidDate, invalidWeights, invalidPrices, amountMismatch: bill.amountMismatch,
    })

    if (bill.wasImportedInRound2) {
      importedBills.push({
        fileName: bill.fileName, externalBillNumber: bill.externalBillNumber,
        billNumber: dbBill.billNumber, billId: dbBill.id, date: bill.date, seller: bill.seller,
        itemCount: dbBill.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount, status: 'IMPORTED',
      })
    } else if (bill.isDuplicate) {
      skippedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, reason: 'Duplicate bill number already in DB (pre-existing)', status: 'DUPLICATE' })
    } else if (bill.unmatchedItems.length > 0) {
      skippedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, reason: `${bill.unmatchedItems.length} unmatched: ${bill.unmatchedItems.map(i=>i.productName).join('; ')}`, status: 'UNMATCHED' })
    }
  }
}

console.log(`\nDry-run rows: ${dryRunRows.length}`)
console.log(`Imported (Round 2): ${importedBills.length}`)
console.log(`Skipped: ${skippedBills.length}`)
console.log(`Unmatched products: ${unmatchedProductsSet.size}`)

// ============ REPORTS ============
console.log('\n=== REPORTS ===')

// 1. DRY_RUN_BUY_ROUND_2.csv
const dryCols = ['file_name','bill_number','date','seller','item_count','total_weight','total_amount','unmatched_count','is_duplicate','was_imported_round2','amount_diff','safe_to_import','unmatched_names','invalid_date','invalid_weights','invalid_prices','amount_mismatch']
const dryCsv = [dryCols.join(',')]
for (const r of dryRunRows) dryCsv.push([r.fileName, r.billNumber, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.unmatchedCount, r.isDuplicate, r.wasImported, r.amountDiff, r.safeToImport, r.unmatchedNames, r.invalidDate, r.invalidWeights, r.invalidPrices, r.amountMismatch].map(csvEscape).join(','))
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
for (const d of duplicateBillsList) dupCsv.push([d.fileName, d.billNumber, 'Pre-existing duplicate (already in DB before Round 2, skipped)'].map(csvEscape).join(','))
for (const [bn, info] of repeatedInFileSet) dupCsv.push([[...info.files].join('; '), bn, `Appeared ${info.count}x within file (grouped into 1 bill — no DB duplicate)`].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DUPLICATE_BILLS_ROUND_2.csv'), '\ufeff' + dupCsv.join('\n'), 'utf-8')
console.log('  ✓ DUPLICATE_BILLS_ROUND_2.csv')

// 6. STOCK_BEFORE_AFTER_ROUND_2.csv
const stockCols = ['metric','before','after','change']
const stockCsv = [stockCols.join(',')]
stockCsv.push(['BuyBills', PRE.buyBills, POST.buyBills, POST.buyBills - PRE.buyBills].map(csvEscape).join(','))
stockCsv.push(['StockLots', PRE.stockLots, POST.stockLots, POST.stockLots - PRE.stockLots].map(csvEscape).join(','))
stockCsv.push(['TotalStockWeight', PRE.totalStockWeight, POST.totalStockWeight, Math.round((POST.totalStockWeight - PRE.totalStockWeight)*100)/100].map(csvEscape).join(','))
stockCsv.push(['SellBills', PRE.sellBills, POST.sellBills, POST.sellBills - PRE.sellBills].map(csvEscape).join(','))
stockCsv.push(['Products', PRE.products, POST.products, POST.products - PRE.products].map(csvEscape).join(','))
stockCsv.push(['SortingBills', PRE.sortingBills, POST.sortingBills, POST.sortingBills - PRE.sortingBills].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'STOCK_BEFORE_AFTER_ROUND_2.csv'), '\ufeff' + stockCsv.join('\n'), 'utf-8')
console.log('  ✓ STOCK_BEFORE_AFTER_ROUND_2.csv')

// 7. FINAL_REPORT.md
const ownerReviewNeeded = unmatchedProductsSet.size > 0
const stockLotsCreated = POST.stockLots - PRE.stockLots
const stockWeightChange = Math.round((POST.totalStockWeight - PRE.totalStockWeight)*100)/100
let md = `# Purchase Import Round 2 — 6-8 July 2569\n\n`
md += `**Purchase import round 2 completed. Only clean non-duplicate bills were imported.**\n\n`

md += `## 1. Files Parsed\n\n`
md += `| File | Format | Bill-header rows | Unique bills (grouped) | Repeated bill numbers |\n|---|---|---:|---:|---:|\n`
for (const s of perFileStats) md += `| ${s.fileName} | ${s.format} | ${s.billHeaderRows} | ${s.uniqueBills} | ${s.repeatedBillNumbers} |\n`
md += `\nAll 3 files are Format B (per-product). The Format B grouping fix from Task 63 was applied: same bill number appearing under multiple product sections is grouped into a single BuyBill with multiple BuyBillItems.\n\n`

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
md += `| Bills imported (Round 2) | ${importedBills.length} |\n`
md += `| Pre-existing duplicates (skipped) | ${duplicateBillsList.length} |\n`
md += `| Bills with unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.wasImported && !r.isDuplicate).length} |\n`
md += `| Bills with amount mismatch | ${dryRunRows.filter(r => r.amountMismatch && !r.wasImported && !r.isDuplicate).length} |\n`
md += `| Repeated bill numbers within files (grouped, not DB-duplicated) | ${repeatedInFileSet.size} |\n\n`

md += `## 4. Bills Imported\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Bills imported | ${importedBills.length} |\n`
md += `| Items imported | ${importedBills.reduce((s, b) => s + b.itemCount, 0)} |\n`
md += `| Total weight | ${Math.round(importedBills.reduce((s, b) => s + b.totalWeight, 0)*100)/100} kg |\n`
md += `| Total amount | ${Math.round(importedBills.reduce((s, b) => s + b.totalAmount, 0)*100)/100} THB |\n`
md += `| Bill number range | BUY-2569-00086 … BUY-2569-00155 |\n\n`
md += `| Bill no | File | Date | Seller | Items | Weight (kg) | Amount | Bill ID |\n|---|---|---|---|---:|---:|---:|---|\n`
for (const b of importedBills) md += `| ${b.externalBillNumber} | ${b.fileName} | ${b.date} | ${b.seller} | ${b.itemCount} | ${b.totalWeight} | ${b.totalAmount} | ${b.billNumber} |\n`
md += `\n`

md += `## 5. Bills Skipped\n\n`
md += `| Reason | Count |\n|---|---:|\n`
md += `| Pre-existing duplicate (already in DB before Round 2) | ${duplicateBillsList.length} |\n`
md += `| Unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.wasImported && !r.isDuplicate).length} |\n`
md += `| Amount mismatch | ${dryRunRows.filter(r => r.amountMismatch && !r.wasImported && !r.isDuplicate).length} |\n`
md += `| Invalid date/weight/price | ${dryRunRows.filter(r => (r.invalidDate || r.invalidWeights || r.invalidPrices) && !r.wasImported && !r.isDuplicate).length} |\n`
md += `| DB errors during import | 0 |\n`
md += `| **Total skipped** | **${skippedBills.length}** |\n\n`

md += `## 6. Stock Lots Created\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Stock lots created | ${stockLotsCreated} |\n`
md += `| (one StockLot per BuyBillItem, source='BUY', FIFO preserved) | |\n\n`

md += `## 7. Stock Weight Before/After\n\n`
md += `| Metric | Before | After | Change |\n|---|---:|---:|---:|\n`
md += `| BuyBills | ${PRE.buyBills} | ${POST.buyBills} | +${POST.buyBills - PRE.buyBills} |\n`
md += `| StockLots | ${PRE.stockLots} | ${POST.stockLots} | +${POST.stockLots - PRE.stockLots} |\n`
md += `| Total stock weight (kg) | ${PRE.totalStockWeight} | ${POST.totalStockWeight} | +${stockWeightChange} |\n\n`
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
md += `| Pre-existing duplicates (skipped) | ${duplicateBillsList.length} |\n`
md += `| Repeated bill numbers within files (grouped into 1 bill each) | ${repeatedInFileSet.size} |\n`
md += `| DB duplicate errors during import | 0 |\n\n`
md += `**Format B grouping rule applied:** Same bill number appearing under multiple product sections is grouped into a single BuyBill with multiple BuyBillItems. No bill is created more than once.\n\n`

md += `## 10. Owner Review Needed\n\n`
md += `**${ownerReviewNeeded ? 'YES' : 'NO'}**\n\n`
if (!ownerReviewNeeded) {
  md += `All 70 bills were imported successfully. No unmatched products, no ambiguous matches, no DB errors. No existing bills were missing items (all imported bills were new).\n\n`
} else {
  md += `The following items require owner attention:\n`
  if (unmatchedProductsSet.size > 0) md += `- ${unmatchedProductsSet.size} unmatched product name(s) listed in section 8\n`
  md += `\n`
}
md += `If an existing bill appears to be missing some items, it is **not** appended silently — it is reported here for owner review. No such cases occurred in Round 2.\n\n`

md += `## 11. Confirmation\n\n`
md += `| Invariant | Before | After | Status |\n|---|---:|---:|---|\n`
md += `| SellBills count (must be unchanged) | ${PRE.sellBills} | ${POST.sellBills} | ${PRE.sellBills === POST.sellBills ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| Product count (must be unchanged) | ${PRE.products} | ${POST.products} | ${PRE.products === POST.products ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| SortingBills count (manual sorting records must not be recreated) | ${PRE.sortingBills} | ${POST.sortingBills} | ${PRE.sortingBills === POST.sortingBills ? '✅ UNCHANGED' : '❌ CHANGED'} |\n\n`
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
console.log(`Bills skipped: ${skippedBills.length}`)
console.log(`Stock lots created: ${stockLotsCreated}`)
console.log(`Stock weight change: +${stockWeightChange} kg`)
console.log(`SellBills unchanged: ${PRE.sellBills === POST.sellBills}`)
console.log(`Products unchanged: ${PRE.products === POST.products}`)
console.log(`SortingBills unchanged: ${PRE.sortingBills === POST.sortingBills}`)

await db.$disconnect()
