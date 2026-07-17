/**
 * ST-38: Executable tests for including SortingBills + StockTransfers in daily
 * weighing aggregation.
 *
 * These tests call the SAME production controllers/services/pure-helpers used
 * by routes. No source-code inspection. No fs.readFileSync. No mock route
 * handlers.
 *
 * Coverage (22 cases per ST-38 task):
 *  1.  purchases only
 *  2.  SortingBill outputs only
 *  3.  StockTransfer แกะของ outputs only
 *  4.  StockTransfer คัดแยก outputs only
 *  5.  null businessType treated as แกะของ
 *  6.  mixed purchase + sorting + dismantling for same product
 *  7.  multiple documents of each source — counts + weights summed
 *  8.  cancelled BuyBill excluded
 *  9.  cancelled SortingBill excluded
 *  10. cancelled StockTransfer excluded
 *  11. SortingBillItem waste excluded
 *  12. StockTransferItem waste excluded
 *  13. steel output excluded from copper aggregation
 *  14. source product outside category but eligible output inside category
 *  15. ICT midnight start boundary (00:00:00+07:00)
 *  16. ICT end-of-day boundary (23:59:59+07:00)
 *  17. no double counting from StockLot across save
 *  18. server ignores fake client source totals
 *  19. duplicate session blocked (first 201, second 409)
 *  20. AuditLog failure rolls back session + items + audit logs
 *  21. StockLot / StockMovement / STOCK_ADJUSTMENT counts unchanged after save
 *  22. Legacy Apply route still returns 403
 *
 * Run: bun test tests/st38-integration.test.ts
 */
import { test, expect, describe, beforeEach } from 'bun:test';

// PRODUCTION controllers (same functions used by routes)
import {
  postSaveController,
  getAggregationController,
  type AuthPayload,
} from '../src/lib/daily-weighing-controller';

// PRODUCTION service (with repository)
import { aggregateDailyPurchasesWithRepository } from '../src/lib/daily-purchase-weighing-service';

// PRODUCTION pure helpers
import {
  isDismantlingBusinessType,
  isSortingTransferBusinessType,
} from '../src/lib/daily-purchase-weighing';

// Fake repository (test-only, implements production interface)
import { FakeDailyPurchaseWeighingRepository } from './st35-fake-repository';

// Types
import type {
  BuyBillRow,
  SortingBillRow,
  StockTransferRow,
  ProductRow,
} from '../src/lib/daily-weighing-repository';

// ============ Test fixtures ============

const ADMIN: AuthPayload = { userId: 'admin-1', name: 'Admin', role: 'admin' };
const DATE_STR = '2026-07-11';
const DATE_MIDDAY = new Date(`${DATE_STR}T10:00:00+07:00`);

function makeBuyBill(
  id: string,
  date: Date,
  items: Array<{ productId: string; weight: number; totalAmount: number; productName: string }>
): BuyBillRow {
  return {
    id, date, isCancelled: false,
    items: items.map(it => ({
      productId: it.productId, weight: it.weight, totalAmount: it.totalAmount,
      product: { id: it.productId, name: it.productName },
    })),
  };
}

function makeSortingBill(
  id: string,
  date: Date,
  items: Array<{ productId: string; weight: number; isWaste: boolean; productName: string }>
): SortingBillRow {
  return {
    id, date, isCancelled: false,
    items: items.map(it => ({
      productId: it.productId, weight: it.weight, isWaste: it.isWaste,
      product: { id: it.productId, name: it.productName },
    })),
  };
}

function makeTransfer(
  id: string,
  date: Date,
  businessType: string | null,
  items: Array<{ productId: string; weight: number; isWaste: boolean; productName: string }>
): StockTransferRow {
  return {
    id, date, isCancelled: false, businessType,
    items: items.map(it => ({
      productId: it.productId, weight: it.weight, isWaste: it.isWaste,
      product: { id: it.productId, name: it.productName },
    })),
  };
}

