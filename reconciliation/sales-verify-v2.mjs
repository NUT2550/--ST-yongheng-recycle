/**
 * Task 46: Update Sales After Start Date Verification With Owner Decisions v2
 * VERIFICATION / REPORT ONLY — no production modifications.
 *
 * Owner decisions for 4 previously-unmatched products:
 * 1. "-" / code 0210 → EXCLUDED_NOT_IN_SCOPE (owner intentionally deleted/blanked)
 * 2. ทองแดงท่อ Candy → SORTING_RELATED_SALES_NEED_MOVEMENT (sorting/dismantling output from ทองแดงใหญ่)
 * 3. อลูมิเนียมแผ่นเพจ → map to อลูมิเนียมแผ่นเพลท (old wrong name, now deleted)
 * 4. อลูมิเนียมเพลท → map to อลูมิเนียมแผ่นเพลท (owner prefers อลูมิเนียมเพลท as future name)
 */
import xlsx from 'xlsx'
import fs from 'fs'
import path from 'path'

const INPUT_FILE = '/home/z/my-project/upload/รวมขายสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls'
const OUTPUT_DIR = '/home/z/my-project/reconciliation/sales-after-start-date-verification-v2'
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

// ============ PRODUCT START DATES + MAPPINGS ============
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

// Owner-confirmed mappings (same as Task 43 purchase split + Task 46 new decisions)
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
  // Task 46 new mappings:
  'อลูมิเนียมแผ่นเพจ': 'อลูมิเนียมแผ่นเพลท',  // old wrong name → active product
  'อลูมิเนียมเพลท': 'อลูมิเนียมแผ่นเพลท',      // owner prefers อลูมิเนียมเพลท as future name
}

const OUT_OF_SCOPE_NAMES = new Set([
  'ของแกะ', 'ของแกะราคาสูง',
  'ทองเหลืองเกินจาก ST', 'ทองเหลืองขาดจาก ST',
  'ทองแดงเกินจาก ST', 'ทองแดงขาดจาก ST',
  'เหล็กสลิง,สแตน',
])

// Sorting-related sales that need movement (not direct deduction)
const SORTING_RELATED_NAMES = new Set([
  'ทองแดงท่อ Candy',
  'ทองแดงท่อCandy',  // variant without space
])

// Build raw→final mapping
const rawToFinal = new Map()
for (const finalName of Object.keys(PRODUCT_START_DATES)) {
  rawToFinal.set(normalize(finalName), finalName)
}
for (const [rawName, finalName] of Object.entries(OWNER_MAPPINGS)) {
  rawToFinal.set(normalize(rawName), finalName)
}

