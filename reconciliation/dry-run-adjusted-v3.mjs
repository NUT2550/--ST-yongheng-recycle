/**
 * v3: Improved matching — prefer closest match (highest similarity) when multiple contains-matches exist.
 * Also handle แสตนเลส 304 ยาว → แสตนเลส 304 (ยาว) correctly.
 */
import xlsx from 'xlsx'
import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

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

// Parse adjusted file
const FILE = '/home/z/my-project/upload/รายการสิ้นต้า_ปรับแล้ว.xls'
const buf = fs.readFileSync(FILE)
const wb = xlsx.read(buf, { type: 'buffer', codepage: 874 })
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null })

const GROUP_TO_MT_CATEGORY = {
  '01': 'เหล็ก', '02': 'อลูมิเนียม', '03': 'ทองแดง', '04': 'ทองเหลือง',
  '05': 'แสตนเลส', '06': 'ตะกั่ว', '07': 'อิเล็กทรอนิกส์',
  '08': 'อื่นๆ', '09': 'พลาสติก',
}

const adjustedProducts = []
let currentGroup = null, currentGroupName = null
for (let i = 0; i < rows.length; i++) {
  const r = rows[i] || []
  const fixed = r.map(c => c == null ? null : (typeof c === 'string' ? fixThai(c) : c))
  if (fixed[0] && /^\d{2}$/.test(String(fixed[0]).trim())) {
    currentGroup = String(fixed[0]).trim()
    currentGroupName = fixed[1] ? String(fixed[1]).trim() : null
    continue
  }
  if (fixed[1] && /^\d{4,5}$/.test(String(fixed[1]).trim())) {
    const code = String(fixed[1]).trim()
    const rawName = fixed[2] ? String(fixed[2]).trim() : ''
    const normName = normalize(rawName)
    if (!normName) continue
    adjustedProducts.push({
      oldCode: code, rawName, normName,
      groupCode: currentGroup, groupName: currentGroupName,
      unit: fixed[4] ? String(fixed[4]).trim() : '', rowIdx: i,
      mtCategory: currentGroup ? GROUP_TO_MT_CATEGORY[currentGroup] : null,
      isService: currentGroup === '10', isSortedOutput: currentGroup === '11',
    })
  } else if (fixed[2] && String(fixed[2]).trim() && !fixed[1]) {
    const rawName = String(fixed[2]).trim()
    const normName = normalize(rawName)
    if (!normName) continue
    adjustedProducts.push({
      oldCode: null, rawName, normName,
      groupCode: currentGroup, groupName: currentGroupName,
      unit: fixed[4] ? String(fixed[4]).trim() : '', rowIdx: i,
      mtCategory: currentGroup ? GROUP_TO_MT_CATEGORY[currentGroup] : null,
      isService: currentGroup === '10', isSortedOutput: currentGroup === '11',
      noCode: true,
    })
  }
}

// Load MT products (batch)
const mtProductsRaw = await db.product.findMany({ include: { category: true }, orderBy: [{ categoryId: 'asc' }, { sortOrder: 'asc' }] })
const [stockByProduct, buyItemByProduct, sellItemByProduct, sortSourceByProduct, sortItemByProduct, transferSourceByProduct, transferItemByProduct] = await Promise.all([
  db.stockLot.groupBy({ by: ['productId'], _sum: { remainingWeight: true }, _count: true }),
  db.buyBillItem.groupBy({ by: ['productId'], _count: true }),
  db.sellBillItem.groupBy({ by: ['productId'], _count: true }),
  db.sortingBill.groupBy({ by: ['sourceProductId'], _count: true }),
  db.sortingBillItem.groupBy({ by: ['productId'], _count: true }),
  db.stockTransfer.groupBy({ by: ['sourceProductId'], _count: true }),
  db.stockTransferItem.groupBy({ by: ['productId'], _count: true }),
])
const stockMap = new Map(stockByProduct.map(s => [s.productId, { weight: s._sum.remainingWeight ?? 0, count: s._count }]))
const buyItemMap = new Map(buyItemByProduct.map(s => [s.productId, s._count]))
const sellItemMap = new Map(sellItemByProduct.map(s => [s.productId, s._count]))
const sortSourceMap = new Map(sortSourceByProduct.map(s => [s.sourceProductId, s._count]))
const sortItemMap = new Map(sortItemByProduct.map(s => [s.productId, s._count]))
const transferSourceMap = new Map(transferSourceByProduct.map(s => [s.sourceProductId, s._count]))
const transferItemMap = new Map(transferItemByProduct.map(s => [s.productId, s._count]))

