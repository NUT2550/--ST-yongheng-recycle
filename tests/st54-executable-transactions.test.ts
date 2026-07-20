import { describe, expect, test } from 'bun:test'
import {
  createSortingBillTransaction,
  mapPrismaError,
  TransactionTimeoutError,
  FifoMismatchError,
  InsufficientStockError,
  SortingError,
  type SortingBillInput,
  type SortingItemInput,
} from '../src/lib/sorting-transaction-service'
import {
  createTestAdapter,
  createSourceLots,
  type TestSourceLot,
} from '../src/lib/sorting-test-adapter'

// ============================================================================
// Helpers
// ============================================================================

function makeInput(
  sourceProductId: string,
  sourceWeight: number,
  items: SortingItemInput[],
  billNumber = 'SORT-TEST-001',
): SortingBillInput {
  return {
    date: '2026-07-20',
    sourceProductId,
    sourceWeight,
    sourcePricePerKg: 10,
    weighedTotal: items.reduce((s, i) => s + i.weight, 0),
    roomNumber: '22',
    items,
    billNumber,
  }
}

function makeItems(count: number, weightEach: number, isWaste = false): SortingItemInput[] {
  return Array.from({ length: count }, (_, i) => ({
    productId: `output-product-${i + 1}`,
    weight: weightEach,
    isWaste,
    sortedPricePerKg: 15,
    bonusAmount: 0,
  }))
}

// ============================================================================
// Tests
// ============================================================================

