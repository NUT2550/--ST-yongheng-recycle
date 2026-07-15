/**
 * ST-35 / ST-38: Server-side aggregation service for daily purchase weighing.
 *
 * Pure functions shared by GET and POST endpoints — no duplicated logic.
 * Never reads StockLot. Never writes stock.
 *
 * ST-38: aggregation now includes THREE source buckets per product:
 *   - purchaseWeight          from BuyBillItem (BuyBills dated in range, non-cancelled)
 *   - sortingOutputWeight     from SortingBillItem (isWaste=false) + StockTransferItem
 *                             (isWaste=false, businessType='คัดแยก')
 *   - dismantlingOutputWeight from StockTransferItem (isWaste=false, businessType='แกะของ'
 *                             OR null/blank)
 *   expectedTotalWeight = purchaseWeight + sortingOutputWeight + dismantlingOutputWeight
 *   differenceWeight    = actualWeighedWeight - expectedTotalWeight
 *
 * The "purchasedWeight" field was renamed to "purchaseWeight" for clarity (ST-38).
 * ST-35 was merged but the migration was not applied to Production Supabase at the
 * time ST-38 was authored, so no Production data used the old field name.
 */

import { db } from '@/lib/db';

// Thailand timezone offset: UTC+7
const TOLERANCE = 0.10; // ±0.10 kg per Owner decision

export const WEIGHING_CATEGORIES = ['ทองแดง', 'ทองเหลือง'] as const;
export type WeighingCategory = (typeof WEIGHING_CATEGORIES)[number];

export interface AggregatedProduct {
  productId: string;
  productName: string;
  purchaseWeight: number;
  purchaseBillCount: number;
  sortingOutputWeight: number;
  sortingBillCount: number;
  dismantlingOutputWeight: number;
  dismantlingRecordCount: number;
  expectedTotalWeight: number; // purchase + sorting + dismantling
  totalAmount: number; // purchase value reference (BuyBillItem.totalAmount sum)
}

export interface AggregationResult {
  date: string;
  category: string;
  totalBills: number; // distinct documents of any source that contributed
  productCount: number;
  totalPurchaseWeight: number;
  totalSortingWeight: number;
  totalDismantlingWeight: number;
  totalExpectedWeight: number; // purchase + sorting + dismantling
  items: AggregatedProduct[];
}

/**
 * Validate that a date string is a valid CE ISO date (e.g. "2026-07-11").
 */
export function isValidWeighingDate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const d = new Date(dateStr + 'T00:00:00+07:00');
  return !isNaN(d.getTime());
}

/**
 * Validate that category is one of the allowed values.
 */
export function isValidWeighingCategory(category: string): category is WeighingCategory {
  return WEIGHING_CATEGORIES.includes(category as WeighingCategory);
}

/**
 * Get the date range for a Thailand business day (00:00 to 23:59 ICT).
 */
export function getThaiDateRange(dateStr: string): [Date, Date] {
  const startDate = new Date(dateStr + 'T00:00:00+07:00');
  const endDate = new Date(dateStr + 'T23:59:59+07:00');
  return [startDate, endDate];
}

/**
 * Validate actual weighed weight input.
 * - null/undefined = NOT_WEIGHED (valid)
 * - 0 = weighed and got zero (valid)
 * - positive number = valid
 * - negative, NaN, Infinity = invalid
 */
export function isValidActualWeighedWeight(value: unknown): value is number | null {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'number') return false;
  if (isNaN(value)) return false;
  if (!isFinite(value)) return false;
  if (value < 0) return false;
  return true;
}

/**
 * Calculate the weighing status for a single item.
 *
 * ST-38: difference is now computed against `expectedTotalWeight`
 * (purchase + sorting + dismantling), not the purchase-only weight.
 */
export function calculateWeighingStatus(
  actualWeighedWeight: number | null | undefined,
  expectedWeight: number
): { difference: number | null; status: 'MATCH' | 'DIFFERENCE' | 'NOT_WEIGHED' } {
  if (actualWeighedWeight === null || actualWeighedWeight === undefined) {
    return { difference: null, status: 'NOT_WEIGHED' };
  }
  const difference = Math.round((actualWeighedWeight - expectedWeight) * 100) / 100;
  const status = Math.abs(difference) <= TOLERANCE ? 'MATCH' : 'DIFFERENCE';
  return { difference, status };
}

/**
 * Helper: classify a StockTransfer's businessType as dismantling (แกะของ/null/blank)
 * vs sorting-transfer (คัดแยก).
 *
 * Per task spec:
 *   - businessType === 'คัดแยก' → sorting (via transfer) source
 *   - businessType === 'แกะของ' OR null/blank → dismantling source
 */
