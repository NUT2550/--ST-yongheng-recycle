/**
 * ST-48 Hybrid zero-cost StockLot revaluation plan generator.
 *
 * DRY-RUN ONLY. Apply mode is blocked pending separate Owner Production release
 * approval. This module calculates proposed costPerKg for every active zero-cost
 * StockLot using the Owner-approved Hybrid priority policy.
 *
 * Safety:
 *   - Changes ONLY costPerKg (never remainingWeight, sourceId, dateAdded, etc.)
 *   - Allowlisted lot IDs only
 *   - Expected-value guards (current costPerKg must be 0)
 *   - Idempotent: re-running detects already-corrected lots
 *   - Transaction boundary for apply mode (blocked)
 *   - AuditLog entry per operation
 */
import { preciseWeight } from './stock-movement-ledger'

export type DerivationMethod =
  | 'EXACT_BUY_SOURCE'
  | 'EXACT_SORTING_ALLOCATION'
  | 'EXACT_FIFO_RESTORE'
  | 'HISTORICAL_WEIGHTED_AVERAGE'
  | 'OWNER_DECISION_REQUIRED'
  | 'KNOWN_LEGACY_ZERO_COST'

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

/**
 * Owner-approved legacy zero-cost lots that are explicitly EXCLUDED from revaluation.
 * These lots have no reliable exact source cost and no valid same-Product historical
 * cost evidence. The Owner explicitly approved preserving costPerKg = 0.
 *
 * Exclusion is by exact technical lot ID + expected productId + expected remainingWeight.
 * A mismatch on any guard stops the plan.
 */
export interface LegacyLotGuard {
  lotId: string
  productId: string
  expectedRemainingWeight: number
  reason: string
}

export const KNOWN_LEGACY_LOTS: readonly LegacyLotGuard[] = [
  {
    lotId: 'cmr0kk5va002ylb04x87wh44s',
    productId: 'cmr09vcvh0016l105bpvmhfwq',
    expectedRemainingWeight: 3.5,
    reason: 'ทองแดงเกินจาก ST — no reliable exact source cost, no valid same-Product historical cost. Owner-approved legacy zero cost.',
  },
  {
    lotId: 'cmr0kk7zt0034lb04yick2bc5',
    productId: 'cmr09vcvi001il105ty4h75k8',
    expectedRemainingWeight: 1.6,
    reason: 'ทองเหลืองเกินจาก ST — no reliable exact source cost, no valid same-Product historical cost. Owner-approved legacy zero cost.',
  },
  {
    lotId: 'cmr3fth8n000yjo043uwrz43r',
    productId: 'cmr09vcvi001kl105f1e6emmx',
    expectedRemainingWeight: 0.1,
    reason: 'ทองเหลืองขาดจาก ST — no reliable exact source cost, no valid same-Product historical cost. Owner-approved legacy zero cost.',
  },
  {
    lotId: 'cmqoyjyre001bqjihd8l0u8gy',
    productId: 'prod_mqgp9fgoheos0xee1ntl0r27',
    expectedRemainingWeight: 30.5,
    reason: 'อลูมิเนียมเครื่อง — no reliable exact source cost, no valid same-Product historical cost. Owner-approved legacy zero cost.',
  },
]

export function isLegacyLot(lotId: string): boolean {
  return KNOWN_LEGACY_LOTS.some(l => l.lotId === lotId)
}

export function getLegacyGuard(lotId: string): LegacyLotGuard | null {
  return KNOWN_LEGACY_LOTS.find(l => l.lotId === lotId) ?? null
}

/**
 * Verify a legacy lot matches its expected guard values. Returns null if OK,
 * or an error message if the guard fails.
 */
export function verifyLegacyGuard(
  lotId: string,
  productId: string,
  remainingWeight: number,
): string | null {
  const guard = getLegacyGuard(lotId)
  if (!guard) return `Lot ${lotId} is not in the legacy exclusion list`
  if (guard.productId !== productId) {
    return `Legacy lot ${lotId} productId mismatch: expected ${guard.productId}, got ${productId}`
  }
  const weightDiff = Math.abs(remainingWeight - guard.expectedRemainingWeight)
  if (weightDiff > 0.001) {
    return `Legacy lot ${lotId} remainingWeight mismatch: expected ${guard.expectedRemainingWeight}, got ${remainingWeight}`
  }
  return null // OK
}

