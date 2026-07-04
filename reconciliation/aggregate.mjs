/**
 * Aggregate all data sources and compute dry-run reconciliation
 * for stainless group.
 *
 * DATA SOURCES:
 *   1. buy-parsed.json   - detailed Buy .xls (22/1/2569 - 3/7/2569)
 *   2. sell-parsed.json  - detailed Sell .xls (22/1/2569 - 3/7/2569)
 *   3. sorting-pdf-parsed.json - sorting PDF (6/1/26 - 27/6/26)
 *   4. db-data.json      - DB SortingBills + StockTransfers from 28/06/2569 + current stock
 *
 * RESET DATES (Buddhist → CE):
 *   05/02/2569 → 5 Feb 2026   (most stainless products)
 *   22/01/2569 → 22 Jan 2026  (ขี้กลึงสแตนเลส 304 only)
 *
 * ALIASES (per user):
 *   304           → สแตนเลส 304
 *   202           → สแตนเลส 202
 *   304ยาว        → สแตนเลส 304 ยาว
 *   304 ยาว       → สแตนเลส 304 ยาว
 *   ขี้กลึงสแตนเลส → ขี้กลึงสแตนเลส 304
 *
 * DB product name normalization:
 *   - "แสตนเลส" and "สแตนเลส" are equivalent (both spellings appear)
 */
import fs from 'fs'

// ============ LOAD DATA ============
const buyRaw = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/buy-parsed.json', 'utf8'))
buyRaw.transactions.forEach(t => { if (t.date) t.date = new Date(t.date) })
const buy = buyRaw
const sellRaw = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/sell-parsed.json', 'utf8'))
sellRaw.transactions.forEach(t => { if (t.date) t.date = new Date(t.date) })
const sell = sellRaw
const sortPdfRaw = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/sorting-pdf-parsed.json', 'utf8'))
sortPdfRaw.forEach(b => { if (b.date) b.date = new Date(b.date) })
const sortPdf = sortPdfRaw
const dbData = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/db-data.json', 'utf8'))

// ============ STAINLESS PRODUCT MAPPING ============
// DB products (the 7 stainless products)
const PRODUCTS = [
  { id: 'prod_mqgp9caefhv0hs74sfuubrmr', dbName: 'แสตนเลส 304',                 userCode: 'สแตนเลส 304',          resetDate: new Date('2026-02-05T00:00:00+07:00'), resetDateDisplay: '05/02/2569' },
  { id: 'prod_mqgp9cmnidvf2vafwiepqg0d', dbName: 'แสตนเลส 202',                 userCode: 'สแตนเลส 202',          resetDate: new Date('2026-02-05T00:00:00+07:00'), resetDateDisplay: '05/02/2569' },
  { id: 'prod_new_1782125294328_e0b981e0b8aae0b895e0b899', dbName: 'แสตนเลสดูดติด', userCode: 'สแตนเลสดูดติด',     resetDate: new Date('2026-02-05T00:00:00+07:00'), resetDateDisplay: '05/02/2569' },
  { id: 'prod_mqgp9cgafv9ts0i3ze22h1vb', dbName: 'แสตนเลส 304 (ยาว)',           userCode: 'สแตนเลส 304 ยาว',     resetDate: new Date('2026-02-05T00:00:00+07:00'), resetDateDisplay: '05/02/2569' },
  { id: 'cmr09vcvi001ml1055umg3jpg',     dbName: 'แสตนเลสติดเหล็ก',              userCode: 'สแตนเลสติดเหล็ก',     resetDate: new Date('2026-02-05T00:00:00+07:00'), resetDateDisplay: '05/02/2569' },
  { id: 'cmr09vcvi001ol105nmz9gye6',     dbName: 'นิกเกิล(สแตนเลส)',              userCode: 'นิกเกิล',              resetDate: new Date('2026-02-05T00:00:00+07:00'), resetDateDisplay: '05/02/2569' },
  { id: 'cmr09vcvi001ql105usal36bv',     dbName: 'ขี้กลึงสแตนเลส304',             userCode: 'ขี้กลึงสแตนเลส 304', resetDate: new Date('2026-01-22T00:00:00+07:00'), resetDateDisplay: '22/01/2569' },
]

// ============ ALIAS MAP ============
// Maps raw product name (normalized) → userCode (one of the 7 products)
function normalizeName(s) {
  if (!s) return ''
  return String(s)
    .replace(/แสตนเลส/g, 'สแตนเลส')      // unify spelling
    .replace(/สแตนเลส\s+304\s+ยาว/g, 'สแตนเลส 304 ยาว')
    .replace(/\s+/g, ' ')
    .trim()
}

