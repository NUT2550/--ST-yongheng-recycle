import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

let report = ''
const sep = '='.repeat(180)
const sep2 = '-'.repeat(180)

report += sep + '\n'
report += 'REVISED DRY-RUN REPORT: Sync MetalTrack Product Master to Adjusted Product List\n'
report += 'Input file: รายการสิ้นต้า_ปรับแล้ว.xls (5/7/2569)\n'
report += 'Revision: v5 — Owner correction (Task 39): สายไฟอลูมิเนียม ≠ อลูมิเนียมสายไฟ\n'
report += 'Status: DRY-RUN ONLY — NO changes applied. Waiting for owner approval.\n'
report += sep + '\n\n'

// Owner correction note
report += sep + '\n'
report += '⚠️  OWNER CORRECTION APPLIED (Task 39)\n'
report += sep + '\n\n'
report += 'The following product pair is now treated as SEPARATE products (EXACT_EXCLUSIONS):\n\n'
for (const ex of data.exactExclusions) {
  report += `  "${ex.name1}"  ⟂  "${ex.name2}"\n`
  report += `  Reason: ${ex.reason}\n\n`
}
report += 'Effect:\n'
report += '  - "สายไฟอลูมิเนียม" (adjusted file) is now CREATE_NEW_PRODUCT (not a rename of อลูมิเนียมสายไฟ)\n'
report += '  - "อลูมิเนียมสายไฟ" (existing MT product, 255.4 kg stock) is KEPT unchanged\n'
report += '  - No stock transfer, no alias, no merge between these two\n\n'

// TABLE 1: Summary
const regular = data.adjustedProducts.filter(p => !p.isService && !p.isSortedOutput)
const ownerReviewItems = regular.filter(p => p.ownerReviewFlags && p.ownerReviewFlags.length > 0)
report += sep + '\n'
report += 'TABLE 1: REVISED SUMMARY\n'
report += sep + '\n\n'
report += `Adjusted file product count:              ${regular.length}\n`
report += `Current MetalTrack product count:          ${data.mtProducts.length}\n`
report += `EXACT_MATCH:                               ${regular.filter(p => p.classification === 'EXACT_MATCH').length}\n`
report += `RENAME_EXISTING:                           ${regular.filter(p => p.classification === 'RENAME_EXISTING').length}  (was 13, now 12 — สายไฟอลูมิเนียม removed)\n`
report += `CATEGORY_CHANGE:                           ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length}\n`
report += `CREATE_NEW_PRODUCT:                        ${regular.filter(p => p.classification === 'CREATE_NEW_PRODUCT').length}  (was 8, now 9 — สายไฟอลูมิเนียม added)\n`
report += `ARCHIVE_OR_IGNORE_OLD_PRODUCT:             ${data.mtNotInAdjusted.length}\n`
report += `DUPLICATE_OR_COLLISION:                    ${regular.filter(p => p.classification === 'DUPLICATE_OR_COLLISION').length}\n`
report += `SERVICE_OR_NON_STOCK:                      ${data.adjustedProducts.filter(p => p.classification === 'SERVICE_OR_NON_STOCK').length}\n`
report += `OWNER_REVIEW_REQUIRED:                     ${ownerReviewItems.length + regular.filter(p => p.classification === 'CATEGORY_CHANGE').length}  (was 9, now 8 — สายไฟอลูมิเนียม removed)\n`
report += `COLLISIONS (rename would duplicate):       ${data.collisions.length}\n`
report += `Adjusted-file duplicates:                  ${data.adjustedDuplicates.length}\n`
report += `EXACT_EXCLUSIONS (owner-locked pairs):     ${data.exactExclusions.length}\n\n`

