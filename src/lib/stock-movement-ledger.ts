import { formatThailandBusinessDate, parseThailandBusinessDate } from './thailand-date'

export const STOCK_WEIGHT_SCALE = 1_000_000

export type StockMovementType =
  | 'BASELINE' | 'PURCHASE_IN' | 'SALE_OUT'
  | 'SORTING_SOURCE_OUT' | 'SORTING_OUTPUT_IN'
  | 'TRANSFER_SOURCE_OUT' | 'TRANSFER_OUTPUT_IN'
  | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
  | 'CANCELLATION_REVERSAL' | 'COMPENSATION_REVERSAL'

export interface StockMovementDraft {
  productId: string
  businessDate: Date
  movementType: StockMovementType
  signedWeight: number
  sourceType: string
  sourceId: string
  sourceItemId?: string | null
  sourceDocumentNumber?: string | null
  reversalOfId?: string | null
  idempotencyKey: string
  reason?: string | null
  metadata?: Record<string, unknown> | null
  createdById?: string | null
  createdByName?: string | null
}

export type ReversibleStockMovement = Omit<StockMovementDraft, 'metadata'> & {
  id: string
  metadata?: unknown
}

export interface LedgerSourceItem {
  id: string
  productId: string
  weight: number
  isWaste?: boolean
}

function units(value: number): number {
  if (!Number.isFinite(value)) throw new Error('Stock movement weight must be finite')
  return Math.round(value * STOCK_WEIGHT_SCALE)
}

export function preciseWeight(value: number): number {
  return units(value) / STOCK_WEIGHT_SCALE
}

export function movementKey(parts: Array<string | number>): string {
  return ['stock-ledger-v1', ...parts].map(String).join(':')
}

function draft(
  type: StockMovementType,
  sign: 1 | -1,
  sourceType: string,
  sourceId: string,
  sourceDocumentNumber: string | null | undefined,
  businessDate: Date,
  item: LedgerSourceItem,
  suffix: string,
  metadata?: Record<string, unknown>,
): StockMovementDraft {
  const signedUnits = units(item.weight) * sign
  if (signedUnits === 0) throw new Error('Zero-weight stock movements are not allowed')
  return {
    productId: item.productId,
    businessDate,
    movementType: type,
    signedWeight: signedUnits / STOCK_WEIGHT_SCALE,
    sourceType,
    sourceId,
    sourceItemId: item.id,
    sourceDocumentNumber: sourceDocumentNumber || null,
    idempotencyKey: movementKey([sourceType, sourceId, item.id, suffix]),
    metadata: metadata || null,
  }
}

export function buildPurchaseMovements(input: {
  id: string; billNumber?: string | null; date: Date; items: LedgerSourceItem[]
}): StockMovementDraft[] {
  return input.items.filter(i => units(i.weight) > 0).map(i =>
    draft('PURCHASE_IN', 1, 'BUY_BILL', input.id, input.billNumber, input.date, i, 'purchase-in'))
}

export function buildSaleMovements(input: {
  id: string; billNumber?: string | null; date: Date; items: LedgerSourceItem[]
}): StockMovementDraft[] {
  return input.items.filter(i => units(i.weight) > 0).map(i =>
    draft('SALE_OUT', -1, 'SELL_BILL', input.id, input.billNumber, input.date, i, 'sale-out'))
}

export function buildSortingMovements(input: {
  id: string; billNumber?: string | null; date: Date
  sourceProductId: string; sourceWeight: number; items: LedgerSourceItem[]
}): StockMovementDraft[] {
  const source = draft('SORTING_SOURCE_OUT', -1, 'SORTING_BILL', input.id, input.billNumber, input.date,
    { id: 'source', productId: input.sourceProductId, weight: input.sourceWeight }, 'source-out')
  const outputs = input.items.filter(i => !i.isWaste && units(i.weight) > 0).map(i =>
    draft('SORTING_OUTPUT_IN', 1, 'SORTING_BILL', input.id, input.billNumber, input.date, i, 'output-in'))
  return [source, ...outputs]
}

export function buildTransferMovements(input: {
  id: string; billNumber?: string | null; date: Date
  sourceProductId: string; sourceWeight: number; items: LedgerSourceItem[]
  gainWeight?: number; lossWeight?: number; businessType?: string | null
}): StockMovementDraft[] {
  const common = { gainWeight: preciseWeight(input.gainWeight || 0), lossWeight: preciseWeight(input.lossWeight || 0), businessType: input.businessType || null }
  const source = draft('TRANSFER_SOURCE_OUT', -1, 'STOCK_TRANSFER', input.id, input.billNumber, input.date,
    { id: 'source', productId: input.sourceProductId, weight: input.sourceWeight }, 'source-out', common)
  const outputs = input.items.filter(i => !i.isWaste && units(i.weight) > 0).map(i =>
    draft('TRANSFER_OUTPUT_IN', 1, 'STOCK_TRANSFER', input.id, input.billNumber, input.date, i, 'output-in', common))
  return [source, ...outputs]
}

