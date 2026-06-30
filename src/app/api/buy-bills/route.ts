import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';
import { isRealFormula } from '@/lib/safe-math';

// POST /api/buy-bills - Create a buy bill
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  const hasPermission = payload.role === 'admin' || payload.permissions?.['buy.create'] === true;
  if (!hasPermission) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });

  try {
    const body = await request.json();
    const { date, isCredit, note, items } = body as {
      date: string;
      isCredit: boolean;
      note?: string;
      items: Array<{
        productId: string;
        weight: number;
        weightExpression?: string;
        pricePerKg: number;
      }>;
    };

    if (!items || items.length === 0) {
      return NextResponse.json({ error: 'Items are required' }, { status: 400 });
    }

    // Server-side validation
    for (const item of items) {
      if (typeof item.weight !== 'number' || item.weight <= 0) {
        return NextResponse.json({ error: 'น้ำหนักต้องมากกว่า 0' }, { status: 400 });
      }
      if (typeof item.pricePerKg !== 'number' || item.pricePerKg < 0) {
        return NextResponse.json({ error: 'ราคา/กก. ต้องไม่ติดลบ' }, { status: 400 });
      }
    }

    let totalAmount = 0;
    const billItems = items.map((item) => {
      const itemTotal = item.weight * item.pricePerKg;
      totalAmount += itemTotal;
      return {
        productId: item.productId,
        weight: item.weight,
        // เก็บ expression เฉพาะกรณีที่เป็นจริง (isRealFormula) — plain number เก็บ null
        weightExpression: isRealFormula(item.weightExpression)
          ? item.weightExpression!.trim()
          : null,
        pricePerKg: item.pricePerKg,
        totalAmount: Math.round(itemTotal * 100) / 100,
      };
    });
    totalAmount = Math.round(totalAmount * 100) / 100;

    const bill = await db.$transaction(async (tx) => {
      const billNumber = await generateBillNumber(tx, 'BUY');
      const created = await tx.buyBill.create({
        data: {
          billNumber,
          date: new Date(date),
          isCredit,
          note: note || null,
          totalAmount,
          items: { create: billItems },
        },
        include: { items: { include: { product: true } } },
      });

      await tx.stockLot.createMany({
        data: created.items.map((item) => ({
          productId: item.productId,
          remainingWeight: item.weight,
          costPerKg: item.pricePerKg,
          dateAdded: new Date(date),
          source: 'BUY',
          sourceId: created.id,
        })),
      });

      if (isCredit) {
        await tx.creditEntry.create({
          data: {
            type: 'PAYABLE',
            amount: totalAmount,
            paidAmount: 0,
            referenceType: 'BUY_BILL',
            referenceId: created.id,
            description: `ใบซื้อ ${billNumber}`,
            date: new Date(date),
            isSettled: false,
          },
        });
      }

      await writeAuditLog(tx, {
        action: 'CREATE',
        entityType: 'BUY_BILL',
        entityId: created.id,
        userId: payload.userId,
        userName: payload.name,
        details: JSON.stringify({ billNumber, totalAmount, itemCount: created.items.length, isCredit }),
      });

      return created;
    });

    return NextResponse.json({ bill }, { status: 201 });
  } catch (error) {
    console.error('Error creating buy bill:', error);
    return NextResponse.json({ error: 'Failed to create buy bill' }, { status: 500 });
  }
}

// GET /api/buy-bills - List buy bills with pagination
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
    const where = includeCancelled ? {} : { isCancelled: false };

    const [bills, total] = await Promise.all([
      db.buyBill.findMany({
        where,
        include: {
          items: {
            include: { product: { select: { id: true, name: true } } },
          },
        },
        orderBy: { date: 'desc' },
        skip,
        take: limit,
      }),
      db.buyBill.count({ where }),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching buy bills:', error);
    return NextResponse.json({ error: 'Failed to fetch buy bills' }, { status: 500 });
  }
}
