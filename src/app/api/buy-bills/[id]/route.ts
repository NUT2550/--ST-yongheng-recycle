import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { reverseSourceMovements } from '@/lib/stock-movement-reversal';


async function requireEditPermission(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return null;
  const payload = await verifyToken(token);
  if (!payload) return null;
  const hasPermission = payload.role === 'admin' || payload.permissions?.['history.edit'] === true;
  return hasPermission ? payload : null;
}

// GET /api/buy-bills/[id]
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
    const bill = await db.buyBill.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            product: { select: { id: true, name: true, defaultBuyPrice: true } },
          },
        },
      },
    });
    if (!bill) {
      return NextResponse.json({ error: 'ไม่พบใบรับซื้อ' }, { status: 404 });
    }
    return NextResponse.json({ bill });
  } catch (error) {
    console.error('Error fetching buy bill:', error);
    return NextResponse.json({ error: 'Failed to fetch buy bill' }, { status: 500 });
  }
}

// PATCH /api/buy-bills/[id] — Edit buy bill (requires history.edit)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditPermission(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'ไม่มีสิทธิ์แก้ไขบิล — ต้องการสิทธิ์ history.edit' },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { date, isCredit, note, items } = body as {
      date?: string;
      isCredit?: boolean;
      note?: string | null;
      items?: Array<{ id?: string; productId: string; weight: number; pricePerKg: number }>;
    };

    const existing = await db.buyBill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบใบรับซื้อ' }, { status: 404 });
    }
    if (existing.isCancelled) {
      return NextResponse.json({ error: 'บิลนี้ถูกยกเลิกแล้ว ไม่สามารถแก้ไขได้' }, { status: 400 });
    }

    const result = await db.$transaction(async (tx) => {
      // Calculate new total
      let totalAmount = 0;

      if (items && items.length > 0) {
        const existingMap = new Map(existing.items.map((i) => [i.id, i]));

        // Process each item
        for (const item of items) {
          const oldItem = item.id ? existingMap.get(item.id) : null;
          const itemTotal = Math.round(item.weight * item.pricePerKg * 100) / 100;
          totalAmount += itemTotal;

          if (oldItem) {
            // Update existing item
            const weightDiff = item.weight - oldItem.weight;
            if (weightDiff !== 0) {
              // Adjust StockLot
              const stockLot = await tx.stockLot.findFirst({
                where: { source: 'BUY', sourceId: existing.id, productId: oldItem.productId },
              });
              if (stockLot) {
                const newRemaining = stockLot.remainingWeight + weightDiff;
                if (newRemaining < 0) {
                  throw new Error(
                    `ลดน้ำหนักไม่ได้: สต็อกถูกใช้ไปแล้ว ${Math.abs(weightDiff).toFixed(2)} กก. มากกว่าที่ลดได้`
                  );
                }
                await tx.stockLot.update({
                  where: { id: stockLot.id },
                  data: { remainingWeight: newRemaining },
                });
              }
            }
            await tx.buyBillItem.update({
              where: { id: item.id },
              data: {
                weight: item.weight,
                pricePerKg: item.pricePerKg,
                totalAmount: itemTotal,
              },
            });
            existingMap.delete(item.id!);
          } else {
            // New item — create
            await tx.buyBillItem.create({
              data: {
                buyBillId: existing.id,
                productId: item.productId,
                weight: item.weight,
                pricePerKg: item.pricePerKg,
                totalAmount: itemTotal,
              },
            });
            await tx.stockLot.create({
              data: {
                productId: item.productId,
                remainingWeight: item.weight,
                costPerKg: item.pricePerKg,
                dateAdded: new Date(date || existing.date),
                source: 'BUY',
                sourceId: existing.id,
              },
            });
          }
        }

        // Delete items not in the new list
        for (const [, oldItem] of existingMap) {
          const stockLot = await tx.stockLot.findFirst({
            where: { source: 'BUY', sourceId: existing.id, productId: oldItem.productId },
          });
          if (stockLot) {
            if (stockLot.remainingWeight < oldItem.weight) {
              throw new Error(
                `ลบรายการไม่ได้: สต็อก ${oldItem.productId} ถูกใช้ไปแล้ว`
              );
            }
            await tx.stockLot.update({
              where: { id: stockLot.id },
              data: { remainingWeight: stockLot.remainingWeight - oldItem.weight },
            });
          }
          await tx.buyBillItem.delete({ where: { id: oldItem.id } });
        }
      } else {
        // Items not edited — keep existing totals
        for (const item of existing.items) {
          totalAmount += item.totalAmount;
        }
      }
      totalAmount = Math.round(totalAmount * 100) / 100;

      // Update the bill
      const updatedBill = await tx.buyBill.update({
        where: { id: existing.id },
        data: {
          date: date ? new Date(date) : undefined,
          isCredit: typeof isCredit === 'boolean' ? isCredit : undefined,
          note: note === null ? null : note || undefined,
          totalAmount,
        },
        include: { items: { include: { product: true } } },
      });

      // Handle CreditEntry
      const existingCredit = await tx.creditEntry.findFirst({
        where: { referenceType: 'BUY_BILL', referenceId: existing.id },
      });

      if (isCredit === true && !existingCredit) {
        await tx.creditEntry.create({
          data: {
            type: 'PAYABLE',
            amount: totalAmount,
            paidAmount: 0,
            referenceType: 'BUY_BILL',
            referenceId: existing.id,
            description: `ใบซื้อ ${existing.billNumber || existing.id}`,
            date: new Date(date || existing.date),
            isSettled: false,
          },
        });
      } else if (isCredit === false && existingCredit) {
        if (existingCredit.paidAmount > 0) {
          throw new Error('ไม่สามารถเปลี่ยนจากเครดิตเป็นสดได้ เนื่องจากมีการชำระบางส่วนแล้ว');
        }
        await tx.creditEntry.delete({ where: { id: existingCredit.id } });
      } else if (isCredit === true && existingCredit) {
        await tx.creditEntry.update({
          where: { id: existingCredit.id },
          data: {
            amount: totalAmount,
            isSettled: existingCredit.paidAmount >= totalAmount,
          },
        });
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'UPDATE',
          entityType: 'BUY_BILL',
          entityId: existing.id,
          userId: auth.userId,
          userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber,
            changes: { date: date !== undefined, isCredit: isCredit !== undefined, note: note !== undefined, itemsCount: items?.length },
          }),
        },
      });

      return updatedBill;
    });

    return NextResponse.json({ bill: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update buy bill';
    console.error('Error updating buy bill:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// DELETE /api/buy-bills/[id] — Cancel buy bill (soft delete + stock restore)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireEditPermission(request);
  if (!auth) {
    return NextResponse.json(
      { error: 'ไม่มีสิทธิ์ — ต้องการสิทธิ์ history.edit' },
      { status: 403 }
    );
  }

  try {
    const { id } = await params;
    const existing = await db.buyBill.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!existing) {
      return NextResponse.json({ error: 'ไม่พบใบรับซื้อ' }, { status: 404 });
    }
    if (existing.isCancelled) {
      return NextResponse.json(
        { error: 'ใบรับซื้อนี้ถูกยกเลิกไปแล้ว' },
        { status: 400 }
      );
    }

    let reason = '';
    try {
      const body = await request.json();
      reason = (body?.reason || '').toString().trim();
    } catch {
      // No body or invalid JSON
    }

    await db.$transaction(async (tx) => {
      const cancelledAt = new Date();
      // Check if stock was consumed downstream
      const buyLots = await tx.stockLot.findMany({
        where: { source: 'BUY', sourceId: id },
      });
      const totalRemaining = buyLots.reduce((s, l) => s + l.remainingWeight, 0);
      const totalOriginal = existing.items.reduce((s, i) => s + i.weight, 0);
      const consumedWeight = totalOriginal - totalRemaining;

      if (consumedWeight > 0.001) {
        throw new Error(
          `ไม่สามารถยกเลิกได้: สต็อกจากบิลนี้ถูกขาย/คัดแยกไปแล้ว ${consumedWeight.toFixed(2)} กก. กรุณาย้อนกลับไปลบบิลขาย/คัดแยกที่เกี่ยวข้องก่อน`
        );
      }

      // Safe to restore: delete BUY StockLots
      await tx.stockLot.deleteMany({
        where: { source: 'BUY', sourceId: id },
      });

      // Cancel credit entry
      await tx.creditEntry.updateMany({
        where: { referenceId: id, referenceType: 'BUY_BILL' },
        data: {
          isSettled: true,
          description: `ยกเลิกแล้ว: ${reason || 'ไม่ระบุเหตุผล'}`,
        },
      });

      // Mark bill as cancelled
      await tx.buyBill.update({
        where: { id },
        data: {
          isCancelled: true,
          cancelledAt,
          cancelledBy: auth.userId,
          cancelReason: reason || null,
        },
      });

      await reverseSourceMovements(tx, 'BUY_BILL', id, 'CANCELLATION_REVERSAL', cancelledAt, reason || 'Purchase cancelled');

      // Audit log
      await tx.auditLog.create({
        data: {
          action: 'CANCEL',
          entityType: 'BUY_BILL',
          entityId: id,
          userId: auth.userId,
          userName: auth.name,
          details: JSON.stringify({
            billNumber: existing.billNumber,
            reason: reason || null,
            restoredWeight: totalRemaining,
          }),
        },
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('Error cancelling buy bill:', error);
    return NextResponse.json(
      { error: message },
      { status: message.includes('ไม่สามารถยกเลิกได้') ? 400 : 500 }
    );
  }
}
