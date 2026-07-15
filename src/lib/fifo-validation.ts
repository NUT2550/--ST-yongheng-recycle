/**
 * ST-20 Phase 2: Shared FIFO pre-flight validation helper.
 *
 * Pure functions — NO DB writes. Used by /api/sorting-bills and /api/stock-transfers
 * to detect zero-cost source lot contamination BEFORE FIFO deduction.
 *
 * Business rules:
 *   - SortingBill: zero-cost source lots allowed ONLY if ALL outputs are waste
 *   - StockTransfer: zero-cost source lots blocked always (no waste concept)
 *   - Negative costPerKg on source lots: always blocked
 *   - Weighted average cost <= 0 with non-waste output: blocked
 */

// Floating-point tolerance — values within this range are considered "equal to 0"
// Rationale: costs stored as Float with 2-decimal rounding; tolerance covers
// representation error accumulation in weighted average computation.
export const FIFO_COST_TOLERANCE = 0.005 // 0.005 THB/kg
export const FIFO_WEIGHT_TOLERANCE = 0.01 // 0.01 kg

export interface SourceLotForPreview {
  id: string
  remainingWeight: number
  costPerKg: number
  dateAdded: Date
  createdAt: Date // ST-39: tie-break field for deterministic FIFO ordering
}

/**
 * ST-39: Shared deterministic FIFO lot ordering.
 *
 * When multiple StockLots share the same `dateAdded` (e.g. bulk import, migration,
 * or same-timestamp purchases), the FIFO order must still be deterministic so that
 * the pre-flight preview and the actual execution select the SAME lot sequence.
 * Without a tie-break, PostgreSQL may return equal-dateAdded rows in any order,
 * causing preview/execution divergence → FIFO_MISMATCH 409 → deducted+compensated
 * stock on every retry.
 *
 * Deterministic order (all ascending):
 *   1. dateAdded  — FIFO semantics (oldest stock consumed first)
 *   2. createdAt  — tie-break when dateAdded is identical (createdAt is @default(now()),
 *                   set once at row creation, immutable thereafter)
 *   3. id         — final tie-break (cuid, globally unique, immutable — guarantees
 *                   a total order even if dateAdded AND createdAt are identical)
 *
 * Both the in-memory comparator (compareFifoLotOrder) and the Prisma orderBy
 * specification (FIFO_ORDER_BY) below implement EXACTLY this ordering. They must
 * never drift apart — if you change one, change the other.
 */

// Prisma orderBy specification matching compareFifoLotOrder.
// Use this in every db.stockLot.findMany / tx.stockLot.findMany that feeds FIFO logic.
export const FIFO_ORDER_BY = [
  { dateAdded: 'asc' as const },
  { createdAt: 'asc' as const },
  { id: 'asc' as const },
]

