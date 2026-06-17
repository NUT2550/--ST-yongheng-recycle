import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/employees - List all employees
export async function GET() {
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
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, phone, hireDate } = body as {
      name: string;
      phone?: string;
      hireDate?: string;
    };

    if (!name || !name.trim()) {
      return NextResponse.json(
        { error: 'Employee name is required' },
        { status: 400 }
      );
    }

    const employee = await db.employee.create({
      data: {
        name: name.trim(),
        phone: phone?.trim() || null,
        hireDate: hireDate ? new Date(hireDate) : null,
      },
    });

    return NextResponse.json(employee, { status: 201 });
  } catch (error) {
    console.error('Error creating employee:', error);
    return NextResponse.json(
      { error: 'Failed to create employee' },
      { status: 500 }
    );
  }
}
