import type { Prisma } from '@prisma/client'
import { reverseSourceMovements } from './stock-movement-reversal'

/**
 * ST-71: Sell cancellation service — extracted from route handler for
 * runtime testability against real PostgreSQL.
 *
 * Follows the ST-70 Sorting cancellation pattern:
 *   - All reads and mutations inside a single $transaction
 *   - CAS (compare-and-swap) guard via updateMany with isCancelled: false
 *   - No downstream-use rejection (Sell always creates SELL_CANCEL lots)
 *   - Test-only fault injection hook (unavailable in Production)
 */

export type SellCancellationCode =
  | 'SELL_BILL_NOT_FOUND'
  | 'SELL_BILL_ALREADY_CANCELLED'
  | 'SELL_CANCEL_CONFLICT'

export class SellCancellationError extends Error {
  constructor(
    public readonly code: SellCancellationCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SellCancellationError'
  }
}

interface BillItem {
  productId: string
  weight: number
  costPerKg: number
  totalCost: number
}

interface Bill {
  id: string
  billNumber: string | null
  isCancelled: boolean
  items: BillItem[]
}

interface Tx {
  sellBill: {
    findUnique(args: unknown): Promise<Bill | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  stockLot: { create(args: unknown): Promise<unknown> }
  creditEntry: { updateMany(args: unknown): Promise<unknown> }
  auditLog: { create(args: unknown): Promise<unknown> }
  stockMovement: {
    findMany(args: unknown): Promise<unknown[]>
    createMany(args: unknown): Promise<unknown>
  }
}

export interface SellCancellationDb {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

export interface SellCancellationTestHook {
  beforeClaim?: () => void | Promise<void>
  afterClaim?: () => void | Promise<void>
  beforeReversal?: () => void | Promise<void>
  beforeAudit?: () => void | Promise<void>
}

export interface SellCancellationInput {
  id: string
  reason: string
  auth: { userId: string; name: string }
  cancelledAt?: Date
  _testHook?: SellCancellationTestHook
}

export async function cancelSellBill(
  db: SellCancellationDb,
  input: SellCancellationInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const bill = await tx.sellBill.findUnique({
      where: { id: input.id },
      include: { items: true },
    })
    if (!bill) {
      throw new SellCancellationError('SELL_BILL_NOT_FOUND', 404, 'ไม่พบใบขาย')
    }
    if (bill.isCancelled) {
      throw new SellCancellationError(
        'SELL_BILL_ALREADY_CANCELLED',
        400,
        'ใบขายนี้ถูกยกเลิกไปแล้ว',
      )
    }

    // Test hook: inject failure before CAS claim.
    if (input._testHook?.beforeClaim) {
      await input._testHook.beforeClaim()
    }

    // CAS claim: atomically transition isCancelled false → true.
    const cancelledAt = input.cancelledAt ?? new Date()
    const claim = await tx.sellBill.updateMany({
      where: { id: input.id, isCancelled: false },
      data: {
        isCancelled: true,
        cancelledAt,
        cancelledBy: input.auth.userId,
        cancelReason: input.reason || null,
      },
    })
    if (claim.count !== 1) {
      throw new SellCancellationError(
        'SELL_CANCEL_CONFLICT',
        409,
        'สถานะใบขายเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่',
      )
    }

    // Test hook: inject failure after CAS claim.
    if (input._testHook?.afterClaim) {
      await input._testHook.afterClaim()
    }

    // Restore stock: create NEW SELL_CANCEL StockLots for each sold item.
    const now = new Date()
    for (const item of bill.items) {
      if (item.weight > 0) {
        await tx.stockLot.create({
          data: {
            productId: item.productId,
            remainingWeight: item.weight,
            costPerKg: item.costPerKg,
            dateAdded: now,
            source: 'SELL_CANCEL',
            sourceId: bill.id,
          },
        })
      }
    }

    // Cancel credit entry.
    await tx.creditEntry.updateMany({
      where: { referenceId: input.id, referenceType: 'SELL_BILL' },
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
      'SELL_BILL',
      input.id,
      'CANCELLATION_REVERSAL',
      cancelledAt,
      input.reason || 'Sale cancelled',
    )

    // Test hook: inject failure before audit.
    if (input._testHook?.beforeAudit) {
      await input._testHook.beforeAudit()
    }

    // Audit log.
    await tx.auditLog.create({
      data: {
        action: 'CANCEL',
        entityType: 'SELL_BILL',
        entityId: input.id,
        userId: input.auth.userId,
        userName: input.auth.name,
        details: JSON.stringify({
          billNumber: bill.billNumber,
          reason: input.reason || null,
          restoredWeight: bill.items.reduce((s, i) => s + i.weight, 0),
          restoredCost: bill.items.reduce((s, i) => s + i.totalCost, 0),
        }),
      },
    })
  })
}

export function mapSellCancellationError(error: unknown) {
  if (error instanceof SellCancellationError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return {
    status: 500,
    body: { error: 'ไม่สามารถยกเลิกใบขายได้ กรุณาลองใหม่ภายหลัง', code: 'SELL_CANCEL_FAILED' },
  }
}