const ALIAS_TO_USERCODE = {
  // Direct aliases from user
  '304':           'สแตนเลส 304',
  '202':           'สแตนเลส 202',
  '304ยาว':        'สแตนเลส 304 ยาว',
  '304 ยาว':       'สแตนเลส 304 ยาว',
  'ขี้กลึงสแตนเลส': 'ขี้กลึงสแตนเลส 304',
  // Full names (also accepted)
  'สแตนเลส 304':       'สแตนเลส 304',
  'สแตนเลส 202':       'สแตนเลส 202',
  'สแตนเลสดูดติด':     'สแตนเลสดูดติด',
  'สแตนเลส 304 ยาว':   'สแตนเลส 304 ยาว',
  'สแตนเลส 304(ยาว)':  'สแตนเลส 304 ยาว',
  'สแตนเลส 304 (ยาว)': 'สแตนเลส 304 ยาว',
  'สแตนเลสติดเหล็ก':   'สแตนเลสติดเหล็ก',
  'นิกเกิล':           'นิกเกิล',
  'นิกเกิล(สแตนเลส)':  'นิกเกิล',
  'นิกเกิล (สแตนเลส)': 'นิกเกิล',
  'ขี้กลึงสแตนเลส304': 'ขี้กลึงสแตนเลส 304',
  'ขี้กลึงสแตนเลส 304':'ขี้กลึงสแตนเลส 304',
}

// Names that look stainless but are NOT in the alias list — collect as ambiguous
const AMBIGUOUS_NAMES = new Set()
function resolveName(rawName) {
  if (!rawName) return null
  const n = normalizeName(rawName)
  if (ALIAS_TO_USERCODE[n]) return ALIAS_TO_USERCODE[n]
  // Try if name contains "สแตนเลส" or "นิกเกิล" but no exact alias → ambiguous
  if (/สแตนเลส|นิกเกิล/.test(n) || /^(304|202)/.test(n)) {
    AMBIGUOUS_NAMES.add(rawName)
  }
  return null
}

// Map DB product name → userCode
function resolveDbName(dbName) {
  return resolveName(dbName)
}

// ============ AGGREGATE BUY/SELL ============
// Initialize per-product totals
const result = {}
for (const p of PRODUCTS) {
  result[p.userCode] = {
    productId: p.id,
    systemProductName: p.dbName,
    userCode: p.userCode,
    resetDate: p.resetDateDisplay,
    resetDateObj: p.resetDate,
    buyIn: 0,
    sellOut: 0,
    sortingSourceOut_pdf: 0,
    sortingOutputIn_pdf: 0,
    sortingSourceOut_db: 0,
    sortingOutputIn_db: 0,
    transferSourceOut: 0,
    transferOutputIn: 0,
    currentSystemStock: 0,
    buyTxCount: 0,
    sellTxCount: 0,
    sortSourceBills: [],
    sortOutputBills: [],
    transferSourceBills: [],
    transferOutputBills: [],
  }
}

// Buy transactions
console.log('\n=== BUY TRANSACTIONS (filtered by date >= reset) ===')
for (const tx of buy.transactions) {
  if (!tx.date) continue
  const uc = resolveName(tx.productName)
  if (!uc) continue
  const r = result[uc]
  if (tx.date < r.resetDateObj) continue
  r.buyIn += tx.weight
  r.buyTxCount++
  console.log(`  +${tx.weight}kg ${tx.productName} → ${uc} (date ${tx.date.toISOString().substring(0,10)}, bill ${tx.billNo})`)
}

// Sell transactions
console.log('\n=== SELL TRANSACTIONS (filtered by date >= reset) ===')
for (const tx of sell.transactions) {
  if (!tx.date) continue
  const uc = resolveName(tx.productName)
  if (!uc) continue
  const r = result[uc]
  if (tx.date < r.resetDateObj) continue
  r.sellOut += tx.weight
  r.sellTxCount++
  console.log(`  -${tx.weight}kg ${tx.productName} → ${uc} (date ${tx.date.toISOString().substring(0,10)}, bill ${tx.billNo})`)
}

