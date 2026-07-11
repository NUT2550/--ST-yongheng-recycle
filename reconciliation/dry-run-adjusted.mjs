/**
 * Phase 1-3: Parse adjusted file + load MT products + dry-run comparison.
 * REPORT-ONLY — NO DB modifications.
 *
 * STOP at owner approval gate (do NOT apply).
 */
import xlsx from 'xlsx'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

// ============ NORMALIZATION ============
function fixThai(s) {
  if (s == null) return ''
  if (typeof s !== 'string') s = String(s)
  if (/[\x80-\xFF]/.test(s)) {
    try { return new TextDecoder('windows-874').decode(Buffer.from(s, 'latin1')) } catch { return s }
  }
  return s
}
function normalize(s) {
  if (s == null) return ''
  let t = fixThai(s)
  t = t.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, ' ')
  t = t.replace(/\s+/g, ' ').trim()
  t = t.normalize('NFC')
  return t
}

// ============ PHASE 1: PARSE ADJUSTED FILE ============
console.log('=== PHASE 1: PARSE ADJUSTED FILE ===\n')
const FILE = '/home/z/my-project/upload/รายการสิ้นต้า_ปรับแล้ว.xls'
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

// Group code → MT category name
const GROUP_TO_MT_CATEGORY = {
  '01': 'เหล็ก', '02': 'อลูมิเนียม', '03': 'ทองแดง', '04': 'ทองเหลือง',
  '05': 'แสตนเลส', '06': 'ตะกั่ว', '07': 'อิเล็กทรอนิกส์',
  '08': 'อื่นๆ', '09': 'พลาสติก',
  '10': null,  // รายรับอื่นๆ (services)
  '11': null,  // คัดแยก (sorted output)
}

const adjustedProducts = []
let currentGroup = null
let currentGroupName = null
let groupSortOrder = 0

for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))

  // Group header: col 0 = 2-digit code, col 1 = group name (or null), col 2 = null
  if (fixed[0] && /^\d{2}$/.test(String(fixed[0]).trim())) {
    currentGroup = String(fixed[0]).trim()
    currentGroupName = fixed[1] ? String(fixed[1]).trim() : null
    groupSortOrder++
    continue
  }
  // Product row: col 1 = 4-digit (or 5-digit) code, col 2 = product name
  if (fixed[1] && /^\d{4,5}$/.test(String(fixed[1]).trim())) {
    const code = String(fixed[1]).trim()
    const rawName = fixed[2] ? String(fixed[2]).trim() : ''
    const normName = normalize(rawName)
    const unit = fixed[4] ? String(fixed[4]).trim() : ''
    
    // Skip empty-name rows (code only, no name)
    if (!normName) continue
    
    adjustedProducts.push({
      oldCode: code,
      rawName,
      normName,
      groupCode: currentGroup,
      groupName: currentGroupName,
      unit,
      rowIdx: i,
      mtCategory: currentGroup ? GROUP_TO_MT_CATEGORY[currentGroup] : null,
      isService: currentGroup === '10',
      isSortedOutput: currentGroup === '11',
    })
  }
  // Row with no code but has name (e.g. แผงวงจรเขียว at row 117, ของแกะราคาสูง at row 134)
  else if (fixed[2] && String(fixed[2]).trim() && !fixed[1]) {
    const rawName = String(fixed[2]).trim()
    const normName = normalize(rawName)
    if (!normName) continue
    adjustedProducts.push({
      oldCode: null,
      rawName,
      normName,
      groupCode: currentGroup,
      groupName: currentGroupName,
      unit: fixed[4] ? String(fixed[4]).trim() : '',
      rowIdx: i,
      mtCategory: currentGroup ? GROUP_TO_MT_CATEGORY[currentGroup] : null,
      isService: currentGroup === '10',
      isSortedOutput: currentGroup === '11',
      noCode: true,
    })
  }
}

console.log(`Parsed ${adjustedProducts.length} product entries from adjusted file`)
console.log(`  Service entries (group 10): ${adjustedProducts.filter(p => p.isService).length}`)
console.log(`  Sorted-output entries (group 11): ${adjustedProducts.filter(p => p.isSortedOutput).length}`)
console.log(`  Regular products (groups 01-09): ${adjustedProducts.filter(p => !p.isService && !p.isSortedOutput).length}`)

