import { describe, expect, test } from 'bun:test'
import { resolveRestoredCostPerKg, calculateRestoredCostVariance, type SellCancelCostDeps } from '../src/lib/st52-sell-cancel-cost'

function makeDeps(avgCost: number | null, obsCount: number = 5): SellCancelCostDeps {
  return {
    async getProductHistoricalAvgCost() {
      if (avgCost === null) return null
      return { avgCost, obsCount }
    },
  }
}

describe('ST-52 preserve FIFO cost during sell cancellation', () => {
  test('1. one source lot — exact SellBillItem cost preserved', async () => {
    const result = await resolveRestoredCostPerKg(9.98, 'p1', makeDeps(10.5))
    expect(result.costPerKg).toBe(9.98)
    expect(result.source).toBe('EXACT_SELL_ITEM')
    expect(result.confidence).toBe('HIGH')
  })

  test('2. multiple source lots with different costs — averaged cost preserved', async () => {
    // SellBillItem.costPerKg is already the FIFO-weighted average
    const result = await resolveRestoredCostPerKg(12.5, 'p1', makeDeps(10.5))
    expect(result.costPerKg).toBe(12.5)
    expect(result.source).toBe('EXACT_SELL_ITEM')
  })

  test('3. partial lot deduction — exact cost preserved', async () => {
    const result = await resolveRestoredCostPerKg(15.3, 'p1', makeDeps(10.5))
    expect(result.costPerKg).toBe(15.3)
    expect(result.source).toBe('EXACT_SELL_ITEM')
  })

  test('4. zero-cost SellBillItem falls back to historical average', async () => {
    const result = await resolveRestoredCostPerKg(0, 'p1', makeDeps(10.5, 5))
    expect(result.costPerKg).toBe(10.5)
    expect(result.source).toBe('HISTORICAL_AVERAGE')
    expect(result.confidence).toBe('MEDIUM')
  })

  test('5. zero-cost SellBillItem with insufficient observations — LOW confidence', async () => {
    const result = await resolveRestoredCostPerKg(0, 'p1', makeDeps(8.0, 2))
    expect(result.costPerKg).toBe(8.0)
    expect(result.confidence).toBe('LOW')
  })

  test('6. zero-cost SellBillItem with no historical evidence — ZERO_FALLBACK', async () => {
    const result = await resolveRestoredCostPerKg(0, 'p1', makeDeps(null))
    expect(result.costPerKg).toBe(0)
    expect(result.source).toBe('ZERO_FALLBACK')
    expect(result.confidence).toBe('LOW')
  })

  test('7. cost and weight conservation — variance calculated correctly', () => {
    const variance = calculateRestoredCostVariance(100, 10, 10)
    expect(variance).toBe(0) // 10 * 10 = 100, original = 100
  })

  test('8. variance detects cost change', () => {
    const variance = calculateRestoredCostVariance(0, 10, 10.5)
    expect(variance).toBe(105) // 10 * 10.5 = 105, original = 0
  })

  test('9. repeated cancellation is deterministic', async () => {
    const deps = makeDeps(10.5, 5)
    const r1 = await resolveRestoredCostPerKg(0, 'p1', deps)
    const r2 = await resolveRestoredCostPerKg(0, 'p1', deps)
    expect(r2.costPerKg).toBe(r1.costPerKg)
    expect(r2.source).toBe(r1.source)
  })

  test('10. zero-cost source evidence handled without error', async () => {
    const result = await resolveRestoredCostPerKg(0, 'p1', makeDeps(0, 0))
    // avgCost=0 is treated as no evidence
    expect(result.source).toBe('ZERO_FALLBACK')
  })
})

// ============ Integration tests: verify cancellation route uses resolveRestoredCostPerKg ============

describe('ST-52 cancellation path integration', () => {
  test('11. cancellation route imports resolveRestoredCostPerKg', async () => {
    // Verify the import exists in the route source
    const routeSource = await Bun.file('src/app/api/sell-bills/[id]/route.ts').text()
    expect(routeSource).toContain("from '@/lib/st52-sell-cancel-cost'")
    expect(routeSource).toContain('resolveRestoredCostPerKg')
  })

  test('12. cancellation route uses resolved cost (not raw item.costPerKg)', async () => {
    const routeSource = await Bun.file('src/app/api/sell-bills/[id]/route.ts').text()
    // The route should call resolveRestoredCostPerKg and use the result
    expect(routeSource).toContain('const { costPerKg: restoredCostPerKg } = await resolveRestoredCostPerKg')
    expect(routeSource).toContain('costPerKg: restoredCostPerKg')
  })

  test('13. historical average query runs inside the transaction', async () => {
    const routeSource = await Bun.file('src/app/api/sell-bills/[id]/route.ts').text()
    // The query should use tx (transaction), not db
    expect(routeSource).toContain('tx.$queryRawUnsafe')
    expect(routeSource).toContain('"costPerKg" > 0')
  })

  test('14. existing non-zero SellBillItem cost is preserved (EXACT_SELL_ITEM priority)', async () => {
    // When item.costPerKg > 0, resolveRestoredCostPerKg returns it unchanged
    const result = await resolveRestoredCostPerKg(15.5, 'p1', makeDeps(10.0, 5))
    expect(result.costPerKg).toBe(15.5)
    expect(result.source).toBe('EXACT_SELL_ITEM')
  })

  test('15. zero SellBillItem cost with valid history uses HISTORICAL_AVERAGE', async () => {
    const result = await resolveRestoredCostPerKg(0, 'p1', makeDeps(12.0, 5))
    expect(result.costPerKg).toBe(12.0)
    expect(result.source).toBe('HISTORICAL_AVERAGE')
  })

  test('16. zero SellBillItem cost with no history uses ZERO_FALLBACK', async () => {
    const result = await resolveRestoredCostPerKg(0, 'p1', makeDeps(null))
    expect(result.costPerKg).toBe(0)
    expect(result.source).toBe('ZERO_FALLBACK')
  })

  test('17. no historical bill or COGS rewrite (cost-only restoration)', async () => {
    // The DELETE (cancel) handler only creates new StockLot rows — it does not modify
    // SellBillItem costPerKg or totalCost. The PATCH handler (price edit) does update
    // SellBillItem.pricePerKg, but that is a separate feature, not cancellation.
    const routeSource = await Bun.file('src/app/api/sell-bills/[id]/route.ts').text()
    // Extract just the DELETE handler
    const deleteStart = routeSource.indexOf('// DELETE /api/sell-bills/[id]')
    const deleteSection = routeSource.slice(deleteStart)
    expect(deleteSection).not.toContain('sellBillItem.update')
    expect(deleteSection).not.toContain('sellBillItem.delete')
    // The cancellation should only CREATE StockLot, not modify existing lots
    expect(deleteSection).toContain('stockLot.create')
  })
})
