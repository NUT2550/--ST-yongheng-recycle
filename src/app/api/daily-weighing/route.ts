import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { PrismaDailyPurchaseWeighingRepository } from '@/lib/daily-weighing-prisma-adapter';
import {
  getAggregationController,
  getHistoryController,
  postSaveController,
  type AuthPayload,
} from '@/lib/daily-weighing-controller';
import { getExpectedClosingStock, getDailyMovements } from '@/lib/stock-ledger-read-service';
import { hasDailyPurchaseWeighingPermission } from '@/lib/daily-weighing-permission';

const repo = new PrismaDailyPurchaseWeighingRepository();

// GET /api/daily-weighing — list sessions OR aggregate purchases for a date
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  const authPayload: AuthPayload = {
    userId: payload.userId,
    name: payload.name,
    role: payload.role,
    permissions: payload.permissions,
  };

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  if (action === 'closing-stock') {
    if (!hasDailyPurchaseWeighingPermission(authPayload)) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอด' }, { status: 403 });
    }
    const dateStr = searchParams.get('date');
    const category = searchParams.get('category');
    if (!dateStr || !category) return NextResponse.json({ error: 'กรุณาระบุวันที่และหมวดหมู่' }, { status: 400 });
    try {
      return NextResponse.json(await getExpectedClosingStock(dateStr, category));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'unknown' }, { status: 400 });
    }
  }

  // ST-53: daily-only movements (selected-day only, no opening/baseline/cumulative)
  if (action === 'daily-movements') {
    if (!hasDailyPurchaseWeighingPermission(authPayload)) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอด' }, { status: 403 });
    }
    const dateStr = searchParams.get('date');
    const category = searchParams.get('category') || undefined;
    if (!dateStr) return NextResponse.json({ error: 'กรุณาระบุวันที่' }, { status: 400 });
    try {
      return NextResponse.json(await getDailyMovements(dateStr, category));
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : 'unknown' }, { status: 400 });
    }
  }

  if (action === 'aggregate') {
    const dateStr = searchParams.get('date');
    const category = searchParams.get('category');
    const result = await getAggregationController(repo, authPayload, dateStr, category);
    return NextResponse.json(result.data, { status: result.status });
  }

  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const result = await getHistoryController(repo, authPayload, page, limit);
  return NextResponse.json(result.data, { status: result.status });
}

// POST /api/daily-weighing — save a daily weighing session
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  const authPayload: AuthPayload = {
    userId: payload.userId,
    name: payload.name,
    role: payload.role,
    permissions: payload.permissions,
  };

  try {
    const body = await request.json();
    const input = body as { weighingDate?: string; category?: string };
    if (!input.weighingDate || !input.category) {
      const result = await postSaveController(repo, authPayload, body);
      return NextResponse.json(result.data, { status: result.status });
    }
    const closing = await getExpectedClosingStock(input.weighingDate, input.category);
    if (closing.baselineStatus !== 'APPROVED') {
      return NextResponse.json({ error: 'ต้องมีฐานสต็อกที่ Owner อนุมัติก่อนบันทึกผลเปรียบเทียบ' }, { status: 409 });
    }
    const notStarted = closing.items.filter(item => item.state === 'NOT_STARTED')
    if (notStarted.length > 0) {
      return NextResponse.json({ error: `ยังไม่ถึงวันเริ่มนับสต็อก: ${notStarted.map(item => item.productName).join(', ')}` }, { status: 409 });
    }
    const aggregation = {
      date: input.weighingDate,
      category: input.category,
      totalBills: closing.items.reduce((sum, item) => sum + item.movementCount, 0),
      productCount: closing.items.length,
      totalPurchaseWeight: closing.items.reduce((sum, item) => sum + item.purchaseInWeight, 0),
      totalSortingWeight: closing.items.reduce((sum, item) => sum + item.sortingOutputInWeight, 0),
      totalDismantlingWeight: closing.items.reduce((sum, item) => sum + item.transferOutputInWeight, 0),
      totalExpectedWeight: closing.items.reduce((sum, item) => sum + (item.expectedClosingWeight ?? 0), 0),
      items: closing.items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        purchaseWeight: item.purchaseInWeight,
        purchaseBillCount: item.movementCounts.PURCHASE_IN || 0,
        sortingOutputWeight: item.sortingOutputInWeight,
        sortingBillCount: item.movementCounts.SORTING_OUTPUT_IN || 0,
        dismantlingOutputWeight: item.transferOutputInWeight,
        dismantlingRecordCount: item.movementCounts.TRANSFER_OUTPUT_IN || 0,
        expectedTotalWeight: item.expectedClosingWeight ?? 0,
        totalAmount: 0,
      })),
    };
    const result = await postSaveController(repo, authPayload, body, aggregation);
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    console.error('Error creating daily weighing:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ: ' + message }, { status: 500 });
  }
}
