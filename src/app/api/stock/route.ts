import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const categories = await db.productCategory.findMany({
      include: {
        products: {
          include: {
            stockLots: {
              select: { remainingWeight: true, costPerKg: true },
            },
          },
          orderBy: { sortOrder: 'asc' },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const result = categories.map((cat) => ({
      id: cat.id,
      name: cat.name,
      type: cat.type,
      products: cat.products.map((p) => {
        const totalWeight = p.stockLots.reduce(
          (sum, l) => sum + l.remainingWeight,
          0
        );
        const totalCost = p.stockLots.reduce(
          (sum, l) => sum + l.remainingWeight * l.costPerKg,
          0
        );
        const avgCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

        return {
          id: p.id,
          name: p.name,
          totalWeight: Math.round(totalWeight * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          avgCostPerKg: Math.round(avgCostPerKg * 100) / 100,
        };
      }),
    }));

    return NextResponse.json({ categories: result });
  } catch (error) {
    console.error('Error fetching stock overview:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stock overview' },
      { status: 500 }
    );
  }
}
