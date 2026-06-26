import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { NextRequest, NextResponse } from 'next/server';

// GET /api/credit - List credit entries with filters
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type'); // RECEIVABLE or PAYABLE
    const isSettled = searchParams.get('isSettled'); // 'true' or 'false'
    const customerId = searchParams.get('customerId');

    const where: Record<string, unknown> = {};

    if (type) {
      where.type = type;
    }

    if (isSettled !== null && isSettled !== undefined && isSettled !== '') {
      where.isSettled = isSettled === 'true';
    }

    if (customerId) {
      where.customerId = customerId;
    }

    const entries = await db.creditEntry.findMany({
      where,
      include: {
        customer: {
          select: { id: true, name: true, phone: true },
        },
        payments: {
          orderBy: { date: 'asc' },
        },
      },
      orderBy: { date: 'desc' },
    });

    return NextResponse.json({ entries });
  } catch (error) {
    console.error('Error fetching credit entries:', error);
    return NextResponse.json(
      { error: 'Failed to fetch credit entries' },
      { status: 500 }
    );
  }
}
