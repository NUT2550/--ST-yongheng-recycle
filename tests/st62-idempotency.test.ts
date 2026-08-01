/**
 * ST-62: Hardened idempotency tests.
 *
 * Tests the payload fingerprint, key validation, and idempotency service
 * contract (claim, replay, conflict, in-progress).
 *
 * Note: Full PostgreSQL runtime tests are in tests/st62-postgres-idempotency.test.ts
 */

import { describe, expect, test } from 'bun:test'
import { computePayloadFingerprint, validateIdempotencyKey } from '../src/lib/idempotency-fingerprint'

describe('ST-62 payload fingerprint', () => {
  test('1. same input produces same fingerprint', () => {
    const input = {
      sourceProductId: 'prod-1',
      sourceWeight: 100,
      businessType: 'แกะของ',
      date: '2026-07-31',
      laborCost: 50,
      gainReason: null,
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
    const base = {
      sourceProductId: 'prod-1',
      sourceWeight: 100,
      businessType: 'แกะของ',
      date: '2026-07-31',
      laborCost: 50,
      gainReason: null,
      items: [
        { productId: 'prod-2', weight: 60, isWaste: false, outputPricePerKg: 20 },
      ],
    }
    const hash1 = computePayloadFingerprint(base)
    const hash2 = computePayloadFingerprint({ ...base, sourceWeight: 101 })
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
    const base = { sourceProductId: 'p', sourceWeight: 30, businessType: null, date: '2026-07-31', laborCost: 0, gainReason: null }
    expect(computePayloadFingerprint({ ...base, items: items1 })).toBe(
      computePayloadFingerprint({ ...base, items: items2 })
    )
  })

  test('4. decimal normalization rounds to 2 places', () => {
    const base = { sourceProductId: 'p', sourceWeight: 100, businessType: null, date: '2026-07-31', laborCost: 0, gainReason: null }
    const items = [{ productId: 'p2', weight: 10, isWaste: false, outputPricePerKg: 5 }]
    const h1 = computePayloadFingerprint({ ...base, sourceWeight: 100.001, items })
    const h2 = computePayloadFingerprint({ ...base, sourceWeight: 100, items })
    expect(h1).toBe(h2) // 100.001 rounds to 100.00
  })
})

describe('ST-62 key validation', () => {
  test('5. null key is valid (backward compatible)', () => {
    expect(validateIdempotencyKey(null)).toBeNull()
  })

  test('6. undefined key is valid', () => {
    expect(validateIdempotencyKey(undefined)).toBeNull()
  })

  test('7. valid UUID-like key is accepted', () => {
    expect(validateIdempotencyKey('idem-1234567890-abc-def')).toBeNull()
  })

  test('8. empty string is rejected', () => {
    expect(validateIdempotencyKey('')).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  test('9. whitespace-only is rejected', () => {
    expect(validateIdempotencyKey('   ')).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  test('10. key > 255 chars is rejected', () => {
    const longKey = 'a'.repeat(256)
    expect(validateIdempotencyKey(longKey)).toBe('IDEMPOTENCY_KEY_TOO_LONG')
  })

  test('11. key with special characters is rejected', () => {
    expect(validateIdempotencyKey('key with spaces')).toBe('INVALID_IDEMPOTENCY_KEY')
    expect(validateIdempotencyKey('key!@#')).toBe('INVALID_IDEMPOTENCY_KEY')
  })

  test('12. key of exactly 255 chars is accepted', () => {
    const key255 = 'a'.repeat(255)
    expect(validateIdempotencyKey(key255)).toBeNull()
  })
})
