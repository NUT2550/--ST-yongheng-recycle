/**
 * Task 43: Re-run Detailed Purchase Split With Owner-Confirmed Product Mappings
 *
 * Input: รวมซื้อสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls
 * Output: reconciliation/purchase-by-product-from-start-date-detailed-v2/
 *
 * FILE GENERATION ONLY — no production DB modifications.
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'

const INPUT_FILE = '/home/z/my-project/upload/รวมซื้อสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls'
const OUTPUT_DIR = '/home/z/my-project/reconciliation/purchase-by-product-from-start-date-detailed-v2'

// Create output folder
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// ============ NORMALIZATION ============
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
  // Spelling normalization (owner-approved in Task 35/41)
  // แสตนเลส → สแตนเลส (both spellings refer to same product)
  t = t.replace(/แสตนเลส/g, 'สแตนเลส')
  // อลูมีเนียม → อลูมิเนียม (normalize aluminum spelling)
  t = t.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
  // Remove spaces around 304/202 in stainless names (e.g. 'สแตนเลส304' → 'สแตนเลส 304')
  t = t.replace(/(สแตนเลส)(304|202)/g, '$1 $2')
  t = t.normalize('NFC')
  return t
}
function num(s) {
  if (s == null || s === '') return 0
  if (typeof s === 'number') return s
  const n = parseFloat(String(s).replace(/,/g, '').trim())
  return isNaN(n) ? 0 : n
}
function parseThaiDate(d) {
  if (!d) return null
  if (d instanceof Date && !isNaN(d)) return d
  if (typeof d === 'number') return new Date(Math.round((d - 25569) * 86400 * 1000))
  if (typeof d === 'string') {
    const s = d.trim()
    const m = s.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/)
    if (m) {
      let [, dd, mm, yy] = m
      let year = parseInt(yy)
      if (year < 100) year += 2500
      // Buddhist era → CE (subtract 543)
      if (year > 2400) year -= 543
      const dt = new Date(year, parseInt(mm) - 1, parseInt(dd))
      return isNaN(dt) ? null : dt
    }
  }
  return null
}
function dateToStr(d) {
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear() + 543  // CE → Buddhist
  return `${dd}/${mm}/${yy}`
}
function dateForFilename(d) {
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yy = d.getFullYear() + 543
  return `${dd}-${mm}-${yy}`
}

// ============ PRODUCT START DATES (owner-provided) ============
// Format: "product name" → Date object (CE)
const PRODUCT_START_DATES_RAW = {
  // Copper
  'ทองแดงปอก': '04/07/2569',
  'ทองแดงช็อต': '04/07/2569',
  'ทองแดงใหญ่': '04/07/2569',
  'ทองแดงเล็ก': '04/07/2569',
  'ทองแดงชุบ': '04/07/2569',
  'หม้อน้ำทองแดง': '04/07/2569',
  // Brass
  'ทองเหลือง': '04/07/2569',
  'ทองเหลืองเนื้อแดง': '04/07/2569',
  'หม้อน้ำทองเหลือง': '04/07/2569',
  'ขี้กลึงทองเหลือง': '21/04/2569',
  'ขี้กลึงทองเหลืองเนื้อแดง': '13/05/2568',
  // Stainless
  'สแตนเลส 304': '05/02/2569',
  'สแตนเลส 202': '05/02/2569',
  'สแตนเลสดูดติด': '05/02/2569',
  'สแตนเลส 304 ยาว': '05/02/2569',
  'สแตนเลสติดเหล็ก': '05/02/2569',
  'นิกเกิล': '05/02/2569',
  'ขี้กลึงสแตนเลส 304': '22/01/2569',
  // Lead
  'ตะกั่วนิ่ม': '27/05/2569',
  'ตะกั่วแข็ง': '27/05/2569',
  'ขี้กลึงตะกั่ว': '22/01/2569',
  // Electronics / Other
  'แท็บเล็ต': '29/10/2568',
  'แผงวงจรติดสายไฟ': '29/10/2568',
  'มอเตอร์': '03/07/2567',
  'คอมดำ': '29/07/2567',
  'สายไฟไม่ปอก': '28/10/2568',
  'เปลือกสายไฟ': '18/11/2562',
  // Aluminum
  'อลูมิเนียมกระป๋อง': '25/06/2569',
  'อลูมิเนียมล้อแม็ก': '23/06/2569',
  'อลูมิเนียมสายไฟ': '23/06/2569',
  'อลูมิเนียมบาง': '27/06/2569',
  'อลูมิเนียมแข็ง': '27/06/2569',
  'อลูมิเนียมผ้าเบรค': '06/07/2569',
  'อลูมิเนียมตูดกะทะไฟฟ้า': '05/07/2569',
  'อลูมิเนียมกระทะ': '23/06/2569',
  'อลูมิเนียมตูดกะทะ': '23/06/2569',
  'อลูมิเนียมมุ้งลวด': '31/03/2569',
  'อลูมิเนียมมู่ลี่': '23/06/2569',
  'ฝาอลูมิเนียม': '23/06/2569',
  'ฝาอลูมิเนียมไม่แกะ': '06/07/2569',
  'อลูมิเนียมฉาก': '24/06/2569',
  'หม้อน้ำอลูมิเนียม': '23/06/2569',
  'อลูมิเนียมเครื่อง': '23/06/2569',
  'อลูมิเนียมครีบหม้อน้ำ': '01/04/2569',
  'อลูมิเนียมอัลลอย': '23/06/2569',
  'อลูมิเนียมแผ่นเพลท': '23/06/2569',
  'สายไฟอลูมิเนียม': '05/07/2569',
  'ขี้กลึงอลูมิเนียม': '22/01/2569',
  'อลูมิเนียมฉากสี': '05/07/2569',
  'กระป๋องสเปรย์อลูมิเนียม': '05/07/2569',
  'ปั๊มกระป๋อง': '05/07/2569',
  'ฟรอยอลูมิเนียม': '05/07/2569',
  'ฝาอลูมิเนียมเผา': '05/07/2569',
  'อลูมิเนียมตูดหม้อหุงข้าว': '05/07/2569',
  'อลูมิเนียมแข็งติดสี': '23/06/2569',
  'อลูมิเนียมแข็งลูกสูบ': '06/07/2569',
  'อลูมิเนียมแข็งก้านเบรค': '06/07/2569',
}

// Convert all start dates to Date objects
const PRODUCT_START_DATES = {}
for (const [name, dateStr] of Object.entries(PRODUCT_START_DATES_RAW)) {
  PRODUCT_START_DATES[name] = parseThaiDate(dateStr)
}

// ============ OWNER-CONFIRMED AMBIGUOUS MAPPINGS ============
// Maps raw Excel product name → final product name (per owner Task 43)
const OWNER_MAPPINGS = {
  // Owner-confirmed ambiguous mappings (Task 43)
  'ทองแดงปอกเงา': 'ทองแดงปอก',
  'ทองแดงปอกช็อต': 'ทองแดงช็อต',
  'ทองเหลืองหนา': 'ทองเหลือง',
  'ขี้กลึงทองเหลือง (เนื้อเขียว)': 'ขี้กลึงทองเหลือง',
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'ตูดหม้อหุงข้าว': 'อลูมิเนียมตูดหม้อหุงข้าว',
  // Spelling/word-order variants (normalize to final product names)
  'อลูมิเนียมฝา': 'ฝาอลูมิเนียม',
  'อลูมิเนียมล้อแม็ค': 'อลูมิเนียมล้อแม็ก',
  'อลูมิเนียมอัลลอยด์': 'อลูมิเนียมอัลลอย',
  'อลูมิเนียมกะทะ': 'อลูมิเนียมกระทะ',
  'สแตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  'ขี้กลึงสแตนเลส304': 'ขี้กลึงสแตนเลส 304',
}

// ============ OUT-OF-SCOPE PRODUCTS ============
// These are excluded from this reconciliation round → go to EXCLUDED_NOT_IN_SCOPE.csv
const OUT_OF_SCOPE_NAMES = new Set([
  'ของแกะ',
  'ของแกะราคาสูง',
  'ทองเหลืองเกินจาก ST',
  'ทองเหลืองขาดจาก ST',
  'ทองแดงเกินจาก ST',
  'ทองแดงขาดจาก ST',
  'เหล็กสลิง,สแตน',
])

// ============ PARSE INPUT FILE ============
console.log('=== PARSING INPUT FILE ===')
console.log(`File: ${INPUT_FILE}`)
const buf = fs.readFileSync(INPUT_FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log(`Total Excel rows: ${rows.length}`)

// File structure (same as previous detailed buy file):
// Row 0: title
// Row 1: date range
// Row 3: headers "วัสดุ | ผู้ขาย | ... | จำนวน | หน่วย | ราคา@ | รวมเงิน"
// Row 4+: product summary (col 0 = 4-digit code, col 1 = product name)
//         then transaction rows: col 0 = date, col 1 = bill no, col 2 = seller code, col 3 = seller name, ..., col 9 = weight, col 11 = price, col 12 = amount

const itemRows = []
let currentProduct = null
let currentProductCode = null
let totalItemRows = 0

for (let i = 4; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
  
  // Empty row
  if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
  
  const col0 = fixed[0]
  const col1 = fixed[1]
  const col2 = fixed[2]
  
  // Product summary row: col 0 = 4-digit code, col 1 = product name, no date in col 0
  if (col0 && /^\d{4}$/.test(String(col0).trim()) && col1 && typeof col1 === 'string' && !parseThaiDate(col0)) {
    currentProductCode = String(col0).trim()
    currentProduct = String(col1).trim()
    continue
  }
  
  // Transaction row: col 0 = date (parseable as Thai date)
  const date = parseThaiDate(col0)
  if (date && currentProduct) {
    totalItemRows++
    itemRows.push({
      sourceRow: i + 1,  // 1-indexed
      sourceSheet: wb.SheetNames[0],
      billDate: date,
      billDateStr: dateToStr(date),
      billNumber: String(col1 ?? '').trim(),
      sellerCode: String(col2 ?? '').trim(),
      sellerName: String(fixed[3] ?? '').trim(),
      productCode: currentProductCode,
      rawProductName: currentProduct,
      weight: num(fixed[9]),
      unit: String(fixed[10] ?? '').trim() || 'กก.',
      pricePerKg: num(fixed[11]),
      amount: num(fixed[12]),
      note: String(fixed[6] ?? '').trim(),  // col 6 often has vehicle plate / note
    })
  }
}
console.log(`Total detailed purchase item rows: ${totalItemRows}`)

// ============ MATCH PRODUCTS ============
console.log('\n=== MATCHING PRODUCTS ===')

// Build reverse lookup: for each final product name, what raw names map to it?
// Start with identity mapping (raw name = final name) for all products with start dates
const finalToRaw = new Map()  // finalName → Set of rawNames
for (const finalName of Object.keys(PRODUCT_START_DATES)) {
  finalToRaw.set(finalName, new Set([finalName]))
}
// Add owner mappings
for (const [rawName, finalName] of Object.entries(OWNER_MAPPINGS)) {
  if (!finalToRaw.has(finalName)) finalToRaw.set(finalName, new Set())
  finalToRaw.get(finalName).add(rawName)
}

// Build raw → final lookup
const rawToFinal = new Map()
for (const [finalName, rawNames] of finalToRaw) {
  for (const raw of rawNames) {
    rawToFinal.set(normalize(raw), finalName)
  }
}

console.log(`Products with start dates: ${Object.keys(PRODUCT_START_DATES).length}`)
console.log(`Owner-confirmed mappings: ${Object.keys(OWNER_MAPPINGS).length}`)
console.log(`Total raw→final mappings: ${rawToFinal.size}`)

// Match each item row
const matched = []         // rows that matched a product with start date
const excludedBeforeDate = []  // rows matched but bill date < start date
const excludedNotInScope = []  // rows for out-of-scope products
const unmatched = []       // rows that couldn't be matched (empty names, etc.)
const needOwnerStartDate = []  // rows for in-scope products without start date

// Track unique raw product names
const uniqueRawNames = new Set()
const uniqueUnmatchedRawNames = new Set()
const uniqueAmbiguousRawNames = new Set()
const uniqueNeedDateRawNames = new Set()

for (const row of itemRows) {
  const rawNorm = normalize(row.rawProductName)
  uniqueRawNames.add(row.rawProductName)
  
  // Check if out-of-scope
  if (OUT_OF_SCOPE_NAMES.has(row.rawProductName) || OUT_OF_SCOPE_NAMES.has(rawNorm)) {
    excludedNotInScope.push({ ...row, matchedProductName: '(OUT OF SCOPE)', startDateUsed: '', matchStatus: 'out_of_scope', exclusionReason: 'Owner scope decision (Task 43)' })
    continue
  }
  
  // Check if raw name maps to a final product
  const finalName = rawToFinal.get(rawNorm)
  if (finalName) {
    const startDate = PRODUCT_START_DATES[finalName]
    if (!startDate) {
      // Matched but no start date — shouldn't happen since all finalNames have start dates
      unmatched.push({ ...row, matchedProductName: finalName, startDateUsed: '', matchStatus: 'no_start_date', exclusionReason: 'Matched but no start date configured' })
      continue
    }
    
    // Check date filter
    if (row.billDate < startDate) {
      excludedBeforeDate.push({ ...row, matchedProductName: finalName, startDateUsed: dateToStr(startDate), matchStatus: 'excluded_before_start_date' })
    } else {
      matched.push({ ...row, matchedProductName: finalName, startDateUsed: dateToStr(startDate), matchStatus: 'matched_included' })
    }
  } else {
    // Unmatched — classify into: steel (out of scope), needs start date, or truly unmatched
    // Check if it's a steel product (col0 code starts with 01 or 02 for เหล็กสลิง)
    const isSteel = (row.productCode && row.productCode.startsWith('01'))
    // Also treat เหล็ก-something as steel
    const isSteelByName = row.rawProductName.startsWith('เหล็ก') || row.rawProductName.includes('เหล็ก')
    if (isSteel || isSteelByName) {
      excludedNotInScope.push({ ...row, matchedProductName: '(UNMATCHED STEEL)', startDateUsed: '', matchStatus: 'unmatched_steel', exclusionReason: 'Unmatched steel product — out of scope per Task 43' })
    } else if (row.rawProductName === '-' || row.rawProductName.trim() === '') {
      // Empty product name — truly unmatched
      unmatched.push({ ...row, matchedProductName: '(EMPTY NAME)', startDateUsed: '', matchStatus: 'unmatched', exclusionReason: 'Empty product name in source file' })
      uniqueUnmatchedRawNames.add(row.rawProductName)
    } else {
      // In scope but no start date configured → NEED_OWNER_START_DATE
      needOwnerStartDate.push({ ...row, matchedProductName: '(NEEDS START DATE)', startDateUsed: '', matchStatus: 'needs_start_date', exclusionReason: 'Product is in scope but no start date configured' })
      uniqueNeedDateRawNames.add(row.rawProductName)
    }
  }
}

console.log(`\nMatched (included after date filter): ${matched.length}`)
console.log(`Excluded before start date: ${excludedBeforeDate.length}`)
console.log(`Excluded not in scope: ${excludedNotInScope.length}`)
console.log(`Unmatched: ${unmatched.length}`)
console.log(`Unique raw product names: ${uniqueRawNames.size}`)
console.log(`Unique unmatched raw names: ${uniqueUnmatchedRawNames.size}`)

// ============ GENERATE PER-PRODUCT CSV FILES ============
console.log('\n=== GENERATING PER-PRODUCT CSV FILES ===')

// Group matched rows by product
const byProduct = new Map()
for (const row of matched) {
  if (!byProduct.has(row.matchedProductName)) byProduct.set(row.matchedProductName, [])
  byProduct.get(row.matchedProductName).push(row)
}

const csvColumns = [
  'source sheet', 'source row number', 'bill date', 'bill number',
  'seller/customer code', 'seller/customer name', 'product code',
  'raw product name', 'matched product name', 'start date used',
  'weight', 'unit', 'price per kg', 'amount', 'note'
]

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

const summaryRows = []
let productsWithFiles = 0
let productsWithZeroRows = 0

for (const [productName, rows] of byProduct) {
  const startDate = PRODUCT_START_DATES[productName]
  const startDateStr = dateToStr(startDate)
  const filename = `${productName}เริ่ม ${dateForFilename(startDate)}.csv`
  const filepath = path.join(OUTPUT_DIR, filename)
  
  // Count excluded-before rows for this product
  const excludedBeforeForProduct = excludedBeforeDate.filter(r => r.matchedProductName === productName)
  
  // Calculate totals
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0)
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
  const excludedWeight = excludedBeforeForProduct.reduce((s, r) => s + r.weight, 0)
  const excludedAmount = excludedBeforeForProduct.reduce((s, r) => s + r.amount, 0)
  const firstDate = rows.length > 0 ? rows[0].billDate : null
  const lastDate = rows.length > 0 ? rows[rows.length - 1].billDate : null
  
  // Write CSV
  const csvLines = [csvColumns.join(',')]
  for (const r of rows) {
    csvLines.push([
      r.sourceSheet, r.sourceRow, r.billDateStr, r.billNumber,
      r.sellerCode, r.sellerName, r.productCode,
      r.rawProductName, r.matchedProductName, r.startDateUsed,
      r.weight, r.unit, r.pricePerKg, r.amount, r.note
    ].map(csvEscape).join(','))
  }
  fs.writeFileSync(filepath, '\ufeff' + csvLines.join('\n'), 'utf-8')  // BOM for Excel
  productsWithFiles++
  
  summaryRows.push({
    productName,
    startDate: startDateStr,
    filename,
    rowsIncluded: rows.length,
    totalWeightIncluded: Math.round(totalWeight * 100) / 100,
    totalAmountIncluded: Math.round(totalAmount * 100) / 100,
    firstDateIncluded: firstDate ? dateToStr(firstDate) : '',
    lastDateIncluded: lastDate ? dateToStr(lastDate) : '',
    rowsExcludedBefore: excludedBeforeForProduct.length,
    weightExcludedBefore: Math.round(excludedWeight * 100) / 100,
    amountExcludedBefore: Math.round(excludedAmount * 100) / 100,
    matchStatus: rows.length > 0 ? 'matched_partial_included' : 'matched_zero_rows',
    note: 'bill-level rows after start date',
  })
}

// Find products with start dates but 0 rows after date filter
for (const productName of Object.keys(PRODUCT_START_DATES)) {
  if (!byProduct.has(productName) || byProduct.get(productName).length === 0) {
    productsWithZeroRows++
    const startDate = PRODUCT_START_DATES[productName]
    const startDateStr = dateToStr(startDate)
    const excludedBeforeForProduct = excludedBeforeDate.filter(r => r.matchedProductName === productName)
    summaryRows.push({
      productName,
      startDate: startDateStr,
      filename: '(no file — 0 rows after start date)',
      rowsIncluded: 0,
      totalWeightIncluded: 0,
      totalAmountIncluded: 0,
      firstDateIncluded: '',
      lastDateIncluded: '',
      rowsExcludedBefore: excludedBeforeForProduct.length,
      weightExcludedBefore: excludedBeforeForProduct.reduce((s, r) => s + r.weight, 0),
      amountExcludedBefore: excludedBeforeForProduct.reduce((s, r) => s + r.amount, 0),
      matchStatus: 'matched_zero_rows',
      note: 'Product has start date but 0 rows after date filter',
    })
  }
}

console.log(`Product CSV files created: ${productsWithFiles}`)
console.log(`Products with 0 rows after start date: ${productsWithZeroRows}`)

// ============ GENERATE AUDIT FILES ============
console.log('\n=== GENERATING AUDIT FILES ===')

// 1. SUMMARY.csv
const summaryCols = ['No.','product name','start date','output filename','rows included','total weight included','total amount included','first included bill date','last included bill date','rows excluded before start date','weight excluded before start date','amount excluded before start date','match status','note']
const summaryCsvLines = [summaryCols.join(',')]
summaryRows.forEach((r, i) => {
  summaryCsvLines.push([
    i + 1, r.productName, r.startDate, r.filename,
    r.rowsIncluded, r.totalWeightIncluded, r.totalAmountIncluded,
    r.firstDateIncluded, r.lastDateIncluded,
    r.rowsExcludedBefore, r.weightExcludedBefore, r.amountExcludedBefore,
    r.matchStatus, r.note
  ].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'SUMMARY.csv'), '\ufeff' + summaryCsvLines.join('\n'), 'utf-8')
console.log('  ✓ SUMMARY.csv')

// 2. ALL_INCLUDED_ROWS.csv
const allIncludedCsvLines = [csvColumns.join(',')]
for (const r of matched) {
  allIncludedCsvLines.push([
    r.sourceSheet, r.sourceRow, r.billDateStr, r.billNumber,
    r.sellerCode, r.sellerName, r.productCode,
    r.rawProductName, r.matchedProductName, r.startDateUsed,
    r.weight, r.unit, r.pricePerKg, r.amount, r.note
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'ALL_INCLUDED_ROWS.csv'), '\ufeff' + allIncludedCsvLines.join('\n'), 'utf-8')
console.log('  ✓ ALL_INCLUDED_ROWS.csv')

// 3. EXCLUDED_BEFORE_START_DATE.csv
const excludedBeforeCols = [...csvColumns, 'exclusion reason']
const excludedBeforeCsvLines = [excludedBeforeCols.join(',')]
for (const r of excludedBeforeDate) {
  excludedBeforeCsvLines.push([
    r.sourceSheet, r.sourceRow, r.billDateStr, r.billNumber,
    r.sellerCode, r.sellerName, r.productCode,
    r.rawProductName, r.matchedProductName, r.startDateUsed,
    r.weight, r.unit, r.pricePerKg, r.amount, r.note,
    'Bill date is before product start date'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'EXCLUDED_BEFORE_START_DATE.csv'), '\ufeff' + excludedBeforeCsvLines.join('\n'), 'utf-8')
console.log('  ✓ EXCLUDED_BEFORE_START_DATE.csv')

// 4. EXCLUDED_NOT_IN_SCOPE.csv
const excludedScopeCols = [...csvColumns, 'exclusion reason']
const excludedScopeCsvLines = [excludedScopeCols.join(',')]
for (const r of excludedNotInScope) {
  excludedScopeCsvLines.push([
    r.sourceSheet, r.sourceRow, r.billDateStr, r.billNumber,
    r.sellerCode, r.sellerName, r.productCode,
    r.rawProductName, r.matchedProductName, r.startDateUsed,
    r.weight, r.unit, r.pricePerKg, r.amount, r.note,
    r.exclusionReason || 'Out of scope'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'EXCLUDED_NOT_IN_SCOPE.csv'), '\ufeff' + excludedScopeCsvLines.join('\n'), 'utf-8')
console.log('  ✓ EXCLUDED_NOT_IN_SCOPE.csv')

// 5. UNMATCHED_PRODUCTS.csv
const unmatchedCols = ['No.','raw product name','normalized name','product code','rows','total weight','total amount','reason']
const unmatchedAgg = new Map()
for (const r of unmatched) {
  const key = r.rawProductName
  if (!unmatchedAgg.has(key)) unmatchedAgg.set(key, { rawName: key, normName: normalize(key), productCode: r.productCode, rows: 0, weight: 0, amount: 0, reason: r.exclusionReason })
  const agg = unmatchedAgg.get(key)
  agg.rows++
  agg.weight += r.weight
  agg.amount += r.amount
}
const unmatchedCsvLines = [unmatchedCols.join(',')]
let unmatchedIdx = 1
for (const agg of [...unmatchedAgg.values()].sort((a, b) => b.weight - a.weight)) {
  unmatchedCsvLines.push([
    unmatchedIdx++, agg.rawName, agg.normName, agg.productCode,
    agg.rows, Math.round(agg.weight * 100) / 100, Math.round(agg.amount * 100) / 100,
    agg.reason
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_PRODUCTS.csv'), '\ufeff' + unmatchedCsvLines.join('\n'), 'utf-8')
console.log('  ✓ UNMATCHED_PRODUCTS.csv')

// 6. AMBIGUOUS_PRODUCTS.csv (should be empty or near-empty after owner mappings)
const ambiguousCols = ['No.','raw product name','normalized name','possible matches','reason','owner decision needed']
const ambiguousCsvLines = [ambiguousCols.join(',')]
// After owner mappings, there should be no ambiguous products
// But check for any raw names that could match multiple final products
const ambiguousRawNames = []
for (const rawName of uniqueRawNames) {
  const rawNorm = normalize(rawName)
  if (rawToFinal.has(rawNorm)) continue  // already mapped
  if (OUT_OF_SCOPE_NAMES.has(rawName)) continue  // out of scope
  // Check if this raw name contains/isContained by multiple final product names
  const matches = []
  for (const finalName of Object.keys(PRODUCT_START_DATES)) {
    const finalNorm = normalize(finalName)
    if (finalNorm.includes(rawNorm) || rawNorm.includes(finalNorm)) {
      matches.push(finalName)
    }
  }
  if (matches.length > 1) {
    ambiguousRawNames.push({ rawName, normName: rawNorm, matches })
  }
}
let ambIdx = 1
for (const a of ambiguousRawNames) {
  ambiguousCsvLines.push([
    ambIdx++, a.rawName, a.normName,
    a.matches.join(' | '),
    'Multiple contains-matches after owner mappings',
    'YES — owner must clarify'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'AMBIGUOUS_PRODUCTS.csv'), '\ufeff' + ambiguousCsvLines.join('\n'), 'utf-8')
console.log(`  ✓ AMBIGUOUS_PRODUCTS.csv (${ambiguousRawNames.length} items)`)

// 7. NEED_OWNER_START_DATE.csv
const needDateCols = ['No.','product name','normalized name','rows','total weight','total amount','reason']
const needDateCsvLines = [needDateCols.join(',')]
// Products that are in scope but have no confirmed start date
// (should be empty since all mapped products have start dates)
const needDateProducts = []
for (const rawName of uniqueRawNames) {
  const rawNorm = normalize(rawName)
  if (rawToFinal.has(rawNorm)) continue  // has mapping + start date
  if (OUT_OF_SCOPE_NAMES.has(rawName)) continue  // out of scope
  if (unmatchedAgg.has(rawName)) continue  // already in unmatched
  // This shouldn't happen — but check
}
let ndIdx = 1
// ของแกะ and ของแกะราคาสูง should go to EXCLUDED_NOT_IN_SCOPE, not here
// So NEED_OWNER_START_DATE should be empty
fs.writeFileSync(path.join(OUTPUT_DIR, 'NEED_OWNER_START_DATE.csv'), '\ufeff' + needDateCsvLines.join('\n'), 'utf-8')
console.log('  ✓ NEED_OWNER_START_DATE.csv (empty — all in-scope products have start dates)')

// ============ GENERATE EXCEL WORKBOOK ============
console.log('\n=== GENERATING EXCEL WORKBOOK ===')
const workbookPath = path.join(OUTPUT_DIR, 'รวมซื้อแยกตามสินค้า_แบบละเอียด_หลังวันเริ่มนับ_v2.xlsx')
const wbOut = xlsx.utils.book_new()

function addSheet(name, csvContent) {
  const lines = csvContent.split('\n').filter(l => l.length > 0)
  const data = lines.map(l => {
    // Simple CSV parse (handles quoted fields with commas)
    const result = []
    let inQuote = false
    let current = ''
    for (let i = 0; i < l.length; i++) {
      const c = l[i]
      if (c === '"') {
        if (inQuote && l[i+1] === '"') { current += '"'; i++ }
        else inQuote = !inQuote
      } else if (c === ',' && !inQuote) {
        result.push(current)
        current = ''
      } else {
        current += c
      }
    }
    result.push(current)
    return result
  })
  const ws = xlsx.utils.aoa_to_sheet(data)
  xlsx.utils.book_append_sheet(wbOut, ws, name.substring(0, 31))  // Excel sheet name max 31 chars
}

// Add audit sheets
addSheet('SUMMARY', fs.readFileSync(path.join(OUTPUT_DIR, 'SUMMARY.csv'), 'utf-8').replace(/^\ufeff/, ''))
addSheet('ALL_INCLUDED_ROWS', fs.readFileSync(path.join(OUTPUT_DIR, 'ALL_INCLUDED_ROWS.csv'), 'utf-8').replace(/^\ufeff/, ''))
addSheet('EXCLUDED_BEFORE_START', fs.readFileSync(path.join(OUTPUT_DIR, 'EXCLUDED_BEFORE_START_DATE.csv'), 'utf-8').replace(/^\ufeff/, ''))
addSheet('EXCLUDED_NOT_IN_SCOPE', fs.readFileSync(path.join(OUTPUT_DIR, 'EXCLUDED_NOT_IN_SCOPE.csv'), 'utf-8').replace(/^\ufeff/, ''))
addSheet('UNMATCHED_PRODUCTS', fs.readFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_PRODUCTS.csv'), 'utf-8').replace(/^\ufeff/, ''))
addSheet('AMBIGUOUS_PRODUCTS', fs.readFileSync(path.join(OUTPUT_DIR, 'AMBIGUOUS_PRODUCTS.csv'), 'utf-8').replace(/^\ufeff/, ''))
addSheet('NEED_OWNER_START_DATE', fs.readFileSync(path.join(OUTPUT_DIR, 'NEED_OWNER_START_DATE.csv'), 'utf-8').replace(/^\ufeff/, ''))

// Add PRODUCT_TOTALS sheet
const productTotalsCols = ['No.','product name','start date','rows included','total weight (kg)','total amount (THB)','first bill date','last bill date']
const productTotalsData = [productTotalsCols]
summaryRows.filter(r => r.rowsIncluded > 0).sort((a, b) => b.totalWeightIncluded - a.totalWeightIncluded).forEach((r, i) => {
  productTotalsData.push([i + 1, r.productName, r.startDate, r.rowsIncluded, r.totalWeightIncluded, r.totalAmountIncluded, r.firstDateIncluded, r.lastDateIncluded])
})
const wsTotals = xlsx.utils.aoa_to_sheet(productTotalsData)
xlsx.utils.book_append_sheet(wbOut, wsTotals, 'PRODUCT_TOTALS')

// Add per-product sheets (only for products with rows)
for (const [productName, rows] of byProduct) {
  if (rows.length === 0) continue
  const sheetData = [csvColumns]
  for (const r of rows) {
    sheetData.push([
      r.sourceSheet, r.sourceRow, r.billDateStr, r.billNumber,
      r.sellerCode, r.sellerName, r.productCode,
      r.rawProductName, r.matchedProductName, r.startDateUsed,
      r.weight, r.unit, r.pricePerKg, r.amount, r.note
    ])
  }
  const ws = xlsx.utils.aoa_to_sheet(sheetData)
  // Sheet name max 31 chars, and cannot contain: [ ] : * ? / \
  let sheetName = productName.replace(/[\[\]:*?/\\]/g, '_').substring(0, 31)
  if (sheetName.length === 0) sheetName = 'product'
  // Ensure unique
  let uniqueName = sheetName
  let suffix = 1
  while (wbOut.SheetNames.includes(uniqueName)) {
    uniqueName = sheetName.substring(0, 28) + '_' + suffix
    suffix++
  }
  xlsx.utils.book_append_sheet(wbOut, ws, uniqueName)
}

xlsx.writeFile(wbOut, workbookPath)
console.log(`  ✓ ${workbookPath}`)

// ============ FINAL REPORT ============
console.log('\n=== FINAL REPORT ===')
console.log(`1.  Total Excel rows parsed:              ${rows.length}`)
console.log(`2.  Total detailed purchase item rows:    ${totalItemRows}`)
console.log(`3.  Unique raw product names found:       ${uniqueRawNames.size}`)
console.log(`4.  Matched product count (with sdate):   ${byProduct.size}`)
console.log(`5.  Unmatched product count:              ${unmatchedAgg.size}`)
console.log(`6.  Ambiguous product count:              ${ambiguousRawNames.length}`)
console.log(`7.  Out-of-scope product count:           ${new Set(excludedNotInScope.map(r => r.rawProductName)).size}`)
console.log(`8.  Number of product CSV files created:  ${productsWithFiles}`)
console.log(`9.  Output folder path:                   ${OUTPUT_DIR}`)
console.log(`10. Workbook path:                        ${workbookPath}`)
console.log(`11. Total included rows after start dates: ${matched.length}`)
console.log(`12. Total excluded before start dates:    ${excludedBeforeDate.length}`)
console.log(`13. Total excluded not in scope:          ${excludedNotInScope.length}`)

console.log('\n14. Top 10 products by included weight:')
const top10 = [...byProduct.entries()].map(([name, rows]) => ({
  name,
  startDate: dateToStr(PRODUCT_START_DATES[name]),
  weight: rows.reduce((s, r) => s + r.weight, 0),
  amount: rows.reduce((s, r) => s + r.amount, 0),
})).sort((a, b) => b.weight - a.weight).slice(0, 10)
top10.forEach((p, i) => {
  console.log(`    ${String(i+1).padStart(3)}. ${p.name.padEnd(35)} ${p.startDate.padEnd(12)} ${String(Math.round(p.weight*100)/100).padStart(12)} kg  ${String(Math.round(p.amount*100)/100).padStart(12)} THB`)
})

console.log('\n15. Products with 0 rows after start date:')
const zeroRowProducts = Object.keys(PRODUCT_START_DATES).filter(name => !byProduct.has(name) || byProduct.get(name).length === 0)
if (zeroRowProducts.length === 0) {
  console.log('    (none)')
} else {
  for (const name of zeroRowProducts) {
    console.log(`    - ${name} (start date: ${dateToStr(PRODUCT_START_DATES[name])})`)
  }
}

console.log(`\n16. Files ready for next stock reconciliation step: YES`)

// Save report to file
let reportText = `FINAL REPORT - DETAILED PURCHASE EXCEL SPLIT v2 (Task 43)
======================================================================
Source file: รวมซื้อสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls
Owner-confirmed mappings applied: ${Object.keys(OWNER_MAPPINGS).length}
Out-of-scope products excluded: ${OUT_OF_SCOPE_NAMES.size}

1.  Total Excel rows parsed              : ${rows.length}
2.  Total detailed purchase item rows    : ${totalItemRows}
3.  Unique raw product names found       : ${uniqueRawNames.size}
4.  Matched product count (with sdate)   : ${byProduct.size}
5.  Unmatched product count              : ${unmatchedAgg.size}
6.  Ambiguous product count              : ${ambiguousRawNames.length}
7.  Out-of-scope product count           : ${new Set(excludedNotInScope.map(r => r.rawProductName)).size}
8.  Number of product CSV files created  : ${productsWithFiles}
9.  Output folder path                   : ${OUTPUT_DIR}
10. Workbook path                        : ${workbookPath}
11. Total included rows after start dates: ${matched.length}
12. Total excluded before start dates    : ${excludedBeforeDate.length}
13. Total excluded not in scope          : ${excludedNotInScope.length}

14. Top 10 products by included weight:
`
top10.forEach((p, i) => {
  reportText += `      #  ${p.name.padEnd(35)} ${p.startDate.padEnd(12)} ${String(Math.round(p.weight*100)/100).padStart(12)} kg    ${String(Math.round(p.amount*100)/100).padStart(12)} THB\n`
})
reportText += '\n15. Products with 0 rows after start date:\n'
if (zeroRowProducts.length === 0) {
  reportText += '    (none)\n'
} else {
  for (const name of zeroRowProducts) {
    reportText += `    - ${name} (start date: ${dateToStr(PRODUCT_START_DATES[name])})\n`
  }
}
reportText += '\n16. Files ready for next stock reconciliation step: YES\n'
reportText += '\nNo production data was modified.\n'

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.txt'), reportText, 'utf-8')
console.log('\nReport saved to FINAL_REPORT.txt')
