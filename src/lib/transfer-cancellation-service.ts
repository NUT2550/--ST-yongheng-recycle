import type { Prisma } from '@prisma/client'
import { reverseSourceMovements } from './stock-movement-reversal'

/**
 * ST-71: Transfer cancellation service — extracted from route handler for
 * runtime testability against real PostgreSQL.
 *
 * Follows the ST-70 Sorting cancellation pattern:
 *   - All reads and mutations inside a single $transaction
 *   - CAS (compare-and-swap) guard via updateMany with isCancelled: false
 *   - Per-item downstream-use rejection (tolerance 0.01)
 *   - Test-only fault injection hook (unavailable in Production)
 */

export type TransferCancellationCode =
  | 'TRANSFER_NOT_FOUND'
  | 'TRANSFER_ALREADY_CANCELLED'
  | 'TRANSFER_HAS_DOWNSTREAM_USAGE'
  | 'TRANSFER_CANCEL_CONFLICT'

export class TransferCancellationError extends Error {
  constructor(
    public readonly code: TransferCancellationCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'TransferCancellationError'
  }
}

interface BillItem {
  productId: string
  weight: number
  isWaste: boolean
}

interface Bill {
  id: string
  billNumber: string | null
  sourceProductId: string
  sourceWeight: number
  sourceCostPerKg: number
  isCancelled: boolean
  items: BillItem[]
}

interface OutputLot {
  id: string
  productId: string
  remainingWeight: number
}

interface Tx {
  stockTransfer: {
    findUnique(args: unknown): Promise<Bill | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  stockLot: {
    findFirst(args: unknown): Promise<OutputLot | null>
    deleteMany(args: unknown): Promise<unknown>
    create(args: unknown): Promise<unknown>
  }
  product: { findUnique(args: unknown): Promise<{ name: string } | null> }
  auditLog: { create(args: unknown): Promise<unknown> }
  stockMovement: {
    findMany(args: unknown): Promise<unknown[]>
    createMany(args: unknown): Promise<unknown>
  }
}

export interface TransferCancellationDb {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

export interface TransferCancellationTestHook {
  beforeClaim?: () => void | Promise<void>
  afterClaim?: () => void | Promise<void>
  beforeReversal?: () => void | Promise<void>
  beforeAudit?: () => void | Promise<void>
}

export interface TransferCancellationInput {
  id: string
  reason: string
  auth: { userId: string; name: string }
  cancelledAt?: Date
  _testHook?: TransferCancellationTestHook
}

export async function cancelTransferBill(
  db: TransferCancellationDb,
  input: TransferCancellationInput,
): Promise<void> {
  await db.$transaction(async (tx) => {
    const bill = await tx.stockTransfer.findUnique({
      where: { id: input.id },
      include: { items: true },
    })
    if (!bill) {
      throw new TransferCancellationError('TRANSFER_NOT_FOUND', 404, 'ไม่พบใบย้ายสต็อก')
    }
    if (bill.isCancelled) {
      throw new TransferCancellationError(
        'TRANSFER_ALREADY_CANCELLED',
        400,
        'ใบย้ายสต็อกนี้ถูกยกเลิกไปแล้ว',
      )
    }

    // STRICT per-item downstream check: verify no output stock lot has been
    // consumed downstream. For each non-waste output item, find the StockLot
    // created by this transfer and confirm remainingWeight still equals the
    // original item weight.
    for (const item of bill.items) {
      if (item.isWaste) continue
      const outLot = await tx.stockLot.findFirst({
        where: { source: 'TRANSFER', sourceId: bill.id, productId: item.productId },
      })
      if (!outLot) continue
      const consumed = item.weight - outLot.remainingWeight
      if (consumed > 0.01) {
        const prod = await tx.product.findUnique({
          where: { id: item.productId },
          select: { name: true },
        })
        throw new TransferCancellationError(
          'TRANSFER_HAS_DOWNSTREAM_USAGE',
          400,
          `ไม่สามารถยกเลิกได้: สต็อก output "${prod?.name || item.productId}" ถูกใช้ไปแล้ว ${consumed.toFixed(2)} กก. (จาก ${item.weight} กก.). กรุณาย้อนกลับไปลบบิลขาย/คัดแยก/ย้ายที่เกี่ยวข้องก่อน`,
        )
      }
    }

    // Test hook: inject failure before CAS claim.
    if (input._testHook?.beforeClaim) {
      await input._testHook.beforeClaim()
    }

    // CAS claim: atomically transition isCancelled false → true.
    const cancelledAt = input.cancelledAt ?? new Date()
    const claim = await tx.stockTransfer.updateMany({
      where: { id: input.id, isCancelled: false },
      data: {
        isCancelled: true,
        cancelledAt,
        cancelledBy: input.auth.userId,
        cancelReason: input.reason || null,
      },
    })
    if (claim.count !== 1) {
      throw new TransferCancellationError(
        'TRANSFER_CANCEL_CONFLICT',
        409,
        'สถานะใบย้ายสต็อกเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่',
      )
    }

    // Test hook: inject failure after CAS claim.
    if (input._testHook?.afterClaim) {
      await input._testHook.afterClaim()
    }

    // Safe to cancel: delete all output StockLots (fully unconsumed).
    await tx.stockLot.deleteMany({
      where: { source: 'TRANSFER', sourceId: input.id },
    })

    // Restore source stock as a new lot (cost preserved from bill).
    if (bill.sourceWeight > 0) {
      await tx.stockLot.create({
        data: {
          productId: bill.sourceProductId,
          remainingWeight: bill.sourceWeight,
          costPerKg: bill.sourceCostPerKg,
          dateAdded: new Date(),
          source: 'TRANSFER_CANCEL',
          sourceId: input.id,
        },
      })
    }

    // Test hook: inject failure before reversal.
    if (input._testHook?.beforeReversal) {
      await input._testHook.beforeReversal()
    }

    await reverseSourceMovements(
      tx as never,
      'STOCK_TRANSFER',
      input.id,
      'CANCELLATION_REVERSAL',
      cancelledAt,
      input.reason || 'Transfer cancelled',
    )

    // Test hook: inject failure before audit.
    if (input._testHook?.beforeAudit) {
      await input._testHook.beforeAudit()
    }

    // Audit log.
    await tx.auditLog.create({
      data: {
        action: 'CANCEL',
        entityType: 'STOCK_TRANSFER',
        entityId: input.id,
        userId: input.auth.userId,
        userName: input.auth.name,
        details: JSON.stringify({
          billNumber: bill.billNumber,
          reason: input.reason || null,
          restoredSourceWeight: bill.sourceWeight,
          restoredSourceCostPerKg: bill.sourceCostPerKg,
          deletedOutputLots: bill.items.filter((i) => !i.isWaste).length,
        }),
      },
    })
  })
}

export function mapTransferCancellationError(error: unknown) {
  if (error instanceof TransferCancellationError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return {
    status: 500,
    body: { error: 'ไม่สามารถยกเลิกใบย้ายสต็อกได้ กรุณาลองใหม่ภายหลัง', code: 'TRANSFER_CANCEL_FAILED' },
  }
}