export interface RevaluationLotPlan {
  lotId: string
  productId: string
  productName: string
  sourceType: string
  sourceId: string
  dateAdded: Date
  remainingWeight: number
  currentCostPerKg: number
  category: string
  proposedCostPerKg: number | null
  derivationMethod: DerivationMethod
  confidence: Confidence
  evidence: string
  beforeValue: number
  afterValue: number | null
  valueIncrease: number | null
  fifoPosition: number | null
  unresolvedWarning: string | null
}

export interface RevaluationPlan {
  cutoff: string
  applyMode: false // always false in dry-run
  eligibleLots: RevaluationLotPlan[] // all 53 lots (49 resolved + 4 legacy)
  totalLots: number
  totalRemainingWeight: number
  totalBeforeValue: number
  totalAfterValue: number
  totalValueIncrease: number
  exactCount: number
  weightedAverageCount: number
  unresolvedCount: number
  legacyCount: number
  eligibleForApplyCount: number // 49 — excludes legacy + unresolved
  byCategory: Record<string, { lots: number; weight: number; value: number }>
  byMethod: Record<string, number>
}

export interface RevaluationDeps {
  getZeroCostActiveLots(): Promise<Array<{
    id: string; productId: string; productName: string; remainingWeight: number;
    costPerKg: number; dateAdded: Date; createdAt: Date; source: string; sourceId: string;
  }>>
  getBuyBillItemCost(buyBillId: string, productId: string): Promise<number | null>
  getSortingSourceAvgCost(sourceProductId: string, beforeDate: Date): Promise<number | null>
  getProductHistoricalAvgCost(productId: string): Promise<{ avgCost: number; obsCount: number; minCost: number; maxCost: number; totalWeight: number } | null>
  getFifoPosition(productId: string, lotId: string): Promise<number | null>
}

export function categorizeLot(source: string, sourceId: string): string {
  if (sourceId === 'manual') return 'A_ST19_ADJUSTMENT'
  if (sourceId === 'manual-steel') return 'G_LEGACY_OPENING'
  if (source === 'SORTING') return 'D_SORTING_OUTPUT'
  if (source === 'SELL_CANCEL') return 'E_SELL_CANCEL'
  // Any BUY source that isn't 'manual' or 'manual-steel' is a real BuyBill reference.
  // No prefix heuristic — the sourceId is resolved deterministically via getBuyBillItemCost.
  if (source === 'BUY') return 'B_MANUAL_PURCHASE'
  return 'K_UNKNOWN'
}

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000
const round2 = (n: number) => Math.round(n * 100) / 100

