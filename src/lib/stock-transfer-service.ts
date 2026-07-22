/**
 * ST-41: Production StockTransfer creation service with injectable dependencies.
 *
 * The POST /api/stock-transfers route calls this service. Tests call it with
 * mock dependencies to execute the REAL production code path — not copied logic.
 *
 * The service handles:
 *   - business-date validation (DATE_REQUIRED, DATE_INVALID, DATE_FUTURE)
 *   - field validation (sourceProductId, sourceWeight, items, per-item)
 *   - output product existence verification
 *   - positive-yield + gainReason (ST-40)
 *   - source product + lots loading
 *   - FIFO preview + cost validation (ST-20)
 *   - source-lot causality check (ST-41)
 *   - billNumber generation
 *   - FIFO deduction + mismatch check (ST-39)
 *   - cost allocation (ST-40)
 *   - StockTransfer create data construction
 *   - output StockLot create data construction
 *   - AuditLog details construction (with businessDate fields)
 *   - Prisma error mapping (P2002/P2003/P2025, pgbouncer, FIFO)
 *   - ST-11 compensation on failure (including ROLLED_BACK AuditLog)
 *
 * The route wraps this service with Prisma-backed deps. Tests inject mock deps
 * that record calls + payloads, proving the production path without DB writes.
 */

import {
  previewFifoDeduction,
  validateSourceLotCosts,
  verifyFifoMatch,
  buildFifoAuditDetails,
  type SourceLotForPreview,
  type FifoPreviewResult,
} from './fifo-validation';
import {
  calculateGainLoss,
  allocateOutputCosts,
  isPositiveYieldAllowed,
  YIELD_WEIGHT_TOLERANCE,
} from './transfer-cost-allocation';
import {
  isValidDateString,
  isFutureThailandDate,
  parseThailandBusinessDate,
  formatThailandBusinessDate,
  checkSourceLotCausality,
} from './thailand-date';
import { buildTransferMovements, type StockMovementDraft } from './stock-movement-ledger';
import { isRealFormula } from './safe-math';

// ============ Types ============

export interface StockTransferInput {
  date: string; // YYYY-MM-DD
  sourceProductId: string;
  sourceWeight: number;
  sourceWeightExpression?: string;
  roomNumber?: string;
  sourcePricePerKg?: number;
  laborCost?: number;
  weighedTotal?: number;
  weighedTotalExpression?: string;
  note?: string;
  gainReason?: string;
  businessType?: string;
  items: Array<{
    productId: string;
    weight: number;
    weightExpression?: string;
    isWaste: boolean;
    outputPricePerKg?: number;
  }>;
}

export interface AuthInfo {
  userId: string;
  name: string;
  username: string;
}

export interface SourceProductRow {
  id: string;
  name: string;
}

export interface SourceLotRow {
  id: string;
  remainingWeight: number;
  costPerKg: number;
  dateAdded: Date;
  createdAt: Date;
}

export interface DeductResult {
  costPerKg: number;
  totalCost: number;
  deductedLots: Array<{ id: string; deducted: number }>;
}

export interface CreatedTransfer {
  id: string;
  items: Array<{ id: string; productId: string }>;
}

export interface AuditLogInput {
  action: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  details: string;
}

/** Injectable dependencies — production wraps Prisma; tests inject mocks. */
export interface StockTransferDeps {
  /** True only for a client already scoped to the active database transaction. */
  isTransactionScoped?: boolean;
  transaction<T>(fn: (tx: StockTransferDeps) => Promise<T>): Promise<T>;
  findSourceProduct(productId: string): Promise<SourceProductRow | null>;
  findOutputProduct(productId: string): Promise<SourceProductRow | null>;
  findSourceLots(productId: string): Promise<SourceLotRow[]>;
  generateBillNumber(): Promise<string>;
  deductSourceLots(productId: string, weightToDeduct: number): Promise<DeductResult>;
  createStockTransfer(data: Record<string, unknown>): Promise<CreatedTransfer>;
  createOutputStockLot(data: Record<string, unknown>): Promise<void>;
  createStockMovements(data: StockMovementDraft[]): Promise<void>;
  createAuditLog(data: AuditLogInput): Promise<void>;
  compensate(deductedLots: Array<{ id: string; deducted: number }>, requestId: string, reason?: string): Promise<void>;
  deletePartialTransfer(transferId: string): Promise<void>;
  deletePartialOutputLots(transferId: string): Promise<void>;
}

