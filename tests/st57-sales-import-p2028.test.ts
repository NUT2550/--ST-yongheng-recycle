import { describe, expect, test } from 'bun:test'
import {
  applyImport,
  classifyImportBillError,
  type ImportApplyDeps,
  type ParsedBill,
} from '../src/lib/import-pipeline'
import {
  DuplicateExistingError,
  FifoMismatchError,
  FifoValidationError,
  InsufficientStockError,
  SourceLotConflictError,
} from '../src/lib/bill-errors'

const actor = { userId: 'user-1', username: 'tester', name: 'Tester', role: 'admin' as const }

function bill(number: string, weight = 10): ParsedBill {
  return {
    externalBillNumber: number,
    buyer: 'fixture',
    date: '2026-07-20T00:00:00.000Z',
    note: '',
    items: [{ productId: 'product-1', productName: 'เหล็ก', weight, pricePerKg: 20, totalAmount: weight * 20, matched: true }],
  }
}

function deps(createSalesBill: ImportApplyDeps['createSalesBill'], existing = new Set<string>()): ImportApplyDeps {
  return {
    loadExistingBillNumbers: async () => new Set(existing),
    checkStockAvailability: async () => ({ ok: true }),
    createPurchaseBill: async () => ({ id: 'unused', billNumber: 'BUY-unused' }),
    createSalesBill,
  }
}

describe('ST-57 typed safe error classification', () => {
  test('classifies P2028 without Prisma internals', () => {
    const result = classifyImportBillError(Object.assign(new Error('Transaction not found: prisma.stockLot.update'), { code: 'P2028' }))
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'TRANSACTION_TIMEOUT' })
    expect(result.safeMessage).toContain('ใช้เวลานานเกินกำหนด')
    expect(result.safeMessage).not.toContain('Transaction not found')
  })

  test('classifies stable production errors without forwarding messages', () => {
    const cases = [
      [new SourceLotConflictError(), 'SOURCE_LOT_CONFLICT'],
      [new FifoValidationError(), 'FIFO_VALIDATION_ERROR'],
      [new FifoMismatchError(), 'FIFO_MISMATCH'],
    ] as const
    for (const [error, code] of cases) {
      const result = classifyImportBillError(error)
      expect(result.errorCode).toBe(code)
      expect(result.safeMessage).not.toContain(error.message)
    }
  })

  test('reconstructs insufficient-stock Thai message from structured fields', () => {
    const error = new InsufficientStockError('product-1', 'เหล็ก', 100, 200)
    const result = classifyImportBillError(error)
    expect(result).toMatchObject({ status: 'INSUFFICIENT_STOCK', errorCode: 'INSUFFICIENT_STOCK' })
    expect(result.safeMessage).toBe('สต็อกไม่เพียงพอสำหรับ "เหล็ก". มี: 100 kg, ต้องการ: 200 kg')
    expect(result.safeMessage).not.toContain(error.message)
  })

  test('maps unknown values to a generic safe failure', () => {
    const result = classifyImportBillError(new Error('SELECT password FROM production'))
    expect(result).toMatchObject({ status: 'FAILED', errorCode: 'BILL_CREATE_FAILED' })
    expect(result.safeMessage).not.toContain('SELECT')
  })
})

describe('ST-57 executable applyImport behavior', () => {
  test('P2028 produces a per-bill safe timeout result', async () => {
    const summary = await applyImport('sales', [bill('S-1')], deps(async () => {
      throw Object.assign(new Error('raw Prisma P2028 transaction details'), { code: 'P2028' })
    }), actor)
    expect(summary.failedCount).toBe(1)
    expect(summary.failedBills[0]).toMatchObject({ errorCode: 'TRANSACTION_TIMEOUT', status: 'FAILED' })
    expect(summary.failedBills[0].error).not.toContain('Prisma')
  })

  test('one P2028 does not stop a later valid bill', async () => {
    let calls = 0
    const summary = await applyImport('sales', [bill('S-1'), bill('S-2')], deps(async () => {
      calls += 1
      if (calls === 1) throw Object.assign(new Error('timeout internals'), { code: 'P2028' })
      return { id: 'sell-2', billNumber: 'SELL-2' }
    }), actor)
    expect(summary).toMatchObject({ importedCount: 1, failedCount: 1 })
    expect(summary.importedBills[0].externalBillNumber).toBe('S-2')
  })

  test('classifies source conflict, unknown failure, and typed insufficient stock', async () => {
    for (const [error, expected] of [
      [new SourceLotConflictError(), 'SOURCE_LOT_CONFLICT'],
      [new Error('secret database detail'), 'BILL_CREATE_FAILED'],
      [new InsufficientStockError('product-1', 'เหล็ก', 1, 10), 'INSUFFICIENT_STOCK'],
    ] as const) {
      const summary = await applyImport('sales', [bill(`S-${expected}`)], deps(async () => { throw error }), actor)
      expect(summary.failedBills[0].errorCode).toBe(expected)
      expect(summary.failedBills[0].error).not.toContain(error.message)
    }
  })

  test('duplicate existing remains non-fatal and does not count as failed', async () => {
    const summary = await applyImport('sales', [bill('S-DUP')], deps(async () => {
      throw new DuplicateExistingError('externalBillNumber')
    }), actor)
    expect(summary).toMatchObject({ duplicateExistingCount: 1, failedCount: 0, importedCount: 0 })
  })

  test('summary counts mixed success, timeout, duplicate, and insufficient stock', async () => {
    const outcomes: unknown[] = [
      { id: 'sell-ok', billNumber: 'SELL-ok' },
      Object.assign(new Error('P2028 detail'), { code: 'P2028' }),
      new DuplicateExistingError('externalBillNumber'),
      new InsufficientStockError('product-1', 'เหล็ก', 0, 10),
    ]
    let index = 0
    const summary = await applyImport('sales', ['OK', 'TIMEOUT', 'DUP', 'STOCK'].map(value => bill(`S-${value}`)), deps(async () => {
      const outcome = outcomes[index++]
      if (outcome instanceof Error) throw outcome
      return outcome as { id: string; billNumber: string }
    }), actor)
    expect(summary).toMatchObject({ importedCount: 1, duplicateExistingCount: 1, insufficientStockCount: 1, failedCount: 1 })
    expect(summary.failedBills).toHaveLength(2)
  })
})
