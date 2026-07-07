/**
 * Task 45: Verify Sales After Product Stock-Count Start Dates
 * VERIFICATION ONLY — no production modifications.
 *
 * Input: รวมขายสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls
 * Output: reconciliation/sales-after-start-date-verification/
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'

const INPUT_FILE = '/home/z/my-project/upload/รวมขายสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls'
const OUTPUT_DIR = '/home/z/my-project/reconciliation/sales-after-start-date-verification'
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
  t = t.replace(/แสตนเลส/g, 'สแตนเลส')
  t = t.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
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
  const yy = d.getFullYear() + 543
  return `${dd}/${mm}/${yy}`
}

// ============ PRODUCT START DATES + MAPPINGS (same as Task 43) ============
const PRODUCT_START_DATES_RAW = {
  'ทองแดงปอก': '04/07/2569', 'ทองแดงช็อต': '04/07/2569', 'ทองแดงใหญ่': '04/07/2569',
  'ทองแดงเล็ก': '04/07/2569', 'ทองแดงชุบ': '04/07/2569', 'หม้อน้ำทองแดง': '04/07/2569',
  'ทองเหลือง': '04/07/2569', 'ทองเหลืองเนื้อแดง': '04/07/2569', 'หม้อน้ำทองเหลือง': '04/07/2569',
  'ขี้กลึงทองเหลือง': '21/04/2569', 'ขี้กลึงทองเหลืองเนื้อแดง': '13/05/2568',
  'สแตนเลส 304': '05/02/2569', 'สแตนเลส 202': '05/02/2569', 'สแตนเลสดูดติด': '05/02/2569',
  'สแตนเลส 304 ยาว': '05/02/2569', 'สแตนเลสติดเหล็ก': '05/02/2569', 'นิกเกิล': '05/02/2569',
  'ขี้กลึงสแตนเลส 304': '22/01/2569',
  'ตะกั่วนิ่ม': '27/05/2569', 'ตะกั่วแข็ง': '27/05/2569', 'ขี้กลึงตะกั่ว': '22/01/2569',
  'แท็บเล็ต': '29/10/2568', 'แผงวงจรติดสายไฟ': '29/10/2568', 'มอเตอร์': '03/07/2567',
  'คอมดำ': '29/07/2567', 'สายไฟไม่ปอก': '28/10/2568', 'เปลือกสายไฟ': '18/11/2562',
  'อลูมิเนียมกระป๋อง': '25/06/2569', 'อลูมิเนียมล้อแม็ก': '23/06/2569', 'อลูมิเนียมสายไฟ': '23/06/2569',
  'อลูมิเนียมบาง': '27/06/2569', 'อลูมิเนียมแข็ง': '27/06/2569', 'อลูมิเนียมผ้าเบรค': '06/07/2569',
  'อลูมิเนียมตูดกะทะไฟฟ้า': '05/07/2569', 'อลูมิเนียมกระทะ': '23/06/2569', 'อลูมิเนียมตูดกะทะ': '23/06/2569',
  'อลูมิเนียมมุ้งลวด': '31/03/2569', 'อลูมิเนียมมู่ลี่': '23/06/2569', 'ฝาอลูมิเนียม': '23/06/2569',
  'ฝาอลูมิเนียมไม่แกะ': '06/07/2569', 'อลูมิเนียมฉาก': '24/06/2569', 'หม้อน้ำอลูมิเนียม': '23/06/2569',
  'อลูมิเนียมเครื่อง': '23/06/2569', 'อลูมิเนียมครีบหม้อน้ำ': '01/04/2569', 'อลูมิเนียมอัลลอย': '23/06/2569',
  'อลูมิเนียมแผ่นเพลท': '23/06/2569', 'สายไฟอลูมิเนียม': '05/07/2569', 'ขี้กลึงอลูมิเนียม': '22/01/2569',
  'อลูมิเนียมฉากสี': '05/07/2569', 'กระป๋องสเปรย์อลูมิเนียม': '05/07/2569', 'ปั๊มกระป๋อง': '05/07/2569',
  'ฟรอยอลูมิเนียม': '05/07/2569', 'ฝาอลูมิเนียมเผา': '05/07/2569', 'อลูมิเนียมตูดหม้อหุงข้าว': '05/07/2569',
  'อลูมิเนียมแข็งติดสี': '23/06/2569', 'อลูมิเนียมแข็งลูกสูบ': '06/07/2569', 'อลูมิเนียมแข็งก้านเบรค': '06/07/2569',
}
const PRODUCT_START_DATES = {}
for (const [name, dateStr] of Object.entries(PRODUCT_START_DATES_RAW)) {
  PRODUCT_START_DATES[name] = parseThaiDate(dateStr)
}

const OWNER_MAPPINGS = {
  'ทองแดงปอกเงา': 'ทองแดงปอก',
  'ทองแดงปอกช็อต': 'ทองแดงช็อต',
  'ทองเหลืองหนา': 'ทองเหลือง',
  'ขี้กลึงทองเหลือง (เนื้อเขียว)': 'ขี้กลึงทองเหลือง',
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'ตูดหม้อหุงข้าว': 'อลูมิเนียมตูดหม้อหุงข้าว',
  'อลูมิเนียมฝา': 'ฝาอลูมิเนียม',
  'อลูมิเนียมล้อแม็ค': 'อลูมิเนียมล้อแม็ก',
  'อลูมิเนียมอัลลอยด์': 'อลูมิเนียมอัลลอย',
  'อลูมิเนียมกะทะ': 'อลูมิเนียมกระทะ',
  'สแตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  'ขี้กลึงสแตนเลส304': 'ขี้กลึงสแตนเลส 304',
}

const OUT_OF_SCOPE_NAMES = new Set([
  'ของแกะ', 'ของแกะราคาสูง',
  'ทองเหลืองเกินจาก ST', 'ทองเหลืองขาดจาก ST',
  'ทองแดงเกินจาก ST', 'ทองแดงขาดจาก ST',
  'เหล็กสลิง,สแตน',
])

// Build raw→final mapping
const rawToFinal = new Map()
for (const finalName of Object.keys(PRODUCT_START_DATES)) {
  rawToFinal.set(normalize(finalName), finalName)
}
for (const [rawName, finalName] of Object.entries(OWNER_MAPPINGS)) {
  rawToFinal.set(normalize(rawName), finalName)
}

// ============ TASK 1: PARSE SALES FILE ============
console.log('=== TASK 1: PARSE DETAILED SALES FILE ===')
console.log(`File: ${INPUT_FILE}`)
const buf = fs.readFileSync(INPUT_FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log(`Total Excel rows: ${rows.length}`)

// Sales file structure:
// Row 0: title
// Row 1: date range
// Row 3: headers "วัสดุ | ผู้ซื้อ | ... | จำนวน | หน่วย | ราคา@ | รวมเงิน"
// Row 4+: product summary (col 0 = 4-digit code, col 1 = product name)
//         then transaction rows: col 0 = date, col 1 = bill no, col 3 = buyer code, col 4 = buyer name, ..., col 9 = weight, col 11 = price, col 12 = amount

const itemRows = []
let currentProduct = null
let currentProductCode = null

for (let i = 4; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
  if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
  
  const col0 = fixed[0]
  const col1 = fixed[1]
  
  // Product summary row: col 0 = 4-digit code, col 1 = product name, no date in col 0
  if (col0 && /^\d{4}$/.test(String(col0).trim()) && col1 && typeof col1 === 'string' && !parseThaiDate(col0)) {
    currentProductCode = String(col0).trim()
    currentProduct = String(col1).trim()
    continue
  }
  
  // Transaction row: col 0 = date
  const date = parseThaiDate(col0)
  if (date && currentProduct) {
    itemRows.push({
      sourceSheet: wb.SheetNames[0],
      sourceRow: i + 1,
      saleDate: date,
      saleDateStr: dateToStr(date),
      billNumber: String(col1 ?? '').trim(),
      buyerCode: String(fixed[3] ?? '').trim(),
      buyerName: String(fixed[4] ?? '').trim(),
      productCode: currentProductCode,
      rawProductName: currentProduct,
      normRawName: normalize(currentProduct),
      weight: num(fixed[9]),
      unit: String(fixed[10] ?? '').trim() || 'กก.',
      pricePerKg: num(fixed[11]),
      amount: num(fixed[12]),
      note: String(fixed[6] ?? '').trim(),
    })
  }
}
console.log(`Total detailed sale item rows: ${itemRows.length}`)

// ============ TASK 2: PRODUCT NAME MATCHING ============
console.log('\n=== TASK 2: PRODUCT NAME MATCHING ===')

const uniqueRawNames = new Set()
for (const row of itemRows) uniqueRawNames.add(row.rawProductName)
console.log(`Unique raw product names: ${uniqueRawNames.size}`)

const matched = []              // matched + sale date >= start date
const excludedBeforeDate = []   // matched but sale date < start date
const excludedNotInScope = []   // out-of-scope products
const unmatched = []            // couldn't match
const ambiguous = []            // ambiguous (multiple matches)

for (const row of itemRows) {
  const rawNorm = row.normRawName
  
  // Check out-of-scope
  if (OUT_OF_SCOPE_NAMES.has(row.rawProductName) || OUT_OF_SCOPE_NAMES.has(rawNorm)) {
    excludedNotInScope.push({ ...row, matchedProductName: '(OUT OF SCOPE)', startDateUsed: '', matchStatus: 'out_of_scope', exclusionReason: 'Owner scope decision' })
    continue
  }
  
  // Check steel products (code starts with 01 or name starts with เหล็ก)
  const isSteel = (row.productCode && row.productCode.startsWith('01')) || row.rawProductName.startsWith('เหล็ก') || row.rawProductName.includes('เหล็ก')
  if (isSteel && !rawToFinal.has(rawNorm)) {
    excludedNotInScope.push({ ...row, matchedProductName: '(UNMATCHED STEEL)', startDateUsed: '', matchStatus: 'unmatched_steel', exclusionReason: 'Unmatched steel — out of scope' })
    continue
  }
  
  // Check exact/alias match
  const finalName = rawToFinal.get(rawNorm)
  if (finalName) {
    const startDate = PRODUCT_START_DATES[finalName]
    if (!startDate) {
      unmatched.push({ ...row, matchedProductName: finalName, matchStatus: 'no_start_date', exclusionReason: 'No start date' })
      continue
    }
    if (row.saleDate < startDate) {
      excludedBeforeDate.push({ ...row, matchedProductName: finalName, startDateUsed: dateToStr(startDate), matchStatus: 'excluded_before_start_date' })
    } else {
      matched.push({ ...row, matchedProductName: finalName, startDateUsed: dateToStr(startDate), matchStatus: 'matched_included' })
    }
  } else {
    // Check for empty name
    if (row.rawProductName === '-' || row.rawProductName.trim() === '') {
      unmatched.push({ ...row, matchedProductName: '(EMPTY NAME)', matchStatus: 'unmatched', exclusionReason: 'Empty product name' })
      continue
    }
    // Check ambiguous (multiple contains-matches)
    const containsMatches = []
    for (const finalName of Object.keys(PRODUCT_START_DATES)) {
      const finalNorm = normalize(finalName)
      if (finalNorm.includes(rawNorm) || rawNorm.includes(finalNorm)) {
        containsMatches.push(finalName)
      }
    }
    if (containsMatches.length > 1) {
      ambiguous.push({ ...row, matchedProductName: '(AMBIGUOUS)', matchStatus: 'ambiguous', possibleMatches: containsMatches, exclusionReason: `Multiple matches: ${containsMatches.join(', ')}` })
    } else if (containsMatches.length === 1) {
      // Single contains-match — treat as matched
      const finalName = containsMatches[0]
      const startDate = PRODUCT_START_DATES[finalName]
      if (startDate) {
        if (row.saleDate < startDate) {
          excludedBeforeDate.push({ ...row, matchedProductName: finalName, startDateUsed: dateToStr(startDate), matchStatus: 'excluded_before_start_date' })
        } else {
          matched.push({ ...row, matchedProductName: finalName, startDateUsed: dateToStr(startDate), matchStatus: 'matched_included' })
        }
      }
    } else {
      unmatched.push({ ...row, matchedProductName: '(UNMATCHED)', matchStatus: 'unmatched', exclusionReason: 'No matching product' })
    }
  }
}

console.log(`\nMatched (included after date filter): ${matched.length}`)
console.log(`Excluded before start date: ${excludedBeforeDate.length}`)
console.log(`Excluded not in scope: ${excludedNotInScope.length}`)
console.log(`Unmatched: ${unmatched.length}`)
console.log(`Ambiguous: ${ambiguous.length}`)

// ============ TASK 3: FILTER SALES AFTER START DATE (already done above) ============

// ============ TASK 4: GENERATE OUTPUT FILES ============
console.log('\n=== TASK 4: GENERATING OUTPUT FILES ===')

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

const detailCols = ['source sheet','source row number','sale date','product start date','bill number','buyer/customer code','buyer/customer name','raw product name','matched product name','product code','weight','unit','price per kg','amount','note']

// 1. SALES_AFTER_START_DATE.csv
const csvLines1 = [detailCols.join(',')]
for (const r of matched) {
  csvLines1.push([
    r.sourceSheet, r.sourceRow, r.saleDateStr, r.startDateUsed, r.billNumber,
    r.buyerCode, r.buyerName, r.rawProductName, r.matchedProductName,
    r.productCode, r.weight, r.unit, r.pricePerKg, r.amount, r.note
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SALES_AFTER_START_DATE.csv'), '\ufeff' + csvLines1.join('\n'), 'utf-8')
console.log('  ✓ SALES_AFTER_START_DATE.csv')

// 2. SALES_AFTER_START_DATE_SUMMARY.csv
// Group matched by product
const byProduct = new Map()
for (const r of matched) {
  if (!byProduct.has(r.matchedProductName)) byProduct.set(r.matchedProductName, [])
  byProduct.get(r.matchedProductName).push(r)
}

const summaryCols = ['No.','product name','start date','sale rows after start date','total sale weight after start date','total sale amount after start date','first sale date after start date','last sale date after start date','owner review needed','note']
const csvLines2 = [summaryCols.join(',')]
let sumIdx = 1
// Sort by weight descending
const sortedProducts = [...byProduct.entries()].sort((a, b) => {
  const wA = a[1].reduce((s, r) => s + r.weight, 0)
  const wB = b[1].reduce((s, r) => s + r.weight, 0)
  return wB - wA
})
for (const [productName, rows] of sortedProducts) {
  const startDate = PRODUCT_START_DATES[productName]
  const totalWeight = rows.reduce((s, r) => s + r.weight, 0)
  const totalAmount = rows.reduce((s, r) => s + r.amount, 0)
  const firstDate = rows[0].saleDate
  const lastDate = rows[rows.length - 1].saleDate
  csvLines2.push([
    sumIdx++, productName, dateToStr(startDate), rows.length,
    Math.round(totalWeight * 100) / 100, Math.round(totalAmount * 100) / 100,
    dateToStr(firstDate), dateToStr(lastDate),
    'no', 'Sales after start date — will need to be deducted during stock reconciliation'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SALES_AFTER_START_DATE_SUMMARY.csv'), '\ufeff' + csvLines2.join('\n'), 'utf-8')
console.log('  ✓ SALES_AFTER_START_DATE_SUMMARY.csv')

// 3. SALES_BEFORE_START_DATE_AUDIT.csv
const auditCols = [...detailCols, 'exclusion reason']
const csvLines3 = [auditCols.join(',')]
for (const r of excludedBeforeDate) {
  csvLines3.push([
    r.sourceSheet, r.sourceRow, r.saleDateStr, r.startDateUsed, r.billNumber,
    r.buyerCode, r.buyerName, r.rawProductName, r.matchedProductName,
    r.productCode, r.weight, r.unit, r.pricePerKg, r.amount, r.note,
    'Sale date is before product start date'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SALES_BEFORE_START_DATE_AUDIT.csv'), '\ufeff' + csvLines3.join('\n'), 'utf-8')
console.log('  ✓ SALES_BEFORE_START_DATE_AUDIT.csv')

// 4. UNMATCHED_SALES_PRODUCTS.csv
const unmatchedCols = ['No.','raw product name','normalized name','product code','rows','total weight','total amount','reason']
const unmatchedAgg = new Map()
for (const r of unmatched) {
  const key = r.rawProductName
  if (!unmatchedAgg.has(key)) unmatchedAgg.set(key, { rawName: key, normName: r.normRawName, productCode: r.productCode, rows: 0, weight: 0, amount: 0, reason: r.exclusionReason })
  const agg = unmatchedAgg.get(key)
  agg.rows++; agg.weight += r.weight; agg.amount += r.amount
}
const csvLines4 = [unmatchedCols.join(',')]
let unmIdx = 1
for (const agg of [...unmatchedAgg.values()].sort((a, b) => b.weight - a.weight)) {
  csvLines4.push([unmIdx++, agg.rawName, agg.normName, agg.productCode, agg.rows, Math.round(agg.weight*100)/100, Math.round(agg.amount*100)/100, agg.reason].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_SALES_PRODUCTS.csv'), '\ufeff' + csvLines4.join('\n'), 'utf-8')
console.log('  ✓ UNMATCHED_SALES_PRODUCTS.csv')

// 5. AMBIGUOUS_SALES_PRODUCTS.csv
const ambCols = ['No.','raw product name','normalized name','product code','rows','total weight','total amount','possible matches','reason']
const ambAgg = new Map()
for (const r of ambiguous) {
  const key = r.rawProductName
  if (!ambAgg.has(key)) ambAgg.set(key, { rawName: key, normName: r.normRawName, productCode: r.productCode, rows: 0, weight: 0, amount: 0, possibleMatches: r.possibleMatches, reason: r.exclusionReason })
  const agg = ambAgg.get(key)
  agg.rows++; agg.weight += r.weight; agg.amount += r.amount
}
const csvLines5 = [ambCols.join(',')]
let ambIdx = 1
for (const agg of [...ambAgg.values()].sort((a, b) => b.weight - a.weight)) {
  csvLines5.push([ambIdx++, agg.rawName, agg.normName, agg.productCode, agg.rows, Math.round(agg.weight*100)/100, Math.round(agg.amount*100)/100, agg.possibleMatches.join(' | '), agg.reason].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'AMBIGUOUS_SALES_PRODUCTS.csv'), '\ufeff' + csvLines5.join('\n'), 'utf-8')
console.log(`  ✓ AMBIGUOUS_SALES_PRODUCTS.csv (${ambAgg.size} items)`)

// 6. EXCLUDED_NOT_IN_SCOPE_SALES.csv
const scopeCols = [...detailCols, 'exclusion reason']
const csvLines6 = [scopeCols.join(',')]
for (const r of excludedNotInScope) {
  csvLines6.push([
    r.sourceSheet, r.sourceRow, r.saleDateStr, r.startDateUsed || '', r.billNumber,
    r.buyerCode, r.buyerName, r.rawProductName, r.matchedProductName,
    r.productCode, r.weight, r.unit, r.pricePerKg, r.amount, r.note,
    r.exclusionReason || 'Out of scope'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'EXCLUDED_NOT_IN_SCOPE_SALES.csv'), '\ufeff' + csvLines6.join('\n'), 'utf-8')
console.log('  ✓ EXCLUDED_NOT_IN_SCOPE_SALES.csv')

// 7. FINAL_REPORT.md
const totalWeightAfter = matched.reduce((s, r) => s + r.weight, 0)
const totalAmountAfter = matched.reduce((s, r) => s + r.amount, 0)

let md = `# Sales After Start Date — Verification Report\n\n`
md += `**Task 45**: Verify Sales After Product Stock-Count Start Dates\n`
md += `**Status**: VERIFICATION ONLY — No production data modified.\n`
md += `**Input file**: รวมขายสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls\n\n`

md += `## Summary\n\n`
md += `| Metric | Value |\n|---|---:|\n`
md += `| 1. Total Excel rows parsed | ${rows.length} |\n`
md += `| 2. Total detailed sale item rows | ${itemRows.length} |\n`
md += `| 3. Unique raw sale product names | ${uniqueRawNames.size} |\n`
md += `| 4. Matched product count | ${byProduct.size} |\n`
md += `| 5. Unmatched product count | ${unmatchedAgg.size} |\n`
md += `| 6. Ambiguous product count | ${ambAgg.size} |\n`
md += `| 7. Products with sales after start date | ${byProduct.size} |\n`
md += `| 8. Total sale rows after start date | ${matched.length} |\n`
md += `| 9. Total sale weight after start date | ${Math.round(totalWeightAfter*100)/100} kg |\n`
md += `| 10. Total sale amount after start date | ${Math.round(totalAmountAfter*100)/100} THB |\n`
md += `| Excluded before start date | ${excludedBeforeDate.length} rows |\n`
md += `| Excluded not in scope | ${excludedNotInScope.length} rows |\n\n`

md += `## Top Products by Sale Weight After Start Date\n\n`
md += `| # | Product | Start date | Rows | Weight (kg) | Amount (THB) | First sale | Last sale |\n`
md += `|---|---|---|---:|---:|---:|---|---|\n`
sortedProducts.slice(0, 15).forEach(([productName, prows], i) => {
  const startDate = PRODUCT_START_DATES[productName]
  const tw = prows.reduce((s, r) => s + r.weight, 0)
  const ta = prows.reduce((s, r) => s + r.amount, 0)
  md += `| ${i+1} | ${productName} | ${dateToStr(startDate)} | ${prows.length} | ${Math.round(tw*100)/100} | ${Math.round(ta*100)/100} | ${dateToStr(prows[0].saleDate)} | ${dateToStr(prows[prows.length-1].saleDate)} |\n`
})

md += `\n## All Products With Sales After Start Date\n\n`
for (const [productName, prows] of sortedProducts) {
  const startDate = PRODUCT_START_DATES[productName]
  const tw = prows.reduce((s, r) => s + r.weight, 0)
  const ta = prows.reduce((s, r) => s + r.amount, 0)
  md += `### ${productName} (start: ${dateToStr(startDate)}, ${prows.length} rows, ${Math.round(tw*100)/100} kg, ${Math.round(ta*100)/100} THB)\n\n`
  md += `| Sale date | Bill no | Buyer | Weight (kg) | Price/kg | Amount (THB) |\n|---|---|---|---:|---:|---:|\n`
  for (const r of prows) {
    md += `| ${r.saleDateStr} | ${r.billNumber} | ${r.buyerName} | ${r.weight} | ${r.pricePerKg} | ${r.amount} |\n`
  }
  md += `\n`
}

md += `## Unmatched Sales Products\n\n`
if (unmatchedAgg.size === 0) {
  md += `None.\n\n`
} else {
  md += `| Raw name | Code | Rows | Weight (kg) | Reason |\n|---|---|---:|---:|---|\n`
  for (const agg of [...unmatchedAgg.values()].sort((a, b) => b.weight - a.weight)) {
    md += `| ${agg.rawName} | ${agg.productCode} | ${agg.rows} | ${Math.round(agg.weight*100)/100} | ${agg.reason} |\n`
  }
  md += `\n`
}

md += `## Ambiguous Sales Products\n\n`
if (ambAgg.size === 0) {
  md += `None — all products matched cleanly.\n\n`
} else {
  md += `| Raw name | Code | Rows | Weight (kg) | Possible matches |\n|---|---|---:|---:|---|\n`
  for (const agg of [...ambAgg.values()].sort((a, b) => b.weight - a.weight)) {
    md += `| ${agg.rawName} | ${agg.productCode} | ${agg.rows} | ${Math.round(agg.weight*100)/100} | ${agg.possibleMatches.join(', ')} |\n`
  }
  md += `\n`
}

md += `## Stock Reconciliation Note\n\n`
md += `These sales **should be deducted** during the stock reconciliation step, but:\n`
md += `- Do NOT deduct them yet\n`
md += `- Do NOT create SellBills\n`
md += `- Do NOT adjust stock quantities\n`
md += `- Owner must review this list first\n\n`

md += `## Safety Confirmation\n\n`
md += `- ✅ No production data modified\n`
md += `- ✅ No SellBills created\n`
md += `- ✅ No StockLots created or deleted\n`
md += `- ✅ No stock adjusted\n`
md += `- ✅ No product master changed\n\n`
md += `**No production data was modified.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

// ============ CONSOLE OUTPUT ============
console.log('\n=== FINAL REPORT ===')
console.log(`1.  Total Excel rows parsed:              ${rows.length}`)
console.log(`2.  Total detailed sale item rows:        ${itemRows.length}`)
console.log(`3.  Unique raw sale product names:        ${uniqueRawNames.size}`)
console.log(`4.  Matched product count:                ${byProduct.size}`)
console.log(`5.  Unmatched product count:              ${unmatchedAgg.size}`)
console.log(`6.  Ambiguous product count:              ${ambAgg.size}`)
console.log(`7.  Products with sales after start date: ${byProduct.size}`)
console.log(`8.  Total sale rows after start date:     ${matched.length}`)
console.log(`9.  Total sale weight after start date:   ${Math.round(totalWeightAfter*100)/100} kg`)
console.log(`10. Total sale amount after start date:   ${Math.round(totalAmountAfter*100)/100} THB`)
console.log(`11. Output folder:                        ${OUTPUT_DIR}`)
console.log(`12. Owner review needed:                  YES (before stock reconciliation)`)

console.log('\nTop products by sale weight after start date:')
sortedProducts.slice(0, 10).forEach(([name, prows], i) => {
  const tw = prows.reduce((s, r) => s + r.weight, 0)
  const ta = prows.reduce((s, r) => s + r.amount, 0)
  console.log(`  ${String(i+1).padStart(3)}. ${name.padEnd(35)} ${dateToStr(PRODUCT_START_DATES[name]).padEnd(12)} ${String(prows.length).padStart(4)} rows  ${String(Math.round(tw*100)/100).padStart(12)} kg  ${String(Math.round(ta*100)/100).padStart(12)} THB`)
})

console.log('\nNo production data was modified.')
