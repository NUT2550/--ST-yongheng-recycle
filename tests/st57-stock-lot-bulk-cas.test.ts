import { describe, expect, test } from 'bun:test'
import { SourceLotConflictError } from '../src/lib/bill-errors'
import {
  executeStockLotBulkCas,
  type StockLotCasUpdate,
} from '../src/lib/stock-lot-bulk-cas'

type Row = {
  id: string
  productId: string
  remainingWeight: number
  costPerKg: number
}

function update(id: string, overrides: Partial<StockLotCasUpdate> = {}): StockLotCasUpdate {
  return {
    id,
    productId: 'product-1',
    expectedRemainingWeight: 700,
    expectedCostPerKg: 10,
    newRemainingWeight: 0,
    ...overrides,
  }
}

async function executeAgainstRows(rows: Row[], updates: StockLotCasUpdate[]) {
  const working = structuredClone(rows)
  let calls = 0
  await executeStockLotBulkCas(async query => {
    calls += 1
    expect(query.values).toHaveLength(updates.length * 5)
    const returned: Array<{ id: string }> = []
    for (const candidate of updates) {
      const row = working.find(value => value.id === candidate.id)
      if (
        row &&
        row.productId === candidate.productId &&
        row.remainingWeight === candidate.expectedRemainingWeight &&
        row.costPerKg === candidate.expectedCostPerKg &&
        candidate.newRemainingWeight >= 0
      ) {
        row.remainingWeight = candidate.newRemainingWeight
        returned.push({ id: row.id })
      }
    }
    return returned
  }, updates)
  Object.assign(rows, working)
  return calls
}

describe('ST-57 production bulk StockLot CAS abstraction', () => {
  test('one-lot CAS succeeds in one execution', async () => {
    const rows = [{ id: 'lot-1', productId: 'product-1', remainingWeight: 700, costPerKg: 10 }]
    expect(await executeAgainstRows(rows, [update('lot-1', { newRemainingWeight: 65 })])).toBe(1)
    expect(rows[0].remainingWeight).toBe(65)
  })

  test('41-lot CAS succeeds in one execution and updates each expected row once', async () => {
    const rows = Array.from({ length: 41 }, (_, index) => ({
      id: `lot-${index + 1}`,
      productId: 'product-1',
      remainingWeight: 700,
      costPerKg: 10,
    }))
    const updates = rows.map((row, index) => update(row.id, {
      newRemainingWeight: index === 40 ? 65 : 0,
    }))
    expect(await executeAgainstRows(rows, updates)).toBe(1)
    expect(rows.slice(0, 40).every(row => row.remainingWeight === 0)).toBe(true)
    expect(rows[40].remainingWeight).toBe(65)
  })

  for (const mismatch of ['remainingWeight', 'costPerKg', 'productId', 'missing'] as const) {
    test(`${mismatch} mismatch rejects the complete guarded set`, async () => {
      const rows = [
        { id: 'lot-1', productId: 'product-1', remainingWeight: 700, costPerKg: 10 },
        { id: 'lot-2', productId: 'product-1', remainingWeight: 700, costPerKg: 10 },
      ]
      const before = structuredClone(rows)
      const updates = [update('lot-1'), update(mismatch === 'missing' ? 'lot-missing' : 'lot-2')]
      if (mismatch === 'remainingWeight') rows[1].remainingWeight = 699
      if (mismatch === 'costPerKg') rows[1].costPerKg = 11
      if (mismatch === 'productId') rows[1].productId = 'product-2'
      const concurrentState = structuredClone(rows)
      await expect(executeAgainstRows(rows, updates)).rejects.toBeInstanceOf(SourceLotConflictError)
      expect(rows).toEqual(concurrentState)
      expect(before[0].remainingWeight).toBe(700)
    })
  }

  test('duplicate lot ID is rejected before query execution', async () => {
    let calls = 0
    await expect(executeStockLotBulkCas(async () => { calls += 1; return [] }, [update('lot-1'), update('lot-1')]))
      .rejects.toBeInstanceOf(SourceLotConflictError)
    expect(calls).toBe(0)
  })

  test('returned-row count or identity mismatch is a conflict', async () => {
    await expect(executeStockLotBulkCas(async () => [{ id: 'lot-1' }], [update('lot-1'), update('lot-2')]))
      .rejects.toBeInstanceOf(SourceLotConflictError)
    await expect(executeStockLotBulkCas(async () => [{ id: 'lot-1' }, { id: 'wrong' }], [update('lot-1'), update('lot-2')]))
      .rejects.toBeInstanceOf(SourceLotConflictError)
  })

  test('negative new remaining weight is rejected before query execution', async () => {
    let calls = 0
    await expect(executeStockLotBulkCas(async () => { calls += 1; return [] }, [update('lot-1', { newRemainingWeight: -1 })]))
      .rejects.toBeInstanceOf(SourceLotConflictError)
    expect(calls).toBe(0)
  })

  test('SQL is parameterized and does not interpolate lot identifiers', async () => {
    const secretLikeId = "lot-'unsafe"
    await executeStockLotBulkCas(async query => {
      expect(query.sql).not.toContain(secretLikeId)
      expect(query.values).toContain(secretLikeId)
      return [{ id: secretLikeId }]
    }, [update(secretLikeId)])
  })
})
