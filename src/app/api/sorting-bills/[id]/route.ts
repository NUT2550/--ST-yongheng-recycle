import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import {
  cancelSortingBill,
  mapSortingCancellationError,
  type SortingCancellationDb,
} from '@/lib/sorting-cancellation-service';

async function requireEditPermission(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const hasPermission = payload.role === 'admin' || payload.permissions?.['history.edit'] === true;
  return hasPermission ? payload : null;
}

// GET /api/sorting-bills/[id]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { id } = await params;
    const bill = await db.sortingBill.findUnique({
      where: { id },
      include: {
        sourceProduct: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!bill) return NextResponse.json({ error: 'ไม่พบใบคัดแยก' }, { status: 404 });
    return NextResponse.json({ bill });
  } catch (error) {
    console.error('Error fetching sorting bill:', error);
    return NextResponse.json({ error: 'Failed to fetch sorting bill' }, { status: 500 });
  }
}

// PATCH /api/sorting-bills/[id] — Edit sorting bill (price only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditPermission(request);
  if (!auth) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์แก้ไขบิล — ต้องการสิทธิ์ history.edit' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { date, note, roomNumber, items } = body as {
      date?: string;
      note?: string | null;
      roomNumber?: string | null;
      items?: Array<{ id: string; sortedPricePerKg: number }>;
    };

    const existing = await db.sortingBill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) return NextResponse.json({ error: 'ไม่พบใบคัดแยก' }, { status: 404 });
    if (existing.isCancelled) return NextResponse.json({ error: 'บิลนี้ถูกยกเลิกแล้ว' }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      // Update items (only sortedPricePerKg + recompute bonus)
      if (items && items.length > 0) {
        const existingMap = new Map(existing.items.map((i) => [i.id, i]));
        for (const item of items) {
          const oldItem = existingMap.get(item.id);
          if (!oldItem) continue;
          if (oldItem.isWaste) continue;
          const bonusAmount = Math.round(
            (item.sortedPricePerKg - existing.sourcePricePerKg) * oldItem.weight * 0.1 * 100
          ) / 100;
          await tx.sortingBillItem.update({
            where: { id: item.id },
            data: { sortedPricePerKg: item.sortedPricePerKg, bonusAmount: Math.max(0, bonusAmount) },
          });
        }
      }

      const updatedBill = await tx.sortingBill.update({
        where: { id: existing.id },
        data: {
          date: date ? new Date(date) : undefined,
          note: note === null ? null : note || undefined,
          roomNumber: roomNumber === undefined ? undefined : (roomNumber === null ? null : roomNumber.trim() || null),
        },
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
      });

      // Audit log
      const priceChanges: Array<{ itemId: string; oldPrice: number; newPrice: number }> = [];
      if (items && items.length > 0) {
        const existingMap = new Map(existing.items.map((i) => [i.id, i]));
        for (const item of items) {
          const oldItem = existingMap.get(item.id);
          if (oldItem && !oldItem.isWaste && oldItem.sortedPricePerKg !== item.sortedPricePerKg) {
            priceChanges.push({ itemId: item.id, oldPrice: oldItem.sortedPricePerKg, newPrice: item.sortedPricePerKg });
          }
        }
      }
      await tx.auditLog.create({
        data: {
          action: 'UPDATE', entityType: 'SORTING_BILL', entityId: existing.id,
          userId: auth.userId, userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber, priceChanges,
            billFieldsChanged: { date: date !== undefined, note: note !== undefined },
          }),
        },
      });

      return updatedBill;
    });

    return NextResponse.json({ bill: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update sorting bill';
    console.error('Error updating sorting bill:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/sorting-bills/[id] — Cancel sorting bill (soft delete + restore source stock)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditPermission(request);
  if (!auth) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์ — ต้องการสิทธิ์ history.edit' }, { status: 403 });
  }

  try {
    const { id } = await params;
    let reason = '';
    try { const body = await request.json(); reason = (body?.reason || '').toString().trim(); } catch {}

    await cancelSortingBill(db as unknown as SortingCancellationDb, {
      id,
      reason,
      auth: { userId: auth.userId, name: auth.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error cancelling sorting bill:', error);
    const mapped = mapSortingCancellationError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
