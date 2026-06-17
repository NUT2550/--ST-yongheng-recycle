import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
  try {
    const products = await db.product.findMany({
      include: {
        category: {
          select: { id: true, name: true, type: true },
        },
        stockLots: {
          select: { remainingWeight: true, costPerKg: true },
        },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });

    const result = products.map((p) => {
      const totalWeight = p.stockLots.reduce((sum, l) => sum + l.remainingWeight, 0);
      const totalCost = p.stockLots.reduce(
        (sum, l) => sum + l.remainingWeight * l.costPerKg,
        0
      );
      const avgCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

      return {
        id: p.id,
        name: p.name,
        defaultBuyPrice: p.defaultBuyPrice,
        category: p.category,
        stock: {
          totalWeight: Math.round(totalWeight * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          avgCostPerKg: Math.round(avgCostPerKg * 100) / 100,
        },
      };
    });

    return NextResponse.json({ products: result });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
