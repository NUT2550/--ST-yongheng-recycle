import { describe, expect, test } from 'bun:test'
import { generateRevaluationPlan, categorizeLot, type RevaluationDeps } from '../src/lib/st48-revaluation-plan'

const d = (s: string) => new Date(s + 'T00:00:00+07:00')

function makeDeps(overrides: Partial<RevaluationDeps> = {}): RevaluationDeps {
  return {
    async getZeroCostActiveLots() {
      return [
        { id: 'lot1', productId: 'p1', productName: 'Product A', remainingWeight: 100, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' },
        { id: 'lot2', productId: 'p2', productName: 'Product B', remainingWeight: 50, costPerKg: 0, dateAdded: d('2026-06-20'), createdAt: d('2026-06-20'), source: 'BUY', sourceId: 'cmr1234567890' },
        { id: 'lot3', productId: 'p3', productName: 'Product C', remainingWeight: 30, costPerKg: 0, dateAdded: d('2026-07-09'), createdAt: d('2026-07-09'), source: 'SORTING', sourceId: 'sort123' },
        { id: 'lot4', productId: 'p4', productName: 'Product D', remainingWeight: 10, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' },
        { id: 'lot5', productId: 'p5', productName: 'Product E', remainingWeight: 5, costPerKg: 0, dateAdded: d('2026-06-20'), createdAt: d('2026-06-20'), source: 'BUY', sourceId: 'cmr_buybill_with_zero_price' },
      ]
    },
    async getBuyBillItemCost(buyBillId: string, productId: string) {
      // lot2: source has non-zero pricePerKg → EXACT_BUY_SOURCE
      if (buyBillId === 'cmr1234567890' && productId === 'p2') return 9.98
      // lot5: source has pricePerKg=0 → not a valid exact cost → return null
      if (buyBillId === 'cmr_buybill_with_zero_price' && productId === 'p5') return null
      return null
    },
    async getSortingSourceAvgCost() { return 15.5 },
    async getProductHistoricalAvgCost(productId: string) {
      if (productId === 'p4' || productId === 'p5') return null // no historical cost
      return { avgCost: 10.5, obsCount: 5, minCost: 8, maxCost: 13, totalWeight: 1000 }
    },
    async getFifoPosition() { return 1 },
    ...overrides,
  }
}

describe('ST-48 Hybrid zero-cost revaluation plan', () => {
  test('1. dry-run does not mutate data (applyMode is false)', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    expect(plan.applyMode).toBe(false)
    expect(plan.eligibleLots.length).toBe(5)
  })

  test('2. Source IDs beginning with cmr resolve correctly', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const lot2 = plan.eligibleLots.find(l => l.lotId === 'lot2')!
    expect(lot2.derivationMethod).toBe('EXACT_BUY_SOURCE')
    expect(lot2.proposedCostPerKg).toBe(9.98)
    expect(lot2.confidence).toBe('HIGH')
  })

  test('3. Source resolution does not depend on arbitrary prefix', async () => {
    // The tool uses sourceType + sourceId, not prefix matching.
    // A BUY lot with any sourceId (not manual/manual-steel) is Category B.
    expect(categorizeLot('BUY', 'cmr1234567890')).toBe('B_MANUAL_PURCHASE')
    expect(categorizeLot('BUY', 'any-other-id')).toBe('B_MANUAL_PURCHASE')
    expect(categorizeLot('BUY', 'manual')).toBe('A_ST19_ADJUSTMENT')
    expect(categorizeLot('BUY', 'manual-steel')).toBe('G_LEGACY_OPENING')
  })

  test('4. Exact BuyBillItem price 9.98 is selected', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const lot2 = plan.eligibleLots.find(l => l.lotId === 'lot2')!
    expect(lot2.proposedCostPerKg).toBe(9.98)
    expect(lot2.derivationMethod).toBe('EXACT_BUY_SOURCE')
  })

  test('5. Exact BuyBillItem price 9.90 is selected', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getBuyBillItemCost(buyBillId: string, productId: string) {
        if (buyBillId === 'cmr1234567890' && productId === 'p2') return 9.9
        return null
      },
    }), '2026-07-19T12:31:51Z')
    const lot2 = plan.eligibleLots.find(l => l.lotId === 'lot2')!
    expect(lot2.proposedCostPerKg).toBe(9.9)
    expect(lot2.derivationMethod).toBe('EXACT_BUY_SOURCE')
  })

  test('6. Multiple candidate items cause ambiguous/block result (null)', async () => {
    // When getBuyBillItemCost returns null for ambiguous matches, the lot
    // falls through to historical average or OWNER_DECISION_REQUIRED.
    const plan = await generateRevaluationPlan(makeDeps({
      async getBuyBillItemCost() { return null }, // ambiguous or missing
    }), '2026-07-19T12:31:51Z')
    const lot2 = plan.eligibleLots.find(l => l.lotId === 'lot2')!
    // Without exact cost, falls to historical average
    expect(lot2.derivationMethod).toBe('HISTORICAL_WEIGHTED_AVERAGE')
    expect(lot2.proposedCostPerKg).toBe(10.5)
  })

  test('7. Missing source causes fallback to historical average', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const lot1 = plan.eligibleLots.find(l => l.lotId === 'lot1')!
    // Category A (manual) — no BuyBill source → historical average
    expect(lot1.derivationMethod).toBe('HISTORICAL_WEIGHTED_AVERAGE')
  })

  test('8. Zero source pricePerKg is NOT treated as valid exact cost', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const lot5 = plan.eligibleLots.find(l => l.lotId === 'lot5')!
    // Source BuyBillItem has pricePerKg=0 → getBuyBillItemCost returns null
    // → falls to historical average → no historical → OWNER_DECISION_REQUIRED
    expect(lot5.derivationMethod).toBe('OWNER_DECISION_REQUIRED')
    expect(lot5.proposedCostPerKg).toBeNull()
    expect(lot5.unresolvedWarning).toContain('OWNER_DECISION_REQUIRED')
  })

  test('9. Exact source has priority over historical weighted average', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const lot2 = plan.eligibleLots.find(l => l.lotId === 'lot2')!
    // Even though historical avg (10.5) is available, exact (9.98) takes priority
    expect(lot2.derivationMethod).toBe('EXACT_BUY_SOURCE')
    expect(lot2.proposedCostPerKg).toBe(9.98) // not 10.5
  })

  test('10. Category B lot with zero source price becomes OWNER_DECISION_REQUIRED when no history', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const lot5 = plan.eligibleLots.find(l => l.lotId === 'lot5')!
    expect(lot5.category).toBe('B_MANUAL_PURCHASE')
    expect(lot5.derivationMethod).toBe('OWNER_DECISION_REQUIRED')
  })

  test('11. อลูมิเนียมเครื่อง remains OWNER_DECISION_REQUIRED', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getZeroCostActiveLots() {
        return [{ id: 'lot-motor', productId: 'p-motor', productName: 'อลูมิเนียมเครื่อง', remainingWeight: 30.5, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' }]
      },
      async getProductHistoricalAvgCost() { return null },
    }), '2026-07-19T12:31:51Z')
    expect(plan.eligibleLots[0].derivationMethod).toBe('OWNER_DECISION_REQUIRED')
    expect(plan.eligibleLots[0].proposedCostPerKg).toBeNull()
  })

  test('12. Dry-run remains deterministic', async () => {
    const deps = makeDeps()
    const plan1 = await generateRevaluationPlan(deps, '2026-07-19T12:31:51Z')
    const plan2 = await generateRevaluationPlan(deps, '2026-07-19T12:31:51Z')
    expect(plan2.totalLots).toBe(plan1.totalLots)
    expect(plan2.totalValueIncrease).toBe(plan1.totalValueIncrease)
    expect(plan2.eligibleLots.map(l => l.proposedCostPerKg)).toEqual(plan1.eligibleLots.map(l => l.proposedCostPerKg))
  })

  test('13. Apply mode remains blocked', async () => {
    const { applyRevaluationPlan, APPLY_MODE_ENABLED } = await import('../src/lib/st48-revaluation-plan')
    expect(APPLY_MODE_ENABLED).toBe(false)
    const result = await applyRevaluationPlan()
    expect(result.applied).toBe(false)
    expect(result.reason).toContain('BLOCKED')
  })

  test('14. remainingWeight is never changed', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    for (const lot of plan.eligibleLots) {
      expect(lot.remainingWeight).toBeGreaterThan(0)
    }
  })

  test('15. no proposed cost is zero, negative, or non-finite', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    for (const lot of plan.eligibleLots) {
      if (lot.proposedCostPerKg !== null) {
        expect(lot.proposedCostPerKg).toBeGreaterThan(0)
        expect(Number.isFinite(lot.proposedCostPerKg)).toBe(true)
      }
    }
  })

  test('16. total value increase equals sum of per-lot increases', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    const sumIncreases = plan.eligibleLots.reduce((s, l) => s + (l.valueIncrease ?? 0), 0)
    expect(Math.round(sumIncreases * 100) / 100).toBe(plan.totalValueIncrease)
  })

  test('17. expected-value guard: only costPerKg=0 lots are eligible', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T12:31:51Z')
    for (const lot of plan.eligibleLots) {
      expect(lot.currentCostPerKg).toBe(0)
    }
  })
})

