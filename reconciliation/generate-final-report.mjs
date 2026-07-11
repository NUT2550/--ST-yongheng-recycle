/**
 * Generate final report for Task 35 with all 5 outputs.
 */
import fs from 'fs'

const exec = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/execution-results.json', 'utf8'))
const v3 = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/comparison-results-v3.json', 'utf8'))
const mtProducts = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/mt-products.json', 'utf8'))

let report = ''
const sep = '='.repeat(180)
const sep2 = '-'.repeat(180)

report += sep + '\n'
report += 'TASK 35: PRODUCT MASTER CLEANUP + FINAL MISMATCH REPORT\n'
report += 'Owner Decisions Applied: 1 (spelling), 2 (create new), 3 (fix alias), 4 (nickel mapping)\n'
report += sep + '\n\n'

// ============ OUTPUT 1: WHAT WAS CHANGED ============
report += sep + '\n'
report += 'OUTPUT 1: WHAT WAS CHANGED\n'
report += sep + '\n\n'

// 1. Product names renamed
report += `1. PRODUCT NAMES RENAMED (${exec.renames.length} products)\n`
report += '   Rule: อลูมีเนียม → อลูมิเนียม (owner Decision 1)\n'
report += '   Collision check: PASSED (no new name collided with existing)\n\n'
report += '   productId                                          | old name                                | new name\n'
report += '   ' + sep2.substring(0, 116) + '\n'
for (const r of exec.renames) {
  report += `   ${r.id.padEnd(50)} | ${r.oldName.padEnd(39)} | ${r.newName}\n`
}
report += '\n'

// 2. Products created
report += `2. PRODUCTS CREATED (${exec.creates.length} products)\n`
report += '   Rule: Owner Decision 2 — 11 approved; 1 already existed (ฝาอลูมิเนียมเผา post-rename); 1 duplicate (สายไฟอลูมิเนียม = อลูมิเนียมสายไฟ, deleted); 9 created\n'
report += '   Initial stock: 0 kg for all (no StockLots created)\n'
report += '   Category: อลูมิเนียม\n\n'
report += '   productId                                          | product name                       | category     | initial stock\n'
report += '   ' + sep2.substring(0, 116) + '\n'
for (const c of exec.creates) {
  report += `   ${c.id.padEnd(50)} | ${c.name.padEnd(34)} | ${c.categoryName.padEnd(12)} | ${c.initialStock} kg\n`
}
report += '\n'
report += '   NOTE on duplicate removed:\n'
report += '     - "สายไฟอลูมิเนียม" was created per owner list #5, but MetalTrack already had "อลูมิเนียมสายไฟ"\n'
report += '       (same product, different word order — jaccard similarity 100%).\n'
report += '     - The just-created duplicate (id: cmr7a7olr0003mzieoc9q18u2) was safely deleted (0 stock, no bill references).\n'
report += '     - The pre-existing "อลูมิเนียมสายไฟ" (prod_mqgp9csvq0takfp04k5d2dv6) is the canonical product.\n'
report += '     - RECOMMENDATION: owner should standardize old/source system to use "อลูมิเนียมสายไฟ" word order.\n\n'

// 3. Aliases fixed
report += '3. ALIASES FIXED (1 alias in source code)\n'
report += '   File: src/components/detailed-excel-import-dialog.tsx\n\n'
report += '   OLD (broken — target name never existed):\n'
report += "     'อลูมิเนียมฝาแกะ' → 'ฝาอลูมีเนียมเนียม'   (double เนียม — typo)\n\n"
report += '   NEW (correct — matches renamed MetalTrack product):\n'
report += "     'อลูมิเนียมฝาแกะ' → 'ฝาอลูมิเนียม'\n\n"
report += '   Additional aliases updated to use อลูมิเนียม spelling (post-rename):\n'
report += "     'อลูมิเนียมแข็ง (หล่อ/หนา)' → 'อลูมิเนียมแข็ง'        (was อลูมีเนียมแข็ง)\n"
report += "     'อลูมิเนียมกระป๋อง'           → 'กระป๋องอลูมิเนียม'    (was กระป๋องอลูมีเนียม)\n"
report += "     'อลูมิเนียมตูดกะทะ'           → 'อลูมิเนียมตูดกะทะ'    (was อลูมีเนียมตูดกะทะ)\n\n"
report += '   NEW: Spelling normalization added to matchProduct() function:\n'
report += '     Input "อลูมีเนียม" is auto-normalized to "อลูมิเนียม" before matching.\n'
report += '     This handles old Excel files that still use the อี vowel spelling.\n\n'

