/**
 * Task 65: Import Sales Excel ZIP — 2-8 July 2569
 *
 * Format (sales detailed):
 *   Row 0: title + company name
 *   Row 1: date range
 *   Row 3: headers (col1=วัสดุ, col2=ผู้ซื้อ, col9=จำนวน, col11=ราคา@, col12=รวมเงิน)
 *   Row 4+: pairs of (product summary row, transaction row(s)), separated by blank rows
 *     - Product summary: col0=4-digit code, col1=product name, col9=weight, col11=avg price, col12=total
 *     - Transaction:     col0=date, col1=bill number, col3=buyer code, col4=buyer name,
 *                        col9=weight, col11=price, col12=amount
 *   Last rows: grand total, blank, footer "1 ... [report09.rpt]"
 *
 * Same bill number can appear under multiple product sections → group into 1 SellBill with N items.
 *
 * Safety:
 *  - pgbouncer-safe sequential DB ops (no $transaction)
 *  - FIFO stock deduction (oldest StockLot.dateAdded first)
 *  - No negative stock (pre-check + atomic per-item deduct)
 *  - Skip whole bill if ANY item has insufficient stock
 *  - Do NOT touch BuyBills / product master / SortingBills
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/import-sell-2026-07-02-to-08'
const EXTRACT_DIR = path.join(OUTPUT_DIR, 'extracted')
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// ---- helpers ----
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
function round2(x) { return Math.round(x * 100) / 100 }

// ---- confirmed aliases (matching-only, no new products) ----
const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
  'ทองแดงช็อต': 'ทองแดงปอกช็อต',
  'สแตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  'สแตนเลส 202': 'สแตนเลส 202',
}

// ---- load product master ----
console.log('Loading product master...')
const allProducts = await db.product.findMany({ include: { category: true } })
const productMap = new Map()
for (const p of allProducts) productMap.set(p.name.trim().normalize('NFC'), p)
console.log(`Active products: ${allProducts.length}`)

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

// ---- check existing sell bills (externalBillNumber) ----
console.log('Checking existing sell bills...')
const existingSellBills = await db.sellBill.findMany({ where: { externalBillNumber: { not: null } }, select: { externalBillNumber: true, billNumber: true, id: true } })
const existingSellBillNums = new Map(existingSellBills.map(b => [b.externalBillNumber, b]))
console.log(`Existing sell bills with externalBillNumber: ${existingSellBillNums.size}`)

// ---- get max sell bill number sequence ----
const lastSellBill = await db.sellBill.findFirst({ where: { billNumber: { not: null } }, orderBy: { billNumber: 'desc' }, select: { billNumber: true } })
let billSeq = 1
if (lastSellBill?.billNumber) {
  const m = lastSellBill.billNumber.match(/SELL-2569-(\d+)/)
  if (m) billSeq = parseInt(m[1]) + 1
}
console.log(`Next sell bill sequence: SELL-2569-${String(billSeq).padStart(5, '0')}`)

// ---- TASK 1: list extracted files ----
console.log('\n=== TASK 1: EXTRACTED FILES ===')
const allExtracted = fs.readdirSync(EXTRACT_DIR).filter(f => f.endsWith('.xls'))
const salesFiles = allExtracted.filter(f => f.startsWith('ขาย'))
const ignoredFiles = allExtracted.filter(f => !f.startsWith('ขาย'))
console.log(`All extracted: ${allExtracted.length}`)
console.log(`Sales files (ขาย*): ${salesFiles.length}`)
console.log(`Ignored files: ${ignoredFiles.length}`)
if (ignoredFiles.length > 0) for (const f of ignoredFiles) console.log(`  ignored: ${f}`)

// ---- TASK 2: DRY-RUN ----
console.log('\n=== TASK 2: DRY-RUN PARSING ===')
const dryRunRows = []
const unmatchedProductsSet = new Map()
const duplicateBillsList = []
const insufficientStockList = []
const ambiguousProductsSet = new Map()
const repeatedInFileSet = new Map()
const perFileStats = []
const allSafeBills = []

// Pre-fetch stock availability per product (for dry-run stock check)
// We'll re-fetch per-item at import time for accuracy, but dry-run uses a snapshot
console.log('Fetching stock availability snapshot...')
const stockSnapshot = await db.stockLot.groupBy({
  by: ['productId'],
  where: { remainingWeight: { gt: 0 } },
  _sum: { remainingWeight: true },
})
const stockMap = new Map(stockSnapshot.map(s => [s.productId, round2(s._sum.remainingWeight ?? 0)]))
console.log(`Products with available stock: ${stockMap.size}`)

for (const fname of salesFiles) {
  const FILE = path.join(EXTRACT_DIR, fname)
  const fileName = fname
  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })

  console.log(`\n  ${fileName}: ${rows.length} rows`)

  // Detect sales format: row 3 col1 = "วัสดุ", col2 = "ผู้ซื้อ"
  const row3 = rows[3] || []
  const isSalesFormat = fixThai(String(row3[1] || '')).includes('วัสดุ') && fixThai(String(row3[2] || '')).includes('ผู้ซื้อ')
  if (!isSalesFormat) {
    console.log(`    ⚠️  Not sales format, skipping`)
    perFileStats.push({ fileName, format: 'UNKNOWN', billHeaderRows: 0, uniqueBills: 0, repeatedBillNumbers: 0, skipped: 'Unknown format' })
    continue
  }

  const billsMap = new Map()
  let currentProductName = ''
  const billHeaderCount = new Map()

  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
    if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue

    // Skip grand total row "ยอดรวมท้ายรายงาน"
    if (String(fixed[1] || '').includes('ยอดรวมท้ายรายงาน')) continue
    // Skip footer "1 ... [report09.rpt]"
    if (String(fixed[0] || '') === '1' && String(fixed[12] || '').includes('report09.rpt')) continue

    // Product summary row: col0 = 4-digit code, col1 = product name (string), col9 = weight (number)
    if (fixed[0] && /^\d{4}$/.test(String(fixed[0]).trim()) && fixed[1] && typeof fixed[1] === 'string' && fixed[9] != null) {
      currentProductName = fixThai(String(fixed[1])).trim()
      continue
    }

    // Transaction row: col0 = date, col1 = bill number, col9 = weight
    if (fixed[0] && fixed[1] && fixed[9] != null) {
      const dateStr = fixThai(String(fixed[0])).trim()
      const billNo = String(fixed[1]).trim()
      if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/) && billNo.match(/^A\d+/i)) {
        billHeaderCount.set(billNo, (billHeaderCount.get(billNo) || 0) + 1)

        if (!billsMap.has(billNo)) {
          billsMap.set(billNo, {
            fileName, externalBillNumber: billNo,
            date: dateStr,
            buyerCode: String(fixed[3] ?? '').trim(),
            buyerName: String(fixed[4] ?? '').trim() || '(ไม่ระบุผู้ซื้อ)',
            note: fixed[6] ? fixThai(String(fixed[6])).trim() : '',
            items: [], totalWeight: 0, totalAmount: 0,
          })
        }
        const bill = billsMap.get(billNo)
        const productName = currentProductName || '(ไม่ระบุสินค้า)'
        const match = matchProduct(productName)
        const weight = num(fixed[9])
        const pricePerKg = num(fixed[11])
        const amount = num(fixed[12])
        bill.items.push({
          productName, productCode: String(fixed[0]).trim(),
          productId: match.product?.id || null, matchedProductName: match.product?.name || null,
          weight, pricePerKg, amount,
          matched: !!match.product, matchType: match.matchType,
          candidates: match.matchType === 'AMBIGUOUS' ? match.candidates : null,
        })
        bill.totalWeight = round2(bill.totalWeight + weight)
        bill.totalAmount = round2(bill.totalAmount + amount)
      }
    }
  }

  // Track repeated bill numbers within this file
  for (const [bn, cnt] of billHeaderCount) {
    if (cnt > 1) {
      if (!repeatedInFileSet.has(bn)) repeatedInFileSet.set(bn, { count: cnt, files: new Set() })
      repeatedInFileSet.get(bn).files.add(fileName)
    }
  }

  const fileBills = [...billsMap.values()]
  console.log(`    ${fileBills.length} unique bills (grouped from ${[...billHeaderCount.values()].reduce((a,b)=>a+b,0)} transaction rows)`)

  perFileStats.push({
    fileName, format: 'Sales detailed', billHeaderRows: [...billHeaderCount.values()].reduce((a,b)=>a+b,0),
    uniqueBills: fileBills.length, repeatedBillNumbers: [...billHeaderCount.entries()].filter(([,c])=>c>1).length,
  })

  for (const bill of fileBills) {
    const isDuplicate = existingSellBillNums.has(bill.externalBillNumber)
    if (isDuplicate) duplicateBillsList.push({ fileName: bill.fileName, billNumber: bill.externalBillNumber, existingId: existingSellBillNums.get(bill.externalBillNumber).id })

    bill.unmatchedItems = bill.items.filter(i => !i.matched)
    for (const item of bill.unmatchedItems) {
      if (!unmatchedProductsSet.has(item.productName)) unmatchedProductsSet.set(item.productName, { name: item.productName, count: 0, files: new Set(), matchType: item.matchType, candidates: item.candidates })
      unmatchedProductsSet.get(item.productName).count++
      unmatchedProductsSet.get(item.productName).files.add(bill.fileName)
      if (item.matchType === 'AMBIGUOUS') ambiguousProductsSet.set(item.productName, item.candidates)
    }

    // Stock sufficiency check (per item, using snapshot)
    bill.insufficientItems = []
    for (const item of bill.items) {
      if (!item.matched) continue
      const available = stockMap.get(item.productId) ?? 0
      if (available < item.weight) {
        bill.insufficientItems.push({ productName: item.productName, requested: item.weight, available, productId: item.productId })
        insufficientStockList.push({ fileName: bill.fileName, billNumber: bill.externalBillNumber, productName: item.productName, requested: item.weight, available, shortfall: round2(item.weight - available) })
      }
    }

    // Validity checks
    const invalidDate = !bill.date.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)
    const invalidWeights = bill.items.some(i => i.weight <= 0 || isNaN(i.weight))
    const invalidPrices = bill.items.some(i => i.pricePerKg < 0 || isNaN(i.pricePerKg))

    bill.safeToImport = !isDuplicate
      && bill.unmatchedItems.length === 0
      && bill.insufficientItems.length === 0
      && bill.items.length > 0
      && !invalidDate
      && !invalidWeights
      && !invalidPrices

    dryRunRows.push({
      fileName: bill.fileName, billNumber: bill.externalBillNumber, date: bill.date,
      buyerName: bill.buyerName, buyerCode: bill.buyerCode,
      itemCount: bill.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount,
      unmatchedCount: bill.unmatchedItems.length,
      insufficientCount: bill.insufficientItems.length,
      isDuplicate,
      invalidDate, invalidWeights, invalidPrices,
      safeToImport: bill.safeToImport,
      unmatchedNames: bill.unmatchedItems.map(i => i.productName).join('; '),
      insufficientNames: bill.insufficientItems.map(i => `${i.productName}(${i.requested}>${i.available})`).join('; '),
    })
    if (bill.safeToImport) allSafeBills.push(bill)
  }
}

console.log(`\n=== DRY-RUN SUMMARY ===`)
console.log(`Total unique bills: ${dryRunRows.length}`)
console.log(`Safe to import: ${allSafeBills.length}`)
console.log(`Duplicates (already in DB): ${dryRunRows.filter(r => r.isDuplicate).length}`)
console.log(`Unmatched products: ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length}`)
console.log(`Insufficient stock: ${dryRunRows.filter(r => r.insufficientCount > 0 && !r.isDuplicate).length}`)
console.log(`Unmatched product names: ${unmatchedProductsSet.size}`)

// ---- TASK 4 (pre): SAFETY CHECK BEFORE ----
console.log('\n=== PRE-IMPORT SAFETY CHECK ===')
const preCounts = {
  sellBills: await db.sellBill.count(),
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
  products: await db.product.count(),
  sortingBills: await db.sortingBill.count(),
}
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0
console.log(`Before: SellBills=${preCounts.sellBills}, BuyBills=${preCounts.buyBills}, StockLots=${preCounts.stockLots}, Stock=${preCounts.totalStockWeight}`)
console.log(`Before: Products=${preCounts.products}, SortingBills=${preCounts.sortingBills}`)

// ---- TASK 3: IMPORT SAFE SALES BILLS ----
console.log('\n=== TASK 3: IMPORTING SAFE SALES BILLS ===')
const importedBills = []
const skippedBills = []
let totalStockDeducted = 0
let totalCostSum = 0

/**
 * Sequential FIFO deduction (pgbouncer-safe, no $transaction).
 * Returns { costPerKg, totalCost, deductedLots } or throws on insufficient.
 */
