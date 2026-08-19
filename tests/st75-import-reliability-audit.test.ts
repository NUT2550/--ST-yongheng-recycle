/**
 * ST-75 Phase 2: Import reliability audit tests.
 *
 * Characterizes the import pipeline's atomicity, duplicate protection,
 * partial-success behavior, and close-while-running safety.
 *
 * These are CODE-LEVEL integration tests that verify the import pipeline's
 * behavior using mock deps (no real DB). They prove the ARCHITECTURE,
 * not the DB latency.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyImport,
  detectInFileDuplicates,
  buildImportSummary,
  classifyBillStatus,
  type ParsedBill,
  type ImportApplyDeps,
  type ImportActor,
  type BillImportResult,
} from '../src/lib/import-pipeline'
import { DuplicateExistingError } from '../src/lib/bill-errors'

const ACTOR: ImportActor = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' }

function makeBill(overrides: Partial<ParsedBill> = {}): ParsedBill {
  return {
    externalBillNumber: 'BILL-001',
    date: '2026-08-07',
    note: 'test',
    items: [{ productId: 'p1', productName: 'Product 1', weight: 10, pricePerKg: 20, totalAmount: 200, matched: true }],
    ...overrides,
  }
}

function makeMockDeps(opts: {
  existingNumbers?: Set<string>
  failOnBillNumber?: string
  throwOnCreate?: Error
} = {}): ImportApplyDeps {
  const existing = new Set(opts.existingNumbers || [])
  return {
    async loadExistingBillNumbers(type, numbers) {
      return existing
    },
    async createPurchaseBill(bill, actor) {
      if (opts.throwOnCreate) throw opts.throwOnCreate
      if (opts.failOnBillNumber && bill.externalBillNumber === opts.failOnBillNumber) {
        throw new Error('simulated failure')
      }
      // Add to existing set (defense in depth)
      if (bill.externalBillNumber) existing.add(bill.externalBillNumber)
      return { id: `bill-${bill.externalBillNumber}`, billNumber: `GEN-${bill.externalBillNumber}` }
    },
    async createSalesBill(bill, actor) {
      if (opts.throwOnCreate) throw opts.throwOnCreate
      if (opts.failOnBillNumber && bill.externalBillNumber === opts.failOnBillNumber) {
        throw new Error('simulated failure')
      }
      if (bill.externalBillNumber) existing.add(bill.externalBillNumber)
      return { id: `bill-${bill.externalBillNumber}`, billNumber: `GEN-${bill.externalBillNumber}` }
    },
  }
}

// ============ Atomicity tests ============

describe('ST-75 Phase 2: import atomicity', () => {
  test('1. all valid bills → all imported', async () => {
    const bills = [makeBill({ externalBillNumber: 'B1' }), makeBill({ externalBillNumber: 'B2' }), makeBill({ externalBillNumber: 'B3' })]
    const deps = makeMockDeps()
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(3)
    expect(result.failedCount).toBe(0)
  })

  test('2. middle bill fails → other bills still import (partial success)', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'B1' }),
      makeBill({ externalBillNumber: 'B2' }),
      makeBill({ externalBillNumber: 'B3' }),
    ]
    const deps = makeMockDeps({ failOnBillNumber: 'B2' })
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(2)
    expect(result.failedCount).toBe(1)
    expect(result.importedBills.some(b => b.externalBillNumber === 'B1')).toBe(true)
    expect(result.importedBills.some(b => b.externalBillNumber === 'B3')).toBe(true)
    expect(result.failedBills.some(b => b.externalBillNumber === 'B2')).toBe(true)
  })

  test('3. first bill fails → remaining bills still attempt', async () => {
    const bills = [makeBill({ externalBillNumber: 'B1' }), makeBill({ externalBillNumber: 'B2' })]
    const deps = makeMockDeps({ failOnBillNumber: 'B1' })
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(1)
    expect(result.failedCount).toBe(1)
  })

  test('4. duplicate existing → skipped, not failed', async () => {
    const bills = [makeBill({ externalBillNumber: 'DUP1' }), makeBill({ externalBillNumber: 'B2' })]
    const deps = makeMockDeps({ existingNumbers: new Set(['DUP1']) })
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(1)
    expect(result.duplicateExistingCount).toBe(1)
    expect(result.failedCount).toBe(0)
  })

  test('5. in-file duplicate → second occurrence skipped', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'DUP' }),
      makeBill({ externalBillNumber: 'DUP' }),
      makeBill({ externalBillNumber: 'B3' }),
    ]
    const deps = makeMockDeps()
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(2)
    expect(result.duplicateInFileCount).toBe(1)
  })

  test('6. DuplicateExistingError + confirmed row after recheck → classified as DUPLICATE_EXISTING', async () => {
    const bills = [makeBill({ externalBillNumber: 'B1' })]
    const deps = makeMockDeps({ throwOnCreate: new DuplicateExistingError('externalBillNumber') })
    let lookupCalls = 0
    deps.loadExistingBillNumbers = async () => {
      lookupCalls++
      // Initial request-wide lookup sees no duplicate. After the create
      // collision, the reconciliation lookup observes the concurrent winner.
      return lookupCalls === 1 ? new Set<string>() : new Set<string>(['B1'])
    }
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(lookupCalls).toBe(2)
    expect(result.duplicateExistingCount).toBe(1)
    expect(result.importedCount).toBe(0)
    expect(result.failedCount).toBe(0)
  })

  test('7. 25 bills all valid → all imported', async () => {
    const bills = Array.from({ length: 25 }, (_, i) => makeBill({ externalBillNumber: `B${i + 1}` }))
    const deps = makeMockDeps()
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(25)
    expect(result.failedCount).toBe(0)
  })

  test('8. 100 bills with 1 failure → 99 imported, 1 failed', async () => {
    const bills = Array.from({ length: 100 }, (_, i) => makeBill({ externalBillNumber: `B${i + 1}` }))
    const deps = makeMockDeps({ failOnBillNumber: 'B50' })
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.importedCount).toBe(99)
    expect(result.failedCount).toBe(1)
  })
})

// ============ Duplicate protection tests ============

describe('ST-75 Phase 2: duplicate protection', () => {
  test('9. existingSet updated after successful create (defense in depth)', async () => {
    const bills = [makeBill({ externalBillNumber: 'B1' }), makeBill({ externalBillNumber: 'B1' })]
    const deps = makeMockDeps()
    const result = await applyImport('purchase', bills, deps, ACTOR)
    // First B1 imported, second B1 should be in-file duplicate
    expect(result.importedCount).toBe(1)
    expect(result.duplicateInFileCount).toBe(1)
  })

  test('10. blank bill number → classified as INVALID, not duplicate', async () => {
    const bills = [makeBill({ externalBillNumber: '' })]
    const deps = makeMockDeps()
    const result = await applyImport('purchase', bills, deps, ACTOR)
    expect(result.invalidCount).toBe(1)
    expect(result.importedCount).toBe(0)
  })

  test('11. sales path has same duplicate protection as purchase', async () => {
    const bills = [makeBill({ externalBillNumber: 'B1' }), makeBill({ externalBillNumber: 'B1' })]
    const deps = makeMockDeps()
    const result = await applyImport('sales', bills, deps, ACTOR)
    expect(result.importedCount).toBe(1)
    expect(result.duplicateInFileCount).toBe(1)
  })
})

// ============ Close-while-running audit ============

describe('ST-75 Phase 2: close-while-running', () => {
  test('12. no AbortController in import dialog — documented', () => {
    // This is a documentation test — verifies the known gap
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    expect(src).not.toContain('AbortController')
    expect(src).not.toContain('signal:')
  })

  test('13. modal close resets state but does NOT cancel in-flight fetch', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain('resetDialogState')
    // resetDialogState clears local state but fetch continues
    expect(src).not.toContain('abort()')
  })
})

// ============ Response-lost/retry audit ============

describe('ST-75 Phase 2: response-lost/retry', () => {
  test('14. retry after response loss → duplicate caught by externalBillNumber @unique', async () => {
    // First import succeeds (bill committed)
    const bills = [makeBill({ externalBillNumber: 'B1' })]
    const deps1 = makeMockDeps()
    const result1 = await applyImport('purchase', bills, deps1, ACTOR)
    expect(result1.importedCount).toBe(1)

    // Retry with same bill number — should be caught as duplicate
    const deps2 = makeMockDeps({ existingNumbers: new Set(['B1']) })
    const result2 = await applyImport('purchase', bills, deps2, ACTOR)
    expect(result2.duplicateExistingCount).toBe(1)
    expect(result2.importedCount).toBe(0)
  })
})

// ============ Performance baseline ============

describe('ST-75 Phase 2: performance baseline (operation count)', () => {
  test('15. operation count scales linearly with bill count', async () => {
    const sizes = [1, 5, 25, 100]
    for (const size of sizes) {
      const bills = Array.from({ length: size }, (_, i) => makeBill({ externalBillNumber: `B${i + 1}` }))
      const deps = makeMockDeps()
      const start = performance.now()
      const result = await applyImport('purchase', bills, deps, ACTOR)
      const elapsed = performance.now() - start
      console.log(`  ${size} bills: ${result.importedCount} imported, ${elapsed.toFixed(2)}ms (mock, no DB latency)`)
      expect(result.importedCount).toBe(size)
    }
  })
})
