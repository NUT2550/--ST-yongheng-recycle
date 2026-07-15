/**
 * ST-40: Durable cost-conservation precision tests.
 *
 * These tests verify that the stored costPerKg (6 decimal places) can reconstruct
 * the allocated totalCost within 1 cent tolerance — fixing the blocker where
 * 2-decimal rounding caused drift (e.g. 826.80 → 826.81).
 *
 * Run: bun test tests/st40-cost-precision.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  allocateOutputCosts,
  verifyCostConservation,
  verifyLotReconstruction,
  verifyOverallLotReconstruction,
  COST_PER_KG_DECIMALS,
  COST_RECONSTRUCTION_TOLERANCE,
} from '../src/lib/transfer-cost-allocation';

// ============ 1. Real Production case: 826.80 / 24.60 ============

describe('ST-40 cost precision: real 826.80 / 24.60 case', () => {
  test('1. real case: sourceTotalCost 826.80, output 24.60 → costPerKg has >2 decimals', () => {
    const result = allocateOutputCosts(826.80, [
      { productId: 'out', weight: 24.60, isWaste: false },
    ]);
    const cpk = result.items[0].costPerKg;
    // 826.80 / 24.60 = 33.609756... — must NOT be rounded to 33.61
    expect(cpk).not.toBe(33.61);
    expect(cpk).toBeCloseTo(33.609756, 4);
  });

  test('2. reconstructed StockLot value equals 826.80 within tolerance', () => {
    const result = allocateOutputCosts(826.80, [
      { productId: 'out', weight: 24.60, isWaste: false },
    ]);
    const item = result.items[0];
    expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    // Exact reconstruction check
    const reconstructed = Math.round(24.60 * item.costPerKg * 100) / 100;
    expect(Math.abs(reconstructed - 826.80)).toBeLessThanOrEqual(COST_RECONSTRUCTION_TOLERANCE);
  });

  test('3. OLD 2-decimal rounding would fail (regression proof)', () => {
    // Prove the blocker was real: 2-decimal rounding causes drift
    const oldRoundedCostPerKg = 33.61; // Math.round(33.609756 * 100) / 100
    const reconstructed = Math.round(24.60 * oldRoundedCostPerKg * 100) / 100;
    // 24.60 × 33.61 = 826.806 → rounded = 826.81 ≠ 826.80
    expect(reconstructed).toBe(826.81);
    expect(reconstructed).not.toBe(826.80); // drift!
  });
});

// ============ 2. Large weight ============

describe('ST-40 cost precision: large weight', () => {
  test('4. 10,000 kg output → reconstruction within tolerance', () => {
    const sourceTotalCost = 500000.00; // 500k THB
    const weight = 10000.00;
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'out', weight, isWaste: false },
    ]);
    const item = result.items[0];
    expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    const reconstructed = Math.round(weight * item.costPerKg * 100) / 100;
    expect(Math.abs(reconstructed - sourceTotalCost)).toBeLessThanOrEqual(0.01);
  });
});

// ============ 3. Fractional weight (3 decimal places) ============

describe('ST-40 cost precision: fractional weight', () => {
  test('5. 3-decimal weight (12.345 kg) → reconstruction within tolerance', () => {
    const sourceTotalCost = 500.00;
    const weight = 12.345;
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'out', weight, isWaste: false },
    ]);
    const item = result.items[0];
    expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    const reconstructed = Math.round(weight * item.costPerKg * 100) / 100;
    expect(Math.abs(reconstructed - item.totalCost)).toBeLessThanOrEqual(0.01);
  });
});

// ============ 4. Multiple outputs with uneven weights ============

describe('ST-40 cost precision: multiple outputs', () => {
  test('6. multiple uneven weights → each reconstructs + overall conserved', () => {
    const sourceTotalCost = 826.80;
    const items = [
      { productId: 'a', weight: 10.00, isWaste: false },
      { productId: 'b', weight: 14.60, isWaste: false },
    ];
    const result = allocateOutputCosts(sourceTotalCost, items);
    // Each item reconstructs
    for (const item of result.items) {
      expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    }
    // Overall conserved
    expect(verifyOverallLotReconstruction(sourceTotalCost, result.items)).toBe(true);
  });

  test('7. repeating decimal costPerKg (100/3) → reconstruction within tolerance', () => {
    // 100.00 / 3 items of equal weight → costPerKg = 33.3333... (repeating)
    const sourceTotalCost = 100.00;
    const items = [
      { productId: 'a', weight: 1, isWaste: false },
      { productId: 'b', weight: 1, isWaste: false },
      { productId: 'c', weight: 1, isWaste: false },
    ];
    const result = allocateOutputCosts(sourceTotalCost, items);
    for (const item of result.items) {
      expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    }
    expect(verifyOverallLotReconstruction(sourceTotalCost, result.items)).toBe(true);
  });

  test('8. rounding remainder assigned to final eligible item', () => {
    // 100.01 across 3 items → last item gets the remainder
    const sourceTotalCost = 100.01; // 10001 cents, not divisible by 3
    const items = [
      { productId: 'a', weight: 1, isWaste: false },
      { productId: 'b', weight: 1, isWaste: false },
      { productId: 'c', weight: 1, isWaste: false },
    ];
    const result = allocateOutputCosts(sourceTotalCost, items);
    // Sum of totalCost = sourceTotalCost exactly (within 1 cent)
    expect(verifyCostConservation(sourceTotalCost, result.items)).toBe(true);
    // Each lot reconstructs
    for (const item of result.items) {
      expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    }
  });
});

// ============ 5. Conservation invariants ============

describe('ST-40 cost precision: conservation invariants', () => {
  test('9. sum StockTransferItem.totalCost equals sourceTotalCost', () => {
    const sourceTotalCost = 826.80;
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'a', weight: 10, isWaste: false },
      { productId: 'b', weight: 14.60, isWaste: false },
    ]);
    expect(verifyCostConservation(sourceTotalCost, result.items)).toBe(true);
  });

  test('10. sum reconstructed StockLot values equals sourceTotalCost', () => {
    const sourceTotalCost = 826.80;
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'a', weight: 10, isWaste: false },
      { productId: 'b', weight: 14.60, isWaste: false },
    ]);
    expect(verifyOverallLotReconstruction(sourceTotalCost, result.items)).toBe(true);
  });

  test('11. each StockLot reconstructed value matches its item totalCost', () => {
    const sourceTotalCost = 826.80;
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'a', weight: 10, isWaste: false },
      { productId: 'b', weight: 14.60, isWaste: false },
    ]);
    for (const item of result.items) {
      expect(verifyLotReconstruction(item.weight, item.costPerKg, item.totalCost)).toBe(true);
    }
  });

  test('12. waste item remains zero cost', () => {
    const result = allocateOutputCosts(500.00, [
      { productId: 'out', weight: 20, isWaste: false },
      { productId: 'waste', weight: 5, isWaste: true },
    ]);
    expect(result.items[1].costPerKg).toBe(0);
    expect(result.items[1].totalCost).toBe(0);
  });
});

// ============ 6. Positive-yield + normal-loss + exact-balance ============

describe('ST-40 cost precision: yield cases', () => {
  test('13. positive-yield case: cost conserved with reconstruction', () => {
    const sourceTotalCost = 20.80 * 39.75; // 826.80
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'out', weight: 24.60, isWaste: false }, // gain
    ]);
    expect(verifyCostConservation(sourceTotalCost, result.items)).toBe(true);
    expect(verifyOverallLotReconstruction(sourceTotalCost, result.items)).toBe(true);
  });

  test('14. normal-loss case: cost conserved with reconstruction', () => {
    const sourceTotalCost = 20.80 * 39.75; // 826.80
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'out', weight: 18.00, isWaste: false }, // loss
    ]);
    expect(verifyCostConservation(sourceTotalCost, result.items)).toBe(true);
    expect(verifyOverallLotReconstruction(sourceTotalCost, result.items)).toBe(true);
  });

  test('15. exact-balance case: cost conserved with reconstruction', () => {
    const sourceTotalCost = 20.80 * 39.75; // 826.80
    const result = allocateOutputCosts(sourceTotalCost, [
      { productId: 'out', weight: 20.80, isWaste: false }, // exact
    ]);
    expect(verifyCostConservation(sourceTotalCost, result.items)).toBe(true);
    expect(verifyOverallLotReconstruction(sourceTotalCost, result.items)).toBe(true);
    // costPerKg should equal sourceCostPerKg (39.75) when output = source
    expect(result.items[0].costPerKg).toBeCloseTo(39.75, 6);
  });
});

// ============ 7. Future FIFO deduction simulation ============

describe('ST-40 cost precision: future FIFO deduction', () => {
  test('16. full FIFO deduction from generated StockLot returns conserved total cost', () => {
    // Simulate: a StockLot was created with weight=24.60, costPerKg=33.609756 (6 decimals)
    // Future FIFO deduction of all 24.60 kg should return totalCost = 826.80
    const lotWeight = 24.60;
    const lotCostPerKg = 33.609756; // 6-decimal precision (from allocateOutputCosts)
    const fifoTotalCost = Math.round(lotWeight * lotCostPerKg * 100) / 100;
    expect(fifoTotalCost).toBeCloseTo(826.80, 2);
    expect(Math.abs(fifoTotalCost - 826.80)).toBeLessThanOrEqual(0.01);
  });

  test('17. partial FIFO deduction uses stored precision correctly', () => {
    // Deduct 10 kg from a 24.60 kg lot @ 33.609756/kg
    const lotWeight = 24.60;
    const lotCostPerKg = 33.609756;
    const deductWeight = 10.00;
    const partialCost = Math.round(deductWeight * lotCostPerKg * 100) / 100;
    // 10 × 33.609756 = 336.09756 → rounded = 336.10
    expect(partialCost).toBeCloseTo(336.10, 2);
    // Remaining lot value should also be consistent
    const remainingWeight = lotWeight - deductWeight;
    const remainingCost = Math.round(remainingWeight * lotCostPerKg * 100) / 100;
    // (24.60 - 10) × 33.609756 = 14.60 × 33.609756 = 490.702... → 490.70
    expect(remainingCost).toBeCloseTo(490.70, 2);
    // Sum of partial + remaining should approximate total (within 1 cent)
    expect(Math.abs(partialCost + remainingCost - 826.80)).toBeLessThanOrEqual(0.01);
  });
});

// ============ 8. Constants + documentation ============

describe('ST-40 cost precision: constants', () => {
  test('18. COST_PER_KG_DECIMALS is 6', () => {
    expect(COST_PER_KG_DECIMALS).toBe(6);
  });

  test('19. COST_RECONSTRUCTION_TOLERANCE is 0.01 (1 cent)', () => {
    expect(COST_RECONSTRUCTION_TOLERANCE).toBe(0.01);
  });

  test('20. 6-decimal precision guarantees reconstruction for 10,000 kg', () => {
    // Mathematical proof: max error from 6-decimal rounding = 0.5 × 10^-6
    // For weight up to 10,000 kg: 10000 × 0.5 × 10^-6 = 0.005 < 0.01 tolerance
    const maxWeight = 10000;
    const maxRoundingError = 0.5 * Math.pow(10, -COST_PER_KG_DECIMALS);
    const maxReconstructionError = maxWeight * maxRoundingError;
    expect(maxReconstructionError).toBeLessThanOrEqual(COST_RECONSTRUCTION_TOLERANCE);
  });
});
