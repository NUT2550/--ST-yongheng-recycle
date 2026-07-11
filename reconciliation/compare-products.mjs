/**
 * Compare full old product list (รายการสิ้นต้า.xls) against MetalTrack product master.
 * REPORT-ONLY — no DB modifications.
 *
 * Outputs 6 tables:
 *   1. Summary
 *   2. All non-exact matches
 *   3. Safe alias candidates (high confidence)
 *   4. Missing products
 *   5. Duplicates / near-duplicates
 *   6. Exact matches list
 */
import xlsx from 'xlsx'
import fs from 'fs'

// ============ LOAD DATA ============
const FILE = '/home/z/my-project/upload/รายการสิ้นต้า.xls'
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
const mtProducts = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/mt-products.json', 'utf8'))

// ============ NORMALIZATION ============
// Same as detailed import dialog + extra cleanup
function fixThaiText(text) {
  if (text == null) return ''
  if (typeof text !== 'string') text = String(text)
  const hasGarbled = [...text].some(c => c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) <= 0xFF)
  if (!hasGarbled) return text
  try {
    const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF))
    return new TextDecoder('windows-874').decode(bytes)
  } catch {
    return text
  }
}

function normalize(s) {
  if (s == null) return ''
  let t = fixThaiText(s)
  // remove invisible chars (zero-width, BOM, non-breaking spaces, etc.)
  t = t.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
  // collapse whitespace
  t = t.replace(/\s+/g, ' ').trim()
  // NFC normalization
  t = t.normalize('NFC')
  return t
}

// ============ OLD/SOURCE PRODUCT EXTRACTION ============
// File structure:
//   Row 0: title
//   Row 1: date
//   Row 2: column headers
//   Row 3+: per category — group header (col 0 = code, col 1 = name) then product rows
//           product rows: col 1 = product code, col 2 = product name

// Group code → MetalTrack category name mapping
const GROUP_TO_MT_CATEGORY = {
  '01': 'เหล็ก',
  '02': 'อลูมิเนียม',     // old "อลูมิเนียม" → MT "อลูมิเนียม"
  '03': 'ทองแดง',
  '04': 'ทองเหลือง',
  '05': 'แสตนเลส',
  '06': 'ตะกั่ว',
  '07': 'อิเล็กทรอนิกส์',  // old "ขยะอิเล็กทรอนิค" → MT "อิเล็กทรอนิกส์"
  '08': 'อื่นๆ',
  '09': 'พลาสติก',
  '10': null,             // รายรับอื่นๆ (services — NOT products)
  '11': null,             // คัดแยก (sorted output — duplicates of products with "(คัดแยก)" suffix)
}

const oldProducts = []
let currentGroup = null
let currentGroupName = null

for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  // Apply TIS-620 fix to all string cells
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThaiText(c) : c))

  // Group header: col 0 = 2-digit code, col 1 = group name, col 2 = null
  if (fixed[0] && /^\d{2}$/.test(String(fixed[0]).trim()) && fixed[1] && !fixed[2]) {
    currentGroup = String(fixed[0]).trim()
    currentGroupName = String(fixed[1]).trim()
    continue
  }
  // Product row: col 1 = 4-digit (or 5-digit) code, col 2 = product name
  if (fixed[1] && /^\d{4,5}$/.test(String(fixed[1]).trim()) && fixed[2]) {
    const code = String(fixed[1]).trim()
    const rawName = String(fixed[2]).trim()
    const normName = normalize(rawName)
    const unit = fixed[4] ? String(fixed[4]).trim() : ''
    oldProducts.push({
      oldCode: code,
      rawName,
      normName,
      groupCode: currentGroup,
      groupName: currentGroupName,
      unit,
      rowIdx: i,
      mtCategory: currentGroup ? GROUP_TO_MT_CATEGORY[currentGroup] : null,
      isService: currentGroup === '10',
      isSortedOutput: currentGroup === '11',  // has "(คัดแยก)" suffix typically
    })
  }
}
console.log(`Extracted ${oldProducts.length} old/source product entries`)
console.log(`  Service entries (group 10): ${oldProducts.filter(p => p.isService).length}`)
console.log(`  Sorted-output entries (group 11): ${oldProducts.filter(p => p.isSortedOutput).length}`)
console.log(`  Product entries (groups 01-09): ${oldProducts.filter(p => !p.isService && !p.isSortedOutput).length}`)

