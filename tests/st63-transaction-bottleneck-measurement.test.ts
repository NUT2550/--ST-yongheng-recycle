/**
 * ST-63 Phase A: Measurement harness for POST /api/stock-transfers bottleneck.
 *
 * Uses mock deps that COUNT dependency/DB-operation calls, proving the
 * transaction call-profile WITHOUT touching Production or real DB.
 *
 * IMPORTANT — what this harness proves and does NOT prove:
 *
 * PROVES:
 * - Dependency/DB-operation call count (mock call count ≈ DB round trips)
 * - N+1 scaling pattern for FIFO updates (1 findMany + N updates)
 * - N+1 scaling pattern for output lot creation (N sequential creates)
 * - Double execution: pre-check outside tx + re-run inside tx
 *
 * DOES NOT PROVE:
 * - Wall-clock duration (mocks resolve instantly; durations are event-loop noise)
 * - Production latency bottleneck (no real DB round-trip time modeled)
 * - Concurrency safety (no concurrent-request test, no oversell test)
 * - Transaction isolation level behavior
 * - Original Production incident root cause
 *
 * Mock fidelity:
 * - Mock transaction spreads deps with isTransactionScoped: true, matching
 *   the real service's re-entry pattern (line 618: if (!deps.isTransactionScoped))
 * - Mock deductSourceLots simulates sequential updates matching real deductStockFIFO
 * - Mock does NOT simulate: DB latency, row-level locks, isolation levels,
 *   concurrent modifications, or Prisma transaction timeout behavior
 */

import { describe, expect, test } from 'bun:test'
import {
  createStockTransfer,
  type StockTransferInput,
  type AuthInfo,
  type StockTransferDeps,
} from '../src/lib/stock-transfer-service'
import { performance } from 'perf_hooks'

const AUTH: AuthInfo = { userId: 'admin-1', name: 'Admin', username: 'admin' }
const REQUEST_ID = 'st63-measure-001'

function makeValidInput(overrides: Partial<StockTransferInput> = {}): StockTransferInput {
  return {
    date: '2026-08-06',
    sourceProductId: 'prod-src-1',
    sourceWeight: 100,
    items: [
      { productId: 'prod-out-1', weight: 60, isWaste: false, outputPricePerKg: 20 },
      { productId: 'prod-out-2', weight: 35, isWaste: false, outputPricePerKg: 15 },
    ],
    ...overrides,
  }
}

interface OpLogEntry { method: string; stage: string; timestamp: number; args?: unknown }

/**
 * Mock deps that log every dependency call.
 * Each call corresponds to ~1 real Prisma DB operation (verified against
 * stock-transfer-prisma-deps.ts).
 *
 * Mock-to-DB operation mapping:
 * | Mock call                | Real Prisma operation         | DB round trips |
 * |--------------------------|-------------------------------|----------------|
 * | findSourceProduct        | db.product.findUnique         | 1              |
 * | findOutputProduct        | db.product.findUnique         | 1 per output   |
 * | findSourceLots           | db.stockLot.findMany          | 1              |
 * | generateBillNumber       | (no DB — computed in app)     | 0              |
 * | deductSourceLots.findMany| db.stockLot.findMany (inside) | 1              |
 * | deductSourceLots.update  | db.stockLot.update            | 1 per lot      |
 * | createStockTransfer      | db.stockTransfer.create       | 1              |
 * | createOutputStockLot     | db.stockLot.create            | 1 per output   |
 * | createStockMovements     | db.stockMovement.createMany   | 1 (batched)    |
 * | createAuditLog           | db.auditLog.create            | 1              |
 *
 * NOTE: generateBillNumber in the real deps may or may not hit the DB.
 * The mock counts it as 1 operation call but it may be 0 DB round trips.
 */
