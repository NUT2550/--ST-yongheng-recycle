/**
 * ST-41: Prisma-backed implementation of StockTransferDeps.
 *
 * Wraps the real Prisma `db` client + existing helpers. The POST route
 * constructs an instance of this adapter and passes it to `createStockTransfer`.
 * Tests inject mock deps instead (see tests/st41-mock-deps.ts).
 *
 * The two private helpers (`deductStockFIFO`, `compensateDeductedLots`) were
 * extracted verbatim from the old monolithic route so the production logic
 * is identical — they now live here next to their only caller.
 */

import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';
import { generateBillNumber } from '@/lib/bill-helpers';
import { FIFO_ORDER_BY } from '@/lib/fifo-validation';
import type {
  StockTransferDeps,
  SourceProductRow,
  SourceLotRow,
  DeductResult,
  CreatedTransfer,
  AuditLogInput,
} from './stock-transfer-service';

// ============ ST-61: Transaction timeout configuration ============

/**
 * ST-61: Explicit Prisma interactive transaction timeout options.
 *
 * Previously, db.$transaction was called without explicit options and used
 * Prisma's default interactive-transaction timeout. ST-61 sets maxWait to 5s
 * and timeout to 15s as a mitigation for transactions that experience high
 * latency. Production verification found one source lot for the reported
 * incident; the historical Prisma code and exact Production root cause remain
 * unknown. This configuration does not claim that many FIFO lots or P2028
 * caused that incident.
 *
 * Exported as a named constant so tests can verify the exact config without
 * needing a live Prisma connection.
 *
 * maxWait: 5000ms — max time to wait for a connection from the pool
 * timeout: 15000ms — max total time for the transaction to complete
 *
 * NOTE: 15s is a mitigation, not a root-cause finding. The route has an
 * explicit 30s maxDuration. Query optimization is tracked separately in ST-63,
 * and request-level idempotency is tracked separately in ST-62.
 */
export const STOCK_TRANSFER_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 5000,
  timeout: 15000,
});

// ============ Private FIFO + compensation helpers (extracted from route) ============

/**
 * Helper: Deduct stock using FIFO and return weighted average cost.
 * Uses sequential db queries (NOT interactive transaction) for pgbouncer compatibility.
 *
 * ST-11: attaches partial deductedLots to the error if it throws mid-loop,
 * so the caller can compensate (rollback) the already-deducted lots.
 */