// ============ Date validation ============

export type DateValidationResult =
  | { ok: true; businessDate: string; storedBusinessDate: Date }
  | { ok: false; code: 'DATE_REQUIRED' | 'DATE_INVALID' | 'DATE_FUTURE'; error: string };

/**
 * ST-41: Validate the business date for a StockTransfer.
 * Pure function — no DB, no side effects. Called by the service + tests.
 */
export function validateStockTransferBusinessDate(date: unknown): DateValidationResult {
  if (!date || typeof date !== 'string' || !date.trim()) {
    return { ok: false, code: 'DATE_REQUIRED', error: 'กรุณาระบุวันที่แกะของ' };
  }
  if (!isValidDateString(date)) {
    return { ok: false, code: 'DATE_INVALID', error: 'รูปแบบวันที่ไม่ถูกต้อง' };
  }
  if (isFutureThailandDate(date)) {
    return { ok: false, code: 'DATE_FUTURE', error: 'ไม่สามารถบันทึกวันที่ในอนาคตได้' };
  }
  return { ok: true, businessDate: date, storedBusinessDate: parseThailandBusinessDate(date) };
}

// ============ AuditLog details builder ============

export interface AuditDetailsParams {
  billNumber: string;
  sourceProductName: string;
  sourceCostPerKg: number;
  sourceTotalCost: number;
  lossWeight: number;
  lossCost: number;
  gainWeight: number;
  weightVariance: number;
  gainReason: string | null;
  allocatedOutputTotalCost: number;
  costConserved: boolean;
  itemCount: number;
  nonWasteItemCount: number;
  fifoAuditDetails: Record<string, unknown>;
  outputItems: Array<Record<string, unknown>>;
  businessDate: string;
  storedBusinessDateUtc: string;
  requestId: string;
  actorUserId: string;
  actorUserName: string;
}

/**
 * ST-41: Build the AuditLog details JSON object.
 * Pure function — called by the service + tests. Proves the exact payload.
 */
export function buildTransferAuditDetails(params: AuditDetailsParams): Record<string, unknown> {
  return {
    billNumber: params.billNumber,
    sourceProductName: params.sourceProductName,
    sourceCostPerKg: params.sourceCostPerKg,
    sourceTotalCost: params.sourceTotalCost,
    businessDate: params.businessDate,
    storedBusinessDateUtc: params.storedBusinessDateUtc,
    requestId: params.requestId,
    actorUserId: params.actorUserId,
    actorUserName: params.actorUserName,
    lossWeight: params.lossWeight,
    lossCost: params.lossCost,
    gainWeight: params.gainWeight,
    weightVariance: params.weightVariance,
    gainReason: params.gainReason,
    allocatedOutputTotalCost: params.allocatedOutputTotalCost,
    costConserved: params.costConserved,
    itemCount: params.itemCount,
    nonWasteItemCount: params.nonWasteItemCount,
    ...(params.fifoAuditDetails as Record<string, unknown>),
    outputItems: params.outputItems,
  };
}

// ============ Create-data builders ============

/**
 * Build the StockTransfer.create data payload.
 * Pure function — tests verify the exact payload the route sends to Prisma.
 */
