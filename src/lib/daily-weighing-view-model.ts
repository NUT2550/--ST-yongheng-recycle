/**
 * ST-55: Production view model + aggregation helpers for daily weighing.
 *
 * These pure functions are imported by:
 * - src/components/daily-weighing-page.tsx (React component)
 * - src/lib/stock-ledger-read-service.ts (getDailyMovements)
 * - tests/st55-transfer-only-policy.test.ts (behavioral tests)
 *
 * No parallel test-only logic is permitted — all consumers use these exports.
 */
import type { DailyWeighingMovementPolicy } from './daily-weighing-policy'

// ============================================================================
// Types
// ============================================================================

export interface DailyMovementBuckets {
  PURCHASE_IN: number
  SALE_OUT: number
  SORTING_SOURCE_OUT: number
  SORTING_OUTPUT_IN: number
  TRANSFER_SOURCE_OUT: number
  TRANSFER_OUTPUT_IN: number
  ADJUSTMENT_IN: number
  ADJUSTMENT_OUT: number
  CANCELLATION_REVERSAL: number
  COMPENSATION_REVERSAL: number
}

export interface DailyMovementComputed {
  purchaseIn: number
  saleOut: number
  sortingSourceOut: number
  sortingOutputIn: number
  transferSourceOut: number
  transferOutputIn: number
  adjustmentIn: number
  adjustmentOut: number
  adjustmentNet: number
  dailyNet: number
}

export interface DailyWeighingItem {
  productId: string
  productName: string
  purchaseInWeight: number
  saleOutWeight: number
  sortingSourceOutWeight: number
  sortingOutputInWeight: number
  transferSourceOutWeight: number
  transferOutputInWeight: number
  adjustmentNetWeight: number
  dailyNet: number
  movementCount: number
}

export interface ColumnDef {
  key: string
  label: string
  align: 'left' | 'right' | 'center'
}

export interface TotalCellDef {
  key: string
  value: number | string | null
}

// ============================================================================
// Production aggregation: calculatePolicyDailyMovement
// ============================================================================

/**
 * Compute per-product movement values from raw buckets using the category policy.
 * This is the single source of truth for the dailyNet formula.
 * Used by getDailyMovements() in stock-ledger-read-service.ts.
 */
export function calculatePolicyDailyMovement(
  policy: DailyWeighingMovementPolicy,
  b: DailyMovementBuckets,
): DailyMovementComputed {
  const purchaseIn = policy.includePurchaseIn ? Math.max(0, b.PURCHASE_IN) : 0
  const saleOut = policy.includeSaleOut ? Math.max(0, -b.SALE_OUT) : 0
  const sortingSourceOut = policy.includeSortingSourceOut ? Math.max(0, -b.SORTING_SOURCE_OUT) : 0
  const sortingOutputIn = policy.includeSortingOutputIn ? Math.max(0, b.SORTING_OUTPUT_IN) : 0
  const transferSourceOut = policy.includeTransferSourceOut ? Math.max(0, -b.TRANSFER_SOURCE_OUT) : 0
  const transferOutputIn = policy.includeTransferOutputIn ? Math.max(0, b.TRANSFER_OUTPUT_IN) : 0
  const adjustmentIn = policy.includeAdjustment ? Math.max(0, b.ADJUSTMENT_IN) : 0
  const adjustmentOut = policy.includeAdjustment ? Math.max(0, -b.ADJUSTMENT_OUT) : 0
  const adjustmentNet = adjustmentIn - adjustmentOut

  const dailyNet =
    (policy.includePurchaseIn ? b.PURCHASE_IN : 0) +
    (policy.includeSaleOut ? b.SALE_OUT : 0) +
    (policy.includeSortingSourceOut ? b.SORTING_SOURCE_OUT : 0) +
    (policy.includeSortingOutputIn ? b.SORTING_OUTPUT_IN : 0) +
    (policy.includeTransferSourceOut ? b.TRANSFER_SOURCE_OUT : 0) +
    (policy.includeTransferOutputIn ? b.TRANSFER_OUTPUT_IN : 0) +
    (policy.includeAdjustment ? b.ADJUSTMENT_IN + b.ADJUSTMENT_OUT : 0) +
    b.CANCELLATION_REVERSAL + b.COMPENSATION_REVERSAL

  return {
    purchaseIn, saleOut, sortingSourceOut, sortingOutputIn,
    transferSourceOut, transferOutputIn, adjustmentIn, adjustmentOut,
    adjustmentNet, dailyNet,
  }
}

// ============================================================================
// Production column model: buildDailyWeighingColumns
// ============================================================================

/**
 * Build the ordered desktop column definitions for the daily weighing table.
 * Used by the React component for headers and by tests for alignment verification.
 */
export function buildDailyWeighingColumns(hideSorting: boolean): ColumnDef[] {
  const cols: ColumnDef[] = [
    { key: 'product', label: 'สินค้า', align: 'left' },
    { key: 'purchaseIn', label: 'ซื้อเข้า', align: 'right' },
    { key: 'saleOut', label: 'ขายออก', align: 'right' },
  ]
  if (!hideSorting) {
    cols.push({ key: 'sortingSourceOut', label: 'ต้นทางคัดแยก', align: 'right' })
    cols.push({ key: 'sortingOutputIn', label: 'ผลผลิตคัดแยก', align: 'right' })
  }
  cols.push({ key: 'transferSourceOut', label: 'ย้ายออก', align: 'right' })
  cols.push({ key: 'transferOutputIn', label: 'ย้ายเข้า/แกะของเข้า', align: 'right' })
  cols.push({ key: 'adjustmentNet', label: 'ปรับยอดสุทธิ', align: 'right' })
  cols.push({ key: 'dailyNet', label: 'ยอดสุทธิของวันในระบบ', align: 'right' })
  cols.push({ key: 'actual', label: 'น้ำหนักชั่งรวมจริง (กก.)', align: 'right' })
  cols.push({ key: 'difference', label: 'ส่วนต่าง (กก.)', align: 'right' })
  cols.push({ key: 'status', label: 'สถานะ', align: 'center' })
  cols.push({ key: 'note', label: 'หมายเหตุ', align: 'left' })
  return cols
}

