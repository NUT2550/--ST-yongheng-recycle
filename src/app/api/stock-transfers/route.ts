import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';
import { isRealFormula } from '@/lib/safe-math';
import {
  previewFifoDeduction,
  validateSourceLotCosts,
  verifyFifoMatch,
  buildFifoAuditDetails,
  FIFO_ORDER_BY,
} from '@/lib/fifo-validation';
import {
  calculateGainLoss,
  allocateOutputCosts,
  isPositiveYieldAllowed,
  YIELD_WEIGHT_TOLERANCE,
} from '@/lib/transfer-cost-allocation';
import {
  isValidDateString,
  isFutureThailandDate,
  parseThailandBusinessDate,
  getThailandTodayDateString,
} from '@/lib/thailand-date';

// Task 69: Rebuild trigger — ensures Vercel regenerates Prisma client with businessType field.
// ST-11: deductStockFIFO now attaches partial deductedLots to the error if it throws mid-loop,
// so the caller can compensate (rollback) the already-deducted lots.
// Helper: Deduct stock using FIFO and return weighted average cost.
// Uses sequential db queries (NOT interactive transaction) for pgbouncer compatibility.
async function deductStockFIFO(
  productId: string,
  weightToDeduct: number
): Promise<{ costPerKg: number; totalCost: number; deductedLots: { id: string; deducted: number }[] }> {
  const lots = await db.stockLot.findMany({
    where: {
      productId,
      remainingWeight: { gt: 0 },
    },
    orderBy: FIFO_ORDER_BY,
  });

  const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeight, 0);
  if (totalAvailable < weightToDeduct) {
    throw new Error(
      `Insufficient stock for product ${productId}. Available: ${totalAvailable}, Requested: ${weightToDeduct}`
    );
  }

  let remaining = weightToDeduct;
  let totalCost = 0;
  const deductedLots: { id: string; deducted: number }[] = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const deductFromLot = Math.min(lot.remainingWeight, remaining);
    totalCost += deductFromLot * lot.costPerKg;
    remaining -= deductFromLot;
    // Update each lot sequentially (pgbouncer-safe)
    try {
      await db.stockLot.update({
        where: { id: lot.id },
        data: { remainingWeight: lot.remainingWeight - deductFromLot },
      });
    } catch (updateErr) {
      // ST-11: Attach the partial deductedLots so the caller can rollback.
      const err = new Error(
        `FIFO update failed for lot ${lot.id}: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`
      );
      (err as any).deductedLots = deductedLots;
      throw err;
    }
    deductedLots.push({ id: lot.id, deducted: deductFromLot });
  }

  const costPerKg = weightToDeduct > 0 ? totalCost / weightToDeduct : 0;
  return {
    costPerKg: Math.round(costPerKg * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    deductedLots,
  };
}

