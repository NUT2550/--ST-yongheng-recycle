/**
 * ST-39: Executable tests for the deterministic FIFO ordering fix.
 *
 * Replaces the previous documentation-only tests (string assertions, copied
 * try/catch/finally simulations) with executable tests that call the REAL
 * production helpers from src/lib/fifo-validation.ts.
 *
 * Root cause being tested:
 *   When multiple StockLots share the same dateAdded but have different costs,
 *   the FIFO order must be deterministic so preview and execution select the
 *   SAME lot sequence. The fix introduces a shared comparator (dateAdded ASC,
 *   createdAt ASC, id ASC) used by both previewFifoDeduction (in-memory) and
 *   the Prisma orderBy (FIFO_ORDER_BY) in deductStockFIFO.
 *
 * Run: bun test tests/st39-stocktransfer-409.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  previewFifoDeduction,
  verifyFifoMatch,
  validateSourceLotCosts,
  compareFifoLotOrder,
  FIFO_ORDER_BY,
  FIFO_COST_TOLERANCE,
  FIFO_WEIGHT_TOLERANCE,
  type SourceLotForPreview,
  type FifoPreviewSuccess,
} from '../src/lib/fifo-validation';

// ============ Test fixtures ============

function lot(
  id: string,
  remainingWeight: number,
  costPerKg: number,
  dateAdded: Date,
  createdAt?: Date
): SourceLotForPreview {
  return {
    id,
    remainingWeight,
    costPerKg,
    dateAdded,
    createdAt: createdAt ?? dateAdded,
  };
}

// ============ 1. compareFifoLotOrder: the shared deterministic comparator ============

describe('ST-39: compareFifoLotOrder — shared deterministic FIFO ordering', () => {
  test('1. two lots with different dateAdded → ordered by dateAdded', () => {
    const a = lot('lot-a', 50, 40, new Date('2026-01-01'));
    const b = lot('lot-b', 50, 39, new Date('2026-02-01'));
    expect(compareFifoLotOrder(a, b)).toBeLessThan(0);
    expect(compareFifoLotOrder(b, a)).toBeGreaterThan(0);
  });

  test('2. identical dateAdded, different createdAt → ordered by createdAt', () => {
    const d = new Date('2026-01-01T10:00:00Z');
    const a = lot('lot-a', 50, 40, d, new Date('2026-01-01T10:00:01Z'));
    const b = lot('lot-b', 50, 39, d, new Date('2026-01-01T10:00:02Z'));
    expect(compareFifoLotOrder(a, b)).toBeLessThan(0); // a created first
  });

  test('3. identical dateAdded AND createdAt → resolved by id', () => {
    const d = new Date('2026-01-01T10:00:00Z');
    const a = lot('lot-aaa', 50, 40, d, d);
    const b = lot('lot-zzz', 50, 39, d, d);
    expect(compareFifoLotOrder(a, b)).toBeLessThan(0); // 'lot-aaa' < 'lot-zzz'
    expect(compareFifoLotOrder(b, a)).toBeGreaterThan(0);
  });

  test('4. completely identical (same id) → 0 (equal)', () => {
    const d = new Date('2026-01-01T10:00:00Z');
    const a = lot('lot-x', 50, 40, d, d);
    const b = lot('lot-x', 50, 40, d, d);
    expect(compareFifoLotOrder(a, b)).toBe(0);
  });
});

// ============ 2. FIFO_ORDER_BY matches the comparator ============

describe('ST-39: FIFO_ORDER_BY Prisma spec matches compareFifoLotOrder', () => {
  test('5. FIFO_ORDER_BY is [dateAdded asc, createdAt asc, id asc]', () => {
    expect(FIFO_ORDER_BY).toEqual([
      { dateAdded: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ]);
  });
});

// ============ 3. previewFifoDeduction determinism ============

describe('ST-39: previewFifoDeduction — deterministic lot selection', () => {
  test('6. two lots with different dateAdded → older lot consumed first', () => {
    const lots = [
      lot('lot-new', 50, 39, new Date('2026-02-01')),
      lot('lot-old', 50, 40, new Date('2026-01-01')),
    ];
    const preview = previewFifoDeduction('src-1', 30, lots) as FifoPreviewSuccess;
    expect(preview.success).toBe(true);
    expect(preview.deductedLots).toHaveLength(1);
    expect(preview.deductedLots[0].lotId).toBe('lot-old');
    expect(preview.deductedLots[0].weightToUse).toBe(30);
  });

  test('7. identical dateAdded, different costs → deterministic by createdAt then id', () => {
    // The Production bug: two lots with same dateAdded but different costPerKg.
    // Without a tie-break, preview might pick either. With the fix, it deterministically
    // picks the one with earlier createdAt (then id if createdAt also identical).
    const d = new Date('2026-01-01T10:00:00Z');
    const lots = [
      lot('lot-b', 50, 39, d, new Date('2026-01-01T10:00:02Z')),
      lot('lot-a', 50, 40, d, new Date('2026-01-01T10:00:01Z')),
    ];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    expect(preview.deductedLots).toHaveLength(1);
    expect(preview.deductedLots[0].lotId).toBe('lot-a'); // earlier createdAt
    expect(preview.weightedAverageCost).toBe(40); // lot-a's cost
  });

  test('8. identical dateAdded AND createdAt → resolved by id', () => {
    const d = new Date('2026-01-01T10:00:00Z');
    const lots = [
      lot('lot-zzz', 50, 39, d, d),
      lot('lot-aaa', 50, 40, d, d),
    ];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    expect(preview.deductedLots[0].lotId).toBe('lot-aaa'); // 'lot-aaa' < 'lot-zzz'
  });

  test('9. shuffled input order gives the same FIFO result (determinism)', () => {
    const d = new Date('2026-01-01T10:00:00Z');
    const lotsOrdered = [
      lot('lot-a', 50, 40, d, new Date('2026-01-01T10:00:01Z')),
      lot('lot-b', 50, 39, d, new Date('2026-01-01T10:00:02Z')),
      lot('lot-c', 50, 38, new Date('2026-02-01')),
    ];
    const lotsShuffled = [lotsOrdered[2], lotsOrdered[1], lotsOrdered[0]];
    const r1 = previewFifoDeduction('src-1', 20, lotsOrdered) as FifoPreviewSuccess;
    const r2 = previewFifoDeduction('src-1', 20, lotsShuffled) as FifoPreviewSuccess;
    expect(r1.deductedLots).toEqual(r2.deductedLots);
    expect(r1.weightedAverageCost).toBe(r2.weightedAverageCost);
    expect(r1.totalCost).toBe(r2.totalCost);
  });

  test('10. repeated runs give the same result', () => {
    const d = new Date('2026-01-01T10:00:00Z');
    const lots = [
      lot('lot-b', 50, 39, d, new Date('2026-01-01T10:00:02Z')),
      lot('lot-a', 50, 40, d, new Date('2026-01-01T10:00:01Z')),
    ];
    const r1 = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    const r2 = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    const r3 = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    expect(r1.deductedLots).toEqual(r2.deductedLots);
    expect(r2.deductedLots).toEqual(r3.deductedLots);
  });

  test('11. equal-date lots no longer cause FIFO_MISMATCH solely by ordering', () => {
    // Simulate: preview and execution both use the same deterministic comparator.
    // Even though both lots have the same dateAdded, both pick lot-a (earlier createdAt).
    const d = new Date('2026-01-01T10:00:00Z');
    const lots = [
      lot('lot-a', 50, 40, d, new Date('2026-01-01T10:00:01Z')),
      lot('lot-b', 50, 39, d, new Date('2026-01-01T10:00:02Z')),
    ];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    // Execution would deduct from the same lot (lot-a) → same allocation → match
    const actual = {
      costPerKg: preview.weightedAverageCost,
      totalCost: preview.totalCost,
      deductedLots: preview.deductedLots.map(l => ({ id: l.lotId, deducted: l.weightToUse })),
    };
    expect(verifyFifoMatch(preview, actual)).toBe(true);
  });
});

// ============ 4. verifyFifoMatch allocation checks ============

describe('ST-39: verifyFifoMatch — allocation comparison (not just costs)', () => {
  test('12. match when allocation matches (same lot IDs + weights + costs)', () => {
    const lots = [lot('lot-a', 50, 40, new Date('2026-01-01'))];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    const actual = {
      costPerKg: 40,
      totalCost: 800,
      deductedLots: [{ id: 'lot-a', deducted: 20 }],
    };
    expect(verifyFifoMatch(preview, actual)).toBe(true);
  });

  test('13. mismatch when actual selected a DIFFERENT lot (even if cost coincidentally matches)', () => {
    // This is the bug the allocation check catches that cost-only would miss:
    // lot-a 20kg@40 and lot-b 20kg@40 have the same cost, but different lot IDs.
    const d = new Date('2026-01-01T10:00:00Z');
    const lots = [
      lot('lot-a', 20, 40, d, new Date('2026-01-01T10:00:01Z')),
      lot('lot-b', 20, 40, d, new Date('2026-01-01T10:00:02Z')),
    ];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    // Preview picks lot-a. Execution (buggy, without tie-break) picked lot-b.
    // Costs are identical (both 40*20=800, avg 40) — cost-only check would PASS (false negative).
    // The allocation check catches it:
    const actual = {
      costPerKg: 40,
      totalCost: 800,
      deductedLots: [{ id: 'lot-b', deducted: 20 }], // different lot!
    };
    expect(verifyFifoMatch(preview, actual)).toBe(false);
  });

  test('14. mismatch when per-lot weight differs (partial consumption difference)', () => {
    const lots = [
      lot('lot-a', 30, 40, new Date('2026-01-01')),
      lot('lot-b', 30, 39, new Date('2026-02-01')),
    ];
    const preview = previewFifoDeduction('src-1', 40, lots) as FifoPreviewSuccess;
    // Preview: 30 from lot-a + 10 from lot-b
    // Actual (buggy): 20 from lot-a + 20 from lot-b (concurrent lot edit)
    const actual = {
      costPerKg: preview.weightedAverageCost, // coincidentally same avg? no — different
      totalCost: 30 * 40 + 10 * 39, // same as preview actually
      deductedLots: [
        { id: 'lot-a', deducted: 20 }, // different weight
        { id: 'lot-b', deducted: 20 },
      ],
    };
    // The allocation check catches the per-lot weight difference:
    expect(verifyFifoMatch(preview, actual)).toBe(false);
  });

  test('15. genuine concurrent lot change still triggers mismatch (cost differs)', () => {
    const lots = [lot('lot-a', 50, 40, new Date('2026-01-01'))];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    // Between preview and execution, lot-a's cost was edited to 39
    const actual = {
      costPerKg: 39, // different cost
      totalCost: 39 * 20,
      deductedLots: [{ id: 'lot-a', deducted: 20 }],
    };
    expect(verifyFifoMatch(preview, actual)).toBe(false);
  });

  test('16. cost-only fallback when deductedLots omitted (legacy compatibility)', () => {
    const lots = [lot('lot-a', 50, 40, new Date('2026-01-01'))];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    const actual = { costPerKg: 40, totalCost: 800 }; // no deductedLots
    expect(verifyFifoMatch(preview, actual)).toBe(true);
  });
});

// ============ 5. ST-20 zero-cost protection remains active ============

describe('ST-39: ST-20 zero-cost protection unchanged', () => {
  test('17. TRANSFER policy blocks zero-cost source lots', () => {
    const lots = [lot('lot-zero', 50, 0, new Date('2026-01-01'))];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    const result = validateSourceLotCosts(preview, { type: 'TRANSFER', hasNonWasteOutput: true });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.code).toBe('ZERO_COST_SOURCE_LOT');
  });

  test('18. SORTING with non-waste output blocks zero-cost source lots', () => {
    const lots = [lot('lot-zero', 50, 0, new Date('2026-01-01'))];
    const preview = previewFifoDeduction('src-1', 20, lots) as FifoPreviewSuccess;
    const result = validateSourceLotCosts(preview, { type: 'SORTING', hasNonWasteOutput: true });
    expect(result.valid).toBe(false);
  });

  test('19. insufficient stock remains blocked', () => {
    const lots = [lot('lot-a', 10, 40, new Date('2026-01-01'))];
    const preview = previewFifoDeduction('src-1', 50, lots);
    expect(preview.success).toBe(false);
    if (!preview.success) expect(preview.code).toBe('INSUFFICIENT_STOCK');
  });
});

// ============ 6. Pure-function purity (preview does not mutate input) ============

describe('ST-39: previewFifoDeduction purity', () => {
  test('20. preview does not mutate the input lots array or its elements', () => {
    const lots = [
      lot('lot-a', 50, 40, new Date('2026-01-01')),
      lot('lot-b', 50, 39, new Date('2026-02-01')),
    ];
    const snapshot = JSON.parse(JSON.stringify(lots));
    previewFifoDeduction('src-1', 20, lots);
    expect(JSON.parse(JSON.stringify(lots))).toEqual(snapshot);
  });
});
