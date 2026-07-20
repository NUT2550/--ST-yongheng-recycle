/**
 * ST-8: Shared bill creation services.
 *
 * These services extract the bill-creation logic from the Production
 * `/api/buy-bills` and `/api/sell-bills` POST routes so that BOTH the
 * original routes AND the ST-8 import pipeline use the SAME production
 * path. Tests import these services with mock deps — no Production DB.
 *
 * Key contracts (all 8 ST-8 blockers addressed here):
 *
 *   - Blocker 3: Production parity. The original POST routes and the
 *     import apply route both call these services.
 *   - Blocker 4: FIFO_ORDER_BY is imported from `@/lib/fifo-validation`
 *     (canonical ST-39 ordering: dateAdded ASC, createdAt ASC, id ASC).
 *     There is NO local FIFO constant in this module.
 *   - Blocker 5 (ST-20): createSellBillService calls previewFifoDeduction
 *     + validateSourceLotCosts BEFORE actual deduction. Zero-cost source
 *     lots are rejected.
 *   - Blocker 6 (ST-11): createSellBillService runs deduction + bill
 *     create + audit log inside ONE deps.transaction — same as the
 *     Production sell-bills route. Any failure rolls back ALL lot
 *     updates atomically. No durable CompensationOperation is used
 *     (Production sell-bills does not use one — it relies on the
 *     interactive $transaction).
 *   - Blocker 7: Prisma P2002 (unique constraint violation) is caught
 *     specifically and re-thrown as DuplicateExistingError so callers
 *     can classify the bill as DUPLICATE_EXISTING (not FAILED).
 *
 * StockMovement architecture note: the schema has NO StockMovement
 * model. Production uses StockLot.remainingWeight as the sole
 * inventory ledger. These services do NOT create StockMovement
 * records.
 *
 * No `import 'server-only'` here — these are pure functions over
 * injectable deps. Safe for tests.
 */

import {
  FIFO_ORDER_BY,
  previewFifoDeduction,
  validateSourceLotCosts,
  type SourceLotForPreview,
} from './fifo-validation'
import {
  buildPurchaseMovements,
  buildSaleMovements,
  type StockMovementDraft,
} from './stock-movement-ledger'
import { isRealFormula } from './safe-math'
import { normalizeBillNumber } from './bill-identity'
import {
  DuplicateExistingError,
  FifoValidationError,
  InsufficientStockError,
  isPrismaP2002,
  isP2002OnField,
} from './bill-errors'
import type { AuthPayload } from './permissions'

// DuplicateExistingError + isPrismaP2002 imported from ./bill-errors (no circular dependency)

// ============================================================================
// Server-side validation helpers (pure)
// ============================================================================

/**
 * Validate a single bill item's numeric fields.
 *
 * Rules:
 *   - weight: must be a finite number, strictly > 0
 *   - pricePerKg: must be a finite number, >= 0
 *   - NaN / Infinity / -Infinity -> rejected
 *
 * @returns null if valid, otherwise a Thai error message.
 */
export function validateBuyBillItemNumeric(item: {
  weight: number
  pricePerKg: number
}): string | null {
  if (
    typeof item.weight !== 'number' ||
    !Number.isFinite(item.weight) ||
    item.weight <= 0
  ) {
    return 'น้ำหนักต้องมากกว่า 0'
  }
  if (
    typeof item.pricePerKg !== 'number' ||
    !Number.isFinite(item.pricePerKg) ||
    item.pricePerKg < 0
  ) {
    return 'ราคา/กก. ต้องไม่ติดลบ'
  }
  return null
}

export function validateSellBillItemNumeric(item: {
  weight: number
  pricePerKg: number
}): string | null {
  if (
    typeof item.weight !== 'number' ||
    !Number.isFinite(item.weight) ||
    item.weight <= 0
  ) {
    return 'น้ำหนักต้องมากกว่า 0'
  }
  if (
    typeof item.pricePerKg !== 'number' ||
    !Number.isFinite(item.pricePerKg) ||
    item.pricePerKg <= 0
  ) {
    return 'ราคา/กก. ต้องมากกว่า 0'
  }
  return null
}

// Backwards-compatible alias (uses Purchase rules: pricePerKg >= 0)
export function validateBillItemNumeric(item: {
  weight: number
  pricePerKg: number
}): string | null {
  return validateBuyBillItemNumeric(item)
}

/**
 * Validate that a date string parses to a valid Date.
 *
 * @returns null if valid, otherwise a Thai error message.
 */
