/**
 * Bill helpers: billNumber generation, audit log
 */
import { db } from '@/lib/db'

/**
 * Generate a business bill number like "BUY-2569-00001".
 *
 * Uses max-existing-sequence + 1 (robust to cancelled bills and sequence gaps)
 * instead of count + 1 (which collides when cancelled/gap bills exist).
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
  const yearPrefix = `${prefix}-${buddhistYear}-`

  // Find the max existing sequence number for this prefix+year to avoid collisions
  // with cancelled or gap bills. Falls back to 0 if none exist.
  let maxSeq = 0
  if (billType === 'BUY') {
    const rows = await tx.buyBill.findMany({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
    })
    maxSeq = computeMaxSeq(rows.map((r) => r.billNumber), yearPrefix)
  } else if (billType === 'SELL') {
    const rows = await tx.sellBill.findMany({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
    })
    maxSeq = computeMaxSeq(rows.map((r) => r.billNumber), yearPrefix)
  } else if (billType === 'SORT') {
    const rows = await tx.sortingBill.findMany({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
    })
    maxSeq = computeMaxSeq(rows.map((r) => r.billNumber), yearPrefix)
  } else {
    const rows = await tx.stockTransfer.findMany({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
    })
    maxSeq = computeMaxSeq(rows.map((r) => r.billNumber), yearPrefix)
  }

  const sequence = maxSeq + 1
  const paddedSeq = String(sequence).padStart(5, '0')
  return `${prefix}-${buddhistYear}-${paddedSeq}`
}

// Helper: extract the numeric suffix from bill numbers like "SORT-2569-00132" → 132
function computeMaxSeq(billNumbers: (string | null)[], yearPrefix: string): number {
  let max = 0
  for (const bn of billNumbers) {
    if (!bn || !bn.startsWith(yearPrefix)) continue
    const suffix = bn.slice(yearPrefix.length)
    const n = parseInt(suffix, 10)
    if (!isNaN(n) && n > max) max = n
  }
  return max
}

/**
 * Write an audit log entry. Best-effort.
 */
export async function writeAuditLog(
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0] | typeof db,
  params: {
    action: 'CREATE' | 'UPDATE' | 'DELETE' | 'CANCEL'
    entityType: 'BUY_BILL' | 'SELL_BILL' | 'SORTING_BILL' | 'STOCK_TRANSFER' | 'PHYSICAL_COUNT' | 'USER_PERMISSION'
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
