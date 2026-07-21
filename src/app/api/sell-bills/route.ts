import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { makeSellBillServiceDeps } from '@/lib/bill-service-prisma-adapters';
import {
  createSellBillService,
  DuplicateExistingError,
} from '@/lib/bill-services';
import {
  FifoValidationError,
  InsufficientStockError,
  SourceLotConflictError,
} from '@/lib/bill-errors';

// ST-8: thin adapter — auth → parse → createSellBillService → map errors
// ST-8: makeSellBillServiceDeps imported from @/lib/bill-service-prisma-adapters

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

    const result = await createSellBillService(makeSellBillServiceDeps(), {
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
    if (error instanceof InsufficientStockError) {
      return NextResponse.json({
        error: `สต็อกไม่เพียงพอสำหรับ "${error.productName || error.productId}". มี: ${error.available} kg, ต้องการ: ${error.requested} kg`,
        code: 'INSUFFICIENT_STOCK',
      }, { status: 400 });
    }
    if (error instanceof SourceLotConflictError) {
      return NextResponse.json({
        error: 'สต็อกต้นทางมีการเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่และลองอีกครั้ง',
        code: 'SOURCE_LOT_CONFLICT',
      }, { status: 409 });
    }
    if (error instanceof FifoValidationError) {
      return NextResponse.json({
        error: 'สต็อกต้นทางไม่ผ่านการตรวจสอบต้นทุน กรุณาตรวจสอบสต็อก',
        code: 'FIFO_VALIDATION_ERROR',
      }, { status: 400 });
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
