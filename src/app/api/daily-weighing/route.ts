import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { PrismaDailyPurchaseWeighingRepository } from '@/lib/daily-weighing-prisma-adapter';
import {
  getAggregationController,
  getHistoryController,
  postSaveController,
  type AuthPayload,
} from '@/lib/daily-weighing-controller';

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
    const result = await postSaveController(repo, authPayload, body);
    return NextResponse.json(result.data, { status: result.status });
  } catch (error) {
    console.error('Error creating daily weighing:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ: ' + message }, { status: 500 });
  }
}
