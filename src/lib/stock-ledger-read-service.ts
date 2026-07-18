import { db } from './db'
import { calculateClosingStock, type ClosingStockRow } from './stock-movement-ledger'
import { parseThailandBusinessDate } from './thailand-date'

/** Read-only shared interface for ST-43. Baseline is closing end-of-day. */
export async function getExpectedClosingStock(selectedDate: string): Promise<ClosingStockRow[]> {
  const baseline = await db.stockBaseline.findFirst({
    where: { status: 'APPROVED' },
    include: { items: { select: { productId: true, weight: true } } },
  })
  if (!baseline) throw new Error('No approved stock baseline')
  const selectedEnd = new Date(parseThailandBusinessDate(selectedDate).getTime() + 24 * 60 * 60 * 1000)
  const movements = await db.stockMovement.findMany({
    where: {
      businessDate: { gt: baseline.baselineDate, lt: selectedEnd },
    },
    select: { productId: true, businessDate: true, signedWeight: true },
  })
  return calculateClosingStock(
    { ...baseline, status: baseline.status as 'APPROVED' },
    selectedDate,
    movements,
  )
}