export function buildStockTransferCreateData(
  input: StockTransferInput,
  deps_result: {
    billNumber: string;
    sourceCostPerKg: number;
    sourceTotalCost: number;
    lossWeight: number;
    lossCost: number;
    gainWeight: number;
    weightVariance: number;
    gainReason: string | null;
    outputTotalValue: number;
    profitLoss: number;
    allocatedItems: Array<{ costPerKg: number; totalCost: number }>;
    storedBusinessDate: Date;
  }
): Record<string, unknown> {
  return {
    billNumber: deps_result.billNumber,
    date: deps_result.storedBusinessDate,
    roomNumber: input.roomNumber?.trim() || null,
    businessType: input.businessType?.trim() || null,
    sourceProductId: input.sourceProductId,
    sourceWeight: input.sourceWeight,
    sourceWeightExpression: isRealFormula(input.sourceWeightExpression) ? input.sourceWeightExpression!.trim() : null,
    sourceCostPerKg: deps_result.sourceCostPerKg,
    sourceTotalCost: deps_result.sourceTotalCost,
    sourcePricePerKg: input.sourcePricePerKg || 0,
    laborCost: input.laborCost || 0,
    outputTotalValue: deps_result.outputTotalValue,
    profitLoss: deps_result.profitLoss,
    weighedTotal: input.weighedTotal || 0,
    weighedTotalExpression: isRealFormula(input.weighedTotalExpression) ? input.weighedTotalExpression!.trim() : null,
    lossWeight: deps_result.lossWeight,
    lossCost: deps_result.lossCost,
    gainWeight: deps_result.gainWeight,
    weightVariance: deps_result.weightVariance,
    gainReason: deps_result.gainReason,
    note: input.note || null,
    // NOTE: createdAt is intentionally NOT set — Prisma @default(now()) generates it
    items: {
      create: input.items.map((item, idx) => ({
        productId: item.productId,
        weight: item.weight,
        weightExpression: isRealFormula(item.weightExpression) ? item.weightExpression!.trim() : null,
        isWaste: item.isWaste,
        costPerKg: deps_result.allocatedItems[idx].costPerKg,
        totalCost: deps_result.allocatedItems[idx].totalCost,
        outputPricePerKg: item.isWaste ? 0 : (item.outputPricePerKg || 0),
      })),
    },
  };
}

/**
 * Build a single output StockLot.create data payload.
 * Pure function — tests verify the exact payload.
 */
export function buildOutputStockLotData(
  item: StockTransferInput['items'][0],
  costPerKg: number,
  storedBusinessDate: Date,
  transferId: string
): Record<string, unknown> | null {
  if (item.isWaste || item.weight <= 0) return null;
  return {
    productId: item.productId,
    remainingWeight: item.weight,
    costPerKg: costPerKg,
    dateAdded: storedBusinessDate,
    source: 'TRANSFER',
    sourceId: transferId,
    // NOTE: createdAt is intentionally NOT set — Prisma @default(now()) generates it
  };
}

// ============ Result types ============

export type ServiceResult =
  | { ok: true; status: 201; transfer: CreatedTransfer; auditDetails: Record<string, unknown> }
  | {
      ok: false;
      status: 400 | 404 | 409 | 500 | 503;
      error: string;
      code?: string;
      requestId: string;
      /** Extra fields to include in the JSON response body (e.g. details, sourceProductId). */
      extras?: Record<string, unknown>;
    };

// ============ Error classification ============

interface ClassifiedError {
  status: 400 | 404 | 409 | 500 | 503;
  code?: string;
  error: string;
  /** Extra fields for the JSON body (always includes `details` when set). */
  extras?: Record<string, unknown>;
}

/**
 * ST-41: Map a thrown error to a ServiceResult-failure shape.
 *
 * Mirrors the route's catch-block error handling:
 *   - P2002 (unique constraint, e.g. billNumber collision) → 409 BILL_NUMBER_COLLISION
 *   - P2003 (FK constraint) → 400 FK_CONSTRAINT
 *   - P2025 (record not found) → 404 NOT_FOUND
 *   - "Insufficient stock" (FIFO deduction guard) → 400
 *   - "NEGATIVE_COST_SOURCE_LOT"/"ZERO_COST_SOURCE_LOT"/"ZERO_SOURCE_COST" → 400 FIFO_VALIDATION_ERROR
 *   - pgbouncer timeout patterns → 503
 *   - default → 500 with original message as `details`
 *
 * Pure function — no DB, no side effects.
 */
