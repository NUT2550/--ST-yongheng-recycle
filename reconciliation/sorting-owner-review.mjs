/**
 * Task 48: Create Owner Review Lists From Sorting Verification Task 47
 * REVIEW / REPORT ONLY — no production modifications.
 */
import fs from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const SRC_DIR = '/home/z/my-project/reconciliation/sorting-verification-against-pdf'
const OUTPUT_DIR = '/home/z/my-project/reconciliation/sorting-owner-review-after-task47'
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true })

function csvEscape(v) {
  if (v == null) return ''
  const s = String(v)
  if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"'
  return s
}

function loadCsv(filepath) {
  const content = fs.readFileSync(filepath, 'utf-8').replace(/^\ufeff/, '')
  const lines = content.split('\n').filter(l => l.length > 0)
  if (lines.length < 2) return { headers: [], rows: [] }
  const parseLine = (line) => {
    const result = []; let inQuote = false, current = ''
    for (let i = 0; i < line.length; i++) {
      const c = line[i]
      if (c === '"') { if (inQuote && line[i+1] === '"') { current += '"'; i++ } else inQuote = !inQuote }
      else if (c === ',' && !inQuote) { result.push(current); current = '' }
      else current += c
    }
    result.push(current); return result
  }
  const headers = parseLine(lines[0])
  return { headers, rows: lines.slice(1).map(parseLine).map(r => { const obj = {}; headers.forEach((h, i) => obj[h] = r[i] || ''); return obj }) }
}

// ============ TASK 1: PDF-ONLY 15 EVENTS ============
console.log('=== TASK 1: PDF-ONLY 15 EVENTS ===')
const pdfOnly = loadCsv(path.join(SRC_DIR, 'PDF_ONLY_SORTING_EVENTS.csv'))
console.log(`PDF-only events: ${pdfOnly.rows.length}`)

const pdfOnlyCols = ['No.','PDF page','PDF date','room/location','operation type','input product raw name','input product normalized name','input weight','total output weight','difference / loss','output products summary','confidence','likely reason not in MetalTrack','owner decision','note']
const pdfOnlyCsv = [pdfOnlyCols.join(',')]
const pdfOnlyMd = [`# PDF-Only 15 Events — Owner Review\n\n`]
pdfOnlyMd.push(`| No. | PDF date | Room | Input product | Input weight (kg) | Output summary | Confidence | Likely reason | Owner decision |\n`)
pdfOnlyMd.push(`|---|---|---|---|---:|---|---|---|---|\n`)

pdfOnly.rows.forEach((r, i) => {
  const outputs = r['outputs'] || ''
  const outputSum = outputs.substring(0, 80)
  pdfOnlyCsv.push([
    i+1, '', r['PDF date'], r['room'], r['source product'].includes('แกะ') ? 'แกะ' : 'คัด',
    r['source product'], '', r['source weight'], '', '',
    outputSum, 'medium', 'Not found in MetalTrack on same date', '', '',
  ].map(csvEscape).join(','))
  pdfOnlyMd.push(`| ${i+1} | ${r['PDF date']} | ${r['room']} | ${r['source product']} | ${r['source weight']} | ${outputSum} | medium | Not in MT on same date | |\n`)
})

fs.writeFileSync(path.join(OUTPUT_DIR, 'PDF_ONLY_15_OWNER_REVIEW.csv'), '\ufeff' + pdfOnlyCsv.join('\n'), 'utf-8')
fs.writeFileSync(path.join(OUTPUT_DIR, 'PDF_ONLY_15_OWNER_REVIEW.md'), pdfOnlyMd.join(''), 'utf-8')
console.log('  ✓ PDF_ONLY_15_OWNER_REVIEW.csv + .md')

// ============ TASK 2: METALTRACK-ONLY 81 EVENTS ============
console.log('\n=== TASK 2: METALTRACK-ONLY 81 EVENTS ===')
const mtOnly = loadCsv(path.join(SRC_DIR, 'METALTRACK_ONLY_SORTING_EVENTS.csv'))
console.log(`MetalTrack-only events: ${mtOnly.rows.length}`)

// Split by date: after 27/06/2569 (= 27/06/2026 CE) vs on/before
const cutoffDate = new Date(2026, 5, 27) // June 27, 2026 (month is 0-indexed)
const afterCut = []
const beforeCut = []