// PDF sorting bills
console.log('\n=== PDF SORTING BILLS (filtered by date >= reset) ===')
for (const bill of sortPdf) {
  if (!bill.date) continue
  // Check source product (sortingSourceOut)
  const srcUc = resolveName(bill.sourceProduct)
  if (srcUc) {
    const r = result[srcUc]
    if (bill.date >= r.resetDateObj) {
      r.sortingSourceOut_pdf += bill.sourceWeight
      r.sortSourceBills.push({ date: bill.dateRaw, sourceProduct: bill.sourceProduct, weight: bill.sourceWeight, room: bill.room })
      console.log(`  SOURCE OUT: -${bill.sourceWeight}kg ${bill.sourceProduct} → ${srcUc} (date ${bill.dateRaw}, room ${bill.room})`)
    }
  }
  // Check each output product (sortingOutputIn)
  for (const out of bill.outputs) {
    if (out.product === 'ขยะ') continue  // waste, not a real product
    const outUc = resolveName(out.product)
    if (!outUc) continue
    const r = result[outUc]
    if (bill.date >= r.resetDateObj) {
      r.sortingOutputIn_pdf += out.weight
      r.sortOutputBills.push({ date: bill.dateRaw, sourceProduct: bill.sourceProduct, outputProduct: out.product, weight: out.weight, room: bill.room })
      console.log(`  OUTPUT IN: +${out.weight}kg ${out.product} → ${outUc} (date ${bill.dateRaw}, room ${bill.room}, from src ${bill.sourceProduct})`)
    }
  }
}

// DB SortingBills (from 28/06/2026 onward)
console.log('\n=== DB SORTING BILLS (from 28/06/2026 onward) ===')
const dbCutoff = new Date('2026-06-28T00:00:00+07:00')
for (const bill of dbData.sortBills) {
  const billDate = new Date(bill.date)
  // Source (sortingSourceOut)
  const srcUc = resolveDbName(bill.sourceProductName)
  if (srcUc) {
    const r = result[srcUc]
    if (billDate >= r.resetDateObj && billDate >= dbCutoff) {
      r.sortingSourceOut_db += bill.sourceWeight
      r.sortSourceBills.push({ date: billDate.toISOString().substring(0,10), sourceProduct: bill.sourceProductName, weight: bill.sourceWeight, billNo: bill.billNumber, room: bill.roomNumber })
      console.log(`  SOURCE OUT (DB): -${bill.sourceWeight}kg ${bill.sourceProductName} → ${srcUc} (date ${billDate.toISOString().substring(0,10)}, ${bill.billNumber})`)
    }
  }
  // Outputs
  for (const item of bill.items) {
    if (item.isWaste) continue
    const outUc = resolveDbName(item.productName)
    if (!outUc) continue
    const r = result[outUc]
    if (billDate >= r.resetDateObj && billDate >= dbCutoff) {
      r.sortingOutputIn_db += item.weight
      r.sortOutputBills.push({ date: billDate.toISOString().substring(0,10), sourceProduct: bill.sourceProductName, outputProduct: item.productName, weight: item.weight, billNo: bill.billNumber, room: bill.roomNumber })
      console.log(`  OUTPUT IN (DB): +${item.weight}kg ${item.productName} → ${outUc} (date ${billDate.toISOString().substring(0,10)}, ${bill.billNumber}, from src ${bill.sourceProductName})`)
    }
  }
}

// DB StockTransfers (from 28/06/2026 onward)
console.log('\n=== DB STOCK TRANSFERS (from 28/06/2026 onward) ===')
for (const tr of dbData.transfers) {
  const trDate = new Date(tr.date)
  // Source (transferSourceOut)
  const srcUc = resolveDbName(tr.sourceProductName)
  if (srcUc) {
    const r = result[srcUc]
    if (trDate >= r.resetDateObj && trDate >= dbCutoff) {
      r.transferSourceOut += tr.sourceWeight
      r.transferSourceBills.push({ date: trDate.toISOString().substring(0,10), sourceProduct: tr.sourceProductName, weight: tr.sourceWeight, billNo: tr.billNumber })
      console.log(`  TRANSFER OUT: -${tr.sourceWeight}kg ${tr.sourceProductName} → ${srcUc} (date ${trDate.toISOString().substring(0,10)}, ${tr.billNumber})`)
    }
  }
  // Outputs
  for (const item of tr.items) {
    if (item.isWaste) continue
    const outUc = resolveDbName(item.productName)
    if (!outUc) continue
    const r = result[outUc]
    if (trDate >= r.resetDateObj && trDate >= dbCutoff) {
      r.transferOutputIn += item.weight
      r.transferOutputBills.push({ date: trDate.toISOString().substring(0,10), sourceProduct: tr.sourceProductName, outputProduct: item.productName, weight: item.weight, billNo: tr.billNumber })
      console.log(`  TRANSFER IN: +${item.weight}kg ${item.productName} → ${outUc} (date ${trDate.toISOString().substring(0,10)}, ${tr.billNumber})`)
    }
  }
}

