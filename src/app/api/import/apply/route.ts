import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { generateBillNumber } from '@/lib/bill-helpers';
import {
  applyImport,
  normalizeBillNumber,
  type ImportApplyDeps,
  type ImportActor,
  type ParsedBill,
  type ParsedBillItem,
} from '@/lib/import-pipeline';
import { hasPermission } from '@/lib/permissions';
import {
  createBuyBillService,
  createSellBillService,
  FIFO_ORDER_BY,
  type BuyBillCreatedBill,
  type BuyBillTx,
  type SellBillCreatedBill,
  type SellBillTx,
} from '@/lib/bill-services';

// ST-8 Blocker 3: this route does NOT contain a second bill engine.
// The createPurchaseBill / createSalesBill callbacks below are THIN
// ADAPTERS over the shared services createBuyBillService /
// createSellBillService (from @/lib/bill-services) — the SAME services
// used by /api/buy-bills and /api/sell-bills. All bill/stock/audit
// creation happens inside the shared service's atomic transaction.
//
// ST-8 Blocker 4: FIFO_ORDER_BY is re-exported from @/lib/bill-services
// (canonical ST-39 ordering: dateAdded ASC, createdAt ASC, id ASC). The
// source of truth remains @/lib/fifo-validation.
//
// ST-8 Blocker 7: when the shared service hits a Prisma P2002 (unique
// constraint violation), it throws DuplicateExistingError. That error
// bubbles up through the callback to applyImport, which classifies the
// bill as DUPLICATE_EXISTING (not FAILED) so the rest of the batch
// continues.

// ============================================================================
// Production deps for the SHARED bill services.
//
// These factories are identical to the ones in /api/buy-bills/route.ts
// (makeBuyBillDeps) and /api/sell-bills/route.ts (makeSellBillDeps) —
// the import apply route uses the SAME shared services as the regular
// POST routes. No duplicated logic.
// ============================================================================

function makeBuyBillDeps() {
  return {
    generateBillNumber: () => generateBillNumber(db, 'BUY'),
    transaction: <T>(fn: (tx: BuyBillTx<BuyBillCreatedBill>) => Promise<T>): Promise<T> =>
      db.$transaction(async (prismaTx) => {
        const adaptedTx: BuyBillTx = {
          createBuyBill: (args) =>
            prismaTx.buyBill.create({
              ...args,
              include: { items: { include: { product: true } } },
            }) as Promise<BuyBillCreatedBill>,
          createStockLots: (data) => prismaTx.stockLot.createMany({ data }),
          createCreditEntry: (data) => prismaTx.creditEntry.create({ data }),
          createAuditLog: (data) => prismaTx.auditLog.create({ data }),
        };
        return fn(adaptedTx);
      }),
  };
}

function makeSellBillDeps() {
  return {
    checkStockAvailability: async (
      items: Array<{ productId: string; weight: number }>
    ) => {
      for (const item of items) {
        const lots = await db.stockLot.findMany({
          where: {
            productId: item.productId,
            remainingWeight: { gt: 0 },
          },
          orderBy: FIFO_ORDER_BY,
        });
        const totalAvailable = lots.reduce((sum, l) => sum + l.remainingWeight, 0);
        if (totalAvailable < item.weight) {
          const product = await db.product.findUnique({
            where: { id: item.productId },
            select: { name: true },
          });
          return {
            ok: false as const,
            productId: item.productId,
            productName: product?.name,
            available: totalAvailable,
            requested: item.weight,
          };
        }
      }
      return { ok: true as const };
    },
    generateBillNumber: () => generateBillNumber(db, 'SELL'),
    transaction: <T>(fn: (tx: SellBillTx<SellBillCreatedBill>) => Promise<T>): Promise<T> =>
      db.$transaction(async (prismaTx) => {
        const adaptedTx: SellBillTx = {
          createSellBill: (args) =>
            prismaTx.sellBill.create({
              ...args,
              include: {
                items: { include: { product: true } },
                customer: true,
              },
            }) as Promise<SellBillCreatedBill>,
          findSourceLots: (productId) =>
            prismaTx.stockLot.findMany({
              where: { productId, remainingWeight: { gt: 0 } },
              orderBy: FIFO_ORDER_BY,
            }) as Promise<
              Array<{
                id: string;
                remainingWeight: number;
                costPerKg: number;
                dateAdded: Date;
                createdAt: Date;
              }>
            >,
          updateStockLotRemaining: (id, newRemaining) =>
            prismaTx.stockLot.update({
              where: { id },
              data: { remainingWeight: newRemaining },
            }),
          createCreditEntry: (data) => prismaTx.creditEntry.create({ data }),
          createAuditLog: (data) => prismaTx.auditLog.create({ data }),
        };
        return fn(adaptedTx);
      }),
  };
}