export function validateBillDate(dateString: unknown): string | null {
  if (typeof dateString !== 'string' || !dateString.trim()) {
    return 'วันที่ไม่ถูกต้อง'
  }
  const d = new Date(dateString)
  if (isNaN(d.getTime())) return 'วันที่ไม่ถูกต้อง'
  return null
}

/**
 * Round to 2 decimal places (matches Production rounding everywhere).
 */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ============================================================================
// Buy Bill Service
// ============================================================================

export interface BuyBillItemInput {
  productId: string
  weight: number
  weightExpression?: string
  pricePerKg: number
}

export interface BuyBillInput {
  date: string
  isCredit: boolean
  note?: string
  externalBillNumber?: string
  items: BuyBillItemInput[]
}

/**
 * Minimum shape the service requires from the created BuyBill.
 * Callers (Production route, import route) may return a richer shape
 * (e.g. with `items: { include: { product: true } }`) — the service
 * passes it through untouched via the generic TBill parameter.
 */
export interface BuyBillCreatedBill {
  id: string
  items: Array<{ id?: string; productId: string; weight: number; pricePerKg: number }>
}

/** Shape of the `args` object passed to BuyBillTx.createBuyBill (matches Prisma's `{ data }` convention). */
export interface BuyBillCreateArgs {
  data: {
    billNumber: string
    externalBillNumber: string | null
    date: Date
    isCredit: boolean
    note: string | null
    totalAmount: number
    items: {
      create: Array<{
        productId: string
        weight: number
        weightExpression: string | null
        pricePerKg: number
        totalAmount: number
      }>
    }
  }
}

/**
 * Transaction handle for buy-bill creation.
 * Mirrors the subset of Prisma's tx client that the service uses.
 */
export interface BuyBillTx<TBill extends BuyBillCreatedBill = BuyBillCreatedBill> {
  createBuyBill(args: BuyBillCreateArgs): Promise<TBill>
  createStockLots(data: Array<{
    productId: string
    remainingWeight: number
    costPerKg: number
    dateAdded: Date
    source: string
    sourceId: string
  }>): Promise<unknown>
  createCreditEntry?(data: {
    type: string
    amount: number
    paidAmount: number
    referenceType: string
    referenceId: string
    description: string
    date: Date
    isSettled: boolean
  }): Promise<unknown>
  createAuditLog(data: {
    action: string
    entityType: string
    entityId: string
    userId?: string | null
    userName?: string | null
    details?: string | null
  }): Promise<unknown>
  createStockMovements?(data: StockMovementDraft[]): Promise<unknown>
}

export interface BuyBillServiceDeps<TBill extends BuyBillCreatedBill = BuyBillCreatedBill> {
  /** Generate the next BUY- bill number. */
  generateBillNumber(): Promise<string>
  /** Run a callback inside an atomic Prisma $transaction. */
  transaction<T>(fn: (tx: BuyBillTx<TBill>) => Promise<T>): Promise<T>
}

export interface BuyBillServiceResult<TBill extends BuyBillCreatedBill = BuyBillCreatedBill> {
  bill: TBill
  billNumber: string
  totalAmount: number
}

/**
 * Create a BuyBill - the SAME function the Production POST /api/buy-bills
 * route and the ST-8 import apply route use.
 *
 * Side effects (all inside ONE deps.transaction - ST-11 atomic):
 *   - BuyBill + BuyBillItem rows
 *   - StockLot rows (one per item; source='BUY')
 *   - CreditEntry (if isCredit)
 *   - AuditLog
 *
 * Validation (server-side, ignores client values for computed fields):
 *   - items non-empty
 *   - each item: weight finite > 0, pricePerKg finite >= 0
 *   - date parses to a valid Date
 *   - totalAmount is RECOMPUTED server-side (weight * pricePerKg per item, summed)
 *
 * Throws:
 *   - Error (validation message) on bad input
 *   - DuplicateExistingError on Prisma P2002 (caller classifies as DUPLICATE_EXISTING)
 *   - Other errors bubble up (caller classifies as FAILED)
 */