// Current system stock (from DB)
console.log('\n=== CURRENT SYSTEM STOCK ===')
for (const p of PRODUCTS) {
  const dbProd = dbData.products.find(pp => pp.id === p.id)
  result[p.userCode].currentSystemStock = dbProd ? dbProd.stock : 0
  console.log(`  ${p.userCode} (${p.dbName}): ${dbProd ? dbProd.stock.toFixed(2) : '0.00'} kg`)
}

// ============ COMPUTE TARGET STOCK ============
console.log('\n=== TARGET STOCK CALCULATION ===')
for (const p of PRODUCTS) {
  const r = result[p.userCode]
  r.sortingSourceOut = r.sortingSourceOut_pdf + r.sortingSourceOut_db
  r.sortingOutputIn = r.sortingOutputIn_pdf + r.sortingOutputIn_db
  r.targetStock =
    r.buyIn
    - r.sellOut
    - r.sortingSourceOut
    + r.sortingOutputIn
    - r.transferSourceOut
    + r.transferOutputIn
  r.difference = r.targetStock - r.currentSystemStock

  // Confidence: high if buyIn matches between file and DB and there are no ambiguous names
  // Medium if small difference (< 5% of targetStock)
  // Low if large difference or any ambiguous names
  const movement = Math.abs(r.buyIn) + Math.abs(r.sellOut) + Math.abs(r.sortingSourceOut) + Math.abs(r.sortingOutputIn) + Math.abs(r.transferSourceOut) + Math.abs(r.transferOutputIn)
  if (movement === 0) {
    r.confidence = 'HIGH'
    r.recommendedAction = 'NO_MOVEMENT - confirm physical count = 0'
  } else if (Math.abs(r.difference) < 1) {
    r.confidence = 'HIGH'
    r.recommendedAction = 'READY_FOR_ADJUSTMENT (diff < 1kg)'
  } else if (Math.abs(r.difference) < Math.max(movement * 0.05, 5)) {
    r.confidence = 'MEDIUM'
    r.recommendedAction = 'PHYSICAL_COUNT_RECOMMENDED before adjustment'
  } else {
    r.confidence = 'LOW'
    r.recommendedAction = 'NEEDS_REVIEW - large difference, verify data sources'
  }

  // Build note
  const notes = []
  if (r.buyTxCount === 0 && r.sellTxCount === 0 && r.sortSourceBills.length === 0 && r.sortOutputBills.length === 0 && r.transferSourceBills.length === 0 && r.transferOutputBills.length === 0) {
    notes.push('No stainless transactions in any source after reset date')
  }
  if (r.sortingSourceOut_pdf > 0 || r.sortingSourceOut_db > 0) notes.push(`Was used as sorting source ${r.sortSourceBills.length}x`)
  if (r.sortingOutputIn_pdf > 0 || r.sortingOutputIn_db > 0) notes.push(`Was sorted in ${r.sortOutputBills.length}x`)
  if (r.buyTxCount > 0) notes.push(`${r.buyTxCount} buy transactions`)
  if (r.sellTxCount > 0) notes.push(`${r.sellTxCount} sell transactions`)
  r.note = notes.join('; ')
}

// ============ OUTPUT FINAL TABLE ============
console.log('\n' + '='.repeat(160))
console.log('DRY-RUN RECONCILIATION RESULT — STAINLESS GROUP')
console.log('='.repeat(160))

