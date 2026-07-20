/**
 * ST-55: Category-specific daily weighing movement policy.
 *
 * Copper and brass categories use transfer/dismantling only (no sorting).
 * Other categories use the full movement set (sorting + transfer).
 *
 * This policy is used by:
 * - getDailyMovements() (GET API)
 * - POST /api/daily-weighing (save aggregation)
 * - UI column visibility
 * - History detail display
 */

export interface DailyWeighingMovementPolicy {
  includePurchaseIn: boolean
  includeSaleOut: boolean
  includeSortingSourceOut: boolean
  includeSortingOutputIn: boolean
  includeTransferSourceOut: boolean
  includeTransferOutputIn: boolean
  includeAdjustment: boolean
  /** Hide sorting columns in UI */
  hideSortingColumns: boolean
}

/** Default policy: all movements included (backward-compatible) */
const DEFAULT_POLICY: DailyWeighingMovementPolicy = {
  includePurchaseIn: true,
  includeSaleOut: true,
  includeSortingSourceOut: true,
  includeSortingOutputIn: true,
  includeTransferSourceOut: true,
  includeTransferOutputIn: true,
  includeAdjustment: true,
  hideSortingColumns: false,
}

/** Transfer-only policy: no sorting (copper/brass) */
const TRANSFER_ONLY_POLICY: DailyWeighingMovementPolicy = {
  includePurchaseIn: true,
  includeSaleOut: true,
  includeSortingSourceOut: false,
  includeSortingOutputIn: false,
  includeTransferSourceOut: true,
  includeTransferOutputIn: true,
  includeAdjustment: true,
  hideSortingColumns: true,
}

/** Category IDs that use transfer-only policy (copper + brass) */
const TRANSFER_ONLY_CATEGORY_IDS = new Set([
  'cat_mqgp96m5vaoalu4d05cqgzi5', // ทองแดง (COPPER)
  'cat_mqgp96s7mp0h9hamr7wk2ej6', // ทองเหลือง (BRASS)
])

/** Category names that map to transfer-only policy */
const TRANSFER_ONLY_CATEGORY_NAMES = new Set(['ทองแดง', 'ทองเหลือง'])

/**
 * Get the daily weighing movement policy for a category.
 * Uses category ID (stable) when available, falls back to category name.
 */
export function getDailyWeighingMovementPolicy(categoryId?: string | null, categoryName?: string | null): DailyWeighingMovementPolicy {
  if (categoryId && TRANSFER_ONLY_CATEGORY_IDS.has(categoryId)) {
    return TRANSFER_ONLY_POLICY
  }
  if (categoryName && TRANSFER_ONLY_CATEGORY_NAMES.has(categoryName)) {
    return TRANSFER_ONLY_POLICY
  }
  return DEFAULT_POLICY
}

/**
 * Check if a category uses transfer-only policy.
 */
export function isTransferOnlyCategory(categoryId?: string | null, categoryName?: string | null): boolean {
  return getDailyWeighingMovementPolicy(categoryId, categoryName).hideSortingColumns
}
