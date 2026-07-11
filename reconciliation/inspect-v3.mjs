import fs from 'fs'
const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/comparison-results-v3.json', 'utf8'))

console.log('=== REMAINING UNMATCHED (regular products) ===')
for (const p of data.oldProducts) {
  if (p.isService || p.isSortedOutput) continue
  if (p.matchStatus === 'UNMATCHED') {
    console.log(`  [${p.oldCode}] ${p.rawName} (group ${p.groupCode}/${p.groupName}, cat ${p.mtCategory})`)
    console.log(`     type=${p.problemType}, action=${p.recommendedAction}, conf=${p.confidence}`)
    console.log(`     reason: ${p.reason}`)
    if (p.candidates) {
      for (const c of p.candidates.slice(0, 2)) {
        console.log(`     candidate: ${c.productName} (${c.categoryName}) ${(c.similarity*100).toFixed(0)}% — ${c.similarityReason}`)
      }
    }
  }
}

console.log('\n=== REMAINING UNMATCHED (sorted-output) ===')
for (const p of data.oldProducts) {
  if (!p.isSortedOutput) continue
  if (p.matchStatus === 'UNMATCHED') {
    console.log(`  [${p.oldCode}] ${p.rawName} (orig group ${p.originalGroupCode}/${p.originalGroupName})`)
    console.log(`     type=${p.problemType}, action=${p.recommendedAction}, conf=${p.confidence}`)
    console.log(`     reason: ${p.reason}`)
    if (p.candidates) {
      for (const c of p.candidates.slice(0, 2)) {
        console.log(`     candidate: ${c.productName} (${c.categoryName}) ${(c.similarity*100).toFixed(0)}% — ${c.similarityReason}`)
      }
    }
  }
}

console.log('\n=== MT NEAR-DUPLICATES (>=85%) ===')
for (const d of data.mtNearDupes) {
  console.log(`  "${d.aName}" (${d.aCategory}) ↔ "${d.bName}" (${d.bCategory}) — ${(d.similarity*100).toFixed(0)}% — ${d.similarityReason}`)
}

console.log('\n=== OLD/SOURCE DUPLICATE GROUPS ===')
for (const g of data.oldDuplicateGroups) {
  console.log(`  "${g.name}" × ${g.entries.length}:`)
  for (const e of g.entries) {
    console.log(`     [${e.oldCode}] group ${e.groupCode}/${e.groupName} → status: ${e.matchStatus}`)
  }
}

console.log('\n=== NICKEL OVERRIDE ENTRIES ===')
for (const p of data.oldProducts) {
  if (p.nickelOverride) {
    console.log(`  [${p.oldCode}] ${p.rawName} (group ${p.groupCode}) → status=${p.matchStatus}, matched=${p.matchedProductName || 'IGNORED'}`)
    console.log(`     reason: ${p.reason}`)
  }
}
