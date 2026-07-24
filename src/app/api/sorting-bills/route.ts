import { db } from '@/lib/db';
import type { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';
import { isRealFormula } from '@/lib/safe-math';
import {
  previewFifoDeduction,
  validateSourceLotCosts,
  buildFifoAuditDetails,
  FIFO_ORDER_BY,
} from '@/lib/fifo-validation';
import {
  createSortingBillTransaction,
  mapPrismaError,
  SortingError,
  type SortingBillInput,
} from '@/lib/sorting-transaction-service';
import { createPrismaSortingDeps } from '@/lib/sorting-prisma-adapter';
import { buildCombinedHistoryPage } from '@/lib/combined-sorting-history';

// POST /api/sorting-bills - Create a sorting bill
export async function POST(request: NextRequest) {
  // --- Auth ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  const hasPermission = payload.role === 'admin' || payload.permissions?.['sort.create'] === true;
  if (!hasPermission) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });

  try {
    const body = await request.json();
    const {
      date,
      sourceProductId,
      sourceWeight,
      sourceWeightExpression,
      sourcePricePerKg,
      weighedTotal,
      weighedTotalExpression,
      roomNumber,
      note,
      items,
    } = body as {
      date: string;
      sourceProductId: string;
      sourceWeight: number;
      sourceWeightExpression?: string;
      sourcePricePerKg: number;
      weighedTotal: number;
      weighedTotalExpression?: string;
      roomNumber?: string;
      note?: string;
      items: Array<{
        productId: string;
        weight: number;
        weightExpression?: string;
        isWaste: boolean;
        sortedPricePerKg: number;
        bonusAmount: number;
      }>;
    };

    // --- Validation ---
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Items are required' }, { status: 400 });
    }

    if (typeof sourceWeight !== 'number' || sourceWeight <= 0) {
      return NextResponse.json(
        { error: 'น้ำหนักต้นทางต้องมากกว่า 0' },
        { status: 400 }
      );
    }

    // Pre-validate stock availability for source product
    const sourceLots = await db.stockLot.findMany({
      where: {
        productId: sourceProductId,
        remainingWeight: { gt: 0 },
      },
      orderBy: FIFO_ORDER_BY,
    });
    const totalAvailable = sourceLots.reduce((sum, l) => sum + l.remainingWeight, 0);
    if (totalAvailable < sourceWeight) {
      const product = await db.product.findUnique({
        where: { id: sourceProductId },
        select: { name: true },
      });
      return NextResponse.json(
        {
          error: `สต็อกไม่เพียงพอสำหรับ "${product?.name || sourceProductId}". มี: ${totalAvailable} kg, ต้องการ: ${sourceWeight} kg`,
        },
        { status: 400 }
      );
    }

    // --- ST-20 Phase 2: Pre-flight FIFO validation (no DB writes) ---
    const sourceProduct = await db.product.findUnique({
      where: { id: sourceProductId },
      select: { name: true },
    });
    const sourceProductName = sourceProduct?.name || sourceProductId;

    const hasNonWasteOutput = items.some((i) => !i.isWaste && i.weight > 0);

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
          sourceProductName,
          sourceWeight,
          totalAvailable: fifoPreview.totalAvailable,
          affectedSourceLotIds: fifoPreview.affectedSourceLotIds,
        },
        { status: 400 }
      );
    }

    const costValidation = validateSourceLotCosts(fifoPreview, {
      type: 'SORTING',
      hasNonWasteOutput,
    });
    if (!costValidation.valid) {
      return NextResponse.json(
        {
          error: costValidation.message,
          code: costValidation.code,
          sourceProductId,
          sourceProductName,
          sourceWeight,
          affectedSourceLotIds: costValidation.affectedSourceLotIds,
          weightedAverageCost: costValidation.weightedAverageCost,
        },
        { status: 400 }
      );
    }

    // --- Generate bill number BEFORE the transaction ---
    const billNumber = await generateBillNumber(db, 'SORT');

    // --- Build service input ---
    const serviceInput: SortingBillInput = {
      date,
      sourceProductId,
      sourceWeight,
      sourceWeightExpression,
      sourcePricePerKg,
      weighedTotal,
      weighedTotalExpression,
      roomNumber,
      note,
      items,
      billNumber,
    };

    // --- Execute the transaction via the extracted service ---
    const deps = createPrismaSortingDeps();
    const result = await createSortingBillTransaction(deps, serviceInput, fifoPreview);
    const { sortingBill: created, sourceCostPerKg, lossWeight, lossCost } = result;

    // --- Audit log (best-effort, non-fatal, outside transaction) ---
    const fifoAuditDetails = buildFifoAuditDetails(fifoPreview, {
      type: 'SORTING',
      hasNonWasteOutput,
    });
    await writeAuditLog(db, {
      action: 'CREATE',
      entityType: 'SORTING_BILL',
      entityId: created.id,
      userId: payload.userId,
      userName: payload.name,
      details: JSON.stringify({
        billNumber,
        sourceProductName,
        sourceCostPerKg,
        lossWeight,
        lossCost,
        itemCount: created.items.length,
        nonWasteItemCount: items.filter((i) => !i.isWaste).length,
        ...fifoAuditDetails,
        outputItems: items.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          isWaste: item.isWaste,
          assignedCostPerKg: item.isWaste ? 0 : sourceCostPerKg,
        })),
      }),
    });

    return NextResponse.json({ bill: created }, { status: 201 });
  } catch (error) {
    console.error('Error creating sorting bill:', error);

    // ST-54: Use the extracted error mapper
    const mapped = mapPrismaError(error);
    return NextResponse.json(
      { error: mapped.message, code: mapped.code },
      { status: mapped.httpStatus }
    );
  }
}

// GET /api/sorting-bills - List sorting bills with pagination
export async function GET(request: NextRequest) {
  // --- Auth: any authenticated user ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    const includeCancelled = searchParams.get('includeCancelled') === 'true';
    const includeTransfers = searchParams.get('includeTransfers') === 'true';
    const where = includeCancelled ? {} : { isCancelled: false };

    if (includeTransfers) {
      const takePerSource = skip + limit;
      const transferWhere = {
        ...(includeCancelled ? {} : { isCancelled: false }),
        businessType: 'คัดแยก',
      };

      const [sortingBills, sortingTotal, transferBills, transferTotal] = await Promise.all([
        db.sortingBill.findMany({
          where,
          include: {
            sourceProduct: { select: { id: true, name: true } },
            items: { include: { product: { select: { id: true, name: true } } } },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: takePerSource,
        }),
        db.sortingBill.count({ where }),
        db.stockTransfer.findMany({
          where: transferWhere,
          include: {
            sourceProduct: { select: { id: true, name: true } },
            items: { include: { product: { select: { id: true, name: true } } } },
          },
          orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
          take: takePerSource,
        }),
        db.stockTransfer.count({ where: transferWhere }),
      ]);

      const combined = buildCombinedHistoryPage<
        (typeof sortingBills)[number] | (typeof transferBills)[number]
      >({
        sources: [sortingBills, transferBills],
        page,
        limit,
        total: sortingTotal + transferTotal,
      });

      return NextResponse.json({ bills: combined.rows, total: combined.total });
    }

    const [bills, total] = await Promise.all([
      db.sortingBill.findMany({
        where,
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      db.sortingBill.count({ where }),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching sorting bills:', error);
    return NextResponse.json({ error: 'Failed to fetch sorting bills' }, { status: 500 });
  }
}
