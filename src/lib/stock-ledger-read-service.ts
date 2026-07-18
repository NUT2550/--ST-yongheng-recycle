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
  expectedClosingWeight: number
  movementCount: number
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
  baselineItems: Array<{ productId: string; productName: string; weight: number }>
  products: Array<{ id: string; name: string }>
  movements: MovementRow[]
}): ClosingStockResult {
  const baselineDate = formatThailandBusinessDate(input.baselineDate)
  if (input.selectedDate < baselineDate) throw new Error('Selected date predates the approved baseline')
  const baselineEnd = parseThailandBusinessDate(baselineDate).getTime() + 86_400_000
  const selectedEnd = parseThailandBusinessDate(input.selectedDate).getTime() + 86_400_000
  const names = new Map(input.products.map(product => [product.id, product.name]))
  const rows = new Map<string, { opening: number; buckets: Record<StockMovementType, number>; counts: Partial<Record<StockMovementType, number>> }>()
  const emptyBuckets = () => Object.fromEntries(bucketTypes.map(type => [type, 0])) as Record<StockMovementType, number>

  for (const item of input.baselineItems) {
    names.set(item.productId, item.productName)
    rows.set(item.productId, { opening: units(item.weight), buckets: emptyBuckets(), counts: {} })
  }
  for (const product of input.products) {
    if (!rows.has(product.id)) rows.set(product.id, { opening: 0, buckets: emptyBuckets(), counts: {} })
  }
  for (const movement of input.movements) {
    const time = movement.businessDate.getTime()
    if (time < baselineEnd || time >= selectedEnd) continue
    const row = rows.get(movement.productId) || { opening: 0, buckets: emptyBuckets(), counts: {} }
    row.buckets[movement.movementType] = (row.buckets[movement.movementType] || 0) + units(movement.signedWeight)
    row.counts[movement.movementType] = (row.counts[movement.movementType] || 0) + 1
    rows.set(movement.productId, row)
  }

  const items = [...rows.entries()].map(([productId, row]) => {
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
      warnings: row.opening + net < 0 ? ['Expected closing stock is negative'] : [],
    }
  })
  return { baselineStatus: 'APPROVED', baselineDate, selectedDate: input.selectedDate, items }
}

/** Read-only shared interface for ST-43. Baseline is closing end-of-day. */
export async function getExpectedClosingStock(selectedDate: string, category?: string): Promise<ClosingStockResult> {
  const selectedEnd = new Date(parseThailandBusinessDate(selectedDate).getTime() + 86_400_000)
  const baseline = await db.stockBaseline.findFirst({
    where: { status: 'APPROVED', baselineDate: { lt: selectedEnd } },
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
  const movements = await db.stockMovement.findMany({
    where: { productId: { in: productIds }, businessDate: { gt: baseline.baselineDate, lt: selectedEnd } },
    select: { productId: true, businessDate: true, signedWeight: true, movementType: true },
  })
  return calculateClosingStockBreakdown({
    selectedDate,
    baselineDate: baseline.baselineDate,
    baselineItems: baseline.items.reduce<Array<{ productId: string; productName: string; weight: number }>>((items, item) => {
      if (!category || productIdSet.has(item.productId)) {
        items.push({ productId: item.productId, productName: item.product.name, weight: item.weight })
      }
      return items
    }, []),
    products,
    movements: movements.map(movement => ({ ...movement, movementType: movement.movementType as StockMovementType })),
  })
}
