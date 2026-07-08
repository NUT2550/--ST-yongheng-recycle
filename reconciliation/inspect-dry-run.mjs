import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

console.log('=== RENAME_EXISTING (13) ===')
for (const p of data.adjustedProducts.filter(p => p.classification === 'RENAME_EXISTING')) {
  console.log(`  [${p.oldCode || 'no-code'}] adjusted: "${p.rawName}" (group ${p.groupCode}/${p.mtCategory})`)
  console.log(`     MT: "${p.matchedProductName}" (${p.matchedProductCategory}) — id ${p.matchedProductId}`)
  console.log(`     stock: ${p.matchedProductStockWeight} kg, lots: ${p.matchedProductHasStockLots}, movement: ${p.matchedProductHasMovement}`)
  console.log(`     conf: ${p.confidence} — ${p.reason}`)
}
console.log('\n=== CATEGORY_CHANGE (2) ===')
for (const p of data.adjustedProducts.filter(p => p.classification === 'CATEGORY_CHANGE')) {
  console.log(`  [${p.oldCode || 'no-code'}] adjusted: "${p.rawName}" (group ${p.groupCode}/${p.mtCategory})`)
  console.log(`     MT: "${p.matchedProductName}" (${p.matchedProductCategory}) — id ${p.matchedProductId}`)
  console.log(`     stock: ${p.matchedProductStockWeight} kg, lots: ${p.matchedProductHasStockLots}, movement: ${p.matchedProductHasMovement}`)
  console.log(`     reason: ${p.reason}`)
}
console.log('\n=== CREATE_NEW_PRODUCT (8) ===')
for (const p of data.adjustedProducts.filter(p => p.classification === 'CREATE_NEW_PRODUCT')) {
  console.log(`  [${p.oldCode || 'no-code'}] "${p.rawName}" (group ${p.groupCode}/${p.mtCategory}) — ${p.reason}`)
}
console.log('\n=== ARCHIVE_OR_IGNORE (MT not in adjusted, 24) ===')
for (const p of data.mtNotInAdjusted) {
  const action = p.hasStockLots || p.hasMovement ? 'KEEP (has stock/movement)' : 'ARCHIVE (no stock/movement)'
  console.log(`  ${p.id} | "${p.name}" (${p.categoryName})`)
  console.log(`     stock: ${p.stockWeight} kg, lots: ${p.stockLotCount}, movement: ${p.hasMovement} → ${action}`)
  if (p.hasMovement) console.log(`     movement: ${JSON.stringify(p.movementCounts)}`)
}
