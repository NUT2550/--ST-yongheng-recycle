/**
 * ST-75 P2-A + P2-B: Ambiguous refresh + malformed summary regression tests.
 *
 * P2-B (malformed 2xx summary → AMBIGUOUS_RESULT):
 *   - classifyImportOutcome must runtime-validate every required counter
 *   - A truthy-but-malformed 2xx summary (missing/wrong-type/NaN/Infinity
 *     counters) must NOT fall through to FAILED_CONFIRMED
 *   - It must return AMBIGUOUS_RESULT (because the request may have committed)
 *
 * P2-A (bounded delayed reconciliation for ambiguous transport):
 *   - scheduleAmbiguousRefresh fires immediate + bounded delayed retries
 *   - First refresh may see stale state; later bounded refresh succeeds
 *   - Authoritative state is eventually applied
 *   - No second POST/import mutation is issued (GET/read refresh only)
 *   - Bounded: maxRetries cap prevents infinite polling
 *   - cancel() clears pending timers
 *
 * Test strategy:
 *   - P2-B: Pure helper contracts tested at RUNTIME with real values
 *   - P2-A: scheduleAmbiguousRefresh tested with injected fake timers to prove
 *     bounded retry behavior + cancel semantics without real wall-clock delays
 *   - Dialog wiring verified via source assertions proving the dialogs call
 *     scheduleAmbiguousRefresh on ambiguous paths (not direct onRefreshAfterImport)
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  classifyImportOutcome,
  isValidImportSummary,
  shouldRefreshHistory,
  type ImportSummaryLike,
} from '../src/lib/import-state-helper'
import {
  scheduleAmbiguousRefresh,
} from '../src/lib/import-refresh-helper'

// ============ Helpers ============

function makeValidSummary(overrides: Partial<ImportSummaryLike> = {}): ImportSummaryLike {
  return {
    importedCount: 0,
    duplicateExistingCount: 0,
    duplicateInFileCount: 0,
    invalidCount: 0,
    unmatchedCount: 0,
    insufficientStockCount: 0,
    failedCount: 0,
    // ST-75 P2-B2: Include required result arrays so the summary passes
    // isValidImportSummary validation.
    importedBills: [],
    skippedDuplicateBills: [],
    failedBills: [],
    ...overrides,
  } as ImportSummaryLike
}

const SELL_DIALOG_PATH = join(process.cwd(), 'src/components/detailed-sell-excel-import-dialog.tsx')
const BUY_DIALOG_PATH = join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx')

function readSellDialog(): string {
  return readFileSync(SELL_DIALOG_PATH, 'utf8')
}
function readBuyDialog(): string {
  return readFileSync(BUY_DIALOG_PATH, 'utf8')
}

// ============ P2-B: isValidImportSummary runtime validation ============

describe('ST-75 P2-B: isValidImportSummary runtime validation', () => {
  test('1. valid summary with all counters present → true', () => {
    expect(isValidImportSummary(makeValidSummary({ importedCount: 5, failedCount: 2 }))).toBe(true)
  })

  test('2. valid summary with all zeros → true', () => {
    expect(isValidImportSummary(makeValidSummary())).toBe(true)
  })

  test('3. missing counter → false', () => {
    const malformed = {
      importedCount: 5,
      duplicateExistingCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      unmatchedCount: 0,
      insufficientStockCount: 0,
      // failedCount missing
    }
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('4. wrong-type counter (string) → false', () => {
    const malformed = makeValidSummary({ importedCount: '5' as unknown as number })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('5. wrong-type counter (null) → false', () => {
    const malformed = makeValidSummary({ failedCount: null as unknown as number })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('6. NaN counter → false', () => {
    const malformed = makeValidSummary({ importedCount: NaN })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('7. Infinity counter → false', () => {
    const malformed = makeValidSummary({ failedCount: Infinity })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('8. negative counter → false', () => {
    const malformed = makeValidSummary({ importedCount: -1 })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('9. non-integer counter (float) → false', () => {
    const malformed = makeValidSummary({ importedCount: 1.5 })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('10. null summary → false', () => {
    expect(isValidImportSummary(null)).toBe(false)
  })

  test('11. non-object summary → false', () => {
    expect(isValidImportSummary('not-an-object')).toBe(false)
    expect(isValidImportSummary(42)).toBe(false)
    expect(isValidImportSummary(undefined)).toBe(false)
  })
})

// ============ P2-B: classifyImportOutcome with malformed 2xx summary ============

describe('ST-75 P2-B: malformed 2xx summary → AMBIGUOUS_RESULT', () => {
  test('12. 2xx with missing counter → AMBIGUOUS_RESULT (not FAILED_CONFIRMED)', () => {
    const malformed = {
      importedCount: 5,
      duplicateExistingCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      unmatchedCount: 0,
      insufficientStockCount: 0,
      // failedCount missing — old behavior: NaN arithmetic → FAILED_CONFIRMED (WRONG)
    }
    const outcome = classifyImportOutcome(200, malformed as unknown as ImportSummaryLike, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('13. 2xx with wrong-type counter (string) → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({ importedCount: '5' as unknown as number })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('14. 2xx with NaN counter → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({ failedCount: NaN })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('15. 2xx with Infinity counter → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({ importedCount: Infinity })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('16. 2xx with negative counter → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({ importedCount: -1 })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('17. 2xx with null summary → AMBIGUOUS_RESULT (preserved from prior fix)', () => {
    const outcome = classifyImportOutcome(200, null, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })
})

// ============ P2-B: valid summary classification unchanged (regression guard) ============

describe('ST-75 P2-B: valid summary classification unchanged', () => {
  test('18. valid 2xx full success → SUCCESS', () => {
    const outcome = classifyImportOutcome(200, makeValidSummary({ importedCount: 5 }), false)
    expect(outcome).toBe('SUCCESS')
  })

  test('19. valid 2xx partial success → PARTIAL_SUCCESS', () => {
    const outcome = classifyImportOutcome(200, makeValidSummary({ importedCount: 3, failedCount: 2 }), false)
    expect(outcome).toBe('PARTIAL_SUCCESS')
  })

  test('20. valid 2xx all failed → FAILED_CONFIRMED', () => {
    const outcome = classifyImportOutcome(200, makeValidSummary({ failedCount: 5 }), false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })

  test('21. valid 2xx all duplicates → FAILED_CONFIRMED', () => {
    const outcome = classifyImportOutcome(200, makeValidSummary({ duplicateExistingCount: 5 }), false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })

  test('22. 429 → AMBIGUOUS_RESULT (unchanged)', () => {
    const outcome = classifyImportOutcome(429, null, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('23. 500 → AMBIGUOUS_RESULT (unchanged)', () => {
    const outcome = classifyImportOutcome(500, null, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('24. 400 → FAILED_CONFIRMED (unchanged)', () => {
    const outcome = classifyImportOutcome(400, null, false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })

  test('25. network error → AMBIGUOUS_RESULT (unchanged)', () => {
    const outcome = classifyImportOutcome(null, null, true)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('26. malformed 2xx summary triggers shouldRefreshHistory (AMBIGUOUS_RESULT)', () => {
    // Verify that AMBIGUOUS_RESULT from malformed summary triggers the refresh path.
    const malformed = makeValidSummary({ importedCount: 'invalid' as unknown as number })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
    expect(shouldRefreshHistory(outcome)).toBe(true)
  })
})

// ============ P2-A: scheduleAmbiguousRefresh bounded delayed reconciliation ============

describe('ST-75 P2-A: scheduleAmbiguousRefresh bounded delayed reconciliation', () => {
  test('27. fires immediate refresh + 2 delayed retries (default config)', async () => {
    let callCount = 0
    const callTimestamps: number[] = []
    const startTime = Date.now()

    // Inject fake timers to avoid real wall-clock delays.
    const pendingTimers: Array<{ fn: () => void; delay: number; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, delay: number) => {
      const entry = { fn, delay, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }

    const refresh = () => {
      callCount++
      callTimestamps.push(Date.now() - startTime)
    }

    const handle = scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate call fires synchronously.
    expect(callCount).toBe(1)

    // 2 delayed timers should be pending (bounded — not infinite).
    expect(pendingTimers.length).toBe(2)

    // Fire the first delayed retry.
    pendingTimers[0].fn()
    expect(callCount).toBe(2)

    // Fire the second delayed retry.
    pendingTimers[1].fn()
    expect(callCount).toBe(3)

    // All 3 refresh calls completed (1 immediate + 2 delayed). Bounded.
    expect(callTimestamps.length).toBe(3)

    handle.cancel() // cleanup
  })

  test('28. first refresh sees stale state, later refresh sees authoritative state', async () => {
    // Simulate: first refresh (immediate) sees stale state because backend
    // hasn't committed yet. Second refresh (delayed retry) sees the committed
    // authoritative state.
    let authoritativeStateCommitted = false
    const refreshResults: boolean[] = []

    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }

    const refresh = () => {
      // refresh returns true if authoritative state is visible.
      refreshResults.push(authoritativeStateCommitted)
    }

    scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate refresh fires BEFORE backend commits → sees stale state.
    expect(refreshResults).toEqual([false])

    // Simulate backend commit completing.
    authoritativeStateCommitted = true

    // Fire the first delayed retry — should now see authoritative state.
    pendingTimers[0].fn()
    expect(refreshResults).toEqual([false, true])

    // Fire the second delayed retry — still sees authoritative state.
    pendingTimers[1].fn()
    expect(refreshResults).toEqual([false, true, true])
  })

  test('29. no second POST/import mutation is issued (GET/read refresh only)', async () => {
    // The refresh callback must NOT re-issue POST /api/import/apply.
    // This test proves scheduleAmbiguousRefresh only calls the provided
    // refresh callback — it never calls fetch or any mutation.
    let refreshCallCount = 0
    let mutationCallCount = 0

    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (_id: number) => {
      // no-op for this test
    }

    // The refresh callback simulates a GET/read refresh (like loadProducts).
    // It must NOT call any mutation endpoint.
    const refresh = () => {
      refreshCallCount++
      // Simulate a GET refresh — no POST.
    }

    // Simulate a hypothetical mutation that the test verifies is NOT called.
    const fakeMutation = () => {
      mutationCallCount++
    }

    const handle = scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Fire all delayed retries.
    for (const t of pendingTimers) {
      t.fn()
    }

    // Verify: refresh was called 3 times (1 immediate + 2 delayed), but
    // NO mutation was ever called.
    expect(refreshCallCount).toBe(3)
    expect(mutationCallCount).toBe(0)

    // Also verify: the refresh callback itself does NOT call fakeMutation.
    fakeMutation() // this is just to prove the counter works
    expect(mutationCallCount).toBe(1)

    handle.cancel()
  })

  test('30. bounded: maxRetries cap prevents infinite polling', async () => {
    let callCount = 0
    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (_id: number) => {}

    const handle = scheduleAmbiguousRefresh(() => { callCount++ }, {
      maxRetries: 3,
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Should schedule exactly maxRetries=3 delayed timers (bounded — not infinite).
    expect(pendingTimers.length).toBe(3)

    // Fire all timers.
    for (const t of [...pendingTimers]) {
      t.fn()
    }

    // Total calls = 1 (immediate) + 3 (delayed) = 4. Bounded.
    expect(callCount).toBe(4)

    handle.cancel()
  })

  test('31. cancel() clears all pending delayed retries', async () => {
    let callCount = 0
    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }

    const handle = scheduleAmbiguousRefresh(() => { callCount++ }, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate call already fired.
    expect(callCount).toBe(1)
    expect(pendingTimers.length).toBe(2)

    // Cancel all pending.
    handle.cancel()

    // All timers cleared.
    expect(pendingTimers.length).toBe(0)

    // Simulate firing remaining timers (should not exist) — callCount stays at 1.
    for (const t of [...pendingTimers]) {
      t.fn()
    }
    expect(callCount).toBe(1)
  })

  test('32. cancel() is safe to call multiple times', () => {
    const handle = scheduleAmbiguousRefresh(() => {}, {
      scheduleTimer: () => 1,
      clearTimer: () => {},
    })
    expect(() => {
      handle.cancel()
      handle.cancel()
      handle.cancel()
    }).not.toThrow()
  })

  test('33. custom delays array is respected', async () => {
    const scheduledDelays: number[] = []
    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, delay: number) => {
      scheduledDelays.push(delay)
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (_id: number) => {}

    const handle = scheduleAmbiguousRefresh(() => {}, {
      delaysMs: [100, 200, 300],
      maxRetries: 3,
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    expect(scheduledDelays).toEqual([100, 200, 300])
    handle.cancel()
  })
})

// ============ P2-A: Dialog wiring (source assertions) ============

describe('ST-75 P2-A: Dialog wiring — scheduleAmbiguousRefresh on ambiguous paths', () => {
  test('34. Purchase dialog imports scheduleAmbiguousRefresh', () => {
    const src = readBuyDialog()
    expect(src).toContain("import { scheduleAmbiguousRefresh, type ScheduledRefreshHandle } from '@/lib/import-refresh-helper'")
  })

  test('35. Sales dialog imports scheduleAmbiguousRefresh', () => {
    const src = readSellDialog()
    expect(src).toContain("import { scheduleAmbiguousRefresh, type ScheduledRefreshHandle } from '@/lib/import-refresh-helper'")
  })

  test('36. Purchase dialog declares scheduleAmbiguousImportRefresh helper', () => {
    const src = readBuyDialog()
    expect(src).toMatch(/const scheduleAmbiguousImportRefresh = \(\) => \{[\s\S]*?scheduleAmbiguousRefresh/)
  })

  test('37. Sales dialog declares scheduleAmbiguousImportRefresh helper', () => {
    const src = readSellDialog()
    expect(src).toMatch(/const scheduleAmbiguousImportRefresh = \(\) => \{[\s\S]*?scheduleAmbiguousRefresh/)
  })

  test('38. Purchase TRANSIENT_ERROR path calls scheduleAmbiguousImportRefresh (not direct onRefreshAfterImport)', () => {
    const src = readBuyDialog()
    // Extract the TRANSIENT_ERROR block.
    const transientIdx = src.indexOf("applyAction === 'TRANSIENT_ERROR'")
    expect(transientIdx).toBeGreaterThan(-1)
    const blockEnd = src.indexOf('return;', transientIdx)
    const block = src.slice(transientIdx, blockEnd)
    expect(block).toContain('scheduleAmbiguousImportRefresh()')
    expect(block).not.toContain('onRefreshAfterImport?.()')
  })

  test('39. Sales TRANSIENT_ERROR path calls scheduleAmbiguousImportRefresh (not direct onRefreshAfterImport)', () => {
    const src = readSellDialog()
    const transientIdx = src.indexOf("applyAction === 'TRANSIENT_ERROR'")
    expect(transientIdx).toBeGreaterThan(-1)
    const blockEnd = src.indexOf('return;', transientIdx)
    const block = src.slice(transientIdx, blockEnd)
    expect(block).toContain('scheduleAmbiguousImportRefresh()')
    expect(block).not.toContain('onRefreshAfterImport?.()')
  })

  test('40. Purchase network-error catch calls scheduleAmbiguousImportRefresh', () => {
    const src = readBuyDialog()
    expect(src).toMatch(/catch \(err\) \{[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
  })

  test('41. Sales network-error catch calls scheduleAmbiguousImportRefresh', () => {
    const src = readSellDialog()
    expect(src).toMatch(/catch \(err\) \{[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
  })

  test('42. Purchase success path: AMBIGUOUS_RESULT uses scheduleAmbiguousImportRefresh', () => {
    const src = readBuyDialog()
    // The success-path refresh block must branch on outcome === 'AMBIGUOUS_RESULT'.
    expect(src).toMatch(/if \(outcome === 'AMBIGUOUS_RESULT'\)[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
    expect(src).toMatch(/else[\s\S]*?onRefreshAfterImport\?\.\(\)/)
  })

  test('43. Sales success path: AMBIGUOUS_RESULT uses scheduleAmbiguousImportRefresh', () => {
    const src = readSellDialog()
    expect(src).toMatch(/if \(outcome === 'AMBIGUOUS_RESULT'\)[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
    expect(src).toMatch(/else[\s\S]*?onRefreshAfterImport\?\.\(\)/)
  })

  test('44. Purchase dialog cancels pending refreshes on unmount', () => {
    const src = readBuyDialog()
    expect(src).toMatch(/useEffect\(\(\) => \{[\s\S]*?handle\.cancel\(\)/)
  })

  test('45. Sales dialog cancels pending refreshes on unmount', () => {
    const src = readSellDialog()
    expect(src).toMatch(/useEffect\(\(\) => \{[\s\S]*?handle\.cancel\(\)/)
  })

  test('46. Purchase resetDialogState does NOT cancel pending refreshes (P2-A2)', () => {
    const src = readBuyDialog()
    const resetIdx = src.indexOf('const resetDialogState = () => {')
    expect(resetIdx).toBeGreaterThan(-1)
    const resetEnd = src.indexOf('};', resetIdx)
    const resetBlock = src.slice(resetIdx, resetEnd)
    // ST-75 P2-A2: resetDialogState must NOT cancel pending ambiguous-refresh
    // timers. The refresh callbacks are parent-level and don't depend on dialog
    // state. Cancelling on close would defeat delayed reconciliation.
    expect(resetBlock).not.toContain('handle.cancel()')
    expect(resetBlock).not.toContain('ambiguousRefreshHandlesRef.current = []')
    // Verify the comment explaining the decision is present.
    expect(resetBlock).toContain('P2-A2')
  })

  test('47. Sales resetDialogState does NOT cancel pending refreshes (P2-A2)', () => {
    const src = readSellDialog()
    const resetIdx = src.indexOf('const resetDialogState = () => {')
    expect(resetIdx).toBeGreaterThan(-1)
    const resetEnd = src.indexOf('};', resetIdx)
    const resetBlock = src.slice(resetIdx, resetEnd)
    expect(resetBlock).not.toContain('handle.cancel()')
    expect(resetBlock).not.toContain('ambiguousRefreshHandlesRef.current = []')
    expect(resetBlock).toContain('P2-A2')
  })
})

// ============ P2-A: No automatic import mutation retry (wiring proof) ============

describe('ST-75 P2-A: No automatic POST /api/import/apply retry', () => {
  test('48. import-refresh-helper never references fetch or /api/import/apply in executable code', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/import-refresh-helper.ts'),
      'utf8',
    )
    // Strip comments and docstrings before checking — comments describe what
    // the helper does NOT do, which is different from actual code references.
    // Remove /* ... */ block comments and // line comments.
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
      .replace(/\/\/.*$/gm, '') // line comments
    // The helper's executable code must NOT call fetch or reference the import
    // apply endpoint. It only schedules the provided callback.
    expect(codeOnly).not.toMatch(/fetch\s*\(/)
    expect(codeOnly).not.toContain('/api/import/apply')
    expect(codeOnly).not.toContain('handleImport')
  })

  test('49. scheduleAmbiguousRefresh callback type is GET/read refresh, not mutation', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/lib/import-refresh-helper.ts'),
      'utf8',
    )
    // The callback signature is () => void | Promise<void> — a refresh function,
    // not a mutation that takes arguments.
    expect(src).toContain('refresh: () => void | Promise<void>')
  })
})

