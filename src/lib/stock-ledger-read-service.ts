import { db } from './db'
import { calculateClosingStock, type ClosingStockRow } from './stock-movement-ledger'
import { parseThailandBusinessDate } from './thailand-date'

/** Read-only shared interface for ST-43. Each item is opening start-of-day. */
export async function getExpectedClosingStock(selectedDate: string): Promise<ClosingStockRow[]> {
  const baseline = await db.stockBaseline.findFirst({
    where: { status: 'APPROVED' },
    include: { items: { select: { productId: true, weight: true, effectiveStartDate: true } } },
  })
  if (!baseline) throw new Error('No approved stock baseline')
  const selectedEnd = new Date(parseThailandBusinessDate(selectedDate).getTime() + 24 * 60 * 60 * 1000)
  const earliestStart = baseline.items.reduce((min, item) => item.effectiveStartDate < min ? item.effectiveStartDate : min, baseline.items[0]?.effectiveStartDate ?? selectedEnd)
  const movements = await db.stockMovement.findMany({
    where: {
      movementType: { not: 'BASELINE' },
      businessDate: { gte: earliestStart, lt: selectedEnd },
    },
    select: { productId: true, businessDate: true, signedWeight: true },
  })
  return calculateClosingStock(
    { ...baseline, status: baseline.status as 'APPROVED' },
    selectedDate,
    movements,
  )
}
