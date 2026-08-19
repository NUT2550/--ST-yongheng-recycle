import { describe, expect, test } from 'bun:test'
import { classifyImportOutcome, type ImportSummaryLike } from '../src/lib/import-state-helper'

function makeSummary(overrides: Partial<ImportSummaryLike> = {}): ImportSummaryLike {
  const base = {
    importedCount: 0,
    duplicateExistingCount: 0,
    duplicateInFileCount: 0,
    invalidCount: 0,
    unmatchedCount: 0,
    insufficientStockCount: 0,
    failedCount: 0,
    importedBills: [],
    skippedDuplicateBills: [],
    failedBills: [],
    ...overrides,
  }
  // Populate valid bill statuses for the arrays
  if (base.importedCount > 0 && base.importedBills.length === 0) {
    base.importedBills = Array.from({ length: base.importedCount }, () => ({
      externalBillNumber: 'test',
      normalizedBillNumber: 'test',
      status: 'READY'
    }))
  }
  return base as ImportSummaryLike
}

describe('ST-75: Defect Fix Validation', () => {
  // Test 1: expected dispatched count = 1, response: all counters = 0, all arrays = [] => AMBIGUOUS_RESULT
  test('TEST 1: count mismatch (expected 1, actual 0) → AMBIGUOUS_RESULT', () => {
    const summary = makeSummary()
    expect(classifyImportOutcome(200, summary, false, 1)).toBe('AMBIGUOUS_RESULT')
  })

  // Test 2: expected dispatched count = 3, valid response accounts for exactly 3 results => SUCCESS/PARTIAL/FAILED semantics remain
  test('TEST 2: valid response matches expected count → SUCCESS', () => {
    const summary = makeSummary({ importedCount: 3 })
    expect(classifyImportOutcome(200, summary, false, 3)).toBe('SUCCESS')
  })

  // Test 3: expected dispatched count = 3, response accounts for 2 => AMBIGUOUS_RESULT
  test('TEST 3: response accounts for fewer than expected → AMBIGUOUS_RESULT', () => {
    const summary = makeSummary({ importedCount: 2 })
    expect(classifyImportOutcome(200, summary, false, 3)).toBe('AMBIGUOUS_RESULT')
  })

  // Test 4: expected dispatched count = 3, response accounts for 4 => AMBIGUOUS_RESULT
  test('TEST 4: response accounts for more than expected → AMBIGUOUS_RESULT', () => {
    const summary = makeSummary({ importedCount: 4 })
    expect(classifyImportOutcome(200, summary, false, 3)).toBe('AMBIGUOUS_RESULT')
  })
})