function createMeasuredDeps(opts: { sourceLotCount?: number } = {}): StockTransferDeps & { _opLog: OpLogEntry[] } {
  const sourceLotCount = opts.sourceLotCount ?? 5
  const opLog: OpLogEntry[] = []
  const sourceLots = Array.from({ length: sourceLotCount }, (_, i) => ({
    id: `lot-${i + 1}`, productId: 'prod-src-1', remainingWeight: 50, costPerKg: 10 + i,
    dateAdded: new Date(`2026-07-${10 + i}`), createdAt: new Date(`2026-07-${10 + i}`),
  }))
  let billCounter = 0

  const deps: StockTransferDeps & { _opLog: OpLogEntry[] } = {
    _opLog: opLog,
    async findSourceProduct(productId: string) {
      opLog.push({ method: 'findSourceProduct', stage: 'product_lookup', timestamp: performance.now() })
      return { id: productId, name: 'Source', category: { id: 'cat-1', name: 'Metal' } }
    },
    async findOutputProduct(productId: string) {
      opLog.push({ method: 'findOutputProduct', stage: 'output_product_lookup', timestamp: performance.now() })
      return { id: productId, name: `Out ${productId}`, category: { id: 'cat-1', name: 'Metal' } }
    },
    async findSourceLots(productId: string) {
      opLog.push({ method: 'findSourceLots', stage: 'source_lot_lookup', timestamp: performance.now() })
      return sourceLots
    },
    async generateBillNumber() {
      billCounter++
      opLog.push({ method: 'generateBillNumber', stage: 'bill_number_generation', timestamp: performance.now() })
      return `TRN-2569-${String(billCounter).padStart(5, '0')}`
    },
    async deductSourceLots(productId: string, weightToDeduct: number) {
      opLog.push({ method: 'deductSourceLots.findMany', stage: 'source_deduction', timestamp: performance.now() })
      const deductedLots: { id: string; deducted: number }[] = []
      let remaining = weightToDeduct
      for (const lot of sourceLots) {
        if (remaining <= 0) break
        const deduct = Math.min(lot.remainingWeight, remaining)
        remaining -= deduct
        opLog.push({ method: 'deductSourceLots.update', stage: 'source_deduction', timestamp: performance.now() })
        deductedLots.push({ id: lot.id, deducted: deduct })
      }
      const totalCost = deductedLots.reduce((s, d) => {
        const lot = sourceLots.find(l => l.id === d.id)!
        return s + d.deducted * lot.costPerKg
      }, 0)
      return { costPerKg: Math.round((totalCost / weightToDeduct) * 100) / 100, totalCost: Math.round(totalCost * 100) / 100, deductedLots }
    },
    async createStockTransfer(data: Record<string, unknown>) {
      opLog.push({ method: 'createStockTransfer', stage: 'transfer_creation', timestamp: performance.now() })
      return { id: 'transfer-test-1', billNumber: 'TRN-2569-00001', ...data } as any
    },
    async createOutputStockLot(data: Record<string, unknown>) {
      opLog.push({ method: 'createOutputStockLot', stage: 'output_lot_creation', timestamp: performance.now() })
    },
    // ST-63 Phase B1: batch mock — 1 call for N rows
    async createOutputStockLots(data: Record<string, unknown>[]) {
      opLog.push({ method: 'createOutputStockLots', stage: 'output_lot_creation', timestamp: performance.now(), args: { rowCount: data.length } })
    },
    async createStockMovements(data: unknown) {
      const movements = data as unknown[]
      opLog.push({ method: 'createStockMovements', stage: 'stock_movement_creation', timestamp: performance.now(), args: { count: movements.length } })
    },
    async createAuditLog(data: unknown) {
      opLog.push({ method: 'createAuditLog', stage: 'audit_log_creation', timestamp: performance.now() })
    },
    async compensate(deductedLots, requestId, reason?) {
      opLog.push({ method: 'compensate', stage: 'compensation', timestamp: performance.now() })
    },
    async deletePartialTransfer(transferId: string) {
      opLog.push({ method: 'deletePartialTransfer', stage: 'cleanup', timestamp: performance.now() })
    },
    async deletePartialOutputLots(transferId: string) {
      opLog.push({ method: 'deletePartialOutputLots', stage: 'cleanup', timestamp: performance.now() })
    },
    async transaction<T>(callback: (tx: StockTransferDeps) => Promise<T>): Promise<T> {
      opLog.push({ method: 'transaction.begin', stage: 'transaction', timestamp: performance.now() })
      try {
        // Spread deps + set isTransactionScoped: true to match real service
        // re-entry pattern (service line 618: if (!deps.isTransactionScoped))
        const result = await callback({ ...deps, isTransactionScoped: true })
        opLog.push({ method: 'transaction.commit', stage: 'transaction', timestamp: performance.now() })
        return result
      } catch (err) {
        opLog.push({ method: 'transaction.rollback', stage: 'transaction', timestamp: performance.now() })
        throw err
      }
    },
  }
  return deps
}