export function isDismantlingBusinessType(businessType: string | null | undefined): boolean {
  if (businessType === null || businessType === undefined) return true;
  const trimmed = businessType.trim();
  if (trimmed === '') return true;
  return trimmed === 'แกะของ';
}

export function isSortingTransferBusinessType(businessType: string | null | undefined): boolean {
  if (businessType === null || businessType === undefined) return false;
  return businessType.trim() === 'คัดแยก';
}

/**
 * Aggregate BuyBillItems + SortingBillItems + StockTransferItems for a specific
 * date and category.
 *
 * SINGLE source of truth — kept in sync with `aggregateDailyPurchasesWithRepository`
 * in `daily-purchase-weighing-service.ts` (which is the production path used by
 * routes and tests). This standalone variant uses `db` directly and exists for
 * ad-hoc inspection; routes/tests use the repository variant.
 *
 * Rules:
 * - Uses BuyBill.date / SortingBill.date / StockTransfer.date (not createdAt)
 * - Excludes cancelled bills (isCancelled = false)
 * - Excludes waste items (isWaste = false)
 * - Groups by productId within the selected category (OUTPUT product eligibility)
 * - Counts distinct documents per source per product
 * - totalBills = distinct documents (bills + sorting + transfers) with at least
 *   one eligible item in category
 * - Returns only products with expectedTotalWeight > 0
 * - Never reads StockLot
 */