// ============ SAFE ALIASES (from detailed import dialog) ============
const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมีเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมีเนียมเนียม',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมีเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมีเนียมตูดกะทะ',
}

// ============ MATCHING FUNCTION (same logic as import dialog) ============
// Pre-build product lookup map: normalized exact name → product
const productMap = new Map()
for (const p of mtProducts) {
  productMap.set(p.name.trim().normalize('NFC'), p)
}

// Also build per-category product lists (for category-restricted matching)
const productsByCategory = new Map()
for (const p of mtProducts) {
  if (!productsByCategory.has(p.categoryName)) productsByCategory.set(p.categoryName, [])
  productsByCategory.get(p.categoryName).push(p)
}

function matchProduct(excelName, restrictToMtCategory = null) {
  const trimmed = excelName.trim().normalize('NFC')
  // 1. Exact match (normalized)
  if (productMap.has(trimmed)) {
    const p = productMap.get(trimmed)
    return { product: p, matchType: 'EXACT', reason: 'exact name match (NFC normalized)' }
  }
  // 2. Safe alias (normalized)
  const alias = SAFE_ALIASES[excelName.trim()]?.normalize('NFC')
  if (alias && productMap.has(alias)) {
    const p = productMap.get(alias)
    return { product: p, matchType: 'ALIAS', reason: `safe alias "${excelName}" → "${p.name}"` }
  }
  // 3. Contains match (single result only — no ambiguity, normalized)
  //    Restricted to same category if specified
  const candidatePool = restrictToMtCategory
    ? (productsByCategory.get(restrictToMtCategory) || [])
    : mtProducts
  const contains = candidatePool.filter(p => {
    const pn = p.name.normalize('NFC')
    return pn.includes(trimmed) || trimmed.includes(pn)
  })
  if (contains.length === 1) {
    return { product: contains[0], matchType: 'ALIAS_CONTAINS', reason: `single contains-match in category "${restrictToMtCategory}"` }
  }
  return null
}

// ============ CLASSIFICATION ============
const results = []
for (const op of oldProducts) {
  const r = { ...op, match: null, matchType: null, matchStatus: null, problemType: null, recommendedAction: null, reason: null, confidence: null }
  // Skip services and sorted-output (but list them as info)
  if (op.isService) {
    r.matchStatus = 'SERVICE_NOT_PRODUCT'
    r.problemType = 'service'
    r.recommendedAction = 'do not import (service, not a product)'
    r.reason = 'Old/source entry is a service (ชั่งรถ) — not a metal/product. Should not appear in Buy Excel.'
    r.confidence = 'high'
    results.push(r)
    continue
  }
  if (op.isSortedOutput) {
    // Sorted-output items are duplicates of products with "(คัดแยก)" suffix
    // Try matching by stripping the "(คัดแยก)" suffix
    const stripped = op.normName.replace(/\s*\(คัดแยก\)\s*$/, '').replace(/\s*\(คัดแยก\)\s*/, '').trim()
    const m = matchProduct(stripped, op.mtCategory)
    if (m) {
      r.match = m.product
      r.matchType = m.matchType
      r.matchStatus = 'SORTED_DUPLICATE'
      r.problemType = 'duplicate'
      r.recommendedAction = 'do not import as separate product — sorted output uses same product'
      r.reason = `Old/source entry has "(คัดแยก)" suffix — same product, just sorted output. Stripped name "${stripped}" matches "${m.product.name}".`
      r.confidence = 'high'
    } else {
      r.matchStatus = 'UNMATCHED'
      r.problemType = 'missing'
      r.recommendedAction = 'owner review required'
      r.reason = `Sorted-output entry "${op.rawName}" — stripped name "${stripped}" not found in MT category "${op.mtCategory}".`
      r.confidence = 'low'
    }
    results.push(r)
    continue
  }

  // Regular product: try matching with category restriction
  const m = matchProduct(op.normName, op.mtCategory)
  if (m) {
    r.match = m.product
    r.matchType = m.matchType
    if (m.matchType === 'EXACT') {
      r.matchStatus = 'MATCHED'
      r.problemType = null
      r.recommendedAction = null
      r.reason = 'exact name match'
      r.confidence = 'high'
    } else if (m.matchType === 'ALIAS') {
      r.matchStatus = 'ALIAS'
      r.problemType = null
      r.recommendedAction = null
      r.reason = m.reason
      r.confidence = 'high'
    } else if (m.matchType === 'ALIAS_CONTAINS') {
      r.matchStatus = 'ALIAS'
      r.problemType = null
      r.reason = m.reason
      r.confidence = 'high'  // contains-match in same category is high confidence
    }
  } else {
    // Not matched — try fuzzy/typo detection
    const candidatePool = op.mtCategory ? (productsByCategory.get(op.mtCategory) || []) : mtProducts
    // Levenshtein-ish: find candidates with high similarity
    const candidates = []
    for (const p of candidatePool) {
      const pn = p.name.normalize('NFC')
      const sim = similarity(op.normName, pn)
      if (sim.score > 0) candidates.push({ product: p, sim })
    }
    candidates.sort((a, b) => b.sim.score - a.sim.score)
    r.candidates = candidates.slice(0, 3)
    if (candidates.length > 0 && candidates[0].sim.score >= 0.8) {
      r.matchStatus = 'UNMATCHED'
      r.problemType = 'spelling'
      r.recommendedAction = 'add explicit alias'
      r.reason = `Closest match "${candidates[0].product.name}" (similarity ${(candidates[0].sim.score * 100).toFixed(0)}%): ${candidates[0].sim.reason}`
      r.confidence = candidates[0].sim.score >= 0.9 ? 'high' : 'medium'
    } else if (candidates.length > 0 && candidates[0].sim.score >= 0.5) {
      r.matchStatus = 'UNMATCHED'
      r.problemType = 'spelling'
      r.recommendedAction = 'owner review required'
      r.reason = `Closest match "${candidates[0].product.name}" (similarity ${(candidates[0].sim.score * 100).toFixed(0)}%): ${candidates[0].sim.reason}`
      r.confidence = 'low'
    } else {
      r.matchStatus = 'UNMATCHED'
      r.problemType = 'missing'
      r.recommendedAction = 'create new product'
      r.reason = `No close match in MT category "${op.mtCategory}" (best similarity: ${candidates[0] ? (candidates[0].sim.score * 100).toFixed(0) + '%' : 'none'})`
      r.confidence = 'low'
    }
  }
  results.push(r)
}