// TABLE 2: Revised rename plan
report += sep + '\n'
report += 'TABLE 2: REVISED RENAME PLAN (12 products — สายไฟอลูมิเนียม REMOVED)\n'
report += sep + '\n\n'
const renames = regular.filter(p => p.classification === 'RENAME_EXISTING')
report += 'No. | productId                                          | current MT name                         | adjusted file name                     | current cat  | adjusted cat | action  | conf   | stock (kg) | review flags\n'
report += sep2 + '\n'
renames.forEach((p, i) => {
  const flags = p.ownerReviewFlags ? p.ownerReviewFlags.map(f => f.split(':')[0]).join('; ') : ''
  report += `${String(i+1).padStart(3)} | ${p.matchedProductId.padEnd(50)} | ${p.matchedProductName.padEnd(38)} | ${p.rawName.padEnd(38)} | ${p.matchedProductCategory.padEnd(12)} | ${p.mtCategory.padEnd(12)} | RENAME  | ${p.confidence.padEnd(6)} | ${String(p.matchedProductStockWeight || 0).padEnd(10)} | ${flags}\n`
})
report += '\n'
report += 'NOTE: "สายไฟอลูมิเนียม" is NO LONGER in this table. It has been moved to TABLE 3 (CREATE_NEW_PRODUCT).\n'
report += '      "อลูมิเนียมสายไฟ" (existing MT product, 255.4 kg stock) is KEPT unchanged — no rename, no merge.\n\n'

// TABLE 3: Revised new products
report += sep + '\n'
report += 'TABLE 3: REVISED NEW PRODUCTS TO CREATE (9 products — สายไฟอลูมิเนียม ADDED)\n'
report += '(initial stock = 0 kg, no StockLots)\n'
report += sep + '\n\n'
const newProducts = regular.filter(p => p.classification === 'CREATE_NEW_PRODUCT')
report += 'No. | adjusted product name                 | adjusted category | suggested categoryId                        | initial stock | reason\n'
report += sep2 + '\n'
const catMap = new Map()
for (const p of data.mtProducts) catMap.set(p.categoryName, p.categoryId)
newProducts.forEach((p, i) => {
  const catId = catMap.get(p.mtCategory) || '(need lookup)'
  const isNew = p.normName === 'สายไฟอลูมิเนียม' ? ' ⭐ NEW (owner correction)' : ''
  report += `${String(i+1).padStart(3)} | ${p.rawName.padEnd(38)} | ${p.mtCategory.padEnd(17)} | ${catId.padEnd(42)} | 0 kg          | ${p.reason.substring(0, 60)}${isNew}\n`
})
report += '\n'

// TABLE 4: MT not in adjusted (unchanged — อลูมิเนียมสายไฟ is KEPT here)
report += sep + '\n'
report += 'TABLE 4: METALTRACK PRODUCTS NOT IN ADJUSTED FILE (23 — unchanged)\n'
report += '(Includes อลูมิเนียมสายไฟ as KEEP — has 255.4 kg stock, do NOT delete)\n'
report += sep + '\n\n'
report += 'No. | productId                                          | current MT name                         | category     | stock (kg)  | has lots | has movement | recommended action | reason\n'
report += sep2 + '\n'
data.mtNotInAdjusted.forEach((p, i) => {
  let action, reason
  if (p.hasStockLots || p.hasMovement) { action = 'KEEP'; reason = `Has stock/movement — do NOT delete` }
  else { action = 'ARCHIVE'; reason = 'No stock, no movement — safe to archive' }
  const highlight = p.name === 'อลูมิเนียมสายไฟ' ? ' ⭐ OWNER-KEPT' : ''
  report += `${String(i+1).padStart(3)} | ${p.id.padEnd(50)} | ${p.name.padEnd(38)} | ${p.categoryName.padEnd(12)} | ${String(p.stockWeight).padEnd(11)} | ${String(p.hasStockLots).padEnd(8)} | ${String(p.hasMovement).padEnd(12)} | ${action.padEnd(18)} | ${reason}${highlight}\n`
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
      report += `  ${i+1}. "${c.adjustedName}" would collide\n`
    })
  }
}
report += '\n'

// TABLE 6: Final target
report += sep + '\n'
report += 'TABLE 6: FINAL TARGET PRODUCT MASTER (revised)\n'
report += sep + '\n\n'
report += `After applying the revised plan, MetalTrack would have:\n`
report += `  - ${regular.filter(p => p.classification === 'EXACT_MATCH').length} exact matches (no change)\n`
report += `  - ${renames.length} renamed products (preserve productId)  [was 13, now 12]\n`
report += `  - ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length} category changes (OWNER REVIEW)\n`
report += `  - ${newProducts.length} new products created (stock = 0)  [was 8, now 9 — includes สายไฟอลูมิเนียม]\n`
report += `  - ${data.mtNotInAdjusted.filter(p => !p.hasStockLots && !p.hasMovement).length} products archived (no stock/movement)\n`
report += `  - ${data.mtNotInAdjusted.filter(p => p.hasStockLots || p.hasMovement).length} products kept (have stock/movement) — includes อลูมิเนียมสายไฟ (255.4 kg)\n`
report += `  Total: ${regular.filter(p => p.classification === 'EXACT_MATCH').length + renames.length + regular.filter(p => p.classification === 'CATEGORY_CHANGE').length + newProducts.length + data.mtNotInAdjusted.length} products  [was 125, now 126 — +1 for สายไฟอลูมิเนียม as separate product]\n\n`

