import { describe, expect, test } from 'bun:test'
import { buildCombinedHistoryPage } from '../src/lib/combined-sorting-history'
import { buildReversalMovement, type ReversibleStockMovement } from '../src/lib/stock-movement-ledger'
import { reverseSourceMovements } from '../src/lib/stock-movement-reversal'

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
})
