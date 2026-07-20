/**
 * ST-54: Testable sorting bill transaction service.
 *
 * Extracted from src/app/api/sorting-bills/route.ts so the transaction logic
 * can be tested with a real in-memory transaction adapter (not source-text inspection).
 *
 * The production route calls this service with PrismaProductionSortingDeps.
 * Tests call this service with an in-memory adapter that models commit/rollback.
 */
import { buildSortingMovements, type StockMovementDraft } from './stock-movement-ledger'
import {
  previewFifoDeduction,
  validateSourceLotCosts,
  verifyFifoMatch,
  FIFO_ORDER_BY,
} from './fifo-validation'
import type { FifoPreviewSuccess } from './fifo-validation'
import { isRealFormula } from './safe-math'
import type { Prisma } from '@prisma/client'

// ============================================================================
// Types
// ============================================================================

export interface SortingItemInput {
  productId: string
  weight: number
  weightExpression?: string
  isWaste: boolean
  sortedPricePerKg: number
  bonusAmount: number
}

export interface SortingBillInput {
  date: string
  sourceProductId: string
  sourceWeight: number
  sourceWeightExpression?: string
  sourcePricePerKg: number
  weighedTotal: number
  weighedTotalExpression?: string
  roomNumber?: string
  note?: string
  items: SortingItemInput[]
  billNumber: string
}

export interface SourceLotData {
  id: string
  productId: string
  remainingWeight: number
  costPerKg: number
  dateAdded: Date
  createdAt: Date
}

export interface SortingBillResult {
  id: string
  billNumber: string
  sourceProductId: string
  sourceWeight: number
  sourceCostPerKg: number
  lossWeight: number
  lossCost: number
  items: Array<{
    id: string
    productId: string
    weight: number
    isWaste: boolean
    costPerKg: number
    totalCost: number
  }>
}

export type FifoPreviewResult = FifoPreviewSuccess

// ============================================================================
// Dependency Injection Interface
// ============================================================================

/**
 * Transaction context — what the service can do inside a transaction.
 * Both the Prisma adapter and the test adapter implement this interface.
 */
export interface SortingTxContext {
  findSourceLots(productId: string): Promise<SourceLotData[]>
  /**
   * Compare-and-set source lot update.
   * Throws SourceLotConflictError if the lot's current values don't match expected.
   */
  updateSourceLot(
    lotId: string,
    expected: { productId: string; remainingWeight: number; costPerKg: number },
    newRemainingWeight: number,
  ): Promise<void>
  createSortingBill(data: {
    billNumber: string
    date: Date
    sourceProductId: string
    sourceWeight: number
    sourceWeightExpression: string | null
    sourcePricePerKg: number
    weighedTotal: number
    weighedTotalExpression: string | null
    lossWeight: number
    lossCost: number
    roomNumber: string | null
    note: string | null
    items: Array<{
      productId: string
      weight: number
      weightExpression: string | null
      isWaste: boolean
      costPerKg: number
      totalCost: number
      sortedPricePerKg: number
      bonusAmount: number
    }>
  }): Promise<SortingBillResult>
  createOutputStockLots(data: Array<{
    productId: string
    remainingWeight: number
    costPerKg: number
    dateAdded: Date
    source: string
    sourceId: string
  }>): Promise<number>
  createStockMovements(data: StockMovementDraft[]): Promise<number>
}

export interface SortingDeps {
  /** Pre-transaction: load source lots for preview */
  loadSourceLots(productId: string): Promise<SourceLotData[]>
  /** Execute the transaction */
  transaction<T>(fn: (tx: SortingTxContext) => Promise<T>): Promise<T>
}

// ============================================================================
// Error types
// ============================================================================

export class SortingError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number = 400,
  ) {
    super(message)
    this.name = 'SortingError'
  }
}

export class FifoMismatchError extends SortingError {
  constructor() {
    super('FIFO preview/execution mismatch', 'FIFO_MISMATCH', 409)
  }
}