export async function createBuyBillService<TBill extends BuyBillCreatedBill = BuyBillCreatedBill>(
  deps: BuyBillServiceDeps<TBill>,
  input: BuyBillInput,
  auth: AuthPayload
): Promise<BuyBillServiceResult<TBill>> {
  if (!input.items || input.items.length === 0) {
    throw new Error('Items are required')
  }
  for (const item of input.items) {
    const err = validateBillItemNumeric(item)
    if (err) throw new Error(err)
  }
  const dateErr = validateBillDate(input.date)
  if (dateErr) throw new Error(dateErr)

  let totalAmount = 0
  const billItems = input.items.map((item) => {
    const itemTotal = item.weight * item.pricePerKg
    totalAmount += itemTotal
    return {
      productId: item.productId,
      weight: item.weight,
      weightExpression: isRealFormula(item.weightExpression)
        ? item.weightExpression!.trim()
        : null,
      pricePerKg: item.pricePerKg,
      totalAmount: round2(itemTotal),
    }
  })
  totalAmount = round2(totalAmount)

  const billNumber = await deps.generateBillNumber()
  const externalBillNumber = input.externalBillNumber
    ? (normalizeBillNumber(input.externalBillNumber) || null)
    : null
  const date = new Date(input.date)

  try {
    const bill = await deps.transaction(async (tx) => {
      const buyBill = await tx.createBuyBill({
        data: {
          billNumber,
          externalBillNumber,
          date,
          isCredit: input.isCredit,
          note: input.note || null,
          totalAmount,
          items: { create: billItems },
        },
      })

      // Create StockLots - purchase ADDS stock. StockLot.remainingWeight
      // is the sole inventory ledger (no StockMovement model exists).
      await tx.createStockLots(
        buyBill.items.map((item) => ({
          productId: item.productId,
          remainingWeight: item.weight,
          costPerKg: item.pricePerKg,
          dateAdded: date,
          source: 'BUY',
          sourceId: buyBill.id,
        }))
      )

      await tx.createStockMovements?.(buildPurchaseMovements({
        id: buyBill.id,
        billNumber,
        date,
        items: buyBill.items.map((item, index) => ({
          id: item.id || `item-${index}`,
          productId: item.productId,
          weight: item.weight,
        })),
      }))

      if (input.isCredit) {
        await tx.createCreditEntry?.({
          type: 'PAYABLE',
          amount: totalAmount,
          paidAmount: 0,
          referenceType: 'BUY_BILL',
          referenceId: buyBill.id,
          description: `ใบซื้อ ${billNumber}`,
          date,
          isSettled: false,
        })
      }

      await tx.createAuditLog({
        action: 'CREATE',
        entityType: 'BUY_BILL',
        entityId: buyBill.id,
        userId: auth.userId,
        userName: auth.name,
        details: JSON.stringify({
          billNumber,
          externalBillNumber,
          totalAmount,
          itemCount: buyBill.items.length,
          isCredit: input.isCredit,
        }),
      })

      return buyBill
    })

    return { bill, billNumber, totalAmount }
  } catch (err) {
    if (isP2002OnField(err, 'externalBillNumber')) {
      throw new DuplicateExistingError('externalBillNumber')
    }
    throw err
  }
}

// ============================================================================
// Sell Bill Service
// ============================================================================

export interface SellBillItemInput {
  productId: string
  weight: number
  weightExpression?: string
  pricePerKg: number
}

export interface SellBillInput {
  date: string
  customerId?: string
  isCredit: boolean
  note?: string
  externalBillNumber?: string
  items: SellBillItemInput[]
}

/**
 * Minimum shape the service requires from the created SellBill.
 */
export interface SellBillCreatedBill {
  id: string
  externalBillNumber: string | null
  items: Array<{ id?: string; productId: string; weight: number; pricePerKg: number }>
}

/** Shape of the `args` object passed to SellBillTx.createSellBill (matches Prisma's `{ data }` convention). */
export interface SellBillCreateArgs {
  data: {
    billNumber: string
    date: Date
    customerId: string | null
    isCredit: boolean
    note: string | null
    externalBillNumber: string | null
    totalAmount: number
    totalCost: number
    items: {
      create: Array<{
        productId: string
        weight: number
        weightExpression: string | null
        pricePerKg: number
        totalAmount: number
        costPerKg: number
        totalCost: number
      }>
    }
  }
}

/**
 * Source lot snapshot used for FIFO preview + validation.
 */
export interface SellSourceLot {
  id: string
  productId: string
  remainingWeight: number
  costPerKg: number
  dateAdded: Date
  createdAt: Date
}

/**
 * Transaction handle for sell-bill creation.
 */
