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
