import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { hasDailyPurchaseWeighingPermission } from '@/lib/daily-weighing-permission';
import { PrismaDailyPurchaseWeighingRepository } from '@/lib/daily-weighing-prisma-adapter';
import { getDailyWeighingDetail } from '@/lib/daily-purchase-weighing-service';

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

  if (!hasDailyPurchaseWeighingPermission(payload)) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ใช้งานการชั่งยอดซื้อ' }, { status: 403 });
  }

  const { id } = await params;
  const session = await getDailyWeighingDetail(repo, id);

  if (!session) {
    return NextResponse.json({ error: 'ไม่พบรายการ' }, { status: 404 });
  }

  return NextResponse.json({ session });
}
