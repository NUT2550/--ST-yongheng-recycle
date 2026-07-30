import type { Prisma } from '@prisma/client'
import { reverseSourceMovements } from './stock-movement-reversal'

/**
 * ST-71: Buy cancellation service — extracted from route handler for
 * runtime testability against real PostgreSQL.
 *
 * Follows the ST-70 Sorting cancellation pattern:
 *   - All reads and mutations inside a single $transaction
 *   - CAS (compare-and-swap) guard via updateMany with isCancelled: false
 *   - Downstream-use rejection before CAS claim
 *   - Test-only fault injection hook (unavailable in Production)
 *
 * The CAS guard closes the concurrent-cancellation race window that existed
 * when the isCancelled check was outside the transaction (identified in
 * PR #57 static review, confirmed by ST-71 runtime harness).
 */

export type BuyCancellationCode =
  | 'BUY_BILL_NOT_FOUND'
  | 'BUY_BILL_ALREADY_CANCELLED'
  | 'BUY_BILL_HAS_DOWNSTREAM_USAGE'
  | 'BUY_CANCEL_CONFLICT'

export class BuyCancellationError extends Error {
  constructor(
    public readonly code: BuyCancellationCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'BuyCancellationError'
  }
}

interface BillItem {
  productId: string
  weight: number
}

interface Bill {
  id: string
  billNumber: string | null
  isCancelled: boolean
  items: BillItem[]
}

interface StockLotRow {
  remainingWeight: number
}

interface Tx {
  buyBill: {
    findUnique(args: unknown): Promise<Bill | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  stockLot: {
    findMany(args: unknown): Promise<StockLotRow[]>
    deleteMany(args: unknown): Promise<unknown>
  }
  creditEntry: {
    updateMany(args: unknown): Promise<unknown>
  }
  auditLog: { create(args: unknown): Promise<unknown> }
  stockMovement: {
    findMany(args: unknown): Promise<unknown[]>
    createMany(args: unknown): Promise<unknown>
  }
}

export interface BuyCancellationDb {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

/** Test-only fault injection hook. Not available in Production path. */
export interface BuyCancellationTestHook {
  beforeClaim?: () => void | Promise<void>
  afterClaim?: () => void | Promise<void>
  beforeReversal?: () => void | Promise<void>
  beforeAudit?: () => void | Promise<void>
}

export interface BuyCancellationInput {
  id: string
  reason: string
  auth: { userId: string; name: string }
  cancelledAt?: Date
  _testHook?: BuyCancellationTestHook
}

export async function cancelBuyBill(
  db: BuyCancellationDb,
  input: BuyCancellationInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const bill = await tx.buyBill.findUnique({
      where: { id: input.id },
      include: { items: true },
    })
    if (!bill) {
      throw new BuyCancellationError('BUY_BILL_NOT_FOUND', 404, 'ไม่พบใบรับซื้อ')
    }
    if (bill.isCancelled) {
      throw new BuyCancellationError(
        'BUY_BILL_ALREADY_CANCELLED',
        400,
        'ใบรับซื้อนี้ถูกยกเลิกไปแล้ว',
      )
    }

    // Downstream-use check: if any purchased stock was consumed (sold/sorted/
    // transferred), block cancellation. Must happen BEFORE the CAS claim so
    // a rejected cancellation leaves zero state mutation.
    const buyLots = await tx.stockLot.findMany({
      where: { source: 'BUY', sourceId: input.id },
      select: { remainingWeight: true },
    })
    const totalRemaining = buyLots.reduce((s, l) => s + l.remainingWeight, 0)
    const totalOriginal = bill.items.reduce((s, i) => s + i.weight, 0)
    const consumedWeight = totalOriginal - totalRemaining

    if (consumedWeight > 0.001) {
      throw new BuyCancellationError(
        'BUY_BILL_HAS_DOWNSTREAM_USAGE',
        400,
        `ไม่สามารถยกเลิกได้: สต็อกจากบิลนี้ถูกขาย/คัดแยกไปแล้ว ${consumedWeight.toFixed(2)} กก. กรุณาย้อนกลับไปลบบิลขาย/คัดแยกที่เกี่ยวข้องก่อน`,
      )
    }

    // Test hook: inject failure before CAS claim.
    if (input._testHook?.beforeClaim) {
      await input._testHook.beforeClaim()
    }

    // CAS claim: atomically transition isCancelled false → true.
    // If a concurrent cancellation already claimed the bill, count=0 and
    // we fail closed with 409. This closes the TOCTOU race window.
    const cancelledAt = input.cancelledAt ?? new Date()
    const claim = await tx.buyBill.updateMany({
      where: { id: input.id, isCancelled: false },
      data: {
        isCancelled: true,
        cancelledAt,
        cancelledBy: input.auth.userId,
        cancelReason: input.reason || null,
      },
    })
    if (claim.count !== 1) {
      throw new BuyCancellationError(
        'BUY_CANCEL_CONFLICT',
        409,
        'สถานะใบรับซื้อเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่',
      )
    }

    // Test hook: inject failure after CAS claim (before mutations).
    if (input._testHook?.afterClaim) {
      await input._testHook.afterClaim()
    }

    // Safe to restore: delete BUY StockLots (all unconsumed).
    await tx.stockLot.deleteMany({
      where: { source: 'BUY', sourceId: input.id },
    })

    // Cancel credit entry.
    await tx.creditEntry.updateMany({
      where: { referenceId: input.id, referenceType: 'BUY_BILL' },
      data: {
        isSettled: true,
        description: `ยกเลิกแล้ว: ${input.reason || 'ไม่ระบุเหตุผล'}`,
      },
    })

    // Test hook: inject failure before reversal.
    if (input._testHook?.beforeReversal) {
      await input._testHook.beforeReversal()
    }

    await reverseSourceMovements(
      tx as never,
      'BUY_BILL',
      input.id,
      'CANCELLATION_REVERSAL',
      cancelledAt,
      input.reason || 'Purchase cancelled',
    )

    // Test hook: inject failure before audit (after all mutations).
    if (input._testHook?.beforeAudit) {
      await input._testHook.beforeAudit()
    }

    // Audit log.
    await tx.auditLog.create({
      data: {
        action: 'CANCEL',
        entityType: 'BUY_BILL',
        entityId: input.id,
        userId: input.auth.userId,
        userName: input.auth.name,
        details: JSON.stringify({
          billNumber: bill.billNumber,
          reason: input.reason || null,
          restoredWeight: totalRemaining,
        }),
      },
    })
  })
}

export function mapBuyCancellationError(error: unknown) {
  if (error instanceof BuyCancellationError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return {
    status: 500,
    body: { error: 'ไม่สามารถยกเลิกใบรับซื้อได้ กรุณาลองใหม่ภายหลัง', code: 'BUY_CANCEL_FAILED' },
  }
}
