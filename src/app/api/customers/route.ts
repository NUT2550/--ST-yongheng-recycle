import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { hasPermission } from '@/lib/permissions';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/customers - List all customers
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  try {
    const customers = await db.customer.findMany({
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: { sellBills: true, creditEntry: true },
        },
      },
    });

    return NextResponse.json({ customers });
  } catch (error) {
    console.error('Error fetching customers:', error);
    return NextResponse.json(
      { error: 'Failed to fetch customers' },
      { status: 500 }
    );
  }
}

// POST /api/customers - Create a customer
// ST-10: Requires login + customer.create permission (admin always allowed)
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  if (!hasPermission(payload, 'customer.create')) return NextResponse.json({ error: 'ไม่มีสิทธิ์สร้างลูกค้า' }, { status: 403 });

  try {
    const body = await request.json();
    const { name, phone } = body as { name: string; phone?: string };

    if (!name || name.trim() === '') {
      return NextResponse.json(
        { error: 'Customer name is required' },
        { status: 400 }
      );
    }

    const customer = await db.customer.create({
      data: {
        name: name.trim(),
        phone: phone?.trim() || null,
      },
    });

    return NextResponse.json({ customer }, { status: 201 });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}