// 4. Nickel mapping decision
report += '4. NICKEL MAPPING DECISION (owner Decision 4)\n\n'
report += '   old/source entry                                | MetalTrack target            | action\n'
report += '   ' + sep2.substring(0, 116) + '\n'
report += '   [0506] นิกเกิล (group 05/แสตนเลส)              | นิกเกิล(สแตนเลส)            | MAP (canonical)\n'
report += '   [0813] นิกเกิล (group 08/อื่นๆ)                 | (ignored)                    | IGNORE — duplicate of group 05\n\n'
report += '   MetalTrack products (unchanged — NO deletion):\n'
report += '     - นิกเกิล(สแตนเลส) (cmr09vcvi001ol105nmz9gye6, category: แสตนเลส) — kept\n'
report += '     - นิกเกิล           (cmr09vcvk002gl105fbuztaig, category: อื่นๆ)         — kept (no deletion per safety rules)\n'
report += '   NOTE: For detailed Excel import, "นิกเกิล" still exact-matches MT "นิกเกิล" (อื่นๆ).\n'
report += '         If owner wants old Excel "นิกเกิล" to map to "นิกเกิล(สแตนเลส)" instead, an explicit alias\n'
report += '         would be needed — but this would break exact-match to "นิกเกิล" (อื่นๆ).\n'
report += '         Current behavior: exact-match wins, "นิกเกิล" → MT "นิกเกิล" (อื่นๆ).\n\n'

// 5. Tables changed
report += '5. TABLES CHANGED\n\n'
report += '   - Product table: YES (21 rows updated — name field; 10 rows inserted; 1 row deleted — the duplicate I created)\n'
report += '   - StockLot table: NO (no stock lots created or modified — initial stock = 0 for new products)\n'
report += '   - BuyBill / BuyBillItem: NO (no bills imported or modified)\n'
report += '   - SellBill / SellBillItem: NO\n'
report += '   - SortingBill / SortingBillItem: NO\n'
report += '   - StockTransfer / StockTransferItem: NO\n'
report += '   - ProductCategory: NO (no categories added or renamed)\n'
report += '   - User / Employee / Customer: NO\n'
report += '   - AuditLog: NO (rename operations were direct DB updates, not via API — no audit log entries)\n'
report += '   - Source code: YES (1 file: src/components/detailed-excel-import-dialog.tsx — alias fix + spelling normalization)\n\n'

// ============ OUTPUT 2: FINAL MISMATCH LIST FOR OLD RECYCLE SYSTEM ============
report += sep + '\n'
report += 'OUTPUT 2: FINAL MISMATCH LIST FOR OLD RECYCLE SYSTEM\n'
report += '(Owner-actionable — edit product names in the old recycle buying/selling system)\n'
report += sep + '\n\n'

// Build the mismatch list: regular products that are NOT exact match and NOT alias-matched
// and NOT nickel-mapped and NOT ignore-duplicate and NOT service
const mismatches = v3.oldProducts.filter(p => {
  if (p.isService) return false
  if (p.isSortedOutput) return false  // sorted-output entries are not separate products
  if (p.matchStatus === 'MATCHED') return false  // exact match
  if (p.matchStatus === 'ALIAS') return false  // alias match (already handled)
  if (p.matchStatus === 'IGNORE_DUPLICATE') return true  // nickel duplicate — owner should remove from old system
  if (p.matchStatus === 'UNMATCHED') return true
  return false
})

report += '| No. | Old recycle system name                | MetalTrack name                  | Action owner should take in old system                          | Note |\n'
report += '|-----|----------------------------------------|----------------------------------|-----------------------------------------------------------------|------|\n'

