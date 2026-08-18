/**
 * ST-75 Phase 2: Import state helper tests.
 * Tests the pure functions that production dialogs use.
 */

import { describe, expect, test } from 'bun:test'
import {
  classifyImportOutcome,
  shouldBlockClose,
  shouldRefreshHistory,
  getOutcomeMessage,
  type ImportSummaryLike,
} from '../src/lib/import-state-helper'

function makeSummary(overrides: Partial<ImportSummaryLike> = {}): ImportSummaryLike {
  return {
    importedCount: 0,
    duplicateExistingCount: 0,
    duplicateInFileCount: 0,
    invalidCount: 0,
    unmatchedCount: 0,
    insufficientStockCount: 0,
    failedCount: 0,
    // ST-75 P2-B2: Include required result arrays.
    importedBills: [],
    skippedDuplicateBills: [],
    failedBills: [],
    ...overrides,
  }
}

describe('ST-75: classifyImportOutcome', () => {
  test('1. network error → AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(null, null, true)).toBe('AMBIGUOUS_RESULT')
  })

  test('2. HTTP 200, all imported → SUCCESS', () => {
    expect(classifyImportOutcome(200, makeSummary({ importedCount: 5 }), false)).toBe('SUCCESS')
  })

  test('3. HTTP 200, mixed → PARTIAL_SUCCESS', () => {
    expect(classifyImportOutcome(200, makeSummary({ importedCount: 3, failedCount: 2 }), false)).toBe('PARTIAL_SUCCESS')
  })

  test('4. HTTP 200, none imported → FAILED_CONFIRMED', () => {
    expect(classifyImportOutcome(200, makeSummary({ failedCount: 5 }), false)).toBe('FAILED_CONFIRMED')
  })

  test('5. HTTP 200, all duplicates → FAILED_CONFIRMED', () => {
    expect(classifyImportOutcome(200, makeSummary({ duplicateExistingCount: 5 }), false)).toBe('FAILED_CONFIRMED')
  })

  test('6. HTTP 200, no summary → AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(200, null, false)).toBe('AMBIGUOUS_RESULT')
  })

  test('7. HTTP 400 → FAILED_CONFIRMED', () => {
    expect(classifyImportOutcome(400, null, false)).toBe('FAILED_CONFIRMED')
  })

  test('8. HTTP 429 → AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(429, null, false)).toBe('AMBIGUOUS_RESULT')
  })

  test('9. HTTP 500 → AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(500, null, false)).toBe('AMBIGUOUS_RESULT')
  })

  test('10. HTTP 502 → AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(502, null, false)).toBe('AMBIGUOUS_RESULT')
  })

  test('11. partial success with duplicates + imported → PARTIAL_SUCCESS', () => {
    expect(classifyImportOutcome(200, makeSummary({
      importedCount: 3, duplicateExistingCount: 1, duplicateInFileCount: 1
    }), false)).toBe('PARTIAL_SUCCESS')
  })
})

describe('ST-75: shouldBlockClose', () => {
  test('12. IMPORTING → block close', () => {
    expect(shouldBlockClose('IMPORTING')).toBe(true)
  })

  test('13. SUCCESS → allow close', () => {
    expect(shouldBlockClose('SUCCESS')).toBe(false)
  })

  test('14. AMBIGUOUS_RESULT → allow close', () => {
    expect(shouldBlockClose('AMBIGUOUS_RESULT')).toBe(false)
  })
})

describe('ST-75: shouldRefreshHistory', () => {
  test('15. SUCCESS → refresh', () => {
    expect(shouldRefreshHistory('SUCCESS')).toBe(true)
  })

  test('16. PARTIAL_SUCCESS → refresh', () => {
    expect(shouldRefreshHistory('PARTIAL_SUCCESS')).toBe(true)
  })

  test('17. AMBIGUOUS_RESULT → refresh', () => {
    expect(shouldRefreshHistory('AMBIGUOUS_RESULT')).toBe(true)
  })

  test('18. FAILED_CONFIRMED → do NOT refresh', () => {
    expect(shouldRefreshHistory('FAILED_CONFIRMED')).toBe(false)
  })
})

describe('ST-75: getOutcomeMessage', () => {
  test('19. AMBIGUOUS_RESULT message instructs to check history', () => {
    const msg = getOutcomeMessage('AMBIGUOUS_RESULT')
    expect(msg).toContain('ประวัติ')
    expect(msg).not.toContain('สำเร็จ')
  })

  test('20. PARTIAL_SUCCESS message mentions partial', () => {
    const msg = getOutcomeMessage('PARTIAL_SUCCESS')
    expect(msg).toContain('บางส่วน')
  })
})
