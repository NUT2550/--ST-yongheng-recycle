/**
 * ST-20 Phase 2: Unit tests for FIFO validation helper.
 *
 * Run: bun test tests/fifo-validation.test.ts
 *
 * These are pure-function tests — no DB, no network, no Prisma.
 * The helper functions are deterministic given a snapshot of source lots.
 */
import { test, expect, describe } from 'bun:test';
import {
  previewFifoDeduction,
  validateSourceLotCosts,
  verifyFifoMatch,
  buildFifoAuditDetails,
  FIFO_COST_TOLERANCE,
  FIFO_WEIGHT_TOLERANCE,
} from '../src/lib/fifo-validation';

// Helper: build a source lot
const makeLot = (
  id: string,
  remainingWeight: number,
  costPerKg: number,
  dateAdded: Date = new Date('2026-01-01')
) => ({ id, remainingWeight, costPerKg, dateAdded });

describe('previewFifoDeduction', () => {
  test('1. Normal sorting with valid source cost (>0) — single lot', () => {
    const lots = [makeLot('lot1', 100, 10)];
    const result = previewFifoDeduction('prod1', 50, lots);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.weightedAverageCost).toBe(10);
      expect(result.totalCost).toBe(500);
      expect(result.deductedLots).toHaveLength(1);
      expect(result.deductedLots[0].weightToUse).toBe(50);
      expect(result.deductedLots[0].subtotalCost).toBe(500);
      expect(result.hasZeroCostSourceLots).toBe(false);
      expect(result.zeroCostLotIds).toHaveLength(0);
    }
  });

  test('2. FIFO with multiple lots of different costs — picks oldest first', () => {
    const lots = [
      makeLot('lot1', 30, 10, new Date('2026-01-01')),
      makeLot('lot2', 50, 20, new Date('2026-01-02')),
      makeLot('lot3', 40, 30, new Date('2026-01-03')),
    ];
    // Deduct 60 kg — should take all of lot1 (30kg@10=300) + 30kg of lot2 (30*20=600) = 900
    const result = previewFifoDeduction('prod1', 60, lots);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.deductedLots).toHaveLength(2);
      expect(result.deductedLots[0].lotId).toBe('lot1');
      expect(result.deductedLots[0].weightToUse).toBe(30);
      expect(result.deductedLots[0].subtotalCost).toBe(300);
      expect(result.deductedLots[1].lotId).toBe('lot2');
      expect(result.deductedLots[1].weightToUse).toBe(30);
      expect(result.deductedLots[1].subtotalCost).toBe(600);
      // Weighted avg = (300 + 600) / 60 = 15
      expect(result.weightedAverageCost).toBe(15);
      expect(result.totalCost).toBe(900);
    }
  });

  test('3. All-waste output from zero-cost source — preview succeeds, zero-cost detected', () => {
    // Note: preview itself does NOT enforce waste policy — it just reports.
    // validateSourceLotCosts enforces policy.
    const lots = [makeLot('lot1', 100, 0)];
    const result = previewFifoDeduction('prod1', 50, lots);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.hasZeroCostSourceLots).toBe(true);
      expect(result.zeroCostLotIds).toEqual(['lot1']);
      expect(result.weightedAverageCost).toBe(0);
      expect(result.totalCost).toBe(0);
    }
  });

  test('4. Insufficient stock — returns INSUFFICIENT_STOCK error', () => {
    const lots = [makeLot('lot1', 10, 10)];
    const result = previewFifoDeduction('prod1', 50, lots);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('INSUFFICIENT_STOCK');
      expect(result.totalAvailable).toBe(10);
      expect(result.sourceWeight).toBe(50);
    }
  });

  test('5. Mixed zero-cost + positive-cost source lots — both detected', () => {
    const lots = [
      makeLot('lot1', 50, 0, new Date('2026-01-01')), // zero-cost, oldest
      makeLot('lot2', 50, 20, new Date('2026-01-02')), // positive cost, newer
    ];
    // Deduct 60 kg — takes all of lot1 (50kg@0=0) + 10kg of lot2 (10*20=200) = 200
    const result = previewFifoDeduction('prod1', 60, lots);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.deductedLots).toHaveLength(2);
      expect(result.deductedLots[0].lotId).toBe('lot1');
      expect(result.deductedLots[0].weightToUse).toBe(50);
      expect(result.deductedLots[0].costPerKg).toBe(0);
      expect(result.deductedLots[1].lotId).toBe('lot2');
      expect(result.deductedLots[1].weightToUse).toBe(10);
      expect(result.deductedLots[1].costPerKg).toBe(20);
      expect(result.hasZeroCostSourceLots).toBe(true);
      expect(result.zeroCostLotIds).toEqual(['lot1']);
      // Weighted avg = 200 / 60 ≈ 3.33
      expect(result.weightedAverageCost).toBe(3.33);
      expect(result.totalCost).toBe(200);
    }
  });

  test('6. Negative costPerKg source lot — returns NEGATIVE_COST_SOURCE_LOT error', () => {
    const lots = [makeLot('lot1', 100, -5)];
    const result = previewFifoDeduction('prod1', 50, lots);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe('NEGATIVE_COST_SOURCE_LOT');
      expect(result.affectedSourceLotIds).toEqual(['lot1']);
    }
  });

  test('7. Zero sourceWeight — returns success with empty deducted lots', () => {
    const lots = [makeLot('lot1', 100, 10)];
    const result = previewFifoDeduction('prod1', 0, lots);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.deductedLots).toHaveLength(0);
      expect(result.totalCost).toBe(0);
      expect(result.weightedAverageCost).toBe(0);
    }
  });

  test('8. Floating-point tolerance — small rounding does not cause INSUFFICIENT_STOCK', () => {
    const lots = [makeLot('lot1', 10.00, 10)];
    // Request 10.005 — within tolerance, should succeed
    const result = previewFifoDeduction('prod1', 10.005, lots);
    expect(result.success).toBe(true);
  });

  test('9. FIFO ordering — input array order does not matter (uses dateAdded)', () => {
    const lot1 = makeLot('lot1', 30, 10, new Date('2026-01-02')); // newer
    const lot2 = makeLot('lot2', 30, 20, new Date('2026-01-01')); // older
    const result = previewFifoDeduction('prod1', 30, [lot1, lot2]);
    expect(result.success).toBe(true);
    if (result.success) {
      // lot2 (older) should be deducted first
      expect(result.deductedLots[0].lotId).toBe('lot2');
      expect(result.weightedAverageCost).toBe(20);
    }
  });

  test('10. Zero-cost lot NOT used (weightToUse=0) — not flagged', () => {
    const lots = [
      makeLot('lot1', 100, 10, new Date('2026-01-01')),
      makeLot('lot2', 50, 0, new Date('2026-01-02')), // zero-cost but won't be touched
    ];
    // Deduct 50 kg — only touches lot1, lot2 untouched
    const result = previewFifoDeduction('prod1', 50, lots);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.hasZeroCostSourceLots).toBe(false);
      expect(result.zeroCostLotIds).toHaveLength(0);
    }
  });
});