// Confirmation section
report += sep + '\n'
report += '✅ CONFIRMATION: สายไฟอลูมิเนียม and อลูมิเนียมสายไฟ are SEPARATE products\n'
report += sep + '\n\n'
report += '1. "อลูมิเนียมสายไฟ" (stripped aluminum wire, pure aluminum)\n'
report += '   - EXISTS in MetalTrack: id prod_mqgp9csvq0takfp04k5d2dv6\n'
report += '   - Category: อลูมิเนียม\n'
report += '   - Stock: 255.4 kg (11 lots) — has stock AND movement history\n'
report += '   - Action: KEEP unchanged (not in adjusted file, but has stock → KEEP per safety rules)\n'
report += '   - NO rename, NO merge, NO alias, NO stock transfer\n\n'
report += '2. "สายไฟอลูมิเนียม" (insulated aluminum cable, with rubber/plastic sheath)\n'
report += '   - Does NOT exist in MetalTrack (verified via exact name search)\n'
report += '   - Classification: CREATE_NEW_PRODUCT\n'
report += '   - Category: อลูมิเนียม\n'
report += '   - Initial stock: 0 kg (no StockLots)\n'
report += '   - Action: Create as new product after owner approval\n\n'
report += '3. EXACT_EXCLUSIONS list now contains this pair — they will NEVER be matched/merged/aliased\n'
report += '   by the product-sync logic, even if fuzzy/contains similarity is high.\n\n'

// Revised owner review
report += sep + '\n'
report += '⚠️  REVISED ITEMS REQUIRING OWNER REVIEW (8 — was 9, สายไฟอลูมิเนียม removed)\n'
report += sep + '\n\n'
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

// Approval gate
report += sep + '\n'
report += '⚠️  OWNER APPROVAL GATE — STOP\n'
report += sep + '\n\n'
report += 'NO changes have been applied to MetalTrack production.\n\n'
report += 'To apply the revised plan, owner must explicitly say:\n'
report += '"อนุมัติให้ปรับรายการสินค้าใน MetalTrack ตามไฟล์ รายการสิ้นต้า_ปรับแล้ว"\n\n'
report += 'After approval, the following will be applied:\n'
report += `  1. Rename ${renames.length} existing products (preserve productId) — สายไฟอลูมิเนียม NOT included\n`
report += `  2. Change category for ${regular.filter(p => p.classification === 'CATEGORY_CHANGE').length} products (OWNER REVIEW first)\n`
report += `  3. Create ${newProducts.length} new products (initial stock = 0 kg, no StockLots) — INCLUDES สายไฟอลูมิเนียม\n`
report += `  4. Archive ${data.mtNotInAdjusted.filter(p => !p.hasStockLots && !p.hasMovement).length} MT products (no stock/movement)\n`
report += `  5. Keep ${data.mtNotInAdjusted.filter(p => p.hasStockLots || p.hasMovement).length} MT products (have stock/movement) — INCLUDES อลูมิเนียมสายไฟ (255.4 kg)\n`
report += `  6. NO stock quantities changed\n`
report += `  7. NO bill records modified\n`
report += `  8. NO StockLots created or deleted\n`
report += `  9. สายไฟอลูมิเนียม (insulated) and อลูมิเนียมสายไฟ (stripped) remain SEPARATE products\n\n`
report += sep + '\n'
report += 'No production changes were made.\n'
report += sep + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/DRY_RUN_ADJUSTED_REPORT_V5.txt', report)
console.log(report.substring(0, 4000))
console.log('...')
console.log(`\nFull revised report saved to: /home/z/my-project/reconciliation/DRY_RUN_ADJUSTED_REPORT_V5.txt`)
console.log(`Report length: ${report.length} chars, ${report.split('\n').length} lines`)