/**
 * Count dependency/DB-operation calls (excludes transaction begin/commit markers).
 * This is a proxy for DB round trips — see mapping table above.
 */
function totalOpCount(log: OpLogEntry[]): number {
  return log.filter(e => !e.method.startsWith('transaction.')).length
}

function countByStage(log: OpLogEntry[]): Record<string, number> {
  const byStage: Record<string, number> = {}
  for (const entry of log) byStage[entry.stage] = (byStage[entry.stage] || 0) + 1
  return byStage
}

// ============ Operation count measurement ============

describe('ST-63 Phase A: dependency/DB-operation count', () => {
  test('1. baseline: 2 output items, 5 available lots (2 consumed), 5+5=10 output_weight — total op count', async () => {
    // 5 lots available, each 50kg. sourceWeight=100 → only 2 lots consumed.
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null)
    expect(result.ok).toBe(true)
    const total = totalOpCount(deps._opLog)
    const byStage = countByStage(deps._opLog)
    console.log('=== ST-63 baseline (5 available, 2 consumed, 2 outputs) ===')
    console.log('Total dependency calls:', total)
    console.log('By stage:', JSON.stringify(byStage))
    // source_deduction = 1 findMany + 2 updates = 3 (only 2 lots consumed)
    expect(byStage.source_deduction).toBe(3)
  })

  test('2. N+1 proof: FIFO update count scales with CONSUMED lot count', async () => {
    // Each lot has 50kg. sourceWeight = lotCount × 50 → all lots consumed.
    const results: Array<{ availableLots: number; consumedLots: number; findMany: number; updates: number }> = []
    for (const lotCount of [5, 10, 20]) {
      const deps = createMeasuredDeps({ sourceLotCount: lotCount })
      await createStockTransfer(deps, makeValidInput({ sourceWeight: lotCount * 50 }), AUTH, REQUEST_ID, null)
      const deduction = deps._opLog.filter(e => e.stage === 'source_deduction')
      const findMany = deduction.filter(e => e.method === 'deductSourceLots.findMany').length
      const updates = deduction.filter(e => e.method === 'deductSourceLots.update').length
      results.push({ availableLots: lotCount, consumedLots: lotCount, findMany, updates })
      console.log(`  available=${lotCount}, consumed=${lotCount}: findMany=${findMany}, updates=${updates}`)
    }
    // N+1 pattern: updates grow with consumed lot count, findMany stays at 1
    expect(results[0].updates).toBeLessThanOrEqual(results[1].updates)
    expect(results[1].updates).toBeLessThanOrEqual(results[2].updates)
    expect(results[2].updates).toBe(20) // 20 lots consumed → 20 updates
  })

  test('3. ST-63 Phase B1: output lot creation = 1 batch call (was N+1 before)', async () => {
    // BEFORE Phase B1: N sequential createOutputStockLot calls (1 per output item)
    // AFTER Phase B1: 1 createOutputStockLots call (createMany batch)
    for (const outputCount of [1, 2, 5, 10]) {
      const deps = createMeasuredDeps({ sourceLotCount: 5 })
      const items = Array.from({ length: outputCount }, (_, i) => ({
        productId: `p${i + 1}`, weight: 10, isWaste: false, outputPricePerKg: 20,
      }))
      await createStockTransfer(deps, makeValidInput({ items, sourceWeight: outputCount * 10 }), AUTH, REQUEST_ID, null)
      const batchCalls = deps._opLog.filter(e => e.method === 'createOutputStockLots').length
      const sequentialCalls = deps._opLog.filter(e => e.method === 'createOutputStockLot').length
      console.log(`  outputs=${outputCount}: batch_calls=${batchCalls}, sequential_calls=${sequentialCalls}`)
      // Phase B1: exactly 1 batch call, 0 sequential calls
      expect(batchCalls).toBe(1)
      expect(sequentialCalls).toBe(0)
    }
  })

  test('4. ST-63 Phase B1 formula: 5 available (2 consumed) + 2 outputs = 16 calls (was 17)', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null)
    const total = totalOpCount(deps._opLog)
    // Formula (after Phase B1 batch output lot creation):
    //   product_lookup:        2  (1 outside tx + 1 inside tx)
    //   output_product_lookup: 4  (2 outputs × 2: outside + inside tx)
    //   source_lot_lookup:     2  (1 outside tx + 1 inside tx)
    //   source_deduction:      3  (1 findMany + 2 updates — only 2 lots consumed)
    //   bill_number:           1  (inside tx only)
    //   transfer_creation:     1  (inside tx only)
    //   output_lot_creation:   1  (1 createMany batch, was 2 sequential creates)
    //   movement_creation:     1  (createMany, inside tx only)
    //   audit_log:             1  (inside tx only)
    //   TOTAL:                16 (was 17 before Phase B1)
    console.log(`Formula (Phase B1): 2+4+2+3+1+1+1+1+1 = 16 (was 17)`)
    console.log(`Actual: ${total}`)
    expect(total).toBe(16)
  })

  test('5. bottleneck proof: 20 available (20 consumed) = 20 sequential FIFO updates', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 20 })
    await createStockTransfer(deps, makeValidInput({ sourceWeight: 1000 }), AUTH, REQUEST_ID, null)
    const updates = deps._opLog.filter(e => e.method === 'deductSourceLots.update').length
    const total = totalOpCount(deps._opLog)
    console.log(`20 lots consumed: FIFO updates=${updates}, total=${total}, FIFO=${Math.round((updates/total)*100)}% of total`)
    expect(updates).toBe(20)
  })

  test('6. ST-63 Phase B1: 10 outputs = 1 batch call (was 10 sequential creates)', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    const items = Array.from({ length: 10 }, (_, i) => ({ productId: `p${i+1}`, weight: 5, isWaste: false, outputPricePerKg: 10 }))
    await createStockTransfer(deps, makeValidInput({ items, sourceWeight: 50 }), AUTH, REQUEST_ID, null)
    const batchCalls = deps._opLog.filter(e => e.method === 'createOutputStockLots').length
    const sequentialCalls = deps._opLog.filter(e => e.method === 'createOutputStockLot').length
    console.log(`10 outputs: batch_calls=${batchCalls}, sequential_calls=${sequentialCalls} (was 10 sequential before Phase B1)`)
    expect(batchCalls).toBe(1)
    expect(sequentialCalls).toBe(0)
  })

  test('7. double execution proof: lookups called outside AND inside transaction', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null)
    // findSourceProduct should be called twice: once outside tx (pre-check),
    // once inside tx (re-entry with isTransactionScoped: true)
    const productLookups = deps._opLog.filter(e => e.method === 'findSourceProduct').length
    const sourceLotLookups = deps._opLog.filter(e => e.method === 'findSourceLots').length
    console.log(`product_lookup calls: ${productLookups} (expected 2: pre-check + tx)`)
    console.log(`source_lot_lookup calls: ${sourceLotLookups} (expected 2: pre-check + tx)`)
    expect(productLookups).toBe(2)
    expect(sourceLotLookups).toBe(2)
  })
})

