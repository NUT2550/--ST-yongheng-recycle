/**
 * Generate final formatted report with all 6 outputs.
 */
import fs from 'fs'

const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/comparison-results.json', 'utf8'))
const oldProducts = data.oldProducts
const oldDupes = data.oldDuplicateGroups
const mtNearDupes = data.mtNearDupes

// Helper: format similarity as percentage
function pct(s) { return (s * 100).toFixed(0) + '%' }

// Filter categories
const regularProducts = oldProducts.filter(p => !p.isService && !p.isSortedOutput)
const serviceEntries = oldProducts.filter(p => p.isService)
const sortedEntries = oldProducts.filter(p => p.isSortedOutput)

// Classification counts
const exactMatches = regularProducts.filter(p => p.matchType === 'EXACT')
const aliasMatches = regularProducts.filter(p => p.matchType === 'ALIAS' || p.matchType === 'ALIAS_CONTAINS')
const sortedDupMatched = sortedEntries.filter(p => p.matchStatus === 'SORTED_DUPLICATE')
const sortedUnmatched = sortedEntries.filter(p => p.matchStatus === 'UNMATCHED')
const unmatchedSpelling = regularProducts.filter(p => p.matchStatus === 'UNMATCHED' && p.problemType === 'spelling')
const unmatchedMissing = regularProducts.filter(p => p.matchStatus === 'UNMATCHED' && p.problemType === 'missing')

let report = ''
const sep = '='.repeat(180)
const sep2 = '-'.repeat(180)

report += sep + '\n'
report += 'PRODUCT LIST COMPARISON REPORT — Old/Source System vs MetalTrack Product Master\n'
report += 'REPORT-ONLY — No production changes were made.\n'
report += sep + '\n\n'

report += 'INPUT FILE: รายการสิ้นต้า.xls (192 rows, 11 groups: เหล็ก/อลูมิเนียม/ทองแดง/ทองเหลือง/แสตนเลส/ตะกั่ว/ขยะอิเล็กทรอนิค/อื่นๆ/พลาสติก/รายรับอื่นๆ/คัดแยก)\n'
report += 'METALTRACK PRODUCTS: 108 products across 9 categories (เหล็ก=31, ทองแดง=13, ทองเหลือง=9, แสตนเลส=7, อลูมิเนียม=24, ตะกั่ว=3, อื่นๆ=12, อิเล็กทรอนิกส์=8, พลาสติก=1)\n'
report += `OLD/SOURCE ENTRIES PARSED: ${oldProducts.length} total (${regularProducts.length} products + ${serviceEntries.length} services + ${sortedEntries.length} sorted-output entries)\n\n`

report += 'NORMALIZATION APPLIED (same as detailed import dialog):\n'
report += '  - TIS-620 / codepage 874 decoding fix (TextDecoder windows-874)\n'
report += '  - Unicode NFC normalization\n'
report += '  - Whitespace trim + collapse repeated spaces\n'
report += '  - Removed invisible chars (zero-width, BOM, non-breaking spaces)\n'
report += '  - Original raw name preserved for reporting\n\n'

report += 'MATCHING RULES (same as detailed import dialog):\n'
report += '  1. Exact match (NFC normalized)\n'
report += '  2. Safe alias (from SAFE_ALIASES table — currently 4 entries)\n'
report += '  3. Contains match (single result only, within same category — no cross-category guessing)\n'
report += '  4. If no match: fuzzy similarity (Levenshtein + Jaccard + substring) within same category\n\n'

report += 'GROUP → METALTRACK CATEGORY MAPPING:\n'
report += '  01 เหล็ก               → เหล็ก\n'
report += '  02 อลูมิเนียม          → อลูมิเนียม\n'
report += '  03 ทองแดง             → ทองแดง\n'
report += '  04 ทองเหลือง           → ทองเหลือง\n'
report += '  05 แสตนเลส            → แสตนเลส\n'
report += '  06 ตะกั่ว              → ตะกั่ว\n'
report += '  07 ขยะอิเล็กทรอนิค     → อิเล็กทรอนิกส์\n'
report += '  08 อื่นๆ               → อื่นๆ\n'
report += '  09 พลาสติก            → พลาสติก\n'
report += '  10 รายรับอื่นๆ         → (NOT a product — services: ชั่งรถ)\n'
report += '  11 คัดแยก             → (sorted output — duplicates of products with "(คัดแยก)" suffix)\n\n'

