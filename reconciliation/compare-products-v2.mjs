/**
 * Compare full old product list (รายการสิ้นต้า.xls) against MetalTrack product master.
 * v2: Fixed sorted-output category derivation (5-digit codes encode original group).
 *
 * Sorted-output code structure: 11XYZ where XY = original group code (01-09)
 *   11101 = group 11 + 01 = เหล็ก
 *   11201 = group 11 + 02 = อลูมิเนียม
 *   11301 = group 11 + 03 = ทองแดง
 *   11501 = group 11 + 05 = แสตนเลส
 *   etc.
 */
import xlsx from 'xlsx'
import fs from 'fs'

const FILE = '/home/z/my-project/upload/รายการสิ้นต้า.xls'
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })
const mtProducts = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/mt-products.json', 'utf8'))

function fixThaiText(text) {
  if (text == null) return ''
  if (typeof text !== 'string') text = String(text)
  const hasGarbled = [...text].some(c => c.charCodeAt(0) >= 0x80 && c.charCodeAt(0) <= 0xFF)
  if (!hasGarbled) return text
  try {
    const bytes = new Uint8Array([...text].map(c => c.charCodeAt(0) & 0xFF))
    return new TextDecoder('windows-874').decode(bytes)
  } catch { return text }
}

function normalize(s) {
  if (s == null) return ''
  let t = fixThaiText(s)
  t = t.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.normalize('NFC')
  return t
}

const GROUP_TO_MT_CATEGORY = {
  '01': 'เหล็ก', '02': 'อลูมิเนียม', '03': 'ทองแดง', '04': 'ทองเหลือง',
  '05': 'แสตนเลส', '06': 'ตะกั่ว', '07': 'อิเล็กทรอนิกส์',
  '08': 'อื่นๆ', '09': 'พลาสติก',
}

const oldProducts = []
let currentGroup = null
let currentGroupName = null

for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThaiText(c) : c))

  if (fixed[0] && /^\d{2}$/.test(String(fixed[0]).trim()) && fixed[1] && !fixed[2]) {
    currentGroup = String(fixed[0]).trim()
    currentGroupName = String(fixed[1]).trim()
    continue
  }
  if (fixed[1] && /^\d{4,5}$/.test(String(fixed[1]).trim()) && fixed[2]) {
    const code = String(fixed[1]).trim()
    const rawName = String(fixed[2]).trim()
    const normName = normalize(rawName)
    const unit = fixed[4] ? String(fixed[4]).trim() : ''

    // For sorted-output entries (5-digit codes starting with 11), derive original group
    let derivedMtCategory = currentGroup ? GROUP_TO_MT_CATEGORY[currentGroup] : null
    let originalGroupCode = null
    let originalGroupName = null
    if (currentGroup === '11' && code.length === 5) {
      originalGroupCode = code.substring(2, 4)  // e.g. "11205" → "02"
      originalGroupName = ({
        '01': 'เหล็ก', '02': 'อลูมิเนียม', '03': 'ทองแดง', '04': 'ทองเหลือง',
        '05': 'แสตนเลส', '06': 'ตะกั่ว', '07': 'ขยะอิเล็กทรอนิค',
        '08': 'อื่นๆ', '09': 'พลาสติก',
      })[originalGroupCode] || null
      derivedMtCategory = GROUP_TO_MT_CATEGORY[originalGroupCode] || null
    }

    oldProducts.push({
      oldCode: code,
      rawName, normName,
      groupCode: currentGroup, groupName: currentGroupName,
      unit, rowIdx: i,
      mtCategory: derivedMtCategory,
      originalGroupCode, originalGroupName,
      isService: currentGroup === '10',
      isSortedOutput: currentGroup === '11',
    })
  }
}

const SAFE_ALIASES = {
  'อลูมิเนียมแข็ง (หล่อ/หนา)': 'อลูมีเนียมแข็ง',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมีเนียมเนียม',  // NOTE: broken alias — target doesn't exist in MT
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมีเนียม',
  'อลูมิเนียมตูดกะทะ': 'อลูมีเนียมตูดกะทะ',
}

const productMap = new Map()
for (const p of mtProducts) productMap.set(p.name.trim().normalize('NFC'), p)

const productsByCategory = new Map()
for (const p of mtProducts) {
  if (!productsByCategory.has(p.categoryName)) productsByCategory.set(p.categoryName, [])
  productsByCategory.get(p.categoryName).push(p)
}

