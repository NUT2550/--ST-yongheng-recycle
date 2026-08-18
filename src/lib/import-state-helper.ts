/**
 * ST-75 Phase 2: Import state classifier — pure function for testing.
 *
 * Classifies the import outcome into actionable UI states.
 * Used by both purchase and sales import dialogs.
 *
 * ST-75 P2-21 Import Reliability Contract:
 *   When a concurrent import commits a bill and the losing batch's post-failure
 *   reconciliation finds it as DUPLICATE_EXISTING (duplicateExistingCount > 0),
 *   the losing batch has importedCount=0 but stock WAS deducted by the winner.
 *   classifyImportOutcome returns PARTIAL_SUCCESS (not FAILED_CONFIRMED) so
 *   shouldRefreshHistory returns true and the authoritative refresh runs,
 *   ensuring the UI shows the updated post-race stock.
 *
 *   Only duplicateExistingCount triggers this (proves a concurrent commit).
 *   duplicateInFileCount (same file, no concurrent race) does NOT trigger it —
 *   those remain FAILED_CONFIRMED because no concurrent winner deducted stock.
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
  // ST-75 P2-B2: Required result arrays. isValidImportSummary validates these
  // are present as arrays — a 2xx body missing them would cause
  // `applyResult.failedBills.length` to throw at render time.
  importedBills: unknown[];
  skippedDuplicateBills: unknown[];
  failedBills: unknown[];
}

/**
 * ST-75 P2-B: Runtime-validate an unknown parsed JSON value as a structurally
 * valid ImportSummaryLike. Every required counter MUST be a finite, non-negative
 * integer. A truthy-but-malformed 2xx summary (e.g., `importedCount: 5,
 * failedCount: undefined`) previously produced NaN arithmetic that fell through
 * to FAILED_CONFIRMED — wrongly claiming "nothing saved" even though the request
 * may have committed bills. This validator blocks that fall-through: callers
 * MUST treat an invalid 2xx summary as AMBIGUOUS_RESULT.
 *
 * ST-75 P2-B2: Also validates that the required result arrays
 * (`importedBills`, `skippedDuplicateBills`, `failedBills`) are present as
 * arrays. Without this, a 2xx body with valid counters but missing arrays
 * would pass validation, then both dialogs would access
 * `applyResult.failedBills.length` at render time → runtime exception.
 *
 * ST-75 P2-3: Also validates each result-array element via
 * `isValidBillImportResult`. A `failedBills: [null]` or `[42]` would crash
 * the UI's `b.externalBillNumber` access. Invalid element → whole summary
 * invalid → AMBIGUOUS_RESULT.
 *
 * ST-75 P2-4: Counter/array consistency uses the PRODUCTION grouping contract
 * from `buildImportSummary`:
 *   - importedBills.length === importedCount
 *   - skippedDuplicateBills.length === duplicateExistingCount + duplicateInFileCount
 *   - failedBills.length === invalidCount + unmatchedCount + insufficientStockCount + failedCount
 * The prior P2-B3 check used `failedCount === failedBills.length` which is
 * WRONG — failedBills aggregates 4 failure statuses, not just failedCount.
 */

/** Valid BillClassification values (must match production type). */
const VALID_BILL_STATUSES = new Set([
  'READY',
  'DUPLICATE_EXISTING',
  'DUPLICATE_IN_FILE',
  'INVALID',
  'UNMATCHED_PRODUCT',
  'INSUFFICIENT_STOCK',
  'FAILED',
]);

/**
 * ST-75 P2-3: Runtime-validate a single result-array element as a structurally
 * valid BillImportResult. The UI accesses `externalBillNumber` and `status`
 * on each element, so these MUST be present with the correct types.
 * Does NOT enforce optional fields (billNumber, billId, error, errorCode)
 * because legitimate server responses may omit them depending on status.
 */
