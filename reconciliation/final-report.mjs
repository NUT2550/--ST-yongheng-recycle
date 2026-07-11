/**
 * Generate final clean dry-run reconciliation report
 */
import fs from 'fs'

const finalResult = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/final-result.json', 'utf8'))

// Reset date map (display strings)
const RESET_DATES = {
  'สแตนเลส 304': '05/02/2569',
  'สแตนเลส 202': '05/02/2569',
  'สแตนเลสดูดติด': '05/02/2569',
  'สแตนเลส 304 ยาว': '05/02/2569',
  'สแตนเลสติดเหล็ก': '05/02/2569',
  'นิกเกิล': '05/02/2569',
  'ขี้กลึงสแตนเลส 304': '22/01/2569',
}

// Product ID map
const PRODUCT_IDS = {
  'สแตนเลส 304': 'prod_mqgp9caefhv0hs74sfuubrmr',
  'สแตนเลส 202': 'prod_mqgp9cmnidvf2vafwiepqg0d',
  'สแตนเลสดูดติด': 'prod_new_1782125294328_e0b981e0b8aae0b895e0b899',
  'สแตนเลส 304 ยาว': 'prod_mqgp9cgafv9ts0i3ze22h1vb',
  'สแตนเลสติดเหล็ก': 'cmr09vcvi001ml1055umg3jpg',
  'นิกเกิล': 'cmr09vcvi001ol105nmz9gye6',
  'ขี้กลึงสแตนเลส 304': 'cmr09vcvi001ql105usal36bv',
}

const SYSTEM_NAMES = {
  'สแตนเลส 304': 'แสตนเลส 304',
  'สแตนเลส 202': 'แสตนเลส 202',
  'สแตนเลสดูดติด': 'แสตนเลสดูดติด',
  'สแตนเลส 304 ยาว': 'แสตนเลส 304 (ยาว)',
  'สแตนเลสติดเหล็ก': 'แสตนเลสติดเหล็ก',
  'นิกเกิล': 'นิกเกิล(สแตนเลส)',
  'ขี้กลึงสแตนเลส 304': 'ขี้กลึงสแตนเลส304',
}

const orderedKeys = [
  'สแตนเลส 304',
  'สแตนเลส 202',
  'สแตนเลสดูดติด',
  'สแตนเลส 304 ยาว',
  'สแตนเลสติดเหล็ก',
  'นิกเกิล',
  'ขี้กลึงสแตนเลส 304',
]

let report = ''
report += '='.repeat(180) + '\n'
report += 'STAINLESS GROUP STOCK RECONCILIATION — DRY-RUN REPORT\n'
report += '='.repeat(180) + '\n\n'

report += 'DATA SOURCES USED:\n'
report += '  1. Detailed Buy .xls:  ซื้อ 22-1-2569 ถึง 3-7-2569 แบบละเอียด.xls  (5073 transactions, 66 products)\n'
report += '  2. Detailed Sell .xls: ขาย 22-1-2569 ถึง 3-7 2569 แบบละเอียด.xls   (351 transactions, 54 products)\n'
report += '  3. Sorting PDF:        สต๊อกทั้งหมด_คัดแยก_เสียหาย_Google_ชีต.pdf    (68 sorting bills, 6 Jan - 27 Jun 2026)\n'
report += '  4. DB SortingBills from 28/06/2569 onward (4 active, 5 cancelled excluded)\n'
report += '  5. DB StockTransfers from 28/06/2569 onward (1 active, 2 cancelled excluded)\n'
report += '  6. DB StockLot sum per product (currentSystemStock)\n\n'

report += 'ALIASES APPLIED:\n'
report += '  304           → สแตนเลส 304\n'
report += '  202           → สแตนเลส 202\n'
report += '  304ยาว        → สแตนเลส 304 ยาว\n'
report += '  304 ยาว       → สแตนเลส 304 ยาว\n'
report += '  ขี้กลึงสแตนเลส → ขี้กลึงสแตนเลส 304\n'
report += '  (แสตนเลส/สแตนเลส spelling unified — both map to same product)\n\n'

report += 'NO DUPLICATE COUNTING:\n'
report += '  - PDF covers 6 Jan - 27 Jun 2026 (verified: 67 stainless-related bills)\n'
report += '  - DB SortingBills in PDF range (1 Jan - 27 Jun 2026): 127 bills — these DUPLICATE the PDF data (same dates/weights)\n'
report += '  - Per user instruction, DB SortingBills ONLY counted from 28 Jun 2026 onward (no overlap)\n'
report += '  - DB StockTransfers in PDF range: 0 (no overlap)\n\n'

report += 'NOTE ON DATA COVERAGE:\n'
report += '  - Buy .xls is AUTHORITATIVE for buy data (5073 txns cover full period 22 Jan - 3 Jul 2026)\n'
report += '  - Sell .xls is AUTHORITATIVE for sell data (351 txns cover full period)\n'
report += '  - DB BuyBills only contain 10 recent bills (20 Jun - 1 Jul 2026) — INCOMPLETE for recalculation\n'
report += '  - DB SellBills contain 0 stainless sells — INCOMPLETE for recalculation\n'
report += '  - DB SortingBills contain ALL 131 sorting bills (127 migrated from PDF + 4 new)\n'
report += '  - System stock in DB = snapshot from 21/6/2026 (fix-stock.ts) + post-snapshot transactions\n'
report += '    → NOT a cumulative calculation from the reset date\n\n'

