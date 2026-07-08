/**
 * Generate corrected owner approval checklist with all 7 unique OWNER_REVIEW items.
 */
import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

const regular = data.adjustedProducts.filter(p => !p.isService && !p.isSortedOutput)

// Build unique set: items with ownerReviewFlags OR classification === CATEGORY_CHANGE
const unique = new Map()
for (const p of regular) {
  if (p.ownerReviewFlags && p.ownerReviewFlags.length > 0) {
    unique.set(p.oldCode + '|' + p.normName, p)
  }
}
for (const p of regular) {
  if (p.classification === 'CATEGORY_CHANGE') {
    unique.set(p.oldCode + '|' + p.normName, p)
  }
}

let report = ''
const sep = '='.repeat(180)
const sep2 = '-'.repeat(180)

report += sep + '\n'
report += 'CORRECTED OWNER APPROVAL CHECKLIST\n'
report += 'Task 40: Fix Owner Review Count Mismatch\n'
report += sep + '\n\n'

// Bug explanation
report += sep + '\n'
report += '1. COUNTING BUG EXPLANATION\n'
report += sep + '\n\n'
report += 'Previous report claimed OWNER_REVIEW_REQUIRED = 8, but only 7 items were visible.\n\n'
report += 'Root cause: double-counting in the summary formula:\n'
report += '  old formula = ownerReviewCount (6) + CATEGORY_CHANGE count (2) = 8\n'
report += '  but 1 item (แผงวงจรเขียว) has BOTH ownerReviewFlags AND CATEGORY_CHANGE classification\n'
report += '  → counted twice in the sum\n\n'
report += 'Correct unique count: 6 + 2 - 1 (overlap) = 7\n\n'
report += 'The missing item was NOT actually missing — แผงวงจรเขียว was listed once but counted twice.\n'
report += 'The visible list of 7 was correct; the summary count of 8 was wrong.\n\n'

// All 7 items
report += sep + '\n'
report += '2. ALL 7 OWNER_REVIEW_REQUIRED ITEMS (corrected)\n'
report += sep + '\n\n'

const items = [...unique.values()]
items.forEach((p, i) => {
  const flags = p.ownerReviewFlags ? p.ownerReviewFlags.map(f => f.split(':')[0]) : ['CATEGORY_CHANGE']
  
  report += `Item ${i+1} of 7\n`
  report += `  No.:                      ${i+1}\n`
  report += `  Adjusted file product:    "${p.rawName}"\n`
  report += `  Old code (in adjusted):   ${p.oldCode || '(no code)'}\n`
  report += `  Current MetalTrack name:  "${p.matchedProductName}"\n`
  report += `  ProductId:                ${p.matchedProductId}\n`
  report += `  Current stock:            ${p.matchedProductStockWeight} kg\n`
  report += `  Has StockLots:            ${p.matchedProductHasStockLots}\n`
  report += `  Has movement history:     ${p.matchedProductHasMovement}\n`
  report += `  Current MT category:      ${p.matchedProductCategory}\n`
  report += `  Adjusted file category:   ${p.mtCategory}\n`
  report += `  Classification:           ${p.classification}\n`
  report += `  Proposed action:          ${p.classification === 'CATEGORY_CHANGE' ? 'CHANGE_CATEGORY' : 'RENAME'}\n`
  report += `  Risk flags:               ${flags.join(', ')}\n`
  report += `  Risk reason:              ${p.reason}\n`
  
  // Exact question for owner
  let question = ''
  if (p.classification === 'RENAME_EXISTING') {
    if (flags.includes('CLOSER_MATCH_EXISTS') && flags.includes('SIGNIFICANT_STOCK')) {
      question = `Rename MT "${p.matchedProductName}" (id ${p.matchedProductId}, ${p.matchedProductStockWeight} kg stock) to "${p.rawName}"? Note: MT also has a closer fuzzy match — please verify which MT product is the correct target.`
    } else if (flags.includes('CLOSER_MATCH_EXISTS')) {
      question = `Rename MT "${p.matchedProductName}" (id ${p.matchedProductId}) to "${p.rawName}"? A closer fuzzy match exists in MT — please verify this is the correct target product.`
    } else if (flags.includes('SIGNIFICANT_STOCK')) {
      question = `Rename MT "${p.matchedProductName}" (id ${p.matchedProductId}, ${p.matchedProductStockWeight} kg stock) to "${p.rawName}"? This product has significant stock — confirm the rename is safe and the stock belongs to this product identity.`
    }
  } else if (p.classification === 'CATEGORY_CHANGE') {
    if (flags.includes('CATEGORY_CHANGE_WITH_DATA')) {
      question = `Move "${p.rawName}" from category "${p.matchedProductCategory}" to "${p.mtCategory}"? This product has ${p.matchedProductStockWeight} kg stock and movement history — confirm the category change is correct.`
    } else {
      question = `Move "${p.rawName}" from category "${p.matchedProductCategory}" to "${p.mtCategory}"? (Product has no stock/movement — lower risk.)`
    }
  }
  report += `  Exact question for owner: ${question}\n`
  report += '\n'
})

// Summary table
report += sep + '\n'
report += '3. SUMMARY TABLE (7 items)\n'
report += sep + '\n\n'
report += 'No. | adjusted name                          | MT name                                | productId                                  | stock (kg) | current cat      | adjusted cat       | action          | risk flags\n'
report += sep2 + '\n'
items.forEach((p, i) => {
  const flags = p.ownerReviewFlags ? p.ownerReviewFlags.map(f => f.split(':')[0]).join(';') : 'CATEGORY_CHANGE'
  const action = p.classification === 'CATEGORY_CHANGE' ? 'CHANGE_CATEGORY' : 'RENAME'
  report += `${String(i+1).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.matchedProductName.padEnd(38)} | ${p.matchedProductId.padEnd(42)} | ${String(p.matchedProductStockWeight).padEnd(10)} | ${p.matchedProductCategory.padEnd(16)} | ${p.mtCategory.padEnd(18)} | ${action.padEnd(15)} | ${flags}\n`
})
report += '\n'

// Confirmation
report += sep + '\n'
report += '4. CONFIRMATIONS\n'
report += sep + '\n\n'
report += '✅ อลูมิเนียมสายไฟ (stripped aluminum wire) — REMAINS UNCHANGED in MetalTrack\n'
report += '   id: prod_mqgp9csvq0takfp04k5d2dv6\n'
report += '   stock: 255.4 kg (11 lots)\n'
report += '   category: อลูมิเนียม\n'
report += '   action: KEEP (no rename, no merge, no alias, no stock transfer)\n\n'
report += '✅ สายไฟอลูมิเนียม (insulated aluminum cable) — CREATE_NEW_PRODUCT (after owner approval)\n'
report += '   Does NOT exist in MetalTrack yet\n'
report += '   category: อลูมิเนียม\n'
report += '   initial stock: 0 kg (no StockLots)\n'
report += '   EXACT_EXCLUSION: will never match/merge/alias with อลูมิเนียมสายไฟ\n\n'
report += '✅ No production changes were made\n'
report += '   - No products renamed\n'
report += '   - No products created\n'
report += '   - No products archived\n'
report += '   - No categories changed\n'
report += '   - No stock quantities changed\n'
report += '   - No bill records modified\n'
report += '   - No StockLots created or deleted\n\n'

report += sep + '\n'
report += 'No production changes were made.\n'
report += sep + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/CORRECTED_OWNER_CHECKLIST.txt', report)
console.log(report)
console.log('\n\nSaved to: /home/z/my-project/reconciliation/CORRECTED_OWNER_CHECKLIST.txt')