for (const r of mtOnly.rows) {
  // Parse date "DD/MM/YYYY" (Buddhist era)
  const dateStr = r['date']
  const m = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    let [, dd, mm, yy] = m
    let year = parseInt(yy)
    if (year > 2400) year -= 543
    const dt = new Date(year, parseInt(mm)-1, parseInt(dd))
    if (dt > cutoffDate) {
      afterCut.push(r)
    } else {
      beforeCut.push(r)
    }
  } else {
    beforeCut.push(r) // unparseable date → needs review
  }
}

console.log(`After 27/06/2569: ${afterCut.length}`)
console.log(`On/before 27/06/2569: ${beforeCut.length}`)

const mtCols = ['No.','SortingBill ID','date','source/input product','source/input weight','total output weight','difference / loss','output products summary','created at','updated at','note','classification','owner decision']

// After cutoff
const afterCsv = [mtCols.join(',')]
afterCut.forEach((r, i) => {
  afterCsv.push([i+1, r['SortingBill ID'], r['date'], r['source product'], r['source weight'], '', '', (r['outputs']||'').substring(0,80), '', '', '', 'likely OK / post-PDF', ''].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'METALTRACK_ONLY_AFTER_2026_06_27.csv'), '\ufeff' + afterCsv.join('\n'), 'utf-8')
console.log('  ✓ METALTRACK_ONLY_AFTER_2026_06_27.csv')

// Before/on cutoff
const beforeCsv = [mtCols.join(',')]
beforeCut.forEach((r, i) => {
  beforeCsv.push([i+1, r['SortingBill ID'], r['date'], r['source product'], r['source weight'], '', '', (r['outputs']||'').substring(0,80), '', '', '', 'needs owner review', ''].map(csvEscape).join(','))
})
fs.writeFileSync(path.join(OUTPUT_DIR, 'METALTRACK_ONLY_ON_OR_BEFORE_2026_06_27_NEEDS_REVIEW.csv'), '\ufeff' + beforeCsv.join('\n'), 'utf-8')
console.log('  ✓ METALTRACK_ONLY_ON_OR_BEFORE_2026_06_27_NEEDS_REVIEW.csv')

// Summary MD
let mtSummaryMd = `# MetalTrack-Only 81 Events — Summary\n\n`
mtSummaryMd += `| Metric | Count |\n|---|---:|\n`
mtSummaryMd += `| Total MetalTrack-only events | ${mtOnly.rows.length} |\n`
mtSummaryMd += `| After 27/06/2569 (likely OK / post-PDF) | ${afterCut.length} |\n`
mtSummaryMd += `| On/before 27/06/2569 (needs owner review) | ${beforeCut.length} |\n\n`

// Top dates by count
const dateCounts = {}
for (const r of mtOnly.rows) {
  dateCounts[r['date']] = (dateCounts[r['date']] || 0) + 1
}
const topDates = Object.entries(dateCounts).sort((a,b) => b[1]-a[1]).slice(0, 10)
mtSummaryMd += `## Top Dates by Count\n\n| Date | Count |\n|---|---:|\n`
for (const [d, c] of topDates) mtSummaryMd += `| ${d} | ${c} |\n`

// Top source products by count
const srcCounts = {}
for (const r of mtOnly.rows) {
  srcCounts[r['source product']] = (srcCounts[r['source product']] || 0) + 1
}
const topSrc = Object.entries(srcCounts).sort((a,b) => b[1]-a[1]).slice(0, 10)
mtSummaryMd += `\n## Top Source Products by Count\n\n| Product | Count |\n|---|---:|\n`
for (const [p, c] of topSrc) mtSummaryMd += `| ${p} | ${c} |\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'METALTRACK_ONLY_81_SUMMARY.md'), mtSummaryMd, 'utf-8')
console.log('  ✓ METALTRACK_ONLY_81_SUMMARY.md')

// ============ TASK 3: WEIGHT ANOMALY DETAIL ============
console.log('\n=== TASK 3: WEIGHT ANOMALY DETAIL (07/01/2569) ===')

// Find the MT SortingBill for this anomaly
const anomalyBill = await db.sortingBill.findUnique({
  where: { id: 'cmqoykaaz003vqjihzgx53tjf' },
  include: {
    sourceProduct: { select: { name: true } },
    items: { include: { product: { select: { name: true } } } },
  },
})

// Find the matching PDF event (07/01/2569)
const pdfEvents = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/sorting-pdf-parsed.json', 'utf8'))
const pdfMatch = pdfEvents.find(e => e.dateRaw === '7/1/26')

let anomalyMd = `# Weight Anomaly Detail — 07/01/2569\n\n`
anomalyMd += `**Status**: VERIFICATION ONLY — No production data modified.\n\n`
anomalyMd += `## Anomaly Summary\n\n`
anomalyMd += `| Field | Value |\n|---|---|\n`
anomalyMd += `| Date | 07/01/2569 |\n`
anomalyMd += `| MetalTrack SortingBill ID | cmqoykaaz003vqjihzgx53tjf |\n`
anomalyMd += `| Input weight | 34.2 kg |\n`
anomalyMd += `| Total output weight | 126.4 kg |\n`
anomalyMd += `| Difference | Output exceeds input by 92.2 kg |\n\n`

anomalyMd += `## PDF Evidence\n\n`
if (pdfMatch) {
  anomalyMd += `| Field | Value |\n|---|---|\n`
  anomalyMd += `| PDF date | ${pdfMatch.dateRaw} |\n`
  anomalyMd += `| Room | ${pdfMatch.room} |\n`
  anomalyMd += `| Source product | ${pdfMatch.sourceProduct} |\n`
  anomalyMd += `| Source weight | ${pdfMatch.sourceWeight} kg |\n`
  anomalyMd += `| Weighed total | ${pdfMatch.weighedTotal || 'N/A'} |\n\n`
  anomalyMd += `### PDF Output Products\n\n`
  anomalyMd += `| Product | Weight (kg) | Price |\n|---|---:|---:|\n`
  for (const o of pdfMatch.outputs) {
    anomalyMd += `| ${o.product} | ${o.weight} | ${o.price || ''} |\n`
  }
  const pdfOutputTotal = pdfMatch.outputs.reduce((s, o) => s + o.weight, 0)
  anomalyMd += `\n**PDF total output**: ${Math.round(pdfOutputTotal*100)/100} kg\n\n`
} else {
  anomalyMd += `PDF event not found for 7/1/26.\n\n`
}

anomalyMd += `## MetalTrack Evidence\n\n`
if (anomalyBill) {
  anomalyMd += `| Field | Value |\n|---|---|\n`
  anomalyMd += `| SortingBill ID | ${anomalyBill.id} |\n`
  anomalyMd += `| Bill number | ${anomalyBill.billNumber || 'N/A'} |\n`
  anomalyMd += `| Date | ${anomalyBill.date.toISOString().substring(0,10)} |\n`
  anomalyMd += `| Source product | ${anomalyBill.sourceProduct.name} |\n`
  anomalyMd += `| Source weight | ${anomalyBill.sourceWeight} kg |\n`
  anomalyMd += `| Room | ${anomalyBill.roomNumber || 'N/A'} |\n\n`
  anomalyMd += `### MetalTrack Output Products\n\n`
  anomalyMd += `| Product | Weight (kg) | Is Waste | Sorted Price/kg |\n|---|---:|---|---:|\n`
  let mtOutputTotal = 0
  for (const it of anomalyBill.items) {
    anomalyMd += `| ${it.product.name} | ${it.weight} | ${it.isWaste ? 'YES' : 'NO'} | ${it.sortedPricePerKg || ''} |\n`
    if (!it.isWaste) mtOutputTotal += it.weight
  }
  anomalyMd += `\n**MT total output (non-waste)**: ${Math.round(mtOutputTotal*100)/100} kg\n\n`
}

anomalyMd += `## Possible Causes\n\n`
anomalyMd += `1. **PDF parsing grouped rows incorrectly**: The PDF parser may have merged outputs from multiple sorting events into one event header.\n`
anomalyMd += `2. **MetalTrack data entered incorrectly**: Source weight may have been entered as 34.2 kg when it should be higher (e.g., 126.4+ kg).\n`
anomalyMd += `3. **Source input weight incomplete**: The PDF shows source as "หนาสัน" (เหล็กหนาสั้น) 34.2 kg, but the outputs include ฉาก 34.2 kg + มอเตอร์ 105 kg + others — the 105 kg มอเตอร์ output likely comes from a different source product.\n\n`
anomalyMd += `## Recommended Owner Action\n\n`
anomalyMd += `- **Do NOT auto-fix**\n`
anomalyMd += `- Review the original PDF page for 07/01/2569 to verify whether outputs belong to one event or multiple events\n`
anomalyMd += `- If MT SortingBill source weight is wrong, correct it in MetalTrack\n`
anomalyMd += `- If outputs were incorrectly grouped, split the SortingBill into separate events\n`
anomalyMd += `- If PDF parsing error, ignore the PDF anomaly and verify MT data is correct\n\n`
anomalyMd += `**No production data was modified.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'WEIGHT_ANOMALY_07012569_DETAIL.md'), anomalyMd, 'utf-8')

// CSV version
const anomalyCsvCols = ['field','PDF value','MetalTrack value','note']
const anomalyCsv = [anomalyCsvCols.join(',')]
if (pdfMatch) {
  anomalyCsv.push(['date', pdfMatch.dateRaw, anomalyBill?.date.toISOString().substring(0,10) || '', ''].map(csvEscape).join(','))
  anomalyCsv.push(['room', pdfMatch.room, anomalyBill?.roomNumber || '', ''].map(csvEscape).join(','))
  anomalyCsv.push(['source product', pdfMatch.sourceProduct, anomalyBill?.sourceProduct.name || '', ''].map(csvEscape).join(','))
  anomalyCsv.push(['source weight', pdfMatch.sourceWeight, anomalyBill?.sourceWeight || '', ''].map(csvEscape).join(','))
  const pdfOut = pdfMatch.outputs.map(o => `${o.product}=${o.weight}kg`).join('; ')
  const mtOut = anomalyBill?.items.map(it => `${it.product.name}=${it.weight}kg${it.isWaste?'(waste)':''}`).join('; ') || ''
  anomalyCsv.push(['outputs', pdfOut, mtOut, ''].map(csvEscape).join(','))
  const pdfTot = pdfMatch.outputs.reduce((s,o) => s+o.weight, 0)
  const mtTot = anomalyBill?.items.filter(it => !it.isWaste).reduce((s,it) => s+it.weight, 0) || 0
  anomalyCsv.push(['total output', Math.round(pdfTot*100)/100, Math.round(mtTot*100)/100, `Difference: ${Math.round((mtTot - pdfMatch.sourceWeight)*100)/100} kg`].map(csvEscape).join(','))
}
fs.writeFileSync(path.join(OUTPUT_DIR, 'WEIGHT_ANOMALY_07012569_DETAIL.csv'), '\ufeff' + anomalyCsv.join('\n'), 'utf-8')
console.log('  ✓ WEIGHT_ANOMALY_07012569_DETAIL.csv + .md')

// ============ TASK 4: UNIQUE PRODUCT NAME REVIEW ============
console.log('\n=== TASK 4: UNIQUE PRODUCT NAME REVIEW ===')
const nameReview = loadCsv(path.join(SRC_DIR, 'SORTING_PRODUCT_NAME_REVIEW.csv'))
console.log(`Total name review rows: ${nameReview.rows.length}`)

// Aggregate by raw name
const nameAgg = new Map()
for (const r of nameReview.rows) {
  const raw = r['raw name']
  if (!nameAgg.has(raw)) nameAgg.set(raw, { raw, count: 0, dates: [], type: r['type'] })
  const agg = nameAgg.get(raw)
  agg.count++
  if (agg.dates.length < 3) agg.dates.push(r['PDF date'])
}

// Suggested normalizations for common OCR variants
const suggestedMap = {
  'หนาสัั น': 'เหล็กหนาสั้น',
  'ตะกั ั วแข็ง': 'ตะกั่วแข็ง',
  'ตะกั วแข็ง': 'ตะกั่วแข็ง',
  'เนีียมบาง': 'อลูมิเนียมบาง',
  'เนีียมแข็ง': 'อลูมิเนียมแข็ง',
  'เนียมแข็็ง': 'อลูมิเนียมแข็ง',
  'แดงเล็ก ': 'ทองแดงเล็ก',
  'แดงเล๋ก': 'ทองแดงเล็ก',
  'แดงใหญ่ ': 'ทองแดงใหญ่',
  'หม้อ/แดง': 'หม้อน้ำทองแดง',
  'หม้อ/เนียม': 'หม้อน้ำอลูมิเนียม',
  'หม้อ/นํ า': 'หม้อน้ำอลูมิเนียม',
  'หม้อนํ าเนียม': 'หม้อน้ำอลูมิเนียม',
  'ครีบหมอนํ า': 'อลูมิเนียมครีบหม้อน้ำ',
  'เนื อแดง': 'ทองเหลืองเนื้อแดง',
  'เนือแดง': 'ทองเหลืองเนื้อแดง',
  'เนียมเครื อง': 'อลูมิเนียมเครื่อง',
  'เนียมเครือง': 'อลูมิเนียมเครื่อง',
  'นํ ามันเครื อง': 'น้ำมันเครื่อง',
  'คอมดํ า': 'คอมดำ',
  'ตูดกระทะ': 'อลูมิเนียมตูดกะทะ',
  'เบรคเก้อ': 'เบรกเกอร์',
  'สายไฟเผา': 'สายไฟไม่ปอก',
  'สายไฟไม่ปอก(เผา)': 'สายไฟไม่ปอก',
  'เปลือก(ขายไม่ได้)': 'เปลือกสายไฟ',
  'เปลือกขายได้': 'เปลือกสายไฟ',
  'ดายแดงเผา': 'ทองแดงชุบ',
  'กะละลัง': 'กระสอบขาด',
  'เรียมสายไฟ': 'สายไฟอลูมิเนียม',
  '304สัน': 'สแตนเลส 304',
  'ชุดสวิทช์': 'เบรกเกอร์',
  '1.4': '(parse error — weight, not product)',
  '10.2': '(parse error — weight, not product)',
  '14.2': '(parse error — weight, not product)',
  '17': '(parse error — weight, not product)',
  '37': '(parse error — weight, not product)',
  '4.9': '(parse error — weight, not product)',
}

const nameCols = ['No.','raw PDF product name','normalized cleaned name','occurrence count','example dates','suggested MetalTrack product name','confidence','needs owner review','note']
const nameCsv = [nameCols.join(',')]
let nameMd = `# Unique Product Name Review\n\n`
nameMd += `**Total unique raw names**: ${nameAgg.size}\n\n`
nameMd += `| No. | Raw PDF name | Occurrences | Suggested MT name | Confidence | Needs review |\n|---|---|---:|---|---|---|\n`

let nameIdx = 1
for (const agg of [...nameAgg.values()].sort((a,b) => b.count - a.count)) {
  const suggested = suggestedMap[agg.raw] || '(unknown — needs owner review)'
  const isParseError = suggested.includes('parse error')
  const confidence = isParseError ? 'high' : (suggested !== '(unknown — needs owner review)' ? 'medium' : 'low')
  const needsReview = suggested === '(unknown — needs owner review)' ? 'YES' : 'NO'
  nameCsv.push([nameIdx, agg.raw, suggested.includes('parse error') ? '' : suggested, agg.count, agg.dates.join(', '), suggested, confidence, needsReview, isParseError ? 'Parse error: appears to be a weight value' : ''].map(csvEscape).join(','))
  nameMd += `| ${nameIdx} | ${agg.raw} | ${agg.count} | ${suggested} | ${confidence} | ${needsReview} |\n`
  nameIdx++
}

fs.writeFileSync(path.join(OUTPUT_DIR, 'UNIQUE_PRODUCT_NAME_REVIEW.csv'), '\ufeff' + nameCsv.join('\n'), 'utf-8')
nameMd += `\n**No production data was modified.**\n`
fs.writeFileSync(path.join(OUTPUT_DIR, 'UNIQUE_PRODUCT_NAME_REVIEW.md'), nameMd, 'utf-8')
console.log(`  ✓ UNIQUE_PRODUCT_NAME_REVIEW.csv + .md (${nameAgg.size} unique names)`)

// ============ TASK 5: CANDY COPPER CURRENT-SCOPE CHECK ============
console.log('\n=== TASK 5: CANDY COPPER CURRENT-SCOPE CHECK ===')

const candySales = [
  { date: '08/01/2569', billNo: 'A2007349', weight: 2.9, amount: 1065 },
  { date: '05/02/2569', billNo: 'A2007395', weight: 53.2, amount: 19504 },
  { date: '21/04/2569', billNo: 'A2007502', weight: 56.0, amount: 21615 },
  { date: '04/07/2569', billNo: 'A2007621', weight: 22.6, amount: 9446 },
]

const restartDate = new Date(2026, 6, 4) // 04/07/2026 CE

const candyCols = ['No.','sale date','bill number','weight (kg)','amount (THB)','before/after restart','matching sorting movement exists','recommendation']
const candyCsv = [candyCols.join(',')]
let candyMd = `# Candy Copper Current-Scope Review\n\n`
candyMd += `**Copper/brass restart date**: 04/07/2569\n\n`
candyMd += `| No. | Sale date | Bill no | Weight (kg) | Amount (THB) | Scope | Sorting movement exists | Recommendation |\n|---|---|---|---:|---:|---|---|---|\n`

candySales.forEach((s, i) => {
  const m = s.date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  let year = parseInt(m[3]); if (year > 2400) year -= 543
  const dt = new Date(year, parseInt(m[2])-1, parseInt(m[1]))
  const isAfter = dt >= restartDate
  const scope = isAfter ? 'CURRENT SCOPE' : 'old history (ignore)'
  const hasMovement = false // No matching sorting events found in Task 47
  let recommendation
  if (isAfter) {
    recommendation = 'Need owner decision whether to create sorting movement from ทองแดงใหญ่ to ทองแดงท่อ Candy for 22.6 kg on 04/07/2569, or exclude because copper/brass physical count adjustment will override.'
  } else {
    recommendation = 'Ignored — before copper/brass restart date (04/07/2569). Old history does not affect current stock reconciliation.'
  }
  candyCsv.push([i+1, s.date, s.billNo, s.weight, s.amount, scope, hasMovement ? 'NO' : 'NO', recommendation].map(csvEscape).join(','))
  candyMd += `| ${i+1} | ${s.date} | ${s.billNo} | ${s.weight} | ${s.amount} | ${scope} | NO | ${isAfter ? '⚠️ ' : ''}${recommendation.substring(0, 80)} |\n`
})

candyMd += `\n## Summary\n\n`
candyMd += `- **4 total Candy copper sales** in source data\n`
candyMd += `- **3 ignored** (before 04/07/2569 — old history)\n`
candyMd += `- **1 current-scope** (04/07/2569, 22.6 kg, 9,446 THB) — needs owner decision\n\n`
candyMd += `## Recommendation for 04/07/2569 22.6 kg\n\n`
candyMd += `Need owner decision whether to:\n`
candyMd += `1. Create sorting movement from ทองแดงใหญ่ to ทองแดงท่อ Candy for 22.6 kg on 04/07/2569, OR\n`
candyMd += `2. Exclude because copper/brass physical count adjustment will override\n\n`
candyMd += `**No production data was modified.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'CANDY_COPPER_CURRENT_SCOPE_REVIEW.csv'), '\ufeff' + candyCsv.join('\n'), 'utf-8')
fs.writeFileSync(path.join(OUTPUT_DIR, 'CANDY_COPPER_CURRENT_SCOPE_REVIEW.md'), candyMd, 'utf-8')
console.log('  ✓ CANDY_COPPER_CURRENT_SCOPE_REVIEW.csv + .md')

// ============ TASK 6: FINAL OWNER REVIEW INDEX ============
console.log('\n=== TASK 6: FINAL OWNER REVIEW INDEX ===')
let indexMd = `# Sorting Owner Review Pack — Index\n\n`
indexMd += `**Task 48**: Create Owner Review Lists From Sorting Verification Task 47\n`
indexMd += `**Status**: REVIEW / REPORT ONLY — No production data modified.\n\n`
indexMd += `## Files in This Pack\n\n`
indexMd += `| # | File | Description | Items |\n|---|---|---|---:|\n`
indexMd += `| 1 | PDF_ONLY_15_OWNER_REVIEW.csv + .md | PDF events not in MetalTrack | ${pdfOnly.rows.length} |\n`
indexMd += `| 2 | METALTRACK_ONLY_AFTER_2026_06_27.csv | MT events after 27/06/2569 (likely OK) | ${afterCut.length} |\n`
indexMd += `| 3 | METALTRACK_ONLY_ON_OR_BEFORE_2026_06_27_NEEDS_REVIEW.csv | MT events on/before 27/06/2569 | ${beforeCut.length} |\n`
indexMd += `| 4 | METALTRACK_ONLY_81_SUMMARY.md | Summary of all 81 MT-only events | — |\n`
indexMd += `| 5 | WEIGHT_ANOMALY_07012569_DETAIL.csv + .md | Weight anomaly: 34.2→126.4 kg | 1 |\n`
indexMd += `| 6 | UNIQUE_PRODUCT_NAME_REVIEW.csv + .md | Unique OCR product names | ${nameAgg.size} |\n`
indexMd += `| 7 | CANDY_COPPER_CURRENT_SCOPE_REVIEW.csv + .md | Candy copper scope check | 4 (1 current) |\n\n`

indexMd += `## Recommended Owner Review Order\n\n`
indexMd += `1. **PDF-only 15 events** — decide: create in MetalTrack / ignore / PDF parse error\n`
indexMd += `2. **MetalTrack-only on/before 27/06/2569** (${beforeCut.length} events) — decide: keep / delete / merge / correct\n`
indexMd += `3. **07/01/2569 weight anomaly** — review original PDF, decide if MT data is wrong or PDF parsing grouped rows incorrectly\n`
indexMd += `4. **Candy copper current-scope** (04/07/2569, 22.6 kg) — decide: create sorting movement / exclude\n`
indexMd += `5. **Unique product-name review** (${nameAgg.size} names) — confirm suggested normalizations\n\n`

indexMd += `## Summary Counts\n\n`
indexMd += `| Metric | Count |\n|---|---:|\n`
indexMd += `| PDF-only events | ${pdfOnly.rows.length} |\n`
indexMd += `| MetalTrack-only total | ${mtOnly.rows.length} |\n`
indexMd += `| MetalTrack-only after 27/06/2569 | ${afterCut.length} |\n`
indexMd += `| MetalTrack-only on/before 27/06/2569 | ${beforeCut.length} |\n`
indexMd += `| Real weight anomalies | 1 |\n`
indexMd += `| Unique product names needing review | ${nameAgg.size} |\n`
indexMd += `| Candy copper current-scope rows | 1 (of 4 total) |\n\n`
indexMd += `**No production data was modified.**\n`

fs.writeFileSync(path.join(OUTPUT_DIR, 'FINAL_OWNER_REVIEW_INDEX.md'), indexMd, 'utf-8')
console.log('  ✓ FINAL_OWNER_REVIEW_INDEX.md')

// ============ FINAL CONSOLE OUTPUT ============
console.log('\n=== FINAL REPORT ===')
console.log(`1. PDF-only event count:                    ${pdfOnly.rows.length}`)
console.log(`2. MetalTrack-only total count:             ${mtOnly.rows.length}`)
console.log(`3. MetalTrack-only after 27/06/2569:        ${afterCut.length}`)
console.log(`4. MetalTrack-only on/before 27/06/2569:    ${beforeCut.length}`)
console.log(`5. Real weight anomaly count:               1`)
console.log(`6. Unique product names needing review:     ${nameAgg.size}`)
console.log(`7. Candy copper current-scope rows:         1 (of 4 total)`)
console.log(`8. Files created:                           12`)
console.log(`9. Output folder:                           ${OUTPUT_DIR}`)
console.log(`10. Recommended owner review order:`)
console.log(`    1. PDF-only 15 events`)
console.log(`    2. MetalTrack-only on/before 27/06/2569 (${beforeCut.length} events)`)
console.log(`    3. 07/01/2569 weight anomaly`)
console.log(`    4. Candy copper current-scope 04/07/2569 22.6 kg`)
console.log(`    5. Unique product-name review (${nameAgg.size} names)`)
console.log(`\nNo production data was modified.`)

await db.$disconnect()