// ============================================================================
// Production deps for applyImport.
//
// findExistingBillNumber + checkStockAvailability are PRE-CHECKS (not bill
// creation). The createPurchaseBill / createSalesBill callbacks are thin
// adapters that transform ParsedBill into BuyBillInput / SellBillInput and
// delegate to the SHARED services. The services own ALL bill/stock/audit
// creation inside their own atomic transaction. DuplicateExistingError
// (P2002) bubbles up unchanged so applyImport classifies as
// DUPLICATE_EXISTING.
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

  // Sales pre-check (used by applyImport to classify INSUFFICIENT_STOCK
  // BEFORE attempting bill creation). The shared createSellBillService
  // ALSO performs its own in-transaction stock check (defense in depth
  // against races) — but that one throws → FAILED, whereas this pre-check
  // lets the pipeline classify the bill as INSUFFICIENT_STOCK.
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

  // Purchase bill creation — delegates to the SHARED createBuyBillService.
  // The service handles: bill number generation, BuyBill + BuyBillItem
  // creation, StockLot creation (source='BUY'), CreditEntry (if isCredit),
  // and AuditLog — all inside ONE atomic $transaction (ST-11 safety).
  // DuplicateExistingError (P2002) bubbles up unchanged so applyImport
  // classifies the bill as DUPLICATE_EXISTING.
  createPurchaseBill: async (bill, actor) => {
    const result = await createBuyBillService(
      makeBuyBillDeps(),
      {
        date: bill.date,
        isCredit: false,
        note: bill.note,
        externalBillNumber: bill.externalBillNumber,
        items: bill.items.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          pricePerKg: item.pricePerKg,
        })),
      },
      actor
    );
    return { id: result.bill.id, billNumber: result.billNumber };
  },

  // Sales bill creation — delegates to the SHARED createSellBillService.
  // The service handles: bill number generation, SellBill + SellBillItem
  // creation, FIFO deduction (ST-39 canonical ordering + ST-20 zero-cost
  // validation), CreditEntry (if isCredit), and AuditLog — all inside ONE
  // atomic $transaction (ST-11 safety). DuplicateExistingError (P2002)
  // bubbles up unchanged.
  createSalesBill: async (bill, actor) => {
    const result = await createSellBillService(
      makeSellBillDeps(),
      {
        date: bill.date,
        customerId: undefined,
        isCredit: false,
        note: bill.note,
        items: bill.items.map((item) => ({
          productId: item.productId,
          weight: item.weight,
          weightExpression: item.weightExpression,
          pricePerKg: item.pricePerKg,
        })),
      },
      actor
    );
    return { id: result.bill.id, billNumber: result.billNumber };
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

  // ST-8 Blocker 1: Type-specific authorization
  const importBody = await request.json();
  const { type: importType } = importBody as { type?: string };
  if (importType === 'purchase' && !hasPermission(jwtPayload, 'buy.create')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์นำเข้าใบซื้อ' }, { status: 403 });
  }
  if (importType === 'sales' && !hasPermission(jwtPayload, 'sell.create')) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์นำเข้าใบขาย' }, { status: 403 });
  }
  if (importType !== 'purchase' && importType !== 'sales') {
    return NextResponse.json({ error: 'type ต้องเป็น purchase หรือ sales' }, { status: 400 });
  }

  const actor: ImportActor = {
    userId: jwtPayload.userId,
    username: jwtPayload.username,
    name: jwtPayload.name,
    role: jwtPayload.role,
  };

  try {
    const body = importBody;
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
