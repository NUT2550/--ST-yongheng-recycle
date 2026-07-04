/**
 * Parse detailed Buy .xls file -> extract stainless buyIn entries
 * Source: upload/ซื้อ 22-1-2569 ถึง 3-7-2569 แบบละเอียด.xls
 *
 * File structure:
 *   Row 0: title
 *   Row 1: date range
 *   Row 3: header "วัสดุ | ผู้ขาย | ... | จำนวน | หน่วย | ราคา@ | รวมเงิน"
 *   Row 4: product summary (product code, name, total weight, avg price, total amount)
 *   Row 5+: transaction rows (date, bill no, seller code, seller name, ..., weight, price, total)
 *   ...
 *   empty separator
 *   next product summary
 */
import xlsx from 'xlsx'
import fs from 'fs'

const FILE = '/home/z/my-project/upload/ซื้อ 22-1-2569 ถึง 3-7-2569 แบบละเอียด.xls'

function fixThaiText(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try {
      const buf = Buffer.from(s, 'latin1')
      const decoded = new TextDecoder('windows-874').decode(buf)
      return decoded
    } catch { return s }
  }
  return s
}

function parseThaiDate(d) {
  if (!d) return null
  if (d instanceof Date && !isNaN(d)) return d
  if (typeof d === 'number') {
    return new Date(Math.round((d - 25569) * 86400 * 1000))
  }
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

function isDateLike(s) {
  if (!s) return false
  if (s instanceof Date) return !isNaN(s)
  if (typeof s === 'number') return s > 30000 && s < 60000  // excel serial for years ~1982-2064
  if (typeof s === 'string') return /^\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(s.trim())
  return false
}

function isProductCode(s) {
  if (typeof s !== 'string') s = String(s ?? '')
  return /^\d{4}$/.test(s.trim())
}

function num(s) {
  if (s == null || s === '') return 0
  if (typeof s === 'number') return s
  const n = parseFloat(String(s).replace(/,/g, '').trim())
  return isNaN(n) ? 0 : n
}

console.log('Reading:', FILE)
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', cellDates: true })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
console.log('Total rows:', rows.length)

let currentProduct = null
let currentProductCode = null
const transactions = []  // { productCode, productName, date, billNo, sellerCode, sellerName, weight, pricePerKg, totalAmount }
const productSummaries = []  // { productCode, productName, totalWeight, avgPrice, totalAmount }

// Stainless-related keywords for filtering
const STAINLESS_KEYWORDS = ['สแตนเลส', 'แสตนเลส', 'stainless', 'นิกเกิล', 'ขี้กลึงสแตน', 'ขี้กลึงแสตน']

for (let i = 0; i < rows.length; i++) {
  const rawRow = rows[i] || []
  const row = rawRow.map(c => fixThaiText(c ?? ''))
  const col0 = row[0]
  const col1 = row[1]

  // Empty row -> reset current product? Actually no — keep current product until next product code
  if (row.every(c => !c || !String(c).trim())) continue

  // Product summary row: col0 = 4-digit code, col1 = product name
  if (isProductCode(col0) && col1 && String(col1).trim()) {
    currentProductCode = String(col0).trim()
    currentProduct = String(col1).trim()
    const totalWeight = num(row[9])
    const avgPrice = num(row[11])
    const totalAmount = num(row[12])
    productSummaries.push({
      productCode: currentProductCode,
      productName: currentProduct,
      totalWeight, avgPrice, totalAmount,
    })
    continue
  }

  // Transaction row: col0 looks like date
  if (isDateLike(col0) && currentProduct) {
    const date = parseThaiDate(col0)
    transactions.push({
      productCode: currentProductCode,
      productName: currentProduct,
      date,
      dateRaw: col0,
      billNo: String(col1 ?? '').trim(),
      sellerCode: String(row[2] ?? '').trim(),
      sellerName: String(row[3] ?? '').trim(),
      weight: num(row[9]),
      pricePerKg: num(row[11]),
      totalAmount: num(row[12]),
    })
  }
}

console.log(`\nParsed: ${productSummaries.length} product summaries, ${transactions.length} transactions`)

// Show only stainless-related products
console.log('\n=== STAINLESS-RELATED PRODUCT SUMMARIES ===')
const stainlessSummaries = productSummaries.filter(p =>
  STAINLESS_KEYWORDS.some(k => p.productName.toLowerCase().includes(k.toLowerCase())) ||
  ['304','202'].includes(p.productName.trim()) ||
  p.productName.includes('304ยาว') || p.productName.includes('304 ยาว')
)
for (const s of stainlessSummaries) {
  console.log(`  [${s.productCode}] ${s.productName} | total=${s.totalWeight} kg | avg=${s.avgPrice}/kg | amt=${s.totalAmount}`)
}

console.log('\n=== ALL PRODUCT CODES & NAMES (for reference) ===')
for (const s of productSummaries) {
  console.log(`  [${s.productCode}] ${s.productName} | total=${s.totalWeight} kg`)
}

// Save full output to JSON for next step
fs.writeFileSync('/home/z/my-project/reconciliation/buy-parsed.json', JSON.stringify({
  productSummaries,
  transactions,
}, null, 2))
console.log(`\nSaved to buy-parsed.json`)
console.log(`  Stainless summaries: ${stainlessSummaries.length}`)
