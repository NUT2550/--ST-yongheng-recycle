/**
 * Post-process dry-run results: flag problematic matches as OWNER_REVIEW_REQUIRED.
 *
 * Detection rules:
 * 1. If a RENAME_EXISTING match has a DIFFERENT fuzzy candidate with sim >= 0.9
 *    (likely a closer match was missed due to contains-match priority)
 * 2. If a RENAME_EXISTING match targets a product with stock >= 100 kg
 *    (significant stock — owner should verify rename is safe)
 * 3. If a CATEGORY_CHANGE targets a product with stock or movement
 *    (changing category of a product with stock is risky)
 */
import fs from 'fs'

const data = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/dry-run-results.json', 'utf8'))

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
  if (!a || !b) return 0
  const la = a.toLowerCase(), lb = b.toLowerCase()
  if (la === lb) return 1.0
  const dist = levenshtein(la, lb)
  return 1 - dist / Math.max(la.length, lb.length)
}

let ownerReviewCount = 0
for (const p of data.adjustedProducts) {
  if (p.isService || p.isSortedOutput) continue
  if (p.classification !== 'RENAME_EXISTING' && p.classification !== 'CATEGORY_CHANGE') continue
  
  const flags = []
  
  // Rule 1: Check if there's a better fuzzy match that was missed
  if (p.classification === 'RENAME_EXISTING') {
    const matchedProduct = data.mtProducts.find(m => m.id === p.matchedProductId)
    if (matchedProduct) {
      // Find all MT products in same category with high fuzzy similarity
      const betterCandidates = data.mtProducts.filter(m => 
        m.categoryName === p.mtCategory && 
        m.id !== p.matchedProductId &&
        similarity(p.normName, m.normName) >= 0.9
      )
      if (betterCandidates.length > 0) {
        flags.push(`CLOSER_MATCH_EXISTS: "${betterCandidates[0].name}" has fuzzy sim ${(similarity(p.normName, betterCandidates[0].normName)*100).toFixed(0)}% but was not selected`)
      }
    }
  }
  
  // Rule 2: Rename targets product with significant stock (>= 100 kg)
  if (p.classification === 'RENAME_EXISTING' && p.matchedProductStockWeight >= 100) {
    flags.push(`SIGNIFICANT_STOCK: matched product has ${p.matchedProductStockWeight} kg stock — verify rename is safe`)
  }
  
  // Rule 3: Category change on product with stock/movement
  if (p.classification === 'CATEGORY_CHANGE' && (p.matchedProductHasStockLots || p.matchedProductHasMovement)) {
    flags.push(`CATEGORY_CHANGE_WITH_DATA: product has stock/movement — changing category is risky`)
  }
  
  if (flags.length > 0) {
    p.ownerReviewFlags = flags
    ownerReviewCount++
  }
}

// Save updated results
fs.writeFileSync('/home/z/my-project/reconciliation/dry-run-results.json', JSON.stringify(data, null, 2))
console.log(`Flagged ${ownerReviewCount} items for owner review`)
for (const p of data.adjustedProducts.filter(p => p.ownerReviewFlags)) {
  console.log(`  [${p.oldCode || 'no-code'}] "${p.rawName}" → ${p.classification}`)
  console.log(`     matched: "${p.matchedProductName}" (${p.matchedProductCategory})`)
  for (const f of p.ownerReviewFlags) console.log(`     ⚠️  ${f}`)
}
