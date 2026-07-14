/**
 * ST-35: Fake repository with real commit/rollback semantics.
 *
 * Implements the SAME DailyPurchaseWeighingRepository interface as the
 * Prisma adapter. Tests call production service functions with this fake.
 *
 * Transaction behavior:
 * - transaction() starts from a cloned state
 * - Transaction callback writes to staged state
 * - If callback succeeds → commit (replace persisted state)
 * - If callback throws → rollback (discard staged state)
 *
 * This means: if AuditLog.create throws inside the transaction,
 * the session and items are NOT persisted — just like Prisma $transaction.
 */

import type {
  DailyPurchaseWeighingRepository,
  TransactionContext,
  CategoryRow,
  ProductRow,
  BuyBillRow,
  DailyWeighingSessionRow,
  SessionCreateData,
  AuditLogCreateData,
} from '../src/lib/daily-weighing-repository';

interface PersistedState {
  sessions: Map<string, DailyWeighingSessionRow>;
  auditLogs: Array<{ id: string; action: string; entityType: string; entityId: string; userId: string | null; userName: string | null; details: string }>;
  stockLots: Array<{ id: string; remainingWeight: number; costPerKg: number; source: string }>;
  stockMovements: Array<{ id: string }>;
  stockAdjustmentAuditLogs: Array<{ id: string }>;
}

export class FakeDailyPurchaseWeighingRepository implements DailyPurchaseWeighingRepository {
  private state: PersistedState;
  private categories: Map<string, CategoryRow> = new Map();
  private products: Map<string, ProductRow[]> = new Map(); // by categoryId
  private bills: BuyBillRow[] = [];
  private nextId = 1;
  private shouldFailAuditLog = false;

  constructor() {
    this.state = this.emptyState();
  }

  private emptyState(): PersistedState {
    return {
      sessions: new Map(),
      auditLogs: [],
      stockLots: [],
      stockMovements: [],
      stockAdjustmentAuditLogs: [],
    };
  }

  // ============ Test fixture setters ============

  setCategory(name: string, id: string): void {
    this.categories.set(name, { id, name });
  }

  setProducts(categoryId: string, products: ProductRow[]): void {
    this.products.set(categoryId, products);
  }

  setBuyBills(bills: BuyBillRow[]): void {
    this.bills = bills;
  }

  setShouldFailAuditLog(fail: boolean): void {
    this.shouldFailAuditLog = fail;
  }

  addStockLot(id: string, weight: number, cost: number, source: string): void {
    this.state.stockLots.push({ id, remainingWeight: weight, costPerKg: cost, source });
  }

  // ============ State inspection (for test assertions) ============

  getSessionCount(): number {
    return this.state.sessions.size;
  }

  getAuditLogCount(): number {
    return this.state.auditLogs.length;
  }

  getStockLotCount(): number {
    return this.state.stockLots.length;
  }

  getStockMovementCount(): number {
    return this.state.stockMovements.length;
  }

  getStockAdjustmentAuditLogCount(): number {
    return this.state.stockAdjustmentAuditLogs.length;
  }

  getSessions(): DailyWeighingSessionRow[] {
    return Array.from(this.state.sessions.values());
  }

  // ============ Repository interface implementation ============

  async findCategoryByName(name: string): Promise<CategoryRow | null> {
    return this.categories.get(name) ?? null;
  }

  async findProductsByCategory(categoryId: string): Promise<ProductRow[]> {
    return this.products.get(categoryId) ?? [];
  }

  async findBuyBillsByDateRange(startDate: Date, endDate: Date): Promise<BuyBillRow[]> {
    return this.bills.filter(b =>
      !b.isCancelled &&
      b.date.getTime() >= startDate.getTime() &&
      b.date.getTime() <= endDate.getTime()
    );
  }

  async findExistingSession(weighingDate: Date, category: string): Promise<DailyWeighingSessionRow | null> {
    for (const session of this.state.sessions.values()) {
      if (session.weighingDate.getTime() === weighingDate.getTime() && session.category === category) {
        return session;
      }
    }
    return null;
  }

  async listSessions(skip: number, take: number): Promise<{ sessions: DailyWeighingSessionRow[]; total: number }> {
    const all = Array.from(this.state.sessions.values()).sort((a, b) =>
      b.weighingDate.getTime() - a.weighingDate.getTime()
    );
    return {
      sessions: all.slice(skip, skip + take),
      total: all.length,
    };
  }

  async findSessionById(id: string): Promise<DailyWeighingSessionRow | null> {
    return this.state.sessions.get(id) ?? null;
  }

  async countStockLots(): Promise<number> {
    return this.state.stockLots.length;
  }

  async countAuditLogsByType(entityType: string): Promise<number> {
    return this.state.auditLogs.filter(a => a.entityType === entityType).length;
  }

  async transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    // Clone state for staging
    const staged: PersistedState = {
      sessions: new Map(this.state.sessions),
      auditLogs: [...this.state.auditLogs],
      stockLots: [...this.state.stockLots],
      stockMovements: [...this.state.stockMovements],
      stockAdjustmentAuditLogs: [...this.state.stockAdjustmentAuditLogs],
    };

    const txContext: TransactionContext = {
      createSession: async (data: SessionCreateData): Promise<DailyWeighingSessionRow> => {
        const id = `fake-session-${this.nextId++}`;
        const session: DailyWeighingSessionRow = {
          id,
          weighingDate: data.weighingDate,
          category: data.category,
          status: data.status,
          note: data.note,
          createdById: data.createdById,
          createdAt: new Date(),
          updatedAt: new Date(),
          items: data.items.map((item, idx) => ({
            id: `fake-item-${this.nextId++}`,
            productId: item.productId,
            purchasedWeight: item.purchasedWeight,
            purchaseBillCount: item.purchaseBillCount,
            actualWeighedWeight: item.actualWeighedWeight,
            differenceWeight: item.differenceWeight,
            status: item.status,
            note: item.note,
            product: { id: item.productId, name: `Product-${item.productId}` },
          })),
        };
        staged.sessions.set(id, session);
        return session;
      },

      createAuditLog: async (data: AuditLogCreateData): Promise<void> => {
        if (this.shouldFailAuditLog) {
          throw new Error('Simulated AuditLog failure');
        }
        staged.auditLogs.push({
          id: `fake-audit-${this.nextId++}`,
          ...data,
        });
      },
    };

    try {
      const result = await fn(txContext);
      // Commit — replace persisted state with staged state
      this.state = staged;
      return result;
    } catch (err) {
      // Rollback — discard staged state, keep original
      throw err;
    }
  }
}
