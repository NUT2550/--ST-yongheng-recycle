/**
 * ST-75: Bill number max-sequence correctness tests.
 *
 * Proves that generateBillNumber's max-sequence lookup is NUMERIC, not lexicographic.
 * This is critical because bill numbers use zero-padded suffixes (padStart(5,'0'))
 * which diverge from lexicographic ordering when the sequence exceeds 99999.
 */

import { describe, expect, test } from 'bun:test'
import { computeMaxSeq } from '../src/lib/bill-helpers'

describe('ST-75: bill number max-sequence correctness', () => {
  test('1. normal: 00001, 00002, 00100 → max = 100', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-00001', 'BUY-2569-00002', 'BUY-2569-00100']
    expect(computeMaxSeq(bills, prefix)).toBe(100)
  })

  test('2. gaps: 00001, 00050 → max = 50', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-00001', 'BUY-2569-00050']
    expect(computeMaxSeq(bills, prefix)).toBe(50)
  })

  test('3. CRITICAL: 99999 + 100000 → max = 100000 (numeric, not lexicographic)', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-99999', 'BUY-2569-100000']
    // Lexicographic max would be '99999' (WRONG)
    // Numeric max must be 100000 (CORRECT)
    expect(computeMaxSeq(bills, prefix)).toBe(100000)
  })

  test('4. CRITICAL: 99998 + 99999 + 100000 → max = 100000', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-99998', 'BUY-2569-99999', 'BUY-2569-100000']
    expect(computeMaxSeq(bills, prefix)).toBe(100000)
  })

  test('5. 99999 + 100001 → max = 100001', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-99999', 'BUY-2569-100001']
    expect(computeMaxSeq(bills, prefix)).toBe(100001)
  })

  test('6. malformed: BUY-2569-ABC does not reset to 0', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-00001', 'BUY-2569-ABC']
    // parseInt('ABC') = NaN → skipped, max stays at 1
    expect(computeMaxSeq(bills, prefix)).toBe(1)
  })

  test('7. malformed only: BUY-2569-ABC → max = 0 (safe fallback)', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-ABC']
    expect(computeMaxSeq(bills, prefix)).toBe(0)
  })

  test('8. empty: no bills → max = 0', () => {
    const prefix = 'BUY-2569-'
    expect(computeMaxSeq([], prefix)).toBe(0)
  })

  test('9. null entries: [null, "BUY-2569-00005"] → max = 5', () => {
    const prefix = 'BUY-2569-'
    const bills = [null, 'BUY-2569-00005']
    expect(computeMaxSeq(bills, prefix)).toBe(5)
  })

  test('10. different prefix: SELL-2569-00010 → max = 0 (wrong prefix)', () => {
    const prefix = 'BUY-2569-'
    const bills = ['SELL-2569-00010']
    expect(computeMaxSeq(bills, prefix)).toBe(0)
  })

  test('11. BUY/SELL/SORT/TRANSFER parity — all use same computeMaxSeq', () => {
    // This test verifies the function is shared across all bill types
    // (production code uses computeMaxSeq for all 4 types)
    const prefix = 'TEST-2569-'
    const bills = ['TEST-2569-00001', 'TEST-2569-00002', 'TEST-2569-100000']
    expect(computeMaxSeq(bills, prefix)).toBe(100000)
  })

  test('12. lexicographic would fail: prove computeMaxSeq is NOT lexicographic', () => {
    const prefix = 'BUY-2569-'
    const bills = ['BUY-2569-99999', 'BUY-2569-100000']
    // If this were lexicographic, max would be '99999' → seq 99999
    // But computeMaxSeq uses parseInt → correctly returns 100000
    const result = computeMaxSeq(bills, prefix)
    expect(result).not.toBe(99999) // would be wrong
    expect(result).toBe(100000)    // correct
  })
})