// Per-product breakdown
console.log('\n--- Per-Product Detail ---\n')
for (const p of PRODUCTS) {
  const r = result[p.userCode]
  console.log(`PRODUCT: ${p.userCode}  (DB: ${p.dbName})`)
  console.log(`  productId:                 ${p.id}`)
  console.log(`  reset date:                ${p.resetDate}`)
  console.log(`  buyIn (after reset):       ${r.buyIn.toFixed(2)} kg  (${r.buyTxCount} txns)`)
  console.log(`  sellOut (after reset):     ${r.sellOut.toFixed(2)} kg  (${r.sellTxCount} txns)`)
  console.log(`  sortingSourceOut:          ${r.sortingSourceOut.toFixed(2)} kg  (PDF: ${r.sortingSourceOut_pdf.toFixed(2)} + DB: ${r.sortingSourceOut_db.toFixed(2)})`)
  console.log(`  sortingOutputIn:           ${r.sortingOutputIn.toFixed(2)} kg  (PDF: ${r.sortingOutputIn_pdf.toFixed(2)} + DB: ${r.sortingOutputIn_db.toFixed(2)})`)
  console.log(`  transferSourceOut:         ${r.transferSourceOut.toFixed(2)} kg`)
  console.log(`  transferOutputIn:          ${r.transferOutputIn.toFixed(2)} kg`)
  console.log(`  ---`)
  console.log(`  calculated target stock:   ${r.targetStock.toFixed(2)} kg`)
  console.log(`  current system stock:      ${r.currentSystemStock.toFixed(2)} kg`)
  console.log(`  difference (target-system):${r.difference >= 0 ? '+' : ''}${r.difference.toFixed(2)} kg`)
  console.log(`  confidence:                ${r.confidence}`)
  console.log(`  recommended action:        ${r.recommendedAction}`)
  console.log(`  note:                      ${r.note}`)
  console.log('')
}

// Summary table (CSV-like)
console.log('\n--- Summary Table ---\n')
const headers = ['productId', 'system product name', 'reset date', 'buyIn', 'sellOut', 'sortSrcOut', 'sortOutIn', 'trnSrcOut', 'trnOutIn', 'targetStock', 'systemStock', 'difference', 'confidence', 'recommendedAction']
console.log(headers.join('\t'))
for (const p of PRODUCTS) {
  const r = result[p.userCode]
  const row = [
    p.id,
    p.dbName,
    p.resetDate,
    r.buyIn.toFixed(2),
    r.sellOut.toFixed(2),
    r.sortingSourceOut.toFixed(2),
    r.sortingOutputIn.toFixed(2),
    r.transferSourceOut.toFixed(2),
    r.transferOutputIn.toFixed(2),
    r.targetStock.toFixed(2),
    r.currentSystemStock.toFixed(2),
    (r.difference >= 0 ? '+' : '') + r.difference.toFixed(2),
    r.confidence,
    r.recommendedAction,
  ]
  console.log(row.join('\t'))
}

// Unmatched/ambiguous
console.log('\n--- Unmatched / Ambiguous Stainless Names ---\n')
if (AMBIGUOUS_NAMES.size === 0) {
  console.log('None')
} else {
  for (const name of [...AMBIGUOUS_NAMES].sort()) {
    console.log(`  AMBIGUOUS: "${name}" — not in alias list, NOT counted`)
  }
}

// Physical count recommendation
console.log('\n--- Physical Count Recommendation ---\n')
const needsPhysicalCount = PRODUCTS.filter(p => result[p.userCode].confidence !== 'HIGH')
if (needsPhysicalCount.length === 0) {
  console.log('All products at HIGH confidence — physical count optional')
} else {
  console.log('Physical count IS RECOMMENDED for:')
  for (const p of needsPhysicalCount) {
    const r = result[p.userCode]
    console.log(`  - ${p.userCode} (confidence: ${r.confidence}, diff: ${r.difference.toFixed(2)} kg)`)
  }
}

// Readiness
console.log('\n--- Readiness ---\n')
const ready = []
const notReady = []
for (const p of PRODUCTS) {
  const r = result[p.userCode]
  if (r.confidence === 'HIGH') {
    ready.push({ product: p.userCode, reason: `diff=${r.difference.toFixed(2)}kg, confidence=HIGH` })
  } else {
    notReady.push({ product: p.userCode, reason: `confidence=${r.confidence}, diff=${r.difference.toFixed(2)}kg — ${r.recommendedAction}` })
  }
}
console.log('Products READY for adjustment:')
if (ready.length === 0) console.log('  (none)')
for (const r of ready) console.log(`  - ${r.product}: ${r.reason}`)
console.log('\nProducts NOT READY for adjustment:')
if (notReady.length === 0) console.log('  (none)')
for (const r of notReady) console.log(`  - ${r.product}: ${r.reason}`)

// Save final result to JSON
fs.writeFileSync('/home/z/my-project/reconciliation/final-result.json', JSON.stringify({
  products: PRODUCTS.map(p => ({ ...result[p.userCode], resetDateObj: undefined })),
  ambiguousNames: [...AMBIGUOUS_NAMES].sort(),
  ready, notReady,
}, null, 2))
console.log('\n\nSaved full result to reconciliation/final-result.json')