// ============ OUTPUT 1: SUMMARY ============
report += sep + '\n'
report += 'OUTPUT 1: SUMMARY\n'
report += sep + '\n\n'

report += 'Total old/source entries parsed:                 '.padEnd(50) + `${oldProducts.length}\n`
report += '  - Regular products (groups 01-09):             '.padEnd(50) + `${regularProducts.length}\n`
report += '  - Service entries (group 10, NOT products):    '.padEnd(50) + `${serviceEntries.length}\n`
report += '  - Sorted-output entries (group 11, duplicates):'.padEnd(50) + `${sortedEntries.length}\n\n`

report += 'Total MetalTrack products:                       '.padEnd(50) + `108\n\n`

report += 'CLASSIFICATION (regular products only):\n'
report += '  A. Exact match:                                 '.padEnd(50) + `${exactMatches.length}\n`
report += '  B. Matched by safe alias / contains-match:      '.padEnd(50) + `${aliasMatches.length}\n`
report += '  C. Likely typo/spelling mismatch:               '.padEnd(50) + `${unmatchedSpelling.length}\n`
report += '  D. Missing in MetalTrack:                       '.padEnd(50) + `${unmatchedMissing.length}\n`
report += '  E. Duplicate/near-duplicate in old/source list: '.padEnd(50) + `${oldDupes.length}\n`
report += '  F. Duplicate/near-duplicate in MetalTrack:      '.padEnd(50) + `${mtNearDupes.length}\n`
report += '  G. Ambiguous / owner review required:           '.padEnd(50) + `${unmatchedSpelling.filter(p => p.confidence === 'low').length + unmatchedMissing.length}\n\n`

report += 'SORTED-OUTPUT ENTRIES (group 11):\n'
report += '  - Matched by stripping "(คัดแยก)" suffix:       '.padEnd(50) + `${sortedDupMatched.length}\n`
report += '  - Unmatched even after stripping suffix:        '.padEnd(50) + `${sortedUnmatched.length}\n`
report += '  → Sorted-output entries are duplicates of existing products; should NOT be imported as separate products.\n\n'

report += 'SERVICE ENTRIES (group 10):\n'
report += `  - ${serviceEntries.length} entries are weighing services (ชั่งรถ), not products.\n`
report += '  → Should NOT be imported as BuyBill items.\n\n'

// ============ OUTPUT 2: ALL NON-EXACT MATCHES ============
report += sep + '\n'
report += 'OUTPUT 2: ALL NON-EXACT MATCHES\n'
report += '(Every regular product that is NOT an exact name match)\n'
report += sep + '\n\n'

const nonExact = regularProducts.filter(p => p.matchType !== 'EXACT')
const headers2 = ['No.', 'old/source raw name', 'normalized', 'group', 'match status', 'closest MT product', 'productId', 'conf', 'problem type', 'recommended action', 'reason']
const widths2 = [4, 32, 30, 12, 14, 30, 50, 6, 12, 28, 50]
report += headers2.map((h, i) => h.padEnd(widths2[i])).join(' ') + '\n'
report += widths2.map(w => '-'.repeat(w)).join(' ') + '\n'

nonExact.forEach((p, idx) => {
  const closest = p.candidates && p.candidates.length > 0 ? p.candidates[0] : null
  const row = [
    String(idx + 1) + '.',
    p.rawName,
    p.normName,
    `${p.groupCode}/${p.groupName}`,
    p.matchStatus,
    closest ? closest.productName : (p.matchedProductName || '-'),
    closest ? closest.productId : (p.matchedProductId || '-'),
    p.confidence || '-',
    p.problemType || '-',
    p.recommendedAction || '-',
    p.reason || '-',
  ]
  report += row.map((v, i) => String(v).padEnd(widths2[i])).join(' ') + '\n'
})

report += '\n'

// ============ OUTPUT 3: SAFE ALIAS CANDIDATES ============
report += sep + '\n'
report += 'OUTPUT 3: SAFE ALIAS CANDIDATES (high confidence only)\n'
report += 'Do NOT apply yet — owner approval required.\n'
report += sep + '\n\n'

