import { movementKey, preciseWeight, type StockMovementDraft } from './stock-movement-ledger'

export interface BaselineDraft {
  id: string
  generation: number
  baselineDate: Date
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED'
  items: Array<{ id: string; productId: string; weight: number; effectiveStartDate: Date }>
}

export interface BaselineApprovalDeps {
  findBaseline(id: string): Promise<BaselineDraft | null>
  findApprovedBaseline(): Promise<{ id: string } | null>
  transaction<T>(fn: (tx: {
    approveBaseline(id: string, data: { approvedAt: Date; approvedById: string; approvedByName: string }): Promise<void>
    createMovements(rows: StockMovementDraft[]): Promise<void>
  }) => Promise<T>): Promise<T>
}

/**
 * Approves once and emits one BASELINE row per non-zero product. Database unique
 * constraints protect both the active generation and each idempotency key.
 */
export async function approveStockBaseline(
  deps: BaselineApprovalDeps,
  baselineId: string,
  actor: { userId: string; name: string },
  approvedAt = new Date(),
): Promise<{ movementCount: number; alreadyApproved: boolean }> {
  const baseline = await deps.findBaseline(baselineId)
  if (!baseline) throw new Error('Baseline not found')
  if (baseline.status === 'SUPERSEDED') throw new Error('Superseded baseline cannot be approved')
  if (baseline.status === 'APPROVED') return { movementCount: 0, alreadyApproved: true }
  if (!actor.userId.trim() || !actor.name.trim()) throw new Error('Baseline approval requires an authenticated actor')
  if (baseline.items.length === 0) throw new Error('Empty baseline cannot be approved')
  const productIds = new Set<string>()
  for (const item of baseline.items) {
    if (!item.id || !item.productId) throw new Error('Baseline contains an incomplete item')
    if (!(item.effectiveStartDate instanceof Date) || !Number.isFinite(item.effectiveStartDate.getTime())) {
      throw new Error('Baseline item effective start date is invalid')
    }
    if (productIds.has(item.productId)) throw new Error('Baseline contains a duplicate product')
    productIds.add(item.productId)
    if (!Number.isFinite(item.weight) || preciseWeight(item.weight) < 0) {
      throw new Error('Baseline item weight must be finite and non-negative')
    }
  }
  const active = await deps.findApprovedBaseline()
  if (active && active.id !== baseline.id) throw new Error('An approved baseline already exists')
  const movements: StockMovementDraft[] = baseline.items
    .filter(item => preciseWeight(item.weight) > 0)
    .map(item => ({
      productId: item.productId,
      businessDate: item.effectiveStartDate,
      movementType: 'BASELINE',
      signedWeight: preciseWeight(item.weight),
      sourceType: 'STOCK_BASELINE',
      sourceId: baseline.id,
      sourceItemId: item.id,
      sourceDocumentNumber: `BASELINE-G${baseline.generation}`,
      idempotencyKey: movementKey(['STOCK_BASELINE', baseline.id, item.id, 'baseline']),
      reason: 'Owner-approved closing baseline',
      metadata: { generation: baseline.generation, interpretation: 'OPENING_START_OF_BUSINESS_DATE', effectiveStartDate: item.effectiveStartDate.toISOString() },
      createdById: actor.userId,
      createdByName: actor.name,
    }))
  await deps.transaction(async tx => {
    await tx.createMovements(movements)
    await tx.approveBaseline(baseline.id, { approvedAt, approvedById: actor.userId, approvedByName: actor.name })
  })
  return { movementCount: movements.length, alreadyApproved: false }
}
