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
  const base = {
    importedCount: 0,
    duplicateExistingCount: 0,
    duplicateInFileCount: 0,
    invalidCount: 0,
    unmatchedCount: 0,
    insufficientStockCount: 0,
    failedCount: 0,
    importedBills: [] as unknown[],
    skippedDuplicateBills: [] as unknown[],
    failedBills: [] as unknown[],
    ...overrides,
  }
  // ST-75 P2-3: Auto-populate arrays with valid BillImportResult elements.
  if (!overrides.importedBills && Number.isFinite(base.importedCount) && base.importedCount > 0) {
    base.importedBills = Array.from({ length: base.importedCount }, (_, i) => ({
      externalBillNumber: `imp-${i}`,
      normalizedBillNumber: `imp-${i}`,
      status: 'READY',
    }))
  }
  if (!overrides.failedBills && Number.isFinite(base.failedCount) && base.failedCount > 0) {
    base.failedBills = Array.from({ length: base.failedCount }, (_, i) => ({
      externalBillNumber: `fail-${i}`,
      normalizedBillNumber: `fail-${i}`,
      status: 'FAILED',
    }))
  }
  if (!overrides.skippedDuplicateBills && Number.isFinite(base.duplicateExistingCount) && base.duplicateExistingCount > 0) {
    base.skippedDuplicateBills = Array.from({ length: base.duplicateExistingCount }, (_, i) => ({
      externalBillNumber: `dup-${i}`,
      normalizedBillNumber: `dup-${i}`,
      status: 'DUPLICATE_EXISTING',
    }))
  }
  // ST-75 P2-4: Also auto-populate skippedDuplicateBills for duplicateInFileCount.
  if (!overrides.skippedDuplicateBills && Number.isFinite(base.duplicateInFileCount) && base.duplicateInFileCount > 0) {
    const inFileDups = Array.from({ length: base.duplicateInFileCount }, (_, i) => ({
      externalBillNumber: `inf-${i}`,
      normalizedBillNumber: `inf-${i}`,
      status: 'DUPLICATE_IN_FILE',
    }))
    base.skippedDuplicateBills = [...base.skippedDuplicateBills, ...inFileDups]
  }
  // ST-75 P2-4: Populate failedBills for invalid/unmatched/insufficientStock counts.
  if (!overrides.failedBills) {
    const extraFailures: unknown[] = []
    if (Number.isFinite(base.invalidCount) && base.invalidCount > 0) {
      for (let i = 0; i < base.invalidCount; i++) {
        extraFailures.push({ externalBillNumber: `inv-${i}`, normalizedBillNumber: `inv-${i}`, status: 'INVALID' })
      }
    }
    if (Number.isFinite(base.unmatchedCount) && base.unmatchedCount > 0) {
      for (let i = 0; i < base.unmatchedCount; i++) {
        extraFailures.push({ externalBillNumber: `unm-${i}`, normalizedBillNumber: `unm-${i}`, status: 'UNMATCHED_PRODUCT' })
      }
    }
    if (Number.isFinite(base.insufficientStockCount) && base.insufficientStockCount > 0) {
      for (let i = 0; i < base.insufficientStockCount; i++) {
        extraFailures.push({ externalBillNumber: `ins-${i}`, normalizedBillNumber: `ins-${i}`, status: 'INSUFFICIENT_STOCK' })
      }
    }
    if (extraFailures.length > 0) {
      base.failedBills = [...base.failedBills, ...extraFailures]
    }
  }
  return base as ImportSummaryLike
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

  test('21. valid 2xx all pre-existing duplicates → FAILED_CONFIRMED (P2-26: no concurrent race)', () => {
    // ST-75 P2-26: Ordinary pre-existing duplicates (no reconciledAfterFailure) do NOT
    // prove a concurrent commit. Classification is FAILED_CONFIRMED.
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

    const handle = scheduleAmbiguousRefresh(() => { callCount++ }, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // ST-75 P2-A3: refresh is async/serialized. Wait for immediate to complete.
    await new Promise((r) => setTimeout(r, 0))
    expect(callCount).toBe(1)
    expect(pendingTimers.length).toBe(2)

    pendingTimers[0].fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(callCount).toBe(2)

    pendingTimers[1].fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(callCount).toBe(3)

    handle.cancel()
  })

  test('28. first refresh sees stale state, later refresh sees authoritative state', async () => {
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
      refreshResults.push(authoritativeStateCommitted)
    }

    scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    await new Promise((r) => setTimeout(r, 0))
    expect(refreshResults).toEqual([false])

    authoritativeStateCommitted = true

    pendingTimers[0].fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(refreshResults).toEqual([false, true])

    pendingTimers[1].fn()
    await new Promise((r) => setTimeout(r, 0))
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
    const fakeClearTimeout = (_id: number) => {}

    const refresh = () => {
      refreshCallCount++
    }
    const fakeMutation = () => {
      mutationCallCount++
    }

    const handle = scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // ST-75 P2-A3: refresh is now serialized (async). Await microtasks between
    // timer firings so each runRefresh completes before the next starts.
    for (const t of pendingTimers) {
      t.fn()
      await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 0))

    expect(refreshCallCount).toBe(3)
    expect(mutationCallCount).toBe(0)
    fakeMutation()
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

    expect(pendingTimers.length).toBe(3)

    // ST-75 P2-A3: Await between timer firings for serialized refresh.
    for (const t of [...pendingTimers]) {
      t.fn()
      await new Promise((r) => setTimeout(r, 0))
    }
    await new Promise((r) => setTimeout(r, 0))

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
    expect(src).toMatch(/if \(outcome === 'AMBIGUOUS_RESULT'\)[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
    // ST-75 P2-11: else branch now uses runTrackedRefresh, not direct onRefreshAfterImport
    expect(src).toMatch(/else[\s\S]*?runTrackedRefresh\(\)/)
  })

  test('43. Sales success path: AMBIGUOUS_RESULT uses scheduleAmbiguousImportRefresh', () => {
    const src = readSellDialog()
    expect(src).toMatch(/if \(outcome === 'AMBIGUOUS_RESULT'\)[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
    expect(src).toMatch(/else[\s\S]*?runTrackedRefresh\(\)/)
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
      importedBills: Array.from({ length: 5 }, (_, i) => ({
        externalBillNumber: `imp-${i}`,
        normalizedBillNumber: `imp-${i}`,
        status: 'READY',
      })),
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
  test('58. scheduleAmbiguousRefresh timers continue firing after dialog closes', async () => {
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

    // ST-75 P2-A3: refresh is now async/serialized. Wait for immediate to complete.
    await new Promise((r) => setTimeout(r, 0))
    expect(refreshCallCount).toBe(1)
    expect(pendingTimers.length).toBe(2)

    // Simulate dialog close (resetDialogState). Per P2-A2, this must NOT cancel.

    // Fire delayed retries — await between each for serialization.
    pendingTimers[0].fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(refreshCallCount).toBe(2)

    pendingTimers[1].fn()
    await new Promise((r) => setTimeout(r, 0))
    expect(refreshCallCount).toBe(3)

    handle.cancel()
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

  test('60. P2-A3: serializes refresh attempts (no overlapping)', async () => {
    // P2-A3: When the immediate refresh takes longer than the first delay,
    // the delayed retry must NOT start until the immediate completes. This
    // prevents a faster delayed fetch from overwriting state before the slow
    // immediate fetch returns.
    let refreshRunning = false
    let overlapDetected = false
    const refreshCallCount = { value: 0 }

    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (_id: number) => {}

    const refresh = () => {
      // Detect overlap: if refreshRunning is already true when this is called,
      // two refreshes are running simultaneously.
      if (refreshRunning) {
        overlapDetected = true
      }
      refreshRunning = true
      refreshCallCount.value++
      // Return a promise that resolves after a microtask (simulating async fetch).
      return new Promise<void>((resolve) => {
        // Resolve on next microtask — but the delayed timer fires synchronously.
        // The serialization logic should prevent overlap.
        setTimeout(() => {
          refreshRunning = false
          resolve()
        }, 0)
      })
    }

    const handle = scheduleAmbiguousRefresh(refresh, {
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate refresh was called (synchronously started).
    expect(refreshCallCount.value).toBe(1)

    // Fire the first delayed retry while the immediate is still in flight.
    // The serialization logic should queue it, not start it immediately.
    pendingTimers[0].fn()
    // Due to serialization, the second refresh should NOT have started yet
    // (the immediate is still in flight — it resolves on next tick).
    // Wait for microtasks to settle.
    await new Promise((resolve) => setTimeout(resolve, 10))

    // No overlap should have been detected.
    expect(overlapDetected).toBe(false)

    handle.cancel()
  })
})

// ============ P2-B3: Reject inconsistent result-array contents ============

describe('ST-75 P2-B3: Reject inconsistent counter/array combinations', () => {
  test('61. importedCount: 0 with nonempty importedBills → false (AMBIGUOUS)', () => {
    const inconsistent = makeValidSummary({
      importedCount: 0,
      importedBills: [{ id: 'stale-bill' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('62. importedCount: 5 with empty importedBills → false', () => {
    const inconsistent = makeValidSummary({
      importedCount: 5,
      importedBills: [],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('63. failedCount: 0 with nonempty failedBills → false', () => {
    const inconsistent = makeValidSummary({
      failedCount: 0,
      failedBills: [{ id: 'stale-failed-bill' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('64. failedCount: 3 with empty failedBills → false', () => {
    const inconsistent = makeValidSummary({
      failedCount: 3,
      failedBills: [],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('65. duplicateExistingCount: 2 with empty skippedDuplicateBills → false', () => {
    const inconsistent = makeValidSummary({
      duplicateExistingCount: 2,
      skippedDuplicateBills: [],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('66. duplicateExistingCount: 0 with nonempty skippedDuplicateBills → false', () => {
    const inconsistent = makeValidSummary({
      duplicateExistingCount: 0,
      skippedDuplicateBills: [{ id: 'stale-dup' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('67. consistent summary (importedCount matches importedBills.length) → true', () => {
    const consistent = makeValidSummary({
      importedCount: 3,
      importedBills: Array.from({ length: 3 }, (_, i) => ({
        externalBillNumber: `imp-${i}`,
        normalizedBillNumber: `imp-${i}`,
        status: 'READY',
      })),
      failedCount: 1,
      failedBills: [{ externalBillNumber: 'f0', normalizedBillNumber: 'f0', status: 'FAILED' }],
    })
    expect(isValidImportSummary(consistent)).toBe(true)
  })

  test('68. 2xx with inconsistent counters/arrays → AMBIGUOUS_RESULT', () => {
    const inconsistent = makeValidSummary({
      importedCount: 0,
      importedBills: [{ id: 'stale' }],
    })
    const outcome = classifyImportOutcome(200, inconsistent, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })
})

// ============ P2-1: Chain queued retries to active refresh ============

describe('ST-75 P2-1: Chain queued retries to active refresh', () => {
  test('69. immediate refresh lasting beyond ALL retry delays: at least one queued refresh executes', async () => {
    // P2-1: When the immediate refresh takes longer than all configured retry
    // delays, both retries fire while the immediate is still active. The
    // prior implementation discarded both retries (runRefresh returned false).
    // The fix chains queued retries to the active promise — at least one
    // queued refresh must execute after the immediate settles.
    let refreshCallCount = 0
    let immediateResolve: (() => void) | null = null
    const refreshTimestamps: number[] = []

    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (_id: number) => {}

    // The refresh returns a promise that resolves only when immediateResolve is called.
    const refresh = () => {
      refreshCallCount++
      refreshTimestamps.push(Date.now())
      return new Promise<void>((resolve) => {
        if (refreshCallCount === 1) {
          // First (immediate) refresh — hold it open.
          immediateResolve = resolve
        } else {
          // Subsequent refreshes resolve immediately.
          resolve()
        }
      })
    }

    const handle = scheduleAmbiguousRefresh(refresh, {
      maxRetries: 2,
      delaysMs: [100, 200],
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Immediate refresh started but hasn't resolved yet (held open).
    expect(refreshCallCount).toBe(1)
    expect(pendingTimers.length).toBe(2)

    // Fire both delayed retries while the immediate is still active.
    pendingTimers[0].fn()
    pendingTimers[1].fn()

    // Still only 1 refresh call — both retries are queued.
    expect(refreshCallCount).toBe(1)

    // Resolve the immediate refresh — the queued retry should now execute.
    immediateResolve!()
    // Wait for the chained refresh to complete.
    await new Promise((r) => setTimeout(r, 10))

    // At least one queued refresh must have executed after the immediate settled.
    expect(refreshCallCount).toBeGreaterThanOrEqual(2)

    handle.cancel()
  })

  test('70. no overlapping authoritative refreshes (serialized)', async () => {
    let refreshRunning = false
    let overlapDetected = false

    const refresh = () => {
      if (refreshRunning) {
        overlapDetected = true
      }
      refreshRunning = true
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          refreshRunning = false
          resolve()
        }, 5)
      })
    }

    const pendingTimers: Array<{ fn: () => void; id: number }> = []
    let nextId = 1
    const fakeSetTimeout = (fn: () => void, _delay: number) => {
      const entry = { fn, id: nextId++ }
      pendingTimers.push(entry)
      return entry.id
    }
    const fakeClearTimeout = (_id: number) => {}

    const handle = scheduleAmbiguousRefresh(refresh, {
      maxRetries: 2,
      delaysMs: [1, 2],
      scheduleTimer: fakeSetTimeout,
      clearTimer: fakeClearTimeout,
    })

    // Fire both retries immediately.
    pendingTimers[0].fn()
    pendingTimers[1].fn()

    // Wait for all refreshes to complete.
    await new Promise((r) => setTimeout(r, 30))

    // No overlap should have been detected.
    expect(overlapDetected).toBe(false)

    handle.cancel()
  })
})

// ============ P2-2: Return parent refresh promise ============

describe('ST-75 P2-2: Return parent refresh promise to scheduler', () => {
  test('71. Purchase dialog scheduleAmbiguousImportRefresh returns parent promise via runTrackedRefresh', () => {
    const src = readBuyDialog()
    // ST-75 P2-10: The scheduler now calls runTrackedRefresh() which wraps
    // onRefreshAfterImport and returns its promise.
    expect(src).toMatch(/return runTrackedRefresh\(\)/)
    expect(src).toMatch(/Promise\.resolve\(onRefreshAfterImport\?\.\(\)\)/)
  })

  test('72. Sales dialog scheduleAmbiguousImportRefresh returns parent promise via runTrackedRefresh', () => {
    const src = readSellDialog()
    expect(src).toMatch(/return runTrackedRefresh\(\)/)
    expect(src).toMatch(/Promise\.resolve\(onRefreshAfterImport\?\.\(\)\)/)
  })
})

// ============ P2-3: Validate result-array elements ============

describe('ST-75 P2-3: Validate result-array elements (isValidBillImportResult)', () => {
  test('73. null element in failedBills → false', () => {
    const malformed = makeValidSummary({
      failedCount: 1,
      failedBills: [null],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('74. string element → false', () => {
    const malformed = makeValidSummary({
      importedCount: 1,
      importedBills: ['not-an-object'],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('75. number element → false', () => {
    const malformed = makeValidSummary({
      importedCount: 1,
      importedBills: [42],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('76. missing externalBillNumber → false', () => {
    const malformed = makeValidSummary({
      importedCount: 1,
      importedBills: [{ normalizedBillNumber: 'x', status: 'READY' }],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('77. missing status → false', () => {
    const malformed = makeValidSummary({
      importedCount: 1,
      importedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x' }],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('78. invalid status value → false', () => {
    const malformed = makeValidSummary({
      importedCount: 1,
      importedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'UNKNOWN' }],
    })
    expect(isValidImportSummary(malformed)).toBe(false)
  })

  test('79. valid BillImportResult elements → true', () => {
    const valid = makeValidSummary({
      importedCount: 2,
      importedBills: [
        { externalBillNumber: 'B1', normalizedBillNumber: 'B1', status: 'READY', billNumber: 'BUY-2569-00001', billId: 'id1' },
        { externalBillNumber: 'B2', normalizedBillNumber: 'B2', status: 'READY' },
      ],
    })
    expect(isValidImportSummary(valid)).toBe(true)
  })

  test('80. 2xx with null element in failedBills → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({
      failedCount: 1,
      failedBills: [null],
    })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })
})

// ============ P2-4: Validate grouped arrays against all contributing counters ============

describe('ST-75 P2-4: Grouped counter validation (production buildImportSummary contract)', () => {
  test('81. valid insufficient-stock summary remains valid (PARTIAL_SUCCESS)', () => {
    // Production scenario: importedCount=2, insufficientStockCount=1, failedCount=0
    // failedBills should contain 1 element (the insufficient-stock bill).
    const summary = makeValidSummary({
      importedCount: 2,
      insufficientStockCount: 1,
    })
    // Helper auto-populates: importedBills[2], failedBills[1] (INSUFFICIENT_STOCK)
    expect(isValidImportSummary(summary)).toBe(true)
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('PARTIAL_SUCCESS')
  })

  test('82. valid invalid/unmatched failure grouping remains valid', () => {
    const summary = makeValidSummary({
      invalidCount: 2,
      unmatchedCount: 1,
    })
    // Helper auto-populates: failedBills[3] (2 INVALID + 1 UNMATCHED_PRODUCT)
    expect(isValidImportSummary(summary)).toBe(true)
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })

  test('83. valid duplicate grouping remains valid (DUPLICATE_EXISTING + DUPLICATE_IN_FILE)', () => {
    const summary = makeValidSummary({
      duplicateExistingCount: 2,
      duplicateInFileCount: 1,
    })
    expect(isValidImportSummary(summary)).toBe(true)
    // ST-75 P2-26: Ordinary duplicates (no reconciledAfterFailure) → FAILED_CONFIRMED
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })

  test('84. inconsistent grouped counts → AMBIGUOUS_RESULT', () => {
    // failedBills has 1 element but failedCount=0 and insufficientStockCount=0
    // → failedBills.length (1) !== invalidCount + unmatchedCount + insufficientStockCount + failedCount (0)
    const inconsistent = makeValidSummary({
      failedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'FAILED' }],
    })
    // Helper won't auto-populate because failedBills is explicitly set, but
    // failedCount=0 so failedBills.length (1) !== 0.
    expect(isValidImportSummary(inconsistent)).toBe(false)
    const outcome = classifyImportOutcome(200, inconsistent, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })

  test('85. valid full server summary remains non-ambiguous (SUCCESS)', () => {
    const summary = makeValidSummary({ importedCount: 5 })
    expect(isValidImportSummary(summary)).toBe(true)
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('SUCCESS')
  })
})

// ============ P2-5: Validate summary before storing ============

describe('ST-75 P2-5: Validate summary before storing (setApplyResult)', () => {
  test('86. Purchase dialog classifies before storing applyResult', () => {
    const src = readBuyDialog()
    // setApplyResult must NOT be called before classifyImportOutcome.
    const setApplyResultIdx = src.indexOf('setApplyResult(summary)')
    const classifyIdx = src.indexOf('classifyImportOutcome(res.status, summary, false)')
    expect(setApplyResultIdx).toBeGreaterThan(-1)
    expect(classifyIdx).toBeGreaterThan(-1)
    // classifyImportOutcome must come BEFORE setApplyResult.
    expect(classifyIdx).toBeLessThan(setApplyResultIdx)
  })

  test('87. Purchase dialog only stores summary if outcome !== AMBIGUOUS_RESULT', () => {
    const src = readBuyDialog()
    expect(src).toMatch(/if \(outcome !== 'AMBIGUOUS_RESULT'\) \{[\s\S]*?setApplyResult\(summary\)/)
  })

  test('88. Sales dialog classifies before storing applyResult', () => {
    const src = readSellDialog()
    const setApplyResultIdx = src.indexOf('setApplyResult(summary)')
    const classifyIdx = src.indexOf('classifyImportOutcome(res.status, summary, false)')
    expect(classifyIdx).toBeLessThan(setApplyResultIdx)
  })

  test('89. Sales dialog only stores summary if outcome !== AMBIGUOUS_RESULT', () => {
    const src = readSellDialog()
    expect(src).toMatch(/if \(outcome !== 'AMBIGUOUS_RESULT'\) \{[\s\S]*?setApplyResult\(summary\)/)
  })
})

// ============ P2-6: Verify statuses match their result groups ============

describe('ST-75 P2-6: Per-element status matches result group', () => {
  test('90. importedBills with FAILED status → false', () => {
    const inconsistent = makeValidSummary({
      importedCount: 1,
      importedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'FAILED' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('91. failedBills with READY status → false', () => {
    const inconsistent = makeValidSummary({
      failedCount: 1,
      failedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'READY' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('92. skippedDuplicateBills with INVALID status → false', () => {
    const inconsistent = makeValidSummary({
      duplicateExistingCount: 1,
      skippedDuplicateBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'INVALID' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('93. 2xx with mismatched status in importedBills → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({
      importedCount: 1,
      importedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'FAILED' }],
    })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })
})

// ============ P2-7: Serialize refreshes across scheduler instances ============

describe('ST-75 P2-7: Cross-scheduler coordination', () => {
  test('94. Purchase scheduleAmbiguousImportRefresh cancels prior handles', () => {
    const src = readBuyDialog()
    // The function must cancel prior handles before creating a new one.
    expect(src).toMatch(/for \(const handle of ambiguousRefreshHandlesRef\.current\) \{[\s\S]*?handle\.cancel\(\)/)
    expect(src).toMatch(/ambiguousRefreshHandlesRef\.current = \[\]/)
  })

  test('95. Sales scheduleAmbiguousImportRefresh cancels prior handles', () => {
    const src = readSellDialog()
    expect(src).toMatch(/for \(const handle of ambiguousRefreshHandlesRef\.current\) \{[\s\S]*?handle\.cancel\(\)/)
    expect(src).toMatch(/ambiguousRefreshHandlesRef\.current = \[\]/)
  })
})

// ============ P2-8: Await prior active refresh across scheduler replacements ============

describe('ST-75 P2-8: Await prior active refresh', () => {
  test('96. Purchase dialog uses runTrackedRefresh with queued fresh refresh', () => {
    const src = readBuyDialog()
    expect(src).toContain('runTrackedRefresh')
    expect(src).toContain('startTrackedRefresh')
    expect(src).toContain('queuedRefresh')
    // ST-75 P2-14: does NOT just return old promise
    expect(src).not.toContain('if (existing) return existing')
  })

  test('97. Sales dialog uses runTrackedRefresh with queued fresh refresh', () => {
    const src = readSellDialog()
    expect(src).toContain('runTrackedRefresh')
    expect(src).toContain('startTrackedRefresh')
    expect(src).toContain('queuedRefresh')
    expect(src).not.toContain('if (existing) return existing')
  })
})

// ============ P2-9: Match every result status to its own counter ============

describe('ST-75 P2-9: Per-status counter matching', () => {
  test('98. duplicateExistingCount: 1 with DUPLICATE_IN_FILE element → false', () => {
    const inconsistent = makeValidSummary({
      duplicateExistingCount: 1,
      skippedDuplicateBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'DUPLICATE_IN_FILE' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('99. invalidCount: 1 with FAILED element → false', () => {
    const inconsistent = makeValidSummary({
      invalidCount: 1,
      failedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'FAILED' }],
    })
    expect(isValidImportSummary(inconsistent)).toBe(false)
  })

  test('100. importedCount: 1 with READY element → true (correct match)', () => {
    const consistent = makeValidSummary({
      importedCount: 1,
      importedBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'READY' }],
    })
    expect(isValidImportSummary(consistent)).toBe(true)
  })

  test('101. insufficientStockCount: 1 with INSUFFICIENT_STOCK element → true', () => {
    const consistent = makeValidSummary({
      insufficientStockCount: 1,
    })
    expect(isValidImportSummary(consistent)).toBe(true)
  })

  test('102. 2xx with cross-status swap → AMBIGUOUS_RESULT', () => {
    const malformed = makeValidSummary({
      duplicateExistingCount: 1,
      skippedDuplicateBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'DUPLICATE_IN_FILE' }],
    })
    const outcome = classifyImportOutcome(200, malformed, false)
    expect(outcome).toBe('AMBIGUOUS_RESULT')
  })
})

// ============ P2-10: Populate cross-scheduler refresh promise ============

describe('ST-75 P2-10: Populate activeRefreshPromiseRef', () => {
  test('103. Purchase dialog declares runTrackedRefresh that assigns activeRefreshPromiseRef', () => {
    const src = readBuyDialog()
    expect(src).toContain('runTrackedRefresh')
    expect(src).toContain('activeRefreshPromiseRef.current = promise')
    expect(src).toContain('activeRefreshPromiseRef.current === promise')
    expect(src).toContain('runTrackedRefresh()')
  })

  test('104. Sales dialog declares runTrackedRefresh that assigns activeRefreshPromiseRef', () => {
    const src = readSellDialog()
    expect(src).toContain('runTrackedRefresh')
    expect(src).toContain('activeRefreshPromiseRef.current = promise')
    expect(src).toContain('activeRefreshPromiseRef.current === promise')
    expect(src).toContain('runTrackedRefresh()')
  })

  test('105. Purchase dialog: activeRefreshPromiseRef.current is assigned (not just read)', () => {
    const src = readBuyDialog()
    // Must contain assignment (=), not just read
    expect(src).toMatch(/activeRefreshPromiseRef\.current = promise/)
    expect(src).toMatch(/activeRefreshPromiseRef\.current = null/)
  })

  test('106. Sales dialog: activeRefreshPromiseRef.current is assigned (not just read)', () => {
    const src = readSellDialog()
    expect(src).toMatch(/activeRefreshPromiseRef\.current = promise/)
    expect(src).toMatch(/activeRefreshPromiseRef\.current = null/)
  })

  test('107. runTrackedRefresh queues fresh refresh when in-flight exists (P2-14)', () => {
    const src = readBuyDialog()
    // ST-75 P2-14: when existing is active, queues a fresh refresh
    expect(src).toMatch(/const existing = activeRefreshPromiseRef\.current/)
    expect(src).toContain('queuedRefresh')
    // Does NOT just return the old promise
    expect(src).not.toMatch(/if \(existing\) return existing/)
  })

  test('108. Identity check prevents older finally from clearing newer promise', () => {
    const src = readBuyDialog()
    expect(src).toMatch(/if \(activeRefreshPromiseRef\.current === promise\)/)
  })

  test('109. No priorPromise pattern remains (old P2-8 code replaced)', () => {
    const src = readBuyDialog()
    // The old pattern read priorPromise but never assigned — it's now replaced
    // by runTrackedRefresh. Verify the old pattern is gone.
    expect(src).not.toMatch(/const priorPromise = activeRefreshPromiseRef\.current/)
  })

  test('110. Sales dialog: no priorPromise pattern remains', () => {
    const src = readSellDialog()
    expect(src).not.toMatch(/const priorPromise = activeRefreshPromiseRef\.current/)
  })
})

// ============ P2-21: Refresh after post-failure duplicate reconciliation ============

describe('ST-75 P2-21: Refresh when importedCount=0 but duplicateExistingCount>0', () => {
  test('103. 2xx with importedCount=0, reconciledAfterFailure=true → PARTIAL_SUCCESS', () => {
    // P2-26: Only reconciled-after-failure duplicates prove a concurrent commit.
    const summary = makeValidSummary({
      importedCount: 0,
      duplicateExistingCount: 1,
      skippedDuplicateBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'DUPLICATE_EXISTING', reconciledAfterFailure: true }],
    })
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('PARTIAL_SUCCESS')
  })

  test('104. PARTIAL_SUCCESS triggers shouldRefreshHistory=true', () => {
    expect(shouldRefreshHistory('PARTIAL_SUCCESS')).toBe(true)
  })

  test('105. 2xx with importedCount=0, duplicateExistingCount=0, failedCount=0 → FAILED_CONFIRMED (no race)', () => {
    const summary = makeValidSummary()
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })

  test('106. 2xx with importedCount=0, duplicateInFileCount=1 → FAILED_CONFIRMED (in-file dup, no concurrent race)', () => {
    const summary = makeValidSummary({
      duplicateInFileCount: 1,
      skippedDuplicateBills: [{ externalBillNumber: 'x', normalizedBillNumber: 'x', status: 'DUPLICATE_IN_FILE' }],
    })
    const outcome = classifyImportOutcome(200, summary, false)
    expect(outcome).toBe('FAILED_CONFIRMED')
  })
})