export async function aggregateDailyPurchases(
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

  const cat = await db.productCategory.findFirst({ where: { name: category } });
  if (!cat) {
    throw new Error(`Category not found: ${category}`);
  }

  const productsInCategory = await db.product.findMany({
    where: { categoryId: cat.id },
    select: { id: true, name: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' },
  });
  const productIdsInCategory = new Set(productsInCategory.map(p => p.id));

  const [bills, sortingBills, transfers] = await Promise.all([
    db.buyBill.findMany({
      where: { isCancelled: false, date: { gte: startDate, lte: endDate } },
      include: { items: { include: { product: { select: { id: true, name: true } } } } },
    }),
    db.sortingBill.findMany({
      where: { isCancelled: false, date: { gte: startDate, lte: endDate } },
      include: { items: { include: { product: { select: { id: true, name: true } } } } },
    }),
    db.stockTransfer.findMany({
      where: { isCancelled: false, date: { gte: startDate, lte: endDate } },
      include: { items: { include: { product: { select: { id: true, name: true } } } } },
    }),
  ]);

  return aggregateFromSources(
    dateStr,
    category,
    productsInCategory,
    productIdsInCategory,
    bills.map(b => ({
      id: b.id, date: b.date, isCancelled: b.isCancelled,
      items: b.items.map(it => ({ productId: it.productId, weight: it.weight, totalAmount: it.totalAmount, product: { id: it.product.id, name: it.product.name } })),
    })),
    sortingBills.map(b => ({
      id: b.id, date: b.date, isCancelled: b.isCancelled,
      items: b.items.map(it => ({ productId: it.productId, weight: it.weight, isWaste: it.isWaste, product: { id: it.product.id, name: it.product.name } })),
    })),
    transfers.map(t => ({
      id: t.id, date: t.date, isCancelled: t.isCancelled, businessType: t.businessType,
      items: t.items.map(it => ({ productId: it.productId, weight: it.weight, isWaste: it.isWaste, product: { id: it.product.id, name: it.product.name } })),
    })),
  );
}

/**
 * Internal pure aggregation — shared by the standalone `aggregateDailyPurchases`
 * and the repository-backed `aggregateDailyPurchasesWithRepository`.
 *
 * Takes already-fetched bill/sorting/transfer rows and the category's product
 * set, returns the AggregationResult. Does not touch `db`.
 */
export function aggregateFromSources(
  dateStr: string,
  category: string,
  productsInCategory: Array<{ id: string; name: string; sortOrder: number }>,
  productIdsInCategory: Set<string>,
  bills: Array<{
    id: string;
    items: Array<{ productId: string; weight: number; totalAmount: number }>;
  }>,
  sortingBills: Array<{
    id: string;
    items: Array<{ productId: string; weight: number; isWaste: boolean }>;
  }>,
  transfers: Array<{
    id: string;
    businessType: string | null;
    items: Array<{ productId: string; weight: number; isWaste: boolean }>;
  }>
): AggregationResult {
  const aggMap = new Map<string, {
    purchaseWeight: number;
    purchaseBillIds: Set<string>;
    totalAmount: number;
    sortingWeight: number;
    sortingDocIds: Set<string>;
    dismantlingWeight: number;
    dismantlingDocIds: Set<string>;
  }>();

  const allRelevantDocIds = new Set<string>();

  function ensure(productId: string) {
    if (!aggMap.has(productId)) {
      aggMap.set(productId, {
        purchaseWeight: 0, purchaseBillIds: new Set(), totalAmount: 0,
        sortingWeight: 0, sortingDocIds: new Set(),
        dismantlingWeight: 0, dismantlingDocIds: new Set(),
      });
    }
    return aggMap.get(productId)!;
  }

  // 1. BuyBills → purchase bucket
  for (const bill of bills) {
    for (const item of bill.items) {
      if (!productIdsInCategory.has(item.productId)) continue;
      allRelevantDocIds.add(bill.id);
      const agg = ensure(item.productId);
      agg.purchaseWeight += item.weight;
      agg.totalAmount += item.totalAmount;
      agg.purchaseBillIds.add(bill.id);
    }
  }

  // 2. SortingBills → sorting bucket (isWaste=false items only)
  for (const bill of sortingBills) {
    for (const item of bill.items) {
      if (item.isWaste) continue;
      if (!productIdsInCategory.has(item.productId)) continue;
      allRelevantDocIds.add(bill.id);
      const agg = ensure(item.productId);
      agg.sortingWeight += item.weight;
      agg.sortingDocIds.add(bill.id);
    }
  }

  // 3. StockTransfers → split between sorting-transfer and dismantling buckets
  for (const transfer of transfers) {
    for (const item of transfer.items) {
      if (item.isWaste) continue;
      if (!productIdsInCategory.has(item.productId)) continue;
      allRelevantDocIds.add(transfer.id);
      const agg = ensure(item.productId);
      if (isSortingTransferBusinessType(transfer.businessType)) {
        agg.sortingWeight += item.weight;
        agg.sortingDocIds.add(transfer.id);
      } else if (isDismantlingBusinessType(transfer.businessType)) {
        agg.dismantlingWeight += item.weight;
        agg.dismantlingDocIds.add(transfer.id);
      }
      // Any other businessType value is ignored (defensive; spec only defines
      // 'คัดแยก' / 'แกะของ' / null/blank).
    }
  }

  // Build result — sorted by product sortOrder
  const items: AggregatedProduct[] = [];
  let totalPurchaseWeight = 0;
  let totalSortingWeight = 0;
  let totalDismantlingWeight = 0;

  for (const product of productsInCategory) {
    const agg = aggMap.get(product.id);
    if (!agg) continue;

    const purchaseWeight = Math.round(agg.purchaseWeight * 100) / 100;
    const sortingOutputWeight = Math.round(agg.sortingWeight * 100) / 100;
    const dismantlingOutputWeight = Math.round(agg.dismantlingWeight * 100) / 100;
    const expectedTotalWeight = Math.round((purchaseWeight + sortingOutputWeight + dismantlingOutputWeight) * 100) / 100;

    if (expectedTotalWeight <= 0) continue;

    items.push({
      productId: product.id,
      productName: product.name,
      purchaseWeight,
      purchaseBillCount: agg.purchaseBillIds.size,
      sortingOutputWeight,
      sortingBillCount: agg.sortingDocIds.size,
      dismantlingOutputWeight,
      dismantlingRecordCount: agg.dismantlingDocIds.size,
      expectedTotalWeight,
      totalAmount: Math.round(agg.totalAmount * 100) / 100,
    });
    totalPurchaseWeight += purchaseWeight;
    totalSortingWeight += sortingOutputWeight;
    totalDismantlingWeight += dismantlingOutputWeight;
  }

  return {
    date: dateStr,
    category,
    totalBills: allRelevantDocIds.size,
    productCount: items.length,
    totalPurchaseWeight: Math.round(totalPurchaseWeight * 100) / 100,
    totalSortingWeight: Math.round(totalSortingWeight * 100) / 100,
    totalDismantlingWeight: Math.round(totalDismantlingWeight * 100) / 100,
    totalExpectedWeight: Math.round((totalPurchaseWeight + totalSortingWeight + totalDismantlingWeight) * 100) / 100,
    items,
  };
}

// ============ POST input validation ============

export interface WeighingPostItem {
  productId: string;
  actualWeighedWeight: number | null;
  note?: string;
}

export interface WeighingPostInput {
  weighingDate: string;
  category: string;
  note?: string;
  items: WeighingPostItem[];
}

export type ValidationResult =
  | { valid: true; input: WeighingPostInput }
  | { valid: false; error: string; status: number };

/**
 * Validate POST input for daily weighing session.
 * Pure function — no DB access, no side effects.
 *
 * Client payload shape is UNCHANGED from ST-35:
 *   { weighingDate, category, note?, items: [{ productId, actualWeighedWeight, note? }] }
 * The server still ignores any extra source-total fields the client might send
 * (they are recomputed server-side in `buildSessionItems`).
 *
 * This is the SAME function used by the production POST route.
 */
export function validateWeighingPostInput(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Invalid request body', status: 400 };
  }

  const { weighingDate, category, items } = body as Record<string, unknown>;

  if (!weighingDate || typeof weighingDate !== 'string' || !isValidWeighingDate(weighingDate)) {
    return { valid: false, error: 'รูปแบบวันที่ไม่ถูกต้อง', status: 400 };
  }
  if (!category || typeof category !== 'string' || !isValidWeighingCategory(category)) {
    return { valid: false, error: 'หมวดหมู่ต้องเป็น ทองแดง หรือ ทองเหลือง', status: 400 };
  }
  if (!items || !Array.isArray(items) || items.length === 0) {
    return { valid: false, error: 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ', status: 400 };
  }

  // Reject duplicate productId + validate each item
  const seenProductIds = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      return { valid: false, error: 'รายการต้องเป็น object', status: 400 };
    }
    const { productId, actualWeighedWeight } = item as Record<string, unknown>;
    if (!productId || typeof productId !== 'string') {
      return { valid: false, error: 'รายการต้องมี productId', status: 400 };
    }
    if (seenProductIds.has(productId)) {
      return { valid: false, error: `productId ซ้ำ: ${productId}`, status: 400 };
    }
    seenProductIds.add(productId);

    if (!isValidActualWeighedWeight(actualWeighedWeight)) {
      return { valid: false, error: `น้ำหนักชั่งจริงไม่ถูกต้องสำหรับ productId: ${productId}`, status: 400 };
    }
  }

  return {
    valid: true,
    input: {
      weighingDate,
      category,
      note: (body as Record<string, unknown>).note as string | undefined,
      items: items.map((item: Record<string, unknown>) => ({
        productId: item.productId as string,
        actualWeighedWeight: (item.actualWeighedWeight as number | null) ?? null,
        note: item.note as string | undefined,
      })),
    },
  };
}

