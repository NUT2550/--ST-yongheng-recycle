import { db } from './db'
import { preciseWeight, STOCK_WEIGHT_SCALE, type StockMovementType } from './stock-movement-ledger'
import { formatThailandBusinessDate, parseThailandBusinessDate } from './thailand-date'

export interface ClosingStockBreakdownRow {
  productId: string
  productName: string
  openingWeight: number
  purchaseInWeight: number
  saleOutWeight: number
  sortingSourceOutWeight: number
  sortingOutputInWeight: number
  transferSourceOutWeight: number
  transferOutputInWeight: number
  adjustmentInWeight: number
  adjustmentOutWeight: number
  adjustmentNetWeight: number
  netMovementWeight: number
  expectedClosingWeight: number | null
  movementCount: number
  state: 'ACTIVE' | 'NOT_STARTED'
  effectiveStartDate: string
  movementCounts: Partial<Record<StockMovementType, number>>
  warnings: string[]
}

export interface ClosingStockResult {
  baselineStatus: 'APPROVED' | 'MISSING'
  baselineDate: string | null
  selectedDate: string
  items: ClosingStockBreakdownRow[]
}

type MovementRow = {
  productId: string
  movementType: StockMovementType
  signedWeight: number
  businessDate: Date
}

const bucketTypes: StockMovementType[] = [
  'PURCHASE_IN', 'SALE_OUT', 'SORTING_SOURCE_OUT', 'SORTING_OUTPUT_IN',
  'TRANSFER_SOURCE_OUT', 'TRANSFER_OUTPUT_IN', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT',
  'CANCELLATION_REVERSAL', 'COMPENSATION_REVERSAL',
]

function units(weight: number): number {
  if (!Number.isFinite(weight)) throw new Error('Stock movement weight must be finite')
  return Math.round(weight * STOCK_WEIGHT_SCALE)
}

export function calculateClosingStockBreakdown(input: {
  selectedDate: string
  baselineDate: Date
  baselineItems: Array<{ productId: string; productName: string; weight: number; effectiveStartDate: Date }>
  products: Array<{ id: string; name: string }>
  movements: MovementRow[]
}): ClosingStockResult {
  const baselineDate = formatThailandBusinessDate(input.baselineDate)
  const selectedEnd = parseThailandBusinessDate(input.selectedDate).getTime() + 86_400_000
  const names = new Map(input.products.map(product => [product.id, product.name]))
  const rows = new Map<string, { opening: number; start: number; startDate: string; buckets: Record<StockMovementType, number>; counts: Partial<Record<StockMovementType, number>> }>()
  const emptyBuckets = () => Object.fromEntries(bucketTypes.map(type => [type, 0])) as Record<StockMovementType, number>

  for (const item of input.baselineItems) {
    names.set(item.productId, item.productName)
    const startDate = formatThailandBusinessDate(item.effectiveStartDate)
    rows.set(item.productId, { opening: units(item.weight), start: parseThailandBusinessDate(startDate).getTime(), startDate, buckets: emptyBuckets(), counts: {} })
  }
  for (const movement of input.movements) {
    const time = movement.businessDate.getTime()
    const row = rows.get(movement.productId)
    if (!row || time < row.start || time >= selectedEnd) continue
    row.buckets[movement.movementType] = (row.buckets[movement.movementType] || 0) + units(movement.signedWeight)
    row.counts[movement.movementType] = (row.counts[movement.movementType] || 0) + 1
    rows.set(movement.productId, row)
  }

  const items = [...rows.entries()].map(([productId, row]) => {
    if (input.selectedDate < row.startDate) return {
      productId, productName: names.get(productId) || productId, openingWeight: preciseWeight(row.opening / STOCK_WEIGHT_SCALE),
      purchaseInWeight: 0, saleOutWeight: 0, sortingSourceOutWeight: 0, sortingOutputInWeight: 0,
      transferSourceOutWeight: 0, transferOutputInWeight: 0, adjustmentInWeight: 0, adjustmentOutWeight: 0,
      adjustmentNetWeight: 0, netMovementWeight: 0, expectedClosingWeight: null, movementCount: 0,
      movementCounts: {}, state: 'NOT_STARTED' as const, effectiveStartDate: row.startDate,
      warnings: ['Stock tracking has not started for this product'],
    }
    const b = row.buckets
    const purchaseIn = Math.max(0, b.PURCHASE_IN)
    const saleOut = Math.max(0, -b.SALE_OUT)
    const sortingSourceOut = Math.max(0, -b.SORTING_SOURCE_OUT)
    const sortingOutputIn = Math.max(0, b.SORTING_OUTPUT_IN)
    const transferSourceOut = Math.max(0, -b.TRANSFER_SOURCE_OUT)
    const transferOutputIn = Math.max(0, b.TRANSFER_OUTPUT_IN)
    const adjustmentIn = Math.max(0, b.ADJUSTMENT_IN)
    const adjustmentOut = Math.max(0, -b.ADJUSTMENT_OUT)
    const net = Object.values(b).reduce((sum, value) => sum + value, 0)
    const movementCount = Object.values(row.counts).reduce((sum, value) => sum + (value || 0), 0)
    return {
      productId,
      productName: names.get(productId) || productId,
      openingWeight: preciseWeight(row.opening / STOCK_WEIGHT_SCALE),
      purchaseInWeight: preciseWeight(purchaseIn / STOCK_WEIGHT_SCALE),
      saleOutWeight: preciseWeight(saleOut / STOCK_WEIGHT_SCALE),
      sortingSourceOutWeight: preciseWeight(sortingSourceOut / STOCK_WEIGHT_SCALE),
      sortingOutputInWeight: preciseWeight(sortingOutputIn / STOCK_WEIGHT_SCALE),
      transferSourceOutWeight: preciseWeight(transferSourceOut / STOCK_WEIGHT_SCALE),
      transferOutputInWeight: preciseWeight(transferOutputIn / STOCK_WEIGHT_SCALE),
      adjustmentInWeight: preciseWeight(adjustmentIn / STOCK_WEIGHT_SCALE),
      adjustmentOutWeight: preciseWeight(adjustmentOut / STOCK_WEIGHT_SCALE),
      adjustmentNetWeight: preciseWeight((adjustmentIn - adjustmentOut) / STOCK_WEIGHT_SCALE),
      netMovementWeight: preciseWeight(net / STOCK_WEIGHT_SCALE),
      expectedClosingWeight: preciseWeight((row.opening + net) / STOCK_WEIGHT_SCALE),
      movementCount,
      movementCounts: row.counts,
      state: 'ACTIVE' as const,
      effectiveStartDate: row.startDate,
      warnings: row.opening + net < 0 ? ['Expected closing stock is negative'] : [],
    }
  })
  return { baselineStatus: 'APPROVED', baselineDate, selectedDate: input.selectedDate, items }
}

