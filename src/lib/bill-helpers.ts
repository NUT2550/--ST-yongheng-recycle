/**
 * Bill helpers: billNumber generation, audit log
 */
import { db } from '@/lib/db'

/**
 * Generate a business bill number like "BUY-2569-00001".
 */
export async function generateBillNumber(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0],
  billType: 'BUY' | 'SELL' | 'SORT' | 'TRANSFER'
): Promise<string> {
  const prefix =
    billType === 'BUY' ? 'BUY'
    : billType === 'SELL' ? 'SELL'
    : billType === 'SORT' ? 'SORT'
    : 'TRN'
  const now = new Date()
  const buddhistYear = now.getFullYear() + 543
  const adYear = now.getFullYear()
  const yearStart = new Date(adYear, 0, 1)
  const yearEnd = new Date(adYear + 1, 0, 1)

  let count: number
  if (billType === 'BUY') {
    count = await tx.buyBill.count({ where: { date: { gte: yearStart, lt: yearEnd } } })
  } else if (billType === 'SELL') {
    count = await tx.sellBill.count({ where: { date: { gte: yearStart, lt: yearEnd } } })
  } else if (billType === 'SORT') {
    count = await tx.sortingBill.count({ where: { date: { gte: yearStart, lt: yearEnd } } })
  } else {
    count = await tx.stockTransfer.count({ where: { date: { gte: yearStart, lt: yearEnd } } })
  }

  const sequence = count + 1
  const paddedSeq = String(sequence).padStart(5, '0')
  return `${prefix}-${buddhistYear}-${paddedSeq}`
}

/**
 * Write an audit log entry. Best-effort.
 */
export async function writeAuditLog(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0] | typeof db,
  params: {
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL'
    entityType: 'BUY_BILL' | 'SELL_BILL' | 'SORTING_BILL' | 'STOCK_TRANSFER'
    entityId: string
    userId?: string
    userName?: string
    details?: string
  }
): Promise<void> {
  try {
    await tx.auditLog.create({
      data: {
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        userId: params.userId || null,
        userName: params.userName || null,
        details: params.details || null,
      },
    })
  } catch (err) {
    console.error('AuditLog write failed (non-fatal):', err)
  }
}