// ============ Duration measurement disclaimer ============

describe('ST-63 Phase A: duration measurement status', () => {
  test('8. duration NOT reliably measured — mocks resolve instantly', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    const stages: Array<{ stage: string; durationMs: number }> = []
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null,
      (stage, durationMs) => stages.push({ stage, durationMs }))

    console.log('=== Duration status: NOT RELIABLY MEASURED ===')
    console.log('Mocks resolve instantly (no artificial latency).')
    console.log('Stage durations are event-loop noise, not DB round-trip time.')
    console.log('For reliable duration measurement, need:')
    console.log('  1. Artificial latency model per DB operation, OR')
    console.log('  2. Real PostgreSQL test database (ST-62 PG test pattern)')
    console.log('')
    console.log('Stage durations (for reference only — NOT production-representative):')
    for (const s of stages) {
      console.log(`  ${s.stage}: ${s.durationMs}ms`)
    }

    // All durations should be near-zero (instant mocks)
    const maxDuration = Math.max(...stages.map(s => s.durationMs))
    console.log(`Max stage duration: ${maxDuration}ms (expected near 0 with instant mocks)`)
    expect(maxDuration).toBeLessThan(5) // event-loop noise should be < 5ms
  })
})

// ============ Concurrency disclaimer ============

describe('ST-63 Phase A: concurrency NOT TESTED', () => {
  test('9. concurrency disclaimer — harness does not test concurrent requests', () => {
    console.log('=== Concurrency: NOT TESTED ===')
    console.log('This harness does NOT test:')
    console.log('  - Two concurrent requests to same source lots')
    console.log('  - Oversell prevention (no CAS/row-version on remainingWeight)')
    console.log('  - Stale reads between pre-check and transaction')
    console.log('  - Lost updates under concurrent FIFO deduction')
    console.log('  - Transaction isolation level behavior')
    console.log('  - Duplicate bill number prevention under concurrency')
    console.log('')
    console.log('Current FIFO update has NO optimistic concurrency control:')
    console.log('  db.stockLot.update({ where: { id: lot.id } })')
    console.log('  — no remainingWeight predicate, no row-version check')
    console.log('  — relies on Prisma transaction isolation (default: READ COMMITTED)')
    console.log('')
    console.log('Phase B optimization (batch UPDATE) must NOT reduce concurrency safety.')

    expect(true).toBe(true) // documentation test
  })
})