// ST-11/ST-14: Durable compensation using operation ledger.
// Creates a CompensationOperation with one CompensationItem per lot BEFORE restoring.
// Retry with same requestId resumes the existing operation, skipping COMPLETED items.
// Each item is marked COMPLETED only AFTER the StockLot.update succeeds.
// If the server crashes between items, retry will find PENDING items and resume.
async function compensateDeductedLots(
  deductedLots: { id: string; deducted: number }[],
  requestId: string,
  reason?: string
): Promise<void> {
  if (deductedLots.length === 0) return;

  // 1. Find or create the CompensationOperation for this requestId
  let operation = await db.compensationOperation.findUnique({
    where: { requestId },
    include: { items: true },
  });

  if (!operation) {
    // Read current lot weights for audit (beforeWeight)
    const lotIds = deductedLots.map(l => l.id);
    const lots = await db.stockLot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, remainingWeight: true },
    });
    const lotMap = new Map(lots.map(l => [l.id, l.remainingWeight]));

    // Create operation + items
    operation = await db.compensationOperation.create({
      data: {
        requestId,
        operationType: 'STOCK_TRANSFER_CREATE',
        status: 'IN_PROGRESS',
        error: reason ? reason.substring(0, 500) : null,
        items: {
          create: deductedLots.map(lot => ({
            lotId: lot.id,
            amount: lot.deducted,
            beforeWeight: lotMap.get(lot.id) ?? 0,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });
  } else {
    // Resume existing operation — update status to IN_PROGRESS if not already
    if (operation.status !== 'COMPLETED') {
      await db.compensationOperation.update({
        where: { id: operation.id },
        data: { status: 'IN_PROGRESS', error: reason ? reason.substring(0, 500) : operation.error },
      });
    }
  }

  // 2. Process each PENDING item
  const pendingItems = operation.items.filter(item => item.status === 'PENDING');
  for (const item of pendingItems) {
    try {
      // Restore the lot's remainingWeight
      const updatedLot = await db.stockLot.update({
        where: { id: item.lotId },
        data: { remainingWeight: { increment: item.amount } },
        select: { remainingWeight: true },
      });
      // Mark item as COMPLETED with afterWeight
      await db.compensationItem.update({
        where: { id: item.id },
        data: {
          status: 'COMPLETED',
          afterWeight: updatedLot.remainingWeight,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      // Mark item as FAILED with error
      console.error(`ST-14: Compensation failed for lot ${item.lotId}:`, err);
      await db.compensationItem.update({
        where: { id: item.id },
        data: {
          status: 'FAILED',
          error: err instanceof Error ? err.message.substring(0, 500) : String(err),
        },
      }).catch(() => { /* non-fatal */ });
    }
  }

  // 3. Check if all items are COMPLETED → mark operation as COMPLETED
  const refreshedOp = await db.compensationOperation.findUnique({
    where: { id: operation.id },
    include: { items: { select: { status: true } } },
  });
  if (refreshedOp) {
    const allCompleted = refreshedOp.items.every(i => i.status === 'COMPLETED');
    const anyFailed = refreshedOp.items.some(i => i.status === 'FAILED');
    if (allCompleted) {
      await db.compensationOperation.update({
        where: { id: operation.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } else if (anyFailed) {
      await db.compensationOperation.update({
        where: { id: operation.id },
        data: { status: 'FAILED' },
      });
    }
  }
}

// POST /api/stock-transfers - Create a stock transfer (แกะของ/ย้ายสต็อก)
export async function POST(request: NextRequest) {
  // ST-13: Read client request ID for traceability (or generate one if missing).
  const requestId = request.headers.get('x-request-id') || `srv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  // --- Auth: admin or transfer.create permission (staff allowed by default) ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401, headers: { 'X-Request-ID': requestId } });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401, headers: { 'X-Request-ID': requestId } });
  const hasPermission = payload.role === 'admin' || payload.permissions?.['transfer.create'] === true;
  if (!hasPermission) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403, headers: { 'X-Request-ID': requestId } });

  // ST-11: Track state for rollback compensation.
  // - deductedLots: lots that were FIFO-deducted (for restore on failure)
  // - createdTransferId: the bill ID if db.stockTransfer.create succeeded (for delete on failure)
  // ST-14: Idempotency is now DB-level via CompensationOperation + CompensationItem tables.
  //   No more in-memory Set — survives server crashes and request retries.
  let deductedLots: { id: string; deducted: number }[] = [];
  let createdTransferId: string | null = null;
  let billNumber = '';

  try {
    const body = await request.json();
    const {
      date,
      sourceProductId,
      sourceWeight,
      sourceWeightExpression,
      roomNumber,
      sourcePricePerKg,
      laborCost,
      weighedTotal,
      weighedTotalExpression,
      note,
      gainReason,
      items,
      businessType,
    } = body as {
      date: string;
      sourceProductId: string;
      sourceWeight: number;
      sourceWeightExpression?: string;
      roomNumber?: string;
      sourcePricePerKg?: number;
      laborCost?: number;
      weighedTotal?: number;
      weighedTotalExpression?: string;
      note?: string;
      gainReason?: string; // ST-40: required when gain > 0
      businessType?: string; // คัดแยก | แกะของ | undefined (default = แกะของ)
      items: Array<{
        productId: string;
        weight: number;
        weightExpression?: string;
        isWaste: boolean;
        outputPricePerKg?: number;
      }>;
    };

    // ========== VALIDATION (return 400 for all validation failures) ==========

    // ST-41: Validate business date (YYYY-MM-DD, real calendar date, not future)
    if (!date || typeof date !== 'string' || !date.trim()) {
      return NextResponse.json(
        { error: 'กรุณาระบุวันที่แกะของ', code: 'DATE_REQUIRED' },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }
    if (!isValidDateString(date)) {
      return NextResponse.json(
        { error: 'รูปแบบวันที่ไม่ถูกต้อง', code: 'DATE_INVALID' },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }
    if (isFutureThailandDate(date)) {
      return NextResponse.json(
        { error: 'ไม่สามารถบันทึกวันที่ในอนาคตได้', code: 'DATE_FUTURE' },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }

    // 1. sourceProductId required
    if (!sourceProductId || typeof sourceProductId !== 'string' || !sourceProductId.trim()) {
      return NextResponse.json({ error: 'กรุณาเลือกสินค้าต้นทาง' }, { status: 400 });
    }

    // 2. sourceWeight must be a positive number
    if (typeof sourceWeight !== 'number' || isNaN(sourceWeight) || sourceWeight <= 0) {
      return NextResponse.json({ error: 'น้ำหนักต้นทางต้องมากกว่า 0' }, { status: 400 });
    }

    // 3. items array required and non-empty
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'กรุณาเพิ่มรายการ output อย่างน้อย 1 รายการ' }, { status: 400 });
    }

    // 4. Validate each output item
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowNum = i + 1;

      // productId required (even for waste — schema requires FK)
      if (!item.productId || typeof item.productId !== 'string' || !item.productId.trim()) {
        return NextResponse.json(
          { error: `รายการ output ลำดับที่ ${rowNum} ไม่มีสินค้า กรุณาเลือกสินค้า` },
          { status: 400 }
        );
      }

      // weight must be a positive number
      if (typeof item.weight !== 'number' || isNaN(item.weight) || item.weight <= 0) {
        return NextResponse.json(
          { error: `น้ำหนัก output ลำดับที่ ${rowNum} ต้องมากกว่า 0` },
          { status: 400 }
        );
      }

      // price must be non-negative number (or undefined)
      if (item.outputPricePerKg !== undefined && item.outputPricePerKg !== null) {
        if (typeof item.outputPricePerKg !== 'number' || isNaN(item.outputPricePerKg) || item.outputPricePerKg < 0) {
          return NextResponse.json(
            { error: `ราคาปลายทางลำดับที่ ${rowNum} ต้องไม่ติดลบ` },
            { status: 400 }
          );
        }
      }

      // isWaste must be boolean
      if (typeof item.isWaste !== 'boolean') {
        item.isWaste = false; // default to false if not provided
      }
    }

    // ST-40: Positive yield (output > source) is allowed for แกะของ (dismantling).
    // คัดแยก retains the hard block (output must not exceed source).
    const itemsTotalWeight = items.reduce((s, i) => s + i.weight, 0);
    const effectiveBusinessType = businessType?.trim() || null; // null/blank defaults to แกะของ
    const yieldResult = calculateGainLoss(sourceWeight, itemsTotalWeight);

    if (yieldResult.gainWeight > YIELD_WEIGHT_TOLERANCE) {
      // Positive yield — check if allowed for this business type
      if (!isPositiveYieldAllowed(effectiveBusinessType)) {
        return NextResponse.json(
          {
            error: `น้ำหนัก output รวม (${itemsTotalWeight.toFixed(2)} กก.) เกินน้ำหนักต้นทาง (${sourceWeight} กก.) — ไม่อนุญาตสำหรับ businessType คัดแยก`,
            code: 'POSITIVE_YIELD_NOT_ALLOWED',
          },
          { status: 400, headers: { 'X-Request-ID': requestId } }
        );
      }
      // Require a meaningful reason for positive yield
      const gainReasonTrimmed = (gainReason || '').trim();
      if (!gainReasonTrimmed) {
        return NextResponse.json(
          {
            error: `น้ำหนัก output มากกว่าต้นทาง ${yieldResult.gainWeight.toFixed(2)} กก. กรุณาระบุเหตุผล เช่น หักน้ำหนักประเมินตอนซื้อ`,
            code: 'GAIN_REASON_REQUIRED',
            gainWeight: yieldResult.gainWeight,
          },
          { status: 400, headers: { 'X-Request-ID': requestId } }
        );
      }
    }

    // 6. Verify source product exists
    const sourceProduct = await db.product.findUnique({
      where: { id: sourceProductId },
      select: { id: true, name: true },
    });
    if (!sourceProduct) {
      return NextResponse.json(
        { error: `ไม่พบสินค้าต้นทาง (ID: ${sourceProductId})` },
        { status: 400 }
      );
    }

    // 7. Verify all output products exist
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const rowNum = i + 1;
      const outputProduct = await db.product.findUnique({
        where: { id: item.productId },
        select: { id: true, name: true },
      });
      if (!outputProduct) {
        return NextResponse.json(
          { error: `ไม่พบสินค้า output ลำดับที่ ${rowNum} (ID: ${item.productId})` },
          { status: 400 }
        );
      }
    }

    // 8. Pre-validate source stock availability
    const sourceLots = await db.stockLot.findMany({
      where: { productId: sourceProductId, remainingWeight: { gt: 0 } },
      orderBy: FIFO_ORDER_BY,
    });
    const totalAvailable = sourceLots.reduce((sum, l) => sum + l.remainingWeight, 0);
    if (totalAvailable < sourceWeight) {
      return NextResponse.json(
        {
          error: `สต็อกไม่เพียงพอสำหรับ "${sourceProduct.name}". มี: ${totalAvailable} กก., ต้องการ: ${sourceWeight} กก.`,
        },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }

    // ========== ST-20 Phase 2: Pre-flight FIFO validation (no DB writes) ==========
    // StockTransfer has NO waste concept — block any zero-cost source lots.
    const fifoPreview = previewFifoDeduction(
      sourceProductId,
      sourceWeight,
      sourceLots.map((l) => ({
        id: l.id,
        remainingWeight: l.remainingWeight,
        costPerKg: l.costPerKg,
        dateAdded: l.dateAdded,
        createdAt: l.createdAt,
      }))
    );

    if (!fifoPreview.success) {
      return NextResponse.json(
        {
          error: fifoPreview.message,
          code: fifoPreview.code,
          sourceProductId,
          sourceProductName: sourceProduct.name,
          sourceWeight,
          totalAvailable: fifoPreview.totalAvailable,
          affectedSourceLotIds: fifoPreview.affectedSourceLotIds,
          requestId,
        },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }

    // Validate source lot costs against StockTransfer policy (always block zero-cost)
    const costValidation = validateSourceLotCosts(fifoPreview, {
      type: 'TRANSFER',
      hasNonWasteOutput: true, // Transfer has no waste — always treat as non-waste
    });
    if (!costValidation.valid) {
      return NextResponse.json(
        {
          error: costValidation.message,
          code: costValidation.code,
          sourceProductId,
          sourceProductName: sourceProduct.name,
          sourceWeight,
          affectedSourceLotIds: costValidation.affectedSourceLotIds,
          weightedAverageCost: costValidation.weightedAverageCost,
          requestId,
        },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }

    // ========== EXECUTE (pgbouncer-safe sequential operations, NOT interactive transaction) ==========

    // Step 1: Generate bill number BEFORE any DB writes
    billNumber = await generateBillNumber(db, 'TRANSFER');

    // Step 2: Deduct source stock via FIFO (sequential lot updates)
    // ST-11: Track deductedLots for rollback compensation.
    const fifoResult = await deductStockFIFO(sourceProductId, sourceWeight);
    deductedLots = fifoResult.deductedLots;
    const sourceCostPerKg = fifoResult.costPerKg;
    const sourceTotalCost = fifoResult.totalCost;

    // ST-20 Phase 2: Verify actual FIFO result matches pre-flight preview
    if (!verifyFifoMatch(fifoPreview, { ...fifoResult, deductedLots: fifoResult.deductedLots })) {
      console.error(
        `[ST-20] StockTransfer FIFO mismatch | requestId=${requestId} | sourceProductId=${sourceProductId} | sourceWeight=${sourceWeight} | preview cost=${fifoPreview.weightedAverageCost} | actual cost=${fifoResult.costPerKg}`
      );
      // Compensate deducted lots via the existing durable compensation mechanism
      await compensateDeductedLots(deductedLots, `${requestId}-fifo-mismatch`, 'FIFO preview/execution mismatch');
      return NextResponse.json(
        {
          error: 'ตรวจพบความไม่ตรงของต้นทุน FIFO ระหว่าง preview และ execution กรุณาลองอีกครั้ง',
          code: 'FIFO_MISMATCH',
          sourceProductId,
          sourceWeight,
          previewCost: fifoPreview.weightedAverageCost,
          actualCost: fifoResult.costPerKg,
          requestId,
        },
        { status: 409, headers: { 'X-Request-ID': requestId } }
      );
    }

    // Step 3: Calculate gain/loss/variance (ST-40: positive yield supported)
    // yieldResult was computed during validation (above)
    const lossWeight = yieldResult.lossWeight;
    const gainWeight = yieldResult.gainWeight;
    const weightVariance = yieldResult.weightVariance;
    const lossCost = Math.round(lossWeight * sourceCostPerKg * 100) / 100;
    const gainReasonValue = gainWeight > YIELD_WEIGHT_TOLERANCE ? (gainReason || '').trim() : null;

    // ST-40: Cost conservation — allocate sourceTotalCost across non-waste outputs
    // proportionally by weight. This prevents cost inflation when output > source.
    // (Previously: costPerKg = sourceCostPerKg for all items → output total cost
    //  could exceed sourceTotalCost when output weight > source weight.)
    const costAllocation = allocateOutputCosts(sourceTotalCost, items);
    const allocatedItems = costAllocation.items; // has costPerKg + totalCost per item

    const srcPricePerKg = sourcePricePerKg || 0;
    const labor = laborCost || 0;
    const outputTotalValue = Math.round(
      items.reduce((s, i) => s + (i.isWaste ? 0 : i.weight * (i.outputPricePerKg || 0)), 0) * 100
    ) / 100;
    const sourceAnalysisCost = Math.round(sourceWeight * srcPricePerKg * 100) / 100;
    const profitLoss = Math.round((outputTotalValue - sourceAnalysisCost - labor) * 100) / 100;

    // Step 4: Create the StockTransfer record
    const created = await db.stockTransfer.create({
      data: {
        billNumber,
        date: parseThailandBusinessDate(date), // ST-41: Thailand business-date midnight (timezone-safe)
        roomNumber: roomNumber?.trim() || null,
        businessType: businessType?.trim() || null,
        sourceProductId,
        sourceWeight,
        sourceWeightExpression: isRealFormula(sourceWeightExpression)
          ? sourceWeightExpression!.trim()
          : null,
        sourceCostPerKg,
        sourceTotalCost,
        sourcePricePerKg: srcPricePerKg,
        laborCost: labor,
        outputTotalValue,
        profitLoss,
        weighedTotal: weighedTotal || 0,
        weighedTotalExpression: isRealFormula(weighedTotalExpression)
          ? weighedTotalExpression!.trim()
          : null,
        lossWeight,
        lossCost,
        gainWeight,
        weightVariance,
        gainReason: gainReasonValue,
        note: note || null,
        items: {
          create: items.map((item, idx) => ({
            productId: item.productId,
            weight: item.weight,
            weightExpression: isRealFormula(item.weightExpression) ? item.weightExpression!.trim() : null,
            isWaste: item.isWaste,
            costPerKg: allocatedItems[idx].costPerKg,
            totalCost: allocatedItems[idx].totalCost,
            outputPricePerKg: item.isWaste ? 0 : (item.outputPricePerKg || 0),
          })),
        },
      },
      include: {
        sourceProduct: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    // ST-11: Track the created bill ID for rollback (delete on failure).
    createdTransferId = created.id;

    // Step 5: Create StockLots for non-waste output items (sequential, pgbouncer-safe)
    // ST-40: use allocated costPerKg (proportional) not sourceCostPerKg — prevents cost inflation
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx];
      if (!item.isWaste && item.weight > 0) {
        await db.stockLot.create({
          data: {
            productId: item.productId,
            remainingWeight: item.weight,
            costPerKg: allocatedItems[idx].costPerKg,
            dateAdded: parseThailandBusinessDate(date), // ST-41: business date for FIFO chronology
            source: 'TRANSFER',
            sourceId: created.id,
          },
        });
      }
    }

    // Step 6: Write audit log
    // ST-20 Phase 2: Enhanced audit with source lot breakdown + cost allocation details
    const transferFifoAuditDetails = buildFifoAuditDetails(fifoPreview, {
      type: 'TRANSFER',
      hasNonWasteOutput: true,
    });
    await db.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'STOCK_TRANSFER',
        entityId: created.id,
        userId: payload.userId,
        userName: payload.name,
        details: JSON.stringify({
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
          nonWasteItemCount: items.filter((i) => !i.isWaste).length,
          // ST-20 Phase 2: FIFO audit details (provides sourceProductId, sourceWeight, etc.)
          ...transferFifoAuditDetails,
          outputItems: items.map((item) => ({
            productId: item.productId,
            weight: item.weight,
            isWaste: item.isWaste,
            assignedCostPerKg: item.isWaste ? 0 : sourceCostPerKg,
          })),
        }),
      },
    });

    return NextResponse.json({ bill: created }, { status: 201, headers: { 'X-Request-ID': requestId } });
  } catch (error) {
    // ST-13: Structured server log with request ID, user, and error for traceability.
    console.error(`[ST-13] StockTransfer POST failed | requestId=${requestId} | user=${payload.username} (${payload.userId}) | error=`, error);
    const message = error instanceof Error ? error.message : 'Failed to create stock transfer';

    // ST-11: Rollback compensation — if FIFO deducted source stock but a later step failed,
    // restore the deducted lots to prevent permanent stock loss.
    // Also recover partial deductedLots from the error object (if deductStockFIFO threw mid-loop).
    const partialDeductedLots = (error as any)?.deductedLots || deductedLots;
    if (partialDeductedLots.length > 0) {
      console.error(`ST-11: Rolling back ${partialDeductedLots.length} deducted lots for failed transfer ${billNumber || '(no billNumber)'}`);
      // 1. Delete any output StockLots created (by sourceId = createdTransferId, source = 'TRANSFER')
      if (createdTransferId) {
        try {
          const deletedLots = await db.stockLot.deleteMany({
            where: { sourceId: createdTransferId, source: 'TRANSFER' },
          });
          if (deletedLots.count > 0) console.error(`ST-11: Deleted ${deletedLots.count} partial output lots`);
        } catch (delErr) {
          console.error('ST-11: Failed to delete partial output lots (non-fatal):', delErr);
        }
        // 2. Delete the StockTransfer bill record (it has no valid output lots)
        try {
          await db.stockTransfer.delete({ where: { id: createdTransferId } });
          console.error(`ST-11: Deleted partial transfer record ${createdTransferId}`);
        } catch (delErr) {
          console.error('ST-11: Failed to delete partial transfer record (non-fatal):', delErr);
        }
      }
      // 3. Restore source lots by re-incrementing (ST-14: DB-durable via CompensationOperation ledger)
      await compensateDeductedLots(partialDeductedLots, requestId, message);
      // 4. Best-effort audit log of the failure + rollback
      try {
        await db.auditLog.create({
          data: {
            action: 'CREATE',
            entityType: 'STOCK_TRANSFER',
            entityId: createdTransferId || 'FAILED',
            userId: payload.userId,
            userName: payload.name,
            details: JSON.stringify({
              status: 'ROLLED_BACK',
              error: message.substring(0, 500),
              billNumber,
              requestId,
              deductedLotCount: partialDeductedLots.length,
              compensatedLotIds: partialDeductedLots.map(l => l.id),
            }),
          },
        });
      } catch (auditErr) {
        // AuditLog failure must NOT prevent the error response from being returned.
        console.error('ST-11: AuditLog write failed during rollback (non-fatal):', auditErr);
      }
    }

    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 — Unique constraint violation
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: 'เลขบิลซ้ำ กรุณาลองอีกครั้ง', details: message, requestId },
          { status: 409, headers: { 'X-Request-ID': requestId } }
        );
      }
      // P2003 — Foreign key constraint violation
      if (error.code === 'P2003') {
        return NextResponse.json(
          { error: 'สินค้าที่อ้างถึงไม่มีอยู่ในระบบ (FK constraint)', details: message, requestId },
          { status: 400, headers: { 'X-Request-ID': requestId } }
        );
      }
      // P2025 — Record not found
      if (error.code === 'P2025') {
        return NextResponse.json(
          { error: 'ไม่พบข้อมูลที่ต้องการอัปเดต', details: message, requestId },
          { status: 404, headers: { 'X-Request-ID': requestId } }
        );
      }
    }

    // Handle "Insufficient stock" error from FIFO
    if (message.includes('Insufficient stock')) {
      return NextResponse.json(
        { error: message, requestId },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }

    // ST-20 Phase 2: Surface FIFO validation errors
    if (message.includes('NEGATIVE_COST_SOURCE_LOT') || message.includes('ZERO_COST_SOURCE_LOT') || message.includes('ZERO_SOURCE_COST')) {
      return NextResponse.json(
        { error: message, code: 'FIFO_VALIDATION_ERROR', requestId },
        { status: 400, headers: { 'X-Request-ID': requestId } }
      );
    }

    // Handle pgbouncer transaction errors
    if (message.includes('Transaction not found') || message.includes('drained')) {
      return NextResponse.json(
        { error: 'การเชื่อมต่อฐานข้อมูลหมดเวลา กรุณาลองอีกครั้ง (pgbouncer timeout)', details: message, requestId },
        { status: 503, headers: { 'X-Request-ID': requestId } }
      );
    }

    return NextResponse.json(
      { error: 'บันทึกใบย้ายสต็อกไม่สำเร็จ', details: message, requestId },
      { status: 500, headers: { 'X-Request-ID': requestId } }
    );
  }
}

// GET /api/stock-transfers - List stock transfers with pagination
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    // By default hide cancelled bills. Pass ?includeCancelled=true to include them.
    const includeCancelled = searchParams.get('includeCancelled') === 'true';
    // Optional businessType filter:
    //   ?businessType=คัดแยก   → only StockTransfers classified as คัดแยก
    //   ?businessType=แกะของ   → StockTransfers classified as แกะของ OR null (default business type)
    //   ?businessType=ALL      → no filter (all StockTransfers, default behavior)
    const businessTypeFilter = searchParams.get('businessType');

    const where: any = includeCancelled ? {} : { isCancelled: false };
    if (businessTypeFilter && businessTypeFilter !== 'ALL') {
      if (businessTypeFilter === 'แกะของ') {
        // แกะของ tab: show StockTransfers where businessType is null/empty OR explicitly 'แกะของ'
        where.OR = [
          { businessType: null },
          { businessType: '' },
          { businessType: 'แกะของ' },
        ];
      } else {
        // คัดแยก tab: show StockTransfers where businessType === 'คัดแยก'
        where.businessType = businessTypeFilter;
      }
    }

    const [bills, total] = await Promise.all([
      db.stockTransfer.findMany({
        where,
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      db.stockTransfer.count({ where }),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching stock transfers:', error);
    return NextResponse.json({ error: 'Failed to fetch stock transfers' }, { status: 500 });
  }
}
