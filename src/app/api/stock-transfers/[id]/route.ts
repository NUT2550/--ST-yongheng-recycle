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

// GET /api/stock-transfers/[id]
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
    const bill = await db.stockTransfer.findUnique({
      where: { id },
      include: {
        sourceProduct: { select: { id: true, name: true } },
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!bill) return NextResponse.json({ error: 'ไม่พบใบย้ายสต็อก' }, { status: 404 });
    return NextResponse.json({ bill });
  } catch (error) {
    console.error('Error fetching stock transfer:', error);
    return NextResponse.json({ error: 'Failed to fetch stock transfer' }, { status: 500 });
  }
}

// PATCH /api/stock-transfers/[id] — Edit transfer (note/date only; weight/product edits require cancel + recreate)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditPermission(request);
  if (!auth) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์แก้ไข — ต้องการสิทธิ์ history.edit' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { date, note } = body as { date?: string; note?: string | null };

    const existing = await db.stockTransfer.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: 'ไม่พบใบย้ายสต็อก' }, { status: 404 });
    if (existing.isCancelled) {
      return NextResponse.json({ error: 'บิลนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้' }, { status: 400 });
    }

    const updated = await db.$transaction(async (tx) => {
      const result = await tx.stockTransfer.update({
        where: { id: existing.id },
        data: {
          date: date ? new Date(date) : undefined,
          note: note === null ? null : note || undefined,
        },
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entityType: 'STOCK_TRANSFER',
          entityId: existing.id,
          userId: auth.userId,
          userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber,
            changes: { date: date !== undefined, note: note !== undefined },
          }),
        },
      });

      return result;
    });

    return NextResponse.json({ bill: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update stock transfer';
    console.error('Error updating stock transfer:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/stock-transfers/[id] — Cancel transfer (strict: block if outputs consumed downstream)
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
    const existing = await db.stockTransfer.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) return NextResponse.json({ error: 'ไม่พบใบย้ายสต็อก' }, { status: 404 });
    if (existing.isCancelled) {
      return NextResponse.json({ error: 'ใบย้ายสต็อกนี้ถูกยกเลิกไปแล้ว' }, { status: 400 });
    }

    let reason = '';
    try {
      const body = await request.json();
      reason = (body?.reason || '').toString().trim();
    } catch {
      // No body or invalid JSON
    }

    await db.$transaction(async (tx) => {
      // STRICT CHECK: verify no output stock lot has been consumed downstream.
      // For each non-waste output item, find the StockLot created by this transfer
      // (source='TRANSFER', sourceId=id, productId=item.productId) and confirm its
      // remainingWeight still equals the original item weight. If any was consumed
      // (sold / sorted / transferred further), block the cancellation.
      for (const item of existing.items) {
        if (item.isWaste) continue;
        const outLot = await tx.stockLot.findFirst({
          where: { source: 'TRANSFER', sourceId: existing.id, productId: item.productId },
        });
        if (!outLot) continue;
        const consumed = item.weight - outLot.remainingWeight;
        if (consumed > 0.01) {
          const prod = await tx.product.findUnique({ where: { id: item.productId }, select: { name: true } });
          throw new Error(
            `ไม่สามารถยกเลิกได้: สต็อก output "${prod?.name || item.productId}" ถูกใช้ไปแล้ว ${consumed.toFixed(2)} กก. (จาก ${item.weight} กก.). กรุณาย้อนกลับไปลบบิลขาย/คัดแยก/ย้ายที่เกี่ยวข้องก่อน`
          );
        }
      }

      // Safe to cancel: delete all output StockLots (they are fully unconsumed)
      await tx.stockLot.deleteMany({
        where: { source: 'TRANSFER', sourceId: existing.id },
      });

      // Restore source stock as a new lot (cost preserved from bill)
      if (existing.sourceWeight > 0) {
        await tx.stockLot.create({
          data: {
            productId: existing.sourceProductId,
            remainingWeight: existing.sourceWeight,
            costPerKg: existing.sourceCostPerKg,
            dateAdded: new Date(),
            source: 'TRANSFER_CANCEL',
            sourceId: existing.id,
          },
        });
      }

      // Mark bill as cancelled
      await tx.stockTransfer.update({
        where: { id },
        data: {
          isCancelled: true,
          cancelledAt: new Date(),
          cancelledBy: auth.userId,
          cancelReason: reason || null,
        },
      });

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CANCEL',
          entityType: 'STOCK_TRANSFER',
          entityId: id,
          userId: auth.userId,
          userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber,
            reason: reason || null,
            restoredSourceWeight: existing.sourceWeight,
            restoredSourceCostPerKg: existing.sourceCostPerKg,
            deletedOutputLots: existing.items.filter((i) => !i.isWaste).length,
          }),
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('Error cancelling stock transfer:', error);
    return NextResponse.json(
      { error: message },
      { status: message.includes('ไม่สามารถยกเลิกได้') ? 400 : 500 }
    );
  }
}