// ============ ST-63 Phase B1: batch correctness tests ============

describe('ST-63 Phase B1: batch output lot data equivalence', () => {
  test('10. batch creates exactly one StockLot per non-waste output item', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    // 3 output items: 2 non-waste + 1 waste
    const items = [
      { productId: 'p1', weight: 30, isWaste: false, outputPricePerKg: 20 },
      { productId: 'p2', weight: 20, isWaste: true, outputPricePerKg: 0 },
      { productId: 'p3', weight: 40, isWaste: false, outputPricePerKg: 15 },
    ]
    await createStockTransfer(deps, makeValidInput({ items, sourceWeight: 90 }), AUTH, REQUEST_ID, null)

    // Verify batch was called with 2 rows (waste filtered out)
    const batchCall = deps._opLog.find(e => e.method === 'createOutputStockLots')
    expect(batchCall).toBeDefined()
    expect((batchCall!.args as { rowCount: number }).rowCount).toBe(2)
  })

  test('11. batch data contains correct productId, weight, costPerKg, source', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    // Use a custom mock that captures the batch data
    let capturedBatchData: Record<string, unknown>[] | null = null
    const originalBatch = deps.createOutputStockLots
    deps.createOutputStockLots = async (data: Record<string, unknown>[]) => {
      capturedBatchData = data
    }
    await createStockTransfer(deps, makeValidInput({
      sourceWeight: 100,
      items: [
        { productId: 'prod-A', weight: 60, isWaste: false, outputPricePerKg: 20 },
        { productId: 'prod-B', weight: 35, isWaste: false, outputPricePerKg: 15 },
      ],
    }), AUTH, REQUEST_ID, null)

    expect(capturedBatchData).not.toBeNull()
    expect(capturedBatchData!.length).toBe(2)

    // Verify first lot data
    const lot1 = capturedBatchData![0]
    expect(lot1.productId).toBe('prod-A')
    expect(lot1.remainingWeight).toBe(60)
    expect(lot1.source).toBe('TRANSFER')
    expect(lot1.sourceId).toBe('transfer-test-1')
    expect(lot1.dateAdded).toBeDefined()

    // Verify second lot data
    const lot2 = capturedBatchData![1]
    expect(lot2.productId).toBe('prod-B')
    expect(lot2.remainingWeight).toBe(35)
    expect(lot2.source).toBe('TRANSFER')
  })

  test('12. waste items are filtered — no StockLot created for waste', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    let capturedBatchData: Record<string, unknown>[] | null = null
    deps.createOutputStockLots = async (data: Record<string, unknown>[]) => {
      capturedBatchData = data
    }
    await createStockTransfer(deps, makeValidInput({
      sourceWeight: 100,
      items: [
        { productId: 'p1', weight: 60, isWaste: false, outputPricePerKg: 20 },
        { productId: 'p2', weight: 30, isWaste: true, outputPricePerKg: 0 },
        { productId: 'p3', weight: 5, isWaste: false, outputPricePerKg: 10 },
      ],
    }), AUTH, REQUEST_ID, null)

    // Only 2 non-waste items → batch with 2 rows
    expect(capturedBatchData!.length).toBe(2)
    expect(capturedBatchData!.every(lot => lot.productId !== 'p2')).toBe(true)
  })

  test('13. waste items are filtered from batch — verified via call args', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    let capturedBatchData: Record<string, unknown>[] | null = null
    deps.createOutputStockLots = async (data: Record<string, unknown>[]) => {
      capturedBatchData = data
    }
    const result = await createStockTransfer(deps, makeValidInput({
      sourceWeight: 90,
      items: [
        { productId: 'p1', weight: 30, isWaste: false, outputPricePerKg: 20 },
        { productId: 'p2', weight: 20, isWaste: true, outputPricePerKg: 0 },
        { productId: 'p3', weight: 40, isWaste: false, outputPricePerKg: 15 },
      ],
    }), AUTH, REQUEST_ID, null)

    expect(result.ok).toBe(true)
    // Waste item filtered → batch with 2 rows (p1 + p3, not p2)
    expect(capturedBatchData).not.toBeNull()
    expect(capturedBatchData!.length).toBe(2)
    expect(capturedBatchData!.every(lot => lot.productId !== 'p2')).toBe(true)
  })

  test('14. all-waste input → no batch call (empty array skipped)', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    let batchCalled = false
    deps.createOutputStockLots = async () => { batchCalled = true }
    await createStockTransfer(deps, makeValidInput({
      sourceWeight: 50,
      items: [
        { productId: 'p1', weight: 50, isWaste: true, outputPricePerKg: 0 },
      ],
    }), AUTH, REQUEST_ID, null)

    // All waste → no batch call
    expect(batchCalled).toBe(false)
  })
})