const mtProducts = mtProductsRaw.map(p => {
  const stock = stockMap.get(p.id) || { weight: 0, count: 0 }
  const buyItem = buyItemMap.get(p.id) || 0
  const sellItem = sellItemMap.get(p.id) || 0
  const sortSource = sortSourceMap.get(p.id) || 0
  const sortItem = sortItemMap.get(p.id) || 0
  const transferSource = transferSourceMap.get(p.id) || 0
  const transferItem = transferItemMap.get(p.id) || 0
  const hasMovement = (buyItem + sellItem + sortSource + sortItem + transferSource + transferItem) > 0
  return {
    id: p.id, name: p.name, normName: normalize(p.name),
    categoryId: p.categoryId, categoryName: p.category.name,
    defaultBuyPrice: p.defaultBuyPrice, sortOrder: p.sortOrder,
    stockWeight: stock.weight, stockLotCount: stock.count,
    hasStockLots: stock.count > 0, hasMovement,
    movementCounts: { buyItem, sellItem, sortSource, sortItem, transferSource, transferItem },
  }
})

const mtByName = new Map()
const mtByNameAndCategory = new Map()
for (const p of mtProducts) {
  mtByName.set(p.normName, p)
  mtByNameAndCategory.set(`${p.categoryName}|${p.normName}`, p)
}

function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n; if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1))
  }
  return dp[m][n]
}
function similarity(a, b) {
  if (!a || !b) return { score: 0, reason: 'empty' }
  const la = a.toLowerCase(), lb = b.toLowerCase()
  if (la === lb) return { score: 1.0, reason: 'exact' }
  if (la.includes(lb) || lb.includes(la)) {
    const shorter = Math.min(la.length, lb.length), longer = Math.max(la.length, lb.length)
    return { score: shorter / longer * 0.95, reason: 'substring' }
  }
  const dist = levenshtein(la, lb)
  const maxLen = Math.max(la.length, lb.length)
  const score = 1 - dist / maxLen
  const stripped = s => s.replace(/[\s,\-_/()]/g, '')
  if (stripped(la) === stripped(lb)) return { score: 0.95, reason: 'punctuation-only' }
  const setA = new Set(la), setB = new Set(lb)
  const intersection = [...setA].filter(c => setB.has(c)).length
  const union = new Set([...setA, ...setB]).size
  const jaccard = intersection / union
  if (jaccard > 0.8) return { score: Math.max(score, jaccard * 0.85), reason: `jaccard ${(jaccard*100).toFixed(0)}%` }
  return { score: score * 0.7, reason: `lev ${dist}/${maxLen}` }
}

function findMatch(adj) {
  // 1. Exact name + same category
  const exactCat = mtByNameAndCategory.get(`${adj.mtCategory}|${adj.normName}`)
  if (exactCat) return { product: exactCat, matchType: 'EXACT_MATCH', confidence: 'high', reason: `exact name + same category (${adj.mtCategory})` }
  
  // 2. Exact name, different category
  const exactName = mtByName.get(adj.normName)
  if (exactName) return { product: exactName, matchType: 'CATEGORY_CHANGE', confidence: 'high', reason: `exact name, different category (MT: ${exactName.categoryName}, adjusted: ${adj.mtCategory})` }
  
  // 3. Within same category, find ALL candidates and pick the best (highest similarity)
  const sameCatProducts = mtProducts.filter(p => p.categoryName === adj.mtCategory)
  const candidates = sameCatProducts.map(p => ({ product: p, sim: similarity(adj.normName, p.normName) }))
    .filter(c => c.sim.score >= 0.5)
    .sort((a, b) => b.sim.score - a.sim.score)
  
  if (candidates.length > 0 && candidates[0].sim.score >= 0.7) {
    const best = candidates[0]
    return { product: best.product, matchType: 'RENAME_EXISTING', confidence: best.sim.score >= 0.85 ? 'high' : 'medium', reason: `best fuzzy match in ${adj.mtCategory} (sim ${(best.sim.score*100).toFixed(0)}%): "${best.product.name}" → "${adj.rawName}"` }
  }
  
  return null
}