const aliasCandidates = regularProducts.filter(p =>
  p.matchStatus === 'UNMATCHED' &&
  p.candidates && p.candidates.length > 0 &&
  p.candidates[0].similarity >= 0.85
).sort((a, b) => b.candidates[0].similarity - a.candidates[0].similarity)

const headers3 = ['No.', 'old/source raw name', 'proposed MT product', 'productId', 'similarity', 'reason', 'risk level', 'owner approval']
const widths3 = [4, 32, 30, 50, 12, 50, 12, 14]
report += headers3.map((h, i) => h.padEnd(widths3[i])).join(' ') + '\n'
report += widths3.map(w => '-'.repeat(w)).join(' ') + '\n'

if (aliasCandidates.length === 0) {
  report += '(none)\n'
} else {
  aliasCandidates.forEach((p, idx) => {
    const c = p.candidates[0]
    const risk = c.similarity >= 0.95 ? 'LOW' : (c.similarity >= 0.9 ? 'LOW' : 'MEDIUM')
    const row = [
      String(idx + 1) + '.',
      p.rawName,
      c.productName,
      c.productId,
      pct(c.similarity),
      c.similarityReason,
      risk,
      'REQUIRED',
    ]
    report += row.map((v, i) => String(v).padEnd(widths3[i])).join(' ') + '\n'
  })
}
report += '\n'

// ============ OUTPUT 4: MISSING PRODUCTS ============
report += sep + '\n'
report += 'OUTPUT 4: MISSING PRODUCTS (in old/source list but not in MetalTrack)\n'
report += 'Do NOT create products automatically.\n'
report += sep + '\n\n'

const missingProducts = [
  ...regularProducts.filter(p => p.matchStatus === 'UNMATCHED' && p.problemType === 'missing'),
  ...sortedEntries.filter(p => p.matchStatus === 'UNMATCHED'),  // sorted-output entries that didn't match
]

const headers4 = ['No.', 'old/source raw name', 'normalized', 'group', 'category guess', 'reason missing', 'recommended action']
const widths4 = [4, 32, 30, 18, 22, 50, 28]
report += headers4.map((h, i) => h.padEnd(widths4[i])).join(' ') + '\n'
report += widths4.map(w => '-'.repeat(w)).join(' ') + '\n'

if (missingProducts.length === 0) {
  report += '(none)\n'
} else {
  missingProducts.forEach((p, idx) => {
    const row = [
      String(idx + 1) + '.',
      p.rawName,
      p.normName,
      `${p.groupCode}/${p.groupName}`,
      p.mtCategory || (p.isSortedOutput ? '(sorted-output)' : '-'),
      p.reason || 'No close match',
      p.recommendedAction || 'owner review required',
    ]
    report += row.map((v, i) => String(v).padEnd(widths4[i])).join(' ') + '\n'
  })
}
report += '\n'

// ============ OUTPUT 5: DUPLICATES / NEAR DUPLICATES ============
report += sep + '\n'
report += 'OUTPUT 5: DUPLICATES / NEAR DUPLICATES\n'
report += sep + '\n\n'

report += '--- 5A: Old/Source List Duplicates (same normalized name in multiple groups) ---\n\n'
const headers5a = ['No.', 'source', 'product name A', 'product name B', 'similarity reason', 'risk', 'recommended action']
const widths5a = [4, 18, 32, 32, 50, 16, 28]
report += headers5a.map((h, i) => h.padEnd(widths5a[i])).join(' ') + '\n'
report += widths5a.map(w => '-'.repeat(w)).join(' ') + '\n'