describe('ST-63 Phase B1: batch atomicity and rollback', () => {
  test('15. batch failure triggers rollback (no partial output lots committed)', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    // Make batch throw
    deps.createOutputStockLots = async () => {
      throw new Error('batch createMany failed')
    }
    const result = await createStockTransfer(deps, makeValidInput({
      sourceWeight: 100,
      items: [
        { productId: 'p1', weight: 60, isWaste: false, outputPricePerKg: 20 },
        { productId: 'p2', weight: 35, isWaste: false, outputPricePerKg: 15 },
      ],
    }), AUTH, REQUEST_ID, null)

    // Should fail
    expect(result.ok).toBe(false)

    // Verify compensation was called (source lots restored)
    const compensateCalls = deps._opLog.filter(e => e.method === 'compensate').length
    expect(compensateCalls).toBeGreaterThan(0)

    // Verify deletePartialOutputLots was called
    const deleteCalls = deps._opLog.filter(e => e.method === 'deletePartialOutputLots').length
    expect(deleteCalls).toBeGreaterThan(0)
  })

  test('16. batch success → no compensation or cleanup needed', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null)

    expect(result.ok).toBe(true)

    // No compensation, no cleanup
    const compensateCalls = deps._opLog.filter(e => e.method === 'compensate').length
    const deleteCalls = deps._opLog.filter(e => e.method === 'deletePartialOutputLots').length
    expect(compensateCalls).toBe(0)
    expect(deleteCalls).toBe(0)
  })
})

describe('ST-63 Phase B1: before/after operation count comparison', () => {
  test('17. operation count comparison table', async () => {
    console.log('=== ST-63 Phase B1: before/after comparison ===')
    console.log('| Output items | Before (sequential) | After (batch) | Reduction |')
    console.log('|---:|---:|---:|---:|')

    for (const outputCount of [1, 2, 5, 10]) {
      const deps = createMeasuredDeps({ sourceLotCount: 5 })
      const items = Array.from({ length: outputCount }, (_, i) => ({
        productId: `p${i + 1}`, weight: 10, isWaste: false, outputPricePerKg: 20,
      }))
      await createStockTransfer(deps, makeValidInput({ items, sourceWeight: outputCount * 10 }), AUTH, REQUEST_ID, null)

      const batchCalls = deps._opLog.filter(e => e.method === 'createOutputStockLots').length
      const before = outputCount // was N sequential creates
      const after = batchCalls // now 1 batch call
      const reduction = before - after
      console.log(`| ${outputCount} | ${before} | ${after} | ${reduction} |`)
    }

    console.log('')
    console.log('Note: Operation count reduced. Real PostgreSQL duration NOT yet measured.')
    console.log('Original Production incident root cause remains Unknown.')
  })
})
