/**
 * ST-75 Post-Ready Review Fixes — behavior-bound regression tests.
 *
 * Covers the 4 findings from the Codex post-Ready review:
 *   F1: Sales terminal outcome on success path (was stuck at IMPORTING)
 *   F2: Purchase handleOpenChange close bypass (X/Cancel/onOpenChange(false))
 *   F3: Production CAS test fidelity (test now exercises executeStockLotBulkCas)
 *   F4: 429/5xx after apply dispatch must be AMBIGUOUS_RESULT, not a simple retry
 *
 * Test strategy:
 *   - Pure helper contracts (classifyImportOutcome, shouldBlockClose,
 *     shouldRefreshHistory, getOutcomeMessage) are tested at RUNTIME.
 *   - Dialog wiring (the dialogs call the helpers on every required path) is
 *     verified via static source assertions that prove the dialog SOURCE calls
 *     the helper on the correct path. This is necessary because the dialogs are
 *     React client components and bun:test has no DOM rendering.
 *   - PostgreSQL CAS path tests (C2 strengthened, C3 added) live in
 *     tests/st75-import-postgres-production-path.test.ts and run in CI.
 *
 * Together, helper-contract + wiring-proof = behavior proof.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  classifyImportOutcome,
  shouldBlockClose,
  shouldRefreshHistory,
  getOutcomeMessage,
  type ImportSummaryLike,
} from '../src/lib/import-state-helper'

// ============ Helpers ============

function makeSummary(overrides: Partial<ImportSummaryLike> = {}): ImportSummaryLike {
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

// ============ F1: Sales terminal outcome ============

describe('ST-75 F1: Sales terminal outcome', () => {
  test('1. Sales full success: IMPORTING → SUCCESS', () => {
    // Runtime: helper classifies 2xx with all-imported as SUCCESS.
    const outcome = classifyImportOutcome(200, makeSummary({ importedCount: 5 }), false)
    expect(outcome).toBe('SUCCESS')
    // Wiring: sales dialog success path calls setImportOutcome with the classifier result.
    const src = readSellDialog()
    expect(src).toContain('const outcome = classifyImportOutcome(res.status, summary, false)')
    expect(src).toContain('setImportOutcome(outcome)')
  })

  test('2. Sales partial success: IMPORTING → PARTIAL_SUCCESS', () => {
    const outcome = classifyImportOutcome(200, makeSummary({ importedCount: 3, failedCount: 2 }), false)
    expect(outcome).toBe('PARTIAL_SUCCESS')
    // Wiring: sales dialog uses outcome for toast branching (PARTIAL_SUCCESS → warning).
    const src = readSellDialog()
    expect(src).toContain("outcome === 'PARTIAL_SUCCESS'")
  })

  test('3. Sales terminal success: shouldBlockClose = false', () => {
    // After success, outcome is SUCCESS — modal MUST be closeable.
    expect(shouldBlockClose('SUCCESS')).toBe(false)
    expect(shouldBlockClose('PARTIAL_SUCCESS')).toBe(false)
    expect(shouldBlockClose('FAILED_CONFIRMED')).toBe(false)
    // Only IMPORTING blocks close.
    expect(shouldBlockClose('IMPORTING')).toBe(true)
  })
})

// ============ F2: Purchase close bypass ============

describe('ST-75 F2: Purchase close guard', () => {
  test('4. active Purchase + X (DialogClose): close blocked', () => {
    // X button is a DialogClose which calls onOpenChange(false).
    // The guard must be in handleOpenChange itself, not just onInteractOutside/onEscapeKeyDown.
    const src = readBuyDialog()
    // handleOpenChange must check shouldBlockClose before setOpen/resetDialogState.
    expect(src).toMatch(/handleOpenChange[\s\S]*?shouldBlockClose\(importOutcome\)/)
  })

  test('5. active Purchase + Cancel (footer DialogClose): close blocked', () => {
    // Footer Cancel is also a DialogClose → onOpenChange(false) → same guard.
    const src = readBuyDialog()
    expect(src).toMatch(/handleOpenChange[\s\S]*?shouldBlockClose\(importOutcome\)/)
    // Verify the guard returns early (does NOT call setOpen or resetDialogState when blocked).
    expect(src).toContain("if (!v && shouldBlockClose(importOutcome))")
    expect(src).toContain('toast.warning')
    expect(src).toContain('return')
  })

  test('6. active Purchase + Escape: close blocked', () => {
    const src = readBuyDialog()
    // Defense in depth: onEscapeKeyDown also checks shouldBlockClose.
    expect(src).toMatch(/onEscapeKeyDown=\{\(e\) => \{ if \(shouldBlockClose\(importOutcome\)\) e\.preventDefault\(\)/)
  })

  test('7. active Purchase + outside click: close blocked', () => {
    const src = readBuyDialog()
    // Defense in depth: onInteractOutside also checks shouldBlockClose.
    expect(src).toMatch(/onInteractOutside=\{\(e\) => \{ if \(shouldBlockClose\(importOutcome\)\) e\.preventDefault\(\)/)
  })

  test('8. active Purchase + onOpenChange(false): close blocked', () => {
    // The authoritative close path. handleOpenChange must guard.
    const src = readBuyDialog()
    // Extract the handleOpenChange function body and verify the guard is BEFORE setOpen.
    const handleOpenChangeMatch = src.match(/const handleOpenChange = \(v: boolean\) => \{([\s\S]*?)\n  \};/)
    expect(handleOpenChangeMatch).not.toBeNull()
    const body = handleOpenChangeMatch![1]
    const guardIdx = body.indexOf('shouldBlockClose(importOutcome)')
    const setOpenIdx = body.indexOf('setOpen(v)')
    expect(guardIdx).toBeGreaterThan(-1)
    expect(setOpenIdx).toBeGreaterThan(-1)
    expect(guardIdx).toBeLessThan(setOpenIdx)
  })

  test('9. blocked close: no reset of active in-flight guard', () => {
    // When close is blocked, resetDialogState must NOT run (so importInFlightRef stays true).
    const src = readBuyDialog()
    // Extract handleOpenChange body: from 'const handleOpenChange' to the next '  };'
    const startIdx = src.indexOf('const handleOpenChange = (v: boolean) => {')
    expect(startIdx).toBeGreaterThan(-1)
    // Find the end of the function (next '  };' at column 2)
    const endIdx = src.indexOf('\n  };', startIdx)
    expect(endIdx).toBeGreaterThan(startIdx)
    const body = src.slice(startIdx, endIdx)
    // The guard's 'return' statement must appear BEFORE the actual resetDialogState() CALL.
    // Use 'resetDialogState();' (with semicolon) to skip comment mentions.
    const guardReturnIdx = body.indexOf('return;')
    const resetCallIdx = body.indexOf('resetDialogState();')
    expect(guardReturnIdx).toBeGreaterThan(-1)
    expect(resetCallIdx).toBeGreaterThan(-1)
    expect(guardReturnIdx).toBeLessThan(resetCallIdx)
  })

  test('10. terminal state: close/reset allowed', () => {
    // After IMPORTING transitions to a terminal state, shouldBlockClose returns false.
    expect(shouldBlockClose('SUCCESS')).toBe(false)
    expect(shouldBlockClose('PARTIAL_SUCCESS')).toBe(false)
    expect(shouldBlockClose('FAILED_CONFIRMED')).toBe(false)
    expect(shouldBlockClose('AMBIGUOUS_RESULT')).toBe(false)
    expect(shouldBlockClose('IDLE')).toBe(false)
  })
})

// ============ F4: Ambiguous result for 429/5xx after apply ============

describe('ST-75 F4: Ambiguous result for 429/5xx after apply', () => {
  test('11. Purchase 429 after apply: AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(429, null, false)).toBe('AMBIGUOUS_RESULT')
    // Wiring: purchase dialog TRANSIENT_ERROR path calls classifyImportOutcome + setImportOutcome.
    const src = readBuyDialog()
    expect(src).toMatch(/TRANSIENT_ERROR[\s\S]*?classifyImportOutcome\(res\.status, null, false\)[\s\S]*?setImportOutcome\(ambiguousOutcome\)/)
  })

  test('12. Purchase 500/502/503/504: AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(500, null, false)).toBe('AMBIGUOUS_RESULT')
    expect(classifyImportOutcome(502, null, false)).toBe('AMBIGUOUS_RESULT')
    expect(classifyImportOutcome(503, null, false)).toBe('AMBIGUOUS_RESULT')
    expect(classifyImportOutcome(504, null, false)).toBe('AMBIGUOUS_RESULT')
  })

  test('13. Sales 429: AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(429, null, false)).toBe('AMBIGUOUS_RESULT')
    // Wiring: sales dialog TRANSIENT_ERROR path calls classifyImportOutcome + setImportOutcome.
    const src = readSellDialog()
    expect(src).toMatch(/TRANSIENT_ERROR[\s\S]*?classifyImportOutcome\(res\.status, null, false\)[\s\S]*?setImportOutcome\(ambiguousOutcome\)/)
  })

  test('14. Sales 500/502/503/504: AMBIGUOUS_RESULT', () => {
    expect(classifyImportOutcome(500, null, false)).toBe('AMBIGUOUS_RESULT')
    expect(classifyImportOutcome(502, null, false)).toBe('AMBIGUOUS_RESULT')
    expect(classifyImportOutcome(503, null, false)).toBe('AMBIGUOUS_RESULT')
    expect(classifyImportOutcome(504, null, false)).toBe('AMBIGUOUS_RESULT')
  })

  test('15. ambiguous: history refresh = true', () => {
    expect(shouldRefreshHistory('AMBIGUOUS_RESULT')).toBe(true)
    // Wiring: both dialogs call shouldRefreshHistory on the TRANSIENT_ERROR path.
    const buySrc = readBuyDialog()
    const sellSrc = readSellDialog()
    expect(buySrc).toMatch(/shouldRefreshHistory\(ambiguousOutcome\)/)
    expect(sellSrc).toMatch(/shouldRefreshHistory\(ambiguousOutcome\)/)
  })

  test('16. ambiguous: no automatic retry', () => {
    // The dialogs must NOT auto-retry on ambiguous. The TRANSIENT_ERROR block must return
    // immediately after setting AMBIGUOUS_RESULT, with no setTimeout/retry loop.
    const buySrc = readBuyDialog()
    const sellSrc = readSellDialog()
    // Extract the TRANSIENT_ERROR block from each dialog and verify it returns early.
    for (const src of [buySrc, sellSrc]) {
      const transientIdx = src.indexOf("applyAction === 'TRANSIENT_ERROR'")
      expect(transientIdx).toBeGreaterThan(-1)
      // Find the next 'return;' after TRANSIENT_ERROR — must exist (early return, no retry).
      const returnAfterTransient = src.indexOf('return;', transientIdx)
      expect(returnAfterTransient).toBeGreaterThan(transientIdx)
      // Verify no 'setTimeout' between TRANSIENT_ERROR and that return.
      const block = src.slice(transientIdx, returnAfterTransient)
      expect(block).not.toContain('setTimeout')
      expect(block).not.toContain('handleImport')
    }
  })

  test('17. ambiguous: message instructs history verification before retry', () => {
    const msg = getOutcomeMessage('AMBIGUOUS_RESULT')
    // Message must mention history (ประวัติ) and instruct verification before retry.
    expect(msg).toContain('ประวัติ')
    expect(msg.toLowerCase()).not.toContain('retry')
    // Wiring: both dialogs use getOutcomeMessage on the TRANSIENT_ERROR path.
    const buySrc = readBuyDialog()
    const sellSrc = readSellDialog()
    expect(buySrc).toMatch(/TRANSIENT_ERROR[\s\S]*?getOutcomeMessage\(ambiguousOutcome\)/)
    expect(sellSrc).toMatch(/TRANSIENT_ERROR[\s\S]*?getOutcomeMessage\(ambiguousOutcome\)/)
  })
})

// ============ Auth regression (PR #79) ============

describe('ST-75: Auth regression (PR #79 semantics preserved)', () => {
  test('18. 401: SESSION_EXPIRED behavior preserved', () => {
    // classifyAuthResponse(401) === 'SESSION_EXPIRED' → handleSessionExpired clears token.
    const buySrc = readBuyDialog()
    const sellSrc = readSellDialog()
    // Both dialogs must still call handleSessionExpired on 401.
    expect(buySrc).toMatch(/SESSION_EXPIRED[\s\S]*?handleSessionExpired\(\)/)
    expect(sellSrc).toMatch(/SESSION_EXPIRED[\s\S]*?handleSessionExpired\(\)/)
    // handleSessionExpired clears the token.
    expect(buySrc).toMatch(/handleSessionExpired[\s\S]*?setAuthToken\(null\)/)
    expect(sellSrc).toMatch(/handleSessionExpired[\s\S]*?setAuthToken\(null\)/)
  })

  test('19. 403: PERMISSION_DENIED behavior preserved', () => {
    const buySrc = readBuyDialog()
    const sellSrc = readSellDialog()
    // Both dialogs must still call handlePermissionDenied on 403.
    expect(buySrc).toMatch(/PERMISSION_DENIED[\s\S]*?handlePermissionDenied\(\)/)
    expect(sellSrc).toMatch(/PERMISSION_DENIED[\s\S]*?handlePermissionDenied\(\)/)
  })

  test('20. 403: does not clear valid auth session', () => {
    // handlePermissionDenied must NOT call setAuthToken(null).
    const buySrc = readBuyDialog()
    const sellSrc = readSellDialog()
    // Extract handlePermissionDenied body from both dialogs.
    const buyMatch = buySrc.match(/handlePermissionDenied = \(\) => \{([\s\S]*?)\n  \};/)
    const sellMatch = sellSrc.match(/handlePermissionDenied = \(\) => \{([\s\S]*?)\n  \};/)
    expect(buyMatch).not.toBeNull()
    expect(sellMatch).not.toBeNull()
    expect(buyMatch![1]).not.toContain('setAuthToken(null)')
    expect(sellMatch![1]).not.toContain('setAuthToken(null)')
  })
})

// ============ Double submit guard ============

describe('ST-75: Double submit guard', () => {
  test('21. rapid Purchase double submit: one active request', () => {
    const src = readBuyDialog()
    // handleImport must check importInFlightRef.current at the start and return early.
    expect(src).toMatch(/if \(importInFlightRef\.current\) return/)
    // The ref is set true synchronously before any await.
    expect(src).toMatch(/importInFlightRef\.current = true[\s\S]*?await fetch/)
    // The ref is cleared in finally AFTER the fetch completes.
    expect(src).toMatch(/finally \{[\s\S]*?importInFlightRef\.current = false/)
  })

  test('22. rapid Sales double submit: one active request', () => {
    const src = readSellDialog()
    expect(src).toMatch(/if \(importInFlightRef\.current\) return/)
    expect(src).toMatch(/importInFlightRef\.current = true[\s\S]*?await fetch/)
    expect(src).toMatch(/finally \{[\s\S]*?importInFlightRef\.current = false/)
  })
})

// ============ Pre-dispatch early returns must not stay IMPORTING ============

describe('ST-75: Pre-dispatch early returns reset outcome', () => {
  test('Purchase: no-token + no-bills paths set IDLE (not stuck IMPORTING)', () => {
    const src = readBuyDialog()
    // Find the handleImport function body and check the no-token + no-bills paths inside it.
    const handleImportStart = src.indexOf('const handleImport = async () => {')
    expect(handleImportStart).toBeGreaterThan(-1)
    const handleImportEnd = src.indexOf('\n  };', handleImportStart)
    const handleImportBody = src.slice(handleImportStart, handleImportEnd)
    // The no-token path inside handleImport must set IDLE.
    const noTokenIdx = handleImportBody.indexOf('if (!token) {')
    expect(noTokenIdx).toBeGreaterThan(-1)
    const noTokenBlock = handleImportBody.slice(noTokenIdx, handleImportBody.indexOf('}', noTokenIdx + 20))
    expect(noTokenBlock).toContain("setImportOutcome('IDLE')")
    // The no-bills path inside handleImport must set IDLE.
    const noBillsIdx = handleImportBody.indexOf('if (billsToApply.length === 0) {')
    expect(noBillsIdx).toBeGreaterThan(-1)
    const noBillsBlock = handleImportBody.slice(noBillsIdx, handleImportBody.indexOf('}', noBillsIdx + 30))
    expect(noBillsBlock).toContain("setImportOutcome('IDLE')")
  })

  test('Sales: no-token + no-bills paths set IDLE (not stuck IMPORTING)', () => {
    const src = readSellDialog()
    const handleImportStart = src.indexOf('const handleImport = async () => {')
    expect(handleImportStart).toBeGreaterThan(-1)
    const handleImportEnd = src.indexOf('\n  };', handleImportStart)
    const handleImportBody = src.slice(handleImportStart, handleImportEnd)
    const noTokenIdx = handleImportBody.indexOf('if (!token) {')
    expect(noTokenIdx).toBeGreaterThan(-1)
    const noTokenBlock = handleImportBody.slice(noTokenIdx, handleImportBody.indexOf('}', noTokenIdx + 20))
    expect(noTokenBlock).toContain("setImportOutcome('IDLE')")
    const noBillsIdx = handleImportBody.indexOf('if (billsToApply.length === 0) {')
    expect(noBillsIdx).toBeGreaterThan(-1)
    const noBillsBlock = handleImportBody.slice(noBillsIdx, handleImportBody.indexOf('}', noBillsIdx + 30))
    expect(noBillsBlock).toContain("setImportOutcome('IDLE')")
  })
})

// ============ F3: Production CAS path exercised (wiring proof) ============
// Runtime CAS behavior tests (C2 strengthened, C3 added) live in
// tests/st75-import-postgres-production-path.test.ts and run in CI PostgreSQL.

describe('ST-75 F3: Production CAS path wiring', () => {
  test('23. test imports executeStockLotBulkCas (not a local reimplementation)', () => {
    const testSrc = readFileSync(
      join(process.cwd(), 'tests/st75-import-postgres-production-path.test.ts'),
      'utf8',
    )
    expect(testSrc).toContain("import { executeStockLotBulkCas } from '../src/lib/stock-lot-bulk-cas'")
    // The test must call executeStockLotBulkCas with prismaTx.$queryRaw, matching production.
    expect(testSrc).toMatch(/executeStockLotBulkCas\([\s\S]*?prismaTx\.\$queryRaw/)
    // The test must NOT contain a local loop of prismaTx.stockLot.update for bulkUpdate.
    expect(testSrc).not.toMatch(/bulkUpdateStockLotRemaining[\s\S]*?for \(.*?\) \{[\s\S]*?prismaTx\.stockLot\.update/)
  })

  test('24. C2 test verifies single stock deduction (runtime — CI)', () => {
    // This is a wiring proof that C2 has exact per-product deduction assertions.
    const testSrc = readFileSync(
      join(process.cwd(), 'tests/st75-import-postgres-production-path.test.ts'),
      'utf8',
    )
    expect(testSrc).toContain('remainingByProduct.get(products[0])')
    expect(testSrc).toContain('100000 - 10')
    expect(testSrc).toContain('100000 - 11')
    expect(testSrc).toContain('100000 - 12')
  })

  test('25. C3 test verifies CAS conflict → exactly one business effect (runtime — CI)', () => {
    const testSrc = readFileSync(
      join(process.cwd(), 'tests/st75-import-postgres-production-path.test.ts'),
      'utf8',
    )
    expect(testSrc).toMatch(/C3\. CAS conflict on concurrent Sales/)
    expect(testSrc).toMatch(/expect\(totalImported\)\.toBe\(1\)/)
    expect(testSrc).toMatch(/expect\(totalFailed\)\.toBe\(1\)/)
    expect(testSrc).toMatch(/expect\(dbBills\.length\)\.toBe\(1\)/)
    // Stock must be exactly 0 (deducted once, not twice).
    expect(testSrc).toMatch(/expect\(lot\?\.remainingWeight\)\.toBe\(0\)/)
  })

  test('26. C3 test isolates CAS failure cause from billNumber collision (P2-A)', () => {
    // P2-A: The C3 test MUST give distinct deterministic internal billNumbers so the
    // loser cannot fail from billNumber unique-constraint collision — only from CAS.
    const testSrc = readFileSync(
      join(process.cwd(), 'tests/st75-import-postgres-production-path.test.ts'),
      'utf8',
    )
    // Both services use distinct billNumberOverride via separate deps instances.
    expect(testSrc).toContain('sellBillNumberOverride')
    expect(testSrc).toMatch(/billNumberA = `SELL-2569-900001`/)
    expect(testSrc).toMatch(/billNumberB = `SELL-2569-900002`/)
    // ST-75 P2-13: deps now include stockCheckBarrierFn (function, not Promise).
    expect(testSrc).toContain('stockCheckBarrierFn')
    expect(testSrc).toMatch(/depsA = makeTestImportDeps\(db, \{[\s\S]*?sellBillNumberOverride: billNumberA/)
    expect(testSrc).toMatch(/depsB = makeTestImportDeps\(db, \{[\s\S]*?sellBillNumberOverride: billNumberB/)
    // Loser errorCode MUST be SOURCE_LOT_CONFLICT (CAS), not BILL_CREATE_FAILED.
    expect(testSrc).toMatch(/loser!\.failedBills\[0\]\.errorCode\)\.toBe\('SOURCE_LOT_CONFLICT'\)/)
    // Loser's billNumber MUST NOT exist in DB (rollback proof).
    expect(testSrc).toMatch(/loserBillCount\)\.toBe\(0\)/)
    // Loser's SellBill MUST NOT be committed.
    expect(testSrc).toMatch(/loserBill\)\.toBeNull\(\)/)
  })
})

// ============ P2-B: Real server-backed refresh callback ============

describe('ST-75 P2-B: Real server-backed refresh callback', () => {
  test('27. Purchase dialog declares onRefreshAfterImport prop', () => {
    const src = readBuyDialog()
    expect(src).toContain('onRefreshAfterImport')
    expect(src).toMatch(/onRefreshAfterImport\?: \(\) => void \| Promise<void>/)
  })

  test('28. Sales dialog declares onRefreshAfterImport prop', () => {
    const src = readSellDialog()
    expect(src).toContain('onRefreshAfterImport')
    expect(src).toMatch(/onRefreshAfterImport\?: \(\) => void \| Promise<void>/)
  })

  test('29. Purchase success path calls runTrackedRefresh (not onImport([]))', () => {
    const src = readBuyDialog()
    // ST-75 P2-11: success path now uses runTrackedRefresh instead of direct onRefreshAfterImport
    const refreshBlockMatch = src.match(/if \(shouldRefreshHistory\(outcome\)\) \{([\s\S]*?)\n      \}/)
    expect(refreshBlockMatch).not.toBeNull()
    const block = refreshBlockMatch![1]
    expect(block).toContain('runTrackedRefresh()')
    expect(block).not.toContain('onImport?.([])')
  })

  test('30. Sales success path calls runTrackedRefresh (not onImport([]))', () => {
    const src = readSellDialog()
    const refreshBlockMatch = src.match(/if \(shouldRefreshHistory\(outcome\)\) \{([\s\S]*?)\n      \}/)
    expect(refreshBlockMatch).not.toBeNull()
    const block = refreshBlockMatch![1]
    expect(block).toContain('runTrackedRefresh()')
    expect(block).not.toContain('onImport?.([])')
  })

  test('31. Purchase 429/5xx path calls scheduleAmbiguousImportRefresh (not onImport([]))', () => {
    const src = readBuyDialog()
    const transientIdx = src.indexOf("applyAction === 'TRANSIENT_ERROR'")
    expect(transientIdx).toBeGreaterThan(-1)
    const blockEnd = src.indexOf('return;', transientIdx)
    const block = src.slice(transientIdx, blockEnd)
    // ST-75 P2-A: TRANSIENT_ERROR now uses bounded delayed reconciliation
    // instead of a single immediate onRefreshAfterImport call.
    expect(block).toContain('scheduleAmbiguousImportRefresh()')
    expect(block).not.toContain('onImport?.([])')
    expect(block).not.toContain('onRefreshAfterImport?.()')
  })

  test('32. Sales 429/5xx path calls scheduleAmbiguousImportRefresh (not onImport([]))', () => {
    const src = readSellDialog()
    const transientIdx = src.indexOf("applyAction === 'TRANSIENT_ERROR'")
    expect(transientIdx).toBeGreaterThan(-1)
    const blockEnd = src.indexOf('return;', transientIdx)
    const block = src.slice(transientIdx, blockEnd)
    expect(block).toContain('scheduleAmbiguousImportRefresh()')
    expect(block).not.toContain('onImport?.([])')
    expect(block).not.toContain('onRefreshAfterImport?.()')
  })

  test('33. Purchase network-error catch calls scheduleAmbiguousImportRefresh', () => {
    const src = readBuyDialog()
    // ST-75 P2-A: catch block now invokes scheduleAmbiguousImportRefresh
    // (bounded delayed reconciliation) instead of a single immediate call.
    expect(src).toMatch(/catch \(err\) \{[\s\S]*?shouldRefreshHistory\(outcome\)[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
  })

  test('34. Sales network-error catch calls scheduleAmbiguousImportRefresh', () => {
    const src = readSellDialog()
    // ST-75 P2-A: catch block now invokes scheduleAmbiguousImportRefresh.
    expect(src).toMatch(/catch \(err\) \{[\s\S]*?shouldRefreshHistory\(outcome\)[\s\S]*?scheduleAmbiguousImportRefresh\(\)/)
  })

  test('35. Buy page wires onRefreshAfterImport to real server fetch', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/buy-page.tsx'),
      'utf8',
    )
    // Parent must define a real server-backed load function and pass it as onRefreshAfterImport.
    expect(src).toMatch(/async function loadProducts\(\)/)
    expect(src).toMatch(/fetchProducts\(\)/)
    expect(src).toContain('onRefreshAfterImport={loadProducts}')
  })

  test('36. Sell page wires onRefreshAfterImport to product-only refresh (P2-25)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/sell-page.tsx'),
      'utf8',
    )
    expect(src).toMatch(/async function loadData\(\)/)
    // ST-75 P2-25: onRefreshAfterImport uses refreshProductsAfterImport,
    // NOT loadData (which waits for customers too).
    expect(src).toMatch(/async function refreshProductsAfterImport\(\)/)
    expect(src).toContain('onRefreshAfterImport={refreshProductsAfterImport}')
    // refreshProductsAfterImport must only call fetchProducts, not fetchCustomers.
    const refreshFnMatch = src.match(/async function refreshProductsAfterImport\(\) \{([\s\S]*?)\n  \}/)
    expect(refreshFnMatch).not.toBeNull()
    expect(refreshFnMatch![1]).toContain('fetchProducts')
    expect(refreshFnMatch![1]).not.toContain('fetchCustomers')
  })

  test('37. Buy page loadProducts is callable (not inline useEffect closure)', () => {
    // P2-B: The refresh function must be a top-level component function (callable from
    // event handlers), not a closure inside useEffect that can't be re-invoked.
    const src = readFileSync(
      join(process.cwd(), 'src/components/buy-page.tsx'),
      'utf8',
    )
    // The function declaration must NOT be inside useEffect.
    const useEffectIdx = src.indexOf('useEffect(() => {')
    const loadFnIdx = src.indexOf('async function loadProducts()')
    expect(useEffectIdx).toBeGreaterThan(-1)
    expect(loadFnIdx).toBeGreaterThan(-1)
    // The loadProducts function must come AFTER the useEffect block (extracted out).
    expect(loadFnIdx).toBeGreaterThan(useEffectIdx)
    // useEffect must call loadProducts() rather than define its own closure.
    const useEffectBlock = src.slice(useEffectIdx, src.indexOf('}, []);', useEffectIdx) + 8)
    expect(useEffectBlock).toContain('loadProducts()')
  })

  test('38. Sell page loadData is callable (not inline useEffect closure)', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/components/sell-page.tsx'),
      'utf8',
    )
    const useEffectIdx = src.indexOf('useEffect(() => {')
    const loadFnIdx = src.indexOf('async function loadData()')
    expect(useEffectIdx).toBeGreaterThan(-1)
    expect(loadFnIdx).toBeGreaterThan(-1)
    expect(loadFnIdx).toBeGreaterThan(useEffectIdx)
    const useEffectBlock = src.slice(useEffectIdx, src.indexOf('}, []);', useEffectIdx) + 8)
    expect(useEffectBlock).toContain('loadData()')
  })
})
