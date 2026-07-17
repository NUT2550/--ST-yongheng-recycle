import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber } from '@/lib/bill-helpers';
import { hasPermission } from '@/lib/permissions';
import {
  createSellBillService,
  DuplicateExistingError,
  FIFO_ORDER_BY,
  type SellBillCreatedBill,
  type SellBillTx,
} from '@/lib/bill-services';

// ============================================================================
// Production deps for createSellBillService — adapts the real Prisma tx
// to the service's SellBillTx interface. The route handler is a thin
// adapter: auth -> parse -> call service -> map errors to responses.
// ============================================================================

function makeSellBillDeps() {
  return {
    checkStockAvailability: async (items: Array<{ productId: string; weight: number }>) => {
      for (const item of items) {
        const lots = await db.stockLot.findMany({
          where: {
            productId: item.productId,
            remainingWeight: { gt: 0 },
          },
          orderBy: FIFO_ORDER_BY,
        });
        const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeight, 0);
        if (totalAvailable < item.weight) {
          const product = await db.product.findUnique({
            where: { id: item.productId },
            select: { name: true },
          });
          return {
            ok: false as const,
            productId: item.productId,
            productName: product?.name,
            available: totalAvailable,
            requested: item.weight,
          };
        }
      }
      return { ok: true as const };
    },
    generateBillNumber: () => generateBillNumber(db, 'SELL'),
    transaction: <T>(fn: (tx: SellBillTx<SellBillCreatedBill>) => Promise<T>): Promise<T> =>
      db.$transaction(async (prismaTx) => {
        const adaptedTx: SellBillTx = {
          createSellBill: (args) =>
            prismaTx.sellBill.create({
              ...args,
              include: {
                items: { include: { product: true } },
                customer: true,
              },
            }) as Promise<SellBillCreatedBill>,
          findSourceLots: (productId) =>
            prismaTx.stockLot.findMany({
              where: { productId, remainingWeight: { gt: 0 } },
              orderBy: FIFO_ORDER_BY,
            }) as Promise<
              Array<{
                id: string;
                remainingWeight: number;
                costPerKg: number;
                dateAdded: Date;
                createdAt: Date;
              }>
            >,
          updateStockLotRemaining: (id, newRemaining) =>
            prismaTx.stockLot.update({
              where: { id },
              data: { remainingWeight: newRemaining },
            }),
          createCreditEntry: (data) => prismaTx.creditEntry.create({ data }),
          createAuditLog: (data) => prismaTx.auditLog.create({ data }),
        };
        return fn(adaptedTx);
      }),
  };
}

// POST /api/sell-bills - Create a sell bill (thin adapter over createSellBillService)
export async function POST(request: NextRequest) {
  // --- Auth ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  // ST-8 Blocker 1: type-specific authorization via shared hasPermission.
  if (!hasPermission(payload, 'sell.create')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { date, customerId, isCredit, note, items } = body as {
      date: string;
      customerId?: string;
      isCredit: boolean;
      note?: string;
      items: Array<{
        productId: string;
        weight: number;
        weightExpression?: string;
        pricePerKg: number;
      }>;
    };

    const result = await createSellBillService(makeSellBillDeps(), {
      date,
      customerId,
      isCredit,
      note,
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
    const message = error instanceof Error ? error.message : 'Failed to create sell bill';
    console.error('Error creating sell bill:', error);

    if (message.includes('Insufficient stock') || message.includes('สต็อกไม่เพียงพอ')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    // ST-20 Phase 2: Surface FIFO validation errors with proper codes
    if (
      message.includes('NEGATIVE_COST_SOURCE_LOT') ||
      message.includes('ZERO_COST_SOURCE_LOT') ||
      message.includes('ZERO_SOURCE_COST') ||
      message.includes('ต้นทุน 0 บาท/กก.') ||
      message.includes('ต้นทุนถัวเฉลี่ยของสต็อกต้นทางเป็น 0')
    ) {
      return NextResponse.json(
        { error: message, code: 'FIFO_VALIDATION_ERROR' },
        { status: 400 }
      );
    }

    // Validation errors -> 400
    if (
      message.includes('น้ำหนักต้องมากกว่า 0') ||
      message.includes('ราคา/กก. ต้องไม่ติดลบ') ||
      message.includes('วันที่ไม่ถูกต้อง') ||
      message === 'Items are required'
    ) {
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
  // --- Auth: any authenticated user ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    // Pagination clamp: page min 1, limit min 1 max 100
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    // By default hide cancelled bills. Pass ?includeCancelled=true to include them.
    const includeCancelled = searchParams.get('includeCancelled') === 'true';
    const where = includeCancelled ? {} : { isCancelled: false };

    const [bills, total] = await Promise.all([
      db.sellBill.findMany({
        where,
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
      db.sellBill.count({ where }),
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