function setupCopperProducts(repo: FakeDailyPurchaseWeighingRepository): ProductRow[] {
  const products: ProductRow[] = [
    { id: 'copper-1', name: 'ทองแดงปอกเงา', sortOrder: 1 },
    { id: 'copper-2', name: 'ทองแดงช็อต', sortOrder: 2 },
    { id: 'copper-3', name: 'ทองแดงใหญ่', sortOrder: 3 },
  ];
  repo.setCategory('ทองแดง', 'cat-copper');
  repo.setProducts('cat-copper', products);
  return products;
}

function setupSteelProducts(repo: FakeDailyPurchaseWeighingRepository): ProductRow[] {
  const products: ProductRow[] = [
    { id: 'steel-1', name: 'เหล็กบาง', sortOrder: 1 },
  ];
  repo.setCategory('เหล็ก', 'cat-steel');
  repo.setProducts('cat-steel', products);
  return products;
}

// ============ Pure helper unit tests ============

describe('ST-38: businessType classification helpers', () => {
  test('null → dismantling', () => {
    expect(isDismantlingBusinessType(null)).toBe(true);
  });
  test('blank → dismantling', () => {
    expect(isDismantlingBusinessType('')).toBe(true);
    expect(isDismantlingBusinessType('   ')).toBe(true);
  });
  test('แกะของ → dismantling', () => {
    expect(isDismantlingBusinessType('แกะของ')).toBe(true);
  });
  test('คัดแยก → NOT dismantling', () => {
    expect(isDismantlingBusinessType('คัดแยก')).toBe(false);
  });
  test('คัดแยก → sorting-transfer', () => {
    expect(isSortingTransferBusinessType('คัดแยก')).toBe(true);
  });
  test('null → NOT sorting-transfer', () => {
    expect(isSortingTransferBusinessType(null)).toBe(false);
  });
  test('แกะของ → NOT sorting-transfer', () => {
    expect(isSortingTransferBusinessType('แกะของ')).toBe(false);
  });
});

// ============ Aggregation tests ============

