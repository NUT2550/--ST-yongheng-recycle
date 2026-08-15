import { describe, expect, test } from 'bun:test'
import { DuplicateExistingError } from '../src/lib/bill-errors'
import {
  applyImport,
  type ImportActor,
  type ImportApplyDeps,
  type ParsedBill,
} from '../src/lib/import-pipeline'

const ACTOR: ImportActor = {
  userId: 'st75-test',
  username: 'st75-test',
  name: 'ST-75 Test',
  role: 'admin',
}

const BILL: ParsedBill = {
  externalBillNumber: 'ST75-P2E-001',
  date: '2026-08-15',
  note: 'synthetic P2-E reconciliation test',
  items: [
    {
      productId: 'synthetic-product',
      productName: 'Synthetic Product',
      weight: 10,
      pricePerKg: 20,
      totalAmount: 200,
      matched: true,
    },
  ],
}

function baseDeps(
  loadExistingBillNumbers: ImportApplyDeps['loadExistingBillNumbers'],
): ImportApplyDeps {
  return {
    loadExistingBillNumbers,
    createPurchaseBill: async () => {
      throw new DuplicateExistingError('externalBillNumber')
    },
    createSalesBill: async () => {
      throw new Error('unused sales create')
    },
  }
}

describe('ST-75 P2-E/P2-G duplicate reconciliation', () => {
  test('confirmed row after direct duplicate error is DUPLICATE_EXISTING', async () => {
    let lookupCalls = 0
    const deps = baseDeps(async (_type, numbers) => {
      lookupCalls++
      if (lookupCalls === 1) return new Set<string>()
      return new Set(numbers)
    })

    const result = await applyImport('purchase', [BILL], deps, ACTOR)

    expect(lookupCalls).toBe(2)
    expect(result.importedCount).toBe(0)
    expect(result.duplicateExistingCount).toBe(1)
    expect(result.failedCount).toBe(0)
  })

  test('direct duplicate error without confirmed row remains FAILED', async () => {
    let lookupCalls = 0
    const deps = baseDeps(async () => {
      lookupCalls++
      return new Set<string>()
    })

    const result = await applyImport('purchase', [BILL], deps, ACTOR)

    expect(lookupCalls).toBe(2)
    expect(result.duplicateExistingCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(result.failedBills[0]?.errorCode).toBe('BILL_CREATE_FAILED')
  })

  test('reconciliation lookup failure preserves the original safe failure', async () => {
    let lookupCalls = 0
    const deps = baseDeps(async () => {
      lookupCalls++
      if (lookupCalls === 1) return new Set<string>()
      throw new Error('synthetic reconciliation lookup failure')
    })

    const result = await applyImport('purchase', [BILL], deps, ACTOR)

    expect(lookupCalls).toBe(2)
    expect(result.duplicateExistingCount).toBe(0)
    expect(result.failedCount).toBe(1)
    expect(result.failedBills[0]?.errorCode).toBe('BILL_CREATE_FAILED')
  })
})