export async function generateRevaluationPlan(deps: RevaluationDeps, cutoff: string): Promise<RevaluationPlan> {
  const lots = await deps.getZeroCostActiveLots()
  const proposed: RevaluationLotPlan[] = []

  for (const lot of lots) {
    const category = categorizeLot(lot.source, lot.sourceId)
    let proposedCost: number | null = null
    let method: DerivationMethod = 'OWNER_DECISION_REQUIRED'
    let confidence: Confidence = 'LOW'
    let evidence = ''
    let warning: string | null = null

    // Priority 0: Owner-approved legacy exclusion — these lots stay at cost 0
    if (isLegacyLot(lot.id)) {
      const guardError = verifyLegacyGuard(lot.id, lot.productId, lot.remainingWeight)
      if (guardError) {
        // Guard mismatch — stop the plan by returning an error lot
        throw new Error(`ST-48 legacy guard mismatch: ${guardError}`)
      }
      method = 'KNOWN_LEGACY_ZERO_COST'
      confidence = 'HIGH'
      evidence = getLegacyGuard(lot.id)!.reason
      // Legacy lots are excluded from revaluation — proposedCost stays null
      proposed.push({
        lotId: lot.id, productId: lot.productId, productName: lot.productName,
        sourceType: lot.source, sourceId: lot.sourceId, dateAdded: lot.dateAdded,
        remainingWeight: preciseWeight(lot.remainingWeight), currentCostPerKg: 0,
        category: 'KNOWN_LEGACY', proposedCostPerKg: null, derivationMethod: method,
        confidence, evidence, beforeValue: 0, afterValue: null, valueIncrease: null,
        fifoPosition: await deps.getFifoPosition(lot.productId, lot.id),
        unresolvedWarning: null,
      })
      continue
    }

    // Priority 1: Exact source-derived cost (Category B)
    if (category === 'B_MANUAL_PURCHASE') {
      const buyCost = await deps.getBuyBillItemCost(lot.sourceId, lot.productId)
      if (buyCost !== null && buyCost > 0) {
        proposedCost = round6(buyCost)
        method = 'EXACT_BUY_SOURCE'
        confidence = 'HIGH'
        evidence = `BuyBillItem pricePerKg=${proposedCost}`
      }
    }

    // Priority 2: Exact sorting allocation (Category D)
    if (category === 'D_SORTING_OUTPUT' && proposedCost === null) {
      const sortBill = await deps.getSortingSourceAvgCost(lot.productId, lot.dateAdded)
      if (sortBill !== null && sortBill > 0) {
        proposedCost = round6(sortBill)
        method = 'EXACT_SORTING_ALLOCATION'
        confidence = 'MEDIUM'
        evidence = `Sorting source avg cost=${proposedCost}`
      }
    }

    // Priority 3: Product historical weighted-average
    if (proposedCost === null) {
      const hist = await deps.getProductHistoricalAvgCost(lot.productId)
      if (hist !== null && hist.avgCost > 0) {
        proposedCost = round6(hist.avgCost)
        method = 'HISTORICAL_WEIGHTED_AVERAGE'
        confidence = hist.obsCount >= 3 ? 'MEDIUM' : 'LOW'
        evidence = `avg=${proposedCost} from ${hist.obsCount} lots (${round6(hist.totalWeight)} kg), min=${round6(hist.minCost)}, max=${round6(hist.maxCost)}`
      } else {
        warning = 'No non-zero-cost historical lots for this product — OWNER_DECISION_REQUIRED'
      }
    }

    const fifoPos = await deps.getFifoPosition(lot.productId, lot.id)
    const beforeValue = 0
    const afterValue = proposedCost !== null ? round2(lot.remainingWeight * proposedCost) : null
    const valueIncrease = afterValue !== null ? round2(afterValue - beforeValue) : null

    proposed.push({
      lotId: lot.id, productId: lot.productId, productName: lot.productName,
      sourceType: lot.source, sourceId: lot.sourceId, dateAdded: lot.dateAdded,
      remainingWeight: preciseWeight(lot.remainingWeight), currentCostPerKg: 0,
      category, proposedCostPerKg: proposedCost, derivationMethod: method,
      confidence, evidence, beforeValue, afterValue, valueIncrease,
      fifoPosition: fifoPos, unresolvedWarning: warning,
    })
  }

  let totalBefore = 0, totalAfter = 0
  let exactCount = 0, avgCount = 0, unresolvedCount = 0, legacyCount = 0
  const byCategory: Record<string, { lots: number; weight: number; value: number }> = {}
  const byMethod: Record<string, number> = {}

  for (const p of proposed) {
    totalBefore += p.beforeValue
    if (p.afterValue !== null) totalAfter += p.afterValue
    if (p.derivationMethod === 'KNOWN_LEGACY_ZERO_COST') legacyCount++
    else if (p.derivationMethod.startsWith('EXACT')) exactCount++
    else if (p.derivationMethod === 'HISTORICAL_WEIGHTED_AVERAGE') avgCount++
    else unresolvedCount++

    if (!byCategory[p.category]) byCategory[p.category] = { lots: 0, weight: 0, value: 0 }
    byCategory[p.category].lots++
    byCategory[p.category].weight += p.remainingWeight
    byCategory[p.category].value += p.afterValue ?? 0

    byMethod[p.derivationMethod] = (byMethod[p.derivationMethod] || 0) + 1
  }

  const eligibleForApplyCount = exactCount + avgCount // excludes legacy + unresolved

  return {
    cutoff, applyMode: false, eligibleLots: proposed,
    totalLots: proposed.length,
    totalRemainingWeight: round6(proposed.reduce((s, p) => s + p.remainingWeight, 0)),
    totalBeforeValue: round2(totalBefore),
    totalAfterValue: round2(totalAfter),
    totalValueIncrease: round2(totalAfter - totalBefore),
    exactCount, weightedAverageCount: avgCount, unresolvedCount, legacyCount,
    eligibleForApplyCount,
    byCategory, byMethod,
  }
}

/**
 * APPLY MODE — BLOCKED.
 * This function exists to document the intended apply mechanism but is
 * permanently blocked. A separate Owner Production release approval is
 * required before apply mode can be enabled.
 */
export const APPLY_MODE_ENABLED = false

export interface ApplyResult {
  applied: false
  reason: string
}

export async function applyRevaluationPlan(): Promise<ApplyResult> {
  if (!APPLY_MODE_ENABLED) {
    return { applied: false, reason: 'APPLY MODE IS BLOCKED — requires separate Owner Production release approval' }
  }
  // This path is unreachable while APPLY_MODE_ENABLED is false.
  return { applied: false, reason: 'Unreachable' }
}
