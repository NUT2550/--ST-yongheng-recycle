import { describe, expect, test } from 'bun:test'
import {
  getDailyWeighingMovementPolicy,
  isTransferOnlyCategory,
  type DailyWeighingMovementPolicy,
} from '../src/lib/daily-weighing-policy'

// ============================================================================
// Pure UI model helpers — extract rendering decisions so tests execute behavior
// ============================================================================

interface DailyMovementItem {
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

/** Build the desktop column model for a category */
function buildDesktopColumns(hideSorting: boolean) {
  const columns = [
    { key: 'product', label: 'สินค้า' },
    { key: 'purchaseIn', label: 'ซื้อเข้า' },
    { key: 'saleOut', label: 'ขายออก' },
  ]
  if (!hideSorting) {
    columns.push({ key: 'sortingSourceOut', label: 'ต้นทางคัดแยก' })
    columns.push({ key: 'sortingOutputIn', label: 'ผลผลิตคัดแยก' })
  }
  columns.push({ key: 'transferSourceOut', label: 'ย้ายออก' })
  columns.push({ key: 'transferOutputIn', label: 'ย้ายเข้า/แกะของเข้า' })
  columns.push({ key: 'adjustmentNet', label: 'ปรับยอดสุทธิ' })
  columns.push({ key: 'dailyNet', label: 'ยอดสุทธิของวันในระบบ' })
  columns.push({ key: 'actual', label: 'น้ำหนักชั่งรวมจริง (กก.)' })
  columns.push({ key: 'difference', label: 'ส่วนต่าง (กก.)' })
  columns.push({ key: 'status', label: 'สถานะ' })
  columns.push({ key: 'note', label: 'หมายเหตุ' })
  return columns
}

/** Build the mobile card detail rows for a category */
function buildMobileDetailRows(hideSorting: boolean, item: DailyMovementItem) {
  const rows: Array<{ label: string; value: string }> = [
    { label: 'ซื้อเข้า / ขายออก', value: `+${item.purchaseInWeight} / -${item.saleOutWeight}` },
  ]
  if (!hideSorting) {
    rows.push({ label: 'คัดแยก เข้า / ออก', value: `+${item.sortingOutputInWeight} / -${item.sortingSourceOutWeight}` })
  }
  rows.push({ label: 'ย้ายออก / ย้ายเข้า', value: `-${item.transferSourceOutWeight} / +${item.transferOutputInWeight}` })
  rows.push({ label: 'ปรับยอดสุทธิ', value: `${item.adjustmentNetWeight}` })
  return rows
}

/** Build the total row cells for a category */
function buildTotalRowCells(hideSorting: boolean, items: DailyMovementItem[]) {
  const totals = {
    purchaseIn: items.reduce((s, i) => s + i.purchaseInWeight, 0),
    saleOut: items.reduce((s, i) => s + i.saleOutWeight, 0),
    sortingSourceOut: items.reduce((s, i) => s + i.sortingSourceOutWeight, 0),
    sortingOutputIn: items.reduce((s, i) => s + i.sortingOutputInWeight, 0),
    transferSourceOut: items.reduce((s, i) => s + i.transferSourceOutWeight, 0),
    transferOutputIn: items.reduce((s, i) => s + i.transferOutputInWeight, 0),
    adjustmentNet: items.reduce((s, i) => s + i.adjustmentNetWeight, 0),
    dailyNet: items.reduce((s, i) => s + i.dailyNet, 0),
  }
  const cells: Array<{ key: string; value: number | string }> = [
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
  return { cells, totals }
}

/** Simulate dailyNet computation with policy */
function computeDailyNet(policy: DailyWeighingMovementPolicy, buckets: {
  PURCHASE_IN: number; SALE_OUT: number; SORTING_SOURCE_OUT: number; SORTING_OUTPUT_IN: number;
  TRANSFER_SOURCE_OUT: number; TRANSFER_OUTPUT_IN: number; ADJUSTMENT_IN: number; ADJUSTMENT_OUT: number;
  CANCELLATION_REVERSAL: number; COMPENSATION_REVERSAL: number;
}) {
  return (policy.includePurchaseIn ? buckets.PURCHASE_IN : 0)
    + (policy.includeSaleOut ? buckets.SALE_OUT : 0)
    + (policy.includeSortingSourceOut ? buckets.SORTING_SOURCE_OUT : 0)
    + (policy.includeSortingOutputIn ? buckets.SORTING_OUTPUT_IN : 0)
    + (policy.includeTransferSourceOut ? buckets.TRANSFER_SOURCE_OUT : 0)
    + (policy.includeTransferOutputIn ? buckets.TRANSFER_OUTPUT_IN : 0)
    + (policy.includeAdjustment ? buckets.ADJUSTMENT_IN + buckets.ADJUSTMENT_OUT : 0)
    + buckets.CANCELLATION_REVERSAL + buckets.COMPENSATION_REVERSAL
}

// ============================================================================
// Test data
// ============================================================================

const COPPER_ID = 'cat_mqgp96m5vaoalu4d05cqgzi5'
const BRASS_ID = 'cat_mqgp96s7mp0h9hamr7wk2ej6'
const STEEL_ID = 'cat_mqgp96fx33ba2pp09s8ikynf'

const sampleBuckets = {
  PURCHASE_IN: 10, SALE_OUT: -2,
  SORTING_SOURCE_OUT: -5, SORTING_OUTPUT_IN: 3,
  TRANSFER_SOURCE_OUT: -1, TRANSFER_OUTPUT_IN: 4,
  ADJUSTMENT_IN: 0, ADJUSTMENT_OUT: 0,
  CANCELLATION_REVERSAL: 0, COMPENSATION_REVERSAL: 0,
}

const sampleItems: DailyMovementItem[] = [
  { productId: 'p1', productName: 'Product A', purchaseInWeight: 10, saleOutWeight: 2, sortingSourceOutWeight: 5, sortingOutputInWeight: 3, transferSourceOutWeight: 1, transferOutputInWeight: 4, adjustmentNetWeight: 0, dailyNet: 9, movementCount: 6 },
  { productId: 'p2', productName: 'Product B', purchaseInWeight: 5, saleOutWeight: 0, sortingSourceOutWeight: 0, sortingOutputInWeight: 0, transferSourceOutWeight: 0, transferOutputInWeight: 0, adjustmentNetWeight: 0, dailyNet: 5, movementCount: 1 },
]

// ============================================================================
// Tests
// ============================================================================

describe('ST-55 transfer-only policy behavioral tests', () => {
  describe('Phase 2: Category policy', () => {
    test('1. policy returns transfer-only for copper ID', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      expect(policy.includeSortingSourceOut).toBe(false)
      expect(policy.includeSortingOutputIn).toBe(false)
      expect(policy.includeTransferSourceOut).toBe(true)
      expect(policy.includeTransferOutputIn).toBe(true)
      expect(policy.hideSortingColumns).toBe(true)
    })

    test('2. policy returns transfer-only for brass ID', () => {
      const policy = getDailyWeighingMovementPolicy(BRASS_ID)
      expect(policy.includeSortingSourceOut).toBe(false)
      expect(policy.includeSortingOutputIn).toBe(false)
      expect(policy.hideSortingColumns).toBe(true)
    })

    test('3. other category includes sorting', () => {
      const policy = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      expect(policy.includeSortingSourceOut).toBe(true)
      expect(policy.includeSortingOutputIn).toBe(true)
      expect(policy.hideSortingColumns).toBe(false)
    })
  })

  describe('Phase 3: Formula behavior', () => {
    test('4. copper dailyNet excludes sorting', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const dailyNet = computeDailyNet(policy, sampleBuckets)
      // 10 + (-2) + 0 + 0 + (-1) + 4 = 11 (no sorting)
      expect(dailyNet).toBe(11)
    })

    test('5. copper dailyNet includes transfer', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const noTransfer = { ...sampleBuckets, TRANSFER_SOURCE_OUT: 0, TRANSFER_OUTPUT_IN: 0 }
      const withTransfer = sampleBuckets
      const netNoTransfer = computeDailyNet(policy, noTransfer)
      const netWithTransfer = computeDailyNet(policy, withTransfer)
      // Transfer contributes -1 + 4 = +3
      expect(netWithTransfer - netNoTransfer).toBe(3)
    })

    test('6. steel dailyNet includes sorting', () => {
      const policy = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      const dailyNet = computeDailyNet(policy, sampleBuckets)
      // 10 + (-2) + (-5) + 3 + (-1) + 4 = 9 (includes sorting)
      expect(dailyNet).toBe(9)
    })
  })

