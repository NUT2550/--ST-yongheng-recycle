import { describe, expect, test } from 'bun:test'
import {
  buildCombinedHistoryPage,
  parseHistoryPagination,
} from '../src/lib/combined-sorting-history'
import { buildReversalMovement, type ReversibleStockMovement } from '../src/lib/stock-movement-ledger'
import { reverseSourceMovements } from '../src/lib/stock-movement-reversal'
import {
  cancelSortingBill,
  mapSortingCancellationError,
  type SortingCancellationDb,
} from '../src/lib/sorting-cancellation-service'

function row(id: string, date: string, createdAt = date) {
  return { id, date: new Date(date), createdAt: new Date(createdAt) }
}

function originalMovement(overrides: Partial<ReversibleStockMovement> = {}): ReversibleStockMovement {
  return {
    id: 'movement-original',
    productId: 'product-1',
    businessDate: new Date('2026-07-24T09:11:00.000Z'),
    movementType: 'SORTING_SOURCE_OUT',
    signedWeight: -1,
    sourceType: 'SORTING_BILL',
    sourceId: 'sorting-bill-1',
    sourceItemId: 'source',
    sourceDocumentNumber: 'SORT-2569-00161',
    reversalOfId: null,
    idempotencyKey: 'original-key',
    reason: null,
    metadata: null,
    createdById: null,
    createdByName: null,
    ...overrides,
  }
}

describe('ST-70 reversal identity', () => {
  test('buildReversalMovement never copies the persisted movement id', () => {
    const reversal = buildReversalMovement(
      originalMovement(),
      'CANCELLATION_REVERSAL',
      'ทดสอบ',
      new Date('2026-07-24T00:00:00.000Z'),
    )

    expect(reversal).not.toHaveProperty('id')
    expect(reversal.reversalOfId).toBe('movement-original')
    expect(reversal.signedWeight).toBe(1)
    expect(reversal.movementType).toBe('CANCELLATION_REVERSAL')
    expect(reversal.idempotencyKey).toBe(
      'stock-ledger-v1:CANCELLATION_REVERSAL:movement-original',
    )
  })

  test('reverseSourceMovements submits fresh reversal rows linked to each original', async () => {
    const originals = [
      originalMovement(),
      originalMovement({
        id: 'movement-output',
        productId: 'product-2',
        movementType: 'SORTING_OUTPUT_IN',
        signedWeight: 1,
        sourceItemId: 'item-1',
      }),
    ]
    let submitted: Array<Record<string, unknown>> = []

    const count = await reverseSourceMovements(
      {
        stockMovement: {
          async findMany() {
            return originals
          },
          async createMany(args) {
            submitted = args.data as Array<Record<string, unknown>>
            return { count: args.data.length }
          },
        },
      },
      'SORTING_BILL',
      'sorting-bill-1',
      'CANCELLATION_REVERSAL',
      new Date('2026-07-24T09:14:00.000Z'),
      'ทดสอบ',
    )

    expect(count).toBe(2)
    expect(submitted).toHaveLength(2)
    expect(submitted.every(item => !Object.hasOwn(item, 'id'))).toBe(true)
    expect(submitted.map(item => item.reversalOfId)).toEqual([
      'movement-original',
      'movement-output',
    ])
    expect(new Set(submitted.map(item => item.idempotencyKey)).size).toBe(2)
  })
})

describe('ST-70 combined sorting history pagination', () => {
  const sortingRows = [
    row('sort-6', '2026-07-24T06:00:00.000Z'),
    row('sort-5', '2026-07-24T05:00:00.000Z'),
    row('sort-4', '2026-07-24T04:00:00.000Z'),
    row('sort-3', '2026-07-24T03:00:00.000Z'),
    row('sort-2', '2026-07-24T02:00:00.000Z'),
    row('sort-1', '2026-07-24T01:00:00.000Z'),
  ]
  const transferRows = [
    row('transfer-2', '2026-07-24T04:30:00.000Z'),
    row('transfer-1', '2026-07-24T02:30:00.000Z'),
  ]

  test('merges before applying the combined page offset', () => {
    const first = buildCombinedHistoryPage({
      sources: [sortingRows.slice(0, 4), transferRows],
      page: 1,
      limit: 4,
      total: 8,
    })
    const second = buildCombinedHistoryPage({
      sources: [sortingRows, transferRows],
      page: 2,
      limit: 4,
      total: 8,
    })

    expect(first.rows.map(item => item.id)).toEqual([
      'sort-6',
      'sort-5',
      'transfer-2',
      'sort-4',
    ])
    expect(second.rows.map(item => item.id)).toEqual([
      'sort-3',
      'transfer-1',
      'sort-2',
      'sort-1',
    ])
    expect(new Set([...first.rows, ...second.rows].map(item => item.id)).size).toBe(8)
  })

  test('uses createdAt and id as deterministic tie breakers', () => {
    const result = buildCombinedHistoryPage({
      sources: [
        [row('a', '2026-07-24T01:00:00.000Z', '2026-07-24T01:00:01.000Z')],
        [
          row('b', '2026-07-24T01:00:00.000Z', '2026-07-24T01:00:02.000Z'),
          row('c', '2026-07-24T01:00:00.000Z', '2026-07-24T01:00:01.000Z'),
        ],
      ],
      page: 1,
      limit: 3,
      total: 3,
    })

    expect(result.rows.map(item => item.id)).toEqual(['b', 'c', 'a'])
  })

  test('preserves the combined total on an empty final page', () => {
    const result = buildCombinedHistoryPage({
      sources: [[], []],
      page: 4,
      limit: 10,
      total: 22,
    })

    expect(result).toEqual({ rows: [], total: 22 })
  })

  test('rejects invalid, non-finite, and excessive pagination windows', () => {
    expect(parseHistoryPagination('abc', '20')).toMatchObject({ ok: false, code: 'INVALID_PAGINATION' })
    expect(parseHistoryPagination('NaN', '20')).toMatchObject({ ok: false, code: 'INVALID_PAGINATION' })
    expect(parseHistoryPagination('1', '101')).toMatchObject({ ok: false, code: 'INVALID_PAGINATION' })
    expect(parseHistoryPagination('51', '20')).toMatchObject({
      ok: false,
      code: 'PAGINATION_WINDOW_EXCEEDED',
    })
  })

  test('returns a bounded per-source leading window for valid pages', () => {
    expect(parseHistoryPagination('4', '25')).toEqual({
      ok: true,
      page: 4,
      limit: 25,
      skip: 75,
      window: 100,
    })
  })
})

