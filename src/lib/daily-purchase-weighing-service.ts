/**
 * ST-35 / ST-38: Production service for daily purchase weighing.
 *
 * Contains all DB-dependent orchestration. Both production routes
 * and tests call these SAME functions — no duplicated logic.
 *
 * Production uses PrismaDailyPurchaseWeighingRepository.
 * Tests use FakeDailyPurchaseWeighingRepository (in tests/st35-fake-repository.ts).
 *
 * ST-38: aggregation now pulls BuyBills + SortingBills + StockTransfers via the
 * repository and computes per-product totals across all three sources. The save
 * flow, duplicate-check, and atomic rollback semantics are UNCHANGED from ST-35.
 */

import {
  isValidWeighingDate,
  isValidWeighingCategory,
  getThaiDateRange,
  validateWeighingPostInput,
  buildSessionItems,
  aggregateFromSources,
  type AggregationResult,
} from './daily-purchase-weighing';
import type {
  DailyPurchaseWeighingRepository,
  TransactionContext,
  DailyWeighingSessionRow,
} from './daily-weighing-repository';

export interface SaveResult {
  success: true;
  session: DailyWeighingSessionRow;
}

export interface SaveError {
  success: false;
  error: string;
  status: number;
}

export type SaveOutcome = SaveResult | SaveError;

/**
 * Aggregate daily purchases using the repository interface.
 *
 * This is the production aggregation function. Tests call this with
 * a fake repository — the aggregation LOGIC is production code,
 * only the DATA source is different.
 *
 * ST-38: now includes SortingBills (isWaste=false) and StockTransfers
 * (isWaste=false, businessType 'คัดแยก' → sorting bucket, 'แกะของ'/null
 * → dismantling bucket) in addition to BuyBills.
 */
export async function aggregateDailyPurchasesWithRepository(
  repo: DailyPurchaseWeighingRepository,
  dateStr: string,
  category: string
): Promise<AggregationResult> {
  if (!isValidWeighingDate(dateStr)) {
    throw new Error(`Invalid date: ${dateStr}`);
  }
  if (!isValidWeighingCategory(category)) {
    throw new Error(`Invalid category: ${category}`);
  }

  const [startDate, endDate] = getThaiDateRange(dateStr);

  const cat = await repo.findCategoryByName(category);
  if (!cat) {
    throw new Error(`Category not found: ${category}`);
  }

  const productsInCategory = await repo.findProductsByCategory(cat.id);
  const productIdsInCategory = new Set(productsInCategory.map(p => p.id));

  const [bills, sortingBills, transfers] = await Promise.all([
    repo.findBuyBillsByDateRange(startDate, endDate),
    repo.findSortingBillsByDateRange(startDate, endDate),
    repo.findStockTransfersByDateRange(startDate, endDate),
  ]);

  return aggregateFromSources(
    dateStr,
    category,
    productsInCategory,
    productIdsInCategory,
    bills,
    sortingBills,
    transfers,
  );
}

/**
 * Find duplicate session — production service function.
 */
export async function findDuplicateDailyWeighing(
  repo: DailyPurchaseWeighingRepository,
  weighingDate: Date,
  category: string
): Promise<DailyWeighingSessionRow | null> {
  return repo.findExistingSession(weighingDate, category);
}

/**
 * Save daily purchase weighing — production service function.
 *
 * Performs: validation → aggregation → product check → duplicate check →
 * snapshot construction → atomic transaction (session + items + AuditLog).
 *
 * Tests call this with a fake repository to verify all steps including
 * transaction rollback on AuditLog failure.
 *
 * ST-38: session items now carry all source-breakdown fields
 * (purchaseWeight, sortingOutputWeight, dismantlingOutputWeight,
 * expectedTotalWeight, etc.). The client payload shape is UNCHANGED.
 */
export async function saveDailyPurchaseWeighing(
  repo: DailyPurchaseWeighingRepository,
  body: unknown,
  userId: string,
  userName: string
): Promise<SaveOutcome> {
  // 1. Validate input
  const validation = validateWeighingPostInput(body);
  if (!validation.valid) {
    return { success: false, error: validation.error, status: validation.status };
  }
  const { weighingDate, category, note, items } = validation.input;

  // 2. Server-side aggregation
  let aggregation: AggregationResult;
  try {
    aggregation = await aggregateDailyPurchasesWithRepository(repo, weighingDate, category);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'unknown', status: 400 };
  }

  if (aggregation.items.length === 0) {
    return { success: false, error: `ไม่มียอด${category}ของวันที่ ${weighingDate}`, status: 400 };
  }

  // 3. Build session items — server controls all computed fields
  const buildResult = buildSessionItems(aggregation, items);
  if (!buildResult.ok) {
    return { success: false, error: buildResult.error, status: buildResult.status };
  }
  const sessionItems = buildResult.items;

  // 4. Duplicate session check
  const date = new Date(weighingDate + 'T00:00:00+07:00');
  const existing = await repo.findExistingSession(date, category);
  if (existing) {
    return {
      success: false,
      error: `มีผลชั่งของวันที่ ${weighingDate} หมวด ${category} อยู่แล้ว — ห้ามบันทึกซ้ำ`,
      status: 409,
    };
  }

  // 5. Atomic save — session + items + AuditLog in a single transaction
  // If AuditLog fails, the entire transaction rolls back.
  try {
    const session = await repo.transaction(async (tx: TransactionContext) => {
      const created = await tx.createSession({
        weighingDate: date,
        category,
        status: 'SAVED',
        note: note || null,
        createdById: userId,
        items: sessionItems.map(item => ({
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
      });

      await tx.createAuditLog({
        action: 'CREATE',
        entityType: 'DAILY_WEIGHING',
        entityId: created.id,
        userId,
        userName,
        details: JSON.stringify({
          weighingDate: created.weighingDate,
          category: created.category,
          itemCount: created.items.length,
          totalBills: aggregation.totalBills,
          totalPurchaseWeight: aggregation.totalPurchaseWeight,
          totalSortingWeight: aggregation.totalSortingWeight,
          totalDismantlingWeight: aggregation.totalDismantlingWeight,
          totalExpectedWeight: aggregation.totalExpectedWeight,
          note: created.note,
        }),
      });

      return created;
    });

    return { success: true, session };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    return { success: false, error: 'บันทึกไม่สำเร็จ: ' + message, status: 500 };
  }
}

/**
 * Get daily weighing history — production service function.
 */
export async function getDailyWeighingHistory(
  repo: DailyPurchaseWeighingRepository,
  skip: number,
  take: number
): Promise<{ sessions: DailyWeighingSessionRow[]; total: number }> {
  return repo.listSessions(skip, take);
}

/**
 * Get daily weighing detail — production service function.
 */
export async function getDailyWeighingDetail(
  repo: DailyPurchaseWeighingRepository,
  id: string
): Promise<DailyWeighingSessionRow | null> {
  return repo.findSessionById(id);
}