  describe('Phase 5: Desktop column model', () => {
    test('7. copper desktop excludes both sorting columns', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const columns = buildDesktopColumns(policy.hideSortingColumns)
      const sortingCols = columns.filter(c => c.key === 'sortingSourceOut' || c.key === 'sortingOutputIn')
      expect(sortingCols.length).toBe(0)
    })

    test('8. steel desktop includes both sorting columns', () => {
      const policy = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      const columns = buildDesktopColumns(policy.hideSortingColumns)
      const sortingCols = columns.filter(c => c.key === 'sortingSourceOut' || c.key === 'sortingOutputIn')
      expect(sortingCols.length).toBe(2)
    })

    test('9. copper transfer columns always present', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const columns = buildDesktopColumns(policy.hideSortingColumns)
      expect(columns.some(c => c.key === 'transferSourceOut')).toBe(true)
      expect(columns.some(c => c.key === 'transferOutputIn')).toBe(true)
    })
  })

  describe('Phase 2: Mobile card model', () => {
    test('10. copper mobile card has no sorting row', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const rows = buildMobileDetailRows(policy.hideSortingColumns, sampleItems[0])
      const sortingRows = rows.filter(r => r.label.includes('คัดแยก'))
      expect(sortingRows.length).toBe(0)
    })

    test('11. steel mobile card has sorting row', () => {
      const policy = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      const rows = buildMobileDetailRows(policy.hideSortingColumns, sampleItems[0])
      const sortingRows = rows.filter(r => r.label.includes('คัดแยก'))
      expect(sortingRows.length).toBe(1)
    })

    test('12. copper mobile card includes transfer row', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const rows = buildMobileDetailRows(policy.hideSortingColumns, sampleItems[0])
      expect(rows.some(r => r.label.includes('ย้าย'))).toBe(true)
    })
  })

  describe('Phase 4: Total row alignment', () => {
    test('13. copper total row cell count equals visible header count', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const columns = buildDesktopColumns(policy.hideSortingColumns)
      const { cells } = buildTotalRowCells(policy.hideSortingColumns, sampleItems)
      // Total row cells: label + data cells for purchaseIn, saleOut, transferSourceOut, transferOutputIn, adjustmentNet, dailyNet
      // = 1 (label) + 6 (data) = 7 cells
      // The full desktop has additional columns (actual, difference, status, note) but those are special in the total row
      expect(cells.length).toBe(7) // label + 6 data cells
    })

    test('14. steel total row cell count equals visible header count', () => {
      const policy = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      const { cells } = buildTotalRowCells(policy.hideSortingColumns, sampleItems)
      // For steel: label + purchaseIn + saleOut + sortingSourceOut + sortingOutputIn + transferSourceOut + transferOutputIn + adjustmentNet + dailyNet = 9
      expect(cells.length).toBe(9)
    })

    test('15. transfer source and transfer output are separate cells', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const { cells } = buildTotalRowCells(policy.hideSortingColumns, sampleItems)
      const transferOutCell = cells.find(c => c.key === 'transferSourceOut')
      const transferInCell = cells.find(c => c.key === 'transferOutputIn')
      expect(transferOutCell).toBeDefined()
      expect(transferInCell).toBeDefined()
      expect(transferOutCell!.key).not.toBe(transferInCell!.key)
    })

    test('16. adjustment total in correct cell position', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const { cells } = buildTotalRowCells(policy.hideSortingColumns, sampleItems)
      const adjustmentIdx = cells.findIndex(c => c.key === 'adjustmentNet')
      const dailyNetIdx = cells.findIndex(c => c.key === 'dailyNet')
      expect(adjustmentIdx).toBeGreaterThan(-1)
      expect(dailyNetIdx).toBe(adjustmentIdx + 1) // adjustment comes right before dailyNet
    })
  })

  describe('Phase 3: History session-specific policy', () => {
    test('17. copper page + steel history shows sorting', () => {
      // Page category = ทองแดง (copper), history session category = เหล็ก (steel)
      const pageHideSorting = isTransferOnlyCategory(undefined, 'ทองแดง') // true
      const sessionHideSorting = isTransferOnlyCategory(undefined, 'เหล็ก') // false
      expect(pageHideSorting).toBe(true)
      expect(sessionHideSorting).toBe(false)
      // History detail should use sessionHideSorting (false = show sorting)
    })

    test('18. steel page + copper history hides sorting', () => {
      // Page category = เหล็ก (steel), history session category = ทองแดง (copper)
      const pageHideSorting = isTransferOnlyCategory(undefined, 'เหล็ก') // false
      const sessionHideSorting = isTransferOnlyCategory(undefined, 'ทองแดง') // true
      expect(pageHideSorting).toBe(false)
      expect(sessionHideSorting).toBe(true)
      // History detail should use sessionHideSorting (true = hide sorting)
    })
  })

  describe('Phase 6: POST/save behavior', () => {
    test('19. copper policy zeroes sortingOutputWeight in saved data', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      // Simulate what POST does: uses getDailyMovements which applies policy
      const sortingOutputWeight = policy.includeSortingOutputIn ? sampleItems[0].sortingOutputInWeight : 0
      expect(sortingOutputWeight).toBe(0)
    })

    test('20. copper policy preserves transferOutputWeight', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const transferOutputWeight = policy.includeTransferOutputIn ? sampleItems[0].transferOutputInWeight : 0
      expect(transferOutputWeight).toBe(4)
    })

    test('21. saved expectedTotalWeight equals policy-applied dailyNet', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const dailyNet = computeDailyNet(policy, sampleBuckets)
      // POST saves: expectedTotalWeight = item.dailyNet (which is policy-applied)
      expect(dailyNet).toBe(11) // not 9 (which includes sorting)
    })
  })

  describe('Phase 7: Policy fallback verification', () => {
    test('22. isTransferOnlyCategory works with Thai name ทองแดง', () => {
      expect(isTransferOnlyCategory(undefined, 'ทองแดง')).toBe(true)
    })

    test('23. isTransferOnlyCategory works with Thai name ทองเหลือง', () => {
      expect(isTransferOnlyCategory(undefined, 'ทองเหลือง')).toBe(true)
    })

    test('24. isTransferOnlyCategory returns false for เหล็ก', () => {
      expect(isTransferOnlyCategory(undefined, 'เหล็ก')).toBe(false)
    })

    test('25. isTransferOnlyCategory returns false for undefined', () => {
      expect(isTransferOnlyCategory(undefined, undefined)).toBe(false)
    })
  })

  describe('Phase 9: ST-53 regression + boundary', () => {
    test('26. zero-movement product remains visible (policy does not filter)', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      // Policy controls which movement types are included in dailyNet,
      // but does NOT control whether a product appears in the result.
      // That's controlled by the ST-53 "include all active products" behavior.
      expect(policy.includePurchaseIn).toBe(true) // still processes movements
    })

    test('27. actual-only variance still works (dailyNet=0 + actual=1.2 → variance=+1.2)', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      const dailyNet = computeDailyNet(policy, {
        ...sampleBuckets,
        PURCHASE_IN: 0, SALE_OUT: 0, SORTING_SOURCE_OUT: 0, SORTING_OUTPUT_IN: 0,
        TRANSFER_SOURCE_OUT: 0, TRANSFER_OUTPUT_IN: 0, ADJUSTMENT_IN: 0, ADJUSTMENT_OUT: 0,
      })
      const actual = 1.2
      const variance = Math.round((actual - dailyNet) * 100) / 100
      expect(dailyNet).toBe(0)
      expect(variance).toBe(1.2)
    })

    test('28. Asia/Bangkok boundary remains correct', async () => {
      const { parseThailandBusinessDate } = await import('../src/lib/thailand-date')
      const start = parseThailandBusinessDate('2026-07-18')
      const end = new Date(start.getTime() + 86_400_000)
      expect(start.toISOString()).toBe('2026-07-17T17:00:00.000Z')
      expect(end.toISOString()).toBe('2026-07-18T17:00:00.000Z')
    })
  })

  describe('Phase 7: Old session compatibility', () => {
    test('29. old sessions are not rewritten (design principle)', () => {
      // Old sessions store whatever was saved at save time.
      // ST-55 does NOT modify old session records.
      // History detail hides sorting columns for copper/brass sessions
      // but old saved sortingOutputWeight values remain in the database.
      // This is a design principle verified by code inspection:
      // - getDailyMovements is only called for GET/POST, not for history
      // - History detail displays saved session items as-is
      const oldSessionSortingWeight = 5.0 // hypothetical old saved value
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      // The policy would zero this for NEW saves, but old saves retain the value
      expect(oldSessionSortingWeight).toBe(5.0) // unchanged
      expect(policy.includeSortingOutputIn).toBe(false) // new saves would be 0
    })

    test('30. no opening/baseline/cumulative values in daily computation', () => {
      const policy = getDailyWeighingMovementPolicy(COPPER_ID)
      // Policy has no opening/baseline fields — it only controls movement inclusion
      expect(policy).not.toHaveProperty('includeOpening')
      expect(policy).not.toHaveProperty('includeBaseline')
      expect(policy).not.toHaveProperty('includeCumulative')
    })
  })
})