export function classifyServiceError(err: unknown): ClassifiedError {
  const message = err instanceof Error ? err.message : 'Failed to create stock transfer';
  const code = (err as { code?: string } | null | undefined)?.code;

  // Prisma known errors
  if (code === 'P2002') {
    return {
      status: 409,
      code: 'BILL_NUMBER_COLLISION',
      error: 'เลขบิลซ้ำ กรุณาลองอีกครั้ง',
      extras: { details: message },
    };
  }
  if (code === 'P2003') {
    return {
      status: 400,
      code: 'FK_CONSTRAINT',
      error: 'สินค้าที่อ้างถึงไม่มีอยู่ในระบบ (FK constraint)',
      extras: { details: message },
    };
  }
  if (code === 'P2025') {
    return {
      status: 404,
      code: 'NOT_FOUND',
      error: 'ไม่พบข้อมูลที่ต้องการอัปเดต',
      extras: { details: message },
    };
  }
  // ST-61: Prisma P2028 — transaction timeout (interactive transaction exceeded its timeout)
  // Map to 503 with a safe Thai message. Do NOT expose raw Prisma message to client.
  // Message aligned with ST-54's TransactionTimeoutError for consistency.
  if (code === 'P2028') {
    return {
      status: 503,
      code: 'TRANSACTION_TIMEOUT',
      error: 'การบันทึกใช้เวลานานเกินไป ระบบได้ยกเลิกรายการทั้งหมดแล้ว กรุณารอสักครู่และลองใหม่ หากยังเกิดซ้ำให้แจ้งผู้ดูแล',
    };
  }

  // FIFO deduction guard — Insufficient stock
  if (message.includes('Insufficient stock')) {
    return { status: 400, error: message };
  }

  // ST-20: FIFO validation error codes
  if (
    message.includes('NEGATIVE_COST_SOURCE_LOT') ||
    message.includes('ZERO_COST_SOURCE_LOT') ||
    message.includes('ZERO_SOURCE_COST')
  ) {
    return { status: 400, code: 'FIFO_VALIDATION_ERROR', error: message };
  }

  // pgbouncer transaction errors
  if (message.includes('Transaction not found') || message.includes('drained')) {
    return {
      status: 503,
      code: 'PGBOUNCER_TIMEOUT',
      error: 'การเชื่อมต่อฐานข้อมูลหมดเวลา กรุณาลองอีกครั้ง (pgbouncer timeout)',
      extras: { details: message },
    };
  }

  // Default — preserve the route's 500 body shape: { error, details, requestId }
  return {
    status: 500,
    error: 'บันทึกใบย้ายสต็อกไม่สำเร็จ',
    extras: { details: message },
  };
}

// ============ Controller (production path) ============

/**
 * ST-41: Execute the StockTransfer creation flow.
 *
 * This is the PRODUCTION controller called by the POST route.
 * Tests call this with mock deps to execute the real code path.
 *
 * Flow:
 *   1. validate business date → DATE_REQUIRED/INVALID/FUTURE
 *   2. validate fields (sourceProductId, sourceWeight, items, per-item)
 *   3. positive-yield + gainReason check (ST-40)
 *   4. load source product
 *   5. verify output products exist
 *   6. load source lots + availability check
 *   7. FIFO preview (ST-39 deterministic, ST-20 zero-cost)
 *   8. source-lot causality check (ST-41)
 *   9. execute: deduct → create transfer → create output lots → audit log
 *  10. on failure after deduction: compensate (ST-11) + ROLLED_BACK AuditLog
 */
