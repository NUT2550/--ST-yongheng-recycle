export const COST_SCALE = BigInt(1_000_000)
const BIGINT_ZERO = BigInt(0)
const BIGINT_TWO = BigInt(2)

export type CostMethod =
  | 'EXACT_SOURCE_COST'
  | 'DETERMINISTIC_SOURCE_RECONSTRUCTION'
  | 'DETERMINISTIC_SORTING_RECONSTRUCTION'
  | 'PRODUCT_HISTORICAL_WEIGHTED_AVERAGE'
  | 'OWNER_DECISION_REQUIRED'
  | 'KNOWN_LEGACY_ZERO_COST'

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW'

export interface CostObservation {
  productId: string
  referenceWeight: number
  costPerKg: number
  occurredAt: Date
  valid: boolean
  cancelled?: boolean
  proposedCorrection?: boolean
}

export interface WeightedCostEvidence {
  observationCount: number
  excludedRowCount: number
  referenceTotalWeight: number
  weightedNumerator: number
  weightedAverage: number
  median: number
  min: number
  max: number
  dateRange: { from: string; to: string }
  confidence: Confidence
}

function scaled(value: number): bigint {
  if (!Number.isFinite(value)) throw new Error('Non-finite decimal input')
  return BigInt(Math.round(value * Number(COST_SCALE)))
}

export function decimal6(value: number): string {
  const units = scaled(value)
  const sign = units < BIGINT_ZERO ? '-' : ''
  const absolute = units < BIGINT_ZERO ? -units : units
  return `${sign}${absolute / COST_SCALE}.${(absolute % COST_SCALE).toString().padStart(6, '0')}`
}

export function computeProductWeightedAverage(
  productId: string,
  rows: readonly CostObservation[],
): WeightedCostEvidence | null {
  const included = rows.filter(row =>
    row.productId === productId && row.valid && !row.cancelled && !row.proposedCorrection &&
    Number.isFinite(row.referenceWeight) && row.referenceWeight > 0 &&
    Number.isFinite(row.costPerKg) && row.costPerKg > 0,
  )
  const excludedRowCount = rows.length - included.length
  if (included.length === 0) return null

  let weightUnits = BIGINT_ZERO
  let numeratorUnits = BIGINT_ZERO
  for (const row of included) {
    const weight = scaled(row.referenceWeight)
    const cost = scaled(row.costPerKg)
    weightUnits += weight
    numeratorUnits += weight * cost
  }
  if (weightUnits <= BIGINT_ZERO) return null
  const averageUnits = (numeratorUnits + weightUnits / BIGINT_TWO) / weightUnits
  const costs = included.map(row => row.costPerKg).sort((a, b) => a - b)
  const middle = Math.floor(costs.length / 2)
  const median = costs.length % 2 ? costs[middle] : (costs[middle - 1] + costs[middle]) / 2
  const dates = included.map(row => row.occurredAt.toISOString()).sort()
  const weight = Number(weightUnits) / Number(COST_SCALE)
  const weightedNumerator = Number(numeratorUnits) / Number(COST_SCALE * COST_SCALE)
  return {
    observationCount: included.length,
    excludedRowCount,
    referenceTotalWeight: weight,
    weightedNumerator,
    weightedAverage: Number(averageUnits) / Number(COST_SCALE),
    median,
    min: costs[0],
    max: costs[costs.length - 1],
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    confidence: included.length >= 3 && weight > 0 ? 'MEDIUM' : 'LOW',
  }
}

export interface SortingEvidence {
  sortingBillId: string
  sourceProductId: string
  consumedQuantity: number
  consumedTotalCost: number | null
  outputQuantity: number
  lossWeight: number
  gainWeight: number
  allocationRule: 'PROPORTIONAL_OUTPUT_WEIGHT'
  hasExactSourceLayers: boolean
}

export function reconstructSortingCost(evidence: SortingEvidence): {
  method: Extract<CostMethod, 'EXACT_SOURCE_COST' | 'DETERMINISTIC_SORTING_RECONSTRUCTION'>
  costPerKg: number
  confidence: Confidence
} | null {
  const values = [evidence.consumedQuantity, evidence.outputQuantity, evidence.lossWeight, evidence.gainWeight]
  if (values.some(value => !Number.isFinite(value)) || evidence.outputQuantity <= 0 || evidence.consumedQuantity <= 0) return null
  if (evidence.consumedTotalCost === null || !Number.isFinite(evidence.consumedTotalCost) || evidence.consumedTotalCost <= 0) return null
  const expectedOutput = evidence.consumedQuantity - evidence.lossWeight + evidence.gainWeight
  if (Math.abs(expectedOutput - evidence.outputQuantity) > 0.000001) return null
  return {
    method: evidence.hasExactSourceLayers ? 'EXACT_SOURCE_COST' : 'DETERMINISTIC_SORTING_RECONSTRUCTION',
    costPerKg: Number(decimal6(evidence.consumedTotalCost / evidence.outputQuantity)),
    confidence: evidence.hasExactSourceLayers ? 'HIGH' : 'MEDIUM',
  }
}