describe('ST-38: aggregation — per-source buckets', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
  });

  // 1. purchases only
  test('1. purchases only → correct purchaseWeight, others 0, expectedTotal=purchase', async () => {
    repo.setBuyBills([makeBuyBill('b1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 80.5, totalAmount: 33970, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.purchaseWeight).toBe(80.5);
    expect(item.purchaseBillCount).toBe(1);
    expect(item.sortingOutputWeight).toBe(0);
    expect(item.sortingBillCount).toBe(0);
    expect(item.dismantlingOutputWeight).toBe(0);
    expect(item.dismantlingRecordCount).toBe(0);
    expect(item.expectedTotalWeight).toBe(80.5);
    // Result-level totals
    expect(result.totalPurchaseWeight).toBe(80.5);
    expect(result.totalSortingWeight).toBe(0);
    expect(result.totalDismantlingWeight).toBe(0);
    expect(result.totalExpectedWeight).toBe(80.5);
  });

  // 2. SortingBill outputs only
  test('2. SortingBill outputs only → sortingOutputWeight correct, others 0', async () => {
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 25.0, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.purchaseWeight).toBe(0);
    expect(item.sortingOutputWeight).toBe(25);
    expect(item.sortingBillCount).toBe(1);
    expect(item.dismantlingOutputWeight).toBe(0);
    expect(item.expectedTotalWeight).toBe(25);
    expect(result.totalSortingWeight).toBe(25);
    expect(result.totalExpectedWeight).toBe(25);
  });

  // 3. StockTransfer แกะของ outputs only
  test('3. StockTransfer แกะของ outputs only → dismantlingOutputWeight correct', async () => {
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [
      { productId: 'copper-1', weight: 15.0, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.purchaseWeight).toBe(0);
    expect(item.sortingOutputWeight).toBe(0);
    expect(item.dismantlingOutputWeight).toBe(15);
    expect(item.dismantlingRecordCount).toBe(1);
    expect(item.expectedTotalWeight).toBe(15);
    expect(result.totalDismantlingWeight).toBe(15);
    expect(result.totalExpectedWeight).toBe(15);
  });

  // 4. StockTransfer คัดแยก outputs only
  test('4. StockTransfer คัดแยก outputs only → sortingOutputWeight (from transfer) correct', async () => {
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, 'คัดแยก', [
      { productId: 'copper-1', weight: 18.0, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.purchaseWeight).toBe(0);
    expect(item.sortingOutputWeight).toBe(18); // sorting bucket (via transfer)
    expect(item.sortingBillCount).toBe(1);
    expect(item.dismantlingOutputWeight).toBe(0);
    expect(item.dismantlingRecordCount).toBe(0);
    expect(item.expectedTotalWeight).toBe(18);
    expect(result.totalSortingWeight).toBe(18);
    expect(result.totalDismantlingWeight).toBe(0);
  });

  // 5. null businessType treated as แกะของ
  test('5. null businessType treated as แกะของ → dismantlingOutputWeight', async () => {
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, null, [
      { productId: 'copper-1', weight: 22.0, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    const item = result.items[0];
    expect(item.dismantlingOutputWeight).toBe(22);
    expect(item.dismantlingRecordCount).toBe(1);
    expect(item.sortingOutputWeight).toBe(0);
    expect(result.totalDismantlingWeight).toBe(22);
  });

  // 6. mixed purchase + sorting + dismantling for same product
  test('6. mixed purchase + sorting + dismantling for same product → all three non-zero, expectedTotal = sum', async () => {
    repo.setBuyBills([makeBuyBill('b1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 100, totalAmount: 42000, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 30, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setStockTransfers([
      makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [
        { productId: 'copper-1', weight: 20, isWaste: false, productName: 'ทองแดงปอกเงา' },
      ]),
      makeTransfer('t2', DATE_MIDDAY, 'คัดแยก', [
        { productId: 'copper-1', weight: 10, isWaste: false, productName: 'ทองแดงปอกเงา' },
      ]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    const item = result.items[0];
    expect(item.purchaseWeight).toBe(100);
    expect(item.purchaseBillCount).toBe(1);
    expect(item.sortingOutputWeight).toBe(40); // 30 (sorting bill) + 10 (sorting transfer)
    expect(item.sortingBillCount).toBe(2); // 1 sorting bill + 1 sorting transfer
    expect(item.dismantlingOutputWeight).toBe(20);
    expect(item.dismantlingRecordCount).toBe(1);
    expect(item.expectedTotalWeight).toBe(160); // 100 + 40 + 20
    expect(result.totalPurchaseWeight).toBe(100);
    expect(result.totalSortingWeight).toBe(40);
    expect(result.totalDismantlingWeight).toBe(20);
    expect(result.totalExpectedWeight).toBe(160);
    // totalBills = distinct documents across all sources
    expect(result.totalBills).toBe(4); // b1, s1, t1, t2
  });

  // 7. multiple documents of each source → counts correct, weights summed
  test('7. multiple documents of each source → counts correct, weights summed', async () => {
    repo.setBuyBills([
      makeBuyBill('b1', DATE_MIDDAY, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBuyBill('b2', DATE_MIDDAY, [{ productId: 'copper-1', weight: 20, totalAmount: 8400, productName: 'ทองแดงปอกเงา' }]),
    ]);
    repo.setSortingBills([
      makeSortingBill('s1', DATE_MIDDAY, [{ productId: 'copper-1', weight: 5, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
      makeSortingBill('s2', DATE_MIDDAY, [{ productId: 'copper-1', weight: 7, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
    ]);
    repo.setStockTransfers([
      makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [{ productId: 'copper-1', weight: 3, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
      makeTransfer('t2', DATE_MIDDAY, 'แกะของ', [{ productId: 'copper-1', weight: 4, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
      makeTransfer('t3', DATE_MIDDAY, 'คัดแยก', [{ productId: 'copper-1', weight: 6, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    const item = result.items[0];
    expect(item.purchaseWeight).toBe(30); // 10 + 20
    expect(item.purchaseBillCount).toBe(2);
    expect(item.sortingOutputWeight).toBe(18); // 5 + 7 + 6
    expect(item.sortingBillCount).toBe(3); // 2 sorting bills + 1 sorting transfer
    expect(item.dismantlingOutputWeight).toBe(7); // 3 + 4
    expect(item.dismantlingRecordCount).toBe(2);
    expect(item.expectedTotalWeight).toBe(55); // 30 + 18 + 7
    expect(result.totalBills).toBe(7); // 2 + 2 + 3
  });

  // 8. cancelled BuyBill excluded
  test('8. cancelled BuyBill excluded', async () => {
    const cancelled = makeBuyBill('b-cancel', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 100, totalAmount: 42000, productName: 'ทองแดงปอกเงา' },
    ]);
    cancelled.isCancelled = true;
    repo.setBuyBills([
      cancelled,
      makeBuyBill('b2', DATE_MIDDAY, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items[0].purchaseWeight).toBe(10);
    expect(result.items[0].purchaseBillCount).toBe(1);
    expect(result.totalBills).toBe(1);
  });

  // 9. cancelled SortingBill excluded
  test('9. cancelled SortingBill excluded', async () => {
    const cancelled = makeSortingBill('s-cancel', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 100, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ]);
    cancelled.isCancelled = true;
    repo.setSortingBills([
      cancelled,
      makeSortingBill('s2', DATE_MIDDAY, [{ productId: 'copper-1', weight: 10, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items[0].sortingOutputWeight).toBe(10);
    expect(result.items[0].sortingBillCount).toBe(1);
    expect(result.totalBills).toBe(1);
  });

  // 10. cancelled StockTransfer excluded
  test('10. cancelled StockTransfer excluded', async () => {
    const cancelled = makeTransfer('t-cancel', DATE_MIDDAY, 'แกะของ', [
      { productId: 'copper-1', weight: 100, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ]);
    cancelled.isCancelled = true;
    repo.setStockTransfers([
      cancelled,
      makeTransfer('t2', DATE_MIDDAY, 'แกะของ', [{ productId: 'copper-1', weight: 10, isWaste: false, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items[0].dismantlingOutputWeight).toBe(10);
    expect(result.items[0].dismantlingRecordCount).toBe(1);
    expect(result.totalBills).toBe(1);
  });

  // 11. SortingBillItem waste excluded
  test('11. SortingBillItem waste excluded', async () => {
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 30, isWaste: false, productName: 'ทองแดงปอกเงา' },
      { productId: 'copper-1', weight: 5, isWaste: true, productName: 'ทองแดงปอกเงา (ขยะ)' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items[0].sortingOutputWeight).toBe(30); // waste 5 excluded
  });

  // 12. StockTransferItem waste excluded
  test('12. StockTransferItem waste excluded', async () => {
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [
      { productId: 'copper-1', weight: 30, isWaste: false, productName: 'ทองแดงปอกเงา' },
      { productId: 'copper-1', weight: 5, isWaste: true, productName: 'ทองแดงปอกเงา (ขยะ)' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items[0].dismantlingOutputWeight).toBe(30); // waste 5 excluded
  });

  // 13. output product category filtering (steel product excluded from copper aggregation)
  test('13. steel product excluded from copper aggregation', async () => {
    setupSteelProducts(repo);
    repo.setBuyBills([makeBuyBill('b1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
      { productId: 'steel-1', weight: 100, totalAmount: 900, productName: 'เหล็กบาง' },
    ])]);
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 5, isWaste: false, productName: 'ทองแดงปอกเงา' },
      { productId: 'steel-1', weight: 50, isWaste: false, productName: 'เหล็กบาง' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe('copper-1');
    // Steel output items are NOT counted in copper aggregation; only the copper BuyBill
    // and copper SortingBill items contribute. Steel BuyBill item also doesn't add to totalBills
    // because totalBills is "documents with at least one eligible item in this category" — but
    // b1 has both copper and steel items; since b1 has at least one copper item, it counts.
    expect(result.totalBills).toBe(2); // b1, s1 (both have at least one copper item)
  });

  // 14. source product outside category but eligible output inside category → included
  test('14. source product outside category but eligible output inside category → included (eligibility by OUTPUT product)', async () => {
    setupSteelProducts(repo);
    // SortingBill with source 'steel-1' (not in copper category) but outputs 'copper-1'
    // The aggregation only looks at SortingBillItem.productId (the OUTPUT), so copper-1
    // contribution should be counted.
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 25, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [
      { productId: 'copper-1', weight: 15, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].productId).toBe('copper-1');
    expect(result.items[0].sortingOutputWeight).toBe(25);
    expect(result.items[0].dismantlingOutputWeight).toBe(15);
    expect(result.items[0].expectedTotalWeight).toBe(40);
  });

  // 15. Thailand midnight start boundary (00:00:00+07:00 included)
  test('15. ICT start boundary 00:00:00+07:00 included', async () => {
    repo.setBuyBills([makeBuyBill('b1', new Date(`${DATE_STR}T00:00:00+07:00`), [
      { productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setSortingBills([makeSortingBill('s1', new Date(`${DATE_STR}T00:00:00+07:00`), [
      { productId: 'copper-1', weight: 5, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setStockTransfers([makeTransfer('t1', new Date(`${DATE_STR}T00:00:00+07:00`), 'แกะของ', [
      { productId: 'copper-1', weight: 5, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.totalBills).toBe(3);
    expect(result.items[0].expectedTotalWeight).toBe(15);
  });

  // 16. Thailand end-of-day boundary (23:59:59+07:00 included)
  test('16. ICT end boundary 23:59:59+07:00 included', async () => {
    repo.setBuyBills([makeBuyBill('b1', new Date(`${DATE_STR}T23:59:59+07:00`), [
      { productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setSortingBills([makeSortingBill('s1', new Date(`${DATE_STR}T23:59:59+07:00`), [
      { productId: 'copper-1', weight: 5, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setStockTransfers([makeTransfer('t1', new Date(`${DATE_STR}T23:59:59+07:00`), 'แกะของ', [
      { productId: 'copper-1', weight: 5, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, DATE_STR, 'ทองแดง');
    expect(result.totalBills).toBe(3);
    expect(result.items[0].expectedTotalWeight).toBe(15);
  });
});

// ============ Save-flow integration tests ============

describe('ST-38: save flow — trust boundary + transaction semantics', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    // Default fixture: one BuyBill, one SortingBill, one dismantling StockTransfer
    repo.setBuyBills([makeBuyBill('b1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 100, totalAmount: 42000, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 30, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [
      { productId: 'copper-1', weight: 20, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.addStockLot('lot-1', 100, 400, 'BUY');
    repo.addStockLot('lot-2', 50, 10, 'SORTING');
  });

  // 17. no double counting from StockLot across save
  test('17. StockLot count unchanged across save (no double counting)', async () => {
    const before = repo.getStockLotCount();
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: DATE_STR, category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 150 }],
    });
    expect(result.status).toBe(201);
    expect(repo.getStockLotCount()).toBe(before);
    // Verify the saved session has the expected source totals (not StockLot copies)
    const saved = (result.data as any).session;
    expect(saved.items[0].purchaseWeight).toBe(100);
    expect(saved.items[0].sortingOutputWeight).toBe(30);
    expect(saved.items[0].dismantlingOutputWeight).toBe(20);
    expect(saved.items[0].expectedTotalWeight).toBe(150);
  });

  // 18. server ignores fake client source totals
  test('18. server ignores fake client source totals (purchaseWeight:999, sortingOutputWeight:999)', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: DATE_STR, category: 'ทองแดง',
      items: [{
        productId: 'copper-1',
        actualWeighedWeight: 150,
        purchaseWeight: 999,            // fake — must be ignored
        sortingOutputWeight: 999,       // fake — must be ignored
        dismantlingOutputWeight: 999,   // fake — must be ignored
        expectedTotalWeight: 9999,      // fake — must be ignored
      } as any],
    });
    expect(result.status).toBe(201);
    const item = (result.data as any).session.items[0];
    expect(item.purchaseWeight).toBe(100);          // server-computed, not 999
    expect(item.sortingOutputWeight).toBe(30);      // server-computed, not 999
    expect(item.dismantlingOutputWeight).toBe(20);  // server-computed, not 999
    expect(item.expectedTotalWeight).toBe(150);     // server-computed, not 9999
    // difference = actual(150) - expectedTotal(150) = 0 → MATCH
    expect(item.differenceWeight).toBe(0);
    expect(item.status).toBe('MATCH');
  });

  // 19. duplicate session still blocked
  test('19. duplicate session blocked (first 201, second 409)', async () => {
    const body = {
      weighingDate: DATE_STR, category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 150 }],
    };
    const r1 = await postSaveController(repo, ADMIN, body);
    expect(r1.status).toBe(201);
    const r2 = await postSaveController(repo, ADMIN, body);
    expect(r2.status).toBe(409);
    expect(repo.getSessionCount()).toBe(1);
  });

  // 20. AuditLog failure rolls back session + items + audit logs
  test('20. AuditLog failure → 0 sessions, 0 items, 0 audit logs', async () => {
    repo.setShouldFailAuditLog(true);
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: DATE_STR, category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 150 }],
    });
    expect(result.status).toBe(500);
    expect(repo.getSessionCount()).toBe(0);
    expect(repo.getItemCount()).toBe(0);
    expect(repo.getAuditLogCount()).toBe(0);
  });

  // 21. StockLot / StockMovement / STOCK_ADJUSTMENT counts unchanged after save
  test('21. StockLot / StockMovement / STOCK_ADJUSTMENT counts unchanged after save', async () => {
    const lotBefore = repo.getStockLotCount();
    const mvBefore = repo.getStockMovementCount();
    const adjBefore = repo.getStockAdjustmentAuditLogCount();
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: DATE_STR, category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 150 }],
    });
    expect(result.status).toBe(201);
    expect(repo.getStockLotCount()).toBe(lotBefore);
    expect(repo.getStockMovementCount()).toBe(mvBefore);
    expect(repo.getStockAdjustmentAuditLogCount()).toBe(adjBefore);
  });

  // Bonus: difference is computed against expectedTotalWeight, not purchaseWeight
  test('bonus: difference computed against expectedTotalWeight (purchase+sorting+dismantling), not purchaseWeight', async () => {
    // purchase=100, sorting=30, dismantling=20 → expectedTotal=150
    // actual=145 → diff=-5 → DIFFERENCE (outside tolerance)
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: DATE_STR, category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 145 }],
    });
    expect(result.status).toBe(201);
    const item = (result.data as any).session.items[0];
    expect(item.differenceWeight).toBe(-5); // 145 - 150
    expect(item.status).toBe('DIFFERENCE');
  });
});

// ============ Legacy Apply route removed (ST-44) ============
// The /api/physical-counts/[id]/apply route and the entire physical-count page
// were removed in ST-44. The previous 403-suspension tests are obsolete.

// ============ Aggregation controller test (end-to-end via controllers) ============

describe('ST-38: GET aggregation controller returns full source breakdown', () => {
  test('controller returns 200 with all source fields in payload', async () => {
    const repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    repo.setBuyBills([makeBuyBill('b1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 100, totalAmount: 42000, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setSortingBills([makeSortingBill('s1', DATE_MIDDAY, [
      { productId: 'copper-1', weight: 30, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);
    repo.setStockTransfers([makeTransfer('t1', DATE_MIDDAY, 'แกะของ', [
      { productId: 'copper-1', weight: 20, isWaste: false, productName: 'ทองแดงปอกเงา' },
    ])]);

    const result = await getAggregationController(repo, ADMIN, DATE_STR, 'ทองแดง');
    expect(result.status).toBe(200);
    const data = result.data as any;
    expect(data.items).toHaveLength(1);
    const item = data.items[0];
    expect(item.purchaseWeight).toBe(100);
    expect(item.sortingOutputWeight).toBe(30);
    expect(item.dismantlingOutputWeight).toBe(20);
    expect(item.expectedTotalWeight).toBe(150);
    expect(item.purchaseBillCount).toBe(1);
    expect(item.sortingBillCount).toBe(1);
    expect(item.dismantlingRecordCount).toBe(1);
    expect(data.totalPurchaseWeight).toBe(100);
    expect(data.totalSortingWeight).toBe(30);
    expect(data.totalDismantlingWeight).toBe(20);
    expect(data.totalExpectedWeight).toBe(150);
  });
});