if (oldDupes.length === 0) {
  report += '(none)\n'
} else {
  oldDupes.forEach((grp, idx) => {
    // Show pairwise
    for (let i = 0; i < grp.entries.length; i++) {
      for (let j = i + 1; j < grp.entries.length; j++) {
        const a = grp.entries[i]
        const b = grp.entries[j]
        const risk = a.groupCode !== b.groupCode ? 'HIGH (cross-group)' : 'MEDIUM'
        const action = a.groupCode !== b.groupCode ? 'owner review required (cross-category)' : 'merge duplicate'
        const row = [
          String(idx + 1) + '.',
          'old/source list',
          `[${a.oldCode}] ${grp.name} (g${a.groupCode})`,
          `[${b.oldCode}] ${grp.name} (g${b.groupCode})`,
          `identical normalized name "${grp.name}" in groups ${a.groupCode}/${a.groupName} and ${b.groupCode}/${b.groupName}`,
          risk,
          action,
        ]
        report += row.map((v, i) => String(v).padEnd(widths5a[i])).join(' ') + '\n'
      }
    }
  })
}
report += '\n'

report += '--- 5B: MetalTrack Near-Duplicates (similarity >= 85%) ---\n\n'
report += headers5a.map((h, i) => h.padEnd(widths5a[i])).join(' ') + '\n'
report += widths5a.map(w => '-'.repeat(w)).join(' ') + '\n'

if (mtNearDupes.length === 0) {
  report += '(none — no MetalTrack products have similarity >= 85% to another)\n'
} else {
  mtNearDupes.forEach((d, idx) => {
    const row = [
      String(idx + 1) + '.',
      'MetalTrack',
      `${d.aName} (${d.aCategory})`,
      `${d.bName} (${d.bCategory})`,
      `${pct(d.similarity)} — ${d.similarityReason}`,
      d.aCategory === d.bCategory ? 'MEDIUM (same category)' : 'LOW (different categories)',
      d.aCategory === d.bCategory ? 'owner review — possible merge' : 'no action (different categories)',
    ]
    report += row.map((v, i) => String(v).padEnd(widths5a[i])).join(' ') + '\n'
  })
}
report += '\n'

report += '--- 5C: Sorted-Output Entries (group 11 — duplicates of regular products with "(คัดแยก)" suffix) ---\n\n'
report += `Found ${sortedEntries.length} sorted-output entries in old/source list.\n`
report += `Of these, ${sortedDupMatched.length} matched existing MT products after stripping "(คัดแยก)" suffix.\n`
report += `${sortedUnmatched.length} did NOT match (listed in Output 4 as missing).\n\n`
report += 'Recommendation: Sorted-output entries should NOT be imported as separate products.\n'
report += 'They represent the same physical products, just sorted through the sorting process.\n\n'

// ============ OUTPUT 6: EXACT MATCHES ============
report += sep + '\n'
report += 'OUTPUT 6: EXACT MATCH LIST (regular products only)\n'
report += sep + '\n\n'

const headers6 = ['No.', 'old/source raw name', 'old code', 'group', 'MetalTrack product name', 'productId', 'category']
const widths6 = [4, 32, 8, 18, 32, 50, 14]
report += headers6.map((h, i) => h.padEnd(widths6[i])).join(' ') + '\n'
report += widths6.map(w => '-'.repeat(w)).join(' ') + '\n'

exactMatches.forEach((p, idx) => {
  const row = [
    String(idx + 1) + '.',
    p.rawName,
    p.oldCode,
    `${p.groupCode}/${p.groupName}`,
    p.matchedProductName,
    p.matchedProductId,
    p.matchedProductCategory,
  ]
  report += row.map((v, i) => String(v).padEnd(widths6[i])).join(' ') + '\n'
})

report += '\n'

// ============ APPENDIX: ALIAS MATCHES ============
report += sep + '\n'
report += 'APPENDIX: ALIAS MATCHES (matched via safe alias or contains-match)\n'
report += sep + '\n\n'

const headersA = ['No.', 'old/source raw name', 'old code', 'group', 'match type', 'matched MT product', 'productId', 'reason']
const widthsA = [4, 32, 8, 18, 18, 32, 50, 50]
report += headersA.map((h, i) => h.padEnd(widthsA[i])).join(' ') + '\n'
report += widthsA.map(w => '-'.repeat(w)).join(' ') + '\n'

aliasMatches.forEach((p, idx) => {
  const row = [
    String(idx + 1) + '.',
    p.rawName,
    p.oldCode,
    `${p.groupCode}/${p.groupName}`,
    p.matchType,
    p.matchedProductName,
    p.matchedProductId,
    p.reason || '-',
  ]
  report += row.map((v, i) => String(v).padEnd(widthsA[i])).join(' ') + '\n'
})

