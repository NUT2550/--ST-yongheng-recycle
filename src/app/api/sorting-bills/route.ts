import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';
import { isRealFormula } from '@/lib/safe-math';

// Helper: Deduct stock using FIFO and return weighted average cost
async function deductStockFIFO(
  productId: string,
  weightToDeduct: number,
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]
): Promise<{ costPerKg: number; totalCost: number }> {
  const lots = await tx.stockLot.findMany({
    where: {
      productId,
      remainingWeight: { gt: 0 },
    },
    orderBy: { dateAdded: 'asc' },
  });

  const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeight, 0);
  if (totalAvailable < weightToDeduct) {
    throw new Error(
      `Insufficient stock for product ${productId}. Available: ${totalAvailable}, Requested: ${weightToDeduct}`
    );
  }

  let remaining = weightToDeduct;
  let totalCost = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;

    const deductFromLot = Math.min(lot.remainingWeight, remaining);
    totalCost += deductFromLot * lot.costPerKg;
    remaining -= deductFromLot;

    await tx.stockLot.update({
      where: { id: lot.id },
      data: { remainingWeight: lot.remainingWeight - deductFromLot },
    });
  }

  const costPerKg = weightToDeduct > 0 ? totalCost / weightToDeduct : 0;
  return {
    costPerKg: Math.round(costPerKg * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

// Helper: Restore stock as a new lot (compensating action on failure)
async function restoreStock(
  productId: string,
  weight: number,
  costPerKg: number,
  client: typeof db,
  source: string
): Promise<void> {
  try {
    await client.stockLot.create({
      data: {
        productId,
        remainingWeight: weight,
        costPerKg,
        dateAdded: new Date(),
        source,
      },
    });
  } catch (err) {
    console.error('restoreStock failed (non-fatal):', err);
  }
}

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

    // --- Generate bill number BEFORE the transaction (avoids pgbouncer tx timeout) ---
    const billNumber = await generateBillNumber(db, 'SORT');

    // --- Sequential operations (pgbouncer-safe; no interactive $transaction) ---
    // Step 1: Deduct source stock via FIFO
    const fifoResult = await deductStockFIFO(sourceProductId, sourceWeight, db);
    const sourceCostPerKg = fifoResult.costPerKg;

    // Calculate loss = sourceWeight - sum(item weights)
    const itemsTotalWeight = items.reduce((sum, i) => sum + i.weight, 0);
    const lossWeight = Math.round((sourceWeight - itemsTotalWeight) * 100) / 100;
    const lossCost = Math.round(lossWeight * sourceCostPerKg * 100) / 100;

    // Build sorting items with new bonus fields + weightExpression
    const sortingItems = items.map((item) => ({
      productId: item.productId,
      weight: item.weight,
      weightExpression: isRealFormula(item.weightExpression)
        ? item.weightExpression!.trim()
        : null,
      isWaste: item.isWaste,
      costPerKg: item.isWaste ? 0 : sourceCostPerKg,
      totalCost: item.isWaste ? 0 : Math.round(item.weight * sourceCostPerKg * 100) / 100,
      sortedPricePerKg: item.isWaste ? 0 : item.sortedPricePerKg,
      bonusAmount: item.isWaste ? 0 : Math.round(item.bonusAmount * 100) / 100,
    }));

    // Step 2: Create the sorting bill
    let created: any;
    try {
      created = await db.sortingBill.create({
        data: {
          billNumber,
          date: new Date(date),
          sourceProductId,
          sourceWeight,
          sourceWeightExpression: isRealFormula(sourceWeightExpression)
            ? sourceWeightExpression!.trim()
            : null,
          sourcePricePerKg: sourcePricePerKg || 0,
          weighedTotal: weighedTotal || 0,
          weighedTotalExpression: isRealFormula(weighedTotalExpression)
            ? weighedTotalExpression!.trim()
            : null,
          lossWeight,
          lossCost,
          roomNumber: roomNumber?.trim() || null,
          note: note || null,
          items: {
            create: sortingItems,
          },
        },
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
      });
    } catch (createErr) {
      // Compensating: restore the deducted source stock if bill creation fails
      await restoreStock(sourceProductId, sourceWeight, sourceCostPerKg, db, 'SORT_ROLLBACK');
      throw createErr;
    }

    // Step 3: Create StockLots for non-waste sorted items
    try {
      for (const item of items) {
        if (!item.isWaste && item.weight > 0) {
          await db.stockLot.create({
            data: {
              productId: item.productId,
              remainingWeight: item.weight,
              costPerKg: sourceCostPerKg,
              dateAdded: new Date(date),
              source: 'SORTING',
              sourceId: created.id,
            },
          });
        }
      }
    } catch (lotErr) {
      // Compensating: delete the bill + items, restore source stock
      await db.sortingBill.delete({ where: { id: created.id } }).catch(() => {});
      await restoreStock(sourceProductId, sourceWeight, sourceCostPerKg, db, 'SORT_ROLLBACK');
      throw lotErr;
    }

    // Step 4: Audit log (best-effort, non-fatal)
    await writeAuditLog(db, {
      action: 'CREATE',
      entityType: 'SORTING_BILL',
      entityId: created.id,
      userId: payload.userId,
      userName: payload.name,
      details: JSON.stringify({
        billNumber,
        sourceProductId,
        sourceWeight,
        sourceCostPerKg,
        lossWeight,
        lossCost,
        itemCount: created.items.length,
        nonWasteItemCount: items.filter((i) => !i.isWaste).length,
      }),
    });

    return NextResponse.json({ bill: created }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create sorting bill';
    console.error('Error creating sorting bill:', error);

    if (message.includes('Insufficient stock')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Unique constraint on billNumber — should not happen after the
    // max-sequence fix, but surface a clear message if it ever does.
    if (message.includes('Unique constraint failed') && message.includes('billNumber')) {
      return NextResponse.json(
        { error: 'หมายเลขบิลซ้ำ — กรุณาลองบันทึกอีกครั้ง', details: message },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to create sorting bill', details: message },
      { status: 500 }
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
    // Pagination clamp: page min 1, limit min 1 max 100
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    // By default hide cancelled bills. Pass ?includeCancelled=true to include them.
    const includeCancelled = searchParams.get('includeCancelled') === 'true';
    const where = includeCancelled ? {} : { isCancelled: false };

    const [bills, total] = await Promise.all([
      db.sortingBill.findMany({
        where,
        include: {
          sourceProduct: {
            select: { id: true, name: true },
          },
          items: {
            include: {
              product: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      db.sortingBill.count({ where }),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching sorting bills:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sorting bills' },
      { status: 500 }
    );
  }
}