/** Read-only shared interface for ST-43. Each item is opening start-of-day. */
export async function getExpectedClosingStock(selectedDate: string, category?: string): Promise<ClosingStockResult> {
  const selectedEnd = new Date(parseThailandBusinessDate(selectedDate).getTime() + 86_400_000)
  const baseline = await db.stockBaseline.findFirst({
    where: { status: 'APPROVED' },
    orderBy: { generation: 'desc' },
    include: { items: { include: { product: { select: { name: true } } } } },
  })
  if (!baseline) return { baselineStatus: 'MISSING', baselineDate: null, selectedDate, items: [] }
  const categoryRow = category ? await db.productCategory.findFirst({ where: { name: category }, select: { id: true } }) : null
  if (category && !categoryRow) throw new Error(`Category not found: ${category}`)
  const products = await db.product.findMany({
    where: categoryRow ? { categoryId: categoryRow.id } : undefined,
    select: { id: true, name: true }, orderBy: { sortOrder: 'asc' },
  })
  const productIds = products.map(product => product.id)
  const productIdSet = new Set(productIds)
  const relevantItems = baseline.items.filter(item => !category || productIdSet.has(item.productId))
  const earliestStart = relevantItems.reduce((min, item) => item.effectiveStartDate < min ? item.effectiveStartDate : min, relevantItems[0]?.effectiveStartDate ?? selectedEnd)
  const movements = await db.stockMovement.findMany({
    where: {
      productId: { in: productIds },
      movementType: { not: 'BASELINE' },
      businessDate: { gte: earliestStart, lt: selectedEnd },
    },
    select: { productId: true, businessDate: true, signedWeight: true, movementType: true },
  })
  return calculateClosingStockBreakdown({
    selectedDate,
    baselineDate: baseline.baselineDate,
    baselineItems: baseline.items.reduce<Array<{ productId: string; productName: string; weight: number; effectiveStartDate: Date }>>((items, item) => {
      if (!category || productIdSet.has(item.productId)) {
        items.push({ productId: item.productId, productName: item.product.name, weight: item.weight, effectiveStartDate: item.effectiveStartDate })
      }
      return items
    }, []),
    products,
    movements: movements.map(movement => ({ ...movement, movementType: movement.movementType as StockMovementType })),
  })
}

// ============================================================================
// ST-53: Daily-only movement breakdown (selected-day movements only, no opening/baseline)
// ============================================================================

export interface DailyMovementRow {
  productId: string
  productName: string
  purchaseInWeight: number
  saleOutWeight: number
  sortingSourceOutWeight: number
  sortingOutputInWeight: number
  transferSourceOutWeight: number
  transferOutputInWeight: number
  adjustmentNetWeight: number
  dailyNet: number
  movementCount: number
  movementCounts: Partial<Record<StockMovementType, number>>
}

export interface DailyMovementResult {
  selectedDate: string
  items: DailyMovementRow[]
  totalDailyNet: number
}

