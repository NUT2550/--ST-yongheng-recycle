import { reverseSourceMovements } from './stock-movement-reversal'

export type SortingCancellationCode =
  | 'SORTING_BILL_NOT_FOUND'
  | 'SORTING_BILL_ALREADY_CANCELLED'
  | 'SORTING_BILL_HAS_DOWNSTREAM_USAGE'
  | 'SORTING_CANCEL_CONFLICT'

export class SortingCancellationError extends Error {
  constructor(
    public readonly code: SortingCancellationCode,
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'SortingCancellationError'
  }
}

interface Bill {
  id: string
  billNumber: string | null
  sourceProductId: string
  sourceWeight: number
  isCancelled: boolean
  items: Array<{ productId: string; weight: number; isWaste: boolean; costPerKg: number }>
}

interface Tx {
  sortingBill: {
    findUnique(args: unknown): Promise<Bill | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  stockLot: {
    findMany(args: unknown): Promise<Array<{ id: string; productId: string; remainingWeight: number }>>
    deleteMany(args: unknown): Promise<{ count: number }>
    create(args: unknown): Promise<unknown>
  }
  sortingBonus: { deleteMany(args: unknown): Promise<unknown> }
  auditLog: { create(args: unknown): Promise<unknown> }
  stockMovement: {
    findMany(args: unknown): Promise<never[]>
    createMany(args: unknown): Promise<unknown>
  }
}

export interface SortingCancellationDb {
  $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T>
}

const SCALE = 1_000_000
function units(value: number): number | null {
  return Number.isFinite(value) && value >= 0 ? Math.round(value * SCALE) : null
}

function assertIntact(
  items: Bill['items'],
  lots: Array<{ id: string; productId: string; remainingWeight: number }>,
) {
  const expected = new Map<string, { count: number; weight: number }>()
  for (const item of items) {
    if (item.isWaste || item.weight <= 0) continue
    const weight = units(item.weight)
    if (weight === null) {
      throw new SortingCancellationError('SORTING_CANCEL_CONFLICT', 409, 'ไม่สามารถยืนยันสต็อกผลลัพธ์ของบิลนี้ได้')
    }
    const value = expected.get(item.productId) ?? { count: 0, weight: 0 }
    expected.set(item.productId, { count: value.count + 1, weight: value.weight + weight })
  }
  const actual = new Map<string, { count: number; weight: number }>()
  for (const lot of lots) {
    const weight = units(lot.remainingWeight)
    if (weight === null) {
      throw new SortingCancellationError('SORTING_CANCEL_CONFLICT', 409, 'ไม่สามารถยืนยันสต็อกผลลัพธ์ของบิลนี้ได้')
    }
    const value = actual.get(lot.productId) ?? { count: 0, weight: 0 }
    actual.set(lot.productId, { count: value.count + 1, weight: value.weight + weight })
  }
  const matches = expected.size === actual.size && [...expected].every(([id, value]) => {
    const found = actual.get(id)
    return found?.count === value.count && found.weight === value.weight
  })
  if (!matches) {
    throw new SortingCancellationError(
      'SORTING_BILL_HAS_DOWNSTREAM_USAGE',
      409,
      'ยกเลิกไม่ได้ เนื่องจากสต็อกผลลัพธ์ของบิลนี้ถูกนำไปใช้หรือเปลี่ยนแปลงแล้ว',
    )
  }
}

export async function cancelSortingBill(
  db: SortingCancellationDb,
  input: { id: string; reason: string; auth: { userId: string; name: string }; cancelledAt?: Date },
) {
  await db.$transaction(async tx => {
    const bill = await tx.sortingBill.findUnique({ where: { id: input.id }, include: { items: true } })
    if (!bill) throw new SortingCancellationError('SORTING_BILL_NOT_FOUND', 404, 'ไม่พบใบคัดแยก')
    if (bill.isCancelled) {
      throw new SortingCancellationError('SORTING_BILL_ALREADY_CANCELLED', 409, 'ใบคัดแยกนี้ถูกยกเลิกไปแล้ว')
    }
    const cancelledAt = input.cancelledAt ?? new Date()
    const claim = await tx.sortingBill.updateMany({
      where: { id: input.id, isCancelled: false },
      data: { isCancelled: true, cancelledAt, cancelledBy: input.auth.userId, cancelReason: input.reason || null },
    })
    if (claim.count !== 1) {
      throw new SortingCancellationError('SORTING_CANCEL_CONFLICT', 409, 'สถานะใบคัดแยกเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่')
    }

    const lots = await tx.stockLot.findMany({
      where: { source: 'SORTING', sourceId: input.id },
      select: { id: true, productId: true, remainingWeight: true },
    })
    assertIntact(bill.items, lots)
    const deleted = await tx.stockLot.deleteMany({ where: { id: { in: lots.map(lot => lot.id) } } })
    if (deleted.count !== lots.length) {
      throw new SortingCancellationError('SORTING_CANCEL_CONFLICT', 409, 'สถานะสต็อกผลลัพธ์เปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่')
    }

    const sourceCostPerKg = bill.items.find(item => !item.isWaste && item.costPerKg > 0)?.costPerKg ?? 0
    if (bill.sourceWeight > 0 && sourceCostPerKg <= 0) {
      throw new SortingCancellationError('SORTING_CANCEL_CONFLICT', 409, 'ไม่สามารถยืนยันต้นทุนสต็อกต้นทางของบิลนี้ได้')
    }
    if (bill.sourceWeight > 0) {
      await tx.stockLot.create({
        data: {
          productId: bill.sourceProductId,
          remainingWeight: bill.sourceWeight,
          costPerKg: sourceCostPerKg,
          dateAdded: cancelledAt,
          source: 'SORT_CANCEL',
          sourceId: bill.id,
        },
      })
    }
    await tx.sortingBonus.deleteMany({ where: { sortingBillId: input.id } })
    await reverseSourceMovements(tx, 'SORTING_BILL', input.id, 'CANCELLATION_REVERSAL', cancelledAt, input.reason || 'Sorting cancelled')
    await tx.auditLog.create({
      data: {
        action: 'CANCEL',
        entityType: 'SORTING_BILL',
        entityId: input.id,
        userId: input.auth.userId,
        userName: input.auth.name,
        details: JSON.stringify({
          billNumber: bill.billNumber,
          reason: input.reason || null,
          restoredSourceWeight: bill.sourceWeight,
          restoredSourceCostPerKg: sourceCostPerKg,
          removedOutputLotCount: lots.length,
        }),
      },
    })
  })
}

export function mapSortingCancellationError(error: unknown) {
  if (error instanceof SortingCancellationError) {
    return { status: error.status, body: { error: error.message, code: error.code } }
  }
  return {
    status: 500,
    body: { error: 'ไม่สามารถยกเลิกใบคัดแยกได้ กรุณาลองใหม่ภายหลัง', code: 'SORTING_CANCEL_FAILED' },
  }
}
