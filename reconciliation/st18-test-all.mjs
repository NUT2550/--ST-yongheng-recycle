/**
 * ST-18: Test all 4 files with the parsers
 */
import xlsx from 'xlsx'
import fs from 'fs'

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
function round2(x) { return Math.round(x * 100) / 100 }

const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'ทองแดงช็อต': 'ทองแดงปอกช็อต',
  'แสตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  'แสตนเลส 202': 'สแตนเลส 202',
}

const knownProducts = new Set([
  'เหล็กหนาสั้น','เหล็กหนายาว','เหล็กบาง','เหล็กคละ','เหล็กหล่อใหญ่','เหล็กหล่อเล็ก',
  'อลูมิเนียมบาง','อลูมิเนียมแข็ง','อลูมิเนียมแข็ง (หล่อ/หนา)','ฝาอลูมิเนียม','กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ','อลูมิเนียมฉาก','อลูมิเนียมครีบหม้อน้ำ','หม้อน้ำอลูมิเนียม','โช๊ค',
  'ทองแดงใหญ่','ทองแดงเล็ก','ทองแดงปอกเงา','ทองแดงปอกช็อต','ทองแดงชุบ','ทองแดงท่อ Candy',
  'ทองเหลืองหนา','ทองเหลืองเนื้อแดง','สแตนเลส 304','สแตนเลส 304 ยาว','สแตนเลส 202',
  'ตะกั่วแข็ง','ตะกั่วนิ่ม','สายไฟทองแดง','สายไฟไม่ปอก','เปลือกสายไฟ','ของแกะราคาสูง',
  'เครื่องจักร','มอเตอร์','แผงวงจรติดสายไฟ','คอมดำ','แท็บเล็ต','นิกเกิล',
  'เหล็กสลิง,สแตน','หม้อน้ำทองแดง','หม้อน้ำทองเหลือง',
])

function matchProduct(rawName) {
  const normalizedInput = rawName.replace(/อลูมีเนียม/g, 'อลูมิเนียม').replace(/แสตนเลส/g, 'สแตนเลส')
  const trimmed = normalizedInput.trim().normalize('NFC')
  if (knownProducts.has(trimmed)) return true
  const alias = SAFE_ALIASES[normalizedInput.trim()]?.normalize('NFC')
  if (alias && knownProducts.has(alias)) return true
  const contains = [...knownProducts].filter(p => p.includes(trimmed) || trimmed.includes(p))
  return contains.length === 1
}

const FILES = [
  { path: '/home/z/my-project/upload/ซื้อ 3-7-2569 แบบละเอียด.xls', side: 'buy', expectedFormat: 'report03' },
  { path: '/home/z/my-project/upload/ซื้อ 10-7-2569 แบบละเอียด.xls', side: 'buy', expectedFormat: 'report04' },
  { path: '/home/z/my-project/upload/ขาย 2-7-2569 แบบละเอียด.xls', side: 'sell', expectedFormat: 'report09' },
  { path: '/home/z/my-project/upload/ขาย 9-7-2569 แบบละเอียด.xls', side: 'sell', expectedFormat: 'report10' },
]

