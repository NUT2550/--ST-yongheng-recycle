import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

// POST /api/credit/[id]/pay - Add a payment to a credit entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json();
    const { amount, date, note } = body as {
      amount: number;
      date: string;
      note?: string;
    };

    if (!amount || amount <= 0) {
      return NextResponse.json(
        { error: 'Payment amount must be greater than 0' },
        { status: 400 }
      );
    }

    // Find the credit entry
    const creditEntry = await db.creditEntry.findUnique({
      where: { id },
    });

    if (!creditEntry) {
      return NextResponse.json(
        { error: 'Credit entry not found' },
        { status: 404 }
      );
    }

    if (creditEntry.isSettled) {
      return NextResponse.json(
        { error: 'Credit entry is already settled' },
        { status: 400 }
      );
    }

    const newPaidAmount = Math.round((creditEntry.paidAmount + amount) * 100) / 100;
    const isSettled = newPaidAmount >= creditEntry.amount;

    // Create payment and update credit entry in a transaction
    const result = await db.$transaction(async (tx) => {
      const payment = await tx.creditPayment.create({
        data: {
          creditEntryId: id,
          amount,
          date: new Date(date),
          note: note || null,
        },
      });

      const updatedEntry = await tx.creditEntry.update({
        where: { id },
        data: {
          paidAmount: newPaidAmount,
          isSettled,
        },
        include: {
          customer: {
            select: { id: true, name: true, phone: true },
          },
          payments: {
            orderBy: { date: 'asc' },
          },
        },
      });

      return { payment, creditEntry: updatedEntry };
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error adding payment:', error);
    return NextResponse.json(
      { error: 'Failed to add payment' },
      { status: 500 }
    );
  }
}