export function buildAdjustmentMovement(input: {
  sessionId: string; itemId: string; productId: string; businessDate: Date
  differenceWeight: number; documentNumber?: string | null; actorId?: string | null; actorName?: string | null
}): StockMovementDraft | null {
  const amount = units(input.differenceWeight)
  if (amount === 0) return null
  return {
    productId: input.productId,
    businessDate: input.businessDate,
    movementType: amount > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
    signedWeight: amount / STOCK_WEIGHT_SCALE,
    sourceType: 'PHYSICAL_COUNT',
    sourceId: input.sessionId,
    sourceItemId: input.itemId,
    sourceDocumentNumber: input.documentNumber || null,
    idempotencyKey: movementKey(['PHYSICAL_COUNT', input.sessionId, input.itemId, 'adjustment']),
    createdById: input.actorId || null,
    createdByName: input.actorName || null,
  }
}

export function buildReversalMovement(
  original: ReversibleStockMovement,
  kind: 'CANCELLATION_REVERSAL' | 'COMPENSATION_REVERSAL',
  reason: string,
  reversalBusinessDate: Date = original.businessDate,
): StockMovementDraft {
  return {
    ...original,
    movementType: kind,
    businessDate: reversalBusinessDate,
    signedWeight: preciseWeight(-original.signedWeight),
    reversalOfId: original.id,
    idempotencyKey: movementKey([kind, original.id]),
    reason,
    metadata: { reversedMovementType: original.movementType },
  }
}

export interface ApprovedBaselineRow {
  id: string
  generation: number
  baselineDate: Date
  status: 'DRAFT' | 'APPROVED' | 'SUPERSEDED'
  items: Array<{ productId: string; weight: number; effectiveStartDate?: Date }>
}

export interface ClosingStockRow {
  productId: string
  baselineWeight: number
  movementInWeight: number
  movementOutWeight: number
  netMovementWeight: number
  expectedClosingWeight: number | null
  movementCount: number
  state: 'ACTIVE' | 'NOT_STARTED'
  effectiveStartDate: string
  warnings: string[]
}

export function calculateClosingStock(
  baseline: ApprovedBaselineRow,
  selectedDate: string,
  movements: Array<{ productId: string; businessDate: Date; signedWeight: number }>,
): ClosingStockRow[] {
  if (baseline.status !== 'APPROVED') return []
  const selectedEnd = parseThailandBusinessDate(selectedDate).getTime() + 24 * 60 * 60 * 1000
  const byProduct = new Map<string, { base: number; start: number; startDate: string; inbound: number; outbound: number; count: number }>()
  for (const item of baseline.items) {
    const startDate = formatThailandBusinessDate(item.effectiveStartDate ?? baseline.baselineDate)
    byProduct.set(item.productId, { base: units(item.weight), start: parseThailandBusinessDate(startDate).getTime(), startDate, inbound: 0, outbound: 0, count: 0 })
  }
  for (const movement of movements) {
    const time = movement.businessDate.getTime()
    const row = byProduct.get(movement.productId)
    if (!row || time < row.start || time >= selectedEnd) continue
    const weight = units(movement.signedWeight)
    if (weight > 0) row.inbound += weight
    else row.outbound += -weight
    row.count++
    byProduct.set(movement.productId, row)
  }
  return [...byProduct.entries()].map(([productId, row]) => {
    if (selectedDate < row.startDate) return {
      productId, baselineWeight: row.base / STOCK_WEIGHT_SCALE, movementInWeight: 0,
      movementOutWeight: 0, netMovementWeight: 0, expectedClosingWeight: null,
      movementCount: 0, state: 'NOT_STARTED' as const, effectiveStartDate: row.startDate,
      warnings: ['Stock tracking has not started for this product'],
    }
    const net = row.inbound - row.outbound
    return {
      productId,
      baselineWeight: row.base / STOCK_WEIGHT_SCALE,
      movementInWeight: row.inbound / STOCK_WEIGHT_SCALE,
      movementOutWeight: row.outbound / STOCK_WEIGHT_SCALE,
      netMovementWeight: net / STOCK_WEIGHT_SCALE,
      expectedClosingWeight: (row.base + net) / STOCK_WEIGHT_SCALE,
      movementCount: row.count,
      state: 'ACTIVE' as const,
      effectiveStartDate: row.startDate,
      warnings: [],
    }
  })
}