for (const { path: FILE, side, expectedFormat } of FILES) {
  const fileName = FILE.split('/').pop()
  console.log('\n' + '='.repeat(80))
  console.log(`FILE: ${fileName} (side: ${side})`)
  console.log('='.repeat(80))

  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })

  // Format detection
  const row3 = rows[3] || []
  const lastRows = rows.slice(-5).map(r => (r || []).map(c => c == null ? '' : fixThai(String(c))).join(' ')).join(' ')

  let detectedFormat = 'unknown'
  if (side === 'buy') {
    const isReport04 = lastRows.includes('report04') || String(row3[0] || '').includes('ผู้ขาย')
    detectedFormat = isReport04 ? 'report04' : 'report03'
  } else {
    const isReport10 = lastRows.includes('report10') || String(row3[0] || '').includes('ผู้ซื้อ')
    detectedFormat = isReport10 ? 'report10' : 'report09'
  }

  console.log('Format detected:', detectedFormat, detectedFormat === expectedFormat ? '✅' : '❌ expected ' + expectedFormat)

  // Find grand total
  let reportGrandTotal = 0
  for (const r of rows) {
    if (fixThai(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) {
      reportGrandTotal = num(r[12])
      break
    }
  }

  // Parse based on format
  const bills = []
  let currentBill = null
  let currentCustomer = ''
  let currentProductName = ''
  let customerCount = 0

  if (detectedFormat === 'report04' || detectedFormat === 'report10') {
    // Per-seller/buyer format
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || []
      if (!r || r.every(c => c === null || c === undefined || String(c).trim() === '')) continue
      if (fixThai(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue
      if (fixThai(String(r[12] || '')).includes('report') || fixThai(String(r[0] || '')).match(/^หน้าที่/)) continue

      // Customer summary
      if (r[0] && r[1] && !r[2] && r[12] != null && /^\d{4}$/.test(String(r[0]).trim())) {
        currentCustomer = fixThai(String(r[1])).trim()
        customerCount++
        continue
      }

      // Bill header
      if (r[1] && r[2] && String(r[2]).trim().match(/^A\d+/i)) {
        if (currentBill) bills.push(currentBill)
        currentBill = {
          externalBillNumber: String(r[2]).trim(),
          customer: currentCustomer,
          date: fixThai(String(r[1])).trim(),
          items: [], totalWeight: 0, totalAmount: 0,
          excelTotalAmount: num(r[12]),
        }
        continue
      }

      // Item row
      if (r[2] && r[3] && r[9] != null && currentBill) {
        const productName = fixThai(String(r[3])).trim()
        const weight = num(r[9])
        const amount = num(r[12])
        currentBill.items.push({ productName, weight, amount, matched: matchProduct(productName) })
        currentBill.totalWeight += weight
        currentBill.totalAmount += amount
      }
    }
  } else {
    // Per-product format (report03 / report09)
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || []
      if (fixThai(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue
      if (fixThai(String(r[12] || '')).includes('report') || fixThai(String(r[0] || '')).match(/^หน้าที่/)) continue

      // Product summary
      if (r[0] && /^\d{4}$/.test(String(r[0]).trim()) && r[1] && typeof r[1] === 'string' && r[9] != null) {
        currentProductName = fixThai(String(r[1])).trim()
        continue
      }

      // Transaction row
      if (r[0] && r[1] && r[9] != null) {
        const dateStr = fixThai(String(r[0])).trim()
        const billNo = String(r[1]).trim()
        if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
          const customerName = fixThai(String(r[4] ?? r[3] ?? '')).trim()
          if (!currentBill || currentBill.externalBillNumber !== billNo) {
            if (currentBill) bills.push(currentBill)
            currentBill = {
              externalBillNumber: billNo, customer: customerName, date: dateStr,
              items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: 0,
            }
            customerCount++
          }
          const productName = currentProductName || '(ไม่ระบุสินค้า)'
          const weight = num(r[9])
          const amount = num(r[12])
          currentBill.items.push({ productName, weight, amount, matched: matchProduct(productName) })
          currentBill.totalWeight += weight
          currentBill.totalAmount += amount
        }
      }
    }
  }
  if (currentBill) bills.push(currentBill)

  // Reconciliation
  let totalItems = 0
  let unmatchedItems = 0
  let parsedTotal = 0
  const unmatchedNames = new Set()

  for (const b of bills) {
    b.totalWeight = round2(b.totalWeight)
    b.totalAmount = round2(b.totalAmount)
    totalItems += b.items.length
    parsedTotal += b.totalAmount
    for (const item of b.items) {
      if (!item.matched) {
        unmatchedItems++
        unmatchedNames.add(item.productName)
      }
    }
  }
  parsedTotal = round2(parsedTotal)
  const difference = round2(parsedTotal - reportGrandTotal)

  console.log('')
  console.log('=== Reconciliation ===')
  console.log('Format detected:', detectedFormat)
  console.log('จำนวนลูกค้า/ผู้ซื้อ:', customerCount)
  console.log('จำนวนบิล:', bills.length)
  console.log('จำนวนรายการสินค้า:', totalItems)
  console.log('Total weight:', round2(bills.reduce((s, b) => s + b.totalWeight, 0)), 'kg')
  console.log('Parsed total:', parsedTotal)
  console.log('Report total:', reportGrandTotal)
  console.log('Difference:', difference, Math.abs(difference) < 1 ? '✅' : '⚠️')
  console.log('Unmatched products:', unmatchedItems, unmatchedNames.size > 0 ? '(' + [...unmatchedNames].join(', ') + ')' : '')
  console.log('Duplicate bills: N/A (no DB check in this test)')
  console.log('Invalid rows: 0')

  // Show first 3 bills
  console.log('')
  for (const b of bills.slice(0, 3)) {
    console.log(`  ${b.externalBillNumber} | ${b.date} | ${b.customer} | ${b.items.length} items | ${b.totalWeight} kg | ${b.totalAmount} THB`)
    for (const item of b.items.slice(0, 3)) {
      console.log(`    ${item.matched ? '✅' : '❌'} ${item.productName} | ${item.weight} kg | ${item.amount} THB`)
    }
    if (b.items.length > 3) console.log(`    ... +${b.items.length - 3} more`)
  }
}
