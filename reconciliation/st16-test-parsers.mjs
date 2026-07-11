/**
 * ST-16: Test both Excel files with the new parser
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
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
}

// Simulate product matching (without DB — just count unmatched)
function matchProduct(rawName, knownProducts) {
  const normalizedInput = rawName.replace(/อลูมีเนียม/g, 'อลูมิเนียม').replace(/แสตนเลส/g, 'สแตนเลส')
  const trimmed = normalizedInput.trim().normalize('NFC')
  if (knownProducts.has(trimmed)) return { matched: true, name: trimmed }
  const alias = SAFE_ALIASES[normalizedInput.trim()]?.normalize('NFC')
  if (alias && knownProducts.has(alias)) return { matched: true, name: alias }
  const contains = [...knownProducts].filter(p => p.includes(trimmed) || trimmed.includes(p))
  if (contains.length === 1) return { matched: true, name: contains[0] }
  return { matched: false, name: null }
}

// Simulated product list (from production — 113 products)
const knownProducts = new Set([
  'เหล็กหนาสั้น','เหล็กหนายาว','เหล็กบาง','เหล็กคละ','เหล็กหล่อใหญ่','เหล็กหล่อเล็ก',
  'อลูมิเนียมบาง','อลูมิเนียมแข็ง','อลูมิเนียมแข็ง (หล่อ/หนา)','ฝาอลูมิเนียม','กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ','อลูมิเนียมฉาก','อลูมิเนียมครีบหม้อน้ำ','หม้อน้ำอลูมิเนียม','โช๊ค',
  'ทองแดงใหญ่','ทองแดงเล็ก','ทองแดงปอกเงา','ทองแดงปอกช็อต','ทองแดงชุบ','ทองแดงท่อ Candy',
  'ทองเหลืองหนา','ทองเหลืองเนื้อแดง','สแตนเลส 304','สแตนเลส 304 ยาว','สแตนเลส 202',
  'ตะกั่วแข็ง','ตะกั่วนิ่ม','สายไฟทองแดง','สายไฟไม่ปอก','เปลือกสายไฟ','ของแกะราคาสูง',
  'เครื่องจักร','มอเตอร์','แผงวงจรติดสายไฟ','คอมดำ','แท็บเล็ต','นิกเกิล',
])

const FILES = [
  '/home/z/my-project/upload/ซื้อ 3-7-2569 แบบละเอียด.xls',
  '/home/z/my-project/upload/ซื้อ 10-7-2569 แบบละเอียด.xls',
]

for (const FILE of FILES) {
  const fileName = FILE.split('/').pop()
  console.log('\n' + '='.repeat(80))
  console.log('FILE:', fileName)
  console.log('='.repeat(80))

  const buf = fs.readFileSync(FILE)
  const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
  const rows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })

  // Format detection
  const row3 = rows[3] || []
  const lastRows = rows.slice(-5).map(r => (r || []).map(c => c == null ? '' : fixThai(String(c))).join(' ')).join(' ')
  const isReport04 = lastRows.includes('report04') || String(row3[0] || '').includes('ผู้ขาย')
  const isReport03 = lastRows.includes('report03') || (!isReport04 && (String(row3[1] || '').includes('วัสดุ') || String(row3[0] || '').includes('วัสดุ')))
  const detectedFormat = isReport04 ? 'report04' : 'report03'
  console.log('Format detected:', detectedFormat)

  // Find grand total
  let reportGrandTotal = 0
  for (const r of rows) {
    if (fixThaiText(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) {
      reportGrandTotal = num(r[12])
      break
    }
  }
  console.log('Report grand total:', reportGrandTotal)

  const bills = []
  let currentBill = null
  let currentSeller = ''
  let currentProductName = ''
  let sellerCount = 0

  if (isReport04) {
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || []
      const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
      if (fixed.every(c => c === null || c === undefined || String(c).trim() === '')) continue
      if (fixThai(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue
      if (fixThai(String(r[12] || '')).includes('report04') || fixThai(String(r[0] || '')).match(/^หน้าที่/)) continue

      // Seller summary
      if (r[0] && r[1] && !r[2] && r[12] != null && /^\d{4}$/.test(String(r[0]).trim())) {
        currentSeller = fixThai(String(r[1])).trim()
        sellerCount++
        continue
      }

      // Bill header
      if (r[1] && r[2] && String(r[2]).trim().match(/^A\d+/i)) {
        if (currentBill) bills.push(currentBill)
        currentBill = {
          externalBillNumber: String(r[2]).trim(),
          seller: currentSeller,
          date: fixThai(String(r[1])).trim(),
          note: r[4] ? fixThai(String(r[4])).trim() : '',
          items: [], totalWeight: 0, totalAmount: 0,
          excelTotalAmount: num(r[12]),
        }
        continue
      }

      // Item row
      if (r[2] && r[3] && r[9] != null && currentBill) {
        const productName = fixThai(String(r[3])).trim()
        const weight = num(r[9])
        const pricePerKg = num(r[11])
        const amount = num(r[12])
        const m = matchProduct(productName, knownProducts)
        currentBill.items.push({ productName, weight, pricePerKg, amount, matched: m.matched, matchedName: m.name })
        currentBill.totalWeight += weight
        currentBill.totalAmount += amount
      }
    }
  } else {
    for (let i = 4; i < rows.length; i++) {
      const r = rows[i] || []
      if (fixThai(String(r[1] || '')).includes('ยอดรวมท้ายรายงาน')) continue
      if (fixThai(String(r[12] || '')).includes('report03') || fixThai(String(r[0] || '')).match(/^หน้าที่/)) continue

      if (r[0] && /^\d{4}$/.test(String(r[0]).trim()) && r[1] && typeof r[1] === 'string' && r[9] != null) {
        currentProductName = fixThai(String(r[1])).trim()
        continue
      }

      if (r[0] && r[1] && r[9] != null) {
        const dateStr = fixThai(String(r[0])).trim()
        const billNo = String(r[1]).trim()
        if (dateStr.match(/^\d{1,2}\/\d{1,2}\/\d{2,4}$/)) {
          if (!currentBill || currentBill.externalBillNumber !== billNo) {
            if (currentBill) bills.push(currentBill)
            const sellerName = String(r[3] ?? '').trim()
            currentBill = {
              externalBillNumber: billNo,
              seller: sellerName,
              date: dateStr,
              note: '', items: [], totalWeight: 0, totalAmount: 0, excelTotalAmount: 0,
            }
            if (!bills.some(b => b.seller === currentBill.seller)) sellerCount++
          }
          const productName = currentProductName || '(ไม่ระบุสินค้า)'
          const weight = num(r[9])
          const pricePerKg = num(r[11])
          const amount = num(r[12])
          const m = matchProduct(productName, knownProducts)
          currentBill.items.push({ productName, weight, pricePerKg, amount, matched: m.matched, matchedName: m.name })
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
  console.log('จำนวนลูกค้า/ผู้ขาย:', sellerCount)
  console.log('จำนวนบิล:', bills.length)
  console.log('จำนวนรายการสินค้า:', totalItems)
  console.log('Unmatched products:', unmatchedItems, unmatchedNames.size > 0 ? '(' + [...unmatchedNames].join(', ') + ')' : '')
  console.log('Parsed total:', parsedTotal)
  console.log('Report grand total:', reportGrandTotal)
  console.log('Difference:', difference, Math.abs(difference) < 1 ? '✅' : '⚠️')

  // Show first 5 bills
  console.log('')
  console.log('--- First 5 bills ---')
  for (const b of bills.slice(0, 5)) {
    console.log(`  ${b.externalBillNumber} | ${b.date} | ${b.seller} | ${b.items.length} items | ${b.totalWeight} kg | ${b.totalAmount} THB`)
    for (const item of b.items.slice(0, 3)) {
      console.log(`    ${item.matched ? '✅' : '❌'} ${item.productName} | ${item.weight} kg @ ${item.pricePerKg} = ${item.amount}`)
    }
    if (b.items.length > 3) console.log(`    ... +${b.items.length - 3} more`)
  }
}

function fixThaiText(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try { return new TextDecoder('windows-874').decode(Buffer.from(s, 'latin1')) } catch { return s }
  }
  return s
}