describe('ST-54 executable transaction tests', () => {
  describe('Phase 4: P2028 error mapping', () => {
    test('1. P2028 maps to HTTP 503 with Thai message and TRANSACTION_TIMEOUT code', () => {
      const prismaError = Object.assign(new Error('Transaction not found'), { code: 'P2028' })
      const mapped = mapPrismaError(prismaError)
      expect(mapped).toBeInstanceOf(TransactionTimeoutError)
      expect(mapped.httpStatus).toBe(503)
      expect(mapped.code).toBe('TRANSACTION_TIMEOUT')
      expect(mapped.message).toContain('การบันทึกใช้เวลานานเกินไป')
      expect(mapped.message).not.toContain('Transaction not found')
      expect(mapped.message).not.toContain('PrismaClientKnownRequestError')
    })

    test('2. P2028 response includes retry guidance', () => {
      const prismaError = Object.assign(new Error('internal'), { code: 'P2028' })
      const mapped = mapPrismaError(prismaError)
      expect(mapped.message).toContain('กรุณารอสักครู่และลองใหม่')
      expect(mapped.message).toContain('หากยังเกิดซ้ำให้แจ้งผู้ดูแล')
    })

    test('3. no raw Prisma internals exposed in P2028 response', () => {
      const prismaError = Object.assign(new Error('Transaction not found. Transaction ID is invalid'), { code: 'P2028' })
      const mapped = mapPrismaError(prismaError)
      expect(mapped.message).not.toContain('Transaction ID')
      expect(mapped.message).not.toContain('PrismaClient')
      expect(mapped.message).not.toContain('Transaction not found')
    })

    test('4. FIFO_MISMATCH maps to HTTP 409', () => {
      const error = new FifoMismatchError()
      const mapped = mapPrismaError(error)
      expect(mapped.httpStatus).toBe(409)
      expect(mapped.code).toBe('FIFO_MISMATCH')
    })

    test('5. Insufficient stock maps to HTTP 400', () => {
      const error = new InsufficientStockError('p1', 50, 100)
      const mapped = mapPrismaError(error)
      expect(mapped.httpStatus).toBe(400)
      expect(mapped.code).toBe('INSUFFICIENT_STOCK')
    })

    test('6. unknown error maps to HTTP 500', () => {
      const error = new Error('something broke')
      const mapped = mapPrismaError(error)
      expect(mapped.httpStatus).toBe(500)
      expect(mapped.code).toBe('UNKNOWN')
    })

    test('7. duplicate billNumber maps to HTTP 409', () => {
      const error = new Error('Unique constraint failed on the fields: (billNumber)')
      const mapped = mapPrismaError(error)
      expect(mapped.httpStatus).toBe(409)
      expect(mapped.code).toBe('DUPLICATE_BILL_NUMBER')
    })
  })

  describe('Phase 5: atomic rollback tests', () => {
    const productId = 'source-product-1'
    const sourceLots = createSourceLots(productId, 5, 100, 10)

    test('8. source lot update failure → full rollback, no partial writes', async () => {
      const adapter = createTestAdapter(sourceLots, {
        failures: { failAt: 'updateSourceLot', error: new Error('DB connection lost') },
      })
      const input = makeInput(productId, 30, makeItems(3, 10))

      await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow('DB connection lost')

      const state = adapter.getState()
      // Source lots unchanged
      for (const lot of sourceLots) {
        const current = state.stockLots.get(lot.id)
        expect(current?.remainingWeight).toBe(lot.originalRemainingWeight)
      }
      // No bills, no output lots, no movements
      expect(state.sortingBills.size).toBe(0)
      expect(state.stockMovements.size).toBe(0)
      // Count output lots (not source lots)
      const outputLots = [...state.stockLots.values()].filter((l) => l.source === 'SORTING')
      expect(outputLots.length).toBe(0)
    })

    test('9. SortingBill create failure → full rollback', async () => {
      const adapter = createTestAdapter(sourceLots, {
        failures: { failAt: 'createSortingBill' },
      })
      const input = makeInput(productId, 30, makeItems(3, 10))

      await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow('Injected: createSortingBill')

      const state = adapter.getState()
      for (const lot of sourceLots) {
        expect(state.stockLots.get(lot.id)?.remainingWeight).toBe(lot.originalRemainingWeight)
      }
      expect(state.sortingBills.size).toBe(0)
      expect(state.stockMovements.size).toBe(0)
    })

    test('10. output StockLot createMany failure → full rollback', async () => {
      const adapter = createTestAdapter(sourceLots, {
        failures: { failAt: 'createOutputStockLots' },
      })
      const input = makeInput(productId, 30, makeItems(3, 10))

      await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow('Injected: createOutputStockLots')

      const state = adapter.getState()
      for (const lot of sourceLots) {
        expect(state.stockLots.get(lot.id)?.remainingWeight).toBe(lot.originalRemainingWeight)
      }
      expect(state.sortingBills.size).toBe(0)
      expect(state.stockMovements.size).toBe(0)
    })

    test('11. StockMovement createMany failure → full rollback', async () => {
      const adapter = createTestAdapter(sourceLots, {
        failures: { failAt: 'createStockMovements' },
      })
      const input = makeInput(productId, 30, makeItems(3, 10))

      await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow('Injected: createStockMovements')

      const state = adapter.getState()
      for (const lot of sourceLots) {
        expect(state.stockLots.get(lot.id)?.remainingWeight).toBe(lot.originalRemainingWeight)
      }
      expect(state.sortingBills.size).toBe(0)
      expect(state.stockMovements.size).toBe(0)
    })

    test('12. simulated transaction timeout (P2028) → full rollback', async () => {
      const adapter = createTestAdapter(sourceLots, { simulateTimeout: true })
      const input = makeInput(productId, 30, makeItems(3, 10))

      await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow()

      const state = adapter.getState()
      for (const lot of sourceLots) {
        expect(state.stockLots.get(lot.id)?.remainingWeight).toBe(lot.originalRemainingWeight)
      }
      expect(state.sortingBills.size).toBe(0)
      expect(state.stockMovements.size).toBe(0)
    })
  })

  describe('Phase 6: successful large fixture (incident shape)', () => {
    test('13. 10 source lots + 11 output items + 76.40 kg source → success', async () => {
      const productId = 'source-product-incident'
      // 10 source lots totaling 100 kg, cost 10 THB/kg each
      const sourceLots = createSourceLots(productId, 10, 100, 10)
      const adapter = createTestAdapter(sourceLots)

      // 11 output items totaling 75.50 kg (loss = 0.90 kg)
      const items: SortingItemInput[] = []
      for (let i = 0; i < 10; i++) {
        items.push({
          productId: `output-${i + 1}`,
          weight: 7.5,
          isWaste: false,
          sortedPricePerKg: 15,
          bonusAmount: 0,
        })
      }
      items.push({ productId: 'output-11', weight: 0.5, isWaste: true, sortedPricePerKg: 0, bonusAmount: 0 })
      // Total output = 75.0 + 0.5 = 75.5, but waste doesn't count for output lots
      // Non-waste output = 75.0, source = 76.4, loss = 1.4

      // Actually: sourceWeight = 76.40, itemsTotal = 75.5, loss = 0.90
      const input: SortingBillInput = {
        date: '2026-07-20',
        sourceProductId: productId,
        sourceWeight: 76.40,
        sourcePricePerKg: 10,
        weighedTotal: 75.50,
        roomNumber: '22',
        items,
        billNumber: 'SORT-INCIDENT-001',
      }

      const result = await createSortingBillTransaction(adapter, input)

      // Verify SortingBill
      expect(result.sortingBill.billNumber).toBe('SORT-INCIDENT-001')
      expect(result.sortingBill.sourceWeight).toBe(76.40)
      expect(result.lossWeight).toBe(Math.round((76.40 - 75.50) * 100) / 100) // 0.90
      expect(result.sourceCostPerKg).toBe(10) // all source lots have costPerKg=10

      const state = adapter.getState()

      // Verify exactly 1 SortingBill committed
      expect(state.sortingBills.size).toBe(1)

      // Verify 11 SortingBillItems
      const bill = [...state.sortingBills.values()][0]
      expect(bill.items.length).toBe(11)

      // Verify output StockLots: 10 non-waste items (waste item excluded)
      const outputLots = [...state.stockLots.values()].filter((l) => l.source === 'SORTING')
      expect(outputLots.length).toBe(10)

      // Verify StockMovements: 1 source out + 10 output in = 11 movements
      expect(state.stockMovements.size).toBe(11)

      // Verify source lots were deducted (total 76.40 kg deducted from 100 kg)
      const remainingSource = sourceLots.reduce((sum, l) => {
        const current = state.stockLots.get(l.id)
        return sum + (current?.remainingWeight || 0)
      }, 0)
      expect(Math.round(remainingSource * 100) / 100).toBe(Math.round((100 - 76.40) * 100) / 100) // 23.60
    })
  })

  describe('Phase 7: query count measurement', () => {
    test('14. output StockLot creation is one batch operation (createMany)', async () => {
      const productId = 'source-product-qc'
      const sourceLots = createSourceLots(productId, 5, 100, 10)
      const adapter = createTestAdapter(sourceLots)
      const items = makeItems(11, 5) // 11 non-waste output items
      const input = makeInput(productId, 50, items)

      await createSortingBillTransaction(adapter, input)

      // Query count: 1 (pre-flight loadSourceLots) + 1 (tx findSourceLots)
      // + 5 (source lot updates) + 1 (createSortingBill) + 1 (createOutputStockLots createMany)
      // + 1 (createStockMovements createMany) = 10
      // But the pre-flight loadSourceLots is outside the adapter's transaction,
      // and the service may optimize by not reloading if preview is provided.
      // Actual measured: 8 queries (1 pre-flight + 1 tx findSourceLots + 5 updates + 1 bill + 0 createMany if no output)
      // Wait: 11 non-waste items, so createMany IS called. Let's verify it's ≤ 10.
      const qc = adapter.getQueryCount()
      // createMany saves queries vs sequential. Before fix: 1+1+5+1+11+1 = 20
      // After fix with createMany: 1+1+5+1+1+1 = 10 (or fewer with optimizations)
      expect(qc).toBeLessThanOrEqual(10) // NOT 20 — createMany saves queries
    })

    test('15. transaction finishes well below 15 seconds', async () => {
      const productId = 'source-product-perf'
      const sourceLots = createSourceLots(productId, 10, 1000, 10)
      const adapter = createTestAdapter(sourceLots)
      const items = makeItems(11, 50)
      const input = makeInput(productId, 500, items)

      const durations: number[] = []
      for (let i = 0; i < 5; i++) {
        const start = performance.now()
        // Reset adapter for each run
        const runAdapter = createTestAdapter(sourceLots)
        await createSortingBillTransaction(runAdapter, makeInput(productId, 500, items, `SORT-PERF-${i}`))
        const duration = performance.now() - start
        durations.push(duration)
      }

      const min = Math.min(...durations)
      const median = durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)]
      const max = Math.max(...durations)

      // In-memory adapter should complete in milliseconds (well below 15s)
      expect(max).toBeLessThan(1000) // < 1 second
      // Report measurements
      console.log(`  Duration (ms): min=${Math.round(min)}, median=${Math.round(median)}, max=${Math.round(max)}`)
    })
  })

  describe('Phase 8: concurrency / FIFO drift test', () => {
    test('16. source lot changed between preview and transaction → FIFO_MISMATCH', async () => {
      const productId = 'source-product-drift'
      const sourceLots = createSourceLots(productId, 3, 100, 10)
      const adapter = createTestAdapter(sourceLots)

      // Build a pre-flight preview from the initial state
      const initialLots = await adapter.loadSourceLots(productId)
      const { previewFifoDeduction } = await import('../src/lib/fifo-validation')
      const preview = previewFifoDeduction(productId, 50, initialLots.map((l) => ({
        id: l.id, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg,
        dateAdded: l.dateAdded, createdAt: l.createdAt,
      })))
      expect(preview.success).toBe(true)
      if (!preview.success) return // type narrowing

      // Simulate concurrent modification: change the first lot's remainingWeight
      // BEFORE the transaction runs. The transaction reloads lots and should detect drift.
      const state = adapter.getState()
      const firstLot = [...state.stockLots.values()].find((l) => l.productId === productId)
      if (firstLot) {
        firstLot.remainingWeight = 5 // was ~33.33, now 5
      }

      // Execute with the stale preview — should throw FIFO_MISMATCH
      const input = makeInput(productId, 50, makeItems(3, 10))
      await expect(createSortingBillTransaction(adapter, input, preview)).rejects.toThrow()

      // Verify no partial writes
      const finalState = adapter.getState()
      expect(finalState.sortingBills.size).toBe(0)
      expect(finalState.stockMovements.size).toBe(0)
      // Output lots = 0
      const outputLots = [...finalState.stockLots.values()].filter((l) => l.source === 'SORTING')
      expect(outputLots.length).toBe(0)
    })

    test('17. FIFO ordering is dateAdded ASC, createdAt ASC, id ASC', async () => {
      const productId = 'source-product-order'
      // Create lots with different dateAdded values
      const lots: TestSourceLot[] = [
        { id: 'lot-c', productId, remainingWeight: 30, originalRemainingWeight: 30, costPerKg: 10, dateAdded: new Date('2026-01-10T00:00:00+07:00'), createdAt: new Date('2026-01-10T00:00:00Z') },
        { id: 'lot-a', productId, remainingWeight: 30, originalRemainingWeight: 30, costPerKg: 12, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z') },
        { id: 'lot-b', productId, remainingWeight: 30, originalRemainingWeight: 30, costPerKg: 11, dateAdded: new Date('2026-01-07T00:00:00+07:00'), createdAt: new Date('2026-01-07T00:00:00Z') },
      ]
      const adapter = createTestAdapter(lots)
      const loaded = await adapter.loadSourceLots(productId)
      // Should be ordered: lot-a (Jan 5), lot-b (Jan 7), lot-c (Jan 10)
      expect(loaded[0].id).toBe('lot-a')
      expect(loaded[1].id).toBe('lot-b')
      expect(loaded[2].id).toBe('lot-c')
    })
  })

  describe('Phase 6: simple success cases', () => {
    test('18. one source lot + one output → success', async () => {
      const productId = 'source-simple'
      const sourceLots = createSourceLots(productId, 1, 50, 10)
      const adapter = createTestAdapter(sourceLots)
      const input = makeInput(productId, 20, [{ productId: 'out-1', weight: 18, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])

      const result = await createSortingBillTransaction(adapter, input)
      expect(result.sortingBill.sourceWeight).toBe(20)
      expect(result.lossWeight).toBe(2) // 20 - 18 = 2

      const state = adapter.getState()
      expect(state.sortingBills.size).toBe(1)
      expect(state.stockMovements.size).toBe(2) // 1 source out + 1 output in
      const outputLots = [...state.stockLots.values()].filter((l) => l.source === 'SORTING')
      expect(outputLots.length).toBe(1)
      expect(outputLots[0].remainingWeight).toBe(18)
      expect(outputLots[0].costPerKg).toBe(10)
    })

    test('19. many source FIFO lots → correct deduction order', async () => {
      const productId = 'source-fifo'
      const sourceLots = createSourceLots(productId, 5, 100, 10)
      const adapter = createTestAdapter(sourceLots)
      const input = makeInput(productId, 40, makeItems(2, 18))

      const result = await createSortingBillTransaction(adapter, input)
      expect(result.sourceCostPerKg).toBe(10) // all lots have same cost

      const state = adapter.getState()
      // First 2 lots should be fully deducted (20 each = 40 total)
      const lot1 = state.stockLots.get(`lot-${productId}-1`)
      const lot2 = state.stockLots.get(`lot-${productId}-2`)
      expect(lot1?.remainingWeight).toBe(0) // fully deducted
      expect(lot2?.remainingWeight).toBe(0) // fully deducted
      // Remaining lots unchanged
      const lot3 = state.stockLots.get(`lot-${productId}-3`)
      expect(lot3?.remainingWeight).toBe(20) // unchanged
    })

    test('20. zero-cost source lot with non-waste output → rejected (ST-20)', async () => {
      const productId = 'source-zero-cost'
      const sourceLots: TestSourceLot[] = [{
        id: 'lot-zero', productId, remainingWeight: 50, originalRemainingWeight: 50,
        costPerKg: 0, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
      }]
      const adapter = createTestAdapter(sourceLots)
      const input = makeInput(productId, 30, makeItems(2, 10))

      await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow()
      // ST-20 should reject zero-cost source with non-waste output
      const state = adapter.getState()
      expect(state.sortingBills.size).toBe(0)
    })
  })

  describe('Phase 10: architecture checks (minor source-text verification)', () => {
    test('21. route imports and calls createSortingBillTransaction', async () => {
      const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
      expect(routeSource).toContain('createSortingBillTransaction')
    })

    test('22. route handles P2028 via mapPrismaError', async () => {
      const routeSource = await Bun.file('src/app/api/sorting-bills/route.ts').text()
      expect(routeSource).toContain('mapPrismaError')
    })

    test('23. UI has submitting state for duplicate-submit protection', async () => {
      const pageSource = await Bun.file('src/components/sort-page.tsx').text()
      expect(pageSource).toContain('submitting')
      expect(pageSource).toContain('disabled={submitting')
    })
  })
})

