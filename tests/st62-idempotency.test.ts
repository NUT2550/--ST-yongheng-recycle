/**
 * ST-62: Hardened idempotency tests.
 *
 * Tests the payload fingerprint, key validation, and idempotency service
 * contract (claim, replay, conflict, in-progress).
 *
 * ST-62 review fix (M-5): fingerprint now covers business-meaningful fields
 * (roomNumber, note, sourcePricePerKg, weighedTotal). Tests below prove that
 * changing any of them produces a DIFFERENT fingerprint (→ CONFLICT, not REPLAY).
 *
 * Note: Full PostgreSQL runtime tests are in tests/st62-postgres-idempotency.test.ts
 */

import { describe, expect, test } from 'bun:test'
import { computePayloadFingerprint, validateIdempotencyKey } from '../src/lib/idempotency-fingerprint'
import { buildStockTransferCreateData } from '../src/lib/stock-transfer-service'

// Shared base that includes ALL fingerprinted fields. Tests override individual
// fields to prove each one affects the hash.
const BASE = {
  sourceProductId: 'prod-1',
  sourceWeight: 100,
  sourceWeightExpression: null,
  businessType: 'แกะของ',
  date: '2026-07-31',
  laborCost: 50,
  gainReason: null,
  roomNumber: null,
  note: null,
  sourcePricePerKg: null,
  weighedTotal: null,
  weighedTotalExpression: null,
  items: [
    { productId: 'prod-2', weight: 60, isWaste: false, outputPricePerKg: 20 },
  ],
}

describe('ST-62 payload fingerprint', () => {
  test('1. same input produces same fingerprint', () => {
    const input = {
      ...BASE,
      items: [
        { productId: 'prod-2', weight: 60, isWaste: false, outputPricePerKg: 20 },
        { productId: 'prod-3', weight: 35, isWaste: false, outputPricePerKg: 15 },
      ],
    }
    const hash1 = computePayloadFingerprint(input)
    const hash2 = computePayloadFingerprint(input)
    expect(hash1).toBe(hash2)
    expect(hash1).toHaveLength(64) // SHA-256 hex
  })

  test('2. different payload produces different fingerprint', () => {
    const hash1 = computePayloadFingerprint(BASE)
    const hash2 = computePayloadFingerprint({ ...BASE, sourceWeight: 101 })
    expect(hash1).not.toBe(hash2)
  })

  test('3. item order does not affect fingerprint', () => {
    const items1 = [
      { productId: 'prod-a', weight: 10, isWaste: false, outputPricePerKg: 5 },
      { productId: 'prod-b', weight: 20, isWaste: false, outputPricePerKg: 10 },
    ]
    const items2 = [
      { productId: 'prod-b', weight: 20, isWaste: false, outputPricePerKg: 10 },
      { productId: 'prod-a', weight: 10, isWaste: false, outputPricePerKg: 5 },
    ]
    expect(computePayloadFingerprint({ ...BASE, items: items1 })).toBe(
      computePayloadFingerprint({ ...BASE, items: items2 })
    )
  })

  test('4. persisted sourceWeight precision is not rounded away', () => {
    const items = [{ productId: 'p2', weight: 10, isWaste: false, outputPricePerKg: 5 }]
    const h1 = computePayloadFingerprint({ ...BASE, sourceWeight: 100.001, items })
    const h2 = computePayloadFingerprint({ ...BASE, sourceWeight: 100, items })
    expect(h1).not.toBe(h2)
  })
})

