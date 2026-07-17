import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber } from '@/lib/bill-helpers';
import { hasPermission } from '@/lib/permissions';
import {
  createBuyBillService,
  DuplicateExistingError,
  type BuyBillCreatedBill,
  type BuyBillTx,
} from '@/lib/bill-services';

// ============================================================================
// Production deps for createBuyBillService — adapts the real Prisma tx
// to the service's BuyBillTx interface. The route handler is a thin
// adapter: auth -> parse -> call service -> map errors to responses.
// ============================================================================

function makeBuyBillDeps() {
  return {
    generateBillNumber: () => generateBillNumber(db, 'BUY'),
    transaction: <T>(fn: (tx: BuyBillTx<BuyBillCreatedBill>) => Promise<T>): Promise<T> =>
      db.$transaction(async (prismaTx) => {
        const adaptedTx: BuyBillTx = {
          createBuyBill: (args) =>
            prismaTx.buyBill.create({
              ...args,
              include: { items: { include: { product: true } } },
            }) as Promise<BuyBillCreatedBill>,
          createStockLots: (data) => prismaTx.stockLot.createMany({ data }),
          createCreditEntry: (data) => prismaTx.creditEntry.create({ data }),
          createAuditLog: (data) => prismaTx.auditLog.create({ data }),
        };
        return fn(adaptedTx);
      }),
  };
}

// POST /api/buy-bills - Create a buy bill (thin adapter over createBuyBillService)
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  // ST-8 Blocker 1: type-specific authorization via shared hasPermission.
  if (!hasPermission(payload, 'buy.create')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { date, isCredit, note, externalBillNumber, items } = body as {
      date: string;
      isCredit: boolean;
      note?: string;
      externalBillNumber?: string;
      items: Array<{
        productId: string;
        weight: number;
        weightExpression?: string;
        pricePerKg: number;
      }>;
    };

    // Check for duplicate externalBillNumber if provided (UX: 409 before bill number generation).
    if (externalBillNumber && externalBillNumber.trim()) {
      const existing = await db.buyBill.findFirst({
        where: { externalBillNumber: externalBillNumber.trim() },
        select: { id: true, billNumber: true },
      });
      if (existing) {
        return NextResponse.json(
          { error: `เลขบิล "${externalBillNumber.trim()}" ถูกนำเข้าแล้ว (bill ${existing.billNumber || existing.id})` },
          { status: 409 }
        );
      }
    }

    const result = await createBuyBillService(makeBuyBillDeps(), {
      date,
      isCredit,
      note,
      externalBillNumber,
      items,
    }, payload);

    return NextResponse.json({ bill: result.bill }, { status: 201 });
  } catch (error) {
    if (error instanceof DuplicateExistingError) {
      return NextResponse.json(
        { error: 'เลขบิลซ้ำ — กรุณาลองอีกครั้ง' },
        { status: 409 }
      );
    }
    const message = error instanceof Error ? error.message : 'Failed to create buy bill';
    console.error('Error creating buy bill:', error);

    // Validation errors -> 400
    if (
      message.includes('น้ำหนักต้องมากกว่า 0') ||
      message.includes('ราคา/กก. ต้องไม่ติดลบ') ||
      message.includes('วันที่ไม่ถูกต้อง') ||
      message === 'Items are required'
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

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
