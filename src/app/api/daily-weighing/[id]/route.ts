import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { PrismaDailyPurchaseWeighingRepository } from '@/lib/daily-weighing-prisma-adapter';
import { getDetailController, type AuthPayload } from '@/lib/daily-weighing-controller';

const repo = new PrismaDailyPurchaseWeighingRepository();

// GET /api/daily-weighing/[id] — get a single session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

  const { id } = await params;
  const result = await getDetailController(repo, authPayload, id);
  return NextResponse.json(result.data, { status: result.status });
}
