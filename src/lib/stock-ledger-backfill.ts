import {
  buildPurchaseMovements, buildSaleMovements, buildSortingMovements,
  buildTransferMovements, preciseWeight, type StockMovementDraft,
} from './stock-movement-ledger'

export type BackfillClassification = 'SAFE' | 'AMBIGUOUS' | 'UNSUPPORTED_LEGACY' | 'INCONSISTENT'

export interface BackfillDocument {
  kind: 'BUY' | 'SELL' | 'SORTING' | 'TRANSFER'
  id: string
  billNumber?: string | null
  date: Date
  createdAt: Date
  isCancelled: boolean
  sourceProductId?: string
  sourceWeight?: number
  items: Array<{ id: string; productId: string; weight: number; isWaste?: boolean }>
  gainWeight?: number
  lossWeight?: number
  businessType?: string | null
}

export interface BackfillResult {
  dryRun: true
  proposedMovements: StockMovementDraft[]
  duplicates: string[]
  findings: Array<{ sourceId: string; classification: BackfillClassification; reason: string }>
  totalsByProduct: Record<string, number>
  reconciliationByProduct: Record<string, {
    proposedMovementWeight: number
    currentStockLotWeight: number | null
    differenceWeight: number | null
  }>
  writesAttempted: 0
}

export interface ProductBoundary {
  effectiveStartDate: Date
  startingWeight: number
}

/** Pure dry-run. It has no repository/write dependency by design. */
export function dryRunStockMovementBackfill(input: {
  baselineDate: Date
  productBoundaries?: Record<string, ProductBoundary>
  documents: BackfillDocument[]
  existingIdempotencyKeys?: Set<string>
  currentStockLotTotals?: Record<string, number>
}): BackfillResult {
  const proposedMovements: StockMovementDraft[] = []
  const duplicates: string[] = []
  const findings: BackfillResult['findings'] = []
  const keys = new Set(input.existingIdempotencyKeys || [])
  const defaultStart = input.baselineDate.getTime() + 24 * 60 * 60 * 1000

  for (const doc of input.documents) {
    const relevantStarts = [doc.sourceProductId, ...doc.items.map(item => item.productId)]
      .filter((id): id is string => Boolean(id))
      .map(id => input.productBoundaries?.[id]?.effectiveStartDate.getTime() ?? defaultStart)
    if (relevantStarts.length > 0 && relevantStarts.every(start => doc.date.getTime() < start)) {
      findings.push({ sourceId: doc.id, classification: 'UNSUPPORTED_LEGACY', reason: 'Document predates baseline closing boundary' })
      continue
    }
    if (doc.isCancelled) {
      findings.push({ sourceId: doc.id, classification: 'AMBIGUOUS', reason: 'Cancelled historical document requires cancellation timing evidence' })
      continue
    }
    if (doc.items.some(i => !Number.isFinite(i.weight) || i.weight < 0)) {
      findings.push({ sourceId: doc.id, classification: 'INCONSISTENT', reason: 'Invalid item weight' })
      continue
    }
    let drafts: StockMovementDraft[]
    if (doc.kind === 'BUY') drafts = buildPurchaseMovements(doc)
    else if (doc.kind === 'SELL') drafts = buildSaleMovements(doc)
    else if (doc.kind === 'SORTING' && doc.sourceProductId && doc.sourceWeight != null) {
      drafts = buildSortingMovements({ ...doc, sourceProductId: doc.sourceProductId, sourceWeight: doc.sourceWeight })
    } else if (doc.kind === 'TRANSFER' && doc.sourceProductId && doc.sourceWeight != null) {
      drafts = buildTransferMovements({ ...doc, sourceProductId: doc.sourceProductId, sourceWeight: doc.sourceWeight })
    } else {
      findings.push({ sourceId: doc.id, classification: 'INCONSISTENT', reason: 'Missing source product or weight' })
      continue
    }
    let duplicate = false
    for (const movement of drafts) {
      const boundary = input.productBoundaries?.[movement.productId]
      const start = boundary?.effectiveStartDate.getTime() ?? defaultStart
      if (movement.businessDate.getTime() < start) continue
      if (keys.has(movement.idempotencyKey)) {
        duplicates.push(movement.idempotencyKey)
        duplicate = true
      } else {
        keys.add(movement.idempotencyKey)
        proposedMovements.push(movement)
      }
    }
    findings.push({ sourceId: doc.id, classification: duplicate ? 'AMBIGUOUS' : 'SAFE', reason: duplicate ? 'One or more idempotency keys already exist' : 'Deterministic source mapping available' })
  }

  const totalsByProduct: Record<string, number> = {}
  for (const [productId, boundary] of Object.entries(input.productBoundaries || {})) {
    totalsByProduct[productId] = preciseWeight(boundary.startingWeight)
  }
  for (const movement of proposedMovements) {
    totalsByProduct[movement.productId] = preciseWeight((totalsByProduct[movement.productId] || 0) + movement.signedWeight)
  }
  const reconciliationByProduct: BackfillResult['reconciliationByProduct'] = {}
  const productIds = new Set([
    ...Object.keys(totalsByProduct),
    ...Object.keys(input.currentStockLotTotals || {}),
  ])
  for (const productId of productIds) {
    const proposedMovementWeight = totalsByProduct[productId] || 0
    const current = input.currentStockLotTotals?.[productId]
    reconciliationByProduct[productId] = {
      proposedMovementWeight,
      currentStockLotWeight: current == null ? null : preciseWeight(current),
      differenceWeight: current == null ? null : preciseWeight(proposedMovementWeight - current),
    }
  }
  return {
    dryRun: true,
    proposedMovements,
    duplicates,
    findings,
    totalsByProduct,
    reconciliationByProduct,
    writesAttempted: 0,
  }
}
