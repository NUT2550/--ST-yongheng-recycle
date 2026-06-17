import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// POST /api/buy-bills - Create a buy bill
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, isCredit, note, items } = body as {
      date: string;
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

    // Calculate total amount
    let totalAmount = 0;
    const billItems = items.map((item) => {
      const itemTotal = item.weight * item.pricePerKg;
      totalAmount += itemTotal;
      return {
        productId: item.productId,
        weight: item.weight,
        pricePerKg: item.pricePerKg,
        totalAmount: Math.round(itemTotal * 100) / 100,
      };
    });

    totalAmount = Math.round(totalAmount * 100) / 100;

    // Create the buy bill with items and stock lots in a transaction
    const bill = await db.buyBill.create({
      data: {
        date: new Date(date),
        isCredit,
        note: note || null,
        totalAmount,
        items: {
          create: billItems,
        },
      },
      include: { items: { include: { product: true } } },
    });

    // Create StockLots for each item
    for (const item of bill.items) {
      await db.stockLot.create({
        data: {
          productId: item.productId,
          remainingWeight: item.weight,
          costPerKg: item.pricePerKg,
          dateAdded: new Date(date),
          source: 'BUY',
          sourceId: bill.id,
        },
      });
    }

    // If credit, create a CreditEntry (PAYABLE)
    if (isCredit) {
      await db.creditEntry.create({
        data: {
          type: 'PAYABLE',
          amount: totalAmount,
          paidAmount: 0,
          referenceType: 'BUY_BILL',
          referenceId: bill.id,
          description: `ใบซื้อ ${bill.id}`,
          date: new Date(date),
          isSettled: false,
        },
      });
    }

    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) {
    console.error('Error creating buy bill:', error);
    return NextResponse.json(
      { error: 'Failed to create buy bill' },
      { status: 500 }
    );
  }
}

// GET /api/buy-bills - List buy bills with pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;

    const [bills, total] = await Promise.all([
      db.buyBill.findMany({
        include: {
          items: {
            include: {
              product: {
                select: { id: true, name: true },
              },
            },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      db.buyBill.count(),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching buy bills:', error);
    return NextResponse.json(
      { error: 'Failed to fetch buy bills' },
      { status: 500 }
    );
  }
}