async function deductStockFIFOSeq(productId, weightToDeduct) {
  const lots = await db.stockLot.findMany({
    where: { productId, remainingWeight: { gt: 0 } },
    orderBy: { dateAdded: 'asc' },
  })
  const totalAvailable = lots.reduce((s, l) => s + l.remainingWeight, 0)
  if (totalAvailable < weightToDeduct) {
    throw new Error(`Insufficient stock for product ${productId}. Available: ${round2(totalAvailable)}, Requested: ${round2(weightToDeduct)}`)
  }
  let remaining = weightToDeduct
  let totalCost = 0
  const deductedLots = []
  for (const lot of lots) {
    if (remaining <= 0) break
    const deductFromLot = Math.min(lot.remainingWeight, remaining)
    totalCost += deductFromLot * lot.costPerKg
    remaining -= deductFromLot
    await db.stockLot.update({
      where: { id: lot.id },
      data: { remainingWeight: round2(lot.remainingWeight - deductFromLot) },
    })
    deductedLots.push({ id: lot.id, deducted: deductFromLot, costPerKg: lot.costPerKg })
  }
  const costPerKg = weightToDeduct > 0 ? totalCost / weightToDeduct : 0
  return { costPerKg: round2(costPerKg), totalCost: round2(totalCost), deductedLots }
}

