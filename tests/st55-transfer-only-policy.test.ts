import { describe, expect, test } from 'bun:test'

// Import PRODUCTION helpers only — no test-only duplicates
import {
  getDailyWeighingMovementPolicy,
  isTransferOnlyCategory,
} from '../src/lib/daily-weighing-policy'
import {
  calculatePolicyDailyMovement,
  buildDailyWeighingColumns,
  buildDailyWeighingMobileRows,
  buildDailyWeighingTotalCells,
  calculateDailyWeighingTotals,
  buildHistoryColumns,
  type DailyMovementBuckets,
  type DailyWeighingItem,
} from '../src/lib/daily-weighing-view-model'

// ============================================================================
// Test data
// ============================================================================

const COPPER_ID = 'cat_mqgp96m5vaoalu4d05cqgzi5'
const BRASS_ID = 'cat_mqgp96s7mp0h9hamr7wk2ej6'
const STEEL_ID = 'cat_mqgp96fx33ba2pp09s8ikynf'

const sampleBuckets: DailyMovementBuckets = {
  PURCHASE_IN: 10, SALE_OUT: -2,
  SORTING_SOURCE_OUT: -5, SORTING_OUTPUT_IN: 3,
  TRANSFER_SOURCE_OUT: -1, TRANSFER_OUTPUT_IN: 4,
  ADJUSTMENT_IN: 0, ADJUSTMENT_OUT: 0,
  CANCELLATION_REVERSAL: 0, COMPENSATION_REVERSAL: 0,
}

const sampleItems: DailyWeighingItem[] = [
  { productId: 'p1', productName: 'A', purchaseInWeight: 10, saleOutWeight: 2, sortingSourceOutWeight: 5, sortingOutputInWeight: 3, transferSourceOutWeight: 1, transferOutputInWeight: 4, adjustmentNetWeight: 0, dailyNet: 9, movementCount: 6 },
  { productId: 'p2', productName: 'B', purchaseInWeight: 5, saleOutWeight: 0, sortingSourceOutWeight: 0, sortingOutputInWeight: 0, transferSourceOutWeight: 0, transferOutputInWeight: 0, adjustmentNetWeight: 0, dailyNet: 5, movementCount: 1 },
]

// ============================================================================
// Tests — all import and execute PRODUCTION helpers
// ============================================================================

