import {
  computeProductWeightedAverage,
  reconstructSortingCost,
  type Confidence,
  type CostMethod,
  type CostObservation,
  type SortingEvidence,
  type WeightedCostEvidence,
} from './st48-cost-engine'

export interface LegacyGuard { lotId: string; productId: string; expectedRemainingWeight: number }
export const ST48_LEGACY_GUARDS: readonly LegacyGuard[] = [
  { lotId: 'cmr0kk5va002ylb04x87wh44s', productId: 'cmr09vcvh0016l105bpvmhfwq', expectedRemainingWeight: 3.5 },
  { lotId: 'cmr0kk7zt0034lb04yick2bc5', productId: 'cmr09vcvi001il105ty4h75k8', expectedRemainingWeight: 1.6 },
  { lotId: 'cmr3fth8n000yjo043uwrz43r', productId: 'cmr09vcvi001kl105f1e6emmx', expectedRemainingWeight: 0.1 },
  { lotId: 'cmqoyjyre001bqjihd8l0u8gy', productId: 'prod_mqgp9fgoheos0xee1ntl0r27', expectedRemainingWeight: 30.5 },
]

export interface CandidateLot {
  lotId: string; productId: string; sourceType: string; sourceId: string | null
  remainingWeight: number; currentCostPerKg: number
}
export interface ExactEvidence { costPerKg: number; confidence: Confidence }
export interface EvidenceAdapter {
  loadCandidates(): Promise<CandidateLot[]>
  loadExactSource(lot: CandidateLot): Promise<ExactEvidence | null>
  loadSorting(lot: CandidateLot): Promise<SortingEvidence | null>
  loadProductHistory(productId: string): Promise<CostObservation[]>
}
export interface PlanRow extends CandidateLot {
  proposedCostPerKg: number | null; derivationMethod: CostMethod; confidence: Confidence
  weightedEvidence: WeightedCostEvidence | null
}
export interface RevaluationPlan { rows: PlanRow[]; allowlist: PlanRow[]; legacy: PlanRow[]; unresolved: PlanRow[]; totalValueIncrease: number }

function legacyGuard(lotId: string): LegacyGuard | undefined { return ST48_LEGACY_GUARDS.find(row => row.lotId === lotId) }
function assertBaseLot(lot: CandidateLot): void {
  if (!lot.lotId || !lot.productId || !lot.sourceType || !Number.isFinite(lot.remainingWeight) || lot.remainingWeight <= 0) throw new Error(`Invalid candidate ${lot.lotId}`)
  if (lot.currentCostPerKg !== 0) throw new Error(`Cost drift for ${lot.lotId}`)
}

export async function buildRevaluationPlan(adapter: EvidenceAdapter): Promise<RevaluationPlan> {
  const candidates = await adapter.loadCandidates()
  if (new Set(candidates.map(row => row.lotId)).size !== candidates.length) throw new Error('Duplicate candidate lot ID')
  const rows: PlanRow[] = []
  for (const lot of [...candidates].sort((a, b) => a.lotId.localeCompare(b.lotId))) {
    assertBaseLot(lot)
    const guard = legacyGuard(lot.lotId)
    if (guard) {
      if (lot.productId !== guard.productId) throw new Error(`Legacy product drift for ${lot.lotId}`)
      if (Math.abs(lot.remainingWeight - guard.expectedRemainingWeight) > 0.000001) throw new Error(`Legacy weight drift for ${lot.lotId}`)
      rows.push({ ...lot, proposedCostPerKg: null, derivationMethod: 'KNOWN_LEGACY_ZERO_COST', confidence: 'HIGH', weightedEvidence: null })
      continue
    }
    const exact = await adapter.loadExactSource(lot)
    if (exact && Number.isFinite(exact.costPerKg) && exact.costPerKg > 0) {
      rows.push({ ...lot, proposedCostPerKg: exact.costPerKg, derivationMethod: 'EXACT_SOURCE_COST', confidence: exact.confidence, weightedEvidence: null })
      continue
    }
    if (lot.sourceType === 'SORTING') {
      const sorting = await adapter.loadSorting(lot)
      const derived = sorting ? reconstructSortingCost(sorting) : null
      if (derived) {
        rows.push({ ...lot, proposedCostPerKg: derived.costPerKg, derivationMethod: derived.method, confidence: derived.confidence, weightedEvidence: null })
        continue
      }
    }
    const weighted = computeProductWeightedAverage(lot.productId, await adapter.loadProductHistory(lot.productId))
    if (weighted) rows.push({ ...lot, proposedCostPerKg: weighted.weightedAverage, derivationMethod: 'PRODUCT_HISTORICAL_WEIGHTED_AVERAGE', confidence: weighted.confidence, weightedEvidence: weighted })
    else rows.push({ ...lot, proposedCostPerKg: null, derivationMethod: 'OWNER_DECISION_REQUIRED', confidence: 'LOW', weightedEvidence: null })
  }
  const allowlist = rows.filter(row => row.proposedCostPerKg !== null && row.derivationMethod !== 'KNOWN_LEGACY_ZERO_COST')
  const legacy = rows.filter(row => row.derivationMethod === 'KNOWN_LEGACY_ZERO_COST')
  const unresolved = rows.filter(row => row.derivationMethod === 'OWNER_DECISION_REQUIRED')
  const totalValueIncrease = Math.round(allowlist.reduce((sum, row) => sum + row.remainingWeight * row.proposedCostPerKg!, 0) * 100) / 100
  return { rows, allowlist, legacy, unresolved, totalValueIncrease }
}

export function assertNoLegacyAllowlist(rows: readonly Pick<PlanRow, 'lotId'>[]): void {
  const legacyIds = new Set(ST48_LEGACY_GUARDS.map(row => row.lotId))
  if (rows.some(row => legacyIds.has(row.lotId))) throw new Error('Legacy lot cannot enter allowlist')
}