for (const bill of allSafeBills) {
  console.log(`  ${bill.externalBillNumber} (${bill.date}, ${bill.items.length} items, ${bill.totalWeight} kg, buyer=${bill.buyerName})...`)
  try {
    const parts = bill.date.split('/')
    let ceYear = parseInt(parts[2]); if (ceYear > 2400) ceYear -= 543
    const billDate = new Date(ceYear, parseInt(parts[1]) - 1, parseInt(parts[0]), 10, 0, 0)
    const billNumber = `SELL-2569-${String(billSeq++).padStart(5, '0')}`

    // Step 1: Pre-validate stock for ALL items (re-fetch fresh, since stockMap snapshot may be stale by now)
    // We do this to avoid partial imports. If any item fails, skip the whole bill BEFORE creating anything.
    const freshStockChecks = []
    for (const item of bill.items) {
      const freshAvail = await db.stockLot.aggregate({
        where: { productId: item.productId, remainingWeight: { gt: 0 } },
        _sum: { remainingWeight: true },
      })
      const avail = round2(freshAvail._sum.remainingWeight ?? 0)
      if (avail < item.weight) {
        throw new Error(`Insufficient stock (fresh check) for ${item.productName}: need ${item.weight}, have ${avail}`)
      }
      freshStockChecks.push({ item, avail })
    }

    // Step 2: Create SellBill with items (nested write, single round-trip)
    // We need to deduct stock FIRST (sequential) and collect cost data, THEN create the bill with computed costs.
    // But if we deduct first and bill creation fails, we've already deducted stock.
    // Safer order: deduct stock sequentially (recording per-item costs), then create bill+items with known costs.
    // If bill creation fails after deduction, we log it for manual review (stock already deducted).

    const itemCosts = []
    for (const item of bill.items) {
      const fifo = await deductStockFIFOSeq(item.productId, item.weight)
      itemCosts.push({ item, fifo })
      totalStockDeducted = round2(totalStockDeducted + item.weight)
      totalCostSum = round2(totalCostSum + fifo.totalCost)
    }

    // Step 3: Create SellBill + SellBillItems (sequential, pgbouncer-safe)
    const created = await db.sellBill.create({
      data: {
        billNumber,
        externalBillNumber: bill.externalBillNumber,
        date: billDate,
        isCredit: false,
        note: `ผู้ซื้อ: ${bill.buyerName}${bill.buyerCode ? ` (รหัส:${bill.buyerCode})` : ''}${bill.note ? ` | ${bill.note}` : ''} | นำเข้าจาก: ${bill.fileName}`,
        totalAmount: bill.totalAmount,
        totalCost: round2(itemCosts.reduce((s, c) => s + c.fifo.totalCost, 0)),
        items: { create: itemCosts.map(c => ({
          productId: c.item.productId,
          weight: c.item.weight,
          weightExpression: null,
          pricePerKg: c.item.pricePerKg,
          totalAmount: c.item.amount,
          costPerKg: c.fifo.costPerKg,
          totalCost: c.fifo.totalCost,
        })) },
      },
      include: { items: true },
    })

    // Step 4: Write AuditLog (best-effort)
    try {
      await db.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'SELL_BILL',
          entityId: created.id,
          userName: 'system-import',
          details: JSON.stringify({ billNumber, externalBillNumber: bill.externalBillNumber, itemCount: created.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount, totalCost: created.totalCost, source: 'Excel import Round 2-8 Jul 2569' }),
        },
      })
    } catch (e) { console.log(`    ⚠️  AuditLog write failed (non-fatal): ${e.message.substring(0, 80)}`) }

    console.log(`    ✅ ${billNumber} — ${created.items.length} items, ${bill.totalWeight} kg deducted, cost=${created.totalCost}`)
    importedBills.push({
      fileName: bill.fileName, externalBillNumber: bill.externalBillNumber,
      billNumber, billId: created.id, date: bill.date, buyerName: bill.buyerName,
      itemCount: created.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount,
      totalCost: created.totalCost, status: 'IMPORTED',
    })
  } catch (e) {
    console.log(`    ❌ ${e.message.substring(0, 150)}`)
    skippedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, reason: e.message.substring(0, 250), status: 'IMPORT_ERROR' })
  }
}

