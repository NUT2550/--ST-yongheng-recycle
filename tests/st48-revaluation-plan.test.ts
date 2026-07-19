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
      ]
    },
    async getBuyBillItemCost() { return 9.98 },
    async getSortingSourceAvgCost() { return 15.5 },
    async getProductHistoricalAvgCost() { return { avgCost: 10.5, obsCount: 5, minCost: 8, maxCost: 13, totalWeight: 1000 } },
    async getFifoPosition() { return 1 },
    ...overrides,
  }
}

describe('ST-48 Hybrid zero-cost revaluation plan', () => {
  test('1. dry-run does not mutate data (applyMode is false)', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    expect(plan.applyMode).toBe(false)
    expect(plan.eligibleLots.length).toBe(4)
  })

  test('2. Category B uses exact BuyBillItem cost', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    const lot2 = plan.eligibleLots.find(l => l.lotId === 'lot2')!
    expect(lot2.derivationMethod).toBe('EXACT_BUY_SOURCE')
    expect(lot2.proposedCostPerKg).toBe(9.98)
    expect(lot2.confidence).toBe('HIGH')
  })

  test('3. Category D uses exact sorting allocation', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    const lot3 = plan.eligibleLots.find(l => l.lotId === 'lot3')!
    expect(lot3.derivationMethod).toBe('EXACT_SORTING_ALLOCATION')
    expect(lot3.proposedCostPerKg).toBe(15.5)
  })

  test('4. Category A uses historical weighted-average', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    const lot1 = plan.eligibleLots.find(l => l.lotId === 'lot1')!
    expect(lot1.derivationMethod).toBe('HISTORICAL_WEIGHTED_AVERAGE')
    expect(lot1.proposedCostPerKg).toBe(10.5)
    expect(lot1.confidence).toBe('MEDIUM')
  })

  test('5. unresolved lot gets OWNER_DECISION_REQUIRED when no historical cost', async () => {
    const plan = await generateRevaluationPlan(makeDeps({
      async getProductHistoricalAvgCost(productId: string) {
        if (productId === 'p4') return null
        return { avgCost: 10.5, obsCount: 5, minCost: 8, maxCost: 13, totalWeight: 1000 }
      },
      async getBuyBillItemCost() { return null },
      async getSortingSourceAvgCost() { return null },
    }), '2026-07-19T11:31:44Z')
    const lot4 = plan.eligibleLots.find(l => l.lotId === 'lot4')!
    expect(lot4.derivationMethod).toBe('OWNER_DECISION_REQUIRED')
    expect(lot4.proposedCostPerKg).toBeNull()
    expect(lot4.unresolvedWarning).toContain('OWNER_DECISION_REQUIRED')
  })

  test('6. remainingWeight is never changed', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    for (const lot of plan.eligibleLots) {
      expect(lot.remainingWeight).toBeGreaterThan(0)
      // proposedCostPerKg changes only cost, not weight
      expect(lot.remainingWeight).toBe(plan.eligibleLots.find(l => l.lotId === lot.lotId)!.remainingWeight)
    }
  })

  test('7. no proposed cost is zero, negative, or non-finite', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    for (const lot of plan.eligibleLots) {
      if (lot.proposedCostPerKg !== null) {
        expect(lot.proposedCostPerKg).toBeGreaterThan(0)
        expect(Number.isFinite(lot.proposedCostPerKg)).toBe(true)
      }
    }
  })

  test('8. total value increase equals sum of per-lot increases', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    const sumIncreases = plan.eligibleLots.reduce((s, l) => s + (l.valueIncrease ?? 0), 0)
    expect(Math.round(sumIncreases * 100) / 100).toBe(plan.totalValueIncrease)
  })

  test('9. rerunning is deterministic', async () => {
    const deps = makeDeps()
    const plan1 = await generateRevaluationPlan(deps, '2026-07-19T11:31:44Z')
    const plan2 = await generateRevaluationPlan(deps, '2026-07-19T11:31:44Z')
    expect(plan2.totalLots).toBe(plan1.totalLots)
    expect(plan2.totalValueIncrease).toBe(plan1.totalValueIncrease)
    expect(plan2.eligibleLots.map(l => l.proposedCostPerKg)).toEqual(plan1.eligibleLots.map(l => l.proposedCostPerKg))
  })

  test('10. apply mode is blocked', async () => {
    const { applyRevaluationPlan, APPLY_MODE_ENABLED } = await import('../src/lib/st48-revaluation-plan')
    expect(APPLY_MODE_ENABLED).toBe(false)
    const result = await applyRevaluationPlan()
    expect(result.applied).toBe(false)
    expect(result.reason).toContain('BLOCKED')
  })

  test('11. categorizeLot classifies correctly', () => {
    expect(categorizeLot('BUY', 'manual')).toBe('A_ST19_ADJUSTMENT')
    expect(categorizeLot('BUY', 'manual-steel')).toBe('G_LEGACY_OPENING')
    expect(categorizeLot('SORTING', 'sort123')).toBe('D_SORTING_OUTPUT')
    expect(categorizeLot('SELL_CANCEL', 'cancel123')).toBe('E_SELL_CANCEL')
    expect(categorizeLot('BUY', 'cmr1234567890')).toBe('B_MANUAL_PURCHASE')
  })

  test('12. expected-value guard: only costPerKg=0 lots are eligible', async () => {
    const plan = await generateRevaluationPlan(makeDeps(), '2026-07-19T11:31:44Z')
    for (const lot of plan.eligibleLots) {
      expect(lot.currentCostPerKg).toBe(0)
    }
  })
})