// ============ SIMILARITY FUNCTION ============
function similarity(a, b) {
  // Returns { score: 0..1, reason: string }
  if (!a || !b) return { score: 0, reason: 'empty' }
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la === lb) return { score: 1.0, reason: 'case-insensitive exact' }
  // Contains
  if (la.includes(lb) || lb.includes(la)) {
    const shorter = Math.min(la.length, lb.length)
    const longer = Math.max(la.length, lb.length)
    return { score: shorter / longer * 0.95, reason: 'one is substring of other' }
  }
  // Word-order difference (e.g. "อลูมิเนียมแข็ง" vs "อลูมีเนียมแข็ง")
  // Compute character-level Levenshtein
  const dist = levenshtein(la, lb)
  const maxLen = Math.max(la.length, lb.length)
  const score = 1 - dist / maxLen
  // Determine reason
  // Spelling variant: เหล็กสลิง,สแตน vs เหล็กสลิง,สแตน — punctuation/spacing
  // Check if removing punctuation makes them equal
  const stripped = s => s.replace(/[\s,\-_/()]/g, '')
  if (stripped(la) === stripped(lb)) {
    return { score: 0.95, reason: 'differ only in punctuation/spacing' }
  }
  // Check character set similarity
  const setA = new Set(la)
  const setB = new Set(lb)
  const intersection = [...setA].filter(c => setB.has(c)).length
  const union = new Set([...setA, ...setB]).size
  const jaccard = intersection / union
  if (jaccard > 0.8) {
    return { score: Math.max(score, jaccard * 0.85), reason: `character-set similar (jaccard ${(jaccard*100).toFixed(0)}%)` }
  }
  return { score: score * 0.7, reason: `levenshtein distance ${dist}/${maxLen}` }
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i-1] === b[j-1] ? 0 : 1
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost)
    }
  }
  return dp[m][n]
}

// ============ DUPLICATE DETECTION ============
// Within old/source list: same normName appearing multiple times
const oldDupes = new Map()
for (const r of results) {
  if (r.isService) continue
  const key = r.normName
  if (!oldDupes.has(key)) oldDupes.set(key, [])
  oldDupes.get(key).push(r)
}
const oldDuplicateGroups = [...oldDupes.entries()].filter(([_, arr]) => arr.length > 1)

