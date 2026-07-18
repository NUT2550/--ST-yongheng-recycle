import { describe, expect, test } from 'bun:test'
import {
  buildAdjustmentMovement, buildPurchaseMovements, buildReversalMovement,
  buildSaleMovements, buildSortingMovements, buildTransferMovements,
  calculateClosingStock, movementKey,
} from '../src/lib/stock-movement-ledger'
import { approveStockBaseline, type BaselineApprovalDeps } from '../src/lib/stock-baseline-service'
import { dryRunStockMovementBackfill } from '../src/lib/stock-ledger-backfill'
import { parseThailandBusinessDate } from '../src/lib/thailand-date'

const d = (value: string) => parseThailandBusinessDate(value)

function baselineDeps(status: 'DRAFT' | 'APPROVED' = 'DRAFT') {
  const movements: unknown[] = []
  let approved = status === 'APPROVED'
  const deps: BaselineApprovalDeps = {
    async findBaseline() { return { id: 'base-1', generation: 1, baselineDate: d('2026-06-19'), status: approved ? 'APPROVED' : 'DRAFT', items: [{ id: 'bi-1', productId: 'p1', weight: 10 }] } },
    async findApprovedBaseline() { return approved ? { id: 'base-1' } : null },
    async transaction(fn) { return fn({
      async approveBaseline() { approved = true },
      async createMovements(rows) { movements.push(...rows) },
    }) },
  }
  return { deps, movements, isApproved: () => approved }
}

describe('ST-47 trusted baseline', () => {
  test('1. approved baseline contributes exactly once', async () => {
    const state = baselineDeps()
    expect(await approveStockBaseline(state.deps, 'base-1', { userId: 'u1', name: 'Owner' })).toEqual({ movementCount: 1, alreadyApproved: false })
    expect(await approveStockBaseline(state.deps, 'base-1', { userId: 'u1', name: 'Owner' })).toEqual({ movementCount: 0, alreadyApproved: true })
    expect(state.movements).toHaveLength(1)
  })
  test('2. draft baseline contributes zero to read model', () => {
    expect(calculateClosingStock({ id: 'b', generation: 1, baselineDate: d('2026-06-19'), status: 'DRAFT', items: [{ productId: 'p1', weight: 10 }] }, '2026-06-20', [])).toEqual([])
  })
  test('3. duplicate baseline initialization is idempotent', async () => {
    const state = baselineDeps('APPROVED')
    const result = await approveStockBaseline(state.deps, 'base-1', { userId: 'u', name: 'Owner' })
    expect(result.alreadyApproved).toBe(true)
    expect(state.movements).toHaveLength(0)
  })
})

describe('ST-47 movement builders', () => {
  test('4. purchase emits one in per item', () => {
    const rows = buildPurchaseMovements({ id: 'b1', billNumber: 'BUY-1', date: d('2026-06-20'), items: [{ id: 'i1', productId: 'p1', weight: 2 }, { id: 'i2', productId: 'p2', weight: 3 }] })
    expect(rows.map(r => r.signedWeight)).toEqual([2, 3])
  })
  test('5. sale emits out', () => expect(buildSaleMovements({ id: 's1', date: d('2026-06-20'), items: [{ id: 'i1', productId: 'p1', weight: 3 }] })[0].signedWeight).toBe(-3))
  test('6. sorting emits source out and non-waste output in', () => {
    const rows = buildSortingMovements({ id: 'x', date: d('2026-06-20'), sourceProductId: 'p1', sourceWeight: 5, items: [{ id: 'o', productId: 'p2', weight: 4.5 }, { id: 'w', productId: 'waste', weight: .5, isWaste: true }] })
    expect(rows.map(r => r.signedWeight)).toEqual([-5, 4.5])
  })
  test('7. transfer emits source out and output in', () => {
    const rows = buildTransferMovements({ id: 't', date: d('2026-06-20'), sourceProductId: 'p1', sourceWeight: .38, items: [{ id: 'o', productId: 'p2', weight: .38 }] })
    expect(rows.map(r => r.signedWeight)).toEqual([-.38, .38])
  })
  test('8. positive yield metadata preserves ST-40 meaning', () => {
    const rows = buildTransferMovements({ id: 't', date: d('2026-06-20'), sourceProductId: 'p1', sourceWeight: 20, gainWeight: 4.6, items: [{ id: 'o', productId: 'p2', weight: 24.6 }] })
    expect(rows.reduce((s, r) => s + r.signedWeight, 0)).toBeCloseTo(4.6)
    expect(rows[0].metadata?.gainWeight).toBe(4.6)
  })
  test('9. loss remains a net reduction', () => {
    const rows = buildTransferMovements({ id: 't', date: d('2026-06-20'), sourceProductId: 'p1', sourceWeight: 1.7, lossWeight: .2, items: [{ id: 'o', productId: 'p2', weight: 1.5 }] })
    expect(rows.reduce((s, r) => s + r.signedWeight, 0)).toBeCloseTo(-.2)
  })
  test('10. cancellation is exact inverse', () => {
    const original = { ...buildSaleMovements({ id: 's', date: d('2026-06-20'), items: [{ id: 'i', productId: 'p', weight: 3 }] })[0], id: 'm1' }
    const reversal = buildReversalMovement(original, 'CANCELLATION_REVERSAL', 'cancel', d('2026-06-21'))
    expect(reversal.signedWeight).toBe(3)
    expect(reversal.reversalOfId).toBe('m1')
  })
  test('11. compensation is exact inverse', () => {
    const original = { ...buildPurchaseMovements({ id: 'b', date: d('2026-06-20'), items: [{ id: 'i', productId: 'p', weight: 2 }] })[0], id: 'm1' }
    expect(buildReversalMovement(original, 'COMPENSATION_REVERSAL', 'rollback').signedWeight).toBe(-2)
  })
  test('12. same source has stable idempotency key', () => {
    const input = { id: 'b', date: d('2026-06-20'), items: [{ id: 'i', productId: 'p', weight: 2 }] }
    expect(buildPurchaseMovements(input)[0].idempotencyKey).toBe(buildPurchaseMovements(input)[0].idempotencyKey)
    expect(movementKey(['BUY_BILL', 'b', 'i', 'purchase-in'])).toContain('stock-ledger-v1')
  })
})