report += '='.repeat(180) + '\n'
report += 'PER-PRODUCT RECONCILIATION TABLE\n'
report += '='.repeat(180) + '\n\n'

// Print table header
const cols = [
  ['productId', 50],
  ['system product name', 26],
  ['reset date', 12],
  ['buyIn', 11],
  ['sellOut', 11],
  ['sortSrcOut', 11],
  ['sortOutIn', 11],
  ['trnSrcOut', 10],
  ['trnOutIn', 9],
  ['targetStock', 12],
  ['systemStock', 12],
  ['difference', 12],
  ['confidence', 10],
]
let header = ''
for (const [name, w] of cols) header += name.padEnd(w) + ' '
report += header + '\n'
report += '-'.repeat(header.length) + '\n'

for (const key of orderedKeys) {
  const r = finalResult.products.find(p => p.userCode === key)
  if (!r) continue
  const row = [
    [PRODUCT_IDS[key], 50],
    [SYSTEM_NAMES[key], 26],
    [RESET_DATES[key], 12],
    [r.buyIn.toFixed(2), 11],
    [r.sellOut.toFixed(2), 11],
    [r.sortingSourceOut.toFixed(2), 11],
    [r.sortingOutputIn.toFixed(2), 11],
    [r.transferSourceOut.toFixed(2), 10],
    [r.transferOutputIn.toFixed(2), 9],
    [r.targetStock.toFixed(2), 12],
    [r.currentSystemStock.toFixed(2), 12],
    [(r.difference >= 0 ? '+' : '') + r.difference.toFixed(2), 12],
    [r.confidence, 10],
  ]
  let line = ''
  for (const [val, w] of row) line += String(val).padEnd(w) + ' '
  report += line + '\n'
}

report += '\n' + '='.repeat(180) + '\n'
report += 'PER-PRODUCT DETAIL WITH RECOMMENDED ACTION + NOTE\n'
report += '='.repeat(180) + '\n\n'

for (const key of orderedKeys) {
  const r = finalResult.products.find(p => p.userCode === key)
  if (!r) continue
  report += `PRODUCT: ${key}\n`
  report += `  productId:              ${PRODUCT_IDS[key]}\n`
  report += `  system product name:    ${SYSTEM_NAMES[key]}\n`
  report += `  reset date:             ${RESET_DATES[key]}\n`
  report += `  buyIn (after reset):    ${r.buyIn.toFixed(2)} kg   (${r.buyTxCount} transactions)\n`
  report += `  sellOut (after reset):  ${r.sellOut.toFixed(2)} kg   (${r.sellTxCount} transactions)\n`
  report += `  sortingSourceOut:       ${r.sortingSourceOut.toFixed(2)} kg   (PDF: ${r.sortingSourceOut_pdf.toFixed(2)} + DB: ${r.sortingSourceOut_db.toFixed(2)})\n`
  report += `  sortingOutputIn:        ${r.sortingOutputIn.toFixed(2)} kg   (PDF: ${r.sortingOutputIn_pdf.toFixed(2)} + DB: ${r.sortingOutputIn_db.toFixed(2)})\n`
  report += `  transferSourceOut:      ${r.transferSourceOut.toFixed(2)} kg\n`
  report += `  transferOutputIn:       ${r.transferOutputIn.toFixed(2)} kg\n`
  report += `  ---\n`
  report += `  calculated target stock:  ${r.targetStock.toFixed(2)} kg\n`
  report += `  current system stock:     ${r.currentSystemStock.toFixed(2)} kg\n`
  report += `  difference (target - system): ${(r.difference >= 0 ? '+' : '')}${r.difference.toFixed(2)} kg\n`
  report += `  confidence:               ${r.confidence}\n`
  report += `  recommended action:      ${r.recommendedAction}\n`
  report += `  note:                     ${r.note}\n\n`
}

report += '='.repeat(180) + '\n'
report += 'UNMATCHED / AMBIGUOUS STAINLESS NAMES\n'
report += '='.repeat(180) + '\n\n'
if (finalResult.ambiguousNames.length === 0) {
  report += '  None\n\n'
} else {
  for (const name of finalResult.ambiguousNames) {
    report += `  AMBIGUOUS: "${name}"\n`
    report += `     → Not in alias list (304, 202, 304ยาว, 304 ยาว, ขี้กลึงสแตนเลส)\n`
    report += `     → NOT counted in any product's calculation\n`
    report += `     → Appears in PDF sorting output (1 occurrence, ~3.1 kg)\n`
    report += `     → Owner must clarify: is this "สแตนเลส 304" (short version, distinct from 304ยาว) or a separate product?\n\n`
  }
}

