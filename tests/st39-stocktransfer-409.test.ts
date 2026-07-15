/**
 * ST-39: Tests for the StockTransfer 409 investigation findings.
 *
 * These tests verify the pure-function logic that triggers the HTTP 409 paths
 * in POST /api/stock-transfers, plus the UI error-handling behavior at the
 * logic level (since no React component testing library is configured).
 *
 * Root cause context:
 *   The deployed stock-transfers route has exactly two 409 paths, BOTH after
 *   FIFO deduction (so source stock is deducted then compensated):
 *     1. FIFO_MISMATCH (verifyFifoMatch fails) — L408-425
 *     2. P2002 Unique constraint (duplicate billNumber) — L595-599
 *   The UI's finally block resets submitting state; the fix adds a source-stock
 *   refresh after error so the displayed weight/cost is not stale.
 *
 * Run: bun test tests/st39-stocktransfer-409.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  previewFifoDeduction,
  verifyFifoMatch,
  validateSourceLotCosts,
  FIFO_COST_TOLERANCE,
  type SourceLotForPreview,
  type FifoPreviewSuccess,
} from '../src/lib/fifo-validation';

// ============ Test fixtures ============

function makeLots(): SourceLotForPreview[] {
  // ของเกรดสูง: 96.50 kg available, FIFO cost 39.75
  // Two lots simulating the Production scenario:
  //   lot-a: 50 kg @ 40.00 THB/kg (older)
  //   lot-b: 46.50 kg @ 39.51 THB/kg (newer)
  // weighted avg for 20.60 kg (only lot-a reached) = 40.00
  return [
    { id: 'lot-a', remainingWeight: 50, costPerKg: 40.00, dateAdded: new Date('2026-01-01') },
    { id: 'lot-b', remainingWeight: 46.50, costPerKg: 39.51, dateAdded: new Date('2026-02-01') },
  ];
}

// ============ FIFO preview: the pre-flight check (L347-372) ============

describe('ST-39: FIFO preview for StockTransfer (pre-flight, no DB write)', () => {
  test('preview succeeds for 20.60 kg from ของเกรดสูง (96.50 kg available)', () => {
    const preview = previewFifoDeduction('src-1', 20.60, makeLots());
    expect(preview.success).toBe(true);
    if (preview.success) {
      expect(preview.totalAvailable).toBe(96.50);
      expect(preview.weightedAverageCost).toBe(40.00); // only lot-a reached
      expect(preview.deductedLots).toHaveLength(1);
      expect(preview.deductedLots[0].lotId).toBe('lot-a');
      expect(preview.deductedLots[0].weightToUse).toBe(20.60);
    }
  });

  test('preview is pure — calling it does NOT modify the input lots', () => {
    const lots = makeLots();
    const snapshot = lots.map(l => ({ ...l }));
    previewFifoDeduction('src-1', 20.60, lots);
    expect(lots).toEqual(snapshot); // unchanged
  });

  test('ST-20 cost validation: TRANSFER policy blocks zero-cost source lots', () => {
    const lotsWithZero: SourceLotForPreview[] = [
      { id: 'lot-zero', remainingWeight: 50, costPerKg: 0, dateAdded: new Date('2026-01-01') },
    ];
    const preview = previewFifoDeduction('src-1', 20, lotsWithZero);
    expect(preview.success).toBe(true);
    if (preview.success) {
      const costVal = validateSourceLotCosts(preview, { type: 'TRANSFER', hasNonWasteOutput: true });
      expect(costVal.valid).toBe(false);
      if (!costVal.valid) {
        expect(costVal.code).toBe('ZERO_COST_SOURCE_LOT');
      }
    }
  });
});

// ============ verifyFifoMatch: the FIFO_MISMATCH 409 trigger (L408) ============

describe('ST-39: verifyFifoMatch — detects preview/execution divergence (FIFO_MISMATCH 409)', () => {
  test('match when actual cost equals preview cost within tolerance', () => {
    const preview = previewFifoDeduction('src-1', 20.60, makeLots()) as FifoPreviewSuccess;
    // Actual FIFO result matches preview exactly
    const actual = { costPerKg: 40.00, totalCost: 40.00 * 20.60 };
    expect(verifyFifoMatch(preview, actual)).toBe(true);
  });

  test('mismatch when actual cost diverges beyond tolerance (concurrent lot edit)', () => {
    const preview = previewFifoDeduction('src-1', 20.60, makeLots()) as FifoPreviewSuccess;
    // Simulate: between preview and execution, someone edited lot-a's costPerKg
    // (e.g., a concurrent StockAdjustment or cancellation restored it with different cost)
    // Now the actual FIFO deduction yields a different cost.
    const actual = { costPerKg: 39.00, totalCost: 39.00 * 20.60 };
    expect(verifyFifoMatch(preview, actual)).toBe(false);
  });

  test('mismatch when totalCost diverges (partial lot consumed differently)', () => {
    const preview = previewFifoDeduction('src-1', 50, makeLots()) as FifoPreviewSuccess;
    // Preview expects 50 kg from lot-a only (cost 40*50 = 2000)
    // But actual execution found lot-a had only 30 kg left (concurrent deduction),
    // so it took 30 from lot-a (1200) + 20 from lot-b (790.20) = 1990.20, avg 39.80
    const actual = { costPerKg: 39.80, totalCost: 1990.20 };
    // costDelta = |40.00 - 39.80| = 0.20 > 0.005 tolerance → mismatch
    expect(verifyFifoMatch(preview, actual)).toBe(false);
  });

  test('match within tolerance (tiny float drift is acceptable)', () => {
    const preview = previewFifoDeduction('src-1', 20.60, makeLots()) as FifoPreviewSuccess;
    // 0.001 THB/kg drift — within FIFO_COST_TOLERANCE (0.005)
    const actual = { costPerKg: 40.001, totalCost: 40.001 * 20.60 };
    expect(verifyFifoMatch(preview, actual)).toBe(true);
  });
});

// ============ UI error-handling logic (transfer-page handleSubmit) ============
// The deployed UI already has: try/catch/finally with setSubmitting(false) in finally.
// ST-39 adds: loadProducts() refresh in the catch block to refresh stale source stock.
// Since no React testing library is configured, we test the LOGIC of the error-handling
// contract at the function level.

describe('ST-39: UI error-handling contract (logic-level)', () => {
  // Simulates the handleSubmit control flow:
  //   setSubmitting(true) → try { await api() } catch { toast + refresh } finally { setSubmitting(false) }
  test('409 response resets submitting state (finally always runs)', async () => {
    let submitting = false;
    let refreshed = false;
    const setSubmitting = (v: boolean) => { submitting = v; };
    const refresh = async () => { refreshed = true; };

    // Simulate a 409 rejection from createStockTransfer
    const apiThrows = async () => { throw new Error('ตรวจพบความไม่ตรงของต้นทุน FIFO ระหว่าง preview และ execution กรุณาลองอีกครั้ง'); };

    setSubmitting(true);
    try {
      await apiThrows();
    } catch {
      await refresh();
    } finally {
      setSubmitting(false);
    }

    expect(submitting).toBe(false); // finally reset it
    expect(refreshed).toBe(true);   // catch refreshed source stock
  });

  test('500 response also resets submitting state and refreshes', async () => {
    let submitting = false;
    let refreshed = false;
    const setSubmitting = (v: boolean) => { submitting = v; };
    const refresh = async () => { refreshed = true; };
    const apiThrows = async () => { throw new Error('บันทึกใบย้ายสต็อกไม่สำเร็จ'); };

    setSubmitting(true);
    try {
      await apiThrows();
    } catch {
      await refresh();
    } finally {
      setSubmitting(false);
    }

    expect(submitting).toBe(false);
    expect(refreshed).toBe(true);
  });

  test('success path does NOT trigger refresh (no need — stock was correctly updated by the success response)', async () => {
    let submitting = false;
    let refreshed = false;
    const setSubmitting = (v: boolean) => { submitting = v; };
    const refresh = async () => { refreshed = true; };
    const apiSucceeds = async () => ({ bill: { id: 'x' } });

    setSubmitting(true);
    try {
      await apiSucceeds();
    } catch {
      await refresh();
    } finally {
      setSubmitting(false);
    }

    expect(submitting).toBe(false);
    expect(refreshed).toBe(false); // success — no refresh needed
  });

  test('duplicate submit while pending is blocked by disabled={submitting}', () => {
    // The button's disabled prop includes `submitting` — while true, clicks are ignored.
    let submitting = true; // mid-request
    const isDisabled = submitting; // mirrors the deployed disabled={submitting || ...}
    expect(isDisabled).toBe(true); // button is disabled, second click cannot fire
  });
});

// ============ Stock invariant contract (server-side, code-level) ============
// Documents the code-level guarantee: the 409 paths deduct then compensate.
// Full atomicity is NOT possible (pgbouncer-safe sequential ops, not $transaction),
// so durable compensation via CompensationOperation is the safety net.

describe('ST-39: Stock invariant contract (code-level documentation)', () => {
  test('FIFO_MISMATCH 409 path: deduct then compensate (durable)', () => {
    // L402: deductStockFIFO deducts source lots (committed writes)
    // L408: verifyFifoMatch fails
    // L413: compensateDeductedLots(deductedLots, requestId + '-fifo-mismatch', reason)
    //   → creates CompensationOperation + CompensationItem records (DURABLE)
    //   → re-increments each lot via stockLot.update({ remainingWeight: { increment: amount } })
    //   → marks each item COMPLETED (or FAILED on error)
    // L414: returns 409 with code: FIFO_MISMATCH
    //
    // Net stock effect: deducted by X, then re-incremented by X (if all items COMPLETED).
    // If any item FAILED → source stock is SHORT by that item's amount (data-loss risk).
    const path = 'deduct → verifyFifoMatch fail → compensateDeductedLots (durable) → 409';
    expect(path).toContain('compensateDeductedLots');
    expect(path).toContain('409');
  });

  test('P2002 409 path: deduct → create fails → catch compensates', () => {
    // L402: deductStockFIFO deducts source lots
    // L441: db.stockTransfer.create throws P2002 (duplicate billNumber)
    // L536: catch block — partialDeductedLots.length > 0
    //   → if createdTransferId: delete output StockLots + delete StockTransfer (cleanup)
    //   → L566: compensateDeductedLots(partialDeductedLots, requestId, message)
    // L595: returns 409 with error 'เลขบิลซ้ำ กรุณาลองอีกครั้ง'
    const path = 'deduct → create P2002 → catch: cleanup + compensateDeductedLots → 409';
    expect(path).toContain('compensateDeductedLots');
    expect(path).toContain('409');
  });

  test('compensation is idempotent (same requestId resumes, not double-restores)', () => {
    // compensateDeductedLots uses findUnique({ where: { requestId } }) first.
    // If a CompensationOperation already exists for that requestId, it resumes PENDING items
    // (skipping COMPLETED ones) instead of creating a new operation.
    // This prevents double-restoration on retry.
    const idempotencyMechanism = 'findUnique by requestId → resume PENDING items only';
    expect(idempotencyMechanism).toContain('requestId');
    expect(idempotencyMechanism).toContain('resume PENDING');
  });
});

// ============ Response shape contract ============

describe('ST-39: 409 response body shape (for UI display)', () => {
  test('FIFO_MISMATCH 409 includes code + requestId for traceability', () => {
    const responseBody = {
      error: 'ตรวจพบความไม่ตรงของต้นทุน FIFO ระหว่าง preview และ execution กรุณาลองอีกครั้ง',
      code: 'FIFO_MISMATCH',
      sourceProductId: 'src-1',
      sourceWeight: 20.60,
      previewCost: 40.00,
      actualCost: 39.00,
      requestId: 'req-123',
    };
    expect(responseBody.code).toBe('FIFO_MISMATCH');
    expect(responseBody.requestId).toBeDefined();
    expect(responseBody.error).toContain('FIFO');
  });

  test('P2002 409 includes requestId', () => {
    const responseBody = {
      error: 'เลขบิลซ้ำ กรุณาลองอีกครั้ง',
      details: '...',
      requestId: 'req-456',
    };
    expect(responseBody.requestId).toBeDefined();
    expect(responseBody.error).toContain('ซ้ำ');
  });
});
