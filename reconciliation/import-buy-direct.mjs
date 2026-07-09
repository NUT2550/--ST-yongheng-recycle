/**
 * Import safe bills directly via DB (bypass API to avoid pgbouncer transaction timeout)
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
}

console.log('Loading product master...')
const allProducts = await db.product.findMany({ include: { category: true } })
const productMap = new Map()
for (const p of allProducts) productMap.set(p.name.trim().normalize('NFC'), p)

function matchProduct(rawName) {
  const normalizedInput = rawName.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
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
console.log('Checking existing...')
const existingBills = await db.buyBill.findMany({ where: { externalBillNumber: { not: null } }, select: { externalBillNumber: true } })
const existingBillNums = new Set(existingBills.map(b => b.externalBillNumber))

// Get max bill number sequence
const lastBuyBill = await db.buyBill.findFirst({ where: { billNumber: { not: null } }, orderBy: { billNumber: 'desc' }, select: { billNumber: true } })
let billSeq = 1
if (lastBuyBill?.billNumber) {
  const m = lastBuyBill.billNumber.match(/BUY-2569-(\d+)/)
  if (m) billSeq = parseInt(m[1]) + 1
}
console.log(`Next bill sequence: BUY-2569-${String(billSeq).padStart(5, '0')}`)

// ============ PARSE ============
console.log('\n=== PARSING ===')
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
  
  let currentBill = null, currentSeller = '', currentProductName = ''
  const fileBills = []
  
  for (let i = 4; i < rows.length; i++) {
    const r = rows[i] || []
    const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
    if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
    
    if (isFormatA) {
      if (fixed[0] && fixed[1] && !fixed[2] && fixed[9] == null) { currentSeller = fixThai(String(fixed[1])); continue }
      if (fixed[1] && fixed[2] && String(fixed[2]).trim().match(/^A\d+/i) && fixed[12] != null) {
        if (currentBill) fileBills.push(currentBill)
        currentBill = { fileName, externalBillNumber: String(fixed[2]).trim(), seller: currentSeller, date: fixThai(String(fixed[1])).trim(), note: fixed[4] ? fixThai(String(fixed[4])).trim() : '', items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: num(fixed[12]) }
        continue
      }
      if (fixed[2] && fixed[3] && fixed[9] != null && currentBill) {
        const productName = fixThai(String(fixed[3])).trim()
        const match = matchProduct(productName)
        currentBill.items.push({ productName, productCode: String(fixed[2]).trim(), productId: match.product?.id || null, matchedProductName: match.product?.name || null, weight: num(fixed[9]), pricePerKg: num(fixed[11]), amount: num(fixed[12]), matched: !!match.product })
        currentBill.totalWeight += num(fixed[9]); currentBill.totalAmount += num(fixed[12])
      }
    } else {
      if (fixed[0] && /^\d{4}$/.test(String(fixed[0]).trim()) && fixed[1] && typeof fixed[1] === 'string' && fixed[9] != null) {
        currentProductName = fixThai(String(fixed[1])).trim(); continue
      }
      if (fixed[0] && fixed[1] && fixed[9] != null) {
        const dateStr = fixThai(String(fixed[0])).trim()
        const billNo = String(fixed[1]).trim()
        if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
          if (!currentBill || currentBill.externalBillNumber !== billNo) {
            if (currentBill) fileBills.push(currentBill)
            currentBill = { fileName, externalBillNumber: billNo, seller: String(fixed[3] ?? '').trim() || String(fixed[2] ?? '').trim(), date: dateStr, note: fixed[6] ? fixThai(String(fixed[6])).trim() : '', items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: 0 }
          }
          const productName = currentProductName || '(ไม่ระบุสินค้า)'
          const match = matchProduct(productName)
          currentBill.items.push({ productName, productCode: String(fixed[0]).trim(), productId: match.product?.id || null, matchedProductName: match.product?.name || null, weight: num(fixed[9]), pricePerKg: num(fixed[11]), amount: num(fixed[12]), matched: !!match.product })
          currentBill.totalWeight += num(fixed[9]); currentBill.totalAmount += num(fixed[12])
        }
      }
    }
  }
  if (currentBill) fileBills.push(currentBill)
  
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

console.log(`Bills found: ${dryRunRows.length}, Safe: ${allBills.length}, Dup: ${dryRunRows.filter(r => r.isDuplicate).length}, Unmatched: ${dryRunRows.filter(r => r.unmatchedCount > 0 && !r.isDuplicate).length}`)

// ============ IMPORT DIRECTLY VIA DB ============
console.log('\n=== IMPORTING VIA DB ===')
const preCounts = { buyBills: await db.buyBill.count(), stockLots: await db.stockLot.count() }
const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0

const importedBills = []
const skippedBills = []

for (const bill of allBills) {
  console.log(`  ${bill.externalBillNumber} (${bill.date}, ${bill.items.length} items)...`)
  try {
    // Parse date
    const parts = bill.date.split('/')
    let ceYear = parseInt(parts[2]); if (ceYear > 2400) ceYear -= 543
    const billDate = new Date(ceYear, parseInt(parts[1]) - 1, parseInt(parts[0]), 10, 0, 0)
    
    // Generate bill number
    const billNumber = `BUY-2569-${String(billSeq++).padStart(5, '0')}`
    
    // Create BuyBill (sequential, pgbouncer-safe)
    const created = await db.buyBill.create({
      data: {
        billNumber,
        externalBillNumber: bill.externalBillNumber,
        date: billDate,
        isCredit: false,
        note: `ผู้ขาย: ${bill.seller}${bill.note ? ` | ${bill.note}` : ''} | นำเข้าจาก: ${bill.fileName}`,
        totalAmount: bill.totalAmount,
        items: { create: bill.items.filter(i => i.matched).map(i => ({
          productId: i.productId,
          weight: i.weight,
          pricePerKg: i.pricePerKg,
          totalAmount: i.amount,
        })) },
      },
      include: { items: true },
    })
    
    // Create StockLots sequentially (pgbouncer-safe)
    for (const item of created.items) {
      await db.stockLot.create({
        data: {
          productId: item.productId,
          remainingWeight: item.weight,
          costPerKg: item.pricePerKg,
          dateAdded: billDate,
          source: 'BUY',
          sourceId: created.id,
        },
      })
    }
    
    console.log(`    ✅ ${billNumber} (${created.id}) — ${created.items.length} items, ${bill.totalWeight} kg`)
    importedBills.push({
      fileName: bill.fileName, externalBillNumber: bill.externalBillNumber,
      billNumber, billId: created.id, date: bill.date, seller: bill.seller,
      itemCount: created.items.length, totalWeight: bill.totalWeight, totalAmount: bill.totalAmount, status: 'IMPORTED',
    })
  } catch (e) {
    console.log(`    ❌ ${e.message}`)
    skippedBills.push({ fileName: bill.fileName, externalBillNumber: bill.externalBillNumber, reason: e.message, status: 'DB_ERROR' })
  }
}

const postCounts = { buyBills: await db.buyBill.count(), stockLots: await db.stockLot.count() }
const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0

console.log(`\nBefore: BuyBills=${preCounts.buyBills}, StockLots=${preCounts.stockLots}, Stock=${preCounts.totalStockWeight}`)
console.log(`After:  BuyBills=${postCounts.buyBills}, StockLots=${postCounts.stockLots}, Stock=${postCounts.totalStockWeight}`)
console.log(`Delta:  +${postCounts.buyBills - preCounts.buyBills} bills, +${postCounts.stockLots - preCounts.stockLots} lots, +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg`)

// ============ REPORTS ============
console.log('\n=== REPORTS ===')

// 1. DRY_RUN
const dryCols = ['file_name','bill_number','date','seller','item_count','total_weight','total_amount','unmatched_count','is_duplicate','amount_diff','safe_to_import','unmatched_names']
const dryCsv = [dryCols.join(',')]
for (const r of dryRunRows) dryCsv.push([r.fileName, r.billNumber, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.unmatchedCount, r.isDuplicate, r.amountDiff, r.safeToImport, r.unmatchedNames].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DRY_RUN_BUY_ROUND_1.csv'), '\ufeff' + dryCsv.join('\n'), 'utf-8')
console.log('  ✓ DRY_RUN_BUY_ROUND_1.csv')

// 2. IMPORTED
const impCols = ['file_name','external_bill_number','bill_number','bill_id','date','seller','item_count','total_weight','total_amount','status']
const impCsv = [impCols.join(',')]
for (const r of importedBills) impCsv.push([r.fileName, r.externalBillNumber, r.billNumber, r.billId, r.date, r.seller, r.itemCount, r.totalWeight, r.totalAmount, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'IMPORTED_BUY_BILLS_ROUND_1.csv'), '\ufeff' + impCsv.join('\n'), 'utf-8')
console.log('  ✓ IMPORTED_BUY_BILLS_ROUND_1.csv')

// 3. SKIPPED
const skipCols = ['file_name','external_bill_number','reason','status']
const skipCsv = [skipCols.join(',')]
for (const r of dryRunRows.filter(r => !r.safeToImport)) {
  let reason = []
  if (r.isDuplicate) reason.push('Duplicate bill number')
  if (r.unmatchedCount > 0) reason.push(`${r.unmatchedCount} unmatched: ${r.unmatchedNames}`)
  skipCsv.push([r.fileName, r.billNumber, reason.join('; '), r.isDuplicate ? 'DUPLICATE' : 'UNMATCHED'].map(csvEscape).join(','))
}
for (const r of skippedBills) skipCsv.push([r.fileName, r.externalBillNumber, r.reason, r.status].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'SKIPPED_BUY_BILLS_ROUND_1.csv'), '\ufeff' + skipCsv.join('\n'), 'utf-8')
console.log('  ✓ SKIPPED_BUY_BILLS_ROUND_1.csv')

// 4. UNMATCHED
const unmatchedCols = ['No.','product_name','occurrence_count','files']
const unmatchedCsv = [unmatchedCols.join(',')]
let unmIdx = 1
for (const [name, info] of unmatchedProductsSet) unmatchedCsv.push([unmIdx++, name, info.count, [...info.files].join('; ')].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_PRODUCTS_ROUND_1.csv'), '\ufeff' + unmatchedCsv.join('\n'), 'utf-8')
console.log('  ✓ UNMATCHED_PRODUCTS_ROUND_1.csv')

// 5. DUPLICATES
const dupCols = ['file_name','bill_number','reason']
const dupCsv = [dupCols.join(',')]
for (const d of duplicateBillsList) dupCsv.push([d.fileName, d.billNumber, 'Already exists in DB'].map(csvEscape).join(','))
fs.writeFileSync(path.join(OUTPUT_DIR, 'DUPLICATE_BILLS_ROUND_1.csv'), '\ufeff' + dupCsv.join('\n'), 'utf-8')
console.log('  ✓ DUPLICATE_BILLS_ROUND_1.csv')

// 6. FINAL_REPORT.md
let md = `# Purchase Import Round 1 — 2-4 July 2569\n\n`
md += `## Summary\n\n| Metric | Value |\n|---|---:|\n`
md += `| Files parsed | ${FILES.length} |\n| Bills found | ${dryRunRows.length} |\n| Bills imported | ${importedBills.length} |\n| Bills skipped | ${dryRunRows.filter(r => !r.safeToImport).length + skippedBills.length} |\n| Stock lots created | ${postCounts.stockLots - preCounts.stockLots} |\n| Stock weight before | ${preCounts.totalStockWeight} kg |\n| Stock weight after | ${postCounts.totalStockWeight} kg |\n| Stock weight change | +${Math.round((postCounts.totalStockWeight - preCounts.totalStockWeight)*100)/100} kg |\n| Unmatched products | ${unmatchedProductsSet.size} |\n| Duplicate bills | ${duplicateBillsList.length} |\n| Owner review needed | ${unmatchedProductsSet.size > 0 ? 'YES' : 'NO'} |\n\n`
md += `## Imported Bills (${importedBills.length})\n\n| Bill no | File | Date | Seller | Items | Weight | Amount | ID |\n|---|---|---|---|---:|---:|---:|---|\n`
for (const b of importedBills) md += `| ${b.externalBillNumber} | ${b.fileName} | ${b.date} | ${b.seller} | ${b.itemCount} | ${b.totalWeight} | ${b.totalAmount} | ${b.billId} |\n`
md += `\n## Skipped Bills\n\n| Bill no | File | Reason |\n|---|---|---|\n`
for (const r of dryRunRows.filter(r => !r.safeToImport)) {
  let reason = []
  if (r.isDuplicate) reason.push('Duplicate')
  if (r.unmatchedCount > 0) reason.push(`${r.unmatchedCount} unmatched: ${r.unmatchedNames}`)
  md += `| ${r.billNumber} | ${r.fileName} | ${reason.join('; ')} |\n`
}
for (const r of skippedBills) md += `| ${r.externalBillNumber} | ${r.fileName} | ${r.reason} |\n`
md += `\n## Unmatched Products\n\n`
if (unmatchedProductsSet.size === 0) md += `(none)\n`
else { md += `| Product | Count | Files |\n|---|---:|---|\n`; for (const [name, info] of unmatchedProductsSet) md += `| ${name} | ${info.count} | ${[...info.files].join(', ')} |\n` }
md += `\n**Purchase import round 1 completed. Only clean non-duplicate bills were imported.**\n`
fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

await db.$disconnect()