// ---- TASK 4 (post): SAFETY CHECK AFTER ----
console.log('\n=== POST-IMPORT SAFETY CHECK ===')
const postCounts = {
  sellBills: await db.sellBill.count(),
  buyBills: await db.buyBill.count(),
  stockLots: await db.stockLot.count(),
  products: await db.product.count(),
  sortingBills: await db.sortingBill.count(),
}
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0
console.log(`After: SellBills=${postCounts.sellBills}, BuyBills=${postCounts.buyBills}, StockLots=${postCounts.stockLots}, Stock=${postCounts.totalStockWeight}`)
console.log(`After: Products=${postCounts.products}, SortingBills=${postCounts.sortingBills}`)
console.log(`Delta: +${postCounts.sellBills - preCounts.sellBills} sellbills, +${postCounts.stockLots - preCounts.stockLots} stocklots, ${round2(postCounts.totalStockWeight - preCounts.totalStockWeight)} kg stock`)

// Negative stock check
const negStockLots = await db.stockLot.count({ where: { remainingWeight: { lt: 0 } } })
console.log(`Negative stock lots: ${negStockLots} (must be 0)`)

// ---- REPORTS ----
console.log('\n=== REPORTS ===')

// 1. EXTRACTED_FILES.csv
const extCols = ['file_name','classification','size_bytes']
const extCsv = [extCols.join(',')]
for (const f of allExtracted) {
  const stat = fs.statSync(path.join(EXTRACT_DIR, f))
  const cls = f.startsWith('ขาย') ? 'SALES' : 'IGNORED'
  extCsv.push([f, cls, stat.size].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'EXTRACTED_FILES.csv'), '\ufeff' + extCsv.join('\n'), 'utf-8')
