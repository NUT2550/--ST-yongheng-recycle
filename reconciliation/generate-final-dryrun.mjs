import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

let report = ''
const sep = '='.repeat(180)
const sep2 = '-'.repeat(180)

report += sep + '\n'
report += 'DRY-RUN REPORT: Sync MetalTrack Product Master to Adjusted Product List\n'
report += 'Input file: รายการสิ้นต้า_ปรับแล้ว.xls (5/7/2569)\n'
report += 'Status: DRY-RUN ONLY — NO changes applied. Waiting for owner approval.\n'
report += sep + '\n\n'

// TABLE 1: Summary
const regular = data.adjustedProducts.filter(p => !p.isService && !p.isSortedOutput)
const ownerReviewItems = regular.filter(p => p.ownerReviewFlags && p.ownerReviewFlags.length > 0)
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
report += `OWNER_REVIEW_REQUIRED:                     ${ownerReviewItems.length + regular.filter(p => p.classification === 'CATEGORY_CHANGE').length}\n`
report += `COLLISIONS (rename would duplicate):       ${data.collisions.length}\n`
report += `Adjusted-file duplicates:                  ${data.adjustedDuplicates.length}\n\n`

// TABLE 2: Rename plan
report += sep + '\n'
report += 'TABLE 2: RENAME PLAN (preserve existing productId)\n'
report += sep + '\n\n'
const renames = regular.filter(p => p.classification === 'RENAME_EXISTING')
report += 'No. | productId                                          | current MT name                         | adjusted file name                     | current cat  | adjusted cat | action  | conf   | stock (kg) | review flags\n'
report += sep2 + '\n'
renames.forEach((p, i) => {
  const flags = p.ownerReviewFlags ? p.ownerReviewFlags.map(f => f.split(':')[0]).join('; ') : ''
  report += `${String(i+1).padStart(3)} | ${p.matchedProductId.padEnd(50)} | ${p.matchedProductName.padEnd(38)} | ${p.rawName.padEnd(38)} | ${p.matchedProductCategory.padEnd(12)} | ${p.mtCategory.padEnd(12)} | RENAME  | ${p.confidence.padEnd(6)} | ${String(p.matchedProductStockWeight || 0).padEnd(10)} | ${flags}\n`
})
report += '\n'

// TABLE 3: New products to create
report += sep + '\n'
report += 'TABLE 3: NEW PRODUCTS TO CREATE (initial stock = 0 kg, no StockLots)\n'
report += sep + '\n\n'
const newProducts = regular.filter(p => p.classification === 'CREATE_NEW_PRODUCT')
report += 'No. | adjusted product name                 | adjusted category | suggested categoryId                        | initial stock | reason\n'
report += sep2 + '\n'
const catMap = new Map()
for (const p of data.mtProducts) catMap.set(p.categoryName, p.categoryId)
newProducts.forEach((p, i) => {
  const catId = catMap.get(p.mtCategory) || '(need lookup)'
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
  if (p.hasStockLots || p.hasMovement) { action = 'KEEP'; reason = `Has stock/movement — do NOT delete` }
  else { action = 'ARCHIVE'; reason = 'No stock, no movement — safe to archive' }
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
  }
  if (data.collisions.length > 0) {
    report += '--- 5B: Rename collisions ---\n'
    data.collisions.forEach((c, i) => {
      report += `  ${i+1}. "${c.adjustedName}" would collide: MT has "${c.mtProductA.name}" and "${c.mtProductB.name}"\n`
    })
  }
}
report += '\n'