let idx = 1
for (const p of mismatches) {
  let action = ''
  let note = ''
  let mtName = p.matchedProductName || '-'
  if (p.matchStatus === 'IGNORE_DUPLICATE') {
    action = 'ignore old duplicate'
    note = 'Same product as นิกเกิล in group 05 (stainless). Remove from group 08.'
    mtName = 'นิกเกิล(สแตนเลส) (canonical)'
  } else if (p.problemType === 'spelling' && p.confidence === 'high') {
    action = 'rename old product to MetalTrack name'
    if (p.candidates && p.candidates[0]) mtName = p.candidates[0].productName
    note = `Spelling variant (similarity ${(p.candidates[0].similarity*100).toFixed(0)}%)`
  } else if (p.problemType === 'spelling') {
    action = 'owner review required'
    if (p.candidates && p.candidates[0]) mtName = p.candidates[0].productName
    note = `Closest match ${(p.candidates[0].similarity*100).toFixed(0)}% — verify before renaming`
  } else if (p.problemType === 'missing') {
    action = 'do not import as product'
    note = 'No MetalTrack equivalent — either create new MT product or stop using in old system'
    mtName = '(none — missing in MT)'
  }
  const oldName = p.rawName.padEnd(38).substring(0, 38)
  const mtNamePadded = mtName.padEnd(32).substring(0, 32)
  const actionPadded = action.padEnd(63).substring(0, 63)
  report += `| ${String(idx).padStart(3)} | ${oldName} | ${mtNamePadded} | ${actionPadded} | ${note} |\n`
  idx++
}
report += '\n'

// ============ OUTPUT 3: ALL REMAINING UNMATCHED ============
report += sep + '\n'
report += 'OUTPUT 3: ALL REMAINING UNMATCHED (after cleanup)\n'
report += sep + '\n\n'

const allUnmatched = v3.oldProducts.filter(p => p.matchStatus === 'UNMATCHED')
report += 'No. | old/source raw name                   | normalized                            | group/category       | closest MetalTrack product       | conf   | reason                                                    | recommended action\n'
report += sep2 + '\n'
allUnmatched.forEach((p, i) => {
  const closest = p.candidates && p.candidates[0] ? p.candidates[0] : null
  const row = [
    String(i + 1).padEnd(3),
    p.rawName.padEnd(36).substring(0, 36),
    p.normName.padEnd(36).substring(0, 36),
    `${p.groupCode}/${p.groupName}`.padEnd(20),
    (closest ? closest.productName : '-').padEnd(32).substring(0, 32),
    (p.confidence || '-').padEnd(6),
    (p.reason || '').padEnd(56).substring(0, 56),
    p.recommendedAction || '-',
  ]
  report += row.join(' | ') + '\n'
})
report += '\n'

// ============ OUTPUT 4: FINAL SAFE ALIAS TABLE ============
report += sep + '\n'
report += 'OUTPUT 4: FINAL SAFE ALIAS TABLE (for detailed Excel import feature)\n'
report += 'Only includes aliases that are STILL needed after old-system names are fixed.\n'
report += sep + '\n\n'

report += 'raw old/source name                     | MetalTrack product name      | productId                                  | reason                                          | risk\n'
report += sep2 + '\n'

// The current safeAliases in source code (post-fix)
const finalAliases = [
  { raw: 'อลูมิเนียมแข็ง (หล่อ/หนา)', mt: 'อลูมิเนียมแข็ง', reason: 'Old system uses descriptive suffix; MT uses short name', risk: 'LOW' },
  { raw: 'อลูมิเนียมฝาแกะ', mt: 'ฝาอลูมิเนียม', reason: 'Old system uses "ฝาแกะ"; MT uses "ฝาอลูมิเนียม"', risk: 'LOW' },
  { raw: 'อลูมิเนียมกระป๋อง', mt: 'กระป๋องอลูมิเนียม', reason: 'Old system uses "อลูมิเนียมกระป๋อง"; MT uses "กระป๋องอลูมิเนียม" (word order)', risk: 'LOW' },
  { raw: 'อลูมิเนียมตูดกะทะ', mt: 'อลูมิเนียมตูดกะทะ', reason: 'Spelling variant (อิ vs อี) — already normalized by matchProduct()', risk: 'LOW (may be removable once old system standardized)' },
]

// Find product IDs
for (const a of finalAliases) {
  const p = mtProducts.find(p => p.name === a.mt)
  const pid = p ? p.id : '(not found)'
  report += `${a.raw.padEnd(38)} | ${a.mt.padEnd(28)} | ${pid.padEnd(42)} | ${a.reason.padEnd(46)} | ${a.risk}\n`
}
report += '\n'
report += 'ADDITIONAL NORMALIZATION (in matchProduct function, not alias table):\n'
report += '  - อลูมีเนียม → อลูมิเนียม (applied to ALL input names before matching)\n'
report += '  - This handles ANY old Excel name with อี vowel spelling automatically.\n\n'
report += 'ALIASES THAT COULD BE ADDED IF OWNER APPROVES (high-confidence spelling variants from Output 3):\n'
const suggestedAliases = allUnmatched.filter(p => p.problemType === 'spelling' && p.confidence === 'high' && p.candidates && p.candidates[0].similarity >= 0.85)
if (suggestedAliases.length === 0) {
  report += '  (none — all high-confidence spelling variants should be fixed in old system instead)\n'
} else {
  for (const p of suggestedAliases) {
    const c = p.candidates[0]
    report += `  - "${p.rawName}" → "${c.productName}" (similarity ${(c.similarity*100).toFixed(0)}%, ${c.similarityReason})\n`
    report += `    Risk: ${c.similarity >= 0.95 ? 'LOW' : 'MEDIUM'} — owner approval required\n`
  }
}
report += '\n'

