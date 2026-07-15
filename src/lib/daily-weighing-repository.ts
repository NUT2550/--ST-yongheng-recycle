/**
 * ST-35 / ST-38: Repository interface for daily purchase weighing.
 *
 * Production adapter uses Prisma `db`.
 * Test adapter uses in-memory collections with real commit/rollback.
 *
 * Both implement the SAME interface — production and tests share
 * the same service logic.
 *
 * ST-38: extended with SortingBill and StockTransfer rows so the
 * aggregation service can include sorting outputs (SortingBills +
 * StockTransfers with businessType='คัดแยก') and dismantling outputs
 * (StockTransfers with businessType='แกะของ' or null/blank).
 */

export interface BuyBillRow {
  id: string;
  date: Date;
  isCancelled: boolean;
  items: Array<{
    productId: string;
    weight: number;
    totalAmount: number;
    product: { id: string; name: string };
  }>;
}

export interface SortingBillRow {
  id: string;
  date: Date;
  isCancelled: boolean;
  items: Array<{
    productId: string;
    weight: number;
    isWaste: boolean;
    product: { id: string; name: string };
  }>;
}

export interface StockTransferRow {
  id: string;
  date: Date;
  isCancelled: boolean;
  businessType: string | null;
  items: Array<{
    productId: string;
    weight: number;
    isWaste: boolean;
    product: { id: string; name: string };
  }>;
}

export interface ProductRow {
  id: string;
  name: string;
  sortOrder: number;
}

export interface CategoryRow {
  id: string;
  name: string;
}

export interface DailyWeighingSessionRow {
  id: string;
  weighingDate: Date;
  category: string;
  status: string;
  note: string | null;
  createdById: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: Array<{
    id: string;
    productId: string;
    purchaseWeight: number;
    purchaseBillCount: number;
    sortingOutputWeight: number;
    sortingBillCount: number;
    dismantlingOutputWeight: number;
    dismantlingRecordCount: number;
    expectedTotalWeight: number;
    actualWeighedWeight: number | null;
    differenceWeight: number | null;
    status: string;
    note: string | null;
    product: { id: string; name: string };
  }>;
}

export interface DailyWeighingItemCreateData {
  productId: string;
  purchaseWeight: number;
  purchaseBillCount: number;
  sortingOutputWeight: number;
  sortingBillCount: number;
  dismantlingOutputWeight: number;
  dismantlingRecordCount: number;
  expectedTotalWeight: number;
  actualWeighedWeight: number | null;
  differenceWeight: number | null;
  status: string;
  note: string | null;
}

export interface SessionCreateData {
  weighingDate: Date;
  category: string;
  status: string;
  note: string | null;
  createdById: string | null;
  items: DailyWeighingItemCreateData[];
}

export interface AuditLogCreateData {
  action: string;
  entityType: string;
  entityId: string;
  userId: string | null;
  userName: string | null;
  details: string;
}

/**
 * Repository interface — implemented by both Prisma adapter (production)
 * and FakeRepository (tests).
 */
export interface DailyPurchaseWeighingRepository {
  findCategoryByName(name: string): Promise<CategoryRow | null>;
  findProductsByCategory(categoryId: string): Promise<ProductRow[]>;
  findBuyBillsByDateRange(startDate: Date, endDate: Date): Promise<BuyBillRow[]>;
  findSortingBillsByDateRange(startDate: Date, endDate: Date): Promise<SortingBillRow[]>;
  findStockTransfersByDateRange(startDate: Date, endDate: Date): Promise<StockTransferRow[]>;
  findExistingSession(weighingDate: Date, category: string): Promise<DailyWeighingSessionRow | null>;
  listSessions(skip: number, take: number): Promise<{ sessions: DailyWeighingSessionRow[]; total: number }>;
  findSessionById(id: string): Promise<DailyWeighingSessionRow | null>;
  countStockLots(): Promise<number>;
  countAuditLogsByType(entityType: string): Promise<number>;
  transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
}

export interface TransactionContext {
  createSession(data: SessionCreateData): Promise<DailyWeighingSessionRow>;
  createAuditLog(data: AuditLogCreateData): Promise<void>;
}
