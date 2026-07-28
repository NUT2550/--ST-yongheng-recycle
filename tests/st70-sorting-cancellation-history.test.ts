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
  SortingCancellationError,
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

interface CancellationOptions {
  lots?: Array<{ id: string; productId: string; remainingWeight: number }>
  movements?: Array<{ id: string; metadata: unknown }>
  claimCount?: number
  failAudit?: boolean
  /** When provided, the mock deleteMany records this lot as "concurrently modified" (returns count=0). */
  modifiedLotIds?: Set<string>
}

function cancellationDb(options: CancellationOptions = {}) {
  const calls: string[] = []
  const deletedLotIds: string[] = []
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
      async deleteMany(args: { where: { id: string; productId: string; remainingWeight: number } }) {
        calls.push('deleteOutputLot')
        deletedLotIds.push(args.where.id)
        if (options.modifiedLotIds?.has(args.where.id)) {
          return { count: 0 }
        }
        return { count: 1 }
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
        return options.movements ?? []
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
  return { db: db as unknown as SortingCancellationDb, calls, deletedLotIds }
}

describe('ST-70 sorting cancellation transaction wiring', () => {
  test('read-only validation runs before the conditional claim; success path', async () => {
    const { db, calls, deletedLotIds } = cancellationDb()
    await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
      cancelledAt: new Date('2026-07-24T00:00:00.000Z'),
    })
    // Expected order: transaction → findBill → findOutputLots → findMovements
    // (cost evidence) → claim → deleteOutputLot (×2, atomic compare-and-delete)
    // → restoreSource → deleteBonuses → (reversal findMany/createMany) → audit
    expect(calls.slice(0, 5)).toEqual([
      'transaction',
      'findBill',
      'findOutputLots',
      'findMovements',
      'claim',
    ])
    expect(deletedLotIds).toEqual(['lot-a', 'lot-b'])
    // claim happens after read-only validation; source restore + audit happen last
    expect(calls[calls.length - 1]).toBe('audit')
  })

  test('rejects a partially consumed output before claim, delete, restore, reversal, or audit', async () => {
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
    // assertIntact throws before findMovements/claim/delete/restore/audit run
    expect(calls).toEqual(['transaction', 'findBill', 'findOutputLots'])
  })

  test.each([
    ['fully consumed or missing output', []],
    ['unexpected replacement output', [
      { id: 'lot-a', productId: 'output-a', remainingWeight: 4 },
      { id: 'lot-c', productId: 'unexpected', remainingWeight: 5 },
    ]],
  ])('fails closed for %s before claim', async (_label, lots) => {
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
    // assertIntact throws before findMovements/claim run
    expect(calls).toEqual(['transaction', 'findBill', 'findOutputLots'])
  })

  test('a lost atomic claim (concurrent cancellation) cannot restore source', async () => {
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
    // Read-only validation happens first, then claim fails — no delete/restore/audit
    expect(calls).toEqual(['transaction', 'findBill', 'findOutputLots', 'findMovements', 'claim'])
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

describe('ST-70 atomic compare-and-delete (TOCTOU fix)', () => {
  test('if a concurrent sale reduces a lot between read and delete, cancellation fails closed', async () => {
    // Simulate a concurrent mutation: lot-b was 5 at read time but has been
    // reduced to 4 by the time deleteMany runs (CAS guard fails → count=0).
    const { db, calls, deletedLotIds } = cancellationDb({
      modifiedLotIds: new Set(['lot-b']),
    })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'race',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_BILL_HAS_DOWNSTREAM_USAGE' },
    })
    // lot-a was deleted first (count=1), then lot-b CAS failed → rollback
    expect(deletedLotIds).toEqual(['lot-a', 'lot-b'])
    // restoreSource + deleteBonuses + createReversals + audit must NOT run
    expect(calls).not.toContain('restoreSource')
    expect(calls).not.toContain('deleteBonuses')
    expect(calls).not.toContain('audit')
  })

  test('every expected output lot is deleted with product + weight guards (not just id)', async () => {
    const { db, deletedLotIds } = cancellationDb()
    await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'test',
      auth: { userId: 'admin-1', name: 'Admin' },
      cancelledAt: new Date('2026-07-24T00:00:00.000Z'),
    })
    // Both lots must be deleted via compare-and-delete (two deleteOutputLot calls)
    expect(deletedLotIds.sort()).toEqual(['lot-a', 'lot-b'])
  })
})