report += '\n'

// ============ APPENDIX: KNOWN ISSUES ============
report += sep + '\n'
report += 'APPENDIX: KNOWN ISSUES / OBSERVATIONS\n'
report += sep + '\n\n'

report += '1. BROKEN SAFE ALIAS (in detailed-excel-import-dialog.tsx):\n'
report += '   safeAliases[\'อลูมิเนียมฝาแกะ\'] = \'ฝาอลูมีเนียมเนียม\'\n'
report += '   But MetalTrack product name is "ฝาอลูมีเนียม" (no double "เนียม").\n'
report += '   → This alias NEVER matches. Should be: \'อลูมิเนียมฝาแกะ\' → \'ฝาอลูมีเนียม\'\n\n'

report += '2. CROSS-CATEGORY DUPLICATE "นิกเกิล":\n'
report += '   Old/source list has "นิกเกิล" in BOTH:\n'
report += '     - group 05 (แสตนเลส): oldCode 0506\n'
report += '     - group 08 (อื่นๆ):    oldCode 0813\n'
report += '   MetalTrack split these into:\n'
report += '     - "นิกเกิล(สแตนเลส)" (category: แสตนเลส)\n'
report += '     - "นิกเกิล"           (category: อื่นๆ)\n'
report += '   → Old "0506 นิกเกิล" was matched to "นิกเกิล(สแตนเลส)" via contains-match.\n'
report += '   → Old "0813 นิกเกิล" was exact-matched to "นิกเกิล".\n'
report += '   → Owner should verify this is correct: are these the same physical material tracked twice, or genuinely different?\n\n'

report += '3. ALUMINUM SPELLING VARIANT: "อลูมิเนียม" (old) vs "อลูมีเนียม" (MetalTrack)\n'
report += '   The old/source system uses "อลูมิเนียม" (with อิ vowel).\n'
report += '   MetalTrack uses "อลูมีเนียม" (with อี vowel) for most products, but "อลูมิเนียม" for some (e.g. อลูมิเนียมสายไฟ, อลูมิเนียมฉาก, อลูมิเนียมบาง, อลูมิเนียมกระป๋อง...).\n'
report += '   → Recommendation: standardize MetalTrack to ONE spelling (either อลูมิเนียม or อลูมีเนียม), then add aliases for the other.\n'
report += '   → 9 alias candidates proposed in Output 3 for high-similarity spelling variants.\n\n'

report += '4. SERVICE ENTRIES (group 10 — รายรับอื่นๆ):\n'
report += '   - 1001 ชั่งรถกระบะ\n'
report += '   - 1002 ชั่งรถ 6 ล้อ\n'
report += '   - 1003 ชั่งรถ 10 ล้อ\n'
report += '   These are weighing SERVICES (revenue), NOT products. They will NEVER appear in Buy Excel.\n'
report += '   → Safe to ignore for product reconciliation.\n\n'

report += '5. SORTED-OUTPUT ENTRIES (group 11 — คัดแยก):\n'
report += `   Found ${sortedEntries.length} entries with "(คัดแยก)" suffix in name.\n`
report += `   ${sortedDupMatched.length} matched existing MT products after stripping suffix.\n`
report += `   ${sortedUnmatched.length} did NOT match — these are either:\n`
report += '     (a) Missing products that need to be created, OR\n'
report += '     (b) Sorted-output names that don\'t directly correspond to a single MT product (e.g. "ล้อแม็ก (คัดแยก)" vs "อลูมีเนียมล้อแม๊กซ์").\n'
report += '   → Recommendation: do NOT import sorted-output as separate products. They duplicate existing product entries.\n\n'

report += sep + '\n'
report += 'NO PRODUCTION CHANGES WERE MADE.\n'
report += sep + '\n'

fs.writeFileSync('/home/z/my-project/reconciliation/PRODUCT_COMPARISON_REPORT.txt', report)
console.log(report.substring(0, 3000))
console.log('...')
console.log(`\nFull report saved to: /home/z/my-project/reconciliation/PRODUCT_COMPARISON_REPORT.txt`)
console.log(`Report length: ${report.length} chars, ${report.split('\n').length} lines`)