report += '='.repeat(180) + '\n'
report += 'PHYSICAL COUNT RECOMMENDATION\n'
report += '='.repeat(180) + '\n\n'
const needsCount = orderedKeys.filter(k => {
  const r = finalResult.products.find(p => p.userCode === k)
  return r && r.confidence !== 'HIGH'
})
if (needsCount.length === 0) {
  report += '  All products at HIGH confidence — physical count optional.\n\n'
} else {
  report += '  PHYSICAL COUNT IS RECOMMENDED before any adjustment, for:\n\n'
  for (const k of needsCount) {
    const r = finalResult.products.find(p => p.userCode === k)
    report += `    - ${k}\n`
    report += `        confidence: ${r.confidence}\n`
    report += `        difference: ${(r.difference >= 0 ? '+' : '')}${r.difference.toFixed(2)} kg\n`
    report += `        reason:     ${r.recommendedAction}\n\n`
  }
  report += '  Rationale: The .xls files cover 22 Jan - 3 Jul 2026. The DB system stock is a snapshot\n'
  report += '  from 21/6/2026 + post-snapshot transactions — NOT a cumulative calc from the reset date.\n'
  report += '  Large differences are expected because the system stock includes pre-reset stock that\n'
  report += '  is NOT captured by the .xls files (which start 22 Jan 2026, before any reset date).\n\n'
}

report += '='.repeat(180) + '\n'
report += 'PRODUCTS READY FOR ADJUSTMENT\n'
report += '='.repeat(180) + '\n\n'
if (finalResult.ready.length === 0) {
  report += '  (none)\n\n'
} else {
  for (const r of finalResult.ready) {
    report += `  - ${r.product}: ${r.reason}\n`
  }
  report += '\n  These products have either:\n'
  report += '    (a) No stainless transactions in any source after the reset date (target = 0, system = 0)\n'
  report += '    (b) Difference < 1 kg (rounding-level)\n\n'
}

report += '='.repeat(180) + '\n'
report += 'PRODUCTS NOT READY FOR ADJUSTMENT\n'
report += '='.repeat(180) + '\n\n'
if (finalResult.notReady.length === 0) {
  report += '  (none)\n\n'
} else {
  for (const r of finalResult.notReady) {
    report += `  - ${r.product}\n`
    report += `      reason: ${r.reason}\n\n`
  }
  report += '  Common reasons:\n'
  report += '    - System stock is a snapshot from 21/6/2026 (NOT a 0-reset on the reset date)\n'
  report += '    - Buy .xls may be missing pre-22 Jan 2026 buys (file starts 22 Jan 2026)\n'
  report += '    - Negative target stock for some products indicates pre-reset stock existed\n'
  report += '      (mathematically impossible to have negative stock — implies data gap)\n'
  report += '    - Owner should NOT apply these adjustments without:\n'
  report += '        (a) Verifying buy/sell .xls completeness (any pre-22 Jan 2026 transactions?)\n'
  report += '        (b) Performing a physical count to confirm the actual stock\n'
  report += '        (c) Deciding what "reset to 0" means if pre-reset stock existed\n\n'
}

report += '='.repeat(180) + '\n'
report += 'SUMMARY\n'
report += '='.repeat(180) + '\n\n'
const totalBuy = finalResult.products.reduce((s, p) => s + p.buyIn, 0)
const totalSell = finalResult.products.reduce((s, p) => s + p.sellOut, 0)
const totalSortOut = finalResult.products.reduce((s, p) => s + p.sortingOutputIn, 0)
const totalSystemStock = finalResult.products.reduce((s, p) => s + p.currentSystemStock, 0)
const totalTargetStock = finalResult.products.reduce((s, p) => s + p.targetStock, 0)
const totalDiff = finalResult.products.reduce((s, p) => s + p.difference, 0)
report += `  Total buyIn (after reset):           ${totalBuy.toFixed(2)} kg\n`
report += `  Total sellOut (after reset):         ${totalSell.toFixed(2)} kg\n`
report += `  Total sortingOutputIn (after reset): ${totalSortOut.toFixed(2)} kg\n`
report += `  Total target stock (sum):            ${totalTargetStock.toFixed(2)} kg\n`
report += `  Total current system stock (sum):    ${totalSystemStock.toFixed(2)} kg\n`
report += `  Total difference (target - system):  ${(totalDiff >= 0 ? '+' : '')}${totalDiff.toFixed(2)} kg\n\n`

report += `  Products at HIGH confidence:    2 / 7  (สแตนเลสติดเหล็ก, นิกเกิล)\n`
report += `  Products at MEDIUM confidence:  1 / 7  (ขี้กลึงสแตนเลส 304)\n`
report += `  Products at LOW confidence:     4 / 7  (สแตนเลส 304, 202, ดูดติด, 304 ยาว)\n\n`

report += `  Ambiguous stainless names found: 1  ("304สั น" — not in alias list)\n\n`

report += '='.repeat(180) + '\n'
report += 'NO PRODUCTION STOCK CHANGES WERE MADE.\n'
report += '='.repeat(180) + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/DRY_RUN_REPORT.txt', report)
console.log(report)
console.log('\n\nReport saved to: /home/z/my-project/reconciliation/DRY_RUN_REPORT.txt')
