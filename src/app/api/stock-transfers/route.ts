import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';
import { isRealFormula } from '@/lib/safe-math';

// Task 69: Rebuild trigger — ensures Vercel regenerates Prisma client with businessType field.
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
  const deductedLots: { id: string; deducted: number }[] = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const deductFromLot = Math.min(lot.remainingWeight, remaining);
    totalCost += deductFromLot * lot.costPerKg;
    remaining -= deductFromLot;
    // Update each lot sequentially (pgbouncer-safe)
    await db.stockLot.update({
      where: { id: lot.id },
      data: { remainingWeight: lot.remainingWeight - deductFromLot },
    });
    deductedLots.push({ id: lot.id, deducted: deductFromLot });
  }

  const costPerKg = weightToDeduct > 0 ? totalCost / weightToDeduct : 0;
  return {
    costPerKg: Math.round(costPerKg * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    deductedLots,
  };
}

// POST /api/stock-transfers - Create a stock transfer (แกะของ/ย้ายสต็อก)
export async function POST(request: NextRequest) {
  // --- Auth: admin or transfer.create permission (staff allowed by default) ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  const hasPermission = payload.role === 'admin' || payload.permissions?.['transfer.create'] === true;
  if (!hasPermission) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });

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

    // 5. HARD RULE: output total must not exceed source weight
    const itemsTotalWeight = items.reduce((s, i) => s + i.weight, 0);
    if (itemsTotalWeight > sourceWeight + 0.01) {
      return NextResponse.json(
        {
          error: `น้ำหนัก output รวม (${itemsTotalWeight.toFixed(2)} กก.) เกินน้ำหนักต้นทาง (${sourceWeight} กก.)`,
        },
        { status: 400 }
      );
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
    });
    const totalAvailable = sourceLots.reduce((sum, l) => sum + l.remainingWeight, 0);
    if (totalAvailable < sourceWeight) {
      return NextResponse.json(
        {
          error: `สต็อกไม่เพียงพอสำหรับ "${sourceProduct.name}". มี: ${totalAvailable} กก., ต้องการ: ${sourceWeight} กก.`,
        },
        { status: 400 }
      );
    }

    // ========== EXECUTE (pgbouncer-safe sequential operations, NOT interactive transaction) ==========

    // Step 1: Generate bill number BEFORE any DB writes
    const billNumber = await generateBillNumber(db, 'TRANSFER');

    // Step 2: Deduct source stock via FIFO (sequential lot updates)
    const fifoResult = await deductStockFIFO(sourceProductId, sourceWeight);
    const sourceCostPerKg = fifoResult.costPerKg;
    const sourceTotalCost = fifoResult.totalCost;

    // Step 3: Calculate loss and profitability
    const lossWeight = Math.round((sourceWeight - itemsTotalWeight) * 100) / 100;
    const lossCost = Math.round(lossWeight * sourceCostPerKg * 100) / 100;

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
        date: new Date(date),
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
        note: note || null,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            weight: item.weight,
            weightExpression: isRealFormula(item.weightExpression) ? item.weightExpression!.trim() : null,
            isWaste: item.isWaste,
            costPerKg: item.isWaste ? 0 : sourceCostPerKg,
            totalCost: item.isWaste ? 0 : Math.round(item.weight * sourceCostPerKg * 100) / 100,
            outputPricePerKg: item.isWaste ? 0 : (item.outputPricePerKg || 0),
          })),
        },
      },
      include: {
        sourceProduct: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    // Step 5: Create StockLots for non-waste output items (sequential, pgbouncer-safe)
    for (const item of items) {
      if (!item.isWaste && item.weight > 0) {
        await db.stockLot.create({
          data: {
            productId: item.productId,
            remainingWeight: item.weight,
            costPerKg: sourceCostPerKg,
            dateAdded: new Date(date),
            source: 'TRANSFER',
            sourceId: created.id,
          },
        });
      }
    }

    // Step 6: Write audit log
    await db.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'STOCK_TRANSFER',
        entityId: created.id,
        userId: payload.userId,
        userName: payload.name,
        details: JSON.stringify({
          billNumber,
          sourceProductId,
          sourceWeight,
          sourceCostPerKg,
          sourceTotalCost,
          lossWeight,
          lossCost,
          itemCount: created.items.length,
          nonWasteItemCount: items.filter((i) => !i.isWaste).length,
        }),
      },
    });

    return NextResponse.json({ bill: created }, { status: 201 });
  } catch (error) {
    console.error('Error creating stock transfer:', error);
    const message = error instanceof Error ? error.message : 'Failed to create stock transfer';

    // Handle Prisma-specific errors
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2002 — Unique constraint violation
      if (error.code === 'P2002') {
        return NextResponse.json(
          { error: 'เลขบิลซ้ำ กรุณาลองอีกครั้ง', details: message },
          { status: 409 }
        );
      }
      // P2003 — Foreign key constraint violation
      if (error.code === 'P2003') {
        return NextResponse.json(
          { error: 'สินค้าที่อ้างถึงไม่มีอยู่ในระบบ (FK constraint)', details: message },
          { status: 400 }
        );
      }
      // P2025 — Record not found
      if (error.code === 'P2025') {
        return NextResponse.json(
          { error: 'ไม่พบข้อมูลที่ต้องการอัปเดต', details: message },
          { status: 404 }
        );
      }
    }

    // Handle "Insufficient stock" error from FIFO
    if (message.includes('Insufficient stock')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // Handle pgbouncer transaction errors
    if (message.includes('Transaction not found') || message.includes('drained')) {
      return NextResponse.json(
        { error: 'การเชื่อมต่อฐานข้อมูลหมดเวลา กรุณาลองอีกครั้ง (pgbouncer timeout)', details: message },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: 'บันทึกใบย้ายสต็อกไม่สำเร็จ', details: message },
      { status: 500 }
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
