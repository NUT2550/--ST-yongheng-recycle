import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { NextRequest, NextResponse } from 'next/server';

// GET /api/bonuses - List sorting bonuses
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employeeId');
    const isPaid = searchParams.get('isPaid');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    const where: Record<string, unknown> = {};

    if (employeeId) where.employeeId = employeeId;
    if (isPaid !== null && isPaid !== undefined && isPaid !== '')
      where.isPaid = isPaid === 'true';
    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lt = new Date(to);
      where.date = dateFilter;
    }

    const bonuses = await db.sortingBonus.findMany({
      where,
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        sortingBill: {
          select: {
            id: true,
            sourceWeight: true,
            sourceProduct: { select: { name: true } },
          },
        },
      },
      orderBy: { date: 'desc' },
    });

    // Calculate summaries
    const totalUnpaid = bonuses
      .filter((b) => !b.isPaid)
      .reduce((s, b) => s + b.totalAmount, 0);
    const totalPaid = bonuses
      .filter((b) => b.isPaid)
      .reduce((s, b) => s + b.totalAmount, 0);

    return NextResponse.json({
      bonuses,
      summary: {
        totalUnpaid: Math.round(totalUnpaid * 100) / 100,
        totalPaid: Math.round(totalPaid * 100) / 100,
        totalAll: Math.round((totalUnpaid + totalPaid) * 100) / 100,
      },
    });
  } catch (error) {
    console.error('Error fetching bonuses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch bonuses' },
      { status: 500 }
    );
  }
}

// POST /api/bonuses - Create a sorting bonus
// ST-10: Admin only
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  if (payload.role !== 'admin') return NextResponse.json({ error: 'ต้องเป็นผู้ดูแลระบบ' }, { status: 403 });

  try {
    const body = await request.json();
    const { date, employeeId, sortingBillId, totalWeight, ratePerKg, note } =
      body as {
        date: string;
        employeeId: string;
        sortingBillId?: string;
        totalWeight: number;
        ratePerKg: number;
        note?: string;
      };

    if (!employeeId) {
      return NextResponse.json(
        { error: 'Employee is required' },
        { status: 400 }
      );
    }
    if (!totalWeight || totalWeight <= 0) {
      return NextResponse.json(
        { error: 'Total weight must be greater than 0' },
        { status: 400 }
      );
    }
    // Accept totalAmount directly (new system: bonus from sorting profit)
    // Or calculate from ratePerKg * totalWeight (legacy)
    const totalAmountFromBody = (body as { totalAmount?: number }).totalAmount;
    let totalAmount: number;
    if (totalAmountFromBody !== undefined && totalAmountFromBody > 0) {
      totalAmount = Math.round(totalAmountFromBody * 100) / 100;
    } else if (ratePerKg && ratePerKg > 0) {
      totalAmount = Math.round(totalWeight * ratePerKg * 100) / 100;
    } else {
      return NextResponse.json(
        { error: 'Either totalAmount or ratePerKg must be provided and greater than 0' },
        { status: 400 }
      );
    }

    const bonus = await db.sortingBonus.create({
      data: {
        date: new Date(date),
        employeeId,
        sortingBillId: sortingBillId || null,
        totalWeight,
        ratePerKg,
        totalAmount,
        note: note?.trim() || null,
      },
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        sortingBill: {
          select: {
            id: true,
            sourceWeight: true,
            sourceProduct: { select: { name: true } },
          },
        },
      },
    });

    return NextResponse.json(bonus, { status: 201 });
  } catch (error) {
    console.error('Error creating bonus:', error);
    return NextResponse.json(
      { error: 'Failed to create bonus' },
      { status: 500 }
    );
  }
}
