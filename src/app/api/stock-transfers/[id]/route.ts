import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { resolveHistoryEditAuth, authFailedResponse } from '@/lib/cancel-auth';
import {
  cancelTransferBill,
  mapTransferCancellationError,
  type TransferCancellationDb,
} from '@/lib/transfer-cancellation-service';

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
  const auth = await resolveHistoryEditAuth(request);
  if (!auth.ok) return authFailedResponse(auth);

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
          userId: auth.payload.userId,
          userName: auth.payload.name,
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
  const auth = await resolveHistoryEditAuth(request);
  if (!auth.ok) return authFailedResponse(auth);

  try {
    const { id } = await params;

    let reason = '';
    try {
      const body = await request.json();
      reason = (body?.reason || '').toString().trim();
    } catch {
      // No body or invalid JSON
    }

    await cancelTransferBill(db as unknown as TransferCancellationDb, {
      id,
      reason,
      auth: { userId: auth.payload.userId, name: auth.payload.name },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error cancelling stock transfer:', error);
    const mapped = mapTransferCancellationError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}
