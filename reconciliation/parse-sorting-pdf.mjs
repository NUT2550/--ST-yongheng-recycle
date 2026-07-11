/**
 * Parse sorting PDF -> extract sorting transactions
 * Source: upload/สต๊อกทั้งหมด_คัดแยก_เสียหาย_Google_ชีต.pdf
 *
 * Structure per sorting bill:
 *   HEADER row:  date | room | source-product | source-weight | weighed-total | diff | source-price | source-cost | FIRST-output | weight | price | src-price | diff | amount | bonus | overall | worker | overall-total
 *   CONTINUATION: 0 | 0 | output-product | weight | price | src-price | diff | amount | bonus
 *
 * Date format: dd/mm/yy (CE year 26 = 2026)
 */
import fs from 'fs'

const RAW = fs.readFileSync('/home/z/my-project/reconciliation/sorting-pdf-raw.txt', 'utf8')

// Normalize Thai text: remove excess spaces, fix common PDF extraction artifacts
function normalize(s) {
  if (!s) return ''
  return String(s).replace(/\s+/g, ' ').trim()
}

// Parse CE date "dd/mm/yy" or "dd/mm/yyyy"
function parseDate(s) {
  if (!s) return null
  const m = String(s).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/)
  if (!m) return null
  let [, dd, mm, yy] = m
  let year = parseInt(yy)
  if (year < 100) year += 2000
  const dt = new Date(year, parseInt(mm) - 1, parseInt(dd))
  return isNaN(dt) ? null : dt
}

function isDate(s) {
  return parseDate(s) !== null
}

function num(s) {
  if (s == null) return 0
  if (typeof s === 'number') return s
  const n = parseFloat(String(s).replace(/,/g, '').trim())
  return isNaN(n) ? 0 : n
}

// Split each line by tabs (or 2+ spaces)
const lines = RAW.split('\n')
const bills = []   // { date, room, sourceProduct, sourceWeight, outputs: [{ product, weight }] }
let currentBill = null

// Skip lines that are page-break headers / footers
function isNoiseLine(line) {
  const t = line.trim()
  if (!t) return true
  if (t.startsWith('-- ') && t.endsWith(' --')) return true  // page marker
  if (t.startsWith('0 \t92,976.62')) return true  // summary header
  if (t.startsWith('ราคาซื')) return true
  if (t.startsWith('วันที')) return true
  if (t.startsWith('คิดเงินคัดแยก')) return true
  if (t.startsWith('1คัด')) return true
  if (t.startsWith('2แกะ')) return true
  if (t.startsWith('เคร')) return true
  if (t.startsWith('สินค้า')) return true
  if (t === 'สุทธิ' || t === '0.10' || t === 'รูป') return true
  if (/^\[\d+\]/.test(t)) return true  // footnotes
  return false
}

let lineCount = 0
for (const rawLine of lines) {
  if (isNoiseLine(rawLine)) continue
  // Split by tab or 2+ spaces
  const parts = rawLine.split(/\t+|\s{2,}/).map(normalize).filter(p => p !== '')
  if (parts.length < 3) continue

  const col0 = parts[0]
  const col1 = parts[1]
  const col2 = parts[2]

  if (isDate(col0)) {
    // HEADER row
    if (currentBill) bills.push(currentBill)
    const date = parseDate(col0)
    const room = col1
    const sourceProduct = col2
    const sourceWeight = num(parts[3])
    const weighedTotal = num(parts[4])
    // FIRST output (if present at col 8)
    const outputs = []
    if (parts[8] && parts[8] !== '0') {
      outputs.push({
        product: parts[8],
        weight: num(parts[9]),
        price: num(parts[10]),
      })
    }
    currentBill = {
      date, dateRaw: col0, room,
      sourceProduct, sourceWeight, weighedTotal,
      outputs,
      rawHeader: parts,
    }
    lineCount++
  } else if (col0 === '0' && col1 === '0') {
    // CONTINUATION row
    if (!currentBill) continue
    const outputProduct = col2
    const outputWeight = num(parts[3])
    // Skip if output is "ขยะ" (waste) — already excluded from stock
    // Actually, "ขยะ" means trash/waste in Thai, not a real product. Include but flag.
    currentBill.outputs.push({
      product: outputProduct,
      weight: outputWeight,
      price: num(parts[4]),
    })
    lineCount++
  }
}
if (currentBill) bills.push(currentBill)

console.log(`Parsed ${bills.length} sorting bills from PDF (line count: ${lineCount})`)

// Show date range
const dates = bills.map(b => b.date).filter(Boolean).sort((a, b) => a - b)
if (dates.length) {
  console.log(`Date range: ${dates[0].toISOString().substring(0, 10)} to ${dates[dates.length - 1].toISOString().substring(0, 10)}`)
}

// Show first 5 bills
console.log('\n=== First 5 bills (sample) ===')
for (const b of bills.slice(0, 5)) {
  console.log(`  ${b.dateRaw} | room ${b.room} | src: ${b.sourceProduct} ${b.sourceWeight}kg | outputs: ${b.outputs.map(o => `${o.product}=${o.weight}kg`).join(', ')}`)
}

// Show last 5 bills
console.log('\n=== Last 5 bills ===')
for (const b of bills.slice(-5)) {
  console.log(`  ${b.dateRaw} | room ${b.room} | src: ${b.sourceProduct} ${b.sourceWeight}kg | outputs: ${b.outputs.map(o => `${o.product}=${o.weight}kg`).join(', ')}`)
}

// Save
fs.writeFileSync('/home/z/my-project/reconciliation/sorting-pdf-parsed.json', JSON.stringify(bills, null, 2))
console.log(`\nSaved to sorting-pdf-parsed.json`)

// Show unique source products and unique output products
const srcProducts = new Set()
const outProducts = new Set()
for (const b of bills) {
  if (b.sourceProduct) srcProducts.add(b.sourceProduct)
  for (const o of b.outputs) if (o.product) outProducts.add(o.product)
}
console.log(`\n=== Unique source products (${srcProducts.size}) ===`)
console.log([...srcProducts].sort().join(' | '))
console.log(`\n=== Unique output products (${outProducts.size}) ===`)
console.log([...outProducts].sort().join(' | '))
