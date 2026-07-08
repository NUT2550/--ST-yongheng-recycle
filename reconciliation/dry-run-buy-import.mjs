/**
 * Dry-run test: simulate detailed Buy Excel import against updated MT products.
 * Mirrors the EXACT matching logic from detailed-excel-import-dialog.tsx.
 *
 * Expected per owner:
 *   - 13 bills
 *   - 43 items
 *   - 0 unmatched
 *   - 0 duplicates
 *
 * This is DRY-RUN ONLY. No bills created, no API calls.
 */
import xlsx from 'xlsx'
import fs from 'fs'

const FILE = '/home/z/my-project/upload/ซื้อ 1-7-2569 แบบละเอียด.xls'
const mtProducts = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/mt-products.json', 'utf8'))

// ===== Same logic as detailed-excel-import-dialog.tsx =====

// Build product lookup map: normalized exact name → product
const productMap = new Map()
for (const p of mtProducts) {
  productMap.set(p.name.trim().normalize('NFC'), p)
}

// Updated safe aliases (post-fix)
const safeAliases = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมิเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมิเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมิเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมิเนียมตูดกะทะ',
}

function fixThaiText(text) {
  if (!text) return text
  if (typeof text !== 'string') text = String(text)
  const hasGarbled = [...text].some(c => c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) <= 0xFF)
  if (!hasGarbled) return text
  try {
    const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF))
    return new TextDecoder('windows-874').decode(bytes)
  } catch { return text }
}

function matchProduct(excelName) {
  // Normalize: standardize อลูมีเนียม → อลูมิเนียม (per owner Decision 1, Task 35)
  const normalizedInput = excelName.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
  const trimmed = normalizedInput.trim().normalize('NFC')
  // 1. Exact match (normalized)
  if (productMap.has(trimmed)) return productMap.get(trimmed)
  // 2. Safe alias (normalized)
  const alias = safeAliases[excelName.trim()]?.normalize('NFC')
  if (alias && productMap.has(alias)) return productMap.get(alias)
  // 3. Contains match (single result only — no ambiguity, normalized)
  // NOTE: import dialog does NOT restrict by category — it searches all products
  const contains = mtProducts.filter(p => {
    const pn = p.name.normalize('NFC')
    return pn.includes(trimmed) || trimmed.includes(pn)
  })
  if (contains.length === 1) return contains[0]
  return null
}

// ===== Parse the Excel file (same logic as import dialog) =====
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const ws = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })

const bills = []
let currentBill = null
let currentSeller = ''

for (let i = 4; i < rows.length; i++) {
  const r = rows[i]
  if (!r || r.every(c => c === null || c === undefined)) continue

  // Seller summary row: col 0 has code, col 1 has name
  if (r[0] && r[1] && !r[2] && r[9] == null) {
    currentSeller = fixThaiText(String(r[1]))
    continue
  }

  // Bill header row: col 1 has date, col 2 has bill number, col 12 has total
  if (r[1] && r[2] && String(r[2]).trim().match(/^A\d+/i) && r[12] != null) {
    if (currentBill) bills.push(currentBill)
    currentBill = {
      externalBillNumber: String(r[2]).trim(),
      seller: currentSeller,
      date: fixThaiText(String(r[1])).trim(),
      items: [],
      totalWeight: 0,
      totalAmount: 0,
      excelTotalAmount: parseFloat(String(r[12])) || 0,
    }
    continue
  }

  // Item row: col 2 has product code, col 3 has product name, col 9 has weight
  if (r[2] && r[3] && r[9] != null && currentBill) {
    const productName = fixThaiText(String(r[3])).trim()
    const weight = parseFloat(String(r[9])) || 0
    const pricePerKg = parseFloat(String(r[11])) || 0
    const amount = parseFloat(String(r[12])) || 0
    const matched = matchProduct(productName)

    currentBill.items.push({
      productName,
      productCode: String(r[2]).trim(),
      productId: matched?.id || null,
      matchedProductName: matched?.name || null,
      matchedProductCategory: matched?.categoryName || null,
      weight,
      pricePerKg,
      amount,
      matched: !!matched,
    })
    currentBill.totalWeight += weight
    currentBill.totalAmount += amount
  }
}
if (currentBill) bills.push(currentBill)

// ===== Summary =====
const totalItems = bills.reduce((s, b) => s + b.items.length, 0)
const unmatchedItems = bills.reduce((s, b) => s + b.items.filter(i => !i.matched).length, 0)

console.log('=== DRY-RUN RESULT ===')
console.log(`File: ${FILE}`)
console.log(`Bills: ${bills.length}`)
console.log(`Total items: ${totalItems}`)
console.log(`Unmatched items: ${unmatchedItems}`)
console.log('')

// Show all bills
console.log('=== BILLS ===')
for (const b of bills) {
  const allMatched = b.items.every(i => i.matched)
  console.log(`  ${b.externalBillNumber} | ${b.date} | ${b.seller} | ${b.items.length} items | ${allMatched ? '✅ READY' : '❌ HAS UNMATCHED'}`)
  for (const it of b.items) {
    if (!it.matched) {
      console.log(`     ❌ UNMATCHED: "${it.productName}" (code ${it.productCode}) ${it.weight}kg @ ${it.pricePerKg}`)
    }
  }
}

// List unmatched product names (unique)
const unmatchedSet = new Map()
for (const b of bills) {
  for (const it of b.items) {
    if (!it.matched) {
      unmatchedSet.set(it.productName, (unmatchedSet.get(it.productName) || 0) + 1)
    }
  }
}
console.log('\n=== UNIQUE UNMATCHED PRODUCT NAMES ===')
if (unmatchedSet.size === 0) {
  console.log('  ✅ NONE — all products matched!')
} else {
  for (const [name, count] of unmatchedSet) {
    console.log(`  ❌ "${name}" (${count}x)`)
  }
}

// Final verdict
console.log('\n=== VERDICT ===')
const expected = { bills: 13, items: 43, unmatched: 0 }
const actual = { bills: bills.length, items: totalItems, unmatched: unmatchedItems }
console.log(`Expected: ${expected.bills} bills, ${expected.items} items, ${expected.unmatched} unmatched`)
console.log(`Actual:   ${actual.bills} bills, ${actual.items} items, ${actual.unmatched} unmatched`)
const pass = actual.bills === expected.bills && actual.items === expected.items && actual.unmatched === expected.unmatched
console.log(`Result:   ${pass ? '✅ PASS — import preview is ready' : '❌ FAIL — see unmatched above'}`)
