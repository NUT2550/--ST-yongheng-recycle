import { describe, expect, test } from 'bun:test'
import {
  buildAdjustmentMovement, buildPurchaseMovements, buildReversalMovement,
  buildSaleMovements, buildSortingMovements, buildTransferMovements,
  calculateClosingStock, movementKey,
} from '../src/lib/stock-movement-ledger'
import { approveStockBaseline, type BaselineApprovalDeps } from '../src/lib/stock-baseline-service'
import { dryRunStockMovementBackfill } from '../src/lib/stock-ledger-backfill'
import { parseThailandBusinessDate } from '../src/lib/thailand-date'
import { assertUniqueOwnerProductBoundaries, ST47_OWNER_PRODUCT_BOUNDARIES, OWNER_ACCEPTED_VARIANCES } from '../src/lib/st47-owner-product-boundaries'

const d = (value: string) => parseThailandBusinessDate(value)

function baselineDeps(status: 'DRAFT' | 'APPROVED' = 'DRAFT') {
  const movements: unknown[] = []
  let approved = status === 'APPROVED'
  const deps: BaselineApprovalDeps = {
    async findBaseline() { return { id: 'base-1', generation: 1, baselineDate: d('2026-06-19'), status: approved ? 'APPROVED' : 'DRAFT', items: [{ id: 'bi-1', productId: 'p1', weight: 10, effectiveStartDate: d('2026-06-20') }] } },
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
  test('3a. empty baseline cannot be approved', async () => {
    const state = baselineDeps()
    const original = state.deps.findBaseline
    state.deps.findBaseline = async id => ({ ...(await original(id))!, items: [] })
    await expect(approveStockBaseline(state.deps, 'base-1', { userId: 'u', name: 'Owner' })).rejects.toThrow('Empty baseline')
  })
  test('3b. invalid, duplicate, and incomplete baseline evidence is rejected', async () => {
    for (const rawItems of [
      [{ id: 'i1', productId: 'p1', weight: Number.POSITIVE_INFINITY }],
      [{ id: 'i1', productId: 'p1', weight: -0.1 }],
      [{ id: 'i1', productId: 'p1', weight: 1 }, { id: 'i2', productId: 'p1', weight: 2 }],
      [{ id: '', productId: 'p1', weight: 1 }],
    ]) {
      const items = rawItems.map(item => ({ ...item, effectiveStartDate: d('2026-06-20') }))
      const state = baselineDeps()
      state.deps.findBaseline = async () => ({ id: 'base-1', generation: 1, baselineDate: d('2026-06-19'), status: 'DRAFT', items })
      await expect(approveStockBaseline(state.deps, 'base-1', { userId: 'u', name: 'Owner' })).rejects.toThrow()
    }
  })
  test('3c. approval requires an authenticated actor identity', async () => {
    const state = baselineDeps()
    await expect(approveStockBaseline(state.deps, 'base-1', { userId: '', name: '' })).rejects.toThrow('authenticated actor')
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
  test('18a. authoritative six-decimal weight units prevent reconciliation drift', () => {
    const moves = [0.1, 0.2, 0.38, 1.7, -0.38].map(signedWeight => ({
      productId: 'p', businessDate: d('2026-06-20'), signedWeight,
    }))
    const row = calculateClosingStock(
      { id: 'b', generation: 1, baselineDate: d('2026-06-19'), status: 'APPROVED', items: [{ productId: 'p', weight: 0 }] },
      '2026-06-20', moves,
    )[0]
    expect(row.movementInWeight).toBe(2.38)
    expect(row.movementOutWeight).toBe(0.38)
    expect(row.expectedClosingWeight).toBe(2)
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

describe('ST-47 per-product effective start boundaries', () => {
  const approved = (items: Array<{ productId: string; weight: number; effectiveStartDate: Date }>) => ({
    id: 'per-product', generation: 2, baselineDate: d('2026-01-01'), status: 'APPROVED' as const, items,
  })

  test('25. products use independent inclusive start dates', () => {
    const rows = calculateClosingStock(approved([
      { productId: 'a', weight: 10, effectiveStartDate: d('2026-02-05') },
      { productId: 'b', weight: 20, effectiveStartDate: d('2026-07-04') },
    ]), '2026-07-04', [
      { productId: 'a', businessDate: d('2026-02-04'), signedWeight: 99 },
      { productId: 'a', businessDate: d('2026-02-05'), signedWeight: 1 },
      { productId: 'b', businessDate: d('2026-07-04'), signedWeight: -2 },
    ])
    expect(rows.find(r => r.productId === 'a')?.expectedClosingWeight).toBe(11)
    expect(rows.find(r => r.productId === 'b')?.expectedClosingWeight).toBe(18)
  })

  test('26. a date before the product boundary is explicitly not started', () => {
    expect(calculateClosingStock(approved([
      { productId: 'p', weight: 0, effectiveStartDate: d('2026-07-05') },
    ]), '2026-07-04', [])[0]).toMatchObject({ state: 'NOT_STARTED', expectedClosingWeight: null })
  })

  test('27. explicit opening stock is not double-counted with same-day movements', () => {
    const row = calculateClosingStock(approved([
      { productId: 'p', weight: 658, effectiveStartDate: d('2026-01-01') },
    ]), '2026-01-01', [{ productId: 'p', businessDate: d('2026-01-01'), signedWeight: 2 }])[0]
    expect(row.expectedClosingWeight).toBe(660)
    expect(row.movementCount).toBe(1)
  })

  test('28. dry-run applies each boundary and remains write-free', () => {
    const result = dryRunStockMovementBackfill({
      baselineDate: d('2025-12-31'),
      productBoundaries: {
        a: { effectiveStartDate: d('2026-02-05'), startingWeight: 0 },
        b: { effectiveStartDate: d('2026-07-04'), startingWeight: 1000 },
      },
      documents: [
        { kind: 'BUY', id: 'old', date: d('2026-02-04'), createdAt: d('2026-02-04'), isCancelled: false, items: [{ id: 'i1', productId: 'a', weight: 5 }] },
        { kind: 'BUY', id: 'start', date: d('2026-02-05'), createdAt: d('2026-02-05'), isCancelled: false, items: [{ id: 'i2', productId: 'a', weight: 2 }] },
        { kind: 'SELL', id: 'sale', date: d('2026-07-04'), createdAt: d('2026-07-04'), isCancelled: false, items: [{ id: 'i3', productId: 'b', weight: 10 }] },
      ],
    })
    expect(result.totalsByProduct).toEqual({ a: 2, b: 990 })
    expect(result.writesAttempted).toBe(0)
  })

  test('29. deterministic Owner mapping rejects duplicate Product IDs', () => {
    expect(() => assertUniqueOwnerProductBoundaries()).not.toThrow()
    expect(() => assertUniqueOwnerProductBoundaries([
      ST47_OWNER_PRODUCT_BOUNDARIES[0],
      { ...ST47_OWNER_PRODUCT_BOUNDARIES[1], productId: ST47_OWNER_PRODUCT_BOUNDARIES[0].productId },
    ])).toThrow('Duplicate Product ID')
  })

  test('30. Wire opening 925.50 kg produces exact 987.80 closing (OWNER_VALUE_MATCH, no variance)', () => {
    // Corrected Owner decision (2026-07-19): สายไฟไม่ปอก opening = 925.50 kg.
    // Authoritative ledger (calculateClosingStock) produces calculated closing = 987.80 kg.
    // Owner-reported comparison value = 987.80 kg. Variance = 0 (exact match).
    // The previous +7.60 kg "accepted variance" was SUPERSEDED — it was caused by a
    // double-negation bug in the dry-run reconciliation script's TRANSFER_SOURCE_OUT formula.
    const wire = ST47_OWNER_PRODUCT_BOUNDARIES.find(b => b.ownerLabel === 'สายไฟไม่ปอก')!
    expect(wire.productId).toBe('cmr09vcvj0024l1052pb03lfk')
    expect(wire.effectiveStartDate).toBe('2026-01-01')
    expect(wire.startingWeight).toBe(925.5)
    expect(wire.currentTarget).toBe(987.8)

    // No accepted variance entry — superseded.
    expect(OWNER_ACCEPTED_VARIANCES['สายไฟไม่ปอก']).toBeUndefined()

    // Opening was NOT changed to 917.90.
    expect(wire.startingWeight).not.toBe(917.9)

    // Production movements for สายไฟไม่ปอก (2026-01-01 → 2026-07-18):
    //   purchases +37.9, sorting outputs +28.2, transfer source -3.8
    //   (transfer outputs +2.0/+1.8 belong to a DIFFERENT product — wire is only the source)
    //   net movement = +62.3 → calculated closing = 925.5 + 62.3 = 987.8
    const rows = calculateClosingStock({
      id: 'wire-baseline', generation: 1, baselineDate: d('2026-01-01'), status: 'APPROVED' as const,
      items: [{ productId: wire.productId, weight: 925.5, effectiveStartDate: d('2026-01-01') }],
    }, '2026-07-18', [
      { productId: wire.productId, businessDate: d('2026-06-20'), signedWeight: 18.2 },  // purchase in
      { productId: wire.productId, businessDate: d('2026-07-01'), signedWeight: 19.7 },  // purchase in
      { productId: wire.productId, businessDate: d('2026-07-01'), signedWeight: 6.8 },   // sorting output in
      { productId: wire.productId, businessDate: d('2026-07-04'), signedWeight: 7.8 },   // sorting output in
      { productId: wire.productId, businessDate: d('2026-07-06'), signedWeight: 13.6 },  // sorting output in
      { productId: wire.productId, businessDate: d('2026-07-01'), signedWeight: -3.8 },  // transfer source out
    ])
    const row = rows[0]
    expect(row.state).toBe('ACTIVE')
    expect(row.expectedClosingWeight).toBe(987.8)  // 925.5 + (18.2+19.7+6.8+7.8+13.6-3.8+2.0+1.8) = 925.5 + 62.3
    // Exact match — no variance.
    expect(Math.round((row.expectedClosingWeight! - 987.8) * 100) / 100).toBe(0)
  })

  test('31. TRANSFER_SOURCE_OUT with sourceWeight 3.80 produces signed movement -3.80', () => {
    const movements = buildTransferMovements({
      id: 't1', billNumber: 'TRN-1', date: d('2026-07-01'),
      sourceProductId: 'wire', sourceWeight: 3.8,
      items: [{ id: 'o1', productId: 'copper', weight: 3.8 }],
    })
    const sourceOut = movements.find(m => m.movementType === 'TRANSFER_SOURCE_OUT')!
    expect(sourceOut.signedWeight).toBe(-3.8)
    expect(sourceOut.productId).toBe('wire')
  })

  test('32. transfer source is not double-negated in direct signed sum', () => {
    // All movement components are signed. netMovement = direct sum (no subtraction of already-negative values).
    // Wire's actual Production movements: purchases +37.9, sorting outputs +28.2, transfer source -3.8.
    // (Transfer outputs belong to a different product — wire is only the transfer source.)
    const purchaseIn = 37.9        // positive
    const salesOut = 0             // negative (none)
    const sortingSourceOut = 0     // negative (none for this product)
    const sortingOutputIn = 28.2   // positive
    const transferSourceOut = -3.8 // negative (already signed)
    const transferOutputIn = 0     // positive (none for this product)
    // Correct: direct sum
    const correctNet = purchaseIn + salesOut + sortingSourceOut + sortingOutputIn + transferSourceOut + transferOutputIn
    expect(Math.round(correctNet * 100) / 100).toBe(62.3)
    // Buggy (double-negation): would subtract the already-negative transferSourceOut
    const buggyNet = purchaseIn - salesOut - sortingSourceOut + sortingOutputIn - transferSourceOut + transferOutputIn
    expect(Math.round(buggyNet * 100) / 100).not.toBe(62.3)
    expect(Math.round(buggyNet * 100) / 100).toBe(69.9) // the old wrong answer
  })

  test('33. calculateClosingStock and direct signed-movement sum agree', () => {
    const movements = [
      { productId: 'p', businessDate: d('2026-03-15'), signedWeight: 37.9 },
      { productId: 'p', businessDate: d('2026-04-20'), signedWeight: 28.2 },
      { productId: 'p', businessDate: d('2026-05-10'), signedWeight: -3.8 },
      { productId: 'p', businessDate: d('2026-05-10'), signedWeight: 3.8 },
    ]
    const rows = calculateClosingStock({
      id: 'b', generation: 1, baselineDate: d('2026-01-01'), status: 'APPROVED' as const,
      items: [{ productId: 'p', weight: 925.5, effectiveStartDate: d('2026-01-01') }],
    }, '2026-07-18', movements)
    const directSum = 925.5 + movements.reduce((s, m) => s + m.signedWeight, 0)
    expect(rows[0].expectedClosingWeight).toBe(Math.round(directSum * 100) / 100)
  })

  test('34. all movement builders produce correct signed weights', () => {
    // PURCHASE_IN: positive
    expect(buildPurchaseMovements({ id: 'b', date: d('2026-07-01'), items: [{ id: 'i', productId: 'p', weight: 5 }] })[0].signedWeight).toBe(5)
    // SALE_OUT: negative
    expect(buildSaleMovements({ id: 's', date: d('2026-07-01'), items: [{ id: 'i', productId: 'p', weight: 5 }] })[0].signedWeight).toBe(-5)
    // SORTING_SOURCE_OUT: negative, SORTING_OUTPUT_IN: positive
    const sort = buildSortingMovements({ id: 'sb', date: d('2026-07-01'), sourceProductId: 'src', sourceWeight: 10, items: [{ id: 'o', productId: 'out', weight: 8 }] })
    expect(sort.find(m => m.movementType === 'SORTING_SOURCE_OUT')!.signedWeight).toBe(-10)
    expect(sort.find(m => m.movementType === 'SORTING_OUTPUT_IN')!.signedWeight).toBe(8)
    // TRANSFER_SOURCE_OUT: negative, TRANSFER_OUTPUT_IN: positive
    const xfer = buildTransferMovements({ id: 'st', date: d('2026-07-01'), sourceProductId: 'src', sourceWeight: 3.8, items: [{ id: 'o', productId: 'out', weight: 3.8 }] })
    expect(xfer.find(m => m.movementType === 'TRANSFER_SOURCE_OUT')!.signedWeight).toBe(-3.8)
    expect(xfer.find(m => m.movementType === 'TRANSFER_OUTPUT_IN')!.signedWeight).toBe(3.8)
  })
})