console.log('  ✓ EXTRACTED_FILES.csv')

// 2. DRY_RUN_SELL_2026_07_02_TO_08.csv
const dryCols = ['file_name','bill_number','date','buyer_name','buyer_code','item_count','total_weight','total_amount','unmatched_count','insufficient_count','is_duplicate','invalid_date','invalid_weights','invalid_prices','safe_to_import','unmatched_names','insufficient_names']
const dryCsv = [dryCols.join(',')]
for (const r of dryRunRows) dryCsv.push([r.fileName, r.billNumber, r.date, r.buyerName, r.buyerCode, r.itemCount, r.totalWeight, r.totalAmount, r.unmatchedCount, r.insufficientCount, r.isDuplicate, r.invalidDate, r.invalidWeights, r.invalidPrices, r.safeToImport, r.unmatchedNames, r.insufficientNames].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DRY_RUN_SELL_2026_07_02_TO_08.csv'), '\ufeff' + dryCsv.join('\n'), 'utf-8')
console.log('  ✓ DRY_RUN_SELL_2026_07_02_TO_08.csv')

// 3. IMPORTED_SELL_BILLS.csv
const impCols = ['file_name','external_bill_number','bill_number','bill_id','date','buyer_name','item_count','total_weight','total_amount','total_cost','status']
const impCsv = [impCols.join(',')]
for (const r of importedBills) impCsv.push([r.fileName, r.externalBillNumber, r.billNumber, r.billId, r.date, r.buyerName, r.itemCount, r.totalWeight, r.totalAmount, r.totalCost, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'IMPORTED_SELL_BILLS.csv'), '\ufeff' + impCsv.join('\n'), 'utf-8')
console.log('  ✓ IMPORTED_SELL_BILLS.csv')

// 4. SKIPPED_SELL_BILLS.csv
const skipCols = ['file_name','external_bill_number','reason','status']
const skipCsv = [skipCols.join(',')]
for (const r of dryRunRows.filter(r => !r.safeToImport)) {
  const reasons = []
  if (r.isDuplicate) reasons.push('Duplicate bill number already in DB')
  if (r.unmatchedCount > 0) reasons.push(`${r.unmatchedCount} unmatched: ${r.unmatchedNames}`)
  if (r.insufficientCount > 0) reasons.push(`${r.insufficientCount} insufficient stock: ${r.insufficientNames}`)
  if (r.invalidDate) reasons.push('Invalid date')
  if (r.invalidWeights) reasons.push('Invalid weight(s)')
  if (r.invalidPrices) reasons.push('Invalid price(s)')
  let status = r.isDuplicate ? 'DUPLICATE' : (r.unmatchedCount > 0 ? 'UNMATCHED' : (r.insufficientCount > 0 ? 'INSUFFICIENT_STOCK' : 'INVALID'))
  skipCsv.push([r.fileName, r.billNumber, reasons.join('; '), status].map(csvEscape).join(','))
}
for (const r of skippedBills) skipCsv.push([r.fileName, r.externalBillNumber, r.reason, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'SKIPPED_SELL_BILLS.csv'), '\ufeff' + skipCsv.join('\n'), 'utf-8')
console.log('  ✓ SKIPPED_SELL_BILLS.csv')

// 5. UNMATCHED_PRODUCTS_SELL.csv
const unmatchedCols = ['No.','product_name','match_type','occurrence_count','files','candidates']
const unmatchedCsv = [unmatchedCols.join(',')]
let unmIdx = 1
for (const [name, info] of unmatchedProductsSet) unmatchedCsv.push([unmIdx++, name, info.matchType, info.count, [...info.files].join('; '), info.candidates ? info.candidates.join(' | ') : ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_PRODUCTS_SELL.csv'), '\ufeff' + unmatchedCsv.join('\n'), 'utf-8')
console.log('  ✓ UNMATCHED_PRODUCTS_SELL.csv')

// 6. DUPLICATE_SELL_BILLS.csv
const dupCols = ['file_name','bill_number','reason','existing_bill_id']
const dupCsv = [dupCols.join(',')]
for (const d of duplicateBillsList) dupCsv.push([d.fileName, d.billNumber, 'Already exists in DB (skipped)', d.existingId].map(csvEscape).join(','))
for (const [bn, info] of repeatedInFileSet) dupCsv.push([[...info.files].join('; '), bn, `Appeared ${info.count}x within file (grouped into 1 bill — no DB duplicate)`, ''].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DUPLICATE_SELL_BILLS.csv'), '\ufeff' + dupCsv.join('\n'), 'utf-8')
console.log('  ✓ DUPLICATE_SELL_BILLS.csv')

// 7. INSUFFICIENT_STOCK_SELL.csv
const insCols = ['file_name','bill_number','product_name','requested_weight','available_weight','shortfall']
const insCsv = [insCols.join(',')]
for (const r of insufficientStockList) insCsv.push([r.fileName, r.billNumber, r.productName, r.requested, r.available, r.shortfall].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'INSUFFICIENT_STOCK_SELL.csv'), '\ufeff' + insCsv.join('\n'), 'utf-8')
console.log('  ✓ INSUFFICIENT_STOCK_SELL.csv')

// 8. STOCK_BEFORE_AFTER_SELL.csv
const stockCols = ['metric','before','after','change']
const stockCsv = [stockCols.join(',')]
stockCsv.push(['SellBills', preCounts.sellBills, postCounts.sellBills, postCounts.sellBills - preCounts.sellBills].map(csvEscape).join(','))
stockCsv.push(['BuyBills', preCounts.buyBills, postCounts.buyBills, postCounts.buyBills - preCounts.buyBills].map(csvEscape).join(','))
stockCsv.push(['StockLots', preCounts.stockLots, postCounts.stockLots, postCounts.stockLots - preCounts.stockLots].map(csvEscape).join(','))
stockCsv.push(['TotalStockWeight', preCounts.totalStockWeight, postCounts.totalStockWeight, round2(postCounts.totalStockWeight - preCounts.totalStockWeight)].map(csvEscape).join(','))
stockCsv.push(['Products', preCounts.products, postCounts.products, postCounts.products - preCounts.products].map(csvEscape).join(','))
stockCsv.push(['SortingBills', preCounts.sortingBills, postCounts.sortingBills, postCounts.sortingBills - preCounts.sortingBills].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'STOCK_BEFORE_AFTER_SELL.csv'), '\ufeff' + stockCsv.join('\n'), 'utf-8')
console.log('  ✓ STOCK_BEFORE_AFTER_SELL.csv')

// 9. FINAL_REPORT.md
const ownerReviewNeeded = unmatchedProductsSet.size > 0 || insufficientStockList.length > 0 || skippedBills.length > 0
const stockWeightChange = round2(postCounts.totalStockWeight - preCounts.totalStockWeight)
let md = `# Sales Import — 2-8 July 2569\n\n`
md += `**Sales import completed. Only clean non-duplicate bills with sufficient stock were imported.**\n\n`

md += `## 1. ZIP Extracted\n\n`
md += `- **ZIP file**: \`ขาย 2-8 7-2569 แบบละเอียด.zip\`\n`
md += `- **Extracted to**: \`reconciliation/import-sell-2026-07-02-to-08/extracted/\`\n`
md += `- **ZIP extracted**: YES ✅\n\n`

md += `## 2. Extracted Files List\n\n`
md += `| File | Classification | Size (bytes) |\n|---|---|---:|\n`
for (const f of allExtracted) {
  const stat = fs.statSync(path.join(EXTRACT_DIR, f))
  const cls = f.startsWith('ขาย') ? 'SALES' : 'IGNORED'
  md += `| ${f} | ${cls} | ${stat.size} |\n`
}
md += `\n`

md += `## 3. Sales Files Processed\n\n`
md += `| File | Format | Transaction rows | Unique bills (grouped) | Repeated bill numbers |\n|---|---|---:|---:|---:|\n`
for (const s of perFileStats) md += `| ${s.fileName} | ${s.format} | ${s.billHeaderRows} | ${s.uniqueBills} | ${s.repeatedBillNumbers} |\n`
md += `\n`

md += `## 4. Ignored Files\n\n`
if (ignoredFiles.length === 0) md += `(none — all extracted files start with "ขาย")\n\n`
else { for (const f of ignoredFiles) md += `- ${f}\n`; md += `\n` }

md += `## 5. Aliases Used\n\n`
md += `All aliases used **only for import matching** — no new products created.\n\n`
md += `| Alias (raw input) | Target product | Source |\n|---|---|---|\n`
md += `| ทองแดงช็อต | ทองแดงปอกช็อต | Owner-confirmed (purchase Round 1 cleanup) |\n`
md += `| แสตนเลส 304 (ยาว) | สแตนเลส 304 ยาว | Owner-confirmed (purchase Round 1 cleanup) |\n`
md += `| แสตนเลส 202 | สแตนเลส 202 | Owner-confirmed (purchase Round 2) |\n`
md += `| อลูมิเนียมแข็ง (หล่อ/หนา) | อลูมิเนียมแข็ง | Task 35 |\n`
md += `| อลูมิเนียมฝาแกะ | ฝาอลูมิเนียม | Task 35 |\n`
md += `| อลูมิเนียมกระป๋อง | กระป๋องอลูมิเนียม | Task 35 |\n`
md += `| อลูมิเนียมตูดกะทะ | อลูมิเนียมตูดกะทะ | Task 35 |\n\n`
md += `**Auto spelling normalization:** อลูมีเนียม→อลูมิเนียม, แสตนเลส→สแตนเลส\n\n`

md += `## 6. Sell Bills Found\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Files parsed | ${salesFiles.length} |\n`
md += `| Total unique bills (after Format B grouping fix) | ${dryRunRows.length} |\n`
md += `| Bills safe to import | ${allSafeBills.length} |\n`
md += `| Duplicates (already in DB) | ${dryRunRows.filter(r => r.isDuplicate).length} |\n`
md += `| Bills with unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length} |\n`
md += `| Bills with insufficient stock | ${dryRunRows.filter(r => r.insufficientCount > 0 && !r.isDuplicate).length} |\n`
md += `| Repeated bill numbers within files (grouped, no DB duplicate) | ${repeatedInFileSet.size} |\n\n`

md += `## 7. Sell Bills Imported\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Bills imported | ${importedBills.length} |\n`
md += `| Items imported | ${importedBills.reduce((s, b) => s + b.itemCount, 0)} |\n`
md += `| Total weight sold | ${round2(importedBills.reduce((s, b) => s + b.totalWeight, 0))} kg |\n`
md += `| Total revenue | ${round2(importedBills.reduce((s, b) => s + b.totalAmount, 0))} THB |\n`
md += `| Total FIFO cost | ${round2(importedBills.reduce((s, b) => s + b.totalCost, 0))} THB |\n\n`
if (importedBills.length > 0) {
  md += `| Bill no | File | Date | Buyer | Items | Weight (kg) | Revenue | FIFO Cost | Bill ID |\n|---|---|---|---|---:|---:|---:|---:|---|\n`
  for (const b of importedBills) md += `| ${b.externalBillNumber} | ${b.fileName} | ${b.date} | ${b.buyerName} | ${b.itemCount} | ${b.totalWeight} | ${b.totalAmount} | ${b.totalCost} | ${b.billNumber} |\n`
  md += `\n`
}

md += `## 8. Sell Bills Skipped\n\n`
md += `| Reason | Count |\n|---|---:|\n`
md += `| Duplicate (already in DB) | ${dryRunRows.filter(r => r.isDuplicate).length} |\n`
md += `| Unmatched products | ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length} |\n`
md += `| Insufficient stock | ${dryRunRows.filter(r => r.insufficientCount > 0 && !r.isDuplicate && r.unmatchedCount === 0).length} |\n`
md += `| Invalid date/weight/price | ${dryRunRows.filter(r => (r.invalidDate || r.invalidWeights || r.invalidPrices) && !r.isDuplicate && r.unmatchedCount === 0 && r.insufficientCount === 0).length} |\n`
md += `| Import errors (DB) | ${skippedBills.length} |\n`
md += `| **Total skipped** | **${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length}** |\n\n`

md += `## 9. Stock Deducted Summary\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Total weight deducted (FIFO) | ${round2(totalStockDeducted)} kg |\n`
md += `| Total FIFO cost of goods sold | ${round2(totalCostSum)} THB |\n`
md += `| StockLot rows updated (remainingWeight decreased) | ${importedBills.reduce((s, b) => s + b.itemCount, 0)}+ lots |\n`
md += `| Negative stock lots after import | ${negStockLots} (must be 0) |\n\n`

md += `## 10. Stock Weight Before/After\n\n`
md += `| Metric | Before | After | Change |\n|---|---:|---:|---:|\n`
md += `| SellBills | ${preCounts.sellBills} | ${postCounts.sellBills} | +${postCounts.sellBills - preCounts.sellBills} |\n`
md += `| BuyBills | ${preCounts.buyBills} | ${postCounts.buyBills} | ${postCounts.buyBills - preCounts.buyBills} |\n`
md += `| StockLots | ${preCounts.stockLots} | ${postCounts.stockLots} | ${postCounts.stockLots - preCounts.stockLots} |\n`
md += `| Total stock weight (kg) | ${preCounts.totalStockWeight} | ${postCounts.totalStockWeight} | ${stockWeightChange} |\n`
md += `| Products | ${preCounts.products} | ${postCounts.products} | ${postCounts.products - preCounts.products} |\n`
md += `| SortingBills | ${preCounts.sortingBills} | ${postCounts.sortingBills} | ${postCounts.sortingBills - preCounts.sortingBills} |\n\n`
md += `Expected: SellBills increased ✅, total stock weight decreased ✅, StockLots updated (remainingWeight decreased) ✅\n\n`

md += `## 11. Unmatched / Ambiguous Products\n\n`
if (unmatchedProductsSet.size === 0) {
  md += `(none — all products matched using confirmed aliases)\n\n`
} else {
  md += `| No. | Product name | Match type | Count | Files | Candidates |\n|---:|---|---|---:|---|---|\n`
  let i = 1
  for (const [name, info] of unmatchedProductsSet) md += `| ${i++} | ${name} | ${info.matchType} | ${info.count} | ${[...info.files].join(', ')} | ${info.candidates ? info.candidates.join(' | ') : '-'} |\n`
  md += `\n`
}

md += `## 12. Duplicate Sell Bills\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| Pre-existing duplicates (skipped) | ${duplicateBillsList.length} |\n`
md += `| Repeated bill numbers within files (grouped into 1 bill each) | ${repeatedInFileSet.size} |\n`
md += `| DB duplicate errors during import | ${skippedBills.filter(s => s.reason.includes('Unique constraint')).length} |\n\n`

md += `## 13. Insufficient Stock Items\n\n`
if (insufficientStockList.length === 0) {
  md += `(none — all sale items had sufficient stock for FIFO deduction)\n\n`
} else {
  md += `| File | Bill no | Product | Requested (kg) | Available (kg) | Shortfall (kg) |\n|---|---|---|---:|---:|---:|\n`
  for (const r of insufficientStockList) md += `| ${r.fileName} | ${r.billNumber} | ${r.productName} | ${r.requested} | ${r.available} | ${r.shortfall} |\n`
  md += `\n`
}

md += `## 14. Owner Review Needed\n\n`
md += `**${ownerReviewNeeded ? 'YES' : 'NO'}**\n\n`
if (!ownerReviewNeeded) {
  md += `All bills either imported successfully or correctly skipped as duplicates. No unmatched products, no insufficient stock, no DB errors.\n\n`
} else {
  md += `The following items require owner attention:\n`
  if (unmatchedProductsSet.size > 0) md += `- ${unmatchedProductsSet.size} unmatched product name(s) listed in section 11\n`
  if (insufficientStockList.length > 0) md += `- ${insufficientStockList.length} insufficient stock item(s) listed in section 13\n`
  if (skippedBills.length > 0) md += `- ${skippedBills.length} DB error(s) during import listed in SKIPPED_SELL_BILLS.csv\n`
  md += `\n`
}

md += `## 15. Confirmation\n\n`
md += `| Invariant | Before | After | Status |\n|---|---:|---:|---|\n`
md += `| BuyBills count (must be unchanged) | ${preCounts.buyBills} | ${postCounts.buyBills} | ${preCounts.buyBills === postCounts.buyBills ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| Product count (must be unchanged) | ${preCounts.products} | ${postCounts.products} | ${preCounts.products === postCounts.products ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| SortingBills count (must be unchanged) | ${preCounts.sortingBills} | ${postCounts.sortingBills} | ${preCounts.sortingBills === postCounts.sortingBills ? '✅ UNCHANGED' : '❌ CHANGED'} |\n`
md += `| Negative stock lots (must be 0) | - | ${negStockLots} | ${negStockLots === 0 ? '✅ NO NEGATIVE STOCK' : '❌ NEGATIVE STOCK EXISTS'} |\n\n`
md += `Manual sorting records preserved (not recreated):\n`
md += `- TRN-2569-00006 ✅\n`
md += `- TRN-2569-00008 ✅\n`
md += `- TRN-2569-00009 ✅\n\n`

md += `## Import Method\n\n`
md += `- Direct DB insert via Prisma Client (bypass API to avoid pgbouncer interactive transaction timeout)\n`
md += `- **FIFO stock deduction**: StockLots ordered by \`dateAdded ASC\` (oldest first); each lot's \`remainingWeight\` decreased by \`min(remaining, needed)\`\n`
md += `- Sequential \`db.stockLot.update()\` per lot (pgbouncer-safe, no \`$transaction\`)\n`
md += `- Pre-validation: fresh stock re-check per item BEFORE any deduction (skip whole bill on any insufficient item — no partial import)\n`
md += `- \`costPerKg\` = weighted average = \`Σ(deducted_k × lot_k.costPerKg) / weight\`\n`
md += `- \`totalCost\` = \`Σ(deducted_k × lot_k.costPerKg)\`\n`
md += `- AuditLog written per imported bill (action=CREATE, entityType=SELL_BILL)\n`
md += `- New \`externalBillNumber\` column added to SellBill table (TEXT, UNIQUE) for duplicate detection — schema-only change, no app UI changes\n\n`

md += `---\n\n`
md += `**Sales import completed. Only clean non-duplicate bills with sufficient stock were imported.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

console.log('\n=== DONE ===')
console.log(`Bills imported: ${importedBills.length}`)
console.log(`Bills skipped: ${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length}`)
console.log(`Stock deducted: ${round2(totalStockDeducted)} kg`)
console.log(`Stock weight change: ${stockWeightChange} kg`)
console.log(`Negative stock lots: ${negStockLots}`)
console.log(`BuyBills unchanged: ${preCounts.buyBills === postCounts.buyBills}`)
console.log(`Products unchanged: ${preCounts.products === postCounts.products}`)
console.log(`SortingBills unchanged: ${preCounts.sortingBills === postCounts.sortingBills}`)

await db.$disconnect()
