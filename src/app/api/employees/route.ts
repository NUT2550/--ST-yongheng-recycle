import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { isAdmin } from '@/lib/permissions';
import { employeeController, type EmployeeDeps } from '@/lib/route-controllers';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/employees - List all employees
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  try {
    const employees = await db.employee.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
    return NextResponse.json(employees);
  } catch (error) {
    console.error('Error fetching employees:', error);
    return NextResponse.json(
      { error: 'Failed to fetch employees' },
      { status: 500 }
    );
  }
}

// POST /api/employees - Create a new employee
// ST-10: Admin only. The route is a thin adapter: auth → controller → response.
// The controller owns authorization (isAdmin) + validation + DB access.
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  if (!isAdmin(payload)) return NextResponse.json({ error: 'ต้องเป็นผู้ดูแลระบบ' }, { status: 403 });

  try {
    const body = await request.json();
    const deps: EmployeeDeps = {
      createEmployee: (data) =>
        db.employee.create({ data }) as unknown as Promise<unknown>,
    };
    const result = await employeeController(deps, body, payload);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Error creating employee:', error);
    return NextResponse.json(
      { error: 'Failed to create employee' },
      { status: 500 }
    );
  }
}
