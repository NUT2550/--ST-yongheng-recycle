/**
 * ST-35: Server-side aggregation service for daily purchase weighing.
 *
 * Pure functions shared by GET and POST endpoints — no duplicated logic.
 * Never reads StockLot. Never writes stock.
 */

import { db } from '@/lib/db';

// Thailand timezone offset: UTC+7
const TOLERANCE = 0.10; // ±0.10 kg per Owner decision

export const WEIGHING_CATEGORIES = ['ทองแดง', 'ทองเหลือง'] as const;
export type WeighingCategory = (typeof WEIGHING_CATEGORIES)[number];

export interface AggregatedProduct {
  productId: string;
  productName: string;
  purchasedWeight: number;
  purchaseBillCount: number;
  totalAmount: number;
}

export interface AggregationResult {
  date: string;
  category: string;
  totalBills: number;
  productCount: number;
  totalPurchasedWeight: number;
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
 */
export function calculateWeighingStatus(
  actualWeighedWeight: number | null | undefined,
  purchasedWeight: number
): { difference: number | null; status: 'MATCH' | 'DIFFERENCE' | 'NOT_WEIGHED' } {
  if (actualWeighedWeight === null || actualWeighedWeight === undefined) {
    return { difference: null, status: 'NOT_WEIGHED' };
  }
  const difference = Math.round((actualWeighedWeight - purchasedWeight) * 100) / 100;
  const status = Math.abs(difference) <= TOLERANCE ? 'MATCH' : 'DIFFERENCE';
  return { difference, status };
}

/**
 * Aggregate BuyBillItems for a specific date and category.
 *
 * SINGLE source of truth — used by both GET (preview) and POST (save).
 *
 * Rules:
 * - Uses BuyBill.date (not createdAt) for business date
 * - Excludes cancelled bills (isCancelled = false)
 * - Groups by productId within the selected category
 * - Counts distinct bills per product
 * - totalBills = distinct bills with at least one item in category
 * - Returns only products with purchasedWeight > 0
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

  const bills = await db.buyBill.findMany({
    where: {
      isCancelled: false,
      date: { gte: startDate, lte: endDate },
    },
    include: {
      items: { include: { product: { select: { id: true, name: true } } } },
    },
  });

  // Aggregate by product
  const aggMap = new Map<string, {
    purchasedWeight: number;
    totalAmount: number;
    billIds: Set<string>;
  }>();

  // Track all distinct bill IDs that have at least one item in this category
  const allRelevantBillIds = new Set<string>();

  for (const bill of bills) {
    for (const item of bill.items) {
      if (!productIdsInCategory.has(item.productId)) continue;

      allRelevantBillIds.add(bill.id);

      if (!aggMap.has(item.productId)) {
        aggMap.set(item.productId, {
          purchasedWeight: 0,
          totalAmount: 0,
          billIds: new Set(),
        });
      }
      const agg = aggMap.get(item.productId)!;
      agg.purchasedWeight += item.weight;
      agg.totalAmount += item.totalAmount;
      agg.billIds.add(bill.id);
    }
  }

  // Build result — sorted by product sortOrder
  const items: AggregatedProduct[] = [];
  let totalPurchasedWeight = 0;

  for (const product of productsInCategory) {
    const agg = aggMap.get(product.id);
    if (!agg || agg.purchasedWeight <= 0) continue;

    const purchasedWeight = Math.round(agg.purchasedWeight * 100) / 100;
    const totalAmount = Math.round(agg.totalAmount * 100) / 100;

    items.push({
      productId: product.id,
      productName: product.name,
      purchasedWeight,
      purchaseBillCount: agg.billIds.size,
      totalAmount,
    });
    totalPurchasedWeight += purchasedWeight;
  }

  return {
    date: dateStr,
    category,
    totalBills: allRelevantBillIds.size,
    productCount: items.length,
    totalPurchasedWeight: Math.round(totalPurchasedWeight * 100) / 100,
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
  purchasedWeight: number;
  purchaseBillCount: number;
  actualWeighedWeight: number | null;
  differenceWeight: number | null;
  status: string;
  note: string | null;
}

/**
 * Build session items from server aggregation + client input.
 *
 * SERVER controls: purchasedWeight, purchaseBillCount, differenceWeight, status
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

  // Block productIds that don't have purchase bills
  for (const item of clientItems) {
    if (!validProducts.has(item.productId)) {
      return {
        ok: false,
        error: `สินค้า ${item.productId} ไม่มียอดซื้อในวันที่และหมวดที่เลือก`,
        status: 400,
      };
    }
  }

  const sessionItems: SessionItemData[] = clientItems.map(item => {
    const agg = validProducts.get(item.productId)!;
    const actual = item.actualWeighedWeight ?? null;
    const { difference, status } = calculateWeighingStatus(actual, agg.purchasedWeight);

    return {
      productId: item.productId,
      purchasedWeight: agg.purchasedWeight,       // server-computed
      purchaseBillCount: agg.purchaseBillCount,    // server-computed
      actualWeighedWeight: actual,
      differenceWeight: difference,                // server-computed
      status,                                      // server-computed
      note: item.note || null,
    };
  });

  return { ok: true, items: sessionItems };
}
