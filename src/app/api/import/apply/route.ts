import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber, writeAuditLog } from '@/lib/bill-helpers';
import { isRealFormula } from '@/lib/safe-math';
import {
  applyImport,
  normalizeBillNumber,
  type ImportApplyDeps,
  type ImportActor,
  type ParsedBill,
  type ParsedBillItem,
} from '@/lib/import-pipeline';

// ============================================================================
// FIFO ordering — consistent with /api/sell-bills/route.ts and
// /api/stock-transfers/route.ts. Oldest-first (FIFO) by dateAdded ASC.
// ============================================================================

const FIFO_ORDER_BY = { dateAdded: 'asc' as const };

/**
 * Transactional FIFO deduction — same algorithm as /api/sell-bills/route.ts
 * deductStockFIFO. Throws "Insufficient stock..." if any lot can't cover.
 *
 * ST-11 safety: the entire bill creation (including FIFO deduction) runs
 * inside ONE db.$transaction — so a mid-loop failure rolls back ALL lot
 * updates atomically. No partial deduction state. The per-bill try/catch
 * in the applyImport controller (above this layer) classifies the rolled-
 * back bill as INSUFFICIENT_STOCK or FAILED — the rest of the batch
 * continues unaffected.
 */
async function deductStockFIFOTx(
  productId: string,
  weightToDeduct: number,
  tx: Parameters<Parameters<typeof db.$transaction>[0]>[0]
): Promise<{ costPerKg: number; totalCost: number }> {
  const lots = await tx.stockLot.findMany({
    where: {
      productId,
      remainingWeight: { gt: 0 },
    },
    orderBy: FIFO_ORDER_BY,
  });

  const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeight, 0);
  if (totalAvailable < weightToDeduct) {
    throw new Error(
      `Insufficient stock for product ${productId}. Available: ${totalAvailable}, Requested: ${weightToDeduct}`
    );
  }

  let remaining = weightToDeduct;
  let totalCost = 0;

  for (const lot of lots) {
    if (remaining <= 0) break;
    const deductFromLot = Math.min(lot.remainingWeight, remaining);
    totalCost += deductFromLot * lot.costPerKg;
    remaining -= deductFromLot;
    await tx.stockLot.update({
      where: { id: lot.id },
      data: { remainingWeight: lot.remainingWeight - deductFromLot },
    });
  }

  const costPerKg = weightToDeduct > 0 ? totalCost / weightToDeduct : 0;
  return {
    costPerKg: Math.round(costPerKg * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
  };
}

// ============================================================================
// Production deps for applyImport
// ============================================================================

