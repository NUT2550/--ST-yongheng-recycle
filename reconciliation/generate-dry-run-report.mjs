import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

let report = ''
const sep = '='.repeat(180)
const sep2 = '-'.repeat(180)

report += sep + '\n'
report += 'DRY-RUN REPORT: Sync MetalTrack Product Master to Adjusted Product List\n'
report += 'Input file: รายการสิ้นต้า_ปรับแล้ว.xls\n'
report += 'Status: DRY-RUN ONLY — NO changes applied. Waiting for owner approval.\n'
report += sep + '\n\n'

// TABLE 1: Summary
const regular = data.adjustedProducts.filter(p => !p.isService && !p.isSortedOutput)
report += sep + '\n'
report += 'TABLE 1: SUMMARY\n'
report += sep + '\n\n'
report += `Adjusted file product count:              ${regular.length}\n`
report += `Current MetalTrack product count:          ${data.mtProducts.length}\n`
report += `EXACT_MATCH:                               ${regular.filter(p => p.classification === 'EXACT_MATCH').length}\n`
report += `RENAME_EXISTING:                           ${regular.filter(p => p.classification === 'RENAME_EXISTING').length}\n`
report += `CATEGORY_CHANGE:                           ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length}\n`
report += `CREATE_NEW_PRODUCT:                        ${regular.filter(p => p.classification === 'CREATE_NEW_PRODUCT').length}\n`
report += `ARCHIVE_OR_IGNORE_OLD_PRODUCT:             ${data.mtNotInAdjusted.length}\n`
report += `DUPLICATE_OR_COLLISION:                    ${regular.filter(p => p.classification === 'DUPLICATE_OR_COLLISION').length}\n`
report += `SERVICE_OR_NON_STOCK:                      ${data.adjustedProducts.filter(p => p.classification === 'SERVICE_OR_NON_STOCK').length}\n`
report += `OWNER_REVIEW_REQUIRED:                     ${regular.filter(p => p.confidence === 'low' || p.classification === 'CATEGORY_CHANGE').length}\n`
report += `COLLISIONS (rename would duplicate):       ${data.collisions.length}\n`
report += `Adjusted-file duplicates:                  ${data.adjustedDuplicates.length}\n\n`

// TABLE 2: Rename plan
report += sep + '\n'
report += 'TABLE 2: RENAME PLAN (preserve existing productId)\n'
report += sep + '\n\n'
const renames = regular.filter(p => p.classification === 'RENAME_EXISTING')
report += 'No. | productId                                          | current MT name                         | adjusted file name                     | current cat  | adjusted cat | action  | conf   | reason\n'
report += sep2 + '\n'
renames.forEach((p, i) => {
  report += `${String(i+1).padStart(3)} | ${p.matchedProductId.padEnd(50)} | ${p.matchedProductName.padEnd(38)} | ${p.rawName.padEnd(38)} | ${p.matchedProductCategory.padEnd(12)} | ${p.mtCategory.padEnd(12)} | RENAME  | ${p.confidence.padEnd(6)} | ${p.reason}\n`
})
report += '\n'

// TABLE 3: New products to create
report += sep + '\n'
report += 'TABLE 3: NEW PRODUCTS TO CREATE (initial stock = 0 kg, no StockLots)\n'
report += sep + '\n\n'
const newProducts = regular.filter(p => p.classification === 'CREATE_NEW_PRODUCT')
report += 'No. | adjusted product name                 | adjusted category | suggested categoryId                        | initial stock | reason\n'
report += sep2 + '\n'
// Find category IDs
const catMap = new Map()
for (const p of data.mtProducts) catMap.set(p.categoryName, p.categoryId)
newProducts.forEach((p, i) => {
  const catId = catMap.get(p.mtCategory) || '(need to look up)'
  report += `${String(i+1).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.mtCategory.padEnd(17)} | ${catId.padEnd(42)} | 0 kg          | ${p.reason}\n`
})
report += '\n'

// TABLE 4: MT products not in adjusted file
report += sep + '\n'
report += 'TABLE 4: METALTRACK PRODUCTS NOT IN ADJUSTED FILE\n'
report += '(Do NOT delete products with stock or movement history)\n'
report += sep + '\n\n'
report += 'No. | productId                                          | current MT name                         | category     | stock (kg)  | has lots | has movement | recommended action | reason\n'
report += sep2 + '\n'
data.mtNotInAdjusted.forEach((p, i) => {
  let action, reason
  if (p.hasStockLots || p.hasMovement) {
    action = 'KEEP'
    reason = `Has ${p.hasStockLots ? 'stock' : ''}${p.hasStockLots && p.hasMovement ? ' + ' : ''}${p.hasMovement ? 'movement history' : ''} — do NOT delete/archive`
  } else {
    action = 'ARCHIVE'
    reason = 'No stock, no movement — safe to archive/deactivate (if schema supports)'
  }
  report += `${String(i+1).padStart(3)} | ${p.id.padEnd(50)} | ${p.name.padEnd(38)} | ${p.categoryName.padEnd(12)} | ${String(p.stockWeight).padEnd(11)} | ${String(p.hasStockLots).padEnd(8)} | ${String(p.hasMovement).padEnd(12)} | ${action.padEnd(18)} | ${reason}\n`
})
report += '\n'