export interface SellBillTx<TBill extends SellBillCreatedBill = SellBillCreatedBill> {
  createSellBill(args: SellBillCreateArgs): Promise<TBill>
  /** Find source lots for FIFO deduction, ordered by FIFO_ORDER_BY. */
  findSourceLots(productId: string): Promise<SellSourceLot[]>
  /** Deduct from a single lot. ST-57: CAS expected values are MANDATORY. */
  updateStockLotRemaining(
    id: string,
    newRemaining: number,
    expected: { productId: string; remainingWeight: number; costPerKg: number }
  ): Promise<unknown>
  createCreditEntry?(data: {
    type: string
    amount: number
    paidAmount: number
    customerId: string | null
    referenceType: string
    referenceId: string
    description: string
    date: Date
    isSettled: boolean
  }): Promise<unknown>
  createAuditLog(data: {
    action: string
    entityType: string
    entityId: string
    userId?: string | null
    userName?: string | null
    details?: string | null
  }): Promise<unknown>
  createStockMovements?(data: StockMovementDraft[]): Promise<unknown>
}

export interface SellBillServiceDeps<TBill extends SellBillCreatedBill = SellBillCreatedBill> {
  /** Pre-check stock availability (sum of remainingWeight per product). */
  checkStockAvailability(items: SellBillItemInput[]): Promise<
    | { ok: true }
    | {
        ok: false
        productId: string
        productName?: string
        available: number
        requested: number
      }
  >
  /** Generate the next SELL- bill number. */
  generateBillNumber(): Promise<string>
  /** Run a callback inside an atomic Prisma $transaction. */
  transaction<T>(fn: (tx: SellBillTx<TBill>) => Promise<T>): Promise<T>
}

export interface SellBillServiceResult<TBill extends SellBillCreatedBill = SellBillCreatedBill> {
  bill: TBill
  billNumber: string
  totalAmount: number
  totalCost: number
}

/**
 * Create a SellBill - the SAME function the Production POST /api/sell-bills
 * route and the ST-8 import apply route use.
 *
 * Side effects (all inside ONE deps.transaction - ST-11 atomic):
 *   - SellBill + SellBillItem rows
 *   - StockLot.remainingWeight deductions (FIFO)
 *   - CreditEntry (if isCredit)
 *   - AuditLog
 *
 * ST-20 zero-cost protection (Blocker 5):
 *   - For each item, previewFifoDeduction simulates the FIFO deduction
 *   - validateSourceLotCosts rejects zero-cost source lots (TRANSFER policy)
 *   - If validation fails -> the entire bill is rejected (tx throws -> rollback)
 *
 * ST-39 deterministic FIFO ordering (Blocker 4):
 *   - Source lots are queried with FIFO_ORDER_BY (dateAdded ASC, createdAt
 *     ASC, id ASC) - imported from fifo-validation, NOT defined locally.
 *
 * Throws:
 *   - Error (validation message) on bad input / insufficient stock / zero-cost
 *   - DuplicateExistingError on Prisma P2002
 *   - Other errors bubble up
 */
