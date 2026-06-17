import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// GET /api/customers - List all customers
export async function GET() {
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
export async function POST(request: NextRequest) {
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