// Within MetalTrack: detect near-duplicates (sim >= 0.85)
const mtNearDupes = []
for (let i = 0; i < mtProducts.length; i++) {
  for (let j = i + 1; j < mtProducts.length; j++) {
    const a = mtProducts[i].name.normalize('NFC')
    const b = mtProducts[j].name.normalize('NFC')
    const sim = similarity(a, b)
    if (sim.score >= 0.85) {
      mtNearDupes.push({ a: mtProducts[i], b: mtProducts[j], sim })
    }
  }
}

// ============ OUTPUT: SAVE RESULTS ============
fs.writeFileSync('/home/z/my-project/reconciliation/comparison-results.json', JSON.stringify({
  oldProducts: results.map(r => ({
    oldCode: r.oldCode,
    rawName: r.rawName,
    normName: r.normName,
    groupCode: r.groupCode,
    groupName: r.groupName,
    mtCategory: r.mtCategory,
    isService: r.isService,
    isSortedOutput: r.isSortedOutput,
    rowIdx: r.rowIdx,
    matchStatus: r.matchStatus,
    matchType: r.matchType,
    matchedProductId: r.match?.id || null,
    matchedProductName: r.match?.name || null,
    matchedProductCategory: r.match?.categoryName || null,
    problemType: r.problemType,
    recommendedAction: r.recommendedAction,
    reason: r.reason,
    confidence: r.confidence,
    candidates: r.candidates ? r.candidates.map(c => ({
      productId: c.product.id,
      productName: c.product.name,
      categoryName: c.product.categoryName,
      similarity: c.sim.score,
      similarityReason: c.sim.reason,
    })) : null,
  })),
  oldDuplicateGroups: oldDuplicateGroups.map(([name, arr]) => ({
    name,
    entries: arr.map(r => ({ oldCode: r.oldCode, groupCode: r.groupCode, groupName: r.groupName, rowIdx: r.rowIdx })),
  })),
  mtNearDupes: mtNearDupes.map(d => ({
    aId: d.a.id, aName: d.a.name, aCategory: d.a.categoryName,
    bId: d.b.id, bName: d.b.name, bCategory: d.b.categoryName,
    similarity: d.sim.score, similarityReason: d.sim.reason,
  })),
}, null, 2))
console.log('Saved to comparison-results.json')

// ============ CONSOLE OUTPUT ============
console.log('\n=== CLASSIFICATION SUMMARY ===')
const counts = {
  total: results.length,
  service: results.filter(r => r.isService).length,
  sortedOutput: results.filter(r => r.isSortedOutput).length,
  exact: results.filter(r => r.matchType === 'EXACT').length,
  alias: results.filter(r => r.matchType === 'ALIAS' || r.matchType === 'ALIAS_CONTAINS').length,
  sortedDuplicate: results.filter(r => r.matchStatus === 'SORTED_DUPLICATE').length,
  unmatchedSpelling: results.filter(r => r.matchStatus === 'UNMATCHED' && r.problemType === 'spelling').length,
  unmatchedMissing: results.filter(r => r.matchStatus === 'UNMATCHED' && r.problemType === 'missing').length,
}
console.log('Counts:', counts)

console.log('\n=== NON-EXACT MATCHES ===')
for (const r of results) {
  if (r.matchType === 'EXACT' || r.isService) continue
  console.log(`  [${r.oldCode}] ${r.rawName} (group ${r.groupCode}=${r.groupName}) → status=${r.matchStatus}, type=${r.problemType}, action=${r.recommendedAction}, conf=${r.confidence}`)
  if (r.candidates) {
    for (const c of r.candidates.slice(0, 2)) {
      console.log(`     candidate: ${c.product.name} (${c.product.categoryName}) sim=${(c.sim.score*100).toFixed(0)}% — ${c.sim.reason}`)
    }
  }
}

console.log('\n=== OLD/SOURCE DUPLICATES ===')
for (const [name, arr] of oldDuplicateGroups) {
  console.log(`  "${name}" × ${arr.length}:`)
  for (const r of arr) {
    console.log(`     [${r.oldCode}] group ${r.groupCode}=${r.groupName} (row ${r.rowIdx})`)
  }
}

console.log('\n=== METALTRACK NEAR-DUPLICATES ===')
for (const d of mtNearDupes) {
  console.log(`  "${d.a.name}" (${d.a.categoryName}) ↔ "${d.b.name}" (${d.b.categoryName}) — ${(d.sim.score*100).toFixed(0)}% — ${d.sim.reason}`)
}