describe('validateSourceLotCosts', () => {
  test('11. SortingBill with non-waste output + zero-cost source → BLOCK', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 0, weightToUse: 50, subtotalCost: 0 }],
      weightedAverageCost: 0,
      totalCost: 0,
      zeroCostLotIds: ['lot1'],
      hasZeroCostSourceLots: true,
    };
    const result = validateSourceLotCosts(preview, { type: 'SORTING', hasNonWasteOutput: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('ZERO_COST_SOURCE_LOT');
      expect(result.affectedSourceLotIds).toEqual(['lot1']);
    }
  });

  test('12. SortingBill with all-waste output + zero-cost source → ALLOW', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 0, weightToUse: 50, subtotalCost: 0 }],
      weightedAverageCost: 0,
      totalCost: 0,
      zeroCostLotIds: ['lot1'],
      hasZeroCostSourceLots: true,
    };
    const result = validateSourceLotCosts(preview, { type: 'SORTING', hasNonWasteOutput: false });
    expect(result.valid).toBe(true);
  });

  test('13. SortingBill with non-waste output + zero weighted avg (no zero-cost lots) → BLOCK', () => {
    // Edge case: weighted avg = 0 but no individual zero-cost lot
    // (theoretically impossible with positive costs, but test the validation)
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 0.001, weightToUse: 50, subtotalCost: 0.05 }],
      weightedAverageCost: 0.001,
      totalCost: 0.05,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    // 0.001 is below FIFO_COST_TOLERANCE (0.005)
    const result = validateSourceLotCosts(preview, { type: 'SORTING', hasNonWasteOutput: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('ZERO_SOURCE_COST');
    }
  });

  test('14. StockTransfer with zero-cost source → always BLOCK (no waste concept)', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 0, weightToUse: 50, subtotalCost: 0 }],
      weightedAverageCost: 0,
      totalCost: 0,
      zeroCostLotIds: ['lot1'],
      hasZeroCostSourceLots: true,
    };
    // Even with hasNonWasteOutput=false, TRANSFER always blocks
    const result = validateSourceLotCosts(preview, { type: 'TRANSFER', hasNonWasteOutput: false });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('ZERO_COST_SOURCE_LOT');
    }
  });

  test('15. StockTransfer with valid positive cost → ALLOW', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 10, weightToUse: 50, subtotalCost: 500 }],
      weightedAverageCost: 10,
      totalCost: 500,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    const result = validateSourceLotCosts(preview, { type: 'TRANSFER', hasNonWasteOutput: true });
    expect(result.valid).toBe(true);
  });

  test('16. SortingBill with valid positive cost + non-waste output → ALLOW', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 10, weightToUse: 50, subtotalCost: 500 }],
      weightedAverageCost: 10,
      totalCost: 500,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    const result = validateSourceLotCosts(preview, { type: 'SORTING', hasNonWasteOutput: true });
    expect(result.valid).toBe(true);
  });

  test('17. Mixed waste + non-waste SortingBill with zero-cost source → BLOCK', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 0, weightToUse: 50, subtotalCost: 0 }],
      weightedAverageCost: 0,
      totalCost: 0,
      zeroCostLotIds: ['lot1'],
      hasZeroCostSourceLots: true,
    };
    // Mixed (hasNonWasteOutput=true) — blocked
    const result = validateSourceLotCosts(preview, { type: 'SORTING', hasNonWasteOutput: true });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe('ZERO_COST_SOURCE_LOT');
    }
  });
});