describe('ST-70 all-waste authoritative cost evidence', () => {
  function allWasteDb(options: {
    movements?: Array<{ id: string; metadata: unknown }>
    claimCount?: number
  } = {}) {
    const calls: string[] = []
    const tx = {
      sortingBill: {
        async findUnique() {
          calls.push('findBill')
          return {
            id: 'sorting-bill-1',
            billNumber: 'SORT-2',
            sourceProductId: 'source-product',
            sourceWeight: 10,
            isCancelled: false,
            // All-waste bill: no non-waste items, so item-level costPerKg is 0.
            items: [
              { productId: 'waste-a', weight: 5, isWaste: true, costPerKg: 0 },
              { productId: 'waste-b', weight: 5, isWaste: true, costPerKg: 0 },
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
          // All-waste bill: no SORTING output lots exist
          return []
        },
        async deleteMany() {
          calls.push('deleteOutputLot')
          return { count: 0 }
        },
        async create() {
          calls.push('restoreSource')
          return {}
        },
      },
      sortingBonus: {
        async deleteMany() {
          calls.push('deleteBonuses')
          return { count: 0 }
        },
      },
      stockMovement: {
        async findMany() {
          calls.push('findMovements')
          return options.movements ?? []
        },
        async createMany() {
          calls.push('createReversals')
          return { count: 0 }
        },
      },
      auditLog: {
        async create() {
          calls.push('audit')
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

  test('all-waste bill succeeds when StockMovement metadata has authoritative costPerKg', async () => {
    // Provide a full SORTING_SOURCE_OUT movement row so reverseSourceMovements
    // can build a valid reversal (with finite signedWeight).
    const sourceOutMovement = {
      id: 'mv-source-out',
      productId: 'source-product',
      businessDate: new Date('2026-07-24T00:00:00.000Z'),
      movementType: 'SORTING_SOURCE_OUT',
      signedWeight: -10,
      sourceType: 'SORTING_BILL',
      sourceId: 'sorting-bill-1',
      sourceItemId: 'source',
      sourceDocumentNumber: 'SORT-2',
      reversalOfId: null,
      idempotencyKey: 'stock-ledger-v1:SORTING_BILL:sorting-bill-1:source:source-out',
      reason: null,
      metadata: { sourceCostPerKg: 7.5 },
      createdById: null,
      createdByName: null,
    }
    const { db, calls } = allWasteDb({ movements: [sourceOutMovement] })
    await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'all-waste',
      auth: { userId: 'admin-1', name: 'Admin' },
      cancelledAt: new Date('2026-07-24T00:00:00.000Z'),
    })
    // Source restore + audit ran (no output lots to delete for all-waste)
    expect(calls).toContain('restoreSource')
    expect(calls).toContain('audit')
  })

  test('all-waste bill fails closed when no StockMovement evidence exists', async () => {
    const { db, calls } = allWasteDb({ movements: [] })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'all-waste',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_CANCEL_COST_EVIDENCE_MISSING' },
    })
    expect(calls).not.toContain('claim')
    expect(calls).not.toContain('restoreSource')
    expect(calls).not.toContain('audit')
  })

  test('all-waste bill fails closed when StockMovement metadata cost is zero', async () => {
    const { db, calls } = allWasteDb({
      movements: [{ id: 'mv-source-out', metadata: { sourceCostPerKg: 0 } }],
    })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'all-waste',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_CANCEL_COST_EVIDENCE_ZERO' },
    })
    expect(calls).not.toContain('claim')
  })

  test('conflicting cost evidence between StockMovement and SortingBillItem fails closed', async () => {
    // Non-waste bill (has item.costPerKg = 12) but StockMovement metadata says 7.5
    const { db, calls } = cancellationDb({
      movements: [{ id: 'mv-source-out', metadata: { sourceCostPerKg: 7.5 } }],
    })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'conflict',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_CANCEL_COST_EVIDENCE_CONFLICTING' },
    })
    expect(calls).not.toContain('claim')
    expect(calls).not.toContain('restoreSource')
  })

  test('conflicting cost evidence across multiple StockMovement rows fails closed', async () => {
    const { db, calls } = allWasteDb({
      movements: [
        { id: 'mv-1', metadata: { sourceCostPerKg: 7.5 } },
        { id: 'mv-2', metadata: { sourceCostPerKg: 9.0 } },
      ],
    })
    const error = await cancelSortingBill(db, {
      id: 'sorting-bill-1',
      reason: 'conflict',
      auth: { userId: 'admin-1', name: 'Admin' },
    }).catch(value => value)
    expect(mapSortingCancellationError(error)).toMatchObject({
      status: 409,
      body: { code: 'SORTING_CANCEL_COST_EVIDENCE_CONFLICTING' },
    })
    expect(calls).not.toContain('claim')
  })

  test('zero sourceWeight does not require cost evidence', async () => {
    const calls: string[] = []
    const tx = {
      sortingBill: {
        async findUnique() {
          calls.push('findBill')
          return {
            id: 'sorting-bill-1',
            billNumber: 'SORT-0',
            sourceProductId: 'source-product',
            sourceWeight: 0,
            isCancelled: false,
            items: [],
          }
        },
        async updateMany() {
          calls.push('claim')
          return { count: 1 }
        },
      },
      stockLot: {
        async findMany() {
          calls.push('findOutputLots')
          return []
        },
        async deleteMany() {
          calls.push('deleteOutputLot')
          return { count: 0 }
        },
        async create() {
          calls.push('restoreSource')
          return {}
        },
      },
      sortingBonus: {
        async deleteMany() {
          calls.push('deleteBonuses')
          return { count: 0 }
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
    await cancelSortingBill(db as unknown as SortingCancellationDb, {
      id: 'sorting-bill-1',
      reason: 'zero',
      auth: { userId: 'admin-1', name: 'Admin' },
    })
    // No restoreSource because sourceWeight is 0; audit still runs
    expect(calls).not.toContain('restoreSource')
    expect(calls).toContain('audit')
  })
})

describe('ST-70 error code surface', () => {
  test('every documented cancellation code maps to a structured body', () => {
    const codes: Array<{ code: import('../src/lib/sorting-cancellation-service').SortingCancellationCode; status: number }> = [
      { code: 'SORTING_BILL_NOT_FOUND', status: 404 },
      { code: 'SORTING_BILL_ALREADY_CANCELLED', status: 409 },
      { code: 'SORTING_BILL_HAS_DOWNSTREAM_USAGE', status: 409 },
      { code: 'SORTING_CANCEL_CONFLICT', status: 409 },
      { code: 'SORTING_CANCEL_COST_EVIDENCE_MISSING', status: 409 },
      { code: 'SORTING_CANCEL_COST_EVIDENCE_CONFLICTING', status: 409 },
      { code: 'SORTING_CANCEL_COST_EVIDENCE_ZERO', status: 409 },
    ]
    for (const { code, status } of codes) {
      const err = new SortingCancellationError(code, status, 'msg')
      const mapped = mapSortingCancellationError(err)
      expect(mapped.status).toBe(status)
      expect(mapped.body.code).toBe(code)
      expect(typeof mapped.body.error).toBe('string')
    }
  })

  test('unknown errors map to safe 500 without internal details', () => {
    const mapped = mapSortingCancellationError(new Error('relation "User" does not exist — connection string postgres://user:pass@host:5432'))
    expect(mapped.status).toBe(500)
    expect(mapped.body.code).toBe('SORTING_CANCEL_FAILED')
    expect(mapped.body.error).not.toContain('postgres://')
    expect(mapped.body.error).not.toContain('relation')
  })
})
