import type { StockMovementType } from './stock-movement-ledger'
import { reverseSourceMovements } from './stock-movement-reversal'

export type SortingCancellationCode =
  | 'SORTING_BILL_NOT_FOUND'
  | 'SORTING_BILL_ALREADY_CANCELLED'
  | 'SORTING_BILL_HAS_DOWNSTREAM_USAGE'
  | 'SORTING_CANCEL_CONFLICT'
  | 'SORTING_CANCEL_COST_EVIDENCE_MISSING'
  | 'SORTING_CANCEL_COST_EVIDENCE_CONFLICTING'
  | 'SORTING_CANCEL_COST_EVIDENCE_ZERO'

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

interface BillItem {
  productId: string
  weight: number
  isWaste: boolean
  costPerKg: number
}

interface Bill {
  id: string
  billNumber: string | null
  sourceProductId: string
  sourceWeight: number
  isCancelled: boolean
  items: BillItem[]
}

interface OutputLot {
  id: string
  productId: string
  remainingWeight: number
}

interface StockMovementRow {
  id: string
  productId: string
  businessDate: Date
  movementType: StockMovementType
  signedWeight: number
  sourceType: string
  sourceId: string
  sourceItemId: string | null
  sourceDocumentNumber: string | null
  reversalOfId: string | null
  idempotencyKey: string
  reason: string | null
  metadata: unknown
  createdById: string | null
  createdByName: string | null
}

interface Tx {
  sortingBill: {
    findUnique(args: unknown): Promise<Bill | null>
    updateMany(args: unknown): Promise<{ count: number }>
  }
  stockLot: {
    findMany(args: unknown): Promise<OutputLot[]>
    deleteMany(args: unknown): Promise<{ count: number }>
    create(args: unknown): Promise<unknown>
  }
  sortingBonus: { deleteMany(args: unknown): Promise<unknown> }
  auditLog: { create(args: unknown): Promise<unknown> }
  stockMovement: {
    findMany(args: unknown): Promise<StockMovementRow[]>
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

function readMovementCostPerKg(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== 'object') return null
  const candidate = (metadata as Record<string, unknown>).sourceCostPerKg
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) return null
  return candidate
}

interface ExpectedOutput {
  count: Map<string, number>
  weight: Map<string, number>
}

function buildExpectedOutputs(items: BillItem[]): ExpectedOutput {
  const count = new Map<string, number>()
  const weight = new Map<string, number>()
  for (const item of items) {
    if (item.isWaste || item.weight <= 0) continue
    const weightUnits = units(item.weight)
    if (weightUnits === null) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_CONFLICT',
        409,
        'ไม่สามารถยืนยันสต็อกผลลัพธ์ของบิลนี้ได้',
      )
    }
    count.set(item.productId, (count.get(item.productId) ?? 0) + 1)
    weight.set(item.productId, (weight.get(item.productId) ?? 0) + weightUnits)
  }
  return { count, weight }
}

function assertIntact(items: BillItem[], lots: OutputLot[]) {
  const expected = buildExpectedOutputs(items)
  const actualCount = new Map<string, number>()
  const actualWeight = new Map<string, number>()
  for (const lot of lots) {
    const weightUnits = units(lot.remainingWeight)
    if (weightUnits === null) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_CONFLICT',
        409,
        'ไม่สามารถยืนยันสต็อกผลลัพธ์ของบิลนี้ได้',
      )
    }
    actualCount.set(lot.productId, (actualCount.get(lot.productId) ?? 0) + 1)
    actualWeight.set(lot.productId, (actualWeight.get(lot.productId) ?? 0) + weightUnits)
  }
  if (expected.count.size !== actualCount.size) {
    throw failDownstream()
  }
  for (const [productId, count] of expected.count) {
    if (actualCount.get(productId) !== count) throw failDownstream()
    if (actualWeight.get(productId) !== expected.weight.get(productId)) throw failDownstream()
  }
}

function failDownstream(): SortingCancellationError {
  return new SortingCancellationError(
    'SORTING_BILL_HAS_DOWNSTREAM_USAGE',
    409,
    'ยกเลิกไม่ได้ เนื่องจากสต็อกผลลัพธ์ของบิลนี้ถูกนำไปใช้หรือเปลี่ยนแปลงแล้ว',
  )
}