export class InsufficientStockError extends SortingError {
  constructor(productId: string, available: number, requested: number) {
    super(
      `Insufficient stock for product ${productId}. Available: ${available}, Requested: ${requested}`,
      'INSUFFICIENT_STOCK',
      400,
    )
  }
}

export class TransactionTimeoutError extends SortingError {
  constructor() {
    super(
      'การบันทึกใช้เวลานานเกินไป ระบบได้ยกเลิกรายการทั้งหมดแล้ว กรุณารอสักครู่และลองใหม่ หากยังเกิดซ้ำให้แจ้งผู้ดูแล',
      'TRANSACTION_TIMEOUT',
      503,
    )
  }
}

export class SourceLotConflictError extends SortingError {
  constructor() {
    super(
      'สต็อกต้นทางมีการเปลี่ยนแปลงระหว่างบันทึก ระบบยกเลิกรายการทั้งหมดแล้ว กรุณาโหลดข้อมูลใหม่และบันทึกอีกครั้ง',
      'SOURCE_LOT_CONFLICT',
      409,
    )
  }
}

// ============================================================================
// Core service: createSortingBillTransaction
// ============================================================================

export async function createSortingBillTransaction(
  deps: SortingDeps,
  input: SortingBillInput,
  preFlightPreview?: FifoPreviewSuccess,
): Promise<{ sortingBill: SortingBillResult; sourceCostPerKg: number; lossWeight: number; lossCost: number }> {
  // Pre-flight: load source lots and build FIFO preview (outside transaction)
  const sourceLots = preFlightPreview
    ? await deps.loadSourceLots(input.sourceProductId)
    : await deps.loadSourceLots(input.sourceProductId)

  const hasNonWasteOutput = input.items.some((i) => !i.isWaste && i.weight > 0)

  const fifoPreview = preFlightPreview ?? previewFifoDeduction(
    input.sourceProductId,
    input.sourceWeight,
    sourceLots.map((l) => ({
      id: l.id,
      remainingWeight: l.remainingWeight,
      costPerKg: l.costPerKg,
      dateAdded: l.dateAdded,
      createdAt: l.createdAt,
    })),
  )

  if (!fifoPreview.success) {
    throw new SortingError(fifoPreview.message || 'FIFO preview failed', fifoPreview.code || 'FIFO_ERROR')
  }

  const costValidation = validateSourceLotCosts(fifoPreview, {
    type: 'SORTING',
    hasNonWasteOutput,
  })
  if (!costValidation.valid) {
    throw new SortingError(costValidation.message, costValidation.code)
  }

  // Execute the atomic transaction
  return deps.transaction(async (tx) => {
    // 1. Reload source lots inside transaction (detect concurrent drift)
    const txSourceLots = await tx.findSourceLots(input.sourceProductId)
    const totalAvailable = txSourceLots.reduce((sum, l) => sum + l.remainingWeight, 0)
    if (totalAvailable < input.sourceWeight) {
      throw new InsufficientStockError(input.sourceProductId, totalAvailable, input.sourceWeight)
    }

    // 2. Execute FIFO deduction (sequential per-lot updates — preserves FIFO evidence)
    let remaining = input.sourceWeight
    let totalCost = 0
    const deductedLots: { id: string; deducted: number }[] = []

    for (const lot of txSourceLots) {
      if (remaining <= 0) break
      const deductFromLot = Math.min(lot.remainingWeight, remaining)
      totalCost += deductFromLot * lot.costPerKg
      remaining -= deductFromLot
      await tx.updateSourceLot(
        lot.id,
        { productId: lot.productId, remainingWeight: lot.remainingWeight, costPerKg: lot.costPerKg },
        lot.remainingWeight - deductFromLot,
      )
      deductedLots.push({ id: lot.id, deducted: deductFromLot })
    }

    const sourceCostPerKg = input.sourceWeight > 0
      ? Math.round((totalCost / input.sourceWeight) * 100) / 100
      : 0
    const totalCostRounded = Math.round(totalCost * 100) / 100

    // 3. Verify FIFO match (detects concurrent modification between preview and transaction)
    const actualFifo = {
      costPerKg: sourceCostPerKg,
      totalCost: totalCostRounded,
      deductedLots,
    }
    if (!verifyFifoMatch(fifoPreview, actualFifo)) {
      throw new FifoMismatchError()
    }

    // 4. Calculate loss
    const itemsTotalWeight = input.items.reduce((sum, i) => sum + i.weight, 0)
    const lossWeight = Math.round((input.sourceWeight - itemsTotalWeight) * 100) / 100
    const lossCost = Math.round(lossWeight * sourceCostPerKg * 100) / 100

    // 5. Build sorting items
    const sortingItems = input.items.map((item) => ({
      productId: item.productId,
      weight: item.weight,
      weightExpression: isRealFormula(item.weightExpression) ? item.weightExpression!.trim() : null,
      isWaste: item.isWaste,
      costPerKg: item.isWaste ? 0 : sourceCostPerKg,
      totalCost: item.isWaste ? 0 : Math.round(item.weight * sourceCostPerKg * 100) / 100,
      sortedPricePerKg: item.isWaste ? 0 : item.sortedPricePerKg,
      bonusAmount: item.isWaste ? 0 : Math.round(item.bonusAmount * 100) / 100,
    }))

    // 6. Create SortingBill + items
    const sortingBill = await tx.createSortingBill({
      billNumber: input.billNumber,
      date: new Date(input.date),
      sourceProductId: input.sourceProductId,
      sourceWeight: input.sourceWeight,
      sourceWeightExpression: isRealFormula(input.sourceWeightExpression) ? input.sourceWeightExpression!.trim() : null,
      sourcePricePerKg: input.sourcePricePerKg || 0,
      weighedTotal: input.weighedTotal || 0,
      weighedTotalExpression: isRealFormula(input.weighedTotalExpression) ? input.weighedTotalExpression!.trim() : null,
      lossWeight,
      lossCost,
      roomNumber: input.roomNumber?.trim() || null,
      note: input.note || null,
      items: sortingItems,
    })

    // 7. Create output StockLots (batch createMany)
    const outputLotData = input.items
      .filter((item) => !item.isWaste && item.weight > 0)
      .map((item) => ({
        productId: item.productId,
        remainingWeight: item.weight,
        costPerKg: sourceCostPerKg,
        dateAdded: new Date(input.date),
        source: 'SORTING',
        sourceId: sortingBill.id,
      }))
    if (outputLotData.length > 0) {
      await tx.createOutputStockLots(outputLotData)
    }

    // 8. Create StockMovement ledger entries
    const movements = buildSortingMovements({
      id: sortingBill.id,
      billNumber: input.billNumber,
      date: new Date(input.date),
      sourceProductId: input.sourceProductId,
      sourceWeight: input.sourceWeight,
      items: sortingBill.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        weight: item.weight,
        isWaste: item.isWaste,
      })),
    })
    await tx.createStockMovements(movements)

    return { sortingBill, sourceCostPerKg, lossWeight, lossCost }
  })
}

// ============================================================================
// Error mapping: Prisma errors → SortingError
// ============================================================================

export function mapPrismaError(error: unknown): SortingError {
  const code = (error as { code?: string })?.code
  if (code === 'P2028') {
    return new TransactionTimeoutError()
  }
  if (error instanceof SortingError) {
    return error
  }
  const message = error instanceof Error ? error.message : 'Failed to create sorting bill'
  if (message.includes('Insufficient stock')) {
    return new SortingError(message, 'INSUFFICIENT_STOCK', 400)
  }
  if (message.includes('Unique constraint failed') && message.includes('billNumber')) {
    return new SortingError('หมายเลขบิลซ้ำ — กรุณาลองบันทึกอีกครั้ง', 'DUPLICATE_BILL_NUMBER', 409)
  }
  return new SortingError(message, 'UNKNOWN', 500)
}