// ============ PHASE 2: LOAD CURRENT METALTRACK PRODUCTS ============
console.log('\n=== PHASE 2: LOAD CURRENT METALTRACK PRODUCTS ===\n')
const mtCategories = await db.productCategory.findMany({ orderBy: { sortOrder: 'asc' } })
const mtProductsRaw = await db.product.findMany({
  include: { category: true },
  orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }],
})
console.log(`MetalTrack categories: ${mtCategories.length}`)
console.log(`MetalTrack products: ${mtProductsRaw.length}`)

// Enrich MT products with stock + movement history info
const mtProducts = []
for (const p of mtProductsRaw) {
  const stockLots = await db.stockLot.aggregate({
    where: { productId: p.id },
    _sum: { remainingWeight: true },
    _count: true,
  })
  const buyItemCount = await db.buyBillItem.count({ where: { productId: p.id } })
  const sellItemCount = await db.sellBillItem.count({ where: { productId: p.id } })
  const sortingSourceCount = await db.sortingBill.count({ where: { sourceProductId: p.id } })
  const sortingItemCount = await db.sortingBillItem.count({ where: { productId: p.id } })
  const transferSourceCount = await db.stockTransfer.count({ where: { sourceProductId: p.id } })
  const transferItemCount = await db.stockTransferItem.count({ where: { productId: p.id } })
  const hasMovement = (buyItemCount + sellItemCount + sortingSourceCount + sortingItemCount + transferSourceCount + transferItemCount) > 0
  mtProducts.push({
    id: p.id,
    name: p.name,
    normName: normalize(p.name),
    categoryId: p.categoryId,
    categoryName: p.category.name,
    defaultBuyPrice: p.defaultBuyPrice,
    sortOrder: p.sortOrder,
    stockWeight: stockLots._sum.remainingWeight ?? 0,
    stockLotCount: stockLots._count,
    hasStockLots: stockLots._count > 0,
    hasMovement,
    movementCounts: { buyItem: buyItemCount, sellItem: sellItemCount, sortSource: sortingSourceCount, sortItem: sortingItemCount, transferSource: transferSourceCount, transferItem: transferItemCount },
  })
}
console.log(`Enriched ${mtProducts.length} MT products with stock + movement info`)

// ============ PHASE 3: DRY-RUN COMPARISON ============
console.log('\n=== PHASE 3: DRY-RUN COMPARISON ===\n')

// Build MT lookup maps
const mtByName = new Map()  // normalized name → product
const mtByNameAndCategory = new Map()  // `${categoryName}|${normName}` → product
for (const p of mtProducts) {
  mtByName.set(p.normName, p)
  mtByNameAndCategory.set(`${p.categoryName}|${p.normName}`, p)
}