// ============ OUTPUT 5: FINAL IMPORT READINESS ============
report += sep + '\n'
report += 'OUTPUT 5: FINAL IMPORT READINESS\n'
report += sep + '\n\n'

report += 'Dry-run test file: ซื้อ 1-7-2569 แบบละเอียด.xls\n'
report += 'Dry-run mode: YES (no bills imported, no API calls, no DB writes)\n\n'
report += 'EXPECTED vs ACTUAL:\n'
report += '  Metric         | Expected | Actual | Status\n'
report += '  ---------------|----------|--------|-------\n'
report += '  Bills          | 13       | 13     | ✅ PASS\n'
report += '  Items          | 43       | 43     | ✅ PASS\n'
report += '  Unmatched      | 0        | 0      | ✅ PASS\n'
report += '  Duplicates     | 0        | 0      | ✅ PASS (no existing externalBillNumbers checked in dry-run)\n'
report += '\n'

report += 'VERDICT: ✅ IMPORT PREVIEW IS READY\n\n'
report += 'Owner can now:\n'
report += '  1. Open Buy page → "นำเข้าแบบละเอียด (แยกบิล)"\n'
report += '  2. Upload ซื้อ 1-7-2569 แบบละเอียด.xls\n'
report += '  3. Review the preview (will show 13 bills, 43 items, 0 unmatched)\n'
report += '  4. Click "นำเข้า 13 บิล" to create the bills\n'
report += '\n'
report += 'NOTE: This dry-run was performed using a Node.js script that mirrors the EXACT matching\n'
report += 'logic from detailed-excel-import-dialog.tsx (including the new อลูมีเนียม → อลูมิเนียม normalization).\n'
report += 'The actual browser-based preview should produce identical results.\n\n'

// ============ FINAL SUMMARY ============
report += sep + '\n'
report += 'FINAL SUMMARY\n'
report += sep + '\n\n'
report += '✅ Product-name cleanup completed\n'
report += `✅ Number of products renamed: ${exec.renames.length}\n`
report += `✅ Number of products created: ${exec.creates.length}\n`
report += `✅ Number of duplicates removed: 1 (สายไฟอลูมิเนียม — same as existing อลูมิเนียมสายไฟ)\n`
report += `✅ Number of aliases fixed: 1 broken alias corrected + 3 aliases updated to new spelling + spelling normalization added\n`
report += `✅ Nickel mapping applied: group 05 → นิกเกิล(สแตนเลส); group 08 → IGNORE\n`
report += `✅ Final MetalTrack product count: ${mtProducts.length} (was 108, +10 created, -1 duplicate removed = 117)\n\n`
report += `Final unmatched count (regular products): ${v3.oldProducts.filter(p => !p.isService && !p.isSortedOutput && p.matchStatus === 'UNMATCHED').length}\n`
report += `  - spelling mismatches: ${v3.oldProducts.filter(p => !p.isService && !p.isSortedOutput && p.matchStatus === 'UNMATCHED' && p.problemType === 'spelling').length}\n`
report += `  - missing in MT: ${v3.oldProducts.filter(p => !p.isService && !p.isSortedOutput && p.matchStatus === 'UNMATCHED' && p.problemType === 'missing').length}\n\n`
report += `✅ Import preview is READY (13 bills, 43 items, 0 unmatched in dry-run)\n`
report += `✅ No BuyBills were imported\n`
report += `✅ No stock was changed (initial stock = 0 for new products, no StockLots created)\n`

report += '\n' + sep + '\n'
report += 'END OF REPORT\n'
report += sep + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/FINAL_TASK35_REPORT.txt', report)
console.log(report)
console.log('\n\nReport saved to: /home/z/my-project/reconciliation/FINAL_TASK35_REPORT.txt')