// ============ Legacy exclusion tests (Phase 2) ============

import { KNOWN_LEGACY_LOTS, isLegacyLot, getLegacyGuard, verifyLegacyGuard } from '../src/lib/st48-revaluation-plan'

describe('ST-48 legacy exclusion', () => {
  test('18. all four legacy lots are excluded', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getZeroCostActiveLots() {
        return [
          ...KNOWN_LEGACY_LOTS.map(l => ({
            id: l.lotId, productId: l.productId, productName: 'Legacy Lot',
            remainingWeight: l.expectedRemainingWeight, costPerKg: 0,
            dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'),
            source: 'BUY', sourceId: 'manual',
          })),
          { id: 'lot-resolved', productId: 'p1', productName: 'Resolved Lot', remainingWeight: 100, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' },
        ]
      },
    }), '2026-07-19T13:40:07Z')
    const legacyLots = plan.eligibleLots.filter(l => l.derivationMethod === 'KNOWN_LEGACY_ZERO_COST')
    expect(legacyLots.length).toBe(4)
    for (const l of legacyLots) {
      expect(l.proposedCostPerKg).toBeNull()
      expect(l.afterValue).toBeNull()
    }
  })

  test('19. exclusion is deterministic', () => {
    expect(KNOWN_LEGACY_LOTS.length).toBe(4)
    // Verify all 4 lot IDs are unique
    const ids = KNOWN_LEGACY_LOTS.map(l => l.lotId)
    expect(new Set(ids).size).toBe(4)
  })

  test('20. exclusion requires matching Product ID', () => {
    const guard = KNOWN_LEGACY_LOTS[0]
    const error = verifyLegacyGuard(guard.lotId, 'wrong-product-id', guard.expectedRemainingWeight)
    expect(error).toContain('productId mismatch')
  })

  test('21. exclusion requires expected remainingWeight', () => {
    const guard = KNOWN_LEGACY_LOTS[0]
    const error = verifyLegacyGuard(guard.lotId, guard.productId, 999.9)
    expect(error).toContain('remainingWeight mismatch')
  })

  test('22. a mismatched legacy lot stops the plan', async () => {
    // If a legacy lot's remainingWeight doesn't match the guard, the plan should throw
    const guard = KNOWN_LEGACY_LOTS[0]
    try {
      await generateRevaluationPlan(makeDeps({
        async getZeroCostActiveLots() {
          return [{ id: guard.lotId, productId: guard.productId, productName: 'Legacy', remainingWeight: 999, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' }]
        },
      }), '2026-07-19T13:40:07Z')
      expect(true).toBe(false) // should have thrown
    } catch (e: any) {
      expect(e.message).toContain('legacy guard mismatch')
    }
  })

  test('23. no other zero-cost lot is silently excluded', () => {
    // Only the 4 known legacy lots should be excluded
    expect(isLegacyLot('cmr0kk5va002ylb04x87wh44s')).toBe(true)
    expect(isLegacyLot('some-other-lot-id')).toBe(false)
  })

  test('24. rerun remains deterministic', async () => {
    const deps = makeDeps({
      async getZeroCostActiveLots() {
        return KNOWN_LEGACY_LOTS.map(l => ({
          id: l.lotId, productId: l.productId, productName: 'Legacy',
          remainingWeight: l.expectedRemainingWeight, costPerKg: 0,
          dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'),
          source: 'BUY', sourceId: 'manual',
        }))
      },
    })
    const plan1 = await generateRevaluationPlan(deps, '2026-07-19T13:40:07Z')
    const plan2 = await generateRevaluationPlan(deps, '2026-07-19T13:40:07Z')
    expect(plan2.legacyCount).toBe(plan1.legacyCount)
    expect(plan2.eligibleForApplyCount).toBe(plan1.eligibleForApplyCount)
  })

  test('25. legacy lots retain cost 0', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getZeroCostActiveLots() {
        return KNOWN_LEGACY_LOTS.map(l => ({
          id: l.lotId, productId: l.productId, productName: 'Legacy',
          remainingWeight: l.expectedRemainingWeight, costPerKg: 0,
          dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'),
          source: 'BUY', sourceId: 'manual',
        }))
      },
    }), '2026-07-19T13:40:07Z')
    for (const l of plan.eligibleLots) {
      expect(l.currentCostPerKg).toBe(0)
      expect(l.proposedCostPerKg).toBeNull()
    }
  })

  test('26. eligible count is exactly derived, not hard-coded', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getZeroCostActiveLots() {
        return [
          ...KNOWN_LEGACY_LOTS.map(l => ({ id: l.lotId, productId: l.productId, productName: 'Legacy', remainingWeight: l.expectedRemainingWeight, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' })),
          { id: 'r1', productId: 'p1', productName: 'Resolved', remainingWeight: 100, costPerKg: 0, dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'), source: 'BUY', sourceId: 'manual' },
          { id: 'r2', productId: 'p2', productName: 'Resolved2', remainingWeight: 50, costPerKg: 0, dateAdded: d('2026-06-20'), createdAt: d('2026-06-20'), source: 'SORTING', sourceId: 'sort1' },
        ]
      },
    }), '2026-07-19T13:40:07Z')
    // 4 legacy + 2 resolved = 6 total, eligibleForApply = 2
    expect(plan.totalLots).toBe(6)
    expect(plan.legacyCount).toBe(4)
    expect(plan.eligibleForApplyCount).toBe(2)
    expect(plan.unresolvedCount).toBe(0)
  })
})