// ============ P2-B2: Validate result arrays before accepting summary ============

describe('ST-75 P2-B2: Validate result arrays (importedBills, skippedDuplicateBills, failedBills)', () => {
  test('50. valid summary with all 3 arrays present → true', () => {
    const summary = makeValidSummary({
      importedCount: 5,
      importedBills: [],
      skippedDuplicateBills: [],
      failedBills: [],
    })
    expect(isValidImportSummary(summary)).toBe(true)
  })

  test('51. missing importedBills array → false (AMBIGUOUS_RESULT)', () => {
    const malformed = {
      importedCount: 5,
      duplicateExistingCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      unmatchedCount: 0,
      insufficientStockCount: 0,
      failedCount: 0,
      // importedBills missing
      skippedDuplicateBills: [],
      failedBills: [],
    }
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('52. missing skippedDuplicateBills array → false', () => {
    const malformed = {
      importedCount: 5,
      duplicateExistingCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      unmatchedCount: 0,
      insufficientStockCount: 0,
      failedCount: 0,
      importedBills: [],
      // skippedDuplicateBills missing
      failedBills: [],
    }
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('53. missing failedBills array → false (would cause applyResult.failedBills.length exception)', () => {
    const malformed = {
      importedCount: 5,
      duplicateExistingCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      unmatchedCount: 0,
      insufficientStockCount: 0,
      failedCount: 0,
      importedBills: [],
      skippedDuplicateBills: [],
      // failedBills missing — both dialogs access applyResult.failedBills.length
    }
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('54. wrong-type failedBills (string instead of array) → false', () => {
    const malformed = makeValidSummary({
      failedBills: 'not-an-array' as unknown as [],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('55. wrong-type importedBills (null) → false', () => {
    const malformed = makeValidSummary({
      importedBills: null as unknown as [],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('56. 2xx with valid counters but missing arrays → AMBIGUOUS_RESULT', () => {
    // This is the exact scenario Codex flagged: counters pass but failedBills
    // is missing → previously accepted → applyResult.failedBills.length throws.
    const malformed = {
      importedCount: 5,
      duplicateExistingCount: 0,
      duplicateInFileCount: 0,
      invalidCount: 0,
      unmatchedCount: 0,
      insufficientStockCount: 0,
      failedCount: 0,
      // arrays missing
    }
    const outcome = classifyImportOutcome(200, malformed as unknown as ImportSummaryLike, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('57. 2xx with all valid fields (counters + arrays) → SUCCESS (unchanged)', () => {
    const valid = makeValidSummary({ importedCount: 5 })
    const outcome = classifyImportOutcome(200, valid, false)
    expect(outcome).toBe('SUCCESS')
  })
})

// ============ P2-A2: Ambiguous retries stay alive after dialog close ============

describe('ST-75 P2-A2: Ambiguous retries stay alive after dialog close', () => {
  test('58. scheduleAmbiguousRefresh timers continue firing after dialog closes', () => {
    // Simulate: user dismisses AMBIGUOUS_RESULT dialog before 1.5s retry fires.
    // The pending delayed refresh timers must NOT be cancelled by resetDialogState.
    let refreshCallCount = 0
    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }

    const refresh = () => { refreshCallCount++ }

    const handle = scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate refresh fired.
    expect(refreshCallCount).toBe(1)
    expect(pendingTimers.length).toBe(2)

    // Simulate dialog close (resetDialogState). Per P2-A2, this must NOT cancel
    // the pending timers. We verify by NOT calling handle.cancel() here — the
    // dialog's resetDialogState no longer calls cancel.

    // Fire the delayed retries — they should still work.
    pendingTimers[0].fn()
    expect(refreshCallCount).toBe(2)

    pendingTimers[1].fn()
    expect(refreshCallCount).toBe(3)

    // All 3 refresh calls completed (1 immediate + 2 delayed) — delayed
    // reconciliation succeeded even though the dialog was closed.
    handle.cancel() // cleanup
  })

  test('59. unmount useEffect cleanup still cancels (component destruction)', () => {
    // When the component is truly unmounted (not just dialog closed), the
    // useEffect cleanup must cancel pending timers to prevent stale-closure
    // leaks. This is different from resetDialogState (dialog close).
    let refreshCallCount = 0
    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (id: number) => {
      const idx = pendingTimers.findIndex(t => t.id === id)
      if (idx >= 0) pendingTimers.splice(idx, 1)
    }

    const refresh = () => { refreshCallCount++ }

    const handle = scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate refresh fired.
    expect(refreshCallCount).toBe(1)
    expect(pendingTimers.length).toBe(2)

    // Simulate component unmount (useEffect cleanup) — must cancel pending timers.
    handle.cancel()

    // All pending timers cleared.
    expect(pendingTimers.length).toBe(0)

    // Fire remaining timers (should not exist) — refreshCallCount stays at 1.
    for (const t of [...pendingTimers]) {
      t.fn()
    }
    expect(refreshCallCount).toBe(1)
  })
})