const results = []
for (const adj of adjustedProducts) {
  const r = { ...adj, classification: null, matchedProduct: null, confidence: null, reason: null }
  if (adj.isService || adj.isSortedOutput) {
    r.classification = 'SERVICE_OR_NON_STOCK'; r.confidence = 'high'
    r.reason = 'Service/sorted-output entry — not a stock product'
    results.push(r); continue
  }
  const match = findMatch(adj)
  if (match) {
    r.matchedProduct = match.product; r.classification = match.matchType
    r.confidence = match.confidence; r.reason = match.reason
  } else {
    const sameNameInAdjusted = adjustedProducts.filter(p => !p.isService && !p.isSortedOutput && p.normName === adj.normName)
    if (sameNameInAdjusted.length > 1) {
      r.classification = 'DUPLICATE_OR_COLLISION'; r.confidence = 'high'
      r.reason = `Name appears ${sameNameInAdjusted.length}x in adjusted file`
    } else {
      r.classification = 'CREATE_NEW_PRODUCT'; r.confidence = 'high'
      r.reason = `No match in MT category "${adj.mtCategory}" — new product needed`
    }
  }
  results.push(r)
}

const adjustedNames = new Set(results.filter(r => !r.isService && !r.isSortedOutput).map(r => r.normName))
const mtNotInAdjusted = []
for (const p of mtProducts) {
  if (adjustedNames.has(p.normName)) continue
  const wasMatched = results.some(r => r.matchedProduct?.id === p.id && (r.classification === 'RENAME_EXISTING' || r.classification === 'EXACT_MATCH' || r.classification === 'CATEGORY_CHANGE'))
  if (!wasMatched) mtNotInAdjusted.push(p)
}

const adjustedNameCounts = new Map()
for (const r of results) {
  if (r.isService || r.isSortedOutput) continue
  if (!adjustedNameCounts.has(r.normName)) adjustedNameCounts.set(r.normName, [])
  adjustedNameCounts.get(r.normName).push(r)
}
const adjustedDuplicates = [...adjustedNameCounts.entries()].filter(([_, arr]) => arr.length > 1)

const collisions = []
for (const r of results) {
  if (r.classification === 'RENAME_EXISTING' || r.classification === 'CATEGORY_CHANGE') {
    const collision = mtProducts.find(p => p.id !== r.matchedProduct.id && p.normName === r.normName)
    if (collision) collisions.push({ adjusted: r, mtProductA: r.matchedProduct, mtProductB: collision })
  }
}

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
  mtNotInAdjusted: mtNotInAdjusted.map(p => ({ id: p.id, name: p.name, categoryName: p.categoryName, stockWeight: p.stockWeight, stockLotCount: p.stockLotCount, hasStockLots: p.hasStockLots, hasMovement: p.hasMovement, movementCounts: p.movementCounts })),
  adjustedDuplicates: adjustedDuplicates.map(([name, arr]) => ({ name, entries: arr.map(r => ({ oldCode: r.oldCode, groupCode: r.groupCode, groupName: r.groupName, rowIdx: r.rowIdx })) })),
  collisions: collisions.map(c => ({
    adjustedName: c.adjusted.rawName,
    mtProductA: { id: c.mtProductA.id, name: c.mtProductA.name, category: c.mtProductA.categoryName },
    mtProductB: { id: c.mtProductB.id, name: c.mtProductB.name, category: c.mtProductB.categoryName },
  })),
}, null, 2))

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
console.log('=== SUMMARY (v3) ===')
console.log(JSON.stringify(counts, null, 2))

await db.$disconnect()
