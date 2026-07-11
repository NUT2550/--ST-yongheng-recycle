import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

// POST /api/physical-counts/[id]/apply — Apply a DRAFT physical count session.
// ST-9: Adjusts stock to match physical count. Creates STOCK_ADJUSTMENT lots.
//
// Owner-approved rules:
// - Any authenticated user can apply (not admin-only) — "พนักงานที่มีสิทธิ์ใช้งาน Physical Count สามารถกด Apply ได้"
// - Must not cause negative stock after adjustment
// - Note is optional
// - Must record: actor, timestamp, before, physical, difference, after
// - Applied sessions cannot be edited or deleted
// - Reversal = create a new adjustment referencing the original (not delete/edit)
// - All steps have failure handling — no half-applied state
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // --- Auth: any authenticated user (owner approved staff access) ---
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  const { id: sessionId } = await params;

  try {
    const body = await request.json().catch(() => ({}));
    const applyNote = (body as { note?: string })?.note?.trim() || '';

    // 1. Fetch the session with items + products
    const session = await db.physicalCountSession.findUnique({
      where: { id: sessionId },
      include: {
        items: {
          include: { product: { select: { id: true, name: true } } },
        },
      },
    });

    if (!session) {
      return NextResponse.json({ error: 'ไม่พบรายการชั่งสต็อก' }, { status: 404 });
    }

    // 2. Prevent duplicate apply — must be DRAFT
    if (session.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `รายการนี้ถูก Apply แล้ว (สถานะ: ${session.status}) ไม่สามารถ Apply ซ้ำได้` },
        { status: 409 }
      );
    }

    // 3. Re-validate products exist + compute live adjustments
    //    The draft's systemWeight is a snapshot — at apply time we use CURRENT stock.
    //    adjustmentWeight = physicalWeight - currentStockWeight
    //    If > 0: create STOCK_ADJUSTMENT lot (add stock)
    //    If < 0: deduct via FIFO (remove stock) — must not go negative
    //    If = 0: skip
    type Adjustment = {
      item: typeof session.items[0];
      currentStock: number;
      adjustmentWeight: number;
      avgCost: number;
      afterWeight: number;
    };
    const adjustments: Adjustment[] = [];
    const insufficient: string[] = [];

    for (const item of session.items) {
      // Re-read current stock
      const lots = await db.stockLot.findMany({
        where: { productId: item.productId, remainingWeight: { gt: 0 } },
        select: { id: true, remainingWeight: true, costPerKg: true },
      });
      const currentStock = Math.round(lots.reduce((s, l) => s + l.remainingWeight, 0) * 100) / 100;
      const adjustmentWeight = Math.round((item.physicalWeight - currentStock) * 100) / 100;
      const afterWeight = Math.round((currentStock + adjustmentWeight) * 100) / 100;

      if (adjustmentWeight === 0) continue; // no adjustment needed

      // Check no negative stock
      if (afterWeight < 0) {
        insufficient.push(
          `${item.product.name}: ชั่งจริง ${item.physicalWeight} กก. < สต็อกปัจจุบัน ${currentStock} กก. (จะทำให้ติดลบ)`
        );
        continue;
      }

      adjustments.push({
        item,
        currentStock,
        adjustmentWeight,
        avgCost: item.averageCost,
        afterWeight,
      });
    }

    // 4. If any item would go negative, block the entire apply
    if (insufficient.length > 0) {
      return NextResponse.json(
        { error: 'ไม่สามารถ Apply ได้ — สต็อกจะติดลบ', details: insufficient },
        { status: 400 }
      );
    }

    if (adjustments.length === 0) {
      // No adjustments needed — all items match current stock. Just mark as APPLIED.
      await db.physicalCountSession.update({
        where: { id: sessionId },
        data: {
          status: 'APPLIED',
          appliedById: payload.userId,
          appliedAt: new Date(),
          appliedNote: applyNote || null,
        },
      });
      await db.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'PHYSICAL_COUNT',
          entityId: sessionId,
          userId: payload.userId,
          userName: payload.name,
          details: JSON.stringify({
            type: 'PHYSICAL_COUNT_APPLY',
            sessionId,
            countDate: session.countDate,
            group: session.group,
            adjustments: [],
            note: applyNote || null,
          }),
        },
      });
      return NextResponse.json({ sessionId, status: 'APPLIED', adjustmentsApplied: 0 });
    }

    // 5. Execute adjustments sequentially (pgbouncer-safe, no $transaction)
    //    Track state for rollback
    const createdLotIds: string[] = [];
    const deductedLots: { id: string; deducted: number }[] = [];
    const compensated = new Set<string>();
    let sessionUpdated = false;

    try {
      for (const adj of adjustments) {
        if (adj.adjustmentWeight > 0) {
          // Add stock: create a STOCK_ADJUSTMENT lot
          const lot = await db.stockLot.create({
            data: {
              productId: adj.item.productId,
              remainingWeight: adj.adjustmentWeight,
              costPerKg: adj.avgCost,
              dateAdded: new Date(),
              source: 'STOCK_ADJUSTMENT',
              sourceId: sessionId,
            },
          });
          createdLotIds.push(lot.id);
        } else {
          // Remove stock: deduct via FIFO (adjustmentWeight is negative)
          const deductWeight = Math.abs(adj.adjustmentWeight);
          const lots = await db.stockLot.findMany({
            where: { productId: adj.item.productId, remainingWeight: { gt: 0 } },
            orderBy: { dateAdded: 'asc' },
          });
          let remaining = deductWeight;
          for (const lot of lots) {
            if (remaining <= 0) break;
            const deductFromLot = Math.min(lot.remainingWeight, remaining);
            await db.stockLot.update({
              where: { id: lot.id },
              data: { remainingWeight: lot.remainingWeight - deductFromLot },
            });
            deductedLots.push({ id: lot.id, deducted: deductFromLot });
            remaining -= deductFromLot;
          }
        }
      }

      // 6. Update session status to APPLIED with structured metadata
      await db.physicalCountSession.update({
        where: { id: sessionId },
        data: {
          status: 'APPLIED',
          appliedById: payload.userId,
          appliedAt: new Date(),
          appliedNote: applyNote || null,
        },
      });
      sessionUpdated = true;

      // 7. Write AuditLog with full before/after details
      await db.auditLog.create({
        data: {
          action: 'CREATE',
          entityType: 'PHYSICAL_COUNT',
          entityId: sessionId,
          userId: payload.userId,
          userName: payload.name,
          details: JSON.stringify({
            type: 'PHYSICAL_COUNT_APPLY',
            sessionId,
            countDate: session.countDate,
            group: session.group,
            note: applyNote || null,
            adjustments: adjustments.map(a => ({
              productId: a.item.productId,
              productName: a.item.product.name,
              before: a.currentStock,
              physical: a.item.physicalWeight,
              difference: a.adjustmentWeight,
              after: a.afterWeight,
              avgCost: a.avgCost,
            })),
            createdLotIds,
            deductedLotCount: deductedLots.length,
          }),
        },
      });

      return NextResponse.json({
        sessionId,
        status: 'APPLIED',
        adjustmentsApplied: adjustments.length,
        createdLots: createdLotIds.length,
        deductedLots: deductedLots.length,
      });
    } catch (execError) {
      // ROLLBACK: undo all changes to prevent half-applied state
      console.error('ST-9: Apply failed, rolling back:', execError);

      // 1. Delete created STOCK_ADJUSTMENT lots
      for (const lotId of createdLotIds) {
        try {
          await db.stockLot.delete({ where: { id: lotId } });
        } catch (delErr) {
          console.error(`ST-9: Failed to delete lot ${lotId} during rollback:`, delErr);
        }
      }

      // 2. Restore deducted lots (idempotent)
      for (const lot of deductedLots) {
        if (compensated.has(lot.id)) continue;
        try {
          await db.stockLot.update({
            where: { id: lot.id },
            data: { remainingWeight: { increment: lot.deducted } },
          });
          compensated.add(lot.id);
        } catch (restoreErr) {
          console.error(`ST-9: Failed to restore lot ${lot.id} during rollback:`, restoreErr);
        }
      }

      // 3. If session was already marked APPLIED, revert to DRAFT + clear structured fields
      if (sessionUpdated) {
        try {
          await db.physicalCountSession.update({
            where: { id: sessionId },
            data: {
              status: 'DRAFT',
              appliedById: null,
              appliedAt: null,
              appliedNote: null,
            },
          });
        } catch (revertErr) {
          console.error('ST-9: Failed to revert session status during rollback:', revertErr);
        }
      }

      // 4. Best-effort audit log of the failure
      try {
        await db.auditLog.create({
          data: {
            action: 'CREATE',
            entityType: 'PHYSICAL_COUNT',
            entityId: sessionId,
            userId: payload.userId,
            userName: payload.name,
            details: JSON.stringify({
              type: 'PHYSICAL_COUNT_APPLY_FAILED',
              sessionId,
              error: execError instanceof Error ? execError.message.substring(0, 500) : String(execError),
              createdLotIdsRolledBack: createdLotIds.length,
              deductedLotsRestored: compensated.size,
            }),
          },
        });
      } catch (auditErr) {
        console.error('ST-9: AuditLog write failed during rollback (non-fatal):', auditErr);
      }

      return NextResponse.json(
        { error: 'Apply ล้มเหลว — ระบบได้คืนสต็อกทั้งหมดแล้ว กรุณาลองอีกครั้ง', details: execError instanceof Error ? execError.message : String(execError) },
        { status: 500 }
      );
    }
  } catch (error) {
    console.error('Error applying physical count:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'Apply ไม่สำเร็จ: ' + message }, { status: 500 });
  }
}

// GET is handled by the parent [id]/route.ts — this file only handles POST /apply.

