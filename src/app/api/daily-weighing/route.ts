import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import {
  aggregateDailyPurchases,
  isValidWeighingDate,
  isValidWeighingCategory,
  isValidActualWeighedWeight,
  calculateWeighingStatus,
} from '@/lib/daily-purchase-weighing';

// Permission: Admin OR staff with dailyPurchaseWeighing permission
function hasWeighingPermission(payload: { role: string; permissions?: Record<string, boolean> }): boolean {
  if (payload.role === 'admin') return true;
  return payload.permissions?.['dailyPurchaseWeighing'] === true;
}

// GET /api/daily-weighing — list sessions OR aggregate purchases for a date
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  if (!hasWeighingPermission(payload)) {
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

  if (!hasWeighingPermission(payload)) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์บันทึกผลชั่ง' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { weighingDate, category, note, items } = body as {
      weighingDate: string;
      category: string;
      note?: string;
      // Client sends ONLY these fields per item:
      items: Array<{
        productId: string;
        actualWeighedWeight: number | null;
        note?: string;
      }>;
    };

    // Validate date
    if (!weighingDate || !isValidWeighingDate(weighingDate)) {
      return NextResponse.json({ error: 'รูปแบบวันที่ไม่ถูกต้อง' }, { status: 400 });
    }
    // Validate category
    if (!category || !isValidWeighingCategory(category)) {
      return NextResponse.json({ error: 'หมวดหมู่ต้องเป็น ทองแดง หรือ ทองเหลือง' }, { status: 400 });
    }
    // Validate items
    if (!items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ' }, { status: 400 });
    }

    // Reject duplicate productId in request
    const seenProductIds = new Set<string>();
    for (const item of items) {
      if (!item.productId || typeof item.productId !== 'string') {
        return NextResponse.json({ error: 'รายการต้องมี productId' }, { status: 400 });
      }
      if (seenProductIds.has(item.productId)) {
        return NextResponse.json({ error: `productId ซ้ำ: ${item.productId}` }, { status: 400 });
      }
      seenProductIds.add(item.productId);

      // Validate actualWeighedWeight — null/undefined/0/positive are valid; negative/NaN/Infinity are not
      if (!isValidActualWeighedWeight(item.actualWeighedWeight)) {
        return NextResponse.json({ error: `น้ำหนักชั่งจริงไม่ถูกต้องสำหรับ productId: ${item.productId}` }, { status: 400 });
      }
    }

    // RECOMPUTE aggregation from BuyBills — DO NOT trust client values
    const aggregation = await aggregateDailyPurchases(weighingDate, category);

    if (aggregation.items.length === 0) {
      return NextResponse.json({ error: `ไม่มีใบซื้อ${category}ของวันที่ ${weighingDate}` }, { status: 400 });
    }

    // Build map of valid products from server aggregation
    const validProducts = new Map(aggregation.items.map(item => [item.productId, item]));

    // Block productIds that don't have purchase bills
    for (const item of items) {
      if (!validProducts.has(item.productId)) {
        return NextResponse.json({ error: `สินค้า ${item.productId} ไม่มียอดซื้อในวันที่และหมวดที่เลือก` }, { status: 400 });
      }
    }

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

    // Build session items — SERVER controls all fields except actualWeighedWeight + note
    const sessionItems = items.map(item => {
      const agg = validProducts.get(item.productId)!;
      const actual = item.actualWeighedWeight ?? null;
      const { difference, status } = calculateWeighingStatus(actual, agg.purchasedWeight);

      return {
        productId: item.productId,
        purchasedWeight: agg.purchasedWeight,       // server-computed
        purchaseBillCount: agg.purchaseBillCount,    // server-computed
        actualWeighedWeight: actual,
        differenceWeight: difference,                // server-computed
        status,                                      // server-computed
        note: item.note || null,
      };
    });

    // ST-35: Atomic save — session + items + AuditLog in a single $transaction.
    // $transaction is supported on Production Supabase (verified: buy-bills, sell-bills,
    // stock-transfers all use it). If AuditLog fails, the entire transaction rolls back,
    // leaving zero session, zero items, zero partial data.
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

      // AuditLog — if this throws, the entire transaction rolls back
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
