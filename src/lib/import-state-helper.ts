/**
 * ST-75 Phase 2: Import state classifier — pure function for testing.
 *
 * Classifies the import outcome into actionable UI states.
 * Used by both purchase and sales import dialogs.
 */

export type ImportOutcomeState =
  | 'IDLE'
  | 'PREVIEW_READY'
  | 'IMPORTING'
  | 'SUCCESS'
  | 'PARTIAL_SUCCESS'
  | 'FAILED_CONFIRMED'
  | 'AMBIGUOUS_RESULT';

export interface ImportSummaryLike {
  importedCount: number;
  duplicateExistingCount: number;
  duplicateInFileCount: number;
  invalidCount: number;
  unmatchedCount: number;
  insufficientStockCount: number;
  failedCount: number;
}

/**
 * ST-75 P2-B: Runtime-validate an unknown parsed JSON value as a structurally
 * valid ImportSummaryLike. Every required counter MUST be a finite, non-negative
 * integer. A truthy-but-malformed 2xx summary (e.g., `importedCount: 5,
 * failedCount: undefined`) previously produced NaN arithmetic that fell through
 * to FAILED_CONFIRMED — wrongly claiming "nothing saved" even though the request
 * may have committed bills. This validator blocks that fall-through: callers
 * MUST treat an invalid 2xx summary as AMBIGUOUS_RESULT.
 */
export function isValidImportSummary(summary: unknown): summary is ImportSummaryLike {
  if (typeof summary !== 'object' || summary === null) return false;
  const s = summary as Record<string, unknown>;
  const requiredCounters: Array<keyof ImportSummaryLike> = [
    'importedCount',
    'duplicateExistingCount',
    'duplicateInFileCount',
    'invalidCount',
    'unmatchedCount',
    'insufficientStockCount',
    'failedCount',
  ];
  for (const key of requiredCounters) {
    const v = s[key];
    // Must be a number, finite (not NaN/Infinity), and non-negative integer.
    if (typeof v !== 'number') return false;
    if (!Number.isFinite(v)) return false;
    if (!Number.isInteger(v)) return false;
    if (v < 0) return false;
  }
  return true;
}

/**
 * Classify the outcome of an import apply request.
 *
 * @param httpStatus - HTTP status from /api/import/apply
 * @param summary - parsed ImportSummary (null if not parseable)
 * @param networkError - true if fetch threw (network/abort), false if response received
 * @returns ImportOutcomeState
 */
export function classifyImportOutcome(
  httpStatus: number | null,
  summary: ImportSummaryLike | null,
  networkError: boolean
): ImportOutcomeState {
  // Network error after request was sent → ambiguous (server may have committed)
  if (networkError) return 'AMBIGUOUS_RESULT';

  // No response received (shouldn't happen, but defensive)
  if (httpStatus === null) return 'AMBIGUOUS_RESULT';

  // HTTP success — classify based on summary
  if (httpStatus >= 200 && httpStatus < 300) {
    // ST-75 P2-B: A null OR structurally-invalid 2xx summary MUST be AMBIGUOUS_RESULT.
    // The request returned 2xx, so the server MAY have committed bills — we cannot
    // safely claim "nothing saved" (FAILED_CONFIRMED) from an unparseable/invalid body.
    if (!summary || !isValidImportSummary(summary)) {
      return 'AMBIGUOUS_RESULT';
    }

    // At this point, summary is validated — all counters are finite non-negative integers.
    const totalNonSuccess = summary.failedCount + summary.duplicateExistingCount +
      summary.duplicateInFileCount + summary.invalidCount + summary.unmatchedCount +
      summary.insufficientStockCount;

    if (summary.importedCount > 0 && totalNonSuccess === 0) {
      return 'SUCCESS';
    }
    if (summary.importedCount > 0 && totalNonSuccess > 0) {
      return 'PARTIAL_SUCCESS';
    }
    // importedCount === 0 — all bills failed/skipped
    return 'FAILED_CONFIRMED';
  }

  // Non-2xx HTTP — but was it a server error (ambiguous) or confirmed failure?
  // 400 = client error (bad request) → confirmed failure, no commit
  // 401/403 = auth → handled by classifier, not here
  // 429/5xx = server error → ambiguous (server may have partially committed)
  if (httpStatus === 429 || httpStatus >= 500) {
    return 'AMBIGUOUS_RESULT';
  }

  // 400, 404, etc. — confirmed failure, no commit
  return 'FAILED_CONFIRMED';
}

/**
 * ST-75: Should the dialog close be blocked?
 * Only block during IMPORTING state.
 */
export function shouldBlockClose(outcome: ImportOutcomeState): boolean {
  return outcome === 'IMPORTING';
}

/**
 * ST-75: Should history be refreshed?
 * After any state that may have committed bills.
 */
export function shouldRefreshHistory(outcome: ImportOutcomeState): boolean {
  return outcome === 'SUCCESS' || outcome === 'PARTIAL_SUCCESS' || outcome === 'AMBIGUOUS_RESULT';
}

/**
 * ST-75: Get user-safe message for outcome state.
 */
export function getOutcomeMessage(outcome: ImportOutcomeState): string {
  switch (outcome) {
    case 'SUCCESS':
      return 'นำเข้าสำเร็จทั้งหมด';
    case 'PARTIAL_SUCCESS':
      return 'นำเข้าสำเร็จบางส่วน — กรุณาตรวจสรุปผล';
    case 'FAILED_CONFIRMED':
      return 'นำเข้าไม่สำเร็จ — ไม่มีบิลถูกบันทึก';
    case 'AMBIGUOUS_RESULT':
      return 'ไม่สามารถยืนยันผลการนำเข้าได้ บางบิลอาจถูกบันทึกแล้ว กรุณาตรวจหน้าประวัติก่อนลองนำเข้าไฟล์เดิมอีกครั้ง';
    default:
      return '';
  }
}
