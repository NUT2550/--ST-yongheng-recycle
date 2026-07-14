import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { hasDailyPurchaseWeighingPermission } from '@/lib/daily-weighing-permission';
import { PrismaDailyPurchaseWeighingRepository } from '@/lib/daily-weighing-prisma-adapter';
import {
  aggregateDailyPurchasesWithRepository,
  saveDailyPurchaseWeighing,
  getDailyWeighingHistory,
} from '@/lib/daily-purchase-weighing-service';
import { isValidWeighingDate, isValidWeighingCategory } from '@/lib/daily-purchase-weighing';

const repo = new PrismaDailyPurchaseWeighingRepository();

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
      const result = await aggregateDailyPurchasesWithRepository(repo, dateStr, category);
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

  const { sessions, total } = await getDailyWeighingHistory(repo, skip, limit);
  return NextResponse.json({ sessions, total });
}

// POST /api/daily-weighing — save a daily weighing session
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
    const result = await saveDailyPurchaseWeighing(repo, body, payload.userId, payload.name);

    if (result.success) {
      return NextResponse.json({ session: result.session }, { status: 201 });
    } else {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
  } catch (error) {
    console.error('Error creating daily weighing:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ: ' + message }, { status: 500 });
  }
}