// ST-62 review fix (M-5): prove each newly-added business field affects the hash.
describe('ST-62 fingerprint covers business-meaningful fields (M-5 fix)', () => {
  test('5. different roomNumber → different fingerprint', () => {
    const h1 = computePayloadFingerprint({ ...BASE, roomNumber: '101' })
    const h2 = computePayloadFingerprint({ ...BASE, roomNumber: '102' })
    expect(h1).not.toBe(h2)
  })

  test('6. roomNumber set vs null → different fingerprint', () => {
    const h1 = computePayloadFingerprint({ ...BASE, roomNumber: null })
    const h2 = computePayloadFingerprint({ ...BASE, roomNumber: '101' })
    expect(h1).not.toBe(h2)
  })

  test('7. different note → different fingerprint', () => {
    const h1 = computePayloadFingerprint({ ...BASE, note: 'note A' })
    const h2 = computePayloadFingerprint({ ...BASE, note: 'note B' })
    expect(h1).not.toBe(h2)
  })

  test('8. note set vs null → different fingerprint', () => {
    const h1 = computePayloadFingerprint({ ...BASE, note: null })
    const h2 = computePayloadFingerprint({ ...BASE, note: 'remark' })
    expect(h1).not.toBe(h2)
  })

  test('9. different sourcePricePerKg → different fingerprint', () => {
    const h1 = computePayloadFingerprint({ ...BASE, sourcePricePerKg: 40 })
    const h2 = computePayloadFingerprint({ ...BASE, sourcePricePerKg: 41 })
    expect(h1).not.toBe(h2)
  })

  test('10. different weighedTotal → different fingerprint', () => {
    const h1 = computePayloadFingerprint({ ...BASE, weighedTotal: 95 })
    const h2 = computePayloadFingerprint({ ...BASE, weighedTotal: 96 })
    expect(h1).not.toBe(h2)
  })

  test('11. null vs undefined treated the same (normalized to null)', () => {
    // Both should produce the same fingerprint — a missing optional field is
    // equivalent to an explicitly-null one.
    const h1 = computePayloadFingerprint({ ...BASE, roomNumber: null })
    const h2 = computePayloadFingerprint({ ...BASE, roomNumber: undefined })
    expect(h1).toBe(h2)
  })

  test('12. whitespace-only roomNumber normalized to null (same as absent)', () => {
    const h1 = computePayloadFingerprint({ ...BASE, roomNumber: '   ' })
    const h2 = computePayloadFingerprint({ ...BASE, roomNumber: null })
    expect(h1).toBe(h2)
  })

  test('13. all directly persisted numeric fields retain Float precision', () => {
    const fields = ['sourceWeight', 'laborCost', 'sourcePricePerKg', 'weighedTotal'] as const
    for (const field of fields) {
      expect(computePayloadFingerprint({ ...BASE, [field]: 1.0001 })).not.toBe(
        computePayloadFingerprint({ ...BASE, [field]: 1 }),
      )
    }

    expect(computePayloadFingerprint({
      ...BASE,
      items: [{ productId: 'prod-2', weight: 1.0001, isWaste: false, outputPricePerKg: 20 }],
    })).not.toBe(computePayloadFingerprint({
      ...BASE,
      items: [{ productId: 'prod-2', weight: 1, isWaste: false, outputPricePerKg: 20 }],
    }))

    expect(computePayloadFingerprint({
      ...BASE,
      items: [{ productId: 'prod-2', weight: 60, isWaste: false, outputPricePerKg: 1.0001 }],
    })).not.toBe(computePayloadFingerprint({
      ...BASE,
      items: [{ productId: 'prod-2', weight: 60, isWaste: false, outputPricePerKg: 1 }],
    }))
  })

  test('14. persisted formula expressions affect the fingerprint', () => {
    expect(computePayloadFingerprint({ ...BASE, sourceWeightExpression: '100-0.1' })).not.toBe(
      computePayloadFingerprint({ ...BASE, sourceWeightExpression: '100-0.2' }),
    )
    expect(computePayloadFingerprint({ ...BASE, weighedTotalExpression: '60+40' })).not.toBe(
      computePayloadFingerprint({ ...BASE, weighedTotalExpression: '50+50' }),
    )
    expect(computePayloadFingerprint({
      ...BASE,
      items: [{ ...BASE.items[0], weightExpression: '30+30' }],
    })).not.toBe(computePayloadFingerprint({
      ...BASE,
      items: [{ ...BASE.items[0], weightExpression: '20+40' }],
    }))
  })

  test('15. presentation-only numeric expressions normalize to persisted null', () => {
    expect(computePayloadFingerprint({ ...BASE, sourceWeightExpression: '100' })).toBe(
      computePayloadFingerprint({ ...BASE, sourceWeightExpression: null }),
    )
  })

  test('16. note whitespace and waste price follow the actual Prisma write normalization', () => {
    expect(computePayloadFingerprint({ ...BASE, note: ' note ' })).not.toBe(
      computePayloadFingerprint({ ...BASE, note: 'note' }),
    )
    expect(computePayloadFingerprint({
      ...BASE,
      items: [{ productId: 'waste', weight: 1, isWaste: true, outputPricePerKg: 99 }],
    })).toBe(computePayloadFingerprint({
      ...BASE,
      items: [{ productId: 'waste', weight: 1, isWaste: true, outputPricePerKg: 0 }],
    }))
  })

  test('17. duplicate output rows are canonicalized as a persisted multiset', () => {
    const first = [
      { productId: 'same', weight: 10, isWaste: false, outputPricePerKg: 1 },
      { productId: 'same', weight: 20, isWaste: false, outputPricePerKg: 2 },
    ]
    expect(computePayloadFingerprint({ ...BASE, items: first })).toBe(
      computePayloadFingerprint({ ...BASE, items: [...first].reverse() }),
    )
  })
})