// TABLE 6: Final target product master (summary only)
report += sep + '\n'
report += 'TABLE 6: FINAL TARGET PRODUCT MASTER (summary)\n'
report += sep + '\n\n'
report += `After applying the plan, MetalTrack would have:\n`
report += `  - ${regular.filter(p => p.classification === 'EXACT_MATCH').length} exact matches (no change)\n`
report += `  - ${renames.length} renamed products (preserve productId)\n`
report += `  - ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length} category changes (OWNER REVIEW)\n`
report += `  - ${newProducts.length} new products created (stock = 0)\n`
report += `  - ${data.mtNotInAdjusted.filter(p => !p.hasStockLots && !p.hasMovement).length} products archived (no stock/movement)\n`
report += `  - ${data.mtNotInAdjusted.filter(p => p.hasStockLots || p.hasMovement).length} products kept (have stock/movement)\n`
report += `  Total: ${regular.filter(p => p.classification === 'EXACT_MATCH').length + renames.length + regular.filter(p => p.classification === 'CATEGORY_CHANGE').length + newProducts.length + data.mtNotInAdjusted.length} products\n\n`

// OWNER REVIEW section
report += sep + '\n'
report += '⚠️  ITEMS REQUIRING OWNER REVIEW BEFORE APPLYING\n'
report += sep + '\n\n'
if (ownerReviewItems.length === 0 && regular.filter(p => p.classification === 'CATEGORY_CHANGE').length === 0) {
  report += '(none)\n\n'
} else {
  let idx = 1
  for (const p of ownerReviewItems) {
    report += `${idx}. [${p.oldCode || 'no-code'}] "${p.rawName}" (adjusted, group ${p.groupCode}/${p.mtCategory})\n`
    report += `   Matched to: "${p.matchedProductName}" (${p.matchedProductCategory}) — id ${p.matchedProductId}\n`
    report += `   Stock: ${p.matchedProductStockWeight} kg, Lots: ${p.matchedProductHasStockLots}, Movement: ${p.matchedProductHasMovement}\n`
    for (const f of p.ownerReviewFlags) report += `   ⚠️  ${f}\n`
    report += '\n'
    idx++
  }
  for (const p of regular.filter(p => p.classification === 'CATEGORY_CHANGE' && !p.ownerReviewFlags)) {
    report += `${idx}. [${p.oldCode || 'no-code'}] "${p.rawName}" (adjusted, group ${p.groupCode}/${p.mtCategory})\n`
    report += `   Category change: MT has "${p.matchedProductName}" in "${p.matchedProductCategory}" — adjusted file wants "${p.mtCategory}"\n`
    report += `   Stock: ${p.matchedProductStockWeight} kg, Lots: ${p.matchedProductHasStockLots}, Movement: ${p.matchedProductHasMovement}\n`
    report += `   ⚠️  CATEGORY_CHANGE — owner must confirm\n\n`
    idx++
  }
}

// Approval gate
report += sep + '\n'
report += '⚠️  OWNER APPROVAL GATE — STOP\n'
report += sep + '\n\n'
report += 'NO changes have been applied to MetalTrack production.\n\n'
report += 'To apply the plan above, owner must explicitly say:\n'
report += '"อนุมัติให้ปรับรายการสินค้าใน MetalTrack ตามไฟล์ รายการสิ้นต้า_ปรับแล้ว"\n\n'
report += 'After approval, the following will be applied:\n'
report += `  1. Rename ${renames.length} existing products (preserve productId)\n`
report += `  2. Change category for ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length} products (OWNER REVIEW first)\n`
report += `  3. Create ${newProducts.length} new products (initial stock = 0 kg, no StockLots)\n`
report += `  4. Archive ${data.mtNotInAdjusted.filter(p => !p.hasStockLots && !p.hasMovement).length} MT products (no stock/movement)\n`
report += `  5. Keep ${data.mtNotInAdjusted.filter(p => p.hasStockLots || p.hasMovement).length} MT products (have stock/movement)\n`
report += `  6. NO stock quantities changed\n`
report += `  7. NO bill records modified\n`
report += `  8. NO StockLots created or deleted\n\n`
report += sep + '\n'
report += 'No stock quantities or bill records were modified.\n'
report += sep + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/DRY_RUN_ADJUSTED_REPORT.txt', report)
console.log(report.substring(0, 3000))
console.log('...')
console.log(`\nFull report saved to: /home/z/my-project/reconciliation/DRY_RUN_ADJUSTED_REPORT.txt`)
console.log(`Report length: ${report.length} chars, ${report.split('\n').length} lines`)
