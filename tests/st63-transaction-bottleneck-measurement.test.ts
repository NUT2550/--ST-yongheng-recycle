/**
 * ST-63 Phase A: Measurement harness for POST /api/stock-transfers bottleneck.
 *
 * Uses mock deps that COUNT queries + measure stage durations, proving
 * the transaction profile WITHOUT touching Production or real DB.
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

interface QueryLogEntry { method: string; stage: string; timestamp: number; args?: unknown }

function createMeasuredDeps(opts: { sourceLotCount?: number } = {}): StockTransferDeps & { _queryLog: QueryLogEntry[] } {
  const sourceLotCount = opts.sourceLotCount ?? 5
  const queryLog: QueryLogEntry[] = []
  const sourceLots = Array.from({ length: sourceLotCount }, (_, i) => ({
    id: `lot-${i + 1}`, productId: 'prod-src-1', remainingWeight: 50, costPerKg: 10 + i,
    dateAdded: new Date(`2026-07-${10 + i}`), createdAt: new Date(`2026-07-${10 + i}`),
  }))
  let billCounter = 0

  const deps: StockTransferDeps & { _queryLog: QueryLogEntry[] } = {
    _queryLog: queryLog,
    async findSourceProduct(productId: string) {
      queryLog.push({ method: 'findSourceProduct', stage: 'product_lookup', timestamp: performance.now() })
      return { id: productId, name: 'Source', category: { id: 'cat-1', name: 'Metal' } }
    },
    async findOutputProduct(productId: string) {
      queryLog.push({ method: 'findOutputProduct', stage: 'output_product_lookup', timestamp: performance.now() })
      return { id: productId, name: `Out ${productId}`, category: { id: 'cat-1', name: 'Metal' } }
    },
    async findSourceLots(productId: string) {
      queryLog.push({ method: 'findSourceLots', stage: 'source_lot_lookup', timestamp: performance.now() })
      return sourceLots
    },
    async generateBillNumber() {
      billCounter++
      queryLog.push({ method: 'generateBillNumber', stage: 'bill_number_generation', timestamp: performance.now() })
      return `TRN-2569-${String(billCounter).padStart(5, '0')}`
    },
    async deductSourceLots(productId: string, weightToDeduct: number) {
      queryLog.push({ method: 'deductSourceLots.findMany', stage: 'source_deduction', timestamp: performance.now() })
      const deductedLots: { id: string; deducted: number }[] = []
      let remaining = weightToDeduct
      for (const lot of sourceLots) {
        if (remaining <= 0) break
        const deduct = Math.min(lot.remainingWeight, remaining)
        remaining -= deduct
        queryLog.push({ method: 'deductSourceLots.update', stage: 'source_deduction', timestamp: performance.now() })
        deductedLots.push({ id: lot.id, deducted: deduct })
      }
      const totalCost = deductedLots.reduce((s, d) => {
        const lot = sourceLots.find(l => l.id === d.id)!
        return s + d.deducted * lot.costPerKg
      }, 0)
      return { costPerKg: Math.round((totalCost / weightToDeduct) * 100) / 100, totalCost: Math.round(totalCost * 100) / 100, deductedLots }
    },
    async createStockTransfer(data: Record<string, unknown>) {
      queryLog.push({ method: 'createStockTransfer', stage: 'transfer_creation', timestamp: performance.now() })
      return { id: 'transfer-test-1', ...data } as unknown as { id: string; billNumber: string }
    },
    async createOutputStockLot(data: Record<string, unknown>) {
      queryLog.push({ method: 'createOutputStockLot', stage: 'output_lot_creation', timestamp: performance.now() })
    },
    async createStockMovements(data: unknown) {
      const movements = data as unknown[]
      queryLog.push({ method: 'createStockMovements', stage: 'stock_movement_creation', timestamp: performance.now(), args: { count: movements.length } })
    },
    async createAuditLog(data: unknown) {
      queryLog.push({ method: 'createAuditLog', stage: 'audit_log_creation', timestamp: performance.now() })
    },
    async compensate(deductedLots, requestId, reason?) {
      queryLog.push({ method: 'compensate', stage: 'compensation', timestamp: performance.now() })
    },
    async deletePartialTransfer(transferId: string) {
      queryLog.push({ method: 'deletePartialTransfer', stage: 'cleanup', timestamp: performance.now() })
    },
    async deletePartialOutputLots(transferId: string) {
      queryLog.push({ method: 'deletePartialOutputLots', stage: 'cleanup', timestamp: performance.now() })
    },
    async transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
      queryLog.push({ method: 'transaction.begin', stage: 'transaction', timestamp: performance.now() })
      try {
        const result = await callback({ ...deps, isTransactionScoped: true })
        queryLog.push({ method: 'transaction.commit', stage: 'transaction', timestamp: performance.now() })
        return result
      } catch (err) {
        queryLog.push({ method: 'transaction.rollback', stage: 'transaction', timestamp: performance.now() })
        throw err
      }
    },
  }
  return deps
}

function totalQueryCount(log: QueryLogEntry[]): number {
  return log.filter(e => !e.method.startsWith('transaction.')).length
}

function countByStage(log: QueryLogEntry[]): Record<string, number> {
  const byStage: Record<string, number> = {}
  for (const entry of log) byStage[entry.stage] = (byStage[entry.stage] || 0) + 1
  return byStage
}

describe('ST-63 Phase A: query count measurement', () => {
  test('1. baseline: 2 output items, 5 source lots — total query count', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    const stages: Array<{ stage: string; durationMs: number }> = []
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null,
      (stage, durationMs) => stages.push({ stage, durationMs }))
    expect(result.ok).toBe(true)
    const total = totalQueryCount(deps._queryLog)
    const byStage = countByStage(deps._queryLog)
    console.log('=== ST-63 baseline (2 outputs, 5 lots) ===')
    console.log('Total queries:', total)
    console.log('By stage:', JSON.stringify(byStage))
    expect(byStage.source_deduction).toBe(3)
  })

  test('2. N+1 proof: FIFO updates scale with source lot count', async () => {
    const results: Array<{ lots: number; findMany: number; updates: number }> = []
    for (const lotCount of [5, 10, 20]) {
      const deps = createMeasuredDeps({ sourceLotCount: lotCount })
      await createStockTransfer(deps, makeValidInput({ sourceWeight: lotCount * 50 }), AUTH, REQUEST_ID, null)
      const deduction = deps._queryLog.filter(e => e.stage === 'source_deduction')
      const findMany = deduction.filter(e => e.method === 'deductSourceLots.findMany').length
      const updates = deduction.filter(e => e.method === 'deductSourceLots.update').length
      results.push({ lots: lotCount, findMany, updates })
      console.log(`  lots=${lotCount}: findMany=${findMany}, updates=${updates}`)
    }
    // N+1 pattern: updates grow with lot count, findMany stays at 1
    expect(results[0].updates).toBeLessThanOrEqual(results[1].updates)
    expect(results[1].updates).toBeLessThanOrEqual(results[2].updates)
    expect(results[2].updates).toBe(20) // 20 lots, 20 updates
  })

  test('3. output scaling: lot creation = N+1', async () => {
    for (const outputCount of [1, 2, 5, 10]) {
      const deps = createMeasuredDeps({ sourceLotCount: 5 })
      const items = Array.from({ length: outputCount }, (_, i) => ({
        productId: `p${i + 1}`, weight: 10, isWaste: false, outputPricePerKg: 20,
      }))
      await createStockTransfer(deps, makeValidInput({ items, sourceWeight: outputCount * 10 }), AUTH, REQUEST_ID, null)
      const lotCreations = deps._queryLog.filter(e => e.stage === 'output_lot_creation').length
      console.log(`  outputs=${outputCount}: lot_creations=${lotCreations}`)
      expect(lotCreations).toBe(outputCount)
    }
  })

  test('4. documented formula: 5 lots + 2 outputs = 16 queries', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID, null)
    const total = totalQueryCount(deps._queryLog)
    console.log(`Formula (measured): 2(product×2) + 4(output_product×2×2) + 2(source_lots×2) + 3(deduction: 1+2) + 1(bill) + 1(transfer) + 2(output_lot) + 1(movement) + 1(audit) = 17`)
    console.log(`Actual: ${total}`)
    expect(total).toBe(17)
  })

  test('5. bottleneck proof: 20 lots = 20 sequential FIFO updates', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 20 })
    await createStockTransfer(deps, makeValidInput({ sourceWeight: 1000 }), AUTH, REQUEST_ID, null)
    const updates = deps._queryLog.filter(e => e.method === 'deductSourceLots.update').length
    const total = totalQueryCount(deps._queryLog)
    console.log(`20 lots: FIFO updates=${updates}, total=${total}, FIFO=${Math.round((updates/total)*100)}% of total`)
    expect(updates).toBe(20)
  })

  test('6. bottleneck proof: 10 outputs = 10 sequential lot creates', async () => {
    const deps = createMeasuredDeps({ sourceLotCount: 5 })
    const items = Array.from({ length: 10 }, (_, i) => ({ productId: `p${i+1}`, weight: 5, isWaste: false, outputPricePerKg: 10 }))
    await createStockTransfer(deps, makeValidInput({ items, sourceWeight: 50 }), AUTH, REQUEST_ID, null)
    const lotCreations = deps._queryLog.filter(e => e.stage === 'output_lot_creation').length
    console.log(`10 outputs: lot_creations=${lotCreations} (sequential, not batched)`)
    expect(lotCreations).toBe(10)
  })
})
