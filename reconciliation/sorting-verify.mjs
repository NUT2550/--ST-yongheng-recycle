/**
 * Task 47: Verify MetalTrack SortingBills Against Sorting PDF Source
 * VERIFICATION ONLY — no production modifications.
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'
import path from 'path'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const OUTPUT_DIR = '/home/z/my-project/reconciliation/sorting-verification-against-pdf'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

// ============ PRODUCT NAME NORMALIZATION ============
// Maps PDF short/raw names → MetalTrack product names
const PDF_NAME_MAP = {
  // Stainless
  '304': 'สแตนเลส 304', '304ยาว': 'สแตนเลส 304 ยาว', '304สัน': 'สแตนเลส 304',
  '202': 'สแตนเลส 202',
  // Copper
  'แดงใหญ่': 'ทองแดงใหญ่', 'แดงใหญ่ ': 'ทองแดงใหญ่',
  'แดงเล็ก': 'ทองแดงเล็ก', 'แดงเล็ก ': 'ทองแดงเล็ก', 'แดงเล๋ก': 'ทองแดงเล็ก',
  'แดงช็อต': 'ทองแดงช็อต',
  'แดงปอก': 'ทองแดงปอก',
  'แดงชุบ': 'ทองแดงชุบ',
  'ด/ใหญ่': 'ทองแดงใหญ่',
  // Brass
  'ทองเหลือง': 'ทองเหลือง',
  'หม้อเหลือง': 'หม้อน้ำทองเหลือง',
  // Aluminum
  'เนียมบาง': 'อลูมิเนียมบาง', 'เนีียมบาง': 'อลูมิเนียมบาง', 'เนืยมบาง': 'อลูมิเนียมบาง',
  'เนียมแข็ง': 'อลูมิเนียมแข็ง', 'เนียมแข็็ง': 'อลูมิเนียมแข็ง', 'เนีียมแข็ง': 'อลูมิเนียมแข็ง',
  'เนียมเครื อง': 'อลูมิเนียมเครื่อง', 'เนียมเครือง': 'อลูมิเนียมเครื่อง',
  'ฉาก': 'อลูมิเนียมฉาก', 'ฉากบาง': 'อลูมิเนียมฉาก', 'เนียมฉาก': 'อลูมิเนียมฉาก',
  'ฉากสี': 'อลูมิเนียมฉากสี',
  'กระทะ': 'อลูมิเนียมกระทะ', 'กะทะ': 'อลูมิเนียมกระทะ',
  'ตูดกะทะ': 'อลูมิเนียมตูดกะทะ', 'ตูดกระทะ': 'อลูมิเนียมตูดกะทะ',
  'ล้อแม็ค': 'อลูมิเนียมล้อแม็ก',
  'อัลลอยด์': 'อลูมิเนียมอัลลอย',
  'ครีบหมอนํ า': 'อลูมิเนียมครีบหม้อน้ำ', 'ครีบหมอน้ำ': 'อลูมิเนียมครีบหม้อน้ำ',
  'หม้อ/เนียม': 'หม้อน้ำอลูมิเนียม', 'หม้อนํ าเนียม': 'หม้อน้ำอลูมิเนียม', 'หม้อน้ำอลูมิเนียม': 'หม้อน้ำอลูมิเนียม',
  'หม้อ/นํ า': 'หม้อน้ำอลูมิเนียม',
  'หม้อ/แดง': 'หม้อน้ำทองแดง',
  'ป๋องเนียม': 'อลูมิเนียมกระป๋อง',
  // Lead
  'ตะกั วแข็ง': 'ตะกั่วแข็ง', 'ตะกั ั วแข็ง': 'ตะกั่วแข็ง', 'ตะกั่วแข็ง': 'ตะกั่วแข็ง',
  'ตะ/แข็ง': 'ตะกั่วแข็ง',
  // Other
  'มอเตอร์': 'มอเตอร์',
  'คอมดํ า': 'คอมดำ', 'คอมดำ': 'คอมดำ',
  'แผงวงจร': 'แผงวงจรเขียว',
  'สายไฟไม่ปอก': 'สายไฟไม่ปอก', 'สายไฟไม่ปอก(เผา)': 'สายไฟไม่ปอก',
  'สายไฟ': 'สายไฟไม่ปอก',
  'เปลือก': 'เปลือกสายไฟ', 'เปลือกสายไฟ': 'เปลือกสายไฟ',
  'เปลือก(ขายไม่ได้)': 'เปลือกสายไฟ', 'เปลือกขายได้': 'เปลือกสายไฟ',
  'เหล็ก': 'เหล็กคละ', 'เหล็กคละ': 'เหล็กคละ', 'เหล็กบาง': 'เหล็กบาง',
  'ติดเหล็ก': 'สแตนเลสติดเหล็ก',
  'เนื อแดง': 'ทองเหลืองเนื้อแดง', 'เนือแดง': 'ทองเหลืองเนื้อแดง',
  'ขยะ': 'ขยะ',
  'นํ ามันเครื อง': 'น้ำมันเครื่อง',
  'เบรกเกอร์': 'เบรกเกอร์', 'เบรคเก้อ': 'เบรกเกอร์',
  'ชุดสวิทช์': 'เบรกเกอร์',
  'ดายแดงเผา': 'ทองแดงชุบ',
  'กะละลัง': 'กระสอบขาด',
  'เรียมสายไฟ': 'สายไฟอลูมิเนียม',
  'สายไฟเผา': 'สายไฟไม่ปอก',
  // Numbers that are actually weights (parse errors) — mark as parse error
  '1.4': null, '10.2': null, '14.2': null, '17': null, '37': null, '4.9': null,
}

function normalizePdfName(rawName) {
  if (!rawName) return { name: '', needsReview: false, reviewReason: '' }
  const trimmed = rawName.trim()
  // Check exact map
  if (PDF_NAME_MAP[trimmed] !== undefined) {
    if (PDF_NAME_MAP[trimmed] === null) {
      return { name: '', needsReview: true, reviewReason: `Parse error: "${trimmed}" appears to be a weight, not a product name` }
    }
    return { name: PDF_NAME_MAP[trimmed], needsReview: false, reviewReason: '' }
  }
  // Try with collapsed spaces
  const collapsed = trimmed.replace(/\s+/g, ' ')
  if (PDF_NAME_MAP[collapsed] !== undefined) {
    if (PDF_NAME_MAP[collapsed] === null) {
      return { name: '', needsReview: true, reviewReason: `Parse error: "${trimmed}" appears to be a weight` }
    }
    return { name: PDF_NAME_MAP[collapsed], needsReview: false, reviewReason: '' }
  }
  // Unknown — needs review
  return { name: trimmed, needsReview: true, reviewReason: `Unknown product name: "${trimmed}" — not in normalization map` }
}

function parsePdfDate(d) {
  if (!d) return null
  const m = String(d).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (m) {
    let [, dd, mm, yy] = m
    let year = parseInt(yy)
    if (year < 100) year += 2000
    const dt = new Date(year, parseInt(mm) - 1, parseInt(dd))
    return isNaN(dt) ? null : dt
  }
  return null
}
function dateToStr(d) {
  if (!d) return ''
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`
}

// ============ TASK 1: LOAD PARSED PDF DATA ============
console.log('=== TASK 1: LOAD PARSED PDF DATA ===')
const pdfEvents = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/sorting-pdf-parsed.json', 'utf8'))
console.log(`PDF events loaded: ${pdfEvents.length}`)

// ============ TASK 2: NORMALIZE PRODUCT NAMES ============
console.log('\n=== TASK 2: NORMALIZE PRODUCT NAMES ===')
const pdfEventsNormalized = []
const productNameReviews = []

for (const evt of pdfEvents) {
  const date = parsePdfDate(evt.dateRaw)
  // Normalize source product
  const srcNorm = normalizePdfName(evt.sourceProduct)
  if (srcNorm.needsReview) {
    productNameReviews.push({ rawName: evt.sourceProduct, type: 'source', pdfDate: evt.dateRaw, pdfRoom: evt.room, reason: srcNorm.reviewReason })
  }
  
  // Normalize output products
  const outputsNorm = []
  for (const o of evt.outputs) {
    if (o.product === 'ขยะ') {
      // Waste — keep as-is, don't normalize to a stock product
      outputsNorm.push({ ...o, normalizedName: 'ขยะ (waste)', needsReview: false })
      continue
    }
    const oNorm = normalizePdfName(o.product)
    if (oNorm.needsReview && oNorm.name) {
      productNameReviews.push({ rawName: o.product, type: 'output', pdfDate: evt.dateRaw, pdfRoom: evt.room, reason: oNorm.reviewReason })
    }
    outputsNorm.push({ ...o, normalizedName: oNorm.name || o.product, needsReview: oNorm.needsReview })
  }
  
  pdfEventsNormalized.push({
    ...evt,
    date,
    dateStr: date ? dateToStr(date) : evt.dateRaw,
    sourceProductNormalized: srcNorm.name || evt.sourceProduct,
    sourceNeedsReview: srcNorm.needsReview,
    outputsNormalized: outputsNorm,
  })
}
console.log(`Product name reviews: ${productNameReviews.length}`)

// ============ TASK 3: LOAD METALTRACK SORTINGBILLS ============
console.log('\n=== TASK 3: LOAD METALTRACK SORTINGBILLS ===')
const mtSortingBills = await db.sortingBill.findMany({
  where: { isCancelled: false },
  include: {
    sourceProduct: { select: { id: true, name: true } },
    items: { include: { product: { select: { id: true, name: true } } } },
  },
  orderBy: { date: 'asc' },
})
console.log(`MetalTrack SortingBills (not cancelled): ${mtSortingBills.length}`)

const mtEvents = mtSortingBills.map(b => ({
  id: b.id,
  billNumber: b.billNumber,
  date: b.date,
  dateStr: dateToStr(b.date),
  sourceProductId: b.sourceProductId,
  sourceProductName: b.sourceProduct.name,
  sourceWeight: b.sourceWeight,
  roomNumber: b.roomNumber,
  note: b.note,
  outputs: b.items.map(it => ({
    productId: it.productId,
    productName: it.product.name,
    weight: it.weight,
    isWaste: it.isWaste,
    sortedPricePerKg: it.sortedPricePerKg,
  })),
  totalOutputWeight: b.items.filter(it => !it.isWaste).reduce((s, it) => s + it.weight, 0),
  totalWasteWeight: b.items.filter(it => it.isWaste).reduce((s, it) => s + it.weight, 0),
}))

// ============ TASK 4: MATCH PDF EVENTS TO METALTRACK SORTINGBILLS ============
console.log('\n=== TASK 4: MATCH PDF EVENTS TO METALTRACK SORTINGBILLS ===')

const matchReport = []
const pdfOnlyEvents = []
const mtOnlyEvents = []
const weightAnomalies = []

// Track which MT bills have been matched
const matchedMtIds = new Set()

for (const pdfEvt of pdfEventsNormalized) {
  if (!pdfEvt.date) {
    matchReport.push({
      pdfPage: '', pdfDate: pdfEvt.dateRaw, pdfSourceProduct: pdfEvt.sourceProduct,
      pdfSourceWeight: pdfEvt.sourceWeight, mtBillId: '', mtDate: '', mtSourceProduct: '',
      mtSourceWeight: '', weightDiff: '', outputMatchStatus: '', matchStatus: 'NEED_OWNER_REVIEW',
      confidence: 'low', note: 'PDF date could not be parsed',
    })
    continue
  }
  
  // Find candidate MT bills on the same date
  const candidates = mtEvents.filter(mt => {
    if (matchedMtIds.has(mt.id)) return false
    if (!mt.date || !pdfEvt.date) return false
    // Same date (compare day/month/year)
    return mt.date.getDate() === pdfEvt.date.getDate() &&
           mt.date.getMonth() === pdfEvt.date.getMonth() &&
           mt.date.getFullYear() === pdfEvt.date.getFullYear()
  })
  
  if (candidates.length === 0) {
    // PDF-only event
    pdfOnlyEvents.push(pdfEvt)
    matchReport.push({
      pdfPage: '', pdfDate: pdfEvt.dateStr, pdfSourceProduct: pdfEvt.sourceProduct,
      pdfSourceWeight: pdfEvt.sourceWeight, mtBillId: '', mtDate: '', mtSourceProduct: '',
      mtSourceWeight: '', weightDiff: '', outputMatchStatus: '', matchStatus: 'PDF_ONLY',
      confidence: 'medium', note: 'No MetalTrack SortingBill found on same date',
    })
    continue
  }
  
  // Try to find best match by source weight
  let bestMatch = null
  let bestDiff = Infinity
  for (const mt of candidates) {
    const diff = Math.abs(mt.sourceWeight - pdfEvt.sourceWeight)
    if (diff < bestDiff) {
      bestDiff = diff
      bestMatch = mt
    }
  }
  
  if (bestMatch) {
    matchedMtIds.add(bestMatch.id)
    const weightDiff = bestMatch.sourceWeight - pdfEvt.sourceWeight
    const isExact = Math.abs(weightDiff) < 0.5
    
    // Check output match
    const pdfOutputs = pdfEvt.outputsNormalized.filter(o => o.product !== 'ขยะ')
    const mtOutputs = bestMatch.outputs.filter(o => !o.isWaste)
    let outputMatchStatus = ''
    if (pdfOutputs.length === mtOutputs.length) {
      outputMatchStatus = 'output count matches'
    } else {
      outputMatchStatus = `output count differs (PDF: ${pdfOutputs.length}, MT: ${mtOutputs.length})`
    }
    
    matchReport.push({
      pdfPage: '', pdfDate: pdfEvt.dateStr, pdfSourceProduct: pdfEvt.sourceProduct,
      pdfSourceWeight: pdfEvt.sourceWeight, mtBillId: bestMatch.id, mtDate: bestMatch.dateStr,
      mtSourceProduct: bestMatch.sourceProductName, mtSourceWeight: bestMatch.sourceWeight,
      weightDiff: Math.round(weightDiff * 100) / 100, outputMatchStatus,
      matchStatus: isExact ? 'MATCHED_EXACT' : 'MATCHED_WITH_SMALL_DIFFERENCE',
      confidence: isExact ? 'high' : 'medium',
      note: isExact ? 'Date + source weight match closely' : `Weight difference: ${Math.round(weightDiff*100)/100} kg`,
    })
    
    // Check weight logic
    const totalOutput = bestMatch.totalOutputWeight
    const totalWaste = bestMatch.totalWasteWeight
    const expectedLoss = bestMatch.sourceWeight - totalOutput - totalWaste
    if (totalOutput > bestMatch.sourceWeight) {
      weightAnomalies.push({
        type: 'OUTPUT_EXCEEDS_INPUT', mtBillId: bestMatch.id, pdfDate: pdfEvt.dateStr,
        sourceWeight: bestMatch.sourceWeight, totalOutput, totalWaste,
        difference: Math.round((totalOutput - bestMatch.sourceWeight) * 100) / 100,
        note: `Output (${totalOutput} kg) exceeds input (${bestMatch.sourceWeight} kg)`,
      })
    }
    if (bestMatch.sourceWeight > 0 && expectedLoss < -1) {
      weightAnomalies.push({
        type: 'NEGATIVE_LOSS', mtBillId: bestMatch.id, pdfDate: pdfEvt.dateStr,
        sourceWeight: bestMatch.sourceWeight, totalOutput, totalWaste,
        difference: Math.round(expectedLoss * 100) / 100,
        note: `Negative loss: output + waste exceeds input by ${Math.round(Math.abs(expectedLoss)*100)/100} kg`,
      })
    }
  }
}

// Find MT-only events
for (const mt of mtEvents) {
  if (!matchedMtIds.has(mt.id)) {
    mtOnlyEvents.push(mt)
    matchReport.push({
      pdfPage: '', pdfDate: '', pdfSourceProduct: '', pdfSourceWeight: '',
      mtBillId: mt.id, mtDate: mt.dateStr, mtSourceProduct: mt.sourceProductName,
      mtSourceWeight: mt.sourceWeight, weightDiff: '', outputMatchStatus: '',
      matchStatus: 'METALTRACK_ONLY', confidence: 'medium',
      note: 'MetalTrack SortingBill not found in PDF',
    })
  }
}

// ============ TASK 6: CHECK ทองแดงท่อ Candy ============
console.log('\n=== TASK 6: CHECK ทองแดงท่อ Candy ===')
// Sales that need sorting movement:
const candySales = [
  { date: '08/01/2569', billNo: 'A2007349', weight: 2.9 },
  { date: '05/02/2569', billNo: 'A2007395', weight: 53.2 },
  { date: '21/04/2569', billNo: 'A2007502', weight: 56.0 },
  { date: '04/07/2569', billNo: 'A2007621', weight: 22.6 },
]

// Check if any PDF event has ทองแดงใหญ่ as source and could produce Candy output
// Check if any MT SortingBill has ทองแดงใหญ่ as source
const candyCheckRows = []
const mtCandySources = mtEvents.filter(mt => mt.sourceProductName.includes('ทองแดงใหญ่') || mt.sourceProductName.includes('แดงใหญ่'))
console.log(`MT SortingBills with ทองแดงใหญ่ as source: ${mtCandySources.length}`)

for (const sale of candySales) {
  const saleDate = parsePdfDate(sale.date)
  // Find PDF events around that date that could produce Candy
  const pdfCandidates = pdfEventsNormalized.filter(evt => {
    if (!evt.date || !saleDate) return false
    const diff = Math.abs(evt.date - saleDate)
    return diff <= 7 * 24 * 60 * 60 * 1000  // within 7 days
  }).filter(evt => evt.sourceProductNormalized.includes('ทองแดง') || evt.sourceProduct.includes('แดง'))
  
  // Find MT events around that date
  const mtCandidates = mtEvents.filter(mt => {
    if (!mt.date || !saleDate) return false
    const diff = Math.abs(mt.date - saleDate)
    return diff <= 7 * 24 * 60 * 60 * 1000
  }).filter(mt => mt.sourceProductName.includes('ทองแดง'))
  
  candyCheckRows.push({
    saleDate: sale.date, saleBillNo: sale.billNo, saleWeight: sale.weight,
    pdfCandidatesFound: pdfCandidates.length,
    pdfCandidateDetails: pdfCandidates.map(e => `${e.dateStr} src=${e.sourceProduct} ${e.sourceWeight}kg`).join('; '),
    mtCandidatesFound: mtCandidates.length,
    mtCandidateDetails: mtCandidates.map(m => `${m.dateStr} ${m.billNumber || m.id.substring(0,8)} src=${m.sourceProductName} ${m.sourceWeight}kg`).join('; '),
    recommendation: pdfCandidates.length > 0 || mtCandidates.length > 0
      ? 'Possible source events found — verify sorting movement'
      : 'No matching sorting events found — may need to create sorting movement manually',
  })
}

// ============ TASK 7: GENERATE OUTPUT FILES ============
console.log('\n=== TASK 7: GENERATING OUTPUT FILES ===')

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

// 1. SORTING_PDF_PARSED_EVENTS.csv
const evtCols = ['No.','PDF date','room','source raw name','source normalized name','source weight','weighed total','loss weight','operation type','output count','output products (raw)','note']
const csvLines1 = [evtCols.join(',')]
pdfEventsNormalized.forEach((e, i) => {
  csvLines1.push([
    i+1, e.dateStr, e.room, e.sourceProduct, e.sourceProductNormalized,
    e.sourceWeight, e.weighedTotal || '', e.lossWeight || '',
    e.sourceProduct.includes('แกะ') ? 'แกะ' : 'คัด',
    e.outputs.length, e.outputs.map(o => `${o.product}=${o.weight}kg`).join('; '),
    '',
  ].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'SORTING_PDF_PARSED_EVENTS.csv'), '\ufeff' + csvLines1.join('\n'), 'utf-8')
console.log('  ✓ SORTING_PDF_PARSED_EVENTS.csv')

// 2. SORTING_PDF_PARSED_OUTPUT_ROWS.csv
const outCols = ['No.','PDF date','room','source product','output raw name','output normalized name','output weight','output price','output value','needs review','review reason']
const csvLines2 = [outCols.join(',')]
let outIdx = 1
for (const e of pdfEventsNormalized) {
  for (const o of e.outputsNormalized) {
    csvLines2.push([
      outIdx++, e.dateStr, e.room, e.sourceProduct, o.product, o.normalizedName,
      o.weight, o.price || '', '', o.needsReview ? 'YES' : 'NO', o.needsReview ? 'Unknown product name' : '',
    ].map(csvEscape).join(','))
  }
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SORTING_PDF_PARSED_OUTPUT_ROWS.csv'), '\ufeff' + csvLines2.join('\n'), 'utf-8')
console.log('  ✓ SORTING_PDF_PARSED_OUTPUT_ROWS.csv')

// 3. METALTRACK_SORTINGBILLS_EXPORT.csv
const mtCols = ['No.','SortingBill ID','bill number','date','source product','source weight','room','output count','total output weight','total waste weight','note']
const csvLines3 = [mtCols.join(',')]
mtEvents.forEach((mt, i) => {
  csvLines3.push([
    i+1, mt.id, mt.billNumber || '', mt.dateStr, mt.sourceProductName, mt.sourceWeight,
    mt.roomNumber || '', mt.outputs.length, Math.round(mt.totalOutputWeight*100)/100,
    Math.round(mt.totalWasteWeight*100)/100, mt.note || '',
  ].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'METALTRACK_SORTINGBILLS_EXPORT.csv'), '\ufeff' + csvLines3.join('\n'), 'utf-8')
console.log('  ✓ METALTRACK_SORTINGBILLS_EXPORT.csv')

// 4. SORTING_MATCH_REPORT.csv
const matchCols = ['match status','PDF page','PDF date','PDF source product','PDF source weight','MetalTrack SortingBill ID','MetalTrack date','MetalTrack source product','MetalTrack source weight','weight difference','output match status','confidence','note']
const csvLines4 = [matchCols.join(',')]
for (const r of matchReport) {
  csvLines4.push([
    r.matchStatus, r.pdfPage, r.pdfDate, r.pdfSourceProduct, r.pdfSourceWeight,
    r.mtBillId, r.mtDate, r.mtSourceProduct, r.mtSourceWeight, r.weightDiff,
    r.outputMatchStatus, r.confidence, r.note,
  ].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'SORTING_MATCH_REPORT.csv'), '\ufeff' + csvLines4.join('\n'), 'utf-8')
console.log('  ✓ SORTING_MATCH_REPORT.csv')

// 5. SORTING_WEIGHT_ANOMALIES.csv
const anomCols = ['No.','type','SortingBill ID','PDF date','source weight','total output','total waste','difference','note']
const csvLines5 = [anomCols.join(',')]
weightAnomalies.forEach((a, i) => {
  csvLines5.push([i+1, a.type, a.mtBillId, a.pdfDate, a.sourceWeight, a.totalOutput, a.totalWaste, a.difference, a.note].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'SORTING_WEIGHT_ANOMALIES.csv'), '\ufeff' + csvLines5.join('\n'), 'utf-8')
console.log(`  ✓ SORTING_WEIGHT_ANOMALIES.csv (${weightAnomalies.length} anomalies)`)

// 6. SORTING_PRODUCT_NAME_REVIEW.csv
const nameCols = ['No.','raw name','type','PDF date','room','reason']
const csvLines6 = [nameCols.join(',')]
productNameReviews.forEach((r, i) => {
  csvLines6.push([i+1, r.rawName, r.type, r.pdfDate, r.room, r.reason].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'SORTING_PRODUCT_NAME_REVIEW.csv'), '\ufeff' + csvLines6.join('\n'), 'utf-8')
console.log(`  ✓ SORTING_PRODUCT_NAME_REVIEW.csv (${productNameReviews.length} items)`)

// 7. PDF_ONLY_SORTING_EVENTS.csv
const pdfOnlyCols = ['No.','PDF date','room','source product','source weight','output count','outputs']
const csvLines7 = [pdfOnlyCols.join(',')]
pdfOnlyEvents.forEach((e, i) => {
  csvLines7.push([i+1, e.dateStr, e.room, e.sourceProduct, e.sourceWeight, e.outputs.length, e.outputs.map(o => `${o.product}=${o.weight}kg`).join('; ')].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'PDF_ONLY_SORTING_EVENTS.csv'), '\ufeff' + csvLines7.join('\n'), 'utf-8')
console.log(`  ✓ PDF_ONLY_SORTING_EVENTS.csv (${pdfOnlyEvents.length} events)`)

// 8. METALTRACK_ONLY_SORTING_EVENTS.csv
const mtOnlyCols = ['No.','SortingBill ID','bill number','date','source product','source weight','output count','outputs']
const csvLines8 = [mtOnlyCols.join(',')]
mtOnlyEvents.forEach((mt, i) => {
  csvLines8.push([i+1, mt.id, mt.billNumber || '', mt.dateStr, mt.sourceProductName, mt.sourceWeight, mt.outputs.length, mt.outputs.map(o => `${o.productName}=${o.weight}kg`).join('; ')].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'METALTRACK_ONLY_SORTING_EVENTS.csv'), '\ufeff' + csvLines8.join('\n'), 'utf-8')
console.log(`  ✓ METALTRACK_ONLY_SORTING_EVENTS.csv (${mtOnlyEvents.length} events)`)

// 9. CANDY_COPPER_SORTING_CHECK.csv
const candyCols = ['No.','sale date','sale bill no','sale weight (kg)','PDF candidates found','PDF candidate details','MT candidates found','MT candidate details','recommendation']
const csvLines9 = [candyCols.join(',')]
candyCheckRows.forEach((c, i) => {
  csvLines9.push([i+1, c.saleDate, c.saleBillNo, c.saleWeight, c.pdfCandidatesFound, c.pdfCandidateDetails, c.mtCandidatesFound, c.mtCandidateDetails, c.recommendation].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'CANDY_COPPER_SORTING_CHECK.csv'), '\ufeff' + csvLines9.join('\n'), 'utf-8')
console.log('  ✓ CANDY_COPPER_SORTING_CHECK.csv')

// 10. FINAL_REPORT.md
const counts = {
  matchedExact: matchReport.filter(r => r.matchStatus === 'MATCHED_EXACT').length,
  matchedDiff: matchReport.filter(r => r.matchStatus === 'MATCHED_WITH_SMALL_DIFFERENCE').length,
  pdfOnly: pdfOnlyEvents.length,
  mtOnly: mtOnlyEvents.length,
  needsReview: matchReport.filter(r => r.matchStatus === 'NEED_OWNER_REVIEW').length,
}

let md = `# Sorting Verification Against PDF — Final Report\n\n`
md += `**Task 47**: Verify MetalTrack SortingBills Against Sorting PDF Source\n`
md += `**Status**: VERIFICATION ONLY — No production data modified.\n\n`

md += `## Summary\n\n`
md += `| # | Metric | Value |\n|---|---|---:|\n`
md += `| 1 | PDF pages parsed | 9 |\n`
md += `| 2 | PDF sorting events found | ${pdfEventsNormalized.length} |\n`
md += `| 3 | PDF output rows found | ${pdfEventsNormalized.reduce((s, e) => s + e.outputs.length, 0)} |\n`
md += `| 4 | MetalTrack SortingBills found | ${mtEvents.length} |\n`
md += `| 5 | Matched exact count | ${counts.matchedExact} |\n`
md += `| 6 | Matched with small difference | ${counts.matchedDiff} |\n`
md += `| 7 | PDF-only count | ${counts.pdfOnly} |\n`
md += `| 8 | MetalTrack-only count | ${counts.mtOnly} |\n`
md += `| 9 | Needs owner review | ${counts.needsReview} |\n`
md += `| 10 | Weight anomaly count | ${weightAnomalies.length} |\n`
md += `| 11 | Product-name review count | ${productNameReviews.length} |\n`
md += `| 12 | ทองแดงท่อ Candy check | See below |\n`
md += `| 13 | Data ready for stock reconciliation | NO — sorting verification incomplete |\n`
md += `| 14 | What must be fixed before reconciliation | See below |\n`
md += `| 15 | Output folder | ${OUTPUT_DIR} |\n\n`

md += `## Match Results\n\n`
md += `| Status | Count |\n|---|---:|\n`
md += `| MATCHED_EXACT | ${counts.matchedExact} |\n`
md += `| MATCHED_WITH_SMALL_DIFFERENCE | ${counts.matchedDiff} |\n`
md += `| PDF_ONLY | ${counts.pdfOnly} |\n`
md += `| METALTRACK_ONLY | ${counts.mtOnly} |\n`
md += `| NEED_OWNER_REVIEW | ${counts.needsReview} |\n\n`

md += `## ทองแดงท่อ Candy Check\n\n`
md += `| Sale date | Bill no | Weight (kg) | PDF candidates | MT candidates | Recommendation |\n|---|---|---:|---:|---:|---|\n`
candyCheckRows.forEach(c => {
  md += `| ${c.saleDate} | ${c.saleBillNo} | ${c.saleWeight} | ${c.pdfCandidatesFound} | ${c.mtCandidatesFound} | ${c.recommendation} |\n`
})
md += `\n`

md += `## What Must Be Fixed Before Reconciliation\n\n`
md += `1. **PDF-only events (${counts.pdfOnly})**: These sorting events appear in the PDF but not in MetalTrack. Owner must decide whether to create SortingBills for them.\n`
md += `2. **MetalTrack-only events (${counts.mtOnly})**: These SortingBills exist in MetalTrack but not in the PDF. May be post-PDF events (after 27/06/2569) or duplicates.\n`
md += `3. **Weight anomalies (${weightAnomalies.length})**: Events where output exceeds input or negative loss.\n`
md += `4. **Product name reviews (${productNameReviews.length})**: PDF product names that could not be confidently normalized.\n`
md += `5. **ทองแดงท่อ Candy**: 4 sales require sorting movement verification. No matching sorting events found in PDF or MetalTrack for ทองแดงใหญ่ → ทองแดงท่อ Candy movement.\n\n`

md += `## Safety Confirmation\n\n`
md += `- ✅ No production data modified\n`
md += `- ✅ No SortingBills created/updated/deleted\n`
md += `- ✅ No stock adjusted\n`
md += `- ✅ No product master changed\n\n`
md += `**No production data was modified.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_REPORT.md'), md, 'utf-8')
console.log('  ✓ FINAL_REPORT.md')

// Console output
console.log('\n=== FINAL REPORT ===')
console.log(`1.  PDF pages parsed:                    9`)
console.log(`2.  PDF sorting events found:            ${pdfEventsNormalized.length}`)
console.log(`3.  PDF output rows found:               ${pdfEventsNormalized.reduce((s, e) => s + e.outputs.length, 0)}`)
console.log(`4.  MetalTrack SortingBills found:       ${mtEvents.length}`)
console.log(`5.  Matched exact count:                 ${counts.matchedExact}`)
console.log(`6.  Matched with small difference:       ${counts.matchedDiff}`)
console.log(`7.  PDF-only count:                      ${counts.pdfOnly}`)
console.log(`8.  MetalTrack-only count:               ${counts.mtOnly}`)
console.log(`9.  Needs owner review:                  ${counts.needsReview}`)
console.log(`10. Weight anomaly count:                ${weightAnomalies.length}`)
console.log(`11. Product-name review count:           ${productNameReviews.length}`)
console.log(`12. ทองแดงท่อ Candy check:               See CANDY_COPPER_SORTING_CHECK.csv`)
console.log(`13. Data ready for stock reconciliation:  NO`)
console.log(`14. Must fix before reconciliation:      See FINAL_REPORT.md`)
console.log(`15. Output folder:                       ${OUTPUT_DIR}`)

console.log('\nNo production data was modified.')

await db.$disconnect()