function cancellationDb(options: {
  lots?: Array<{ id: string; productId: string; remainingWeight: number }>
  claimCount?: number
  failAudit?: boolean
} = {}) {
  const calls: string[] = []
  const tx = {
    sortingBill: {
      async findUnique() {
        calls.push('findBill')
        return {
          id: 'sorting-bill-1',
          billNumber: 'SORT-1',
          sourceProductId: 'source-product',
          sourceWeight: 10,
          isCancelled: false,
          items: [
            { productId: 'output-a', weight: 4, isWaste: false, costPerKg: 12 },
            { productId: 'output-b', weight: 5, isWaste: false, costPerKg: 12 },
            { productId: 'waste', weight: 1, isWaste: true, costPerKg: 0 },
          ],
        }
      },
      async updateMany() {
        calls.push('claim')
        return { count: options.claimCount ?? 1 }
      },
    },
    stockLot: {
      async findMany() {
        calls.push('findOutputLots')
        return options.lots ?? [
          { id: 'lot-a', productId: 'output-a', remainingWeight: 4 },
          { id: 'lot-b', productId: 'output-b', remainingWeight: 5 },
        ]
      },
      async deleteMany(args: { where: { id: { in: string[] } } }) {
        calls.push('deleteOutputLots')
        return { count: args.where.id.in.length }
      },
      async create() {
        calls.push('restoreSource')
        return {}
      },
    },
    sortingBonus: {
      async deleteMany() {
        calls.push('deleteBonuses')
        return { count: 1 }
      },
    },
    stockMovement: {
      async findMany() {
        calls.push('findMovements')
        return []
      },
      async createMany() {
        calls.push('createReversals')
        return { count: 0 }
      },
    },
    auditLog: {
      async create() {
        calls.push('audit')
        if (options.failAudit) throw new Error('database host leaked')
        return {}
      },
    },
  }
  const db = {
    async $transaction<T>(fn: (value: typeof tx) => Promise<T>) {
      calls.push('transaction')
      return fn(tx)
    },
  }
  return { db: db as unknown as SortingCancellationDb, calls }
}

describe('ST-70 sorting cancellation transaction wiring', () => {
  test('claims once, removes intact outputs, restores source, and audits in one transaction', async () => {
    const { db, calls } = cancellationDb()
    await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
      cancelledAt: new Date('2026-07-24T00:00:00.000Z'),
    })
    expect(calls).toEqual([
      'transaction',
      'findBill',
      'claim',
      'findOutputLots',
      'deleteOutputLots',
      'restoreSource',
      'deleteBonuses',
      'findMovements',
      'audit',
    ])
  })

  test('rejects a partially consumed output before delete, restore, reversal, or audit', async () => {
    const { db, calls } = cancellationDb({
      lots: [
        { id: 'lot-a', productId: 'output-a', remainingWeight: 3.5 },
        { id: 'lot-b', productId: 'output-b', remainingWeight: 5 },
      ],
    })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_BILL_HAS_DOWNSTREAM_USAGE' },
    })
    expect(calls).toEqual(['transaction', 'findBill', 'claim', 'findOutputLots'])
  })

  test.each([
    ['fully consumed or missing output', []],
    ['unexpected replacement output', [
      { id: 'lot-a', productId: 'output-a', remainingWeight: 4 },
      { id: 'lot-c', productId: 'unexpected', remainingWeight: 5 },
    ]],
  ])('fails closed for %s', async (_label, lots) => {
    const { db, calls } = cancellationDb({ lots })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_BILL_HAS_DOWNSTREAM_USAGE' },
    })
    expect(calls).toEqual(['transaction', 'findBill', 'claim', 'findOutputLots'])
  })

  test('a lost atomic claim cannot restore source even for legacy bills without movements', async () => {
    const { db, calls } = cancellationDb({ claimCount: 0 })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_CANCEL_CONFLICT' },
    })
    expect(calls).toEqual(['transaction', 'findBill', 'claim'])
  })

  test('unexpected database failures map to a safe response without internal details', async () => {
    const { db } = cancellationDb({ failAudit: true })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    const mapped = mapSortingCancellationError(error)
    expect(mapped.status).toBe(500)
    expect(mapped.body.code).toBe('SORTING_CANCEL_FAILED')
    expect(mapped.body.error).not.toContain('database host')
  })
})