// ============================================================================
// Production mobile row model: buildDailyWeighingMobileRows
// ============================================================================

export interface MobileRowDef {
  label: string
  value: string
}

/**
 * Build the mobile card detail rows for a daily weighing item.
 * Used by the React component for the mobile <details> section.
 */
export function buildDailyWeighingMobileRows(hideSorting: boolean, item: DailyWeighingItem): MobileRowDef[] {
  const rows: MobileRowDef[] = [
    { label: 'ซื้อเข้า / ขายออก', value: `+${item.purchaseInWeight} / -${item.saleOutWeight}` },
  ]
  if (!hideSorting) {
    rows.push({
      label: 'คัดแยก เข้า / ออก',
      value: `+${item.sortingOutputInWeight} / -${item.sortingSourceOutWeight}`,
    })
  }
  rows.push({
    label: 'ย้ายออก / ย้ายเข้า',
    value: `-${item.transferSourceOutWeight} / +${item.transferOutputInWeight}`,
  })
  rows.push({ label: 'ปรับยอดสุทธิ', value: `${item.adjustmentNetWeight}` })
  return rows
}

// ============================================================================
// Production total cell model: buildDailyWeighingTotalCells
// ============================================================================

export interface DailyWeighingTotals {
  purchaseIn: number
  saleOut: number
  sortingSourceOut: number
  sortingOutputIn: number
  transferSourceOut: number
  transferOutputIn: number
  adjustmentNet: number
  dailyNet: number
  actual: number
  difference: number
}

/**
 * Calculate totals from a list of daily weighing items.
 */
export function calculateDailyWeighingTotals(items: DailyWeighingItem[]): DailyWeighingTotals {
  return {
    purchaseIn: items.reduce((s, i) => s + i.purchaseInWeight, 0),
    saleOut: items.reduce((s, i) => s + i.saleOutWeight, 0),
    sortingSourceOut: items.reduce((s, i) => s + i.sortingSourceOutWeight, 0),
    sortingOutputIn: items.reduce((s, i) => s + i.sortingOutputInWeight, 0),
    transferSourceOut: items.reduce((s, i) => s + i.transferSourceOutWeight, 0),
    transferOutputIn: items.reduce((s, i) => s + i.transferOutputInWeight, 0),
    adjustmentNet: items.reduce((s, i) => s + i.adjustmentNetWeight, 0),
    dailyNet: items.reduce((s, i) => s + i.dailyNet, 0),
    actual: items.reduce((s, i) => s + (parseFloat(String(i.movementCount)) || 0), 0), // placeholder; actual is from user input
    difference: 0, // computed from actual - dailyNet in component
  }
}

/**
 * Build the total row cells for the daily weighing table.
 * Returns exactly one cell per visible data column (excluding product label which is "รวม").
 * Special columns (actual, difference, status, note) use placeholder values.
 */
export function buildDailyWeighingTotalCells(
  hideSorting: boolean,
  totals: DailyWeighingTotals,
): TotalCellDef[] {
  const cells: TotalCellDef[] = [
    { key: 'label', value: 'รวม' },
    { key: 'purchaseIn', value: totals.purchaseIn },
    { key: 'saleOut', value: totals.saleOut },
  ]
  if (!hideSorting) {
    cells.push({ key: 'sortingSourceOut', value: totals.sortingSourceOut })
    cells.push({ key: 'sortingOutputIn', value: totals.sortingOutputIn })
  }
  cells.push({ key: 'transferSourceOut', value: totals.transferSourceOut })
  cells.push({ key: 'transferOutputIn', value: totals.transferOutputIn })
  cells.push({ key: 'adjustmentNet', value: totals.adjustmentNet })
  cells.push({ key: 'dailyNet', value: totals.dailyNet })
  cells.push({ key: 'actual', value: null }) // placeholder — set by component
  cells.push({ key: 'difference', value: null }) // placeholder — set by component
  cells.push({ key: 'status', value: null })
  cells.push({ key: 'note', value: null })
  return cells
}

// ============================================================================
// Production history column model: buildHistoryColumns
// ============================================================================

/**
 * Build the ordered column definitions for the history detail table.
 * Uses the session's category to determine sorting visibility.
 */
export function buildHistoryColumns(hideSorting: boolean): ColumnDef[] {
  const cols: ColumnDef[] = [
    { key: 'product', label: 'สินค้า', align: 'left' },
    { key: 'purchaseWeight', label: 'ซื้อเข้า', align: 'right' },
  ]
  if (!hideSorting) {
    cols.push({ key: 'sortingOutputWeight', label: 'คัดแยก', align: 'right' })
  }
  cols.push({ key: 'dismantlingOutputWeight', label: 'แกะของ/ย้าย', align: 'right' })
  cols.push({ key: 'expectedTotalWeight', label: 'รวมในระบบ', align: 'right' })
  cols.push({ key: 'docCount', label: 'เอกสาร', align: 'center' })
  cols.push({ key: 'actual', label: 'ชั่งจริง', align: 'right' })
  cols.push({ key: 'difference', label: 'ส่วนต่าง', align: 'right' })
  cols.push({ key: 'status', label: 'สถานะ', align: 'center' })
  return cols
}
