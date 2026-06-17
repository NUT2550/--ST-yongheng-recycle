import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

// GET /api/dashboard - Dashboard summary
export async function GET() {
  try {
    // Get today's date range
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    // Run all independent queries in parallel
    const [
      stockLots,
      todayBuyBills,
      todaySellBills,
      recentBuyBills,
      recentSellBills,
      categories,
    ] = await Promise.all([
      // All stock lots with source info
      db.stockLot.findMany({
        select: {
          remainingWeight: true,
          costPerKg: true,
          productId: true,
          source: true,
        },
      }),
      // Today's buy bills
      db.buyBill.findMany({
        where: {
          date: { gte: todayStart, lt: todayEnd },
        },
        select: { totalAmount: true, items: { select: { weight: true } } },
      }),
      // Today's sell bills
      db.sellBill.findMany({
        where: {
          date: { gte: todayStart, lt: todayEnd },
        },
        select: { totalAmount: true, items: { select: { weight: true } } },
      }),
      // Recent buy bills
      db.buyBill.findMany({
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
        },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      // Recent sell bills
      db.sellBill.findMany({
        include: {
          items: {
            include: {
              product: { select: { id: true, name: true } },
            },
          },
          customer: { select: { id: true, name: true, phone: true } },
        },
        orderBy: { date: 'desc' },
        take: 5,
      }),
      // Categories with products for stock summary
      db.productCategory.findMany({
        include: {
          products: {
            include: {
              stockLots: {
                select: { remainingWeight: true, costPerKg: true, source: true },
              },
            },
            orderBy: { sortOrder: 'asc' },
          },
        },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);

    // Calculate stock totals
    const totalStockWeight = stockLots.reduce(
      (sum, l) => sum + l.remainingWeight,
      0
    );
    const totalStockCost = stockLots.reduce(
      (sum, l) => sum + l.remainingWeight * l.costPerKg,
      0
    );

    // Calculate cost by source
    const buyStockCost = stockLots
      .filter((l) => l.source === 'BUY')
      .reduce((sum, l) => sum + l.remainingWeight * l.costPerKg, 0);
    const buyStockWeight = stockLots
      .filter((l) => l.source === 'BUY')
      .reduce((sum, l) => sum + l.remainingWeight, 0);
    const sortingStockCost = stockLots
      .filter((l) => l.source === 'SORTING')
      .reduce((sum, l) => sum + l.remainingWeight * l.costPerKg, 0);
    const sortingStockWeight = stockLots
      .filter((l) => l.source === 'SORTING')
      .reduce((sum, l) => sum + l.remainingWeight, 0);

    // Calculate today's totals
    const todayBuyAmount = todayBuyBills.reduce(
      (sum, b) => sum + b.totalAmount,
      0
    );
    const todayBuyWeight = todayBuyBills.reduce(
      (sum, b) => sum + b.items.reduce((s, i) => s + i.weight, 0),
      0
    );
    const todaySellAmount = todaySellBills.reduce(
      (sum, b) => sum + b.totalAmount,
      0
    );
    const todaySellWeight = todaySellBills.reduce(
      (sum, b) => sum + b.items.reduce((s, i) => s + i.weight, 0),
      0
    );

    // Build detailed product list with stock info
    const productDetails: Array<{
      productId: string;
      productName: string;
      categoryId: string;
      categoryName: string;
      totalWeight: number;
      totalCost: number;
      buyWeight: number;
      buyCost: number;
      sortingWeight: number;
      sortingCost: number;
      avgCostPerKg: number;
    }> = [];

    let categoryIndex = 0;
    for (const cat of categories) {
      for (const product of cat.products) {
        let totalWeight = 0;
        let totalCost = 0;
        let buyWeight = 0;
        let buyCost = 0;
        let sortingWeight = 0;
        let sortingCost = 0;

        for (const lot of product.stockLots) {
          if (lot.remainingWeight <= 0) continue;
          const lotCost = lot.remainingWeight * lot.costPerKg;
          totalWeight += lot.remainingWeight;
          totalCost += lotCost;
          if (lot.source === 'BUY') {
            buyWeight += lot.remainingWeight;
            buyCost += lotCost;
          } else if (lot.source === 'SORTING') {
            sortingWeight += lot.remainingWeight;
            sortingCost += lotCost;
          }
        }

        productDetails.push({
          productId: product.id,
          productName: product.name,
          categoryId: cat.id,
          categoryName: cat.name,
          totalWeight: Math.round(totalWeight * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          buyWeight: Math.round(buyWeight * 100) / 100,
          buyCost: Math.round(buyCost * 100) / 100,
          sortingWeight: Math.round(sortingWeight * 100) / 100,
          sortingCost: Math.round(sortingCost * 100) / 100,
          avgCostPerKg:
            totalWeight > 0
              ? Math.round((totalCost / totalWeight) * 100) / 100
              : 0,
        });
      }
      categoryIndex++;
    }

    // Category summary (for backward compat)
    const categorySummary = categories.map((cat) => {
      let catTotalWeight = 0;
      let catTotalCost = 0;

      for (const product of cat.products) {
        for (const lot of product.stockLots) {
          catTotalWeight += lot.remainingWeight;
          catTotalCost += lot.remainingWeight * lot.costPerKg;
        }
      }

      return {
        categoryId: cat.id,
        categoryName: cat.name,
        totalWeight: Math.round(catTotalWeight * 100) / 100,
        totalCost: Math.round(catTotalCost * 100) / 100,
      };
    });

    return NextResponse.json({
      totalStockWeight: Math.round(totalStockWeight * 100) / 100,
      totalStockCost: Math.round(totalStockCost * 100) / 100,
      buyStockWeight: Math.round(buyStockWeight * 100) / 100,
      buyStockCost: Math.round(buyStockCost * 100) / 100,
      sortingStockWeight: Math.round(sortingStockWeight * 100) / 100,
      sortingStockCost: Math.round(sortingStockCost * 100) / 100,
      todayBuyAmount: Math.round(todayBuyAmount * 100) / 100,
      todaySellAmount: Math.round(todaySellAmount * 100) / 100,
      todayBuyWeight: Math.round(todayBuyWeight * 100) / 100,
      todaySellWeight: Math.round(todaySellWeight * 100) / 100,
      recentBuyBills,
      recentSellBills,
      categorySummary,
      productDetails,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    );
  }
}