export function isValidBillImportResult(element: unknown): boolean {
  if (typeof element !== 'object' || element === null) return false;
  const e = element as Record<string, unknown>;
  // externalBillNumber is accessed by UI render (applyResult.failedBills.map).
  if (typeof e.externalBillNumber !== 'string') return false;
  // normalizedBillNumber is used by the pipeline and UI.
  if (typeof e.normalizedBillNumber !== 'string') return false;
  // status must be one of the valid BillClassification values.
  if (typeof e.status !== 'string' || !VALID_BILL_STATUSES.has(e.status)) return false;
  // Optional fields: if present, must be correct types.
  if (e.billNumber !== undefined && typeof e.billNumber !== 'string') return false;
  if (e.billId !== undefined && typeof e.billId !== 'string') return false;
  if (e.error !== undefined && typeof e.error !== 'string') return false;
  if (e.errorCode !== undefined && typeof e.errorCode !== 'string') return false;
  // ST-75 P2-26: reconciledAfterFailure is optional. If present, must be boolean.
  if (e.reconciledAfterFailure !== undefined && typeof e.reconciledAfterFailure !== 'boolean') return false;
  // ST-75 P2-28: reconciledAfterFailure: true is only valid on DUPLICATE_EXISTING
  // status — it marks duplicates confirmed by post-failure reconciliation.
  // A DUPLICATE_IN_FILE or any other status with this flag is structurally
  // impossible in production and indicates a malformed response.
  if (e.reconciledAfterFailure === true && e.status !== 'DUPLICATE_EXISTING') return false;
  return true;
}

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
  // ST-75 P2-B2: Validate required result arrays are present as arrays.
  const requiredArrays = ['importedBills', 'skippedDuplicateBills', 'failedBills'];
  for (const key of requiredArrays) {
    if (!Array.isArray(s[key])) return false;
  }
  const importedBills = s['importedBills'] as unknown[];
  const skippedDuplicateBills = s['skippedDuplicateBills'] as unknown[];
  const failedBills = s['failedBills'] as unknown[];
  // ST-75 P2-3: Validate each result-array element as a valid BillImportResult.
  for (const bill of importedBills) {
    if (!isValidBillImportResult(bill)) return false;
  }
  for (const bill of skippedDuplicateBills) {
    if (!isValidBillImportResult(bill)) return false;
  }
  for (const bill of failedBills) {
    if (!isValidBillImportResult(bill)) return false;
  }
  // ST-75 P2-4: Counter/array consistency using PRODUCTION grouping contract
  // from buildImportSummary:
  //   importedBills ← status 'READY' (1:1 with importedCount)
  //   skippedDuplicateBills ← 'DUPLICATE_EXISTING' + 'DUPLICATE_IN_FILE'
  //   failedBills ← 'INVALID' + 'UNMATCHED_PRODUCT' + 'INSUFFICIENT_STOCK' + 'FAILED'
  // ST-75 P2-6: Also verify per-element status matches its group.
  // ST-75 P2-9: Count each individual status separately and match to its
  // corresponding counter — not just group aggregates. This catches cross-status
  // swaps like duplicateExistingCount: 1 with a DUPLICATE_IN_FILE element.
  const IMPORTED_STATUSES = new Set(['READY']);
  const DUPLICATE_STATUSES = new Set(['DUPLICATE_EXISTING', 'DUPLICATE_IN_FILE']);
  const FAILURE_STATUSES = new Set(['INVALID', 'UNMATCHED_PRODUCT', 'INSUFFICIENT_STOCK', 'FAILED']);
  const statusCounts: Record<string, number> = {};
  for (const bill of importedBills) {
    const status = (bill as Record<string, unknown>).status;
    if (typeof status !== 'string' || !IMPORTED_STATUSES.has(status)) return false;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  for (const bill of skippedDuplicateBills) {
    const status = (bill as Record<string, unknown>).status;
    if (typeof status !== 'string' || !DUPLICATE_STATUSES.has(status)) return false;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  for (const bill of failedBills) {
    const status = (bill as Record<string, unknown>).status;
    if (typeof status !== 'string' || !FAILURE_STATUSES.has(status)) return false;
    statusCounts[status] = (statusCounts[status] ?? 0) + 1;
  }
  const importedCount = s.importedCount as number;
  const duplicateExistingCount = s.duplicateExistingCount as number;
  const duplicateInFileCount = s.duplicateInFileCount as number;
  const invalidCount = s.invalidCount as number;
  const unmatchedCount = s.unmatchedCount as number;
  const insufficientStockCount = s.insufficientStockCount as number;
  const failedCount = s.failedCount as number;
  // Per-status counter checks (P2-9)
  if ((statusCounts['READY'] ?? 0) !== importedCount) return false;
  if ((statusCounts['DUPLICATE_EXISTING'] ?? 0) !== duplicateExistingCount) return false;
  if ((statusCounts['DUPLICATE_IN_FILE'] ?? 0) !== duplicateInFileCount) return false;
  if ((statusCounts['INVALID'] ?? 0) !== invalidCount) return false;
  if ((statusCounts['UNMATCHED_PRODUCT'] ?? 0) !== unmatchedCount) return false;
  if ((statusCounts['INSUFFICIENT_STOCK'] ?? 0) !== insufficientStockCount) return false;
  if ((statusCounts['FAILED'] ?? 0) !== failedCount) return false;
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
    // ST-75 P2-26: importedCount === 0. Check if any duplicate was confirmed
    // by post-failure reconciliation (reconciledAfterFailure: true). Only
    // reconciled duplicates prove a concurrent winner may have committed and
    // deducted stock. Ordinary pre-existing duplicates (found in initial lookup)
    // do NOT prove a concurrent commit and should remain FAILED_CONFIRMED.
    const skippedBills = summary.skippedDuplicateBills as unknown as Array<{
      reconciledAfterFailure?: boolean;
    }>;
    const hasReconciledAfterFailure = skippedBills.some(
      (b) => b.reconciledAfterFailure === true
    );
    if (summary.importedCount === 0 && hasReconciledAfterFailure) {
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