describe('verifyFifoMatch', () => {
  test('18. Exact match — returns true', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [],
      weightedAverageCost: 10,
      totalCost: 500,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    expect(verifyFifoMatch(preview, { costPerKg: 10, totalCost: 500 })).toBe(true);
  });

  test('19. Match within tolerance — returns true', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [],
      weightedAverageCost: 10,
      totalCost: 500,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    // Within FIFO_COST_TOLERANCE (0.005)
    expect(verifyFifoMatch(preview, { costPerKg: 10.003, totalCost: 500.1 })).toBe(true);
  });

  test('20. Mismatch beyond tolerance — returns false', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [],
      weightedAverageCost: 10,
      totalCost: 500,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    // Diff 1 THB/kg — way beyond tolerance
    expect(verifyFifoMatch(preview, { costPerKg: 11, totalCost: 550 })).toBe(false);
  });

  test('21. Mismatch in totalCost (small per-kg but large total) — returns false', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 1000,
      totalAvailable: 2000,
      deductedLots: [],
      weightedAverageCost: 10,
      totalCost: 10000,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    // Per-kg diff 0.001 (within tolerance), but total diff 1 THB (beyond 0.005 * 1000 = 5 THB? Actually within)
    // 0.001 < 0.005 per-kg tolerance, total diff = 1 < 5 → should match
    expect(verifyFifoMatch(preview, { costPerKg: 10.001, totalCost: 10001 })).toBe(true);
    // But total diff 10 → beyond 5 → mismatch
    expect(verifyFifoMatch(preview, { costPerKg: 10.01, totalCost: 10010 })).toBe(false);
  });
});

describe('buildFifoAuditDetails', () => {
  test('22. Audit details contain all required fields', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [
        { lotId: 'lot1', remainingWeight: 30, costPerKg: 10, weightToUse: 30, subtotalCost: 300 },
        { lotId: 'lot2', remainingWeight: 50, costPerKg: 20, weightToUse: 20, subtotalCost: 400 },
      ],
      weightedAverageCost: 14,
      totalCost: 700,
      zeroCostLotIds: [],
      hasZeroCostSourceLots: false,
    };
    const details = buildFifoAuditDetails(preview, { type: 'SORTING', hasNonWasteOutput: true });
    expect(details.allocationMethod).toBe('SOURCE_FIFO_WEIGHTED_AVERAGE');
    expect(details.sourceProductId).toBe('p1');
    expect(details.sourceWeight).toBe(50);
    expect(details.sourceWeightedAvgCost).toBe(14);
    expect(details.sourceLots).toHaveLength(2);
    expect(details.sourceLots[0]).toEqual({
      lotId: 'lot1',
      costPerKg: 10,
      deductedWeight: 30,
      subtotalCost: 300,
    });
    expect(details.validationPolicy).toEqual({ type: 'SORTING', hasNonWasteOutput: true });
    expect(details.zeroCostSourceLotDetected).toBe(false);
    expect(details.zeroCostSourceLotIds).toEqual([]);
  });

  test('23. Audit details flag zero-cost contamination', () => {
    const preview = {
      success: true as const,
      sourceProductId: 'p1',
      sourceWeight: 50,
      totalAvailable: 100,
      deductedLots: [{ lotId: 'lot1', remainingWeight: 100, costPerKg: 0, weightToUse: 50, subtotalCost: 0 }],
      weightedAverageCost: 0,
      totalCost: 0,
      zeroCostLotIds: ['lot1'],
      hasZeroCostSourceLots: true,
    };
    const details = buildFifoAuditDetails(preview, { type: 'TRANSFER', hasNonWasteOutput: true });
    expect(details.zeroCostSourceLotDetected).toBe(true);
    expect(details.zeroCostSourceLotIds).toEqual(['lot1']);
  });
});

describe('Tolerance constants', () => {
  test('24. FIFO_COST_TOLERANCE is 0.005', () => {
    expect(FIFO_COST_TOLERANCE).toBe(0.005);
  });

  test('25. FIFO_WEIGHT_TOLERANCE is 0.01', () => {
    expect(FIFO_WEIGHT_TOLERANCE).toBe(0.01);
  });
});
