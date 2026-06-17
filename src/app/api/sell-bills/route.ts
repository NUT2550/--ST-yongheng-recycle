import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

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
  try {
    const body = await request.json();
    const { date, customerId, isCredit, note, items } = body as {
      date: string;
      customerId?: string;
      isCredit: boolean;
      note?: string;
      items: Array<{ productId: string; weight: number; pricePerKg: number }>;
    };

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Items are required' },
        { status: 400 }
      );
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

    // Use transaction for FIFO deduction and bill creation
    const result = await db.$transaction(async (tx) => {
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

      const bill = await tx.sellBill.create({
        data: {
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
            referenceId: bill.id,
            description: `ใบขาย ${bill.id}`,
            date: new Date(date),
            isSettled: false,
          },
        });
      }

      return bill;
    });

    return NextResponse.json({ bill: result }, { status: 201 });
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
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
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
