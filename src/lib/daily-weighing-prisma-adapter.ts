/**
 * ST-35 / ST-38: Prisma adapter — production implementation of the repository interface.
 *
 * Uses the real Prisma `db` client. Tests use FakeDailyPurchaseWeighingRepository
 * which implements the same interface with in-memory collections.
 *
 * ST-38: now also fetches SortingBills and StockTransfers (with isWaste=false,
 * non-cancelled) and passes the new source-breakdown fields through to
 * DailyPurchaseWeighingItem at save time.
 */

import { db } from '@/lib/db';
import type {
  DailyPurchaseWeighingRepository,
  TransactionContext,
  CategoryRow,
  ProductRow,
  BuyBillRow,
  SortingBillRow,
  StockTransferRow,
  DailyWeighingSessionRow,
  SessionCreateData,
  AuditLogCreateData,
} from './daily-weighing-repository';

export class PrismaDailyPurchaseWeighingRepository implements DailyPurchaseWeighingRepository {
  async findCategoryByName(name: string): Promise<CategoryRow | null> {
    const cat = await db.productCategory.findFirst({ where: { name } });
    return cat ? { id: cat.id, name: cat.name } : null;
  }

  async findProductsByCategory(categoryId: string): Promise<ProductRow[]> {
    const products = await db.product.findMany({
      where: { categoryId },
      select: { id: true, name: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    return products;
  }

  async findBuyBillsByDateRange(startDate: Date, endDate: Date): Promise<BuyBillRow[]> {
    const bills = await db.buyBill.findMany({
      where: { isCancelled: false, date: { gte: startDate, lte: endDate } },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    return bills.map(b => ({
      id: b.id,
      date: b.date,
      isCancelled: b.isCancelled,
      items: b.items.map(it => ({
        productId: it.productId,
        weight: it.weight,
        totalAmount: it.totalAmount,
        product: { id: it.product.id, name: it.product.name },
      })),
    }));
  }

  async findSortingBillsByDateRange(startDate: Date, endDate: Date): Promise<SortingBillRow[]> {
    const bills = await db.sortingBill.findMany({
      where: { isCancelled: false, date: { gte: startDate, lte: endDate } },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    return bills.map(b => ({
      id: b.id,
      date: b.date,
      isCancelled: b.isCancelled,
      items: b.items.map(it => ({
        productId: it.productId,
        weight: it.weight,
        isWaste: it.isWaste,
        product: { id: it.product.id, name: it.product.name },
      })),
    }));
  }

  async findStockTransfersByDateRange(startDate: Date, endDate: Date): Promise<StockTransferRow[]> {
    const transfers = await db.stockTransfer.findMany({
      where: { isCancelled: false, date: { gte: startDate, lte: endDate } },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    return transfers.map(t => ({
      id: t.id,
      date: t.date,
      isCancelled: t.isCancelled,
      businessType: t.businessType,
      items: t.items.map(it => ({
        productId: it.productId,
        weight: it.weight,
        isWaste: it.isWaste,
        product: { id: it.product.id, name: it.product.name },
      })),
    }));
  }

  async findExistingSession(weighingDate: Date, category: string): Promise<DailyWeighingSessionRow | null> {
    const session = await db.dailyPurchaseWeighingSession.findFirst({
      where: { weighingDate, category },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });
    if (!session) return null;
    return this.mapSession(session);
  }

  async listSessions(skip: number, take: number): Promise<{ sessions: DailyWeighingSessionRow[]; total: number }> {
    const [sessions, total] = await Promise.all([
      db.dailyPurchaseWeighingSession.findMany({
        orderBy: { weighingDate: 'desc' },
        skip,
        take,
        include: { items: { include: { product: { select: { id: true, name: true } } } } },
      }),
      db.dailyPurchaseWeighingSession.count(),
    ]);
    return { sessions: sessions.map(s => this.mapSession(s)), total };
  }

  async findSessionById(id: string): Promise<DailyWeighingSessionRow | null> {
    const session = await db.dailyPurchaseWeighingSession.findUnique({
      where: { id },
      include: { items: { include: { product: { select: { id: true, name: true } } } } },
    });
    if (!session) return null;
    return this.mapSession(session);
  }

  async countStockLots(): Promise<number> {
    return db.stockLot.count();
  }

  async countAuditLogsByType(entityType: string): Promise<number> {
    return db.auditLog.count({ where: { entityType } });
  }

  async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return db.$transaction(async (prismaTx) => {
      const txContext: TransactionContext = {
        async createSession(data: SessionCreateData): Promise<DailyWeighingSessionRow> {
          const created = await prismaTx.dailyPurchaseWeighingSession.create({
            data: {
              weighingDate: data.weighingDate,
              category: data.category,
              status: data.status,
              note: data.note,
              createdById: data.createdById,
              items: {
                create: data.items.map(item => ({
                  productId: item.productId,
                  purchaseWeight: item.purchaseWeight,
                  purchaseBillCount: item.purchaseBillCount,
                  sortingOutputWeight: item.sortingOutputWeight,
                  sortingBillCount: item.sortingBillCount,
                  dismantlingOutputWeight: item.dismantlingOutputWeight,
                  dismantlingRecordCount: item.dismantlingRecordCount,
                  expectedTotalWeight: item.expectedTotalWeight,
                  actualWeighedWeight: item.actualWeighedWeight,
                  differenceWeight: item.differenceWeight,
                  status: item.status,
                  note: item.note,
                })),
              },
            },
            include: { items: { include: { product: { select: { id: true, name: true } } } } },
          });
          // Map to interface type
          return {
            id: created.id,
            weighingDate: created.weighingDate,
            category: created.category,
            status: created.status,
            note: created.note,
            createdById: created.createdById,
            createdAt: created.createdAt,
            updatedAt: created.updatedAt,
            items: created.items.map(it => ({
              id: it.id,
              productId: it.productId,
              purchaseWeight: it.purchaseWeight,
              purchaseBillCount: it.purchaseBillCount,
              sortingOutputWeight: it.sortingOutputWeight,
              sortingBillCount: it.sortingBillCount,
              dismantlingOutputWeight: it.dismantlingOutputWeight,
              dismantlingRecordCount: it.dismantlingRecordCount,
              expectedTotalWeight: it.expectedTotalWeight,
              actualWeighedWeight: it.actualWeighedWeight,
              differenceWeight: it.differenceWeight,
              status: it.status,
              note: it.note,
              product: { id: it.product.id, name: it.product.name },
            })),
          };
        },
        async createAuditLog(data: AuditLogCreateData): Promise<void> {
          await prismaTx.auditLog.create({
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
      };
      return fn(txContext);
    });
  }

  private mapSession(s: any): DailyWeighingSessionRow {
    return {
      id: s.id,
      weighingDate: s.weighingDate,
      category: s.category,
      status: s.status,
      note: s.note,
      createdById: s.createdById,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      items: s.items.map((it: any) => ({
        id: it.id,
        productId: it.productId,
        purchaseWeight: it.purchaseWeight,
        purchaseBillCount: it.purchaseBillCount,
        sortingOutputWeight: it.sortingOutputWeight,
        sortingBillCount: it.sortingBillCount,
        dismantlingOutputWeight: it.dismantlingOutputWeight,
        dismantlingRecordCount: it.dismantlingRecordCount,
        expectedTotalWeight: it.expectedTotalWeight,
        actualWeighedWeight: it.actualWeighedWeight,
        differenceWeight: it.differenceWeight,
        status: it.status,
        note: it.note,
        product: { id: it.product.id, name: it.product.name },
      })),
    };
  }
}