export async function createSellBillService<TBill extends SellBillCreatedBill = SellBillCreatedBill>(
  deps: SellBillServiceDeps<TBill>,
  input: SellBillInput,
  auth: AuthPayload
): Promise<SellBillServiceResult<TBill>> {
  if (!input.items || input.items.length === 0) {
    throw new Error('Items are required')
  }
  for (const item of input.items) {
    const err = validateSellBillItemNumeric(item)
    if (err) throw new Error(err)
  }
  const dateErr = validateBillDate(input.date)
  if (dateErr) throw new Error(dateErr)

  const stockCheck = await deps.checkStockAvailability(input.items)
  if (stockCheck.ok === false) {
    throw new InsufficientStockError(
      stockCheck.productId,
      stockCheck.productName,
      stockCheck.available,
      stockCheck.requested,
    )
  }

  const billNumber = await deps.generateBillNumber()
  const date = new Date(input.date)
  const externalBillNumber = input.externalBillNumber
    ? (normalizeBillNumber(input.externalBillNumber) || null)
    : null

  try {
    const txResult = await deps.transaction(async (tx) => {
      let totalAmount = 0
      let totalCost = 0
      const sellItems: Array<{
        productId: string
        weight: number
        weightExpression: string | null
        pricePerKg: number
        totalAmount: number
        costPerKg: number
        totalCost: number
      }> = []

      for (const item of input.items) {
        const itemTotalAmount = round2(item.weight * item.pricePerKg)

        // ST-39: query source lots with canonical FIFO ordering.
        const sourceLotsRaw = await tx.findSourceLots(item.productId)

        // ST-20: preview FIFO deduction (pure) + validate source lot costs.
        // SellBill has no waste concept -> use TRANSFER policy (always block
        // zero-cost source lots).
        const sourceLotsForPreview: SourceLotForPreview[] = sourceLotsRaw.map(
          (l) => ({
            id: l.id,
            remainingWeight: l.remainingWeight,
            costPerKg: l.costPerKg,
            dateAdded: l.dateAdded,
            createdAt: l.createdAt,
          })
        )
        const preview = previewFifoDeduction(
          item.productId,
          item.weight,
          sourceLotsForPreview
        )
        if (preview.success === false) {
          if (preview.code === 'INSUFFICIENT_STOCK') {
            throw new InsufficientStockError(
              preview.sourceProductId,
              undefined,
              preview.totalAvailable || 0,
              preview.sourceWeight,
            )
          }
          throw new FifoValidationError()
        }
        const costValidation = validateSourceLotCosts(preview, {
          type: 'TRANSFER',
          hasNonWasteOutput: true,
        })
        if (costValidation.valid === false) {
          throw new FifoValidationError()
        }

        // Actual FIFO deduction - same lot order as the preview (deterministic).
        let remainingToDeduct = item.weight
        let itemCost = 0
        for (const lot of sourceLotsRaw) {
          if (remainingToDeduct <= 0) break
          if (lot.remainingWeight <= 0) continue
          const deductFromLot = Math.min(lot.remainingWeight, remainingToDeduct)
          itemCost += deductFromLot * lot.costPerKg
          remainingToDeduct -= deductFromLot
          await tx.updateStockLotRemaining(
            lot.id,
            lot.remainingWeight - deductFromLot,
            { productId: lot.productId, remainingWeight: lot.remainingWeight, costPerKg: lot.costPerKg }
          )
        }

        const costPerKg = item.weight > 0 ? itemCost / item.weight : 0
        const itemCostRounded = round2(itemCost)
        const costPerKgRounded = round2(costPerKg)

        totalAmount += itemTotalAmount
        totalCost += itemCostRounded

        sellItems.push({
          productId: item.productId,
          weight: item.weight,
          weightExpression: isRealFormula(item.weightExpression)
            ? item.weightExpression!.trim()
            : null,
          pricePerKg: item.pricePerKg,
          totalAmount: itemTotalAmount,
          costPerKg: costPerKgRounded,
          totalCost: itemCostRounded,
        })
      }

      totalAmount = round2(totalAmount)
      totalCost = round2(totalCost)

      const sellBill = await tx.createSellBill({
        data: {
          billNumber,
          date,
          customerId: input.customerId || null,
          isCredit: input.isCredit,
          note: input.note || null,
          externalBillNumber,
          totalAmount,
          totalCost,
          items: { create: sellItems },
        },
      })

      await tx.createStockMovements?.(buildSaleMovements({
        id: sellBill.id,
        billNumber,
        date,
        items: sellBill.items.map((item, index) => ({
          id: item.id || `item-${index}`,
          productId: item.productId,
          weight: item.weight,
        })),
      }))

      if (input.isCredit) {
        await tx.createCreditEntry?.({
          type: 'RECEIVABLE',
          amount: totalAmount,
          paidAmount: 0,
          customerId: input.customerId || null,
          referenceType: 'SELL_BILL',
          referenceId: sellBill.id,
          description: `ใบขาย ${billNumber}`,
          date,
          isSettled: false,
        })
      }

      await tx.createAuditLog({
        action: 'CREATE',
        entityType: 'SELL_BILL',
        entityId: sellBill.id,
        userId: auth.userId,
        userName: auth.name,
        details: JSON.stringify({
          billNumber,
          externalBillNumber,
          totalAmount,
          totalCost,
          itemCount: sellBill.items.length,
          isCredit: input.isCredit,
          customerId: input.customerId || null,
        }),
      })

      return { sellBill, totalAmount, totalCost }
    })

    return {
      bill: txResult.sellBill,
      billNumber,
      totalAmount: txResult.totalAmount,
      totalCost: txResult.totalCost,
    }
  } catch (err) {
    if (isP2002OnField(err, 'externalBillNumber')) {
      throw new DuplicateExistingError('externalBillNumber')
    }
    throw err
  }
}

// ============================================================================
// Re-export FIFO_ORDER_BY so callers needing the canonical ordering (e.g.
// the import apply route's deps.findSourceLots) can import it transitively
// from this module. The source of truth remains fifo-validation.ts.
// ============================================================================

export { FIFO_ORDER_BY } from './fifo-validation'
export { normalizeBillNumber } from './bill-identity'
export { DuplicateExistingError, isPrismaP2002 } from './bill-errors'