// ============ PARSE SALES FILE ============
console.log('=== PARSING SALES FILE ===')
const buf = fs.readFileSync(INPUT_FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log(`Total Excel rows: ${rows.length}`)

const itemRows = []
let currentProduct = null
let currentProductCode = null

for (let i = 4; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
  if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
  const col0 = fixed[0], col1 = fixed[1]
  if (col0 && /^\d{4}$/.test(String(col0).trim()) && col1 && typeof col1 === 'string' && !parseThaiDate(col0)) {
    currentProductCode = String(col0).trim()
    currentProduct = String(col1).trim()
    continue
  }
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

// ============ MATCH + CLASSIFY ============
console.log('\n=== MATCHING & CLASSIFYING ===')

const uniqueRawNames = new Set()
for (const row of itemRows) uniqueRawNames.add(row.rawProductName)

const matched = []              // matched + sale date >= start date
const excludedBeforeDate = []   // matched but sale date < start date
const excludedNotInScope = []   // out-of-scope (steel, ของแกะ, ST variants, "-" / 0210)
const sortingRelated = []       // sorting-related sales needing movement (ทองแดงท่อ Candy)
const unmatched = []            // truly unmatched (should be 0 after owner decisions)
const ambiguous = []            // ambiguous (should be 0)

let alPlateRowsMapped = 0

for (const row of itemRows) {
  const rawNorm = row.normRawName
  
  // 1. Check sorting-related (ทองแดงท่อ Candy) — BEFORE other checks
  if (SORTING_RELATED_NAMES.has(row.rawProductName) || SORTING_RELATED_NAMES.has(rawNorm)) {
    sortingRelated.push({
      ...row,
      matchedProductName: '(SORTING RELATED)',
      requiredHandling: 'Create/verify sorting movement before final stock reconciliation',
      recommendedSourceProduct: 'ทองแดงใหญ่',
      recommendedMovementType: 'sorting/dismantling output from ทองแดงใหญ่',
    })
    continue
  }
  
  // 2. Check out-of-scope
  if (OUT_OF_SCOPE_NAMES.has(row.rawProductName) || OUT_OF_SCOPE_NAMES.has(rawNorm)) {
    excludedNotInScope.push({ ...row, matchedProductName: '(OUT OF SCOPE)', startDateUsed: '', matchStatus: 'out_of_scope', exclusionReason: 'Owner scope decision' })
    continue
  }
  
  // 3. Check "-" / empty name (code 0210) — owner intentionally deleted/blanked
  if (row.rawProductName === '-' || row.rawProductName.trim() === '') {
    excludedNotInScope.push({ ...row, matchedProductName: '(OWNER DELETED/BLANKED)', startDateUsed: '', matchStatus: 'owner_deleted', exclusionReason: 'Owner intentionally deleted/blanked product name (code 0210)' })
    continue
  }
  
  // 4. Check steel products
  const isSteel = (row.productCode && row.productCode.startsWith('01')) || row.rawProductName.startsWith('เหล็ก') || row.rawProductName.includes('เหล็ก')
  if (isSteel && !rawToFinal.has(rawNorm)) {
    excludedNotInScope.push({ ...row, matchedProductName: '(UNMATCHED STEEL)', startDateUsed: '', matchStatus: 'unmatched_steel', exclusionReason: 'Unmatched steel — out of scope' })
    continue
  }
  
  // 5. Check exact/alias match (now includes อลูมิเนียมแผ่นเพจ and อลูมิเนียมเพลท)
  const finalName = rawToFinal.get(rawNorm)
  if (finalName) {
    // Track aluminum plate mappings
    if (finalName === 'อลูมิเนียมแผ่นเพลท' && (row.rawProductName === 'อลูมิเนียมแผ่นเพจ' || row.rawProductName === 'อลูมิเนียมเพลท')) {
      alPlateRowsMapped++
    }
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
    // Check ambiguous (multiple contains-matches)
    const containsMatches = []
    for (const fn of Object.keys(PRODUCT_START_DATES)) {
      const fnNorm = normalize(fn)
      if (fnNorm.includes(rawNorm) || rawNorm.includes(fnNorm)) {
        containsMatches.push(fn)
      }
    }
    if (containsMatches.length > 1) {
      ambiguous.push({ ...row, matchedProductName: '(AMBIGUOUS)', matchStatus: 'ambiguous', possibleMatches: containsMatches, exclusionReason: `Multiple matches: ${containsMatches.join(', ')}` })
    } else if (containsMatches.length === 1) {
      const fn = containsMatches[0]
      const startDate = PRODUCT_START_DATES[fn]
      if (startDate) {
        if (row.saleDate < startDate) {
          excludedBeforeDate.push({ ...row, matchedProductName: fn, startDateUsed: dateToStr(startDate), matchStatus: 'excluded_before_start_date' })
        } else {
          matched.push({ ...row, matchedProductName: fn, startDateUsed: dateToStr(startDate), matchStatus: 'matched_included' })
        }
      }
    } else {
      unmatched.push({ ...row, matchedProductName: '(UNMATCHED)', matchStatus: 'unmatched', exclusionReason: 'No matching product' })
    }
  }
}

console.log(`Matched (included after date filter): ${matched.length}`)
console.log(`Excluded before start date: ${excludedBeforeDate.length}`)
console.log(`Excluded not in scope: ${excludedNotInScope.length}`)
console.log(`Sorting-related (need movement): ${sortingRelated.length}`)
console.log(`Unmatched: ${unmatched.length}`)
console.log(`Ambiguous: ${ambiguous.length}`)
console.log(`Aluminum plate rows mapped: ${alPlateRowsMapped}`)

// ============ GENERATE OUTPUT FILES ============
console.log('\n=== GENERATING OUTPUT FILES ===')

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
const byProduct = new Map()
for (const r of matched) {
  if (!byProduct.has(r.matchedProductName)) byProduct.set(r.matchedProductName, [])
  byProduct.get(r.matchedProductName).push(r)
}

const summaryCols = ['No.','product name','start date','sale rows after start date','total sale weight after start date','total sale amount after start date','first sale date after start date','last sale date after start date','owner review needed','note']
const csvLines2 = [summaryCols.join(',')]
let sumIdx = 1
const sortedProducts = [...byProduct.entries()].sort((a, b) => {
  const wA = a[1].reduce((s, r) => s + r.weight, 0)
  const wB = b[1].reduce((s, r) => s + r.weight, 0)
  return wB - wA
})
for (const [productName, prows] of sortedProducts) {
  const startDate = PRODUCT_START_DATES[productName]
  const totalWeight = prows.reduce((s, r) => s + r.weight, 0)
  const totalAmount = prows.reduce((s, r) => s + r.amount, 0)
  const firstDate = prows[0].saleDate
  const lastDate = prows[prows.length - 1].saleDate
  let note = 'Sales after start date — will need to be deducted during stock reconciliation'
  if (productName === 'อลูมิเนียมแผ่นเพลท') {
    note += ' | NOTE: owner prefers future name "อลูมิเนียมเพลท" — product master cleanup recommended later'
  }
  csvLines2.push([
    sumIdx++, productName, dateToStr(startDate), prows.length,
    Math.round(totalWeight * 100) / 100, Math.round(totalAmount * 100) / 100,
    dateToStr(firstDate), dateToStr(lastDate),
    'no', note
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

// 4. EXCLUDED_NOT_IN_SCOPE_SALES.csv (now includes "-" / 0210)
const scopeCols = [...detailCols, 'exclusion reason']
const csvLines4 = [scopeCols.join(',')]
for (const r of excludedNotInScope) {
  csvLines4.push([
    r.sourceSheet, r.sourceRow, r.saleDateStr, r.startDateUsed || '', r.billNumber,
    r.buyerCode, r.buyerName, r.rawProductName, r.matchedProductName,
    r.productCode, r.weight, r.unit, r.pricePerKg, r.amount, r.note,
    r.exclusionReason || 'Out of scope'
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'EXCLUDED_NOT_IN_SCOPE_SALES.csv'), '\ufeff' + csvLines4.join('\n'), 'utf-8')
console.log('  ✓ EXCLUDED_NOT_IN_SCOPE_SALES.csv')

// 5. SORTING_RELATED_SALES_NEED_MOVEMENT.csv
const sortingCols = ['No.','sale date','bill number','buyer/customer','raw product name','product code','weight','price per kg','amount','note','required handling','recommended source product','recommended future movement type']
const csvLines5 = [sortingCols.join(',')]
sortingRelated.forEach((r, i) => {
  csvLines5.push([
    i + 1, r.saleDateStr, r.billNumber, r.buyerName, r.rawProductName,
    r.productCode, r.weight, r.pricePerKg, r.amount, r.note,
    r.requiredHandling, r.recommendedSourceProduct, r.recommendedMovementType
  ].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'SORTING_RELATED_SALES_NEED_MOVEMENT.csv'), '\ufeff' + csvLines5.join('\n'), 'utf-8')
console.log(`  ✓ SORTING_RELATED_SALES_NEED_MOVEMENT.csv (${sortingRelated.length} rows)`)

// 6. UNMATCHED_SALES_PRODUCTS.csv (should be 0 after owner decisions)
const unmatchedCols = ['No.','raw product name','normalized name','product code','rows','total weight','total amount','reason']
const unmatchedAgg = new Map()
for (const r of unmatched) {
  const key = r.rawProductName
  if (!unmatchedAgg.has(key)) unmatchedAgg.set(key, { rawName: key, normName: r.normRawName, productCode: r.productCode, rows: 0, weight: 0, amount: 0, reason: r.exclusionReason })
  const agg = unmatchedAgg.get(key)
  agg.rows++; agg.weight += r.weight; agg.amount += r.amount
}
const csvLines6 = [unmatchedCols.join(',')]
let unmIdx = 1
for (const agg of [...unmatchedAgg.values()].sort((a, b) => b.weight - a.weight)) {
  csvLines6.push([unmIdx++, agg.rawName, agg.normName, agg.productCode, agg.rows, Math.round(agg.weight*100)/100, Math.round(agg.amount*100)/100, agg.reason].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNMATCHED_SALES_PRODUCTS.csv'), '\ufeff' + csvLines6.join('\n'), 'utf-8')
console.log(`  ✓ UNMATCHED_SALES_PRODUCTS.csv (${unmatchedAgg.size} items)`)

// 7. AMBIGUOUS_SALES_PRODUCTS.csv (should be 0)
const ambCols = ['No.','raw product name','normalized name','product code','rows','total weight','total amount','possible matches','reason']
const ambAgg = new Map()
for (const r of ambiguous) {
  const key = r.rawProductName
  if (!ambAgg.has(key)) ambAgg.set(key, { rawName: key, normName: r.normRawName, productCode: r.productCode, rows: 0, weight: 0, amount: 0, possibleMatches: r.possibleMatches, reason: r.exclusionReason })
  const agg = ambAgg.get(key)
  agg.rows++; agg.weight += r.weight; agg.amount += r.amount
}
const csvLines7 = [ambCols.join(',')]
let ambIdx = 1
for (const agg of [...ambAgg.values()].sort((a, b) => b.weight - a.weight)) {
  csvLines7.push([ambIdx++, agg.rawName, agg.normName, agg.productCode, agg.rows, Math.round(agg.weight*100)/100, Math.round(agg.amount*100)/100, agg.possibleMatches.join(' | '), agg.reason].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'AMBIGUOUS_SALES_PRODUCTS.csv'), '\ufeff' + csvLines7.join('\n'), 'utf-8')
console.log(`  ✓ AMBIGUOUS_SALES_PRODUCTS.csv (${ambAgg.size} items)`)

// 8. FINAL_REPORT.md
const totalWeightAfter = matched.reduce((s, r) => s + r.weight, 0)
const totalAmountAfter = matched.reduce((s, r) => s + r.amount, 0)
const sortingWeight = sortingRelated.reduce((s, r) => s + r.weight, 0)
const sortingAmount = sortingRelated.reduce((s, r) => s + r.amount, 0)

let md = `# Sales After Start Date Verification v2 — With Owner Decisions\n\n`
md += `**Task 46**: Update Sales After Start Date Verification With Owner Decisions\n`
md += `**Status**: VERIFICATION / REPORT ONLY — No production data modified.\n`
md += `**Input file**: รวมขายสิ้นค้า 1-1-69 ถึง 6-7-69 แบบละเอียด.xls\n\n`

md += `## Owner Decisions Applied\n\n`
md += `| # | Raw name | Decision | Destination |\n|---|---|---|---|\n`
md += `| 1 | "-" / code 0210 | Owner intentionally deleted/blanked | EXCLUDED_NOT_IN_SCOPE_SALES.csv |\n`
md += `| 2 | ทองแดงท่อ Candy | Sorting/dismantling output from ทองแดงใหญ่ | SORTING_RELATED_SALES_NEED_MOVEMENT.csv |\n`
md += `| 3 | อลูมิเนียมแผ่นเพจ | Map to อลูมิเนียมแผ่นเพลท (old wrong name) | SALES_AFTER_START_DATE.csv |\n`
md += `| 4 | อลูมิเนียมเพลท | Map to อลูมิเนียมแผ่นเพลท (owner prefers "อลูมิเนียมเพลท" as future name) | SALES_AFTER_START_DATE.csv |\n\n`

md += `## Aluminum Plate Naming Check\n\n`
md += `| Check | Result |\n|---|---|\n`
md += `| Current active MT product "อลูมิเนียมแผ่นเพลท" | EXISTS — id cmr7a7plm0007mzie5kkgqpdh (0 stock) |\n`
md += `| Old MT product "อลูมิเนียมเพลท" | EXISTS — id prod_mqgp9g5d78sw9tuoeuem3i1b (0 stock) |\n`
md += `| Owner-preferred future name | อลูมิเนียมเพลท |\n`
md += `| Product master cleanup recommended? | YES — consolidate to one product (owner prefers "อลูมิเนียมเพลท") |\n`
md += `| For this report, matched to | อลูมิเนียมแผ่นเพลท (has start date 23/06/2569) |\n\n`

md += `## Summary\n\n`
md += `| # | Metric | Value |\n|---|---|---:|\n`
md += `| 1 | Total Excel rows parsed | ${rows.length} |\n`
md += `| 2 | Total detailed sale item rows | ${itemRows.length} |\n`
md += `| 3 | Sales after start date row count | ${matched.length} |\n`
md += `| 4 | Sales after start date total weight | ${Math.round(totalWeightAfter*100)/100} kg |\n`
md += `| 5 | Product count with sales after start date | ${byProduct.size} |\n`
md += `| 6 | Unmatched count after owner decisions | ${unmatchedAgg.size} |\n`
md += `| 7 | Ambiguous count after owner decisions | ${ambAgg.size} |\n`
md += `| 8 | Excluded not in scope count | ${excludedNotInScope.length} |\n`
md += `| 9 | Sorting-related sale rows requiring movement | ${sortingRelated.length} |\n`
md += `| 10 | Aluminum plate rows mapped | ${alPlateRowsMapped} |\n`
md += `| 11 | Current active aluminum plate product name | อลูมิเนียมแผ่นเพลท |\n`
md += `| 12 | Owner-preferred aluminum plate name | อลูมิเนียมเพลท |\n`
md += `| 13 | Product master cleanup recommended later? | YES |\n`
md += `| 14 | Output folder path | ${OUTPUT_DIR} |\n`
md += `| 15 | Report ready for owner review | YES |\n\n`

md += `## Top Products by Sale Weight After Start Date\n\n`
md += `| # | Product | Start date | Rows | Weight (kg) | Amount (THB) |\n|---|---|---|---:|---:|---:|\n`
sortedProducts.slice(0, 15).forEach(([productName, prows], i) => {
  const startDate = PRODUCT_START_DATES[productName]
  const tw = prows.reduce((s, r) => s + r.weight, 0)
  const ta = prows.reduce((s, r) => s + r.amount, 0)
  md += `| ${i+1} | ${productName} | ${dateToStr(startDate)} | ${prows.length} | ${Math.round(tw*100)/100} | ${Math.round(ta*100)/100} |\n`
})

md += `\n## Sorting-Related Sales (Require Movement Before Reconciliation)\n\n`
md += `| Sale date | Bill no | Buyer | Raw name | Weight (kg) | Amount (THB) | Required handling |\n|---|---|---|---|---:|---:|---|\n`
for (const r of sortingRelated) {
  md += `| ${r.saleDateStr} | ${r.billNumber} | ${r.buyerName} | ${r.rawProductName} | ${r.weight} | ${r.amount} | ${r.requiredHandling} |\n`
}
md += `\n**Source product**: ทองแดงใหญ่\n`
md += `**Movement type**: sorting/dismantling output from ทองแดงใหญ่\n`
md += `**Total**: ${sortingRelated.length} rows, ${Math.round(sortingWeight*100)/100} kg, ${Math.round(sortingAmount*100)/100} THB\n\n`

md += `## Unmatched Sales Products (after owner decisions)\n\n`
if (unmatchedAgg.size === 0) {
  md += `**0 unmatched** — all products matched after owner decisions. ✅\n\n`
} else {
  md += `| Raw name | Code | Rows | Weight | Reason |\n|---|---|---:|---:|---|\n`
  for (const agg of [...unmatchedAgg.values()]) {
    md += `| ${agg.rawName} | ${agg.productCode} | ${agg.rows} | ${Math.round(agg.weight*100)/100} | ${agg.reason} |\n`
  }
  md += `\n`
}

md += `## Ambiguous Sales Products\n\n`
if (ambAgg.size === 0) {
  md += `**0 ambiguous** — all products matched cleanly. ✅\n\n`
} else {
  md += `| Raw name | Possible matches |\n|---|---|\n`
  for (const agg of [...ambAgg.values()]) {
    md += `| ${agg.rawName} | ${agg.possibleMatches.join(', ')} |\n`
  }
  md += `\n`
}

md += `## Stock Reconciliation Note\n\n`
md += `These sales **should be deducted** during the stock reconciliation step, but:\n`
md += `- Do NOT deduct them yet\n`
md += `- Do NOT create SellBills\n`
md += `- Do NOT adjust stock quantities\n`
md += `- Owner must review this list first\n`
md += `- ทองแดงท่อ Candy sales require sorting/dismantling movement first (not direct deduction from ทองแดงใหญ่)\n\n`

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
console.log(`3.  Sales after start date row count:     ${matched.length}`)
console.log(`4.  Sales after start date total weight:  ${Math.round(totalWeightAfter*100)/100} kg`)
console.log(`5.  Product count with sales after sdate: ${byProduct.size}`)
console.log(`6.  Unmatched count after owner decisions: ${unmatchedAgg.size}`)
console.log(`7.  Ambiguous count after owner decisions: ${ambAgg.size}`)
console.log(`8.  Excluded not in scope count:          ${excludedNotInScope.length}`)
console.log(`9.  Sorting-related sale rows:            ${sortingRelated.length}`)
console.log(`10. Aluminum plate rows mapped:           ${alPlateRowsMapped}`)
console.log(`11. Current active al plate product:      อลูมิเนียมแผ่นเพลท`)
console.log(`12. Owner-preferred al plate name:        อลูมิเนียมเพลท`)
console.log(`13. Product master cleanup recommended:   YES`)
console.log(`14. Output folder:                        ${OUTPUT_DIR}`)
console.log(`15. Report ready for owner review:        YES`)

console.log('\nNo production data was modified.')