/**
 * ST-70: Atomic compare-and-delete each expected output lot.
 *
 * Each lot is deleted only if its `productId` and `remainingWeight` still
 * match the values read inside the same transaction. This closes the TOCTOU
 * window between `findMany` and `deleteMany`: any concurrent sale/transfer/
 * sorting that CAS-reduces a lot between those operations will cause this
 * delete to affect zero rows, and we fail closed with 409.
 *
 * The transaction's atomicity guarantee then rolls back every prior mutation
 * (the conditional claim, any earlier lot deletion, the source restoration,
 * bonus deletion, reversal, audit) so no partial state commits.
 */
async function atomicDeleteOutputLots(tx: Tx, lots: OutputLot[]): Promise<void> {
  for (const lot of lots) {
    const result = await tx.stockLot.deleteMany({
      where: {
        id: lot.id,
        productId: lot.productId,
        remainingWeight: lot.remainingWeight,
      },
    })
    if (result.count !== 1) {
      throw new SortingCancellationError(
        'SORTING_BILL_HAS_DOWNSTREAM_USAGE',
        409,
        'ยกเลิกไม่ได้ เนื่องจากสต็อกผลลัพธ์ของบิลนี้ถูกนำไปใช้หรือเปลี่ยนแปลงแล้ว',
      )
    }
  }
}

interface CostEvidence {
  costPerKg: number
  source: 'SORTING_BILL_ITEM' | 'SOURCE_STOCK_MOVEMENT' | 'ZERO_SOURCE_WEIGHT'
}

/**
 * ST-70 Owner decision (PR #49 comment #9, 2026-07-25):
 * Cancellation is allowed only when authoritative source cost can be derived
 * inside the same Prisma transaction from source StockLot evidence or original
 * StockMovement evidence. Missing/conflicting/ambiguous/zero evidence must
 * fail closed with HTTP 409 and commit zero stock mutation.
 *
 * Evidence priority:
 *   1. If `bill.sourceWeight <= 0` — nothing to restore; cost = 0 (no
 *      evidence required, no StockLot created).
 *   2. Original non-reversal `SORTING_SOURCE_OUT` StockMovement metadata
 *      (`sourceCostPerKg`) — authoritative because it was captured at sort
 *      time inside the same transaction that created the bill.
 *   3. Non-waste `SortingBillItem.costPerKg` — captured at sort time and
 *      stored on the bill; equivalent to (2) for non-waste bills.
 *
 * If (2) and (3) both exist and disagree, fail closed with
 * `SORTING_CANCEL_COST_EVIDENCE_CONFLICTING`. If only one exists and is zero,
 * fail closed with `SORTING_CANCEL_COST_EVIDENCE_ZERO`. If neither exists and
 * `sourceWeight > 0`, fail closed with `SORTING_CANCEL_COST_EVIDENCE_MISSING`.
 *
 * We deliberately do NOT consult current source `StockLot` rows: their cost
 * may have drifted due to later purchases/sorts and would not represent the
 * cost actually paid at sort time.
 */