export async function createStockTransfer(
  deps: StockTransferDeps,
  input: StockTransferInput,
  auth: AuthInfo,
  requestId: string
): Promise<ServiceResult> {
  // 1. Date validation
  const dateValidation = validateStockTransferBusinessDate(input.date);
  if (!dateValidation.ok) {
    return { ok: false, status: 400, error: dateValidation.error, code: dateValidation.code, requestId };
  }

  // 2. Field validation
  if (!input.sourceProductId || typeof input.sourceProductId !== 'string' || !input.sourceProductId.trim()) {
    return { ok: false, status: 400, error: 'กรุณาเลือกสินค้าต้นทาง', requestId };
  }
  if (typeof input.sourceWeight !== 'number' || isNaN(input.sourceWeight) || input.sourceWeight <= 0) {
    return { ok: false, status: 400, error: 'น้ำหนักต้นทางต้องมากกว่า 0', requestId };
  }
  if (!input.items || !Array.isArray(input.items) || input.items.length === 0) {
    return { ok: false, status: 400, error: 'กรุณาเพิ่มรายการ output อย่างน้อย 1 รายการ', requestId };
  }

  // 2b. Per-item validation (productId, weight, price, isWaste default)
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const rowNum = i + 1;
    if (!item.productId || typeof item.productId !== 'string' || !item.productId.trim()) {
      return { ok: false, status: 400, error: `รายการ output ลำดับที่ ${rowNum} ไม่มีสินค้า กรุณาเลือกสินค้า`, requestId };
    }
    if (typeof item.weight !== 'number' || isNaN(item.weight) || item.weight <= 0) {
      return { ok: false, status: 400, error: `น้ำหนัก output ลำดับที่ ${rowNum} ต้องมากกว่า 0`, requestId };
    }
    if (item.outputPricePerKg !== undefined && item.outputPricePerKg !== null) {
      if (typeof item.outputPricePerKg !== 'number' || isNaN(item.outputPricePerKg) || item.outputPricePerKg < 0) {
        return { ok: false, status: 400, error: `ราคาปลายทางลำดับที่ ${rowNum} ต้องไม่ติดลบ`, requestId };
      }
    }
    if (typeof item.isWaste !== 'boolean') {
      item.isWaste = false; // default to false if not provided
    }
  }

  // 3. Positive-yield + gainReason (ST-40)
  const itemsTotalWeight = input.items.reduce((s, i) => s + i.weight, 0);
  const effectiveBusinessType = input.businessType?.trim() || null;
  const yieldResult = calculateGainLoss(input.sourceWeight, itemsTotalWeight);

  if (yieldResult.gainWeight > YIELD_WEIGHT_TOLERANCE) {
    if (!isPositiveYieldAllowed(effectiveBusinessType)) {
      return {
        ok: false,
        status: 400,
        error: `น้ำหนัก output รวม (${itemsTotalWeight.toFixed(2)} กก.) เกินน้ำหนักต้นทาง (${input.sourceWeight} กก.) — ไม่อนุญาตสำหรับ businessType คัดแยก`,
        code: 'POSITIVE_YIELD_NOT_ALLOWED',
        requestId,
      };
    }
    const gainReasonTrimmed = (input.gainReason || '').trim();
    if (!gainReasonTrimmed) {
      return {
        ok: false,
        status: 400,
        error: `น้ำหนัก output มากกว่าต้นทาง ${yieldResult.gainWeight.toFixed(2)} กก. กรุณาระบุเหตุผล เช่น หักน้ำหนักประเมินตอนซื้อ`,
        code: 'GAIN_REASON_REQUIRED',
        extras: { gainWeight: yieldResult.gainWeight },
        requestId,
      };
    }
  }

  // 4. Load source product
  const sourceProduct = await deps.findSourceProduct(input.sourceProductId);
  if (!sourceProduct) {
    return { ok: false, status: 400, error: `ไม่พบสินค้าต้นทาง (ID: ${input.sourceProductId})`, requestId };
  }

  // 5. Verify all output products exist
  for (let i = 0; i < input.items.length; i++) {
    const item = input.items[i];
    const rowNum = i + 1;
    const outputProduct = await deps.findOutputProduct(item.productId);
    if (!outputProduct) {
      return { ok: false, status: 400, error: `ไม่พบสินค้า output ลำดับที่ ${rowNum} (ID: ${item.productId})`, requestId };
    }
  }

  // 6. Load source lots + availability check
  const sourceLots = await deps.findSourceLots(input.sourceProductId);
  const totalAvailable = sourceLots.reduce((sum, l) => sum + l.remainingWeight, 0);
  if (totalAvailable < input.sourceWeight) {
    return {
      ok: false,
      status: 400,
      error: `สต็อกไม่เพียงพอสำหรับ "${sourceProduct.name}". มี: ${totalAvailable} กก., ต้องการ: ${input.sourceWeight} กก.`,
      requestId,
    };
  }

  // 7. FIFO preview (ST-39 deterministic, ST-20 zero-cost)
  const fifoPreview = previewFifoDeduction(
    input.sourceProductId,
    input.sourceWeight,
    sourceLots.map((l) => ({ id: l.id, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg, dateAdded: l.dateAdded, createdAt: l.createdAt }))
  );
  if (!fifoPreview.success) {
    return {
      ok: false,
      status: 400,
      error: fifoPreview.message,
      code: fifoPreview.code,
      extras: {
        sourceProductId: input.sourceProductId,
        sourceProductName: sourceProduct.name,
        sourceWeight: input.sourceWeight,
        totalAvailable: fifoPreview.totalAvailable,
        affectedSourceLotIds: fifoPreview.affectedSourceLotIds,
      },
      requestId,
    };
  }

  const costValidation = validateSourceLotCosts(fifoPreview, { type: 'TRANSFER', hasNonWasteOutput: true });
  if (!costValidation.valid) {
    return {
      ok: false,
      status: 400,
      error: costValidation.message,
      code: costValidation.code,
      extras: {
        sourceProductId: input.sourceProductId,
        sourceProductName: sourceProduct.name,
        sourceWeight: input.sourceWeight,
        affectedSourceLotIds: costValidation.affectedSourceLotIds,
        weightedAverageCost: costValidation.weightedAverageCost,
      },
      requestId,
    };
  }

  // 8. Source-lot causality check (ST-41) — BEFORE any deduction
  const consumedLotIds = fifoPreview.deductedLots.map((l) => l.lotId);
  const consumedLotDates = sourceLots.filter((l) => consumedLotIds.includes(l.id)).map((l) => l.dateAdded);
  const causality = checkSourceLotCausality(dateValidation.businessDate, consumedLotDates);
  if (causality.violated) {
    return {
      ok: false,
      status: 400,
      error: `วันที่แกะของต้องไม่เร็วกว่าวันที่รับสินค้าต้นทางที่ถูกนำมาใช้ (ต้นทางล่าสุด: ${causality.latestSourceDateStr})`,
      code: 'BUSINESS_DATE_BEFORE_SOURCE',
      extras: {
        businessDate: dateValidation.businessDate,
        latestSourceDate: causality.latestSourceDateStr,
      },
      requestId,
    };
  }

  // 9. Re-enter the mutation phase with a transaction-scoped dependency set.
  // A failure result is converted to a throw inside the callback so Prisma
  // rolls back source deductions, document/output rows, and ledger rows.
  if (!deps.isTransactionScoped) {
    let failed: Exclude<ServiceResult, { ok: true }> | null = null;
    const rollback = Symbol('stock-transfer-rollback');
    try {
      return await deps.transaction(async tx => {
        const result = await createStockTransfer(tx, input, auth, requestId);
        if (!result.ok) {
          failed = result;
          throw rollback;
        }
        return result;
      });
    } catch (error) {
      if (error === rollback && failed) return failed;
      const classified = classifyServiceError(error);
      return { ok: false, status: classified.status, error: classified.error, code: classified.code, extras: classified.extras, requestId };
    }
  }

  // 10. Execute using the transaction-scoped dependency set.
  const billNumber = await deps.generateBillNumber();
  let fifoResult: DeductResult;
  try {
    fifoResult = await deps.deductSourceLots(input.sourceProductId, input.sourceWeight);
  } catch (err) {
    const partialDeductedLots = (err as { deductedLots?: Array<{ id: string; deducted: number }> })?.deductedLots || [];
    if (partialDeductedLots.length > 0) {
      await deps.compensate(partialDeductedLots, requestId, err instanceof Error ? err.message : 'deduction error');
      await writeRollbackAuditLog(deps, auth, requestId, billNumber, null, partialDeductedLots, err);
    }
    const classified = classifyServiceError(err);
    return { ok: false, status: classified.status, error: classified.error, code: classified.code, extras: classified.extras, requestId };
  }

  // 10. FIFO mismatch check (ST-39)
  // NOTE: the route handles FIFO mismatch inline (compensate + 409) WITHOUT writing
  // a ROLLED_BACK AuditLog — the catch-block audit only fires for thrown errors.
  if (!verifyFifoMatch(fifoPreview, { ...fifoResult, deductedLots: fifoResult.deductedLots })) {
    await deps.compensate(fifoResult.deductedLots, `${requestId}-fifo-mismatch`, 'FIFO preview/execution mismatch');
    return {
      ok: false,
      status: 409,
      error: 'ตรวจพบความไม่ตรงของต้นทุน FIFO ระหว่าง preview และ execution กรุณาลองอีกครั้ง',
      code: 'FIFO_MISMATCH',
      extras: {
        sourceProductId: input.sourceProductId,
        sourceWeight: input.sourceWeight,
        previewCost: fifoPreview.weightedAverageCost,
        actualCost: fifoResult.costPerKg,
      },
      requestId,
    };
  }

  // 11. Calculate cost allocation (ST-40)
  const sourceCostPerKg = fifoResult.costPerKg;
  const sourceTotalCost = fifoResult.totalCost;
  const lossWeight = yieldResult.lossWeight;
  const lossCost = Math.round(lossWeight * sourceCostPerKg * 100) / 100;
  const gainWeight = yieldResult.gainWeight;
  const weightVariance = yieldResult.weightVariance;
  const gainReasonValue = gainWeight > YIELD_WEIGHT_TOLERANCE ? (input.gainReason || '').trim() : null;

  const costAllocation = allocateOutputCosts(sourceTotalCost, input.items);
  const allocatedItems = costAllocation.items;

  const srcPricePerKg = input.sourcePricePerKg || 0;
  const labor = input.laborCost || 0;
  const outputTotalValue = Math.round(input.items.reduce((s, i) => s + (i.isWaste ? 0 : i.weight * (i.outputPricePerKg || 0)), 0) * 100) / 100;
  const sourceAnalysisCost = Math.round(input.sourceWeight * srcPricePerKg * 100) / 100;
  const profitLoss = Math.round((outputTotalValue - sourceAnalysisCost - labor) * 100) / 100;

  // 12. Create StockTransfer
  let created: CreatedTransfer;
  try {
    const createData = buildStockTransferCreateData(input, {
      billNumber,
      sourceCostPerKg,
      sourceTotalCost,
      lossWeight,
      lossCost,
      gainWeight,
      weightVariance,
      gainReason: gainReasonValue,
      outputTotalValue,
      profitLoss,
      allocatedItems,
      storedBusinessDate: dateValidation.storedBusinessDate,
    });
    created = await deps.createStockTransfer(createData);
  } catch (err) {
    // Compensate: restore deducted lots + ROLLED_BACK audit
    await deps.compensate(fifoResult.deductedLots, requestId, err instanceof Error ? err.message : 'create error');
    await writeRollbackAuditLog(deps, auth, requestId, billNumber, null, fifoResult.deductedLots, err);
    const classified = classifyServiceError(err);
    return { ok: false, status: classified.status, error: classified.error, code: classified.code, extras: classified.extras, requestId };
  }

  // 13. Create output StockLots
  try {
    for (let idx = 0; idx < input.items.length; idx++) {
      const lotData = buildOutputStockLotData(input.items[idx], allocatedItems[idx].costPerKg, dateValidation.storedBusinessDate, created.id);
      if (lotData) {
        await deps.createOutputStockLot(lotData);
      }
    }
  } catch (err) {
    // Compensate: delete output lots + transfer + restore source + ROLLED_BACK audit
    await deps.deletePartialOutputLots(created.id);
    await deps.deletePartialTransfer(created.id);
    await deps.compensate(fifoResult.deductedLots, requestId, err instanceof Error ? err.message : 'lot create error');
    await writeRollbackAuditLog(deps, auth, requestId, billNumber, created.id, fifoResult.deductedLots, err);
    const classified = classifyServiceError(err);
    return { ok: false, status: classified.status, error: classified.error, code: classified.code, extras: classified.extras, requestId };
  }

  // 14. Emit the source/output ledger rows as one idempotent createMany call.
  // Failure uses the existing ST-11 compensation and partial cleanup path.
  try {
    await deps.createStockMovements(buildTransferMovements({
      id: created.id,
      billNumber,
      date: dateValidation.storedBusinessDate,
      sourceProductId: input.sourceProductId,
      sourceWeight: input.sourceWeight,
      gainWeight,
      lossWeight,
      businessType: input.businessType,
      items: input.items.map((item, index) => ({
        id: created.items[index]?.id || `item-${index}`,
        productId: item.productId,
        weight: item.weight,
        isWaste: item.isWaste,
      })),
    }));
  } catch (err) {
    await deps.deletePartialOutputLots(created.id);
    await deps.deletePartialTransfer(created.id);
    await deps.compensate(fifoResult.deductedLots, requestId, err instanceof Error ? err.message : 'ledger create error');
    await writeRollbackAuditLog(deps, auth, requestId, billNumber, created.id, fifoResult.deductedLots, err);
    const classified = classifyServiceError(err);
    return { ok: false, status: classified.status, error: classified.error, code: classified.code, extras: classified.extras, requestId };
  }

  // 15. Create AuditLog
  const fifoAuditDetails = buildFifoAuditDetails(fifoPreview, { type: 'TRANSFER', hasNonWasteOutput: true });
  const auditDetails = buildTransferAuditDetails({
    billNumber,
    sourceProductName: sourceProduct.name,
    sourceCostPerKg,
    sourceTotalCost,
    lossWeight,
    lossCost,
    gainWeight,
    weightVariance,
    gainReason: gainReasonValue,
    allocatedOutputTotalCost: costAllocation.allocatedTotalCost,
    costConserved: costAllocation.allocatedTotalCost === sourceTotalCost,
    itemCount: created.items.length,
    nonWasteItemCount: input.items.filter((i) => !i.isWaste).length,
    fifoAuditDetails: fifoAuditDetails as unknown as Record<string, unknown>,
    outputItems: input.items.map((item) => ({
      productId: item.productId,
      weight: item.weight,
      isWaste: item.isWaste,
      assignedCostPerKg: item.isWaste ? 0 : sourceCostPerKg,
    })),
    businessDate: dateValidation.businessDate,
    storedBusinessDateUtc: dateValidation.storedBusinessDate.toISOString(),
    requestId,
    actorUserId: auth.userId,
    actorUserName: auth.name,
  });

  try {
    await deps.createAuditLog({
      action: 'CREATE',
      entityType: 'STOCK_TRANSFER',
      entityId: created.id,
      userId: auth.userId,
      userName: auth.name,
      details: JSON.stringify(auditDetails),
    });
  } catch {
    // AuditLog failure is non-fatal — the transfer was already created
  }

  return { ok: true, status: 201, transfer: created, auditDetails };
}

/**
 * ST-11: Best-effort ROLLED_BACK AuditLog when compensation is invoked.
 *
 * Mirrors the route's catch-block audit write. Non-fatal — failures are
 * swallowed (the error response must still be returned to the client).
 */
async function writeRollbackAuditLog(
  deps: StockTransferDeps,
  auth: AuthInfo,
  requestId: string,
  billNumber: string,
  createdTransferId: string | null,
  deductedLots: Array<{ id: string; deducted: number }>,
  err: unknown
): Promise<void> {
  const message = err instanceof Error ? err.message : 'Failed to create stock transfer';
  try {
    await deps.createAuditLog({
      action: 'CREATE',
      entityType: 'STOCK_TRANSFER',
      entityId: createdTransferId || 'FAILED',
      userId: auth.userId,
      userName: auth.name,
      details: JSON.stringify({
        status: 'ROLLED_BACK',
        error: message.substring(0, 500),
        billNumber,
        requestId,
        deductedLotCount: deductedLots.length,
        compensatedLotIds: deductedLots.map((l) => l.id),
      }),
    });
  } catch {
    // AuditLog failure must NOT prevent the error response from being returned.
  }
}
