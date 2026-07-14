import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { hasDailyPurchaseWeighingPermission } from '@/lib/daily-weighing-permission';
import {
  aggregateDailyPurchases,
  isValidWeighingDate,
  isValidWeighingCategory,
  validateWeighingPostInput,
  buildSessionItems,
  type AggregationResult,
} from '@/lib/daily-purchase-weighing';

// GET /api/daily-weighing — list sessions OR aggregate purchases for a date
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอดซื้อ' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  if (action === 'aggregate') {
    const dateStr = searchParams.get('date');
    const category = searchParams.get('category');
    if (!dateStr || !category) {
      return NextResponse.json({ error: 'กรุณาระบุวันที่และหมวดหมู่' }, { status: 400 });
    }
    if (!isValidWeighingDate(dateStr)) {
      return NextResponse.json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' }, { status: 400 });
    }
    if (!isValidWeighingCategory(category)) {
      return NextResponse.json({ error: 'หมวดหมู่ต้องเป็น ทองแดง หรือ ทองเหลือง' }, { status: 400 });
    }

    try {
      const result = await aggregateDailyPurchases(dateStr, category);
      return NextResponse.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'unknown';
      return NextResponse.json({ error: msg }, { status: 400 });
    }
  }

  // Default: list sessions (paginated)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const skip = (page - 1) * limit;

  const [sessions, total] = await Promise.all([
    db.dailyPurchaseWeighingSession.findMany({
      orderBy: { weighingDate: 'desc' },
      skip,
      take: limit,
      include: {
        items: { include: { product: { select: { name: true } } } },
      },
    }),
    db.dailyPurchaseWeighingSession.count(),
  ]);

  return NextResponse.json({ sessions, total });
}

// POST /api/daily-weighing — save a daily weighing session
// ST-35: Server recomputes all aggregation — client sends only actualWeighedWeight + notes
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์บันทึกผลชั่ง' }, { status: 403 });
  }

  try {
    const body = await request.json();

    // Validate input using production validation function
    const validation = validateWeighingPostInput(body);
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }
    const { weighingDate, category, note, items } = validation.input;

    // RECOMPUTE aggregation from BuyBills — DO NOT trust client values
    const aggregation = await aggregateDailyPurchases(weighingDate, category);

    if (aggregation.items.length === 0) {
      return NextResponse.json({ error: `ไม่มีใบซื้อ${category}ของวันที่ ${weighingDate}` }, { status: 400 });
    }

    // Build session items using production builder — server controls all computed fields
    const buildResult = buildSessionItems(aggregation, items);
    if (!buildResult.ok) {
      return NextResponse.json({ error: buildResult.error }, { status: buildResult.status });
    }
    const sessionItems = buildResult.items;

    // Check duplicate session (one per date + category)
    const date = new Date(weighingDate + 'T00:00:00+07:00');
    const existing = await db.dailyPurchaseWeighingSession.findFirst({
      where: { weighingDate: date, category },
    });
    if (existing) {
      return NextResponse.json(
        { error: `มีผลชั่งของวันที่ ${weighingDate} หมวด ${category} อยู่แล้ว — ห้ามบันทึกซ้ำ` },
        { status: 409 }
      );
    }

    // ST-35: Atomic save — session + items + AuditLog in a single $transaction.
    // If AuditLog fails, the entire transaction rolls back — zero session, zero items.
    const session = await db.$transaction(async (tx) => {
      const created = await tx.dailyPurchaseWeighingSession.create({
        data: {
          weighingDate: date,
          category,
          status: 'SAVED',
          note: note || null,
          createdById: payload.userId,
          items: { create: sessionItems },
        },
        include: { items: { include: { product: { select: { name: true } } } } },
      });

      await tx.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'DAILY_WEIGHING',
          entityId: created.id,
          userId: payload.userId,
          userName: payload.name,
          details: JSON.stringify({
            weighingDate: created.weighingDate,
            category: created.category,
            itemCount: created.items.length,
            totalBills: aggregation.totalBills,
            totalPurchasedWeight: aggregation.totalPurchasedWeight,
            note: created.note,
          }),
        },
      });

      return created;
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Error creating daily weighing:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ: ' + message }, { status: 500 });
  }
}
