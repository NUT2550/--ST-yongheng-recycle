/**
 * ST-8: Shared Prisma adapter factories for bill services.
 *
 * Both normal routes (POST /api/buy-bills, POST /api/sell-bills) and
 * the import apply route use these exact factories. No duplication.
 *
 * Dependency direction:
 *   bill-identity → bill-errors → bill-services → bill-service-prisma-adapters → routes
 */

import { db } from '@/lib/db';
import { generateBillNumber } from '@/lib/bill-helpers';
import { FIFO_ORDER_BY } from '@/lib/fifo-validation';
import type { Prisma } from '@prisma/client';
import type {
  BuyBillServiceDeps,
  BuyBillTx,
  BuyBillCreatedBill,
  SellBillServiceDeps,
  SellBillTx,
  SellBillCreatedBill,
} from './bill-services';
import { SourceLotConflictError } from './bill-errors';

/**
 * Production Prisma adapter for createBuyBillService.
 * Used by POST /api/buy-bills and POST /api/import/apply.
 */
export function makeBuyBillServiceDeps(): BuyBillServiceDeps<BuyBillCreatedBill> {
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
          createStockMovements: (data) => prismaTx.stockMovement.createMany({
            data: data as Prisma.StockMovementCreateManyInput[],
          }),
        };
        return fn(adaptedTx);
      }),
  };
}

/**
 * Production Prisma adapter for createSellBillService.
 * Used by POST /api/sell-bills and POST /api/import/apply.
 */
export function makeSellBillServiceDeps(): SellBillServiceDeps<SellBillCreatedBill> {
  return {
    checkStockAvailability: async (items: Array<{ productId: string; weight: number }>) => {
      for (const item of items) {
        const lots = await db.stockLot.findMany({
          where: { productId: item.productId, remainingWeight: { gt: 0 } },
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
              include: { items: { include: { product: true } }, customer: true },
            }) as Promise<SellBillCreatedBill>,
          findSourceLots: (productId) =>
            prismaTx.stockLot.findMany({
              where: { productId, remainingWeight: { gt: 0 } },
              orderBy: FIFO_ORDER_BY,
            }) as Promise<Array<{
              id: string; productId: string; remainingWeight: number; costPerKg: number;
              dateAdded: Date; createdAt: Date;
            }>>,
          // ST-57: compare-and-set guard using updateMany with WHERE checks.
          // Throws if the lot was modified between findSourceLots and update.
          updateStockLotRemaining: async (id, newRemaining, expected) => {
            // ST-57: CAS is mandatory — expected must always be provided
            const where: Record<string, unknown> = {
              id,
              productId: expected.productId,
              remainingWeight: expected.remainingWeight,
              costPerKg: expected.costPerKg,
            };
            const result = await prismaTx.stockLot.updateMany({
              where: where as Prisma.StockLotWhereUniqueInput,
              data: { remainingWeight: newRemaining },
            });
            if (result.count !== 1) {
              throw new SourceLotConflictError();
            }
          },
          createCreditEntry: (data) => prismaTx.creditEntry.create({ data }),
          createAuditLog: (data) => prismaTx.auditLog.create({ data }),
          createStockMovements: (data) => prismaTx.stockMovement.createMany({
            data: data as Prisma.StockMovementCreateManyInput[],
          }),
        };
        return fn(adaptedTx);
      }, {
        maxWait: 5000,
        timeout: 15000, // ST-57: 15s timeout (up from default 5s)
      }),
  };
}
