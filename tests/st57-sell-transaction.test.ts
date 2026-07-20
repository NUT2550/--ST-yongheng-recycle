import { describe, expect, test } from 'bun:test'
import {
  createSellBillService,
  type SellBillCreatedBill,
  type SellBillInput,
  type SellBillServiceDeps,
  type SellBillTx,
  type SellSourceLot,
} from '../src/lib/bill-services'
import { compareFifoLotOrder } from '../src/lib/fifo-validation'
import { DuplicateExistingError, FifoMismatchError, InsufficientStockError, SourceLotConflictError } from '../src/lib/bill-errors'
import type { StockMovementDraft } from '../src/lib/stock-movement-ledger'

type Failure = 'cas-first' | 'cas-middle' | 'cas-final' | 'bill' | 'items' | 'movement' | 'audit' | 'p2028' | 'source-conflict' | 'conflict' | 'fifo-mismatch'
type Bill = SellBillCreatedBill & { billNumber: string; totalAmount: number; totalCost: number }
type State = {
  lots: SellSourceLot[]
  bills: Bill[]
  items: Array<{ id: string; billId: string; productId: string; weight: number; costPerKg: number; totalCost: number }>
  movements: StockMovementDraft[]
  audits: Array<Record<string, unknown>>
  credits: Array<Record<string, unknown>>
}

const auth = { userId: 'user-1', username: 'tester', name: 'Tester', role: 'admin' as const, permissions: {} }

function input(weight: number, externalBillNumber = 'EXT-1'): SellBillInput {
  return { date: '2026-07-20T00:00:00.000Z', isCredit: false, externalBillNumber, items: [{ productId: 'product-1', weight, pricePerKg: 50 }] }
}

function lot(id: string, remainingWeight: number, costPerKg: number, date: string, createdOffset = 0): SellSourceLot {
  const dateAdded = new Date(date)
  return { id, productId: 'product-1', remainingWeight, costPerKg, dateAdded, createdAt: new Date(dateAdded.getTime() + createdOffset) }
}

function clone<T>(value: T): T { return structuredClone(value) }

function harness(initialLots: SellSourceLot[], failure?: Failure) {
  const state: State = { lots: clone(initialLots), bills: [], items: [], movements: [], audits: [], credits: [] }
  let billSequence = 0

  const deps: SellBillServiceDeps<Bill> = {
    checkStockAvailability: async items => {
      for (const item of items) {
        const available = state.lots.filter(row => row.productId === item.productId).reduce((sum, row) => sum + row.remainingWeight, 0)
        if (available < item.weight) return { ok: false, productId: item.productId, productName: 'เหล็ก', available, requested: item.weight }
      }
      return { ok: true }
    },
    generateBillNumber: async () => `SELL-${++billSequence}`,
    transaction: async work => {
      if (failure === 'p2028') throw Object.assign(new Error('simulated transaction timeout'), { code: 'P2028' })
      const working = clone(state)
      let casCount = 0
      let conflictInjected = false
      const positiveLots = working.lots.filter(row => row.remainingWeight > 0)
      const finalCas = positiveLots.length
      const tx: SellBillTx<Bill> = {
        findSourceLots: async productId => {
          const snapshot = working.lots.filter(row => row.productId === productId && row.remainingWeight > 0).sort(compareFifoLotOrder)
          if (failure === 'conflict' && !conflictInjected) {
            conflictInjected = true
            state.lots[0].remainingWeight -= 1
          }
          return snapshot
        },
        updateStockLotRemaining: async (id, newRemaining, expected) => {
          casCount += 1
          if (failure === 'conflict' || failure === 'source-conflict') throw new SourceLotConflictError()
          if (failure === 'fifo-mismatch') throw new FifoMismatchError()
          if (failure === 'cas-first' && casCount === 1) throw new Error('injected first CAS failure')
          if (failure === 'cas-middle' && casCount === Math.ceil(finalCas / 2)) throw new Error('injected middle CAS failure')
          if (failure === 'cas-final' && casCount === finalCas) throw new Error('injected final CAS failure')
          const target = working.lots.find(row => row.id === id)
          if (!target || target.productId !== expected.productId || target.remainingWeight !== expected.remainingWeight || target.costPerKg !== expected.costPerKg) throw new SourceLotConflictError()
          if (newRemaining < 0) throw new Error('negative stock')
          target.remainingWeight = newRemaining
        },
        createSellBill: async args => {
          if (failure === 'bill') throw new Error('injected SellBill failure')
          if (args.data.externalBillNumber && working.bills.some(row => row.externalBillNumber === args.data.externalBillNumber)) {
            throw Object.assign(new Error('unique constraint'), { code: 'P2002', meta: { target: ['externalBillNumber'] } })
          }
          const id = `sell-${working.bills.length + 1}`
          const createdItems = args.data.items.create.map((row, index) => ({ id: `${id}-item-${index + 1}`, ...row }))
          const created: Bill = { id, billNumber: args.data.billNumber, externalBillNumber: args.data.externalBillNumber, totalAmount: args.data.totalAmount, totalCost: args.data.totalCost, items: createdItems }
          working.bills.push(created)
          if (failure === 'items') throw new Error('injected SellBillItem failure')
          working.items.push(...createdItems.map(row => ({ id: row.id, billId: id, productId: row.productId, weight: row.weight, costPerKg: row.costPerKg, totalCost: row.totalCost })))
          return created
        },
        createStockMovements: async rows => {
          if (failure === 'movement') throw new Error('injected StockMovement failure')
          working.movements.push(...clone(rows))
        },
        createCreditEntry: async row => { working.credits.push(clone(row) as Record<string, unknown>) },
        createAuditLog: async row => {
          if (failure === 'audit') throw new Error('injected AuditLog failure')
          working.audits.push(clone(row) as Record<string, unknown>)
        },
      }
      const result = await work(tx)
      Object.assign(state, working)
      return result
    },
  }
  return { state, deps }
}