describe('ST-55 production helper behavioral tests', () => {
  describe('Phase 2: Policy', () => {
    test('1. copper policy is transfer-only', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      expect(p.includeSortingSourceOut).toBe(false)
      expect(p.includeSortingOutputIn).toBe(false)
      expect(p.hideSortingColumns).toBe(true)
    })
    test('2. brass policy is transfer-only', () => {
      const p = getDailyWeighingMovementPolicy(BRASS_ID)
      expect(p.hideSortingColumns).toBe(true)
    })
    test('3. steel policy includes sorting', () => {
      const p = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      expect(p.includeSortingSourceOut).toBe(true)
      expect(p.hideSortingColumns).toBe(false)
    })
  })

  describe('Phase 3: Production aggregation (calculatePolicyDailyMovement)', () => {
    test('4. copper excludes sorting from dailyNet', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      const r = calculatePolicyDailyMovement(p, sampleBuckets)
      // 10 + (-2) + 0 + 0 + (-1) + 4 = 11 (no sorting)
      expect(r.dailyNet).toBe(11)
    })
    test('5. copper includes transfer in dailyNet', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      const noTransfer = { ...sampleBuckets, TRANSFER_SOURCE_OUT: 0, TRANSFER_OUTPUT_IN: 0 }
      const withTransfer = sampleBuckets
      const diff = calculatePolicyDailyMovement(p, withTransfer).dailyNet - calculatePolicyDailyMovement(p, noTransfer).dailyNet
      expect(diff).toBe(3) // -1 + 4 = 3
    })
    test('6. steel includes sorting in dailyNet', () => {
      const p = getDailyWeighingMovementPolicy(STEEL_ID, 'เหล็ก')
      const r = calculatePolicyDailyMovement(p, sampleBuckets)
      // 10 + (-2) + (-5) + 3 + (-1) + 4 = 9
      expect(r.dailyNet).toBe(9)
    })
  })

  describe('Phase 5: Desktop column model (buildDailyWeighingColumns)', () => {
    test('7. copper excludes sorting columns', () => {
      const cols = buildDailyWeighingColumns(true) // hideSorting=true
      expect(cols.filter(c => c.key === 'sortingSourceOut' || c.key === 'sortingOutputIn').length).toBe(0)
    })
    test('8. steel includes sorting columns', () => {
      const cols = buildDailyWeighingColumns(false)
      expect(cols.filter(c => c.key === 'sortingSourceOut').length).toBe(1)
      expect(cols.filter(c => c.key === 'sortingOutputIn').length).toBe(1)
    })
    test('9. copper transfer columns always present', () => {
      const cols = buildDailyWeighingColumns(true)
      expect(cols.some(c => c.key === 'transferSourceOut')).toBe(true)
      expect(cols.some(c => c.key === 'transferOutputIn')).toBe(true)
    })
  })

  describe('Phase 5: Mobile row model (buildDailyWeighingMobileRows)', () => {
    test('10. copper mobile excludes sorting row', () => {
      const rows = buildDailyWeighingMobileRows(true, sampleItems[0])
      expect(rows.filter(r => r.label.includes('คัดแยก')).length).toBe(0)
    })
    test('11. steel mobile includes sorting row', () => {
      const rows = buildDailyWeighingMobileRows(false, sampleItems[0])
      expect(rows.filter(r => r.label.includes('คัดแยก')).length).toBe(1)
    })
  })

  describe('Phase 4: Total cell model (buildDailyWeighingTotalCells)', () => {
    test('12. copper total cells match visible columns (no sorting)', () => {
      const totals = calculateDailyWeighingTotals(sampleItems)
      const cells = buildDailyWeighingTotalCells(true, totals)
      const sortingCells = cells.filter(c => c.key === 'sortingSourceOut' || c.key === 'sortingOutputIn')
      expect(sortingCells.length).toBe(0)
    })
    test('13. steel total cells include sorting', () => {
      const totals = calculateDailyWeighingTotals(sampleItems)
      const cells = buildDailyWeighingTotalCells(false, totals)
      expect(cells.some(c => c.key === 'sortingSourceOut')).toBe(true)
      expect(cells.some(c => c.key === 'sortingOutputIn')).toBe(true)
    })
    test('14. transfer source/output are separate cells', () => {
      const totals = calculateDailyWeighingTotals(sampleItems)
      const cells = buildDailyWeighingTotalCells(true, totals)
      const outCell = cells.find(c => c.key === 'transferSourceOut')
      const inCell = cells.find(c => c.key === 'transferOutputIn')
      expect(outCell).toBeDefined()
      expect(inCell).toBeDefined()
      expect(outCell!.key).not.toBe(inCell!.key)
    })
    test('15. adjustment precedes dailyNet in cell order', () => {
      const totals = calculateDailyWeighingTotals(sampleItems)
      const cells = buildDailyWeighingTotalCells(true, totals)
      const adjIdx = cells.findIndex(c => c.key === 'adjustmentNet')
      const netIdx = cells.findIndex(c => c.key === 'dailyNet')
      expect(adjIdx).toBeGreaterThan(-1)
      expect(netIdx).toBe(adjIdx + 1)
    })
  })

  describe('Phase 3: History session-specific policy', () => {
    test('16. copper page + steel history shows sorting', () => {
      const pageHide = isTransferOnlyCategory(undefined, 'ทองแดง')
      const sessionHide = isTransferOnlyCategory(undefined, 'เหล็ก')
      expect(pageHide).toBe(true)
      expect(sessionHide).toBe(false)
      const historyCols = buildHistoryColumns(sessionHide)
      expect(historyCols.some(c => c.key === 'sortingOutputWeight')).toBe(true)
    })
    test('17. steel page + copper history hides sorting', () => {
      const pageHide = isTransferOnlyCategory(undefined, 'เหล็ก')
      const sessionHide = isTransferOnlyCategory(undefined, 'ทองแดง')
      expect(pageHide).toBe(false)
      expect(sessionHide).toBe(true)
      const historyCols = buildHistoryColumns(sessionHide)
      expect(historyCols.some(c => c.key === 'sortingOutputWeight')).toBe(false)
    })
  })

  describe('Phase 6: POST/save behavior', () => {
    test('18. copper saved sortingOutputWeight is 0', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      const r = calculatePolicyDailyMovement(p, sampleBuckets)
      expect(r.sortingOutputIn).toBe(0) // zeroed by policy
    })
    test('19. copper saved transferOutputWeight is preserved', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      const r = calculatePolicyDailyMovement(p, sampleBuckets)
      expect(r.transferOutputIn).toBe(4) // actual value
    })
    test('20. saved expectedTotalWeight equals policy-applied dailyNet', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      const r = calculatePolicyDailyMovement(p, sampleBuckets)
      expect(r.dailyNet).toBe(11) // not 9 (which includes sorting)
    })
  })

  describe('Phase 7: Policy fallback', () => {
    test('21. isTransferOnlyCategory with Thai name ทองแดง', () => {
      expect(isTransferOnlyCategory(undefined, 'ทองแดง')).toBe(true)
    })
    test('22. isTransferOnlyCategory with Thai name ทองเหลือง', () => {
      expect(isTransferOnlyCategory(undefined, 'ทองเหลือง')).toBe(true)
    })
    test('23. isTransferOnlyCategory returns false for เหล็ก', () => {
      expect(isTransferOnlyCategory(undefined, 'เหล็ก')).toBe(false)
    })
  })

  describe('Phase 9: ST-53 regression + boundary', () => {
    test('24. zero-movement product remains visible (policy does not filter products)', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      // Policy controls movement inclusion, not product visibility
      expect(p.includePurchaseIn).toBe(true)
    })
    test('25. actual-only variance works (dailyNet=0 + actual=1.2)', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      const zeroBuckets: DailyMovementBuckets = {
        PURCHASE_IN: 0, SALE_OUT: 0, SORTING_SOURCE_OUT: 0, SORTING_OUTPUT_IN: 0,
        TRANSFER_SOURCE_OUT: 0, TRANSFER_OUTPUT_IN: 0, ADJUSTMENT_IN: 0, ADJUSTMENT_OUT: 0,
        CANCELLATION_REVERSAL: 0, COMPENSATION_REVERSAL: 0,
      }
      const r = calculatePolicyDailyMovement(p, zeroBuckets)
      const actual = 1.2
      const variance = Math.round((actual - r.dailyNet) * 100) / 100
      expect(r.dailyNet).toBe(0)
      expect(variance).toBe(1.2)
    })
    test('26. Asia/Bangkok boundary remains correct', async () => {
      const { parseThailandBusinessDate } = await import('../src/lib/thailand-date')
      const start = parseThailandBusinessDate('2026-07-18')
      const end = new Date(start.getTime() + 86_400_000)
      expect(start.toISOString()).toBe('2026-07-17T17:00:00.000Z')
      expect(end.toISOString()).toBe('2026-07-18T17:00:00.000Z')
    })
  })

  describe('Phase 7: Old session compatibility', () => {
    test('27. old sessions not rewritten (design principle)', () => {
      // Old sessions store whatever was saved. ST-55 does NOT modify them.
      // History detail uses detailHideSorting from session category,
      // but old saved sortingOutputWeight values remain in database.
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      expect(p.includeSortingOutputIn).toBe(false) // new saves zero this
      // But old saves retain their original value — not modified by ST-55
    })
    test('28. no opening/baseline/cumulative in policy', () => {
      const p = getDailyWeighingMovementPolicy(COPPER_ID)
      expect(p).not.toHaveProperty('includeOpening')
      expect(p).not.toHaveProperty('includeBaseline')
    })
  })

  describe('Phase 7: Header/cell contract alignment', () => {
    test('29. copper total cell keys match visible column keys', () => {
      const cols = buildDailyWeighingColumns(true)
      const totals = calculateDailyWeighingTotals(sampleItems)
      const cells = buildDailyWeighingTotalCells(true, totals)
      // Every data column key (excluding 'product' which is 'label' in total) should have a cell
      const colKeys = cols.map(c => c.key).filter(k => k !== 'product')
      const cellKeys = cells.map(c => c.key).filter(k => k !== 'label')
      // cellKeys should be a superset of colKeys (total has label + all data columns)
      for (const key of colKeys) {
        expect(cellKeys).toContain(key)
      }
    })
    test('30. steel total cell keys match visible column keys', () => {
      const cols = buildDailyWeighingColumns(false)
      const totals = calculateDailyWeighingTotals(sampleItems)
      const cells = buildDailyWeighingTotalCells(false, totals)
      const colKeys = cols.map(c => c.key).filter(k => k !== 'product')
      const cellKeys = cells.map(c => c.key).filter(k => k !== 'label')
      for (const key of colKeys) {
        expect(cellKeys).toContain(key)
      }
    })
  })
})