// TABLE 5: Duplicates / collisions
report += sep + '\n'
report += 'TABLE 5: DUPLICATES / COLLISIONS\n'
report += sep + '\n\n'
if (data.adjustedDuplicates.length === 0 && data.collisions.length === 0) {
  report += 'No duplicates or collisions detected.\n\n'
} else {
  if (data.adjustedDuplicates.length > 0) {
    report += '--- 5A: Adjusted file duplicates ---\n'
    data.adjustedDuplicates.forEach((d, i) => {
      report += `  ${i+1}. Name: "${d.name}" appears ${d.entries.length}x:\n`
      d.entries.forEach(e => report += `     [${e.oldCode || 'no-code'}] group ${e.groupCode}/${e.groupName} (row ${e.rowIdx})\n`)
    })
    report += '\n'
  }
  if (data.collisions.length > 0) {
    report += '--- 5B: Rename collisions (would create duplicate name) ---\n'
    data.collisions.forEach((c, i) => {
      report += `  ${i+1}. Adjusted name: "${c.adjustedName}"\n`
      report += `     MT product A (rename target): ${c.mtProductA.name} (${c.mtProductA.category}) — id ${c.mtProductA.id}\n`
      report += `     MT product B (would collide): ${c.mtProductB.name} (${c.mtProductB.category}) — id ${c.mtProductB.id}\n`
    })
    report += '\n'
  }
}

// TABLE 6: Final target product master
report += sep + '\n'
report += 'TABLE 6: FINAL TARGET PRODUCT MASTER (after applying plan)\n'
report += sep + '\n\n'
report += 'No. | final product name                     | final category    | source row/code | action needed       | productId (if existing)\n'
report += sep2 + '\n'
let idx = 1
// Exact matches
for (const p of regular.filter(p => p.classification === 'EXACT_MATCH')) {
  report += `${String(idx++).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.mtCategory.padEnd(17)} | ${p.oldCode || 'no-code'}       | EXACT (no change)   | ${p.matchedProductId}\n`
}
// Renames
for (const p of renames) {
  report += `${String(idx++).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.mtCategory.padEnd(17)} | ${p.oldCode || 'no-code'}       | RENAME              | ${p.matchedProductId}\n`
}
// Category changes
for (const p of regular.filter(p => p.classification === 'CATEGORY_CHANGE')) {
  report += `${String(idx++).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.mtCategory.padEnd(17)} | ${p.oldCode || 'no-code'}       | CATEGORY_CHANGE     | ${p.matchedProductId} (OWNER REVIEW)\n`
}
// New products
for (const p of newProducts) {
  report += `${String(idx++).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.mtCategory.padEnd(17)} | ${p.oldCode || 'no-code'}       | CREATE_NEW          | (new — will be assigned)\n`
}
// MT products being kept (not in adjusted file)
for (const p of data.mtNotInAdjusted) {
  const action = p.hasStockLots || p.hasMovement ? 'KEEP (has stock/movement)' : 'ARCHIVE'
  report += `${String(idx++).padStart(3)} | ${p.name.padEnd(38)} | ${p.categoryName.padEnd(17)} | (MT only)       | ${action.padEnd(19)} | ${p.id}\n`
}
report += '\n'

// Owner approval gate
report += sep + '\n'
report += '⚠️  OWNER APPROVAL GATE — STOP\n'
report += sep + '\n\n'
report += 'NO changes have been applied to MetalTrack production.\n\n'
report += 'To apply the plan above, owner must explicitly say:\n'
report += '"อนุมัติให้ปรับรายการสินค้าใน MetalTrack ตามไฟล์ รายการสิ้นต้า_ปรับแล้ว"\n\n'
report += 'After approval, the following will be applied:\n'
report += `  1. Rename ${renames.length} existing products (preserve productId)\n`
report += `  2. Change category for ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length} products (OWNER REVIEW required first)\n`
report += `  3. Create ${newProducts.length} new products (initial stock = 0 kg, no StockLots)\n`
report += `  4. Archive/keep ${data.mtNotInAdjusted.length} MT products not in adjusted file\n`
report += `  5. NO stock quantities changed\n`
report += `  6. NO bill records modified\n`
report += `  7. NO StockLots created or deleted\n\n`
report += 'Items requiring OWNER REVIEW before applying:\n'
const ownerReview = regular.filter(p => p.classification === 'CATEGORY_CHANGE' || p.confidence === 'low')
if (ownerReview.length === 0) {
  report += '  (none)\n'
} else {
  for (const p of ownerReview) {
    report += `  - [${p.oldCode || 'no-code'}] "${p.rawName}" → ${p.classification} — ${p.reason}\n`
  }
}
report += '\n'

report += sep + '\n'
report += 'No stock quantities or bill records were modified.\n'
report += sep + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/DRY_RUN_ADJUSTED_REPORT.txt', report)
console.log(report.substring(0, 2000))
console.log('...')
console.log(`\nFull report saved to: /home/z/my-project/reconciliation/DRY_RUN_ADJUSTED_REPORT.txt`)
console.log(`Report length: ${report.length} chars, ${report.split('\n').length} lines`)
