import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

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

// POST /api/sorting-bills - Create a sorting bill
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      date,
      sourceProductId,
      sourceWeight,
      sourcePricePerKg,
      weighedTotal,
      note,
      items,
    } = body as {
      date: string;
      sourceProductId: string;
      sourceWeight: number;
      sourcePricePerKg: number;
      weighedTotal: number;
      note?: string;
      items: Array<{
        productId: string;
        weight: number;
        isWaste: boolean;
        sortedPricePerKg: number;
        bonusAmount: number;
      }>;
    };

    if (!items || items.length === 0) {
      return NextResponse.json(
        { error: 'Items are required' },
        { status: 400 }
      );
    }

    if (sourceWeight <= 0) {
      return NextResponse.json(
        { error: 'Source weight must be greater than 0' },
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

    // Use transaction for FIFO deduction and bill creation
    const result = await db.$transaction(async (tx) => {
      // Deduct source product stock using FIFO
      const fifoResult = await deductStockFIFO(sourceProductId, sourceWeight, tx);
      const sourceCostPerKg = fifoResult.costPerKg;

      // Calculate loss
      const itemsTotalWeight = items.reduce((sum, i) => sum + i.weight, 0);
      const lossWeight = Math.round((sourceWeight - itemsTotalWeight) * 100) / 100;
      const lossCost = Math.round(lossWeight * sourceCostPerKg * 100) / 100;

      // Build sorting items with new bonus fields
      const sortingItems = items.map((item) => ({
        productId: item.productId,
        weight: item.weight,
        isWaste: item.isWaste,
        costPerKg: item.isWaste ? 0 : sourceCostPerKg,
        totalCost: item.isWaste ? 0 : Math.round(item.weight * sourceCostPerKg * 100) / 100,
        sortedPricePerKg: item.isWaste ? 0 : item.sortedPricePerKg,
        bonusAmount: item.isWaste ? 0 : Math.round(item.bonusAmount * 100) / 100,
      }));

      // Create the sorting bill
      const bill = await tx.sortingBill.create({
        data: {
          date: new Date(date),
          sourceProductId,
          sourceWeight,
          sourcePricePerKg: sourcePricePerKg || 0,
          weighedTotal: weighedTotal || 0,
          lossWeight,
          lossCost,
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

      // Create StockLots for non-waste sorted items
      for (const item of items) {
        if (!item.isWaste && item.weight > 0) {
          await tx.stockLot.create({
            data: {
              productId: item.productId,
              remainingWeight: item.weight,
              costPerKg: sourceCostPerKg,
              dateAdded: new Date(date),
              source: 'SORTING',
              sourceId: bill.id,
            },
          });
        }
      }

      return bill;
    });

    return NextResponse.json({ bill: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create sorting bill';
    console.error('Error creating sorting bill:', error);

    if (message.includes('Insufficient stock')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to create sorting bill', details: message },
      { status: 500 }
    );
  }
}

// GET /api/sorting-bills - List sorting bills with pagination
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '20', 10);
    const skip = (page - 1) * limit;

    const [bills, total] = await Promise.all([
      db.sortingBill.findMany({
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
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      db.sortingBill.count(),
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