function matchProduct(excelName, restrictToMtCategory = null) {
  const trimmed = excelName.trim().normalize('NFC')
  if (productMap.has(trimmed)) {
    return { product: productMap.get(trimmed), matchType: 'EXACT', reason: 'exact name match (NFC normalized)' }
  }
  const alias = SAFE_ALIASES[excelName.trim()]?.normalize('NFC')
  if (alias && productMap.has(alias)) {
    return { product: productMap.get(alias), matchType: 'ALIAS', reason: `safe alias "${excelName}" → "${productMap.get(alias).name}"` }
  }
  const candidatePool = restrictToMtCategory ? (productsByCategory.get(restrictToMtCategory) || []) : mtProducts
  const contains = candidatePool.filter(p => {
    const pn = p.name.normalize('NFC')
    return pn.includes(trimmed) || trimmed.includes(pn)
  })
  if (contains.length === 1) {
    return { product: contains[0], matchType: 'ALIAS_CONTAINS', reason: `single contains-match in category "${restrictToMtCategory || 'ALL'}"` }
  }
  return null
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

function similarity(a, b) {
  if (!a || !b) return { score: 0, reason: 'empty' }
  const la = a.toLowerCase()
  const lb = b.toLowerCase()
  if (la === lb) return { score: 1.0, reason: 'case-insensitive exact' }
  if (la.includes(lb) || lb.includes(la)) {
    const shorter = Math.min(la.length, lb.length)
    const longer = Math.max(la.length, lb.length)
    return { score: shorter / longer * 0.95, reason: 'one is substring of other' }
  }
  const dist = levenshtein(la, lb)
  const maxLen = Math.max(la.length, lb.length)
  const score = 1 - dist / maxLen
  const stripped = s => s.replace(/[\s,\-_/()]/g, '')
  if (stripped(la) === stripped(lb)) {
    return { score: 0.95, reason: 'differ only in punctuation/spacing' }
  }
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

const results = []
for (const op of oldProducts) {
  const r = { ...op, match: null, matchType: null, matchStatus: null, problemType: null, recommendedAction: null, reason: null, confidence: null, candidates: null }

  if (op.isService) {
    r.matchStatus = 'SERVICE_NOT_PRODUCT'
    r.problemType = 'service'
    r.recommendedAction = 'do not import (service, not a product)'
    r.reason = 'Old/source entry is a weighing service (ชั่งรถ) — not a metal/product. Should not appear in Buy Excel.'
    r.confidence = 'high'
    results.push(r)
    continue
  }

  if (op.isSortedOutput) {
    const stripped = op.normName.replace(/\s*\(คัดแยก\)\s*$/, '').replace(/\s*\(คัดแยก\)\s*/, '').trim()
    // Use derived category from 5-digit code
    const m = matchProduct(stripped, op.mtCategory)
    if (m) {
      r.match = m.product
      r.matchType = m.matchType
      r.matchStatus = 'SORTED_DUPLICATE'
      r.problemType = 'duplicate'
      r.recommendedAction = 'do not import as separate product — sorted output uses same product'
      r.reason = `Sorted-output entry (original group ${op.originalGroupCode}/${op.originalGroupName}). Stripped name "${stripped}" matches "${m.product.name}" in MT category "${op.mtCategory}".`
      r.confidence = 'high'
    } else {
      // Try fuzzy within derived category
      const candidatePool = op.mtCategory ? (productsByCategory.get(op.mtCategory) || []) : mtProducts
      const candidates = []
      for (const p of candidatePool) {
        const sim = similarity(stripped, p.name.normalize('NFC'))
        if (sim.score > 0) candidates.push({ product: p, sim })
      }
      candidates.sort((a, b) => b.sim.score - a.sim.score)
      r.candidates = candidates.slice(0, 3)
      if (candidates.length > 0 && candidates[0].sim.score >= 0.85) {
        r.matchStatus = 'UNMATCHED'
        r.problemType = 'spelling'
        r.recommendedAction = 'add explicit alias (or fix sorted-output naming)'
        r.reason = `Sorted-output entry (orig group ${op.originalGroupCode}/${op.originalGroupName}). Stripped name "${stripped}" not found in MT category "${op.mtCategory}". Closest match "${candidates[0].product.name}" (${(candidates[0].sim.score*100).toFixed(0)}%).`
        r.confidence = candidates[0].sim.score >= 0.9 ? 'high' : 'medium'
      } else {
        r.matchStatus = 'UNMATCHED'
        r.problemType = 'missing'
        r.recommendedAction = 'owner review required'
        r.reason = `Sorted-output entry (orig group ${op.originalGroupCode}/${op.originalGroupName}). Stripped name "${stripped}" not found in MT category "${op.mtCategory}". Best similarity: ${candidates[0] ? (candidates[0].sim.score*100).toFixed(0)+'%' : 'none'}.`
        r.confidence = 'low'
      }
    }
    results.push(r)
    continue
  }

  // Regular product
  const m = matchProduct(op.normName, op.mtCategory)
  if (m) {
    r.match = m.product
    r.matchType = m.matchType
    if (m.matchType === 'EXACT') {
      r.matchStatus = 'MATCHED'; r.problemType = null; r.recommendedAction = null
      r.reason = 'exact name match'; r.confidence = 'high'
    } else {
      r.matchStatus = 'ALIAS'; r.problemType = null; r.recommendedAction = null
      r.reason = m.reason; r.confidence = 'high'
    }
  } else {
    const candidatePool = op.mtCategory ? (productsByCategory.get(op.mtCategory) || []) : mtProducts
    const candidates = []
    for (const p of candidatePool) {
      const sim = similarity(op.normName, p.name.normalize('NFC'))
      if (sim.score > 0) candidates.push({ product: p, sim })
    }
    candidates.sort((a, b) => b.sim.score - a.sim.score)
    r.candidates = candidates.slice(0, 3)
    if (candidates.length > 0 && candidates[0].sim.score >= 0.8) {
      r.matchStatus = 'UNMATCHED'; r.problemType = 'spelling'
      r.recommendedAction = 'add explicit alias'
      r.reason = `Closest match "${candidates[0].product.name}" (similarity ${(candidates[0].sim.score*100).toFixed(0)}%): ${candidates[0].sim.reason}`
      r.confidence = candidates[0].sim.score >= 0.9 ? 'high' : 'medium'
    } else if (candidates.length > 0 && candidates[0].sim.score >= 0.5) {
      r.matchStatus = 'UNMATCHED'; r.problemType = 'spelling'
      r.recommendedAction = 'owner review required'
      r.reason = `Closest match "${candidates[0].product.name}" (similarity ${(candidates[0].sim.score*100).toFixed(0)}%): ${candidates[0].sim.reason}`
      r.confidence = 'low'
    } else {
      r.matchStatus = 'UNMATCHED'; r.problemType = 'missing'
      r.recommendedAction = 'create new product'
      r.reason = `No close match in MT category "${op.mtCategory}" (best similarity: ${candidates[0] ? (candidates[0].sim.score*100).toFixed(0)+'%' : 'none'})`
      r.confidence = 'low'
    }
  }
  results.push(r)
}

// Detect duplicates
const oldDupes = new Map()
for (const r of results) {
  if (r.isService) continue
  const key = r.normName
  if (!oldDupes.has(key)) oldDupes.set(key, [])
  oldDupes.get(key).push(r)
}
const oldDuplicateGroups = [...oldDupes.entries()].filter(([_, arr]) => arr.length > 1)

const mtNearDupes = []
for (let i = 0; i < mtProducts.length; i++) {
  for (let j = i + 1; j < mtProducts.length; j++) {
    const a = mtProducts[i].name.normalize('NFC')
    const b = mtProducts[j].name.normalize('NFC')
    const sim = similarity(a, b)
    if (sim.score >= 0.85) mtNearDupes.push({ a: mtProducts[i], b: mtProducts[j], sim })
  }
}

fs.writeFileSync('/home/z/my-project/reconciliation/comparison-results.json', JSON.stringify({
  oldProducts: results.map(r => ({
    oldCode: r.oldCode, rawName: r.rawName, normName: r.normName,
    groupCode: r.groupCode, groupName: r.groupName, mtCategory: r.mtCategory,
    originalGroupCode: r.originalGroupCode, originalGroupName: r.originalGroupName,
    isService: r.isService, isSortedOutput: r.isSortedOutput, rowIdx: r.rowIdx,
    matchStatus: r.matchStatus, matchType: r.matchType,
    matchedProductId: r.match?.id || null,
    matchedProductName: r.match?.name || null,
    matchedProductCategory: r.match?.categoryName || null,
    problemType: r.problemType, recommendedAction: r.recommendedAction,
    reason: r.reason, confidence: r.confidence,
    candidates: r.candidates ? r.candidates.map(c => ({
      productId: c.product.id, productName: c.product.name,
      categoryName: c.product.categoryName,
      similarity: c.sim.score, similarityReason: c.sim.reason,
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

console.log('v2 results saved. Summary:')
const regular = results.filter(r => !r.isService && !r.isSortedOutput)
const sorted = results.filter(r => r.isSortedOutput)
console.log(`  Regular products: ${regular.length}`)
console.log(`    EXACT: ${regular.filter(r => r.matchType === 'EXACT').length}`)
console.log(`    ALIAS: ${regular.filter(r => r.matchType === 'ALIAS' || r.matchType === 'ALIAS_CONTAINS').length}`)
console.log(`    UNMATCHED spelling: ${regular.filter(r => r.matchStatus === 'UNMATCHED' && r.problemType === 'spelling').length}`)
console.log(`    UNMATCHED missing: ${regular.filter(r => r.matchStatus === 'UNMATCHED' && r.problemType === 'missing').length}`)
console.log(`  Sorted-output entries: ${sorted.length}`)
console.log(`    SORTED_DUPLICATE (matched): ${sorted.filter(r => r.matchStatus === 'SORTED_DUPLICATE').length}`)
console.log(`    UNMATCHED: ${sorted.filter(r => r.matchStatus === 'UNMATCHED').length}`)