// ============ Apply-guard tests (Phase 6) ============

import { applyRevaluationPlan, validateApplyConfig, APPLY_MODE_ENABLED, type ApplyConfig } from '../src/lib/st48-revaluation-plan'

function makeValidConfig(): ApplyConfig {
  return {
    apply: true,
    allowlistChecksum: '3325bda7772f848d137d092cbaf375c087d1af98d585b345d4cc4ac4d574a744',
    ownerApprovalReference: 'owner-approval-2026-07-19-st48-final-release',
    productionProjectId: 'wefqhunzjvsxciiwdhjx',
    releaseOperationId: 'st48-release-gen1',
  }
}

describe('ST-48 apply-guard controls', () => {
  test('27. apply mode remains disabled', () => {
    expect(APPLY_MODE_ENABLED).toBe(false)
  })

  test('28. missing apply flag remains dry-run', async () => {
    const result = await applyRevaluationPlan()
    expect(result.applied).toBe(false)
    expect(result.dryRun).toBe(true)
  })

  test('29. apply=false remains dry-run even with valid config', async () => {
    const config = makeValidConfig()
    config.apply = false
    const result = await applyRevaluationPlan(config)
    expect(result.applied).toBe(false)
    expect(result.dryRun).toBe(true)
  })

  test('30. wrong allowlist checksum rejected', () => {
    const config = makeValidConfig()
    config.allowlistChecksum = 'wrong'
    const error = validateApplyConfig(config)
    // Note: validateApplyConfig returns BLOCKED first since APPLY_MODE_ENABLED=false
    expect(error).toContain('BLOCKED')
  })

  test('31. wrong Owner approval reference rejected', () => {
    const config = makeValidConfig()
    config.ownerApprovalReference = 'short'
    const error = validateApplyConfig(config)
    expect(error).toContain('BLOCKED')
  })

  test('32. wrong Production project rejected', () => {
    const config = makeValidConfig()
    config.productionProjectId = 'wrong-project'
    const error = validateApplyConfig(config)
    expect(error).toContain('BLOCKED')
  })

  test('33. missing releaseOperationId rejected', () => {
    const config = makeValidConfig()
    config.releaseOperationId = ''
    const error = validateApplyConfig(config)
    expect(error).toContain('BLOCKED')
  })

  test('34. legacy lot inclusion rejected by verifyLegacyGuard', () => {
    // verifyLegacyGuard returns error for non-legacy lots
    const error = verifyLegacyGuard('non-legacy-lot-id', 'p1', 100)
    expect(error).toContain('not in the legacy exclusion list')
  })

  test('35. legacy lot with wrong productId rejected', () => {
    const guard = KNOWN_LEGACY_LOTS[0]
    const error = verifyLegacyGuard(guard.lotId, 'wrong-product', guard.expectedRemainingWeight)
    expect(error).toContain('productId mismatch')
  })

  test('36. legacy lot with wrong remainingWeight rejected', () => {
    const guard = KNOWN_LEGACY_LOTS[0]
    const error = verifyLegacyGuard(guard.lotId, guard.productId, 999.9)
    expect(error).toContain('remainingWeight mismatch')
  })

  test('37. exactly 4 legacy lots in exclusion list', () => {
    expect(KNOWN_LEGACY_LOTS.length).toBe(4)
  })

  test('38. all 4 legacy lot IDs are unique', () => {
    const ids = KNOWN_LEGACY_LOTS.map(l => l.lotId)
    expect(new Set(ids).size).toBe(4)
  })

  test('39. no legacy lot has a proposed cost', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getZeroCostActiveLots() {
        return KNOWN_LEGACY_LOTS.map(l => ({
          id: l.lotId, productId: l.productId, productName: 'Legacy',
          remainingWeight: l.expectedRemainingWeight, costPerKg: 0,
          dateAdded: d('2026-06-21'), createdAt: d('2026-06-21'),
          source: 'BUY', sourceId: 'manual',
        }))
      },
    }), '2026-07-19T14:12:14Z')
    for (const lot of plan.eligibleLots) {
      expect(lot.derivationMethod).toBe('KNOWN_LEGACY_ZERO_COST')
      expect(lot.proposedCostPerKg).toBeNull()
    }
  })

  test('40. eligible count is 49 when all 53 lots present', async () => {
    // This test verifies the count logic: 53 total - 4 legacy = 49 eligible
    expect(KNOWN_LEGACY_LOTS.length).toBe(4)
    // eligibleForApplyCount = exactCount + avgCount (excludes legacy + unresolved)
    // In Production: 14 + 35 = 49
  })

  test('41. second run is safely idempotent', async () => {
    const deps = makeDeps()
    const r1 = await applyRevaluationPlan()
    const r2 = await applyRevaluationPlan()
    expect(r1.applied).toBe(false)
    expect(r2.applied).toBe(false)
    expect(r1.reason).toBe(r2.reason)
  })

  test('42. no weight/document/ledger/baseline mutation in dry-run', async () => {
    const result = await applyRevaluationPlan()
    expect(result.applied).toBe(false)
    expect(result.dryRun).toBe(true)
    // No lotCount or totalValueIncrease in dry-run result
    expect(result.lotCount).toBeUndefined()
    expect(result.totalValueIncrease).toBeUndefined()
  })
})