const deps: ImportApplyDeps = {
  // Concurrency re-check: is this normalized bill number already in DB?
  // We fetch all non-null externalBillNumbers for the type, normalize them,
  // and check membership. Acceptable for typical batch sizes (< 200 bills).
  findExistingBillNumber: async (type, normalized) => {
    if (normalized === '') return false;
    const bills =
      type === 'purchase'
        ? await db.buyBill.findMany({
            where: { externalBillNumber: { not: null } },
            select: { externalBillNumber: true },
          })
        : await db.sellBill.findMany({
            where: { externalBillNumber: { not: null } },
            select: { externalBillNumber: true },
          });
    for (const b of bills) {
      if (normalizeBillNumber(b.externalBillNumber) === normalized) {
        return true;
      }
    }
    return false;
  },

  // Sales pre-check: ensure every item has enough stock BEFORE attempting
  // the bill creation. Returns the first failing item (if any).
  checkStockAvailability: async (items) => {
    for (const item of items) {
      const lots = await db.stockLot.findMany({
        where: {
          productId: item.productId,
          remainingWeight: { gt: 0 },
        },
        select: { remainingWeight: true },
      });
      const available = lots.reduce((s, l) => s + l.remainingWeight, 0);
      if (available < item.weight) {
        const product = await db.product.findUnique({
          where: { id: item.productId },
          select: { name: true },
        });
        return {
          ok: false as const,
          productId: item.productId,
          productName: product?.name,
          available,
          requested: item.weight,
        };
      }
    }
    return { ok: true as const };
  },

  // Purchase bill creation — mirrors /api/buy-bills POST handler.
  // Uses ONE db.$transaction for atomic rollback (ST-11 safety preserved).
  createPurchaseBill: async (bill, actor) => {
    const date = new Date(bill.date);
    const billItems = bill.items.map((item) => {
      const itemTotal = item.weight * item.pricePerKg;
      return {
        productId: item.productId,
        weight: item.weight,
        weightExpression: isRealFormula(item.weightExpression)
          ? item.weightExpression!.trim()
          : null,
        pricePerKg: item.pricePerKg,
        totalAmount: Math.round(itemTotal * 100) / 100,
      };
    });
    const totalAmount = Math.round(
      billItems.reduce((s, i) => s + i.totalAmount, 0) * 100
    ) / 100;

    // Generate bill number BEFORE the transaction (avoids pgbouncer tx timeout)
    const billNumber = await generateBillNumber(db, 'BUY');

    const created = await db.$transaction(async (tx) => {
      const buyBill = await tx.buyBill.create({
        data: {
          billNumber,
          externalBillNumber: normalizeBillNumber(bill.externalBillNumber),
          date,
          isCredit: false,
          note: bill.note || null,
          totalAmount,
          items: { create: billItems },
        },
        include: { items: { include: { product: true } } },
      });

      // Create StockLots for each item (purchase ADDS stock)
      await tx.stockLot.createMany({
        data: buyBill.items.map((item) => ({
          productId: item.productId,
          remainingWeight: item.weight,
          costPerKg: item.pricePerKg,
          dateAdded: date,
          source: 'BUY',
          sourceId: buyBill.id,
        })),
      });

      await writeAuditLog(tx, {
        action: 'CREATE',
        entityType: 'BUY_BILL',
        entityId: buyBill.id,
        userId: actor.userId,
        userName: actor.name,
        details: JSON.stringify({
          billNumber,
          externalBillNumber: buyBill.externalBillNumber,
          totalAmount,
          itemCount: buyBill.items.length,
          importSource: 'ST-8-import-pipeline',
        }),
      });

      return buyBill;
    });

    return { id: created.id, billNumber };
  },

  // Sales bill creation — mirrors /api/sell-bills POST handler.
  // Uses ONE db.$transaction with tx-scoped FIFO deduction (ST-11 safety
  // preserved: any failure rolls back ALL lot updates + the SellBill).
  createSalesBill: async (bill, actor) => {
    const date = new Date(bill.date);

    // Pre-validate stock availability (defensive — applyImport already
    // calls checkStockAvailability, but race conditions can occur between
    // the pre-check and the transaction).
    for (const item of bill.items) {
      const lots = await db.stockLot.findMany({
        where: {
          productId: item.productId,
          remainingWeight: { gt: 0 },
        },
        select: { remainingWeight: true },
      });
      const totalAvailable = lots.reduce((s, l) => s + l.remainingWeight, 0);
      if (totalAvailable < item.weight) {
        throw new Error(
          `Insufficient stock for product ${item.productId}. Available: ${totalAvailable}, Requested: ${item.weight}`
        );
      }
    }

    const billNumber = await generateBillNumber(db, 'SELL');

    const created = await db.$transaction(async (tx) => {
      let totalAmount = 0;
      let totalCost = 0;
      const sellItems: Array<{
        productId: string;
        weight: number;
        weightExpression: string | null;
        pricePerKg: number;
        totalAmount: number;
        costPerKg: number;
        totalCost: number;
      }> = [];

      for (const item of bill.items) {
        const itemTotalAmount = Math.round(item.weight * item.pricePerKg * 100) / 100;
        const fifoResult = await deductStockFIFOTx(item.productId, item.weight, tx);

        totalAmount += itemTotalAmount;
        totalCost += fifoResult.totalCost;

        sellItems.push({
          productId: item.productId,
          weight: item.weight,
          weightExpression: isRealFormula(item.weightExpression)
            ? item.weightExpression!.trim()
            : null,
          pricePerKg: item.pricePerKg,
          totalAmount: itemTotalAmount,
          costPerKg: fifoResult.costPerKg,
          totalCost: fifoResult.totalCost,
        });
      }

      totalAmount = Math.round(totalAmount * 100) / 100;
      totalCost = Math.round(totalCost * 100) / 100;

      const sellBill = await tx.sellBill.create({
        data: {
          billNumber,
          externalBillNumber: normalizeBillNumber(bill.externalBillNumber),
          date,
          customerId: null,
          isCredit: false,
          note: bill.note || null,
          totalAmount,
          totalCost,
          items: { create: sellItems },
        },
        include: { items: { include: { product: true } } },
      });

      await writeAuditLog(tx, {
        action: 'CREATE',
        entityType: 'SELL_BILL',
        entityId: sellBill.id,
        userId: actor.userId,
        userName: actor.name,
        details: JSON.stringify({
          billNumber,
          externalBillNumber: sellBill.externalBillNumber,
          totalAmount,
          totalCost,
          itemCount: sellBill.items.length,
          importSource: 'ST-8-import-pipeline',
        }),
      });

      return sellBill;
    });

    return { id: created.id, billNumber };
  },
};

