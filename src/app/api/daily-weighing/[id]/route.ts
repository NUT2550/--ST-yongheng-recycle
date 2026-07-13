import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

// GET /api/daily-weighing/[id] — get a single session
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  const { id } = await params;
  const session = await db.dailyPurchaseWeighingSession.findUnique({
    where: { id },
    include: {
      items: { include: { product: { select: { id: true, name: true } } } },
    },
  });

  if (!session) {
    return NextResponse.json({ error: 'ไม่พบรายการ' }, { status: 404 });
  }

  return NextResponse.json({ session });
}