async function deductStockFIFO(
  productId: string,
  weightToDeduct: number
): Promise<{ costPerKg: number; totalCost: number; deductedLots: { id: string; deducted: number }[] }> {
  const lots = await db.stockLot.findMany({
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
  const deductedLots: { id: string; deducted: number }[] = [];

  for (const lot of lots) {
    if (remaining <= 0) break;
    const deductFromLot = Math.min(lot.remainingWeight, remaining);
    totalCost += deductFromLot * lot.costPerKg;
    remaining -= deductFromLot;
    // Update each lot sequentially (pgbouncer-safe)
    try {
      await db.stockLot.update({
        where: { id: lot.id },
        data: { remainingWeight: lot.remainingWeight - deductFromLot },
      });
    } catch (updateErr) {
      // ST-11: Attach the partial deductedLots so the caller can rollback.
      const err = new Error(
        `FIFO update failed for lot ${lot.id}: ${updateErr instanceof Error ? updateErr.message : String(updateErr)}`
      );
      (err as { deductedLots?: { id: string; deducted: number }[] }).deductedLots = deductedLots;
      throw err;
    }
    deductedLots.push({ id: lot.id, deducted: deductFromLot });
  }

  const costPerKg = weightToDeduct > 0 ? totalCost / weightToDeduct : 0;
  return {
    costPerKg: Math.round(costPerKg * 100) / 100,
    totalCost: Math.round(totalCost * 100) / 100,
    deductedLots,
  };
}

/**
 * ST-11/ST-14: Durable compensation using operation ledger.
 * Creates a CompensationOperation with one CompensationItem per lot BEFORE restoring.
 * Retry with same requestId resumes the existing operation, skipping COMPLETED items.
 * Each item is marked COMPLETED only AFTER the StockLot.update succeeds.
 * If the server crashes between items, retry will find PENDING items and resume.
 */
async function compensateDeductedLots(
  deductedLots: { id: string; deducted: number }[],
  requestId: string,
  reason?: string
): Promise<void> {
  if (deductedLots.length === 0) return;

  // 1. Find or create the CompensationOperation for this requestId
  let operation = await db.compensationOperation.findUnique({
    where: { requestId },
    include: { items: true },
  });

  if (!operation) {
    // Read current lot weights for audit (beforeWeight)
    const lotIds = deductedLots.map((l) => l.id);
    const lots = await db.stockLot.findMany({
      where: { id: { in: lotIds } },
      select: { id: true, remainingWeight: true },
    });
    const lotMap = new Map(lots.map((l) => [l.id, l.remainingWeight]));

    // Create operation + items
    operation = await db.compensationOperation.create({
      data: {
        requestId,
        operationType: 'STOCK_TRANSFER_CREATE',
        status: 'IN_PROGRESS',
        error: reason ? reason.substring(0, 500) : null,
        items: {
          create: deductedLots.map((lot) => ({
            lotId: lot.id,
            amount: lot.deducted,
            beforeWeight: lotMap.get(lot.id) ?? 0,
            status: 'PENDING',
          })),
        },
      },
      include: { items: true },
    });
  } else {
    // Resume existing operation — update status to IN_PROGRESS if not already
    if (operation.status !== 'COMPLETED') {
      await db.compensationOperation.update({
        where: { id: operation.id },
        data: { status: 'IN_PROGRESS', error: reason ? reason.substring(0, 500) : operation.error },
      });
    }
  }

  // 2. Process each PENDING item
  const pendingItems = operation.items.filter((item) => item.status === 'PENDING');
  for (const item of pendingItems) {
    try {
      // Restore the lot's remainingWeight
      const updatedLot = await db.stockLot.update({
        where: { id: item.lotId },
        data: { remainingWeight: { increment: item.amount } },
        select: { remainingWeight: true },
      });
      // Mark item as COMPLETED with afterWeight
      await db.compensationItem.update({
        where: { id: item.id },
        data: {
          status: 'COMPLETED',
          afterWeight: updatedLot.remainingWeight,
          completedAt: new Date(),
        },
      });
    } catch (err) {
      // Mark item as FAILED with error
      console.error(`ST-14: Compensation failed for lot ${item.lotId}:`, err);
      await db.compensationItem
        .update({
          where: { id: item.id },
          data: {
            status: 'FAILED',
            error: err instanceof Error ? err.message.substring(0, 500) : String(err),
          },
        })
        .catch(() => {
          /* non-fatal */
        });
    }
  }

  // 3. Check if all items are COMPLETED → mark operation as COMPLETED
  const refreshedOp = await db.compensationOperation.findUnique({
    where: { id: operation.id },
    include: { items: { select: { status: true } } },
  });
  if (refreshedOp) {
    const allCompleted = refreshedOp.items.every((i) => i.status === 'COMPLETED');
    const anyFailed = refreshedOp.items.some((i) => i.status === 'FAILED');
    if (allCompleted) {
      await db.compensationOperation.update({
        where: { id: operation.id },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
    } else if (anyFailed) {
      await db.compensationOperation.update({
        where: { id: operation.id },
        data: { status: 'FAILED' },
      });
    }
  }
}

// ============ Prisma-backed StockTransferDeps implementation ============

/**
 * Production implementation of StockTransferDeps using the real Prisma `db`.
 * The route constructs one instance per request and passes it to the service.
 */
export function createPrismaStockTransferDeps(
  client: typeof db | Prisma.TransactionClient = db,
  isTransactionScoped = false,
): StockTransferDeps {
  return {
    isTransactionScoped,
    transaction: <T>(fn: (tx: StockTransferDeps) => Promise<T>): Promise<T> =>
      db.$transaction(
        async prismaTx => fn(createPrismaStockTransferDeps(prismaTx, true)),
        STOCK_TRANSFER_TRANSACTION_OPTIONS,
      ),
    async findSourceProduct(productId: string): Promise<SourceProductRow | null> {
      return client.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true },
      });
    },

    async findOutputProduct(productId: string): Promise<SourceProductRow | null> {
      return client.product.findUnique({
        where: { id: productId },
        select: { id: true, name: true },
      });
    },

    async findSourceLots(productId: string): Promise<SourceLotRow[]> {
      return client.stockLot.findMany({
        where: { productId, remainingWeight: { gt: 0 } },
        orderBy: FIFO_ORDER_BY,
      });
    },

    async generateBillNumber(): Promise<string> {
      return generateBillNumber(client as typeof db, 'TRANSFER');
    },

    async deductSourceLots(productId: string, weightToDeduct: number): Promise<DeductResult> {
      if (!isTransactionScoped) return deductStockFIFO(productId, weightToDeduct);
      const lots = await client.stockLot.findMany({
        where: { productId, remainingWeight: { gt: 0 } },
        orderBy: FIFO_ORDER_BY,
      });
      const totalAvailable = lots.reduce((sum, lot) => sum + lot.remainingWeight, 0);
      if (totalAvailable < weightToDeduct) throw new Error(`Insufficient stock for product ${productId}. Available: ${totalAvailable}, Requested: ${weightToDeduct}`);
      let remaining = weightToDeduct;
      let totalCost = 0;
      const deductedLots: { id: string; deducted: number }[] = [];
      for (const lot of lots) {
        if (remaining <= 0) break;
        const deducted = Math.min(lot.remainingWeight, remaining);
        remaining -= deducted;
        totalCost += deducted * lot.costPerKg;
        await client.stockLot.update({ where: { id: lot.id }, data: { remainingWeight: lot.remainingWeight - deducted } });
        deductedLots.push({ id: lot.id, deducted });
      }
      return { costPerKg: Math.round((totalCost / weightToDeduct) * 100) / 100, totalCost: Math.round(totalCost * 100) / 100, deductedLots };
    },

    async createStockTransfer(data: Record<string, unknown>): Promise<CreatedTransfer> {
      // The service builds the data via buildStockTransferCreateData; cast to the
      // Prisma-expected input shape and include the same relations as the old route.
      const created = await client.stockTransfer.create({
        data: data as Prisma.StockTransferCreateInput,
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
      });
      return created as unknown as CreatedTransfer;
    },

    async createOutputStockLot(data: Record<string, unknown>): Promise<void> {
      await client.stockLot.create({
        data: data as Prisma.StockLotCreateInput,
      });
    },

    async createStockMovements(data): Promise<void> {
      await client.stockMovement.createMany({
        data: data as Prisma.StockMovementCreateManyInput[],
      });
    },

    async createAuditLog(data: AuditLogInput): Promise<void> {
      await client.auditLog.create({
        data: {
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          userId: data.userId,
          userName: data.userName,
          details: data.details,
        },
      });
    },

    async compensate(deductedLots, requestId, reason?): Promise<void> {
      if (!isTransactionScoped) await compensateDeductedLots(deductedLots, requestId, reason);
    },

    async deletePartialTransfer(transferId: string): Promise<void> {
      await client.stockTransfer.delete({ where: { id: transferId } });
    },

    async deletePartialOutputLots(transferId: string): Promise<void> {
      await client.stockLot.deleteMany({
        where: { sourceId: transferId, source: 'TRANSFER' },
      });
    },
  };
}