// ============================================================================
// Route handler — thin adapter
// ============================================================================

/**
 * ST-8: Apply import (partial-success).
 *
 * POST /api/import/apply
 *   body: { type: 'purchase' | 'sales', bills: ParsedBill[] }
 *   returns: ImportSummary
 *
 * Per-bill try/catch: one bill's failure does NOT abort the batch.
 * Duplicates are SKIPPED (not blocking). Returns structured result.
 */
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  }
  const jwtPayload = await verifyToken(token);
  if (!jwtPayload) {
    return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  }

  const hasPermission =
    jwtPayload.role === 'admin' ||
    jwtPayload.permissions?.['buy.create'] === true ||
    jwtPayload.permissions?.['sell.create'] === true;
  if (!hasPermission) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 });
  }

  const actor: ImportActor = {
    userId: jwtPayload.userId,
    username: jwtPayload.username,
    name: jwtPayload.name,
    role: jwtPayload.role,
  };

  try {
    const body = await request.json();
    const { type, bills } = body as { type?: unknown; bills?: unknown };

    if (type !== 'purchase' && type !== 'sales') {
      return NextResponse.json(
        { error: "type must be 'purchase' or 'sales'" },
        { status: 400 }
      );
    }

    if (!Array.isArray(bills)) {
      return NextResponse.json(
        { error: 'bills must be an array' },
        { status: 400 }
      );
    }

    // Defensive: validate each bill's basic shape (does NOT validate business
    // rules — that's the apply controller's job).
    const parsedBills: ParsedBill[] = [];
    for (const raw of bills) {
      if (!raw || typeof raw !== 'object') continue;
      const b = raw as Record<string, unknown>;
      const items = Array.isArray(b.items) ? b.items : [];
      const parsedItems: ParsedBillItem[] = items
        .filter((i): i is Record<string, unknown> => !!i && typeof i === 'object')
        .map((i) => ({
          productId: String(i.productId ?? ''),
          productName: String(i.productName ?? ''),
          productCode: i.productCode != null ? String(i.productCode) : undefined,
          weight: typeof i.weight === 'number' ? i.weight : Number(i.weight) || 0,
          weightExpression:
            typeof i.weightExpression === 'string' ? i.weightExpression : undefined,
          pricePerKg:
            typeof i.pricePerKg === 'number' ? i.pricePerKg : Number(i.pricePerKg) || 0,
          totalAmount:
            typeof i.totalAmount === 'number'
              ? i.totalAmount
              : Number(i.totalAmount) || 0,
          matched: i.matched !== false, // default true unless explicitly false
        }));
      parsedBills.push({
        externalBillNumber: String(b.externalBillNumber ?? ''),
        seller: typeof b.seller === 'string' ? b.seller : undefined,
        buyer: typeof b.buyer === 'string' ? b.buyer : undefined,
        buyerCode: typeof b.buyerCode === 'string' ? b.buyerCode : undefined,
        licensePlate:
          typeof b.licensePlate === 'string' ? b.licensePlate : undefined,
        date: typeof b.date === 'string' ? b.date : new Date().toISOString(),
        note: typeof b.note === 'string' ? b.note : '',
        items: parsedItems,
      });
    }

    const summary = await applyImport(type, parsedBills, deps, actor);

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    console.error('[ST-8] import apply failed:', error);
    return NextResponse.json(
      { error: 'Failed to apply import' },
      { status: 500 }
    );
  }
}
