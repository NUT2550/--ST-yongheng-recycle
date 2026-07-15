/**
 * ST-40: Pure helpers for StockTransfer positive-yield + cost conservation.
 *
 * When dismantling output exceeds the estimated net source weight (e.g. purchase
 * deducted for contamination but actual recovered output is higher), the system
 * must allow the save AND conserve total source cost across outputs — NOT inflate
 * output cost by using sourceCostPerKg × outputWeight.
 *
 * Cost conservation rule:
 *   allocatableSourceCost = sourceTotalCost (the FIFO cost carried by source stock)
 *   totalNonWasteOutputWeight = sum of non-waste output item weights
 *   allocatedCostPerKg = allocatableSourceCost / totalNonWasteOutputWeight
 *   each non-waste item.totalCost = proportional share
 *   each non-waste item.costPerKg = item.totalCost / item.weight
 *   rounding remainder → last eligible item
 *   sum(item.totalCost) must equal sourceTotalCost within tolerance
 *
 * Gain/loss rules:
 *   lossWeight = max(sourceWeight - outputTotalWeight, 0)
 *   gainWeight = max(outputTotalWeight - sourceWeight, 0)
 *   weightVariance = outputTotalWeight - sourceWeight (signed)
 *
 * Positive yield is allowed only for businessType แกะของ (or null/blank default).
 * คัดแยก retains the hard block (output must not exceed source) unless explicitly changed.
 */

export const YIELD_WEIGHT_TOLERANCE = 0.01 // kg — output within this of source is "exact"

export interface GainLossResult {
  outputTotalWeight: number
  lossWeight: number // always >= 0
  gainWeight: number // always >= 0
  weightVariance: number // signed: output - source
}

/**
 * Calculate gain/loss/variance from source + output totals.
 * Pure function — no DB, no side effects.
 */
export function calculateGainLoss(
  sourceWeight: number,
  outputTotalWeight: number
): GainLossResult {
  const variance = Math.round((outputTotalWeight - sourceWeight) * 100) / 100
  return {
    outputTotalWeight: Math.round(outputTotalWeight * 100) / 100,
    lossWeight: Math.round(Math.max(sourceWeight - outputTotalWeight, 0) * 100) / 100,
    gainWeight: Math.round(Math.max(outputTotalWeight - sourceWeight, 0) * 100) / 100,
    weightVariance: variance,
  }
}

export interface AllocatableItem {
  productId: string
  weight: number
  isWaste: boolean
}

export interface AllocatedItemCost {
  productId: string
  weight: number
  isWaste: boolean
  costPerKg: number
  totalCost: number
}

export interface AllocationResult {
  items: AllocatedItemCost[]
  allocatedTotalCost: number // sum of non-waste item.totalCost — must equal sourceTotalCost
  allocatedCostPerKg: number // sourceTotalCost / totalNonWasteOutputWeight (for reference)
  roundingRemainderCents: number // applied to last item (for audit)
}

/**
 * Allocate sourceTotalCost across non-waste output items proportionally by weight.
 *
 * - Waste items receive costPerKg=0, totalCost=0 (existing policy).
 * - Non-waste items share the sourceTotalCost proportionally.
 * - Rounding: calculate in cents (satang), assign remainder to the last non-waste item.
 * - Guarantees: sum(nonWaste totalCost) === sourceTotalCost (within 1 cent for float).
 *
 * Pure function — no DB, no side effects.
 */
export function allocateOutputCosts(
  sourceTotalCost: number,
  items: AllocatableItem[]
): AllocationResult {
  const nonWasteItems = items.filter((i) => !i.isWaste && i.weight > 0)
  const totalNonWasteWeight = nonWasteItems.reduce((s, i) => s + i.weight, 0)

  // Edge case: no non-waste output → all cost stays on source (loss). No allocation.
  if (totalNonWasteWeight <= 0 || nonWasteItems.length === 0) {
    return {
      items: items.map((i) => ({
        productId: i.productId,
        weight: i.weight,
        isWaste: i.isWaste,
        costPerKg: 0,
        totalCost: 0,
      })),
      allocatedTotalCost: 0,
      allocatedCostPerKg: 0,
      roundingRemainderCents: 0,
    }
  }

  const sourceTotalCostCents = Math.round(sourceTotalCost * 100)
  const allocatedCostPerKg = sourceTotalCost / totalNonWasteWeight

  // First pass: proportional allocation in cents
  let allocatedCents = 0
  const itemCostsCents: number[] = []
  for (let i = 0; i < nonWasteItems.length; i++) {
    const item = nonWasteItems[i]
    let itemCents: number
    if (i === nonWasteItems.length - 1) {
      // Last item gets the remainder to guarantee exact conservation
      itemCents = sourceTotalCostCents - allocatedCents
    } else {
      itemCents = Math.round((item.weight / totalNonWasteWeight) * sourceTotalCostCents)
    }
    itemCostsCents.push(itemCents)
    allocatedCents += itemCents
  }

  // Build result array preserving original order (waste items get 0 cost)
  let nonWasteIdx = 0
  const resultItems: AllocatedItemCost[] = items.map((i) => {
    if (i.isWaste || i.weight <= 0) {
      return {
        productId: i.productId,
        weight: i.weight,
        isWaste: i.isWaste,
        costPerKg: 0,
        totalCost: 0,
      }
    }
    const cents = itemCostsCents[nonWasteIdx]
    nonWasteIdx++
    const totalCost = cents / 100
    const costPerKg = i.weight > 0 ? totalCost / i.weight : 0
    return {
      productId: i.productId,
      weight: i.weight,
      isWaste: i.isWaste,
      costPerKg: Math.round(costPerKg * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
    }
  })

  const allocatedTotalCost = itemCostsCents.reduce((s, c) => s + c, 0) / 100
  const remainder = sourceTotalCostCents - itemCostsCents.reduce((s, c) => s + c, 0)

  return {
    items: resultItems,
    allocatedTotalCost: Math.round(allocatedTotalCost * 100) / 100,
    allocatedCostPerKg: Math.round(allocatedCostPerKg * 100) / 100,
    roundingRemainderCents: remainder,
  }
}

/**
 * Verify cost conservation: sum of non-waste item.totalCost must equal sourceTotalCost.
 * Returns true if within 1 cent tolerance.
 */
export function verifyCostConservation(
  sourceTotalCost: number,
  items: AllocatedItemCost[]
): boolean {
  const allocated = items
    .filter((i) => !i.isWaste)
    .reduce((s, i) => s + Math.round(i.totalCost * 100), 0)
  const source = Math.round(sourceTotalCost * 100)
  return Math.abs(allocated - source) <= 1 // 1 cent tolerance
}

/**
 * ST-40: Determine if positive yield is allowed for the given businessType.
 * แกะของ + null/blank → allowed (dismantling may recover more than estimated net).
 * คัดแยก → NOT allowed (sorting should not produce more than source — that would be a
 *   business error indicating misclassification or data entry mistake).
 */
export function isPositiveYieldAllowed(businessType: string | null | undefined): boolean {
  if (!businessType || !businessType.trim()) return true // null/blank defaults to แกะของ
  return businessType.trim() === 'แกะของ'
}