// ============ Session item builder (server recomputation) ============

export interface SessionItemData {
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

/**
 * Build session items from server aggregation + client input.
 *
 * SERVER controls: purchaseWeight, purchaseBillCount, sortingOutputWeight,
 *                  sortingBillCount, dismantlingOutputWeight,
 *                  dismantlingRecordCount, expectedTotalWeight,
 *                  differenceWeight, status
 * CLIENT controls: actualWeighedWeight, note
 *
 * Blocks productIds that don't exist in the aggregation.
 * Pure function — no DB access.
 *
 * This is the SAME function used by the production POST route.
 */
export function buildSessionItems(
  aggregation: AggregationResult,
  clientItems: WeighingPostItem[]
): { ok: true; items: SessionItemData[] } | { ok: false; error: string; status: number } {
  const validProducts = new Map(aggregation.items.map(item => [item.productId, item]));

  // Block productIds that don't have any source contribution (purchase/sorting/dismantling)
  for (const item of clientItems) {
    if (!validProducts.has(item.productId)) {
      return {
        ok: false,
        error: `สินค้า ${item.productId} ไม่มียอดในวันที่และหมวดที่เลือก`,
        status: 400,
      };
    }
  }

  const sessionItems: SessionItemData[] = clientItems.map(item => {
    const agg = validProducts.get(item.productId)!;
    const actual = item.actualWeighedWeight ?? null;
    const { difference, status } = calculateWeighingStatus(actual, agg.expectedTotalWeight);

    return {
      productId: item.productId,
      purchaseWeight: agg.purchaseWeight,             // server-computed
      purchaseBillCount: agg.purchaseBillCount,        // server-computed
      sortingOutputWeight: agg.sortingOutputWeight,    // server-computed
      sortingBillCount: agg.sortingBillCount,          // server-computed
      dismantlingOutputWeight: agg.dismantlingOutputWeight, // server-computed
      dismantlingRecordCount: agg.dismantlingRecordCount,   // server-computed
      expectedTotalWeight: agg.expectedTotalWeight,    // server-computed
      actualWeighedWeight: actual,
      differenceWeight: difference,                    // server-computed (actual - expectedTotal)
      status,                                          // server-computed
      note: item.note || null,
    };
  });

  return { ok: true, items: sessionItems };
}