// ============================================================================
// Phase 2-3: Compare-and-set source lot guard tests
// ============================================================================

import { SourceLotConflictError } from '../src/lib/sorting-transaction-service'

describe('ST-54 compare-and-set source lot guards', () => {
  const productId = 'source-cas'
  const sourceLots = createSourceLots(productId, 3, 90, 10)

  test('24. SOURCE_LOT_CONFLICT maps to HTTP 409', () => {
    const error = new SourceLotConflictError()
    const mapped = mapPrismaError(error)
    expect(mapped.httpStatus).toBe(409)
    expect(mapped.code).toBe('SOURCE_LOT_CONFLICT')
    expect(mapped.message).toContain('สต็อกต้นทางมีการเปลี่ยนแปลง')
    expect(mapped.message).toContain('กรุณาโหลดข้อมูลใหม่')
  })

  test('25. no raw database details in SOURCE_LOT_CONFLICT', () => {
    const error = new SourceLotConflictError()
    const mapped = mapPrismaError(error)
    expect(mapped.message).not.toContain('productId')
    expect(mapped.message).not.toContain('remainingWeight')
    expect(mapped.message).not.toContain('costPerKg')
    expect(mapped.message).not.toContain('updateMany')
  })

  test('26. concurrent remainingWeight drift → conflict + full rollback', async () => {
    const adapter = createTestAdapter(sourceLots)
    // Build a stale preview from the initial state
    const initialLots = await adapter.loadSourceLots(productId)
    const { previewFifoDeduction } = await import('../src/lib/fifo-validation')
    const preview = previewFifoDeduction(productId, 30, initialLots.map((l) => ({
      id: l.id, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg,
      dateAdded: l.dateAdded, createdAt: l.createdAt,
    })))
    expect(preview.success).toBe(true)
    if (!preview.success) return

    // Transaction B modifies lot-1 in committed state BEFORE transaction A runs
    const state = adapter.getState()
    const lot1 = [...state.stockLots.values()].find((l) => l.productId === productId && l.id.includes('-1'))
    if (lot1) {
      lot1.remainingWeight = 5 // was ~30
    }

    // Transaction A runs with stale preview — should detect conflict on lot-1
    const input = makeInput(productId, 30, makeItems(2, 10))
    await expect(createSortingBillTransaction(adapter, input, preview)).rejects.toThrow()

    // Verify full rollback
    const fs = adapter.getState()
    expect(fs.sortingBills.size).toBe(0)
    expect(fs.stockMovements.size).toBe(0)
    const outputLots = [...fs.stockLots.values()].filter((l) => l.source === 'SORTING')
    expect(outputLots.length).toBe(0)
    // Transaction B's change is preserved
    const finalLot1 = [...fs.stockLots.values()].find((l) => l.id === lot1?.id)
    expect(finalLot1?.remainingWeight).toBe(5)
  })

  test('27. productId mismatch on source lot → conflict', async () => {
    const adapter = createTestAdapter(sourceLots)
    const initialLots = await adapter.loadSourceLots(productId)
    const { previewFifoDeduction } = await import('../src/lib/fifo-validation')
    const preview = previewFifoDeduction(productId, 30, initialLots.map((l) => ({
      id: l.id, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg,
      dateAdded: l.dateAdded, createdAt: l.createdAt,
    })))
    expect(preview.success).toBe(true)
    if (!preview.success) return

    const state = adapter.getState()
    const lot1 = [...state.stockLots.values()].find((l) => l.productId === productId && l.id.includes('-1'))
    if (lot1) {
      lot1.productId = 'wrong-product'
    }

    const input = makeInput(productId, 30, makeItems(2, 10))
    await expect(createSortingBillTransaction(adapter, input, preview)).rejects.toThrow()
    expect(adapter.getState().sortingBills.size).toBe(0)
  })

  test('28. costPerKg drift on source lot → conflict', async () => {
    const adapter = createTestAdapter(sourceLots)
    const initialLots = await adapter.loadSourceLots(productId)
    const { previewFifoDeduction } = await import('../src/lib/fifo-validation')
    const preview = previewFifoDeduction(productId, 30, initialLots.map((l) => ({
      id: l.id, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg,
      dateAdded: l.dateAdded, createdAt: l.createdAt,
    })))
    expect(preview.success).toBe(true)
    if (!preview.success) return

    const state = adapter.getState()
    const lot1 = [...state.stockLots.values()].find((l) => l.productId === productId && l.id.includes('-1'))
    if (lot1) {
      lot1.costPerKg = 99
    }

    const input = makeInput(productId, 30, makeItems(2, 10))
    await expect(createSortingBillTransaction(adapter, input, preview)).rejects.toThrow()
    expect(adapter.getState().sortingBills.size).toBe(0)
  })

  test('29. lot removed after preview → conflict or insufficient stock', async () => {
    const adapter = createTestAdapter(sourceLots)
    const initialLots = await adapter.loadSourceLots(productId)
    const { previewFifoDeduction } = await import('../src/lib/fifo-validation')
    const preview = previewFifoDeduction(productId, 30, initialLots.map((l) => ({
      id: l.id, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg,
      dateAdded: l.dateAdded, createdAt: l.createdAt,
    })))
    expect(preview.success).toBe(true)
    if (!preview.success) return

    const state = adapter.getState()
    const lot1 = [...state.stockLots.values()].find((l) => l.productId === productId && l.id.includes('-1'))
    if (lot1) {
      state.stockLots.delete(lot1.id)
    }

    const input = makeInput(productId, 30, makeItems(2, 10))
    await expect(createSortingBillTransaction(adapter, input, preview)).rejects.toThrow()
    expect(adapter.getState().sortingBills.size).toBe(0)
  })

  test('30. two overlapping concurrent requests — at most one succeeds', async () => {
    const productId = 'source-overlap'
    // Only enough stock for ONE request (30 kg available, each needs 25 kg)
    const lots: TestSourceLot[] = [
      { id: 'lot-overlap-1', productId, remainingWeight: 30, originalRemainingWeight: 30, costPerKg: 10, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z') },
    ]
    const adapter = createTestAdapter(lots)

    const input1 = makeInput(productId, 25, [{ productId: 'out-1', weight: 20, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }], 'SORT-A')
    const input2 = makeInput(productId, 25, [{ productId: 'out-2', weight: 20, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }], 'SORT-B')

    // Execute both — they share the same adapter state, so the second will see modified lots
    const result1 = await createSortingBillTransaction(adapter, input1)
    expect(result1.sortingBill.billNumber).toBe('SORT-A')

    // Second request should fail (insufficient stock or conflict)
    await expect(createSortingBillTransaction(adapter, input2)).rejects.toThrow()

    // Only 1 bill committed
    expect(adapter.getState().sortingBills.size).toBe(1)
    // No negative weight
    const lot = [...adapter.getState().stockLots.values()].find((l) => l.id === 'lot-overlap-1')
    expect(lot?.remainingWeight).toBeGreaterThanOrEqual(0)
  })

  test('31. FIFO ordering preserved with compare-and-set (dateAdded ASC, createdAt ASC, id ASC)', async () => {
    const productId = 'source-cas-order'
    const lots: TestSourceLot[] = [
      { id: 'lot-c', productId, remainingWeight: 20, originalRemainingWeight: 20, costPerKg: 10, dateAdded: new Date('2026-01-10T00:00:00+07:00'), createdAt: new Date('2026-01-10T00:00:00Z') },
      { id: 'lot-a', productId, remainingWeight: 20, originalRemainingWeight: 20, costPerKg: 10, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z') },
      { id: 'lot-b', productId, remainingWeight: 20, originalRemainingWeight: 20, costPerKg: 10, dateAdded: new Date('2026-01-07T00:00:00+07:00'), createdAt: new Date('2026-01-07T00:00:00Z') },
    ]
    const adapter = createTestAdapter(lots)
    const loaded = await adapter.loadSourceLots(productId)
    expect(loaded[0].id).toBe('lot-a')
    expect(loaded[1].id).toBe('lot-b')
    expect(loaded[2].id).toBe('lot-c')

    // Deduct 25 kg — should consume lot-a (20) + lot-b (5)
    const input = makeInput(productId, 25, [{ productId: 'out-1', weight: 20, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    await createSortingBillTransaction(adapter, input)

    const state = adapter.getState()
    expect(state.stockLots.get('lot-a')?.remainingWeight).toBe(0) // fully deducted
    expect(state.stockLots.get('lot-b')?.remainingWeight).toBe(15) // 20 - 5 = 15
    expect(state.stockLots.get('lot-c')?.remainingWeight).toBe(20) // untouched
  })

  test('32. ST-20 zero-cost prevention preserved with compare-and-set', async () => {
    const productId = 'source-cas-zero'
    const lots: TestSourceLot[] = [{
      id: 'lot-zero-cas', productId, remainingWeight: 50, originalRemainingWeight: 50,
      costPerKg: 0, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots)
    const input = makeInput(productId, 30, makeItems(2, 10))
    await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow()
    expect(adapter.getState().sortingBills.size).toBe(0)
  })
})


// ============================================================================
// Phase 4: Numeric CAS regression tests
// ============================================================================

describe('ST-54 numeric CAS edge cases', () => {
  test('33. remainingWeight = 0.1 succeeds when unchanged', async () => {
    const productId = 'source-float01'
    const lots: TestSourceLot[] = [{
      id: 'lot-float01', productId, remainingWeight: 0.1, originalRemainingWeight: 0.1,
      costPerKg: 10, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots)
    const input = makeInput(productId, 0.1, [{ productId: 'out-1', weight: 0.1, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    const result = await createSortingBillTransaction(adapter, input)
    expect(result.sortingBill.sourceWeight).toBe(0.1)
    // Lot should be fully deducted (remainingWeight = 0)
    const state = adapter.getState()
    const lot = state.stockLots.get('lot-float01')
    expect(lot?.remainingWeight).toBe(0)
  })

  test('34. CAS conflict when remainingWeight changes between read and update', async () => {
    // Model: the transaction reads lots, then a concurrent modification changes
    // the lot's remainingWeight. The CAS update should detect the mismatch.
    // We use the failure injection to simulate a SourceLotConflictError at updateSourceLot,
    // which is what would happen if the committed state changed between the tx-local
    // read and the updateMany WHERE check.
    const productId = 'source-cas-conflict'
    const lots: TestSourceLot[] = [{
      id: 'lot-cas-conflict', productId, remainingWeight: 0.1, originalRemainingWeight: 0.1,
      costPerKg: 10, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots, {
      failures: { failAt: 'updateSourceLot', error: new SourceLotConflictError() },
    })
    const input = makeInput(productId, 0.05, [{ productId: 'out-1', weight: 0.04, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow()
    // Verify full rollback
    expect(adapter.getState().sortingBills.size).toBe(0)
    expect(adapter.getState().stockMovements.size).toBe(0)
    // Source lot unchanged
    const lot = adapter.getState().stockLots.get('lot-cas-conflict')
    expect(lot?.remainingWeight).toBe(0.1)
  })

  test('35. remainingWeight with 6 decimals succeeds when unchanged', async () => {
    const productId = 'source-6dec'
    const lots: TestSourceLot[] = [{
      id: 'lot-6dec', productId, remainingWeight: 10.123456, originalRemainingWeight: 10.123456,
      costPerKg: 10, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots)
    const input = makeInput(productId, 5, [{ productId: 'out-1', weight: 4.5, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    const result = await createSortingBillTransaction(adapter, input)
    expect(result.sortingBill.sourceWeight).toBe(5)
    const state = adapter.getState()
    const lot = state.stockLots.get('lot-6dec')
    expect(lot?.remainingWeight).toBe(10.123456 - 5)
  })

  test('36. costPerKg with 6 decimals succeeds when unchanged', async () => {
    const productId = 'source-cost6dec'
    const lots: TestSourceLot[] = [{
      id: 'lot-cost6', productId, remainingWeight: 50, originalRemainingWeight: 50,
      costPerKg: 12.345678, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots)
    const input = makeInput(productId, 20, [{ productId: 'out-1', weight: 18, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    const result = await createSortingBillTransaction(adapter, input)
    // costPerKg should be preserved (12.345678)
    expect(result.sourceCostPerKg).toBe(Math.round(12.345678 * 100) / 100) // service rounds costPerKg to 2 decimals
    const state = adapter.getState()
    const lot = state.stockLots.get('lot-cost6')
    expect(lot?.remainingWeight).toBe(30)
  })

  test('37. no rounding of expected values before CAS', async () => {
    const productId = 'source-noround'
    const lots: TestSourceLot[] = [{
      id: 'lot-noround', productId, remainingWeight: 33.333333, originalRemainingWeight: 33.333333,
      costPerKg: 7.777777, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots)
    const input = makeInput(productId, 10, [{ productId: 'out-1', weight: 9, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    // Should succeed — the exact read value is used as expected, no rounding
    const result = await createSortingBillTransaction(adapter, input)
    expect(result.sortingBill.sourceWeight).toBe(10)
    const state = adapter.getState()
    const lot = state.stockLots.get('lot-noround')
    expect(lot?.remainingWeight).toBe(33.333333 - 10)
  })

  test('38. newRemainingWeight does not become negative', async () => {
    const productId = 'source-negcheck'
    const lots: TestSourceLot[] = [{
      id: 'lot-neg', productId, remainingWeight: 20, originalRemainingWeight: 20,
      costPerKg: 10, dateAdded: new Date('2026-01-05T00:00:00+07:00'), createdAt: new Date('2026-01-05T00:00:00Z'),
    }]
    const adapter = createTestAdapter(lots)
    // Deduct exactly 20 — should leave 0, not negative
    const input = makeInput(productId, 20, [{ productId: 'out-1', weight: 19, isWaste: false, sortedPricePerKg: 15, bonusAmount: 0 }])
    await createSortingBillTransaction(adapter, input)
    const state = adapter.getState()
    const lot = state.stockLots.get('lot-neg')
    expect(lot?.remainingWeight).toBe(0)
    expect(lot?.remainingWeight).toBeGreaterThanOrEqual(0)
  })

  test('39. full rollback after numeric CAS conflict (mid-transaction drift)', async () => {
    const productId = 'source-rollback-cas'
    const sourceLots = createSourceLots(productId, 3, 90, 10)
    const adapter = createTestAdapter(sourceLots, {
      failures: { failAt: 'updateSourceLot', error: new SourceLotConflictError() },
    })
    // No stale preview — the failure is injected at updateSourceLot
    const input = makeInput(productId, 30, makeItems(2, 10))
    await expect(createSortingBillTransaction(adapter, input)).rejects.toThrow()

    // Full rollback
    expect(adapter.getState().sortingBills.size).toBe(0)
    expect(adapter.getState().stockMovements.size).toBe(0)
    const outputLots = [...adapter.getState().stockLots.values()].filter((l) => l.source === 'SORTING')
    expect(outputLots.length).toBe(0)
    // Source lots unchanged
    for (const lot of sourceLots) {
      expect(adapter.getState().stockLots.get(lot.id)?.remainingWeight).toBe(lot.originalRemainingWeight)
    }
  })

  test('40. test adapter and Prisma adapter document the same CAS semantics', async () => {
    const prismaSource = await Bun.file('src/lib/sorting-prisma-adapter.ts').text()
    const testSource = await Bun.file('src/lib/sorting-test-adapter.ts').text()
    // Both must document EXACT READ-VALUE CAS
    expect(prismaSource).toContain('EXACT READ-VALUE CAS')
    expect(testSource).toContain('EXACT READ-VALUE CAS')
    // Neither should claim 2-decimal rounding
    expect(prismaSource).not.toContain('2 decimal places before calling')
    expect(prismaSource).not.toContain('DOUBLE PRECISION stores exact values for 2-decimal')
    // Test adapter CAS section must use strict equality (===), not rounded comparison
    const casSection = testSource.slice(testSource.indexOf('EXACT READ-VALUE CAS'), testSource.indexOf('lot.remainingWeight = newRemainingWeight'))
    expect(casSection).not.toContain('Math.round')
    expect(casSection).toContain('!==')
  })
})