// Helper: find best MT match for an adjusted product (within same category)
function findMatch(adj) {
  // 1. Exact name + same category
  const exactCat = mtByNameAndCategory.get(`${adj.mtCategory}|${adj.normName}`)
  if (exactCat) return { product: exactCat, matchType: 'EXACT_MATCH', confidence: 'high', reason: `exact name + same category (${adj.mtCategory})` }
  
  // 2. Exact name (different category)
  const exactName = mtByName.get(adj.normName)
  if (exactName) return { product: exactName, matchType: 'CATEGORY_CHANGE', confidence: 'high', reason: `exact name but different category (MT: ${exactName.categoryName}, adjusted: ${adj.mtCategory})` }
  
  // 3. Same code + similar name (rename within same category)
  const sameCodeSameCat = mtProducts.find(p => {
    // Check if MT product's oldCode matches — but MT doesn't store oldCode, so use category + contains match
    return p.categoryName === adj.mtCategory && (
      p.normName.includes(adj.normName) || adj.normName.includes(p.normName)
    )
  })
  if (sameCodeSameCat) {
    // Calculate similarity to confirm it's a rename, not a different product
    const sim = similarity(adj.normName, sameCodeSameCat.normName)
    if (sim >= 0.5) {
      return { product: sameCodeSameCat, matchType: 'RENAME_EXISTING', confidence: sim >= 0.8 ? 'high' : 'medium', reason: `likely rename within same category (similarity ${(sim*100).toFixed(0)}%): "${sameCodeSameCat.name}" → "${adj.rawName}"` }
    }
  }
  
  // 4. Fuzzy match within same category
  const candidates = mtProducts.filter(p => p.categoryName === adj.mtCategory).map(p => ({
    product: p,
    sim: similarity(adj.normName, p.normName),
  })).filter(c => c.sim.score > 0.5).sort((a, b) => b.sim.score - a.sim.score)
  
  if (candidates.length > 0 && candidates[0].sim.score >= 0.7) {
    return { product: candidates[0].product, matchType: 'RENAME_EXISTING', confidence: candidates[0].sim.score >= 0.85 ? 'high' : 'medium', reason: `fuzzy match within same category (similarity ${(candidates[0].sim.score*100).toFixed(0)}%): "${candidates[0].product.name}" → "${adj.rawName}"` }
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
  const la = a.toLowerCase(), lb = b.toLowerCase()
  if (la === lb) return { score: 1.0, reason: 'case-insensitive exact' }
  if (la.includes(lb) || lb.includes(la)) {
    const shorter = Math.min(la.length, lb.length), longer = Math.max(la.length, lb.length)
    return { score: shorter / longer * 0.95, reason: 'substring' }
  }
  const dist = levenshtein(la, lb)
  const maxLen = Math.max(la.length, lb.length)
  const score = 1 - dist / maxLen
  const stripped = s => s.replace(/[\s,\-_/()]/g, '')
  if (stripped(la) === stripped(lb)) return { score: 0.95, reason: 'punctuation-only diff' }
  const setA = new Set(la), setB = new Set(lb)
  const intersection = [...setA].filter(c => setB.has(c)).length
  const union = new Set([...setA, ...setB]).size
  const jaccard = intersection / union
  if (jaccard > 0.8) return { score: Math.max(score, jaccard * 0.85), reason: `jaccard ${(jaccard*100).toFixed(0)}%` }
  return { score: score * 0.7, reason: `levenshtein ${dist}/${maxLen}` }
}

// Classify each adjusted product
const results = []
for (const adj of adjustedProducts) {
  const r = { ...adj, classification: null, matchedProduct: null, confidence: null, reason: null }
  
  if (adj.isService) {
    r.classification = 'SERVICE_OR_NON_STOCK'
    r.confidence = 'high'
    r.reason = 'Service entry (group 10) — not a stock product'
    results.push(r)
    continue
  }
  if (adj.isSortedOutput) {
    r.classification = 'SERVICE_OR_NON_STOCK'
    r.confidence = 'high'
    r.reason = 'Sorted-output entry (group 11) — not a separate product'
    results.push(r)
    continue
  }
  
  const match = findMatch(adj)
  if (match) {
    r.matchedProduct = match.product
    r.classification = match.matchType
    r.confidence = match.confidence
    r.reason = match.reason
  } else {
    // Check for duplicate/collision: does this name already exist in adjusted file (count > 1)?
    const sameNameInAdjusted = adjustedProducts.filter(p => !p.isService && !p.isSortedOutput && p.normName === adj.normName)
    if (sameNameInAdjusted.length > 1) {
      r.classification = 'DUPLICATE_OR_COLLISION'
      r.confidence = 'high'
      r.reason = `Name appears ${sameNameInAdjusted.length}x in adjusted file`
    } else {
      r.classification = 'CREATE_NEW_PRODUCT'
      r.confidence = 'high'
      r.reason = `No match found in MT category "${adj.mtCategory}" — new product needed`
    }
  }
  results.push(r)
}

// Find MT products not in adjusted file
const adjustedNames = new Set(results.filter(r => !r.isService && !r.isSortedOutput).map(r => r.normName))
const mtNotInAdjusted = []
for (const p of mtProducts) {
  if (!adjustedNames.has(p.normName)) {
    // Check if it was matched via RENAME_EXISTING (then it's covered)
    const wasRenamed = results.some(r => r.matchedProduct?.id === p.id && r.classification === 'RENAME_EXISTING')
    const wasExact = results.some(r => r.matchedProduct?.id === p.id && r.classification === 'EXACT_MATCH')
    const wasCatChange = results.some(r => r.matchedProduct?.id === p.id && r.classification === 'CATEGORY_CHANGE')
    if (!wasRenamed && !wasExact && !wasCatChange) {
      mtNotInAdjusted.push(p)
    }
  }
}

// Find duplicates in adjusted file
const adjustedNameCounts = new Map()
for (const r of results) {
  if (r.isService || r.isSortedOutput) continue
  if (!adjustedNameCounts.has(r.normName)) adjustedNameCounts.set(r.normName, [])
  adjustedNameCounts.get(r.normName).push(r)
}
const adjustedDuplicates = [...adjustedNameCounts.entries()].filter(([_, arr]) => arr.length > 1)

// Find collision: would a rename create a duplicate name?
const collisions = []
for (const r of results) {
  if (r.classification === 'RENAME_EXISTING' || r.classification === 'CATEGORY_CHANGE') {
    // If we rename r.matchedProduct to r.normName, does that collide with another MT product?
    const collision = mtProducts.find(p => p.id !== r.matchedProduct.id && p.normName === r.normName)
    if (collision) {
      collisions.push({ adjusted: r, mtProductA: r.matchedProduct, mtProductB: collision })
    }
  }
}

// ============ SAVE RESULTS ============
fs.writeFileSync('/home/z/my-project/reconciliation/dry-run-results.json', JSON.stringify({
  adjustedProducts: results.map(r => ({
    oldCode: r.oldCode, rawName: r.rawName, normName: r.normName,
    groupCode: r.groupCode, groupName: r.groupName, mtCategory: r.mtCategory,
    isService: r.isService, isSortedOutput: r.isSortedOutput, noCode: r.noCode || false,
    rowIdx: r.rowIdx, unit: r.unit,
    classification: r.classification, confidence: r.confidence, reason: r.reason,
    matchedProductId: r.matchedProduct?.id || null,
    matchedProductName: r.matchedProduct?.name || null,
    matchedProductCategory: r.matchedProduct?.categoryName || null,
    matchedProductStockWeight: r.matchedProduct?.stockWeight ?? null,
    matchedProductHasStockLots: r.matchedProduct?.hasStockLots ?? null,
    matchedProductHasMovement: r.matchedProduct?.hasMovement ?? null,
  })),
  mtProducts: mtProducts.map(p => ({
    id: p.id, name: p.name, normName: p.normName, categoryId: p.categoryId,
    categoryName: p.categoryName, defaultBuyPrice: p.defaultBuyPrice, sortOrder: p.sortOrder,
    stockWeight: p.stockWeight, stockLotCount: p.stockLotCount,
    hasStockLots: p.hasStockLots, hasMovement: p.hasMovement, movementCounts: p.movementCounts,
  })),
  mtNotInAdjusted: mtNotInAdjusted.map(p => ({ id: p.id, name: p.name, categoryName: p.categoryName, stockWeight: p.stockWeight, stockLotCount: p.stockLotCount, hasStockLots: p.hasStockLots, hasMovement: p.hasMovement })),
  adjustedDuplicates: adjustedDuplicates.map(([name, arr]) => ({ name, entries: arr.map(r => ({ oldCode: r.oldCode, groupCode: r.groupCode, groupName: r.groupName, rowIdx: r.rowIdx })) })),
  collisions: collisions.map(c => ({
    adjustedName: c.adjusted.rawName,
    mtProductA: { id: c.mtProductA.id, name: c.mtProductA.name, category: c.mtProductA.categoryName },
    mtProductB: { id: c.mtProductB.id, name: c.mtProductB.name, category: c.mtProductB.categoryName },
  })),
}, null, 2))

// ============ CONSOLE OUTPUT: SUMMARY ============
const regular = results.filter(r => !r.isService && !r.isSortedOutput)
const counts = {
  EXACT_MATCH: regular.filter(r => r.classification === 'EXACT_MATCH').length,
  RENAME_EXISTING: regular.filter(r => r.classification === 'RENAME_EXISTING').length,
  CATEGORY_CHANGE: regular.filter(r => r.classification === 'CATEGORY_CHANGE').length,
  CREATE_NEW_PRODUCT: regular.filter(r => r.classification === 'CREATE_NEW_PRODUCT').length,
  DUPLICATE_OR_COLLISION: regular.filter(r => r.classification === 'DUPLICATE_OR_COLLISION').length,
  SERVICE_OR_NON_STOCK: results.filter(r => r.classification === 'SERVICE_OR_NON_STOCK').length,
  ARCHIVE_OR_IGNORE_OLD_PRODUCT: mtNotInAdjusted.length,
  COLLISIONS: collisions.length,
}
console.log('=== CLASSIFICATION SUMMARY ===')
console.log(JSON.stringify(counts, null, 2))
console.log(`\nAdjusted duplicates: ${adjustedDuplicates.length}`)
console.log(`MT not in adjusted: ${mtNotInAdjusted.length}`)

await db.$disconnect()
