/**
 * Find ALL items that should be in OWNER_REVIEW_REQUIRED.
 * The summary formula was: ownerReviewCount + CATEGORY_CHANGE count
 * But this DOUBLE-COUNTS items that have BOTH ownerReviewFlags AND CATEGORY_CHANGE classification.
 */
import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

const regular = data.adjustedProducts.filter(p => !p.isService && !p.isSortedOutput)

console.log('=== ALL items with ownerReviewFlags ===')
const withFlags = regular.filter(p => p.ownerReviewFlags && p.ownerReviewFlags.length > 0)
for (const p of withFlags) {
  console.log(`  [${p.oldCode || 'no-code'}] "${p.rawName}" — ${p.classification}`)
  console.log(`     flags: ${p.ownerReviewFlags.map(f => f.split(':')[0]).join(', ')}`)
}
console.log(`Total with flags: ${withFlags.length}`)

console.log('\n=== ALL items with classification === CATEGORY_CHANGE ===')
const catChanges = regular.filter(p => p.classification === 'CATEGORY_CHANGE')
for (const p of catChanges) {
  console.log(`  [${p.oldCode || 'no-code'}] "${p.rawName}" — ${p.classification}`)
  console.log(`     flags: ${p.ownerReviewFlags ? p.ownerReviewFlags.map(f => f.split(':')[0]).join(', ') : '(none)'}`)
}
console.log(`Total CATEGORY_CHANGE: ${catChanges.length}`)

console.log('\n=== OVERLAP (items with BOTH) ===')
const overlap = regular.filter(p => p.classification === 'CATEGORY_CHANGE' && p.ownerReviewFlags && p.ownerReviewFlags.length > 0)
for (const p of overlap) {
  console.log(`  [${p.oldCode || 'no-code'}] "${p.rawName}" — DOUBLE-COUNTED in old formula`)
}
console.log(`Total overlap: ${overlap.length}`)

console.log('\n=== CORRECT UNIQUE COUNT ===')
// Union: items with flags OR CATEGORY_CHANGE
const unique = new Map()
for (const p of withFlags) unique.set(p.oldCode + '|' + p.normName, p)
for (const p of catChanges) unique.set(p.oldCode + '|' + p.normName, p)
console.log(`Unique OWNER_REVIEW items: ${unique.size}`)

console.log('\n=== BUG EXPLANATION ===')
console.log(`Old formula: ownerReviewCount (${withFlags.length}) + CATEGORY_CHANGE count (${catChanges.length}) = ${withFlags.length + catChanges.length}`)
console.log(`But ${overlap.length} item(s) have BOTH → double-counted`)
console.log(`Correct count: ${withFlags.length} + ${catChanges.length} - ${overlap.length} = ${withFlags.length + catChanges.length - overlap.length}`)
console.log(`OR equivalently: unique set size = ${unique.size}`)

console.log('\n=== ALL UNIQUE OWNER_REVIEW ITEMS (corrected) ===')
let idx = 1
for (const p of unique.values()) {
  console.log(`  ${idx}. [${p.oldCode || 'no-code'}] "${p.rawName}"`)
  console.log(`     classification: ${p.classification}`)
  console.log(`     matched MT: "${p.matchedProductName}" (${p.matchedProductCategory}) — id ${p.matchedProductId}`)
  console.log(`     stock: ${p.matchedProductStockWeight} kg, lots: ${p.matchedProductHasStockLots}, movement: ${p.matchedProductHasMovement}`)
  console.log(`     adjusted category: ${p.mtCategory}`)
  console.log(`     flags: ${p.ownerReviewFlags ? p.ownerReviewFlags.map(f => f.split(':')[0]).join(', ') : '(CATEGORY_CHANGE only)'}`)
  idx++
}