describe('ST-47 read model and dry-run', () => {
  test('13. rollback leaves no partial baseline movements', async () => {
    const state = baselineDeps()
    state.deps.transaction = async () => { throw new Error('rollback') }
    await expect(approveStockBaseline(state.deps, 'base-1', { userId: 'u', name: 'Owner' })).rejects.toThrow('rollback')
    expect(state.movements).toHaveLength(0)
  })
  test('14. Thailand midnight boundary includes selected business day', () => {
    const result = calculateClosingStock({ id: 'b', generation: 1, baselineDate: d('2026-06-19'), status: 'APPROVED', items: [{ productId: 'p', weight: 10 }] }, '2026-06-20', [{ productId: 'p', businessDate: d('2026-06-20'), signedWeight: 2 }])
    expect(result[0].expectedClosingWeight).toBe(12)
  })
  test('15. backdated ST-41 transfer uses stored business date', () => {
    const rows = buildTransferMovements({ id: 't', date: d('2026-07-14'), sourceProductId: 'p1', sourceWeight: 1, items: [{ id: 'o', productId: 'p2', weight: 1 }] })
    expect(rows[0].businessDate.toISOString()).toBe('2026-07-13T17:00:00.000Z')
  })
  test('16. expected closing = baseline + net movements', () => {
    const result = calculateClosingStock({ id: 'b', generation: 1, baselineDate: d('2026-06-19'), status: 'APPROVED', items: [{ productId: 'p', weight: 10 }] }, '2026-06-20', [{ productId: 'p', businessDate: d('2026-06-20'), signedWeight: 2 }, { productId: 'p', businessDate: d('2026-06-20'), signedWeight: -3 }])
    expect(result[0]).toMatchObject({ movementInWeight: 2, movementOutWeight: 3, expectedClosingWeight: 9 })
  })
  test('17. multiple products stay isolated', () => {
    const rows = calculateClosingStock({ id: 'b', generation: 1, baselineDate: d('2026-06-19'), status: 'APPROVED', items: [{ productId: 'p1', weight: 1 }, { productId: 'p2', weight: 2 }] }, '2026-06-20', [{ productId: 'p2', businessDate: d('2026-06-20'), signedWeight: 3 }])
    expect(rows.find(r => r.productId === 'p2')?.expectedClosingWeight).toBe(5)
  })
  test('18. decimal accumulation is deterministic', () => {
    const moves = Array.from({ length: 10 }, () => ({ productId: 'p', businessDate: d('2026-06-20'), signedWeight: .1 }))
    expect(calculateClosingStock({ id: 'b', generation: 1, baselineDate: d('2026-06-19'), status: 'APPROVED', items: [{ productId: 'p', weight: 0 }] }, '2026-06-20', moves)[0].expectedClosingWeight).toBe(1)
  })
  test('19. fixture movement total reconciles with StockLot total', () => {
    const movementNet = buildSortingMovements({ id: 'x', date: d('2026-06-20'), sourceProductId: 'p1', sourceWeight: 5, items: [{ id: 'o', productId: 'p2', weight: 4.5 }] }).reduce((s, r) => s + r.signedWeight, 0)
    expect(10 + movementNet).toBe(9.5)
  })
  test('20. dry-run backfill performs no writes', () => {
    const result = dryRunStockMovementBackfill({ baselineDate: d('2026-06-19'), currentStockLotTotals: { p: 1 }, documents: [{ kind: 'BUY', id: 'b', date: d('2026-06-20'), createdAt: d('2026-06-20'), isCancelled: false, items: [{ id: 'i', productId: 'p', weight: 2 }] }] })
    expect(result.writesAttempted).toBe(0)
    expect(result.proposedMovements).toHaveLength(1)
    expect(result.reconciliationByProduct.p.differenceWeight).toBe(1)
  })
  test('21. ambiguous legacy record is reported', () => {
    const result = dryRunStockMovementBackfill({ baselineDate: d('2026-06-19'), documents: [{ kind: 'SORTING', id: 'legacy', date: d('2026-01-05'), createdAt: d('2026-01-05'), isCancelled: false, sourceProductId: 'p', sourceWeight: 1, items: [] }] })
    expect(result.findings[0].classification).toBe('UNSUPPORTED_LEGACY')
  })
  test('22. applied adjustment only emits non-zero movement', () => {
    expect(buildAdjustmentMovement({ sessionId: 's', itemId: 'i', productId: 'p', businessDate: d('2026-06-20'), differenceWeight: -2 })?.movementType).toBe('ADJUSTMENT_OUT')
    expect(buildAdjustmentMovement({ sessionId: 's', itemId: 'z', productId: 'p', businessDate: d('2026-06-20'), differenceWeight: 0 })).toBeNull()
  })
})

describe('ST-47 page regression contracts', () => {
  test('23. removed physical count page stays absent', async () => {
    expect(await Bun.file('src/components/physical-count-page.tsx').exists()).toBe(false)
  })
  test('24. daily weighing page stays present', async () => {
    expect(await Bun.file('src/components/daily-weighing-page.tsx').exists()).toBe(true)
  })
})
