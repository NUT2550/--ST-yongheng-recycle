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
    // ST-75: Use findFirst desc instead of findMany ALL — reduces O(N) to O(1)
    const row = await tx.buyBill.findFirst({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
      orderBy: { billNumber: 'desc' },
    })
    maxSeq = row?.billNumber ? parseBillNumberSeq(row.billNumber, yearPrefix) : 0
  } else if (billType === 'SELL') {
    const row = await tx.sellBill.findFirst({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
      orderBy: { billNumber: 'desc' },
    })
    maxSeq = row?.billNumber ? parseBillNumberSeq(row.billNumber, yearPrefix) : 0
  } else if (billType === 'SORT') {
    const row = await tx.sortingBill.findFirst({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
      orderBy: { billNumber: 'desc' },
    })
    maxSeq = row?.billNumber ? parseBillNumberSeq(row.billNumber, yearPrefix) : 0
  } else {
    const row = await tx.stockTransfer.findFirst({
      where: { billNumber: { startsWith: yearPrefix } },
      select: { billNumber: true },
      orderBy: { billNumber: 'desc' },
    })
    maxSeq = row?.billNumber ? parseBillNumberSeq(row.billNumber, yearPrefix) : 0
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
 * ST-75: Parse the sequence number from a single bill number.
 * Same logic as computeMaxSeq but for a single value (findFirst desc result).
 */
function parseBillNumberSeq(billNumber: string, yearPrefix: string): number {
  if (!billNumber.startsWith(yearPrefix)) return 0
  const suffix = billNumber.slice(yearPrefix.length)
  const n = parseInt(suffix, 10)
  return isNaN(n) ? 0 : n
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
