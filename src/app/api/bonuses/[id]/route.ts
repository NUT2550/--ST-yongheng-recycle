import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';

// PATCH /api/bonuses/[id] - Update a bonus (mark as paid, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { isPaid, paidDate, note } = body as {
      isPaid?: boolean;
      paidDate?: string;
      note?: string;
    };

    const bonus = await db.sortingBonus.findUnique({ where: { id } });
    if (!bonus) {
      return NextResponse.json(
        { error: 'Bonus not found' },
        { status: 404 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (isPaid !== undefined) {
      updateData.isPaid = isPaid;
      updateData.paidDate = isPaid ? new Date(paidDate || new Date()) : null;
    }
    if (note !== undefined) {
      updateData.note = note?.trim() || null;
    }

    const updated = await db.sortingBonus.update({
      where: { id },
      data: updateData,
      include: {
        employee: { select: { id: true, name: true, phone: true } },
        sortingBill: {
          select: {
            id: true,
            sourceWeight: true,
            sourceProduct: { select: { name: true } },
          },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error('Error updating bonus:', error);
    return NextResponse.json(
      { error: 'Failed to update bonus' },
      { status: 500 }
    );
  }
}

// DELETE /api/bonuses/[id] - Delete a bonus
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const bonus = await db.sortingBonus.findUnique({ where: { id } });
    if (!bonus) {
      return NextResponse.json(
        { error: 'Bonus not found' },
        { status: 404 }
      );
    }

    await db.sortingBonus.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting bonus:', error);
    return NextResponse.json(
      { error: 'Failed to delete bonus' },
      { status: 500 }
    );
  }
}