describe('ST-62 Prisma write-path evidence', () => {
  test('direct numeric and formula fields reach StockTransfer.create without lossy rounding', () => {
    const data = buildStockTransferCreateData({
      date: '2026-07-31',
      sourceProductId: 'prod-1',
      sourceWeight: 100.0001,
      sourceWeightExpression: '100.5-0.4999',
      sourcePricePerKg: 40.0001,
      laborCost: 5.0001,
      weighedTotal: 60.0001,
      weighedTotalExpression: '60.5-0.4999',
      items: [{
        productId: 'prod-2',
        weight: 60.0001,
        weightExpression: '60.5-0.4999',
        isWaste: false,
        outputPricePerKg: 20.0001,
      }],
    }, {
      billNumber: 'TRN-TEST',
      sourceCostPerKg: 1,
      sourceTotalCost: 100.0001,
      lossWeight: 40,
      lossCost: 40,
      gainWeight: 0,
      weightVariance: -40,
      gainReason: null,
      outputTotalValue: 1200,
      profitLoss: 0,
      allocatedItems: [{ costPerKg: 1, totalCost: 60 }],
      storedBusinessDate: new Date('2026-07-30T17:00:00.000Z'),
    })
    const itemCreate = data.items as { create: Array<Record<string, unknown>> }

    expect(data.sourceWeight).toBe(100.0001)
    expect(data.sourcePricePerKg).toBe(40.0001)
    expect(data.laborCost).toBe(5.0001)
    expect(data.weighedTotal).toBe(60.0001)
    expect(data.sourceWeightExpression).toBe('100.5-0.4999')
    expect(data.weighedTotalExpression).toBe('60.5-0.4999')
    expect(itemCreate.create[0].weight).toBe(60.0001)
    expect(itemCreate.create[0].weightExpression).toBe('60.5-0.4999')
    expect(itemCreate.create[0].outputPricePerKg).toBe(20.0001)
  })
})

describe('ST-62 key validation', () => {
  test('18. null key is valid (backward compatible)', () => {
    expect(validateIdempotencyKey(null)).toBeNull()
  })

  test('19. undefined key is valid', () => {
    expect(validateIdempotencyKey(undefined)).toBeNull()
  })

  test('20. valid UUID-like key is accepted', () => {
    expect(validateIdempotencyKey('idem-1234567890-abc-def')).toBeNull()
  })

  test('21. empty string is rejected', () => {
    expect(validateIdempotencyKey('')).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  test('22. whitespace-only is rejected', () => {
    expect(validateIdempotencyKey('   ')).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  test('23. key > 255 chars is rejected', () => {
    const longKey = 'a'.repeat(256)
    expect(validateIdempotencyKey(longKey)).toBe('IDEMPOTENCY_KEY_TOO_LONG')
  })

  test('24. key with special characters is rejected', () => {
    expect(validateIdempotencyKey('key with spaces')).toBe('INVALID_IDEMPOTENCY_KEY')
    expect(validateIdempotencyKey('key!@#')).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  test('25. key of exactly 255 chars is accepted', () => {
    const key255 = 'a'.repeat(255)
    expect(validateIdempotencyKey(key255)).toBeNull()
  })
})
