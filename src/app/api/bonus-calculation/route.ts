import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/bonus-calculation?year=2568
// Calculate bonus from sorting bills for a given year
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const buddhistYear = yearParam ? parseInt(yearParam) : new Date().getFullYear() + 543;
    const ceYear = buddhistYear - 543;

    // Date range for the year
    const yearStart = new Date(ceYear, 0, 1); // Jan 1
    const yearEnd = new Date(ceYear + 1, 0, 1); // Jan 1 next year

    // Fetch all sorting bills with items for the year
    const sortingBills = await db.sortingBill.findMany({
      where: {
        date: {
          gte: yearStart,
          lt: yearEnd,
        },
      },
      include: {
        sourceProduct: { select: { id: true, name: true } },
        items: {
          include: {
            product: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Fetch all active employees
    const employees = await db.employee.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });

    // Build detailed bonus items from non-waste sorting items
    const bonusItems: Array<{
      sortingBillId: string;
      date: string;
      sourceProductId: string;
      sourceProductName: string;
      sourceWeight: number;
      sourcePricePerKg: number;
      sortedProductId: string;
      sortedProductName: string;
      sortedWeight: number;
      sortedPricePerKg: number;
      costPerKg: number;
      grossProfit: number;
      bonusAmount: number;
    }> = [];

    let totalBonusAmount = 0;
    let totalSortedWeight = 0;

    for (const bill of sortingBills) {
      for (const item of bill.items) {
        if (item.isWaste) continue;
        if (item.bonusAmount <= 0 && item.sortedPricePerKg <= 0) continue;

        const grossProfit = Math.round(
          (item.sortedPricePerKg - bill.sourcePricePerKg) * item.weight * 100
        ) / 100;

        bonusItems.push({
          sortingBillId: bill.id,
          date: bill.date.toISOString(),
          sourceProductId: bill.sourceProductId,
          sourceProductName: bill.sourceProduct.name,
          sourceWeight: bill.sourceWeight,
          sourcePricePerKg: bill.sourcePricePerKg,
          sortedProductId: item.productId,
          sortedProductName: item.product.name,
          sortedWeight: item.weight,
          sortedPricePerKg: item.sortedPricePerKg,
          costPerKg: item.costPerKg,
          grossProfit,
          bonusAmount: item.bonusAmount,
        });

        totalBonusAmount += item.bonusAmount;
        totalSortedWeight += item.weight;
      }
    }

    // Aggregate by source → sorted product
    const aggregatedMap = new Map<string, {
      sourceProductId: string;
      sourceProductName: string;
      sortedProductId: string;
      sortedProductName: string;
      totalWeight: number;
      totalCost: number;
      totalValue: number;
      totalGrossProfit: number;
      totalBonusAmount: number;
      sourcePricePerKg: number;
      sortedPricePerKg: number;
    }>();

    for (const item of bonusItems) {
      const key = `${item.sourceProductId}_${item.sortedProductId}`;
      if (!aggregatedMap.has(key)) {
        aggregatedMap.set(key, {
          sourceProductId: item.sourceProductId,
          sourceProductName: item.sourceProductName,
          sortedProductId: item.sortedProductId,
          sortedProductName: item.sortedProductName,
          totalWeight: 0,
          totalCost: 0,
          totalValue: 0,
          totalGrossProfit: 0,
          totalBonusAmount: 0,
          sourcePricePerKg: item.sourcePricePerKg,
          sortedPricePerKg: item.sortedPricePerKg,
        });
      }
      const agg = aggregatedMap.get(key)!;
      agg.totalWeight += item.sortedWeight;
      agg.totalCost += item.sortedWeight * item.costPerKg;
      agg.totalValue += item.sortedWeight * item.sortedPricePerKg;
      agg.totalGrossProfit += item.grossProfit;
      agg.totalBonusAmount += item.bonusAmount;
    }

    const aggregatedItems = Array.from(aggregatedMap.values());

    // Calculate employee bonus distribution based on months worked
    const yearEndForCalc = new Date(ceYear, 11, 31); // Dec 31
    const yearStartForCalc = new Date(ceYear, 0, 1); // Jan 1

    const employeeDistribution = employees.map((emp) => {
      // Use hireDate if available, otherwise createdAt
      const startDate = emp.hireDate ? new Date(emp.hireDate) : new Date(emp.createdAt);

      // If hired after year end, 0 months
      if (startDate > yearEndForCalc) {
        return {
          employeeId: emp.id,
          employeeName: emp.name,
          hireDate: emp.hireDate?.toISOString() || null,
          createdAt: emp.createdAt.toISOString(),
          monthsWorked: 0,
          bonusAmount: 0,
        };
      }

      // Calculate months worked in this year
      const effectiveStart = startDate < yearStartForCalc ? yearStartForCalc : startDate;
      const monthDiff =
        (yearEndForCalc.getFullYear() - effectiveStart.getFullYear()) * 12 +
        (yearEndForCalc.getMonth() - effectiveStart.getMonth()) + 1;
      const monthsWorked = Math.min(Math.max(monthDiff, 0), 12);

      return {
        employeeId: emp.id,
        employeeName: emp.name,
        hireDate: emp.hireDate?.toISOString() || null,
        createdAt: emp.createdAt.toISOString(),
        monthsWorked,
        bonusAmount: 0, // Will be calculated below
      };
    });

    // Distribute bonus proportionally
    const totalMonths = employeeDistribution.reduce((sum, e) => sum + e.monthsWorked, 0);
    if (totalMonths > 0 && totalBonusAmount > 0) {
      for (const emp of employeeDistribution) {
        emp.bonusAmount = Math.round((emp.monthsWorked / totalMonths) * totalBonusAmount * 100) / 100;
      }
    }

    // Round totals
    totalBonusAmount = Math.round(totalBonusAmount * 100) / 100;
    totalSortedWeight = Math.round(totalSortedWeight * 100) / 100;

    return NextResponse.json({
      year: buddhistYear,
      totalBonusAmount,
      totalSortedWeight,
      sortingBillCount: sortingBills.length,
      aggregatedItems: aggregatedItems.map((a) => ({
        ...a,
        totalWeight: Math.round(a.totalWeight * 100) / 100,
        totalCost: Math.round(a.totalCost * 100) / 100,
        totalValue: Math.round(a.totalValue * 100) / 100,
        totalGrossProfit: Math.round(a.totalGrossProfit * 100) / 100,
        totalBonusAmount: Math.round(a.totalBonusAmount * 100) / 100,
      })),
      bonusItems: bonusItems.map((b) => ({
        ...b,
        sortedWeight: Math.round(b.sortedWeight * 100) / 100,
      })),
      employeeDistribution,
    });
  } catch (error) {
    console.error('Error calculating bonus:', error);
    return NextResponse.json(
      { error: 'Failed to calculate bonus' },
      { status: 500 }
    );
  }
}
