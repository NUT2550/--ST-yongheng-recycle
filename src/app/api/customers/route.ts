import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { hasPermission } from '@/lib/permissions';
import { customerController, type CustomerDeps } from '@/lib/route-controllers';
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
// ST-10: Requires login + customer.create permission (admin always allowed).
// The route is a thin adapter: auth → controller → response.
// The controller owns authorization (hasPermission) + validation + DB access.
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });

  try {
    const body = await request.json();
    const deps: CustomerDeps = {
      createCustomer: (data) =>
        db.customer.create({ data }) as unknown as Promise<unknown>,
    };
    const result = await customerController(deps, body, payload);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error creating customer:', error);
    return NextResponse.json(
      { error: 'Failed to create customer' },
      { status: 500 }
    );
  }
}