// In-memory comparator matching FIFO_ORDER_BY. Used by previewFifoDeduction.
// Returns negative if a should come before b, positive if b before a, 0 if equal.
export function compareFifoLotOrder(
  a: { dateAdded: Date; createdAt: Date; id: string },
  b: { dateAdded: Date; createdAt: Date; id: string }
): number {
  const byDateAdded = a.dateAdded.getTime() - b.dateAdded.getTime()
  if (byDateAdded !== 0) return byDateAdded
  const byCreatedAt = a.createdAt.getTime() - b.createdAt.getTime()
  if (byCreatedAt !== 0) return byCreatedAt
  // String comparison on id (cuid) — lexicographic order is stable and deterministic
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export interface DeductedLotPreview {
  lotId: string
  remainingWeight: number // before deduction
  costPerKg: number
  weightToUse: number // weight that will be deducted from this lot
  subtotalCost: number // weightToUse * costPerKg (rounded to 2 decimals)
}

export interface FifoPreviewSuccess {
  success: true
  sourceProductId: string
  sourceWeight: number
  totalAvailable: number
  deductedLots: DeductedLotPreview[]
  weightedAverageCost: number // rounded to 2 decimals
  totalCost: number // rounded to 2 decimals
  zeroCostLotIds: string[] // lots with costPerKg = 0 that will actually be used (weightToUse > tolerance)
  hasZeroCostSourceLots: boolean
}

export type FifoPreviewErrorCode =
  | 'INSUFFICIENT_STOCK'
  | 'NEGATIVE_COST_SOURCE_LOT'

export interface FifoPreviewError {
  success: false
  code: FifoPreviewErrorCode
  message: string
  sourceProductId: string
  sourceWeight: number
  totalAvailable?: number
  affectedSourceLotIds?: string[]
}

export type FifoPreviewResult = FifoPreviewSuccess | FifoPreviewError

/**
 * Simulate FIFO deduction WITHOUT writing to DB.
 * Returns the lots that would be deducted and their costs.
 *
 * Pure function — given a snapshot of source lots, computes what FIFO would do.
 */
export function previewFifoDeduction(
  sourceProductId: string,
  sourceWeight: number,
  sourceLots: SourceLotForPreview[]
): FifoPreviewResult {
  // ST-39: Sort deterministically using the shared comparator (dateAdded, createdAt, id).
  // Copy to avoid mutating the caller's array.
  const sortedLots = [...sourceLots].sort(compareFifoLotOrder)

  const totalAvailable = sortedLots.reduce((s, l) => s + l.remainingWeight, 0)

  // Insufficient stock check (with weight tolerance)
  if (totalAvailable < sourceWeight - FIFO_WEIGHT_TOLERANCE) {
    return {
      success: false,
      code: 'INSUFFICIENT_STOCK',
      message: `สต็อกไม่เพียงพอ มี: ${totalAvailable} kg, ต้องการ: ${sourceWeight} kg`,
      sourceProductId,
      sourceWeight,
      totalAvailable,
    }
  }

  let remaining = sourceWeight
  const deductedLots: DeductedLotPreview[] = []
  let totalCost = 0
  const zeroCostLotIds: string[] = []

  for (const lot of sortedLots) {
    if (remaining <= FIFO_WEIGHT_TOLERANCE) break

    // Block negative cost source lots — always invalid
    if (lot.costPerKg < 0) {
      return {
        success: false,
        code: 'NEGATIVE_COST_SOURCE_LOT',
        message: `Lot ${lot.id} มี costPerKg ติดลบ (${lot.costPerKg}) ไม่สามารถใช้เป็นสต็อกต้นทางได้`,
        sourceProductId,
        sourceWeight,
        affectedSourceLotIds: [lot.id],
      }
    }

    const weightToUse = Math.min(lot.remainingWeight, remaining)
    const subtotalCost = weightToUse * lot.costPerKg
    totalCost += subtotalCost
    remaining -= weightToUse

    deductedLots.push({
      lotId: lot.id,
      remainingWeight: lot.remainingWeight,
      costPerKg: lot.costPerKg,
      weightToUse,
      subtotalCost: Math.round(subtotalCost * 100) / 100,
    })

    // Track zero-cost lots that are actually used (weightToUse > tolerance)
    if (lot.costPerKg === 0 && weightToUse > FIFO_WEIGHT_TOLERANCE) {
      zeroCostLotIds.push(lot.id)
    }
  }

  const weightedAverageCost = sourceWeight > 0 ? totalCost / sourceWeight : 0

  return {
    success: true,
    sourceProductId,
    sourceWeight,
    totalAvailable,
    deductedLots,
    weightedAverageCost: Math.round(weightedAverageCost * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    zeroCostLotIds,
    hasZeroCostSourceLots: zeroCostLotIds.length > 0,
  }
}

export type CostValidationErrorCode =
  | 'ZERO_COST_SOURCE_LOT'
  | 'ZERO_SOURCE_COST'

export interface CostValidationError {
  valid: false
  code: CostValidationErrorCode
  message: string
  affectedSourceLotIds?: string[]
  weightedAverageCost?: number
}

export interface CostValidationSuccess {
  valid: true
}

export type CostValidationResult = CostValidationSuccess | CostValidationError

export interface CostValidationPolicy {
  /**
   * 'SORTING' = SortingBill (has waste concept — waste outputs allow zero-cost source)
   * 'TRANSFER' = StockTransfer (no waste concept — always block zero-cost source)
   */
  type: 'SORTING' | 'TRANSFER'
  /**
   * For SORTING: true if there are any non-waste output items with weight > 0.
   * Ignored for TRANSFER (always treated as "has non-waste output").
   */
  hasNonWasteOutput: boolean
}

/**
 * Validate source lot costs against business policy.
 *
 * Rules:
 *   - SortingBill with non-waste output + zero-cost source lot used → BLOCK
 *   - SortingBill with all-waste output + zero-cost source lot used → ALLOW
 *   - StockTransfer + any zero-cost source lot used → BLOCK
 *   - Weighted average cost <= tolerance + non-waste output → BLOCK
 */
export function validateSourceLotCosts(
  preview: FifoPreviewSuccess,
  policy: CostValidationPolicy
): CostValidationResult {
  const effectiveHasNonWasteOutput =
    policy.type === 'TRANSFER' ? true : policy.hasNonWasteOutput

  // Block zero-cost source lots
  if (preview.hasZeroCostSourceLots && effectiveHasNonWasteOutput) {
    return {
      valid: false,
      code: 'ZERO_COST_SOURCE_LOT',
      message:
        policy.type === 'TRANSFER'
          ? `สินค้าต้นทางมี StockLot ต้นทุน 0 บาท/กก. (${preview.zeroCostLotIds.length} lot) ไม่สามารถย้ายสต็อกได้ — กรุณาแก้ไขต้นทุนก่อน`
          : `สินค้าต้นทางมี StockLot ต้นทุน 0 บาท/กก. (${preview.zeroCostLotIds.length} lot) ไม่สามารถคัดแยกเป็น output ที่ไม่ใช่ waste ได้ — กรุณาแก้ไขต้นทุนก่อน`,
      affectedSourceLotIds: preview.zeroCostLotIds,
    }
  }

  // Block zero/negative weighted average cost (for non-waste outputs)
  if (
    effectiveHasNonWasteOutput &&
    preview.weightedAverageCost <= FIFO_COST_TOLERANCE
  ) {
    return {
      valid: false,
      code: 'ZERO_SOURCE_COST',
      message:
        policy.type === 'TRANSFER'
          ? `ต้นทุนถัวเฉลี่ยของสต็อกต้นทางเป็น 0 บาท/กก. ไม่สามารถย้ายสต็อกได้`
          : `ต้นทุนถัวเฉลี่ยของสต็อกต้นทางเป็น 0 บาท/กก. ไม่สามารถคัดแยกเป็น output ที่ไม่ใช่ waste ได้`,
      weightedAverageCost: preview.weightedAverageCost,
    }
  }

  return { valid: true }
}

/**
 * Verify that actual FIFO deduction result matches preview.
 *
 * ST-39: Now compares BOTH the cost aggregates AND the per-lot allocation.
 * Previously it compared only weightedAverageCost + totalCost, which could
 * miss cases where two different lot allocations coincidentally produce the
 * same average cost (e.g. lot-A 10kg@40 + lot-B 10kg@40 vs lot-C 20kg@40).
 *
 * Used after the real FIFO deduction to detect race conditions or
 * concurrent modifications that changed the source lots between
 * preview and execution.
 *
 * @param actual.deductedLots - optional per-lot allocation from execution
 *   (lotId + weight deducted). When provided, the lot IDs and per-lot
 *   weights must match the preview's deductedLots exactly (within weight
 *   tolerance). When omitted, falls back to cost-only comparison (legacy).
 */
export interface ActualFifoResult {
  costPerKg: number
  totalCost: number
  deductedLots?: Array<{ id: string; deducted: number }>
}

export function verifyFifoMatch(
  preview: FifoPreviewSuccess,
  actual: ActualFifoResult
): boolean {
  // 1. Cost aggregate checks (always)
  const costDelta = Math.abs(preview.weightedAverageCost - actual.costPerKg)
  const totalCostDelta = Math.abs(preview.totalCost - actual.totalCost)
  const costsMatch =
    costDelta <= FIFO_COST_TOLERANCE &&
    totalCostDelta <= FIFO_COST_TOLERANCE * Math.max(1, preview.sourceWeight)
  if (!costsMatch) return false

  // 2. Per-lot allocation check (when execution provides deductedLots)
  // ST-39: This catches the deterministic-ordering bug where two different
  // equal-dateAdded lots with different costs could coincidentally produce
  // the same average. Now the actual lot IDs and per-lot weights must match
  // the preview exactly.
  if (actual.deductedLots && actual.deductedLots.length > 0) {
    const previewLots = preview.deductedLots
    if (previewLots.length !== actual.deductedLots.length) return false
    for (let i = 0; i < previewLots.length; i++) {
      const p = previewLots[i]
      const a = actual.deductedLots[i]
      if (p.lotId !== a.id) return false // different lot selected
      if (Math.abs(p.weightToUse - a.deducted) > FIFO_WEIGHT_TOLERANCE) return false
    }
  }

  return true
}

/**
 * Build the audit log details object for FIFO deduction.
 * Returns a plain object that callers should JSON.stringify before storing.
 */
export interface FifoAuditDetails {
  allocationMethod: 'SOURCE_FIFO_WEIGHTED_AVERAGE'
  sourceProductId: string
  sourceWeight: number
  sourceWeightedAvgCost: number
  sourceLots: Array<{
    lotId: string
    costPerKg: number
    deductedWeight: number
    subtotalCost: number
  }>
  validationPolicy: {
    type: 'SORTING' | 'TRANSFER'
    hasNonWasteOutput: boolean
  }
  zeroCostSourceLotDetected: boolean
  zeroCostSourceLotIds: string[]
}

export function buildFifoAuditDetails(
  preview: FifoPreviewSuccess,
  policy: CostValidationPolicy
): FifoAuditDetails {
  return {
    allocationMethod: 'SOURCE_FIFO_WEIGHTED_AVERAGE',
    sourceProductId: preview.sourceProductId,
    sourceWeight: preview.sourceWeight,
    sourceWeightedAvgCost: preview.weightedAverageCost,
    sourceLots: preview.deductedLots.map((l) => ({
      lotId: l.lotId,
      costPerKg: l.costPerKg,
      deductedWeight: l.weightToUse,
      subtotalCost: l.subtotalCost,
    })),
    validationPolicy: {
      type: policy.type,
      hasNonWasteOutput: policy.hasNonWasteOutput,
    },
    zeroCostSourceLotDetected: preview.hasZeroCostSourceLots,
    zeroCostSourceLotIds: preview.zeroCostLotIds,
  }
}
