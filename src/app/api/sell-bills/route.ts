import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';

// Helper: Deduct stock using FIFO and return weighted average cost
async function deductStockFIFO(
  productId: string,
  weightToDeduct: number,
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]
): Promise<{ costPerKg: number; totalCost: number }> {
  // Get available lots ordered by dateAdded ASC (FIFO)
  const lots = await tx.stockLot.findMany({
    where: {
      productId,
      remainingWeight: { gt: 0 },
    },
    orderBy: { dateAdded: 'asc' },
  });

  // Check total available stock
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

// POST /api/sell-bills - Create a sell bill with FIFO cost calculation
export async function POST(request: NextRequest) {
  // --- Auth ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  const hasPermission = payload.role === 'admin' || payload.permissions?.['sell.create'] === true;
  if (!hasPermission) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });

  try {
    const body = await request.json();
    const { date, customerId, isCredit, note, items } = body as {
      date: string;
      customerId?: string;
      isCredit: boolean;
      note?: string;
      items: Array<{ productId: string; weight: number; pricePerKg: number }>;
    };

    // --- Validation ---
    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Items are required' }, { status: 400 });
    }

    for (const item of items) {
      if (typeof item.weight !== 'number' || item.weight <= 0) {
        return NextResponse.json({ error: 'น้ำหนักต้องมากกว่า 0' }, { status: 400 });
      }
      if (typeof item.pricePerKg !== 'number' || item.pricePerKg <= 0) {
        return NextResponse.json({ error: 'ราคา/กก. ต้องมากกว่า 0' }, { status: 400 });
      }
    }

    // Pre-validate stock availability for all items
    for (const item of items) {
      const lots = await db.stockLot.findMany({
        where: {
          productId: item.productId,
          remainingWeight: { gt: 0 },
        },
      });
      const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeight, 0);
      if (totalAvailable < item.weight) {
        const product = await db.product.findUnique({
          where: { id: item.productId },
          select: { name: true },
        });
        return NextResponse.json(
          {
            error: `สต็อกไม่เพียงพอสำหรับ "${product?.name || item.productId}". มี: ${totalAvailable} kg, ต้องการ: ${item.weight} kg`,
          },
          { status: 400 }
        );
      }
    }

    // --- Transaction: FIFO deduction + bill + credit + audit ---
    const bill = await db.$transaction(async (tx) => {
      let totalAmount = 0;
      let totalCost = 0;
      const sellItems: Array<{
        productId: string;
        weight: number;
        pricePerKg: number;
        totalAmount: number;
        costPerKg: number;
        totalCost: number;
      }> = [];

      for (const item of items) {
        const itemTotalAmount = Math.round(item.weight * item.pricePerKg * 100) / 100;
        const fifoResult = await deductStockFIFO(item.productId, item.weight, tx);

        totalAmount += itemTotalAmount;
        totalCost += fifoResult.totalCost;

        sellItems.push({
          productId: item.productId,
          weight: item.weight,
          pricePerKg: item.pricePerKg,
          totalAmount: itemTotalAmount,
          costPerKg: fifoResult.costPerKg,
          totalCost: fifoResult.totalCost,
        });
      }

      totalAmount = Math.round(totalAmount * 100) / 100;
      totalCost = Math.round(totalCost * 100) / 100;

      const billNumber = await generateBillNumber(tx, 'SELL');
      const created = await tx.sellBill.create({
        data: {
          billNumber,
          date: new Date(date),
          customerId: customerId || null,
          isCredit,
          note: note || null,
          totalAmount,
          totalCost,
          items: {
            create: sellItems,
          },
        },
        include: {
          items: { include: { product: true } },
          customer: true,
        },
      });

      // If credit, create a CreditEntry (RECEIVABLE)
      if (isCredit) {
        await tx.creditEntry.create({
          data: {
            type: 'RECEIVABLE',
            amount: totalAmount,
            paidAmount: 0,
            customerId: customerId || null,
            referenceType: 'SELL_BILL',
            referenceId: created.id,
            description: `ใบขาย ${billNumber}`,
            date: new Date(date),
            isSettled: false,
          },
        });
      }

      await writeAuditLog(tx, {
        action: 'CREATE',
        entityType: 'SELL_BILL',
        entityId: created.id,
        userId: payload.userId,
        userName: payload.name,
        details: JSON.stringify({
          billNumber,
          totalAmount,
          totalCost,
          itemCount: created.items.length,
          isCredit,
          customerId: customerId || null,
        }),
      });

      return created;
    });

    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create sell bill';
    console.error('Error creating sell bill:', error);

    if (message.includes('Insufficient stock')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to create sell bill' },
      { status: 500 }
    );
  }
}

// GET /api/sell-bills - List sell bills with pagination
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

    const [bills, total] = await Promise.all([
      db.sellBill.findMany({
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true },
              },
            },
          },
          customer: {
            select: { id: true, name: true, phone: true },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      db.sellBill.count(),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching sell bills:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sell bills' },
      { status: 500 }
    );
  }
}
