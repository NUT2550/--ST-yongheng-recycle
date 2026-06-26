import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

async function requireEditPermission(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const hasPermission = payload.role === 'admin' || payload.permissions?.['history.edit'] === true;
  return hasPermission ? payload : null;
}

// GET /api/sell-bills/[id]
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
    const bill = await db.sellBill.findUnique({
      where: { id },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
        customer: { select: { id: true, name: true, phone: true } },
      },
    });
    if (!bill) return NextResponse.json({ error: 'ไม่พบใบขาย' }, { status: 404 });
    return NextResponse.json({ bill });
  } catch (error) {
    console.error('Error fetching sell bill:', error);
    return NextResponse.json({ error: 'Failed to fetch sell bill' }, { status: 500 });
  }
}

// PATCH /api/sell-bills/[id] — Edit sell bill (price only)
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
    const { date, isCredit, note, customerId, items } = body as {
      date?: string;
      isCredit?: boolean;
      note?: string | null;
      customerId?: string | null;
      items?: Array<{ id: string; pricePerKg: number }>;
    };

    const existing = await db.sellBill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) return NextResponse.json({ error: 'ไม่พบใบขาย' }, { status: 404 });
    if (existing.isCancelled) return NextResponse.json({ error: 'บิลนี้ถูกยกเลิกแล้ว' }, { status: 400 });

    const result = await db.$transaction(async (tx) => {
      let totalAmount = 0;

      if (items && items.length > 0) {
        const existingMap = new Map(existing.items.map((i) => [i.id, i]));
        for (const item of items) {
          const oldItem = existingMap.get(item.id);
          if (!oldItem) continue;
          const newTotal = Math.round(oldItem.weight * item.pricePerKg * 100) / 100;
          totalAmount += newTotal;
          await tx.sellBillItem.update({
            where: { id: item.id },
            data: { pricePerKg: item.pricePerKg, totalAmount: newTotal },
          });
        }
      } else {
        for (const item of existing.items) totalAmount += item.totalAmount;
      }
      totalAmount = Math.round(totalAmount * 100) / 100;

      const updatedBill = await tx.sellBill.update({
        where: { id: existing.id },
        data: {
          date: date ? new Date(date) : undefined,
          isCredit: typeof isCredit === 'boolean' ? isCredit : undefined,
          note: note === null ? null : note || undefined,
          customerId: customerId === null ? null : customerId || undefined,
          totalAmount,
        },
        include: { items: { include: { product: { select: { id: true, name: true } } } }, customer: { select: { id: true, name: true, phone: true } } },
      });

      // Handle CreditEntry
      const existingCredit = await tx.creditEntry.findFirst({
        where: { referenceType: 'SELL_BILL', referenceId: existing.id },
      });
      if (isCredit === true && !existingCredit) {
        await tx.creditEntry.create({
          data: {
            type: 'RECEIVABLE', amount: totalAmount, paidAmount: 0,
            customerId: customerId || existing.customerId || null,
            referenceType: 'SELL_BILL', referenceId: existing.id,
            description: `ใบขาย ${existing.billNumber || existing.id}`,
            date: new Date(date || existing.date), isSettled: false,
          },
        });
      } else if (isCredit === false && existingCredit) {
        if (existingCredit.paidAmount > 0) throw new Error('ไม่สามารถเปลี่ยนจากเครดิตเป็นสดได้ เนื่องจากมีการชำระบางส่วนแล้ว');
        await tx.creditEntry.delete({ where: { id: existingCredit.id } });
      } else if (isCredit === true && existingCredit) {
        await tx.creditEntry.update({
          where: { id: existingCredit.id },
          data: { amount: totalAmount, isSettled: existingCredit.paidAmount >= totalAmount },
        });
      }

      // Audit log
      const priceChanges: Array<{ itemId: string; oldPrice: number; newPrice: number }> = [];
      if (items && items.length > 0) {
        const existingMap = new Map(existing.items.map((i) => [i.id, i]));
        for (const item of items) {
          const oldItem = existingMap.get(item.id);
          if (oldItem && oldItem.pricePerKg !== item.pricePerKg) {
            priceChanges.push({ itemId: item.id, oldPrice: oldItem.pricePerKg, newPrice: item.pricePerKg });
          }
        }
      }
      await tx.auditLog.create({
        data: {
          action: 'UPDATE', entityType: 'SELL_BILL', entityId: existing.id,
          userId: auth.userId, userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber, priceChanges,
            billFieldsChanged: { date: date !== undefined, isCredit: isCredit !== undefined, note: note !== undefined, customerId: customerId !== undefined },
            newTotalAmount: totalAmount,
          }),
        },
      });

      return updatedBill;
    });

    return NextResponse.json({ bill: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update sell bill';
    console.error('Error updating sell bill:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/sell-bills/[id] — Cancel sell bill (soft delete + stock restore)
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
    const existing = await db.sellBill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) return NextResponse.json({ error: 'ไม่พบใบขาย' }, { status: 404 });
    if (existing.isCancelled) return NextResponse.json({ error: 'ใบขายนี้ถูกยกเลิกไปแล้ว' }, { status: 400 });

    let reason = '';
    try { const body = await request.json(); reason = (body?.reason || '').toString().trim(); } catch {}

    await db.$transaction(async (tx) => {
      // Restore stock: create NEW StockLots for each sold item
      const now = new Date();
      for (const item of existing.items) {
        if (item.weight > 0) {
          await tx.stockLot.create({
            data: {
              productId: item.productId,
              remainingWeight: item.weight,
              costPerKg: item.costPerKg,
              dateAdded: now,
              source: 'SELL_CANCEL',
              sourceId: existing.id,
            },
          });
        }
      }

      // Cancel credit entry
      await tx.creditEntry.updateMany({
        where: { referenceId: id, referenceType: 'SELL_BILL' },
        data: { isSettled: true, description: `ยกเลิกแล้ว: ${reason || 'ไม่ระบุเหตุผล'}` },
      });

      // Mark bill as cancelled
      await tx.sellBill.update({
        where: { id },
        data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: auth.userId, cancelReason: reason || null },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CANCEL', entityType: 'SELL_BILL', entityId: id,
          userId: auth.userId, userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber, reason: reason || null,
            restoredWeight: existing.items.reduce((s, i) => s + i.weight, 0),
            restoredCost: existing.items.reduce((s, i) => s + i.totalCost, 0),
          }),
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('Error cancelling sell bill:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
