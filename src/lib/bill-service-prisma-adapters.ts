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
import type {
  BuyBillServiceDeps,
  BuyBillTx,
  BuyBillCreatedBill,
  SellBillServiceDeps,
  SellBillTx,
  SellBillCreatedBill,
} from './bill-services';

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
              id: string; remainingWeight: number; costPerKg: number;
              dateAdded: Date; createdAt: Date;
            }>>,
          updateStockLotRemaining: (id, newRemaining) =>
            prismaTx.stockLot.update({ where: { id }, data: { remainingWeight: newRemaining } }),
          createCreditEntry: (data) => prismaTx.creditEntry.create({ data }),
          createAuditLog: (data) => prismaTx.auditLog.create({ data }),
        };
        return fn(adaptedTx);
      }),
  };
}