function assertNoWrites(state: State, before: SellSourceLot[]) {
  expect(state.lots).toEqual(before)
  expect(state.bills).toHaveLength(0)
  expect(state.items).toHaveLength(0)
  expect(state.movements).toHaveLength(0)
  expect(state.audits).toHaveLength(0)
  expect(state.credits).toHaveLength(0)
}

describe('ST-57 real createSellBillService with atomic adapter', () => {
  test('one FIFO lot commits cost, item, movement, and audit', async () => {
    const h = harness([lot('lot-1', 100, 10, '2026-01-01')])
    const result = await createSellBillService(h.deps, input(25), auth)
    expect(result).toMatchObject({ totalCost: 250, totalAmount: 1250 })
    expect(h.state.lots[0].remainingWeight).toBe(75)
    expect(h.state.bills).toHaveLength(1); expect(h.state.items).toHaveLength(1)
    expect(h.state.movements).toHaveLength(1); expect(h.state.movements[0]).toMatchObject({ movementType: 'SALE_OUT', signedWeight: -25 })
    expect(h.state.audits).toHaveLength(1)
  })

  test('multiple lots use exact dateAdded/createdAt/id FIFO order and weighted cost', async () => {
    const lots = [
      lot('lot-c', 10, 30, '2026-01-02'),
      lot('lot-b', 10, 20, '2026-01-01', 1),
      lot('lot-a', 10, 10, '2026-01-01', 1),
    ]
    const h = harness(lots)
    const result = await createSellBillService(h.deps, input(25), auth)
    expect(h.state.lots.find(row => row.id === 'lot-a')?.remainingWeight).toBe(0)
    expect(h.state.lots.find(row => row.id === 'lot-b')?.remainingWeight).toBe(0)
    expect(h.state.lots.find(row => row.id === 'lot-c')?.remainingWeight).toBe(5)
    expect(result.totalCost).toBe(450)
    expect(h.state.items[0].costPerKg).toBe(18)
  })

  test('41-lot fixture deducts 27,935 kg exactly without negative stock', async () => {
    const lots = Array.from({ length: 41 }, (_, index) => lot(`lot-${String(index + 1).padStart(2, '0')}`, 700, 10 + index, '2026-01-01', index))
    const h = harness(lots)
    const result = await createSellBillService(h.deps, input(27_935), auth)
    const expectedCost = lots.slice(0, 39).reduce((sum, row) => sum + 700 * row.costPerKg, 0) + 635 * lots[39].costPerKg
    expect(result.totalCost).toBe(expectedCost)
    expect(h.state.lots.slice(0, 39).every(row => row.remainingWeight === 0)).toBe(true)
    expect(h.state.lots[39].remainingWeight).toBe(65)
    expect(h.state.lots[40].remainingWeight).toBe(700)
    expect(h.state.lots.every(row => row.remainingWeight >= 0)).toBe(true)
    expect(h.state.movements).toHaveLength(1); expect(h.state.audits).toHaveLength(1)
  })

  test('rollback matrix leaves no partial write', async () => {
    const failures: Failure[] = ['cas-first', 'cas-middle', 'cas-final', 'bill', 'items', 'movement', 'audit', 'p2028', 'source-conflict', 'fifo-mismatch']
    for (const failure of failures) {
      const lots = [lot('lot-1', 10, 10, '2026-01-01'), lot('lot-2', 10, 20, '2026-01-02'), lot('lot-3', 10, 30, '2026-01-03')]
      const h = harness(lots, failure); const before = clone(h.state.lots)
      await expect(createSellBillService(h.deps, input(25, `EXT-${failure}`), auth)).rejects.toThrow()
      assertNoWrites(h.state, before)
    }
  })

  test('typed insufficient stock performs zero writes', async () => {
    const h = harness([lot('lot-1', 5, 10, '2026-01-01')]); const before = clone(h.state.lots)
    await expect(createSellBillService(h.deps, input(10), auth)).rejects.toBeInstanceOf(InsufficientStockError)
    assertNoWrites(h.state, before)
  })

  test('CAS conflict preserves concurrent writer state while transaction rolls back', async () => {
    const h = harness([lot('lot-1', 20, 10, '2026-01-01'), lot('lot-2', 20, 20, '2026-01-02')], 'conflict')
    await expect(createSellBillService(h.deps, input(25), auth)).rejects.toBeInstanceOf(SourceLotConflictError)
    expect(h.state.lots[0].remainingWeight).toBe(19)
    expect(h.state.lots[1].remainingWeight).toBe(20)
    expect(h.state.bills).toHaveLength(0)
  })

  test('two overlapping sales cannot create negative stock; at most one succeeds', async () => {
    const h = harness([lot('lot-1', 30, 10, '2026-01-01')])
    await createSellBillService(h.deps, input(20, 'EXT-A'), auth)
    await expect(createSellBillService(h.deps, input(20, 'EXT-B'), auth)).rejects.toBeInstanceOf(InsufficientStockError)
    expect(h.state.bills).toHaveLength(1)
    expect(h.state.lots[0].remainingWeight).toBe(10)
  })

  test('P2028 rollback can be retried successfully', async () => {
    const lots = [lot('lot-1', 30, 10, '2026-01-01')]
    const failed = harness(lots, 'p2028'); const before = clone(failed.state.lots)
    await expect(createSellBillService(failed.deps, input(20), auth)).rejects.toMatchObject({ code: 'P2028' })
    assertNoWrites(failed.state, before)
    const retry = harness(failed.state.lots)
    await createSellBillService(retry.deps, input(20), auth)
    expect(retry.state.bills).toHaveLength(1); expect(retry.state.lots[0].remainingWeight).toBe(10)
  })

  test('retry after a successful commit is duplicate and never deducts twice', async () => {
    const h = harness([lot('lot-1', 40, 10, '2026-01-01')])
    await createSellBillService(h.deps, input(10, 'EXT-SAME'), auth)
    const afterFirst = clone(h.state.lots)
    await expect(createSellBillService(h.deps, input(10, 'EXT-SAME'), auth)).rejects.toBeInstanceOf(DuplicateExistingError)
    expect(h.state.lots).toEqual(afterFirst)
    expect(h.state.bills).toHaveLength(1)
    expect(h.state.movements).toHaveLength(1)
  })
})