/**
 * ST-53: Returns ONLY movements on the selected Thailand business date.
 * Excludes: opening balance, baseline, movements before/after the selected date.
 *
 * Formula:
 *   dailyNet = purchaseIn - salesOut - sortingSourceOut + sortingOutputIn
 *              - transferSourceOut + transferOutputIn + adjustmentNet
 *
 * All movement components are signed (OUT categories are negative).
 * dailyNet is the direct sum of all signed components.
 */
export async function getDailyMovements(selectedDate: string, category?: string): Promise<DailyMovementResult> {
  const selectedStart = parseThailandBusinessDate(selectedDate)
  const selectedEnd = new Date(selectedStart.getTime() + 86_400_000)

  const categoryRow = category ? await db.productCategory.findFirst({ where: { name: category }, select: { id: true } }) : null
  if (category && !categoryRow) throw new Error(`Category not found: ${category}`)
  const products = await db.product.findMany({
    where: categoryRow ? { categoryId: categoryRow.id } : undefined,
    select: { id: true, name: true }, orderBy: { sortOrder: 'asc' },
  })
  const productIds = products.map(p => p.id)
  const names = new Map(products.map(p => [p.id, p.name]))

  // Query ONLY movements on the selected business date (Thailand timezone)
  const movements = await db.stockMovement.findMany({
    where: {
      productId: { in: productIds },
      movementType: { not: 'BASELINE' },
      businessDate: { gte: selectedStart, lt: selectedEnd },
    },
    select: { productId: true, businessDate: true, signedWeight: true, movementType: true },
  })

  // Build per-product daily buckets
  const rows = new Map<string, { buckets: Record<StockMovementType, number>; counts: Partial<Record<StockMovementType, number>> }>()
  for (const p of products) {
    rows.set(p.id, { buckets: emptyBuckets(), counts: {} })
  }
  for (const m of movements) {
    const row = rows.get(m.productId)
    if (!row) continue
    const signedUnits = units(m.signedWeight)
    row.buckets[m.movementType] = (row.buckets[m.movementType] || 0) + signedUnits
    row.counts[m.movementType] = (row.counts[m.movementType] || 0) + 1
  }

  const items: DailyMovementRow[] = []
  let totalDailyNet = 0

  for (const [productId, row] of rows) {
    const b = row.buckets
    const purchaseIn = Math.max(0, b.PURCHASE_IN)
    const saleOut = Math.max(0, -b.SALE_OUT)
    const sortingSourceOut = Math.max(0, -b.SORTING_SOURCE_OUT)
    const sortingOutputIn = Math.max(0, b.SORTING_OUTPUT_IN)
    const transferSourceOut = Math.max(0, -b.TRANSFER_SOURCE_OUT)
    const transferOutputIn = Math.max(0, b.TRANSFER_OUTPUT_IN)
    const adjustmentIn = Math.max(0, b.ADJUSTMENT_IN)
    const adjustmentOut = Math.max(0, -b.ADJUSTMENT_OUT)
    const adjustmentNet = adjustmentIn - adjustmentOut
    // dailyNet = direct sum of all signed components
    const dailyNet = b.PURCHASE_IN + b.SALE_OUT + b.SORTING_SOURCE_OUT + b.SORTING_OUTPUT_IN
      + b.TRANSFER_SOURCE_OUT + b.TRANSFER_OUTPUT_IN + b.ADJUSTMENT_IN + b.ADJUSTMENT_OUT
      + b.CANCELLATION_REVERSAL + b.COMPENSATION_REVERSAL
    const movementCount = Object.values(row.counts).reduce((sum, value) => sum + (value || 0), 0)

    // ST-53: include ALL active category Products, even with zero movements.
    // A zero-movement Product has dailyNet=0, allowing actual-only reconciliation.
    items.push({
      productId,
      productName: names.get(productId) || productId,
      purchaseInWeight: preciseWeight(purchaseIn / STOCK_WEIGHT_SCALE),
      saleOutWeight: preciseWeight(saleOut / STOCK_WEIGHT_SCALE),
      sortingSourceOutWeight: preciseWeight(sortingSourceOut / STOCK_WEIGHT_SCALE),
      sortingOutputInWeight: preciseWeight(sortingOutputIn / STOCK_WEIGHT_SCALE),
      transferSourceOutWeight: preciseWeight(transferSourceOut / STOCK_WEIGHT_SCALE),
      transferOutputInWeight: preciseWeight(transferOutputIn / STOCK_WEIGHT_SCALE),
      adjustmentNetWeight: preciseWeight(adjustmentNet / STOCK_WEIGHT_SCALE),
      dailyNet: preciseWeight(dailyNet / STOCK_WEIGHT_SCALE),
      movementCount,
      movementCounts: row.counts,
    })
    totalDailyNet += dailyNet
  }

  return {
    selectedDate,
    items: items.sort((a, b) => a.productName.localeCompare(b.productName)),
    totalDailyNet: preciseWeight(totalDailyNet / STOCK_WEIGHT_SCALE),
  }
}

function emptyBuckets(): Record<StockMovementType, number> {
  return Object.fromEntries(bucketTypes.map(type => [type, 0])) as Record<StockMovementType, number>
}