async function deriveSourceCostEvidence(
  tx: Tx,
  bill: Bill,
): Promise<CostEvidence> {
  if (bill.sourceWeight <= 0) {
    return { costPerKg: 0, source: 'ZERO_SOURCE_WEIGHT' }
  }

  // Evidence (2): original non-reversal SORTING_SOURCE_OUT movement metadata.
  const sourceOutMovements = await tx.stockMovement.findMany({
    where: {
      sourceType: 'SORTING_BILL',
      sourceId: bill.id,
      movementType: 'SORTING_SOURCE_OUT',
      reversalOfId: null,
    },
    select: { id: true, metadata: true },
  })

  const movementCosts = sourceOutMovements
    .map(m => readMovementCostPerKg(m.metadata))
    .filter((v): v is number => v !== null)

  // Evidence (3): non-waste SortingBillItem.costPerKg captured at sort time.
  const nonWasteItem = bill.items.find(item => !item.isWaste && item.costPerKg > 0)
  const itemCost = nonWasteItem ? nonWasteItem.costPerKg : null

  // All-waste bills: itemCost === null. We then require movementCosts.
  if (movementCosts.length > 0 && itemCost !== null) {
    // Both sources exist — they must agree to six decimals.
    const distinctCosts = new Set(
      [...movementCosts, itemCost].map(v => Math.round(v * SCALE)),
    )
    if (distinctCosts.size !== 1) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_COST_EVIDENCE_CONFLICTING',
        409,
        'ไม่สามารถยืนยันต้นทุนสต็อกต้นทางของบิลนี้ได้ เนื่องจากหลักฐานขัดแย้งกัน',
      )
    }
    return { costPerKg: itemCost, source: 'SOURCE_STOCK_MOVEMENT' }
  }

  if (movementCosts.length > 0) {
    const distinctCosts = new Set(movementCosts.map(v => Math.round(v * SCALE)))
    if (distinctCosts.size !== 1) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_COST_EVIDENCE_CONFLICTING',
        409,
        'ไม่สามารถยืนยันต้นทุนสต็อกต้นทางของบิลนี้ได้ เนื่องจากหลักฐานขัดแย้งกัน',
      )
    }
    const cost = movementCosts[0]
    if (cost <= 0) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_COST_EVIDENCE_ZERO',
        409,
        'ไม่สามารถยืนยันต้นทุนสต็อกต้นทางของบิลนี้ได้ เนื่องจากต้นทุนเป็นศูนย์',
      )
    }
    return { costPerKg: cost, source: 'SOURCE_STOCK_MOVEMENT' }
  }

  if (itemCost !== null) {
    if (itemCost <= 0) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_COST_EVIDENCE_ZERO',
        409,
        'ไม่สามารถยืนยันต้นทุนสต็อกต้นทางของบิลนี้ได้ เนื่องจากต้นทุนเป็นศูนย์',
      )
    }
    return { costPerKg: itemCost, source: 'SORTING_BILL_ITEM' }
  }

  // Neither evidence source exists but sourceWeight > 0 — fail closed.
  throw new SortingCancellationError(
    'SORTING_CANCEL_COST_EVIDENCE_MISSING',
    409,
    'ไม่สามารถยืนยันต้นทุนสต็อกต้นทางของบิลนี้ได้',
  )
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

    // ST-70: Read output lots and derive cost evidence BEFORE the conditional
    // claim. Both are read-only and must hold for cancellation to be safe.
    // If either fails, we throw before mutating any state — the transaction
    // rolls back with zero committed writes.
    const lots = await tx.stockLot.findMany({
      where: { source: 'SORTING', sourceId: input.id },
      select: { id: true, productId: true, remainingWeight: true },
    })
    assertIntact(bill.items, lots)
    const costEvidence = await deriveSourceCostEvidence(tx, bill)

    const cancelledAt = input.cancelledAt ?? new Date()
    const claim = await tx.sortingBill.updateMany({
      where: { id: input.id, isCancelled: false },
      data: {
        isCancelled: true,
        cancelledAt,
        cancelledBy: input.auth.userId,
        cancelReason: input.reason || null,
      },
    })
    if (claim.count !== 1) {
      throw new SortingCancellationError(
        'SORTING_CANCEL_CONFLICT',
        409,
        'สถานะใบคัดแยกเปลี่ยนแปลงแล้ว กรุณาโหลดข้อมูลใหม่',
      )
    }

    // ST-70: Atomic compare-and-delete each output lot guarded by the exact
    // (productId, remainingWeight) read above. Any concurrent mutation between
    // the read and this delete causes count=0 and we fail closed.
    await atomicDeleteOutputLots(tx, lots)

    if (bill.sourceWeight > 0) {
      await tx.stockLot.create({
        data: {
          productId: bill.sourceProductId,
          remainingWeight: bill.sourceWeight,
          costPerKg: costEvidence.costPerKg,
          dateAdded: cancelledAt,
          source: 'SORT_CANCEL',
          sourceId: bill.id,
        },
      })
    }
    await tx.sortingBonus.deleteMany({ where: { sortingBillId: input.id } })
    await reverseSourceMovements(
      tx,
      'SORTING_BILL',
      input.id,
      'CANCELLATION_REVERSAL',
      cancelledAt,
      input.reason || 'Sorting cancelled',
    )
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
          restoredSourceCostPerKg: costEvidence.costPerKg,
          restoredSourceCostEvidence: costEvidence.source,
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
