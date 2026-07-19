/**
 * ST-52: Preserve FIFO cost during sell cancellation compensation.
 *
 * Root cause: When a sale is cancelled, the compensation creates a new StockLot
 * with source='SELL_CANCEL' using the SellBillItem's averaged costPerKg. If the
 * original sale consumed zero-cost source lots, the SellBillItem.costPerKg is 0,
 * producing a zero-cost restored lot.
 *
 * Fix: When the SellBillItem.costPerKg is 0, fall back to the product's
 * historical weighted-average cost (from non-zero-cost lots). This ensures
 * the restored lot has a defensible cost even when the original sale consumed
 * zero-cost source lots.
 *
 * This is a cost-preservation fallback. The ideal fix (persisting original
 * deducted lot IDs and restoring to them individually) requires a schema
 * change and is out of scope for ST-52.
 */
import { preciseWeight } from './stock-movement-ledger'

export interface SellCancelCostDeps {
  getProductHistoricalAvgCost(productId: string): Promise<{ avgCost: number; obsCount: number } | null>
}

/**
 * Determine the costPerKg to use when restoring stock after a sell cancellation.
 *
 * Priority:
 * 1. SellBillItem.costPerKg (if > 0) — preserves the original FIFO-averaged cost
 * 2. Product historical weighted-average (if SellBillItem.costPerKg is 0)
 * 3. 0 (if no historical cost evidence — Owner decision required via ST-48)
 */
export async function resolveRestoredCostPerKg(
  sellBillItemCostPerKg: number,
  productId: string,
  deps: SellCancelCostDeps,
): Promise<{ costPerKg: number; source: 'EXACT_SELL_ITEM' | 'HISTORICAL_AVERAGE' | 'ZERO_FALLBACK'; confidence: 'HIGH' | 'MEDIUM' | 'LOW' }> {
  const exactCost = preciseWeight(sellBillItemCostPerKg)
  if (exactCost > 0) {
    return { costPerKg: exactCost, source: 'EXACT_SELL_ITEM', confidence: 'HIGH' }
  }

  // Fall back to product historical weighted-average
  const hist = await deps.getProductHistoricalAvgCost(productId)
  if (hist !== null && hist.avgCost > 0) {
    return {
      costPerKg: preciseWeight(hist.avgCost),
      source: 'HISTORICAL_AVERAGE',
      confidence: hist.obsCount >= 3 ? 'MEDIUM' : 'LOW',
    }
  }

  // No evidence — return 0 (will be flagged by ST-48 revaluation)
  return { costPerKg: 0, source: 'ZERO_FALLBACK', confidence: 'LOW' }
}

/**
 * Conservation check: total restored cost should approximate original total cost.
 * Returns the variance (restored - original). A non-zero variance indicates
 * that the historical-average fallback changed the cost.
 */
export function calculateRestoredCostVariance(
  originalTotalCost: number,
  restoredWeight: number,
  restoredCostPerKg: number,
): number {
  const restoredTotal = preciseWeight(restoredWeight) * preciseWeight(restoredCostPerKg)
  return preciseWeight(restoredTotal - originalTotalCost)
}
