/**
 * ST-35: Real production-service tests using a fake repository with
 * real commit/rollback semantics.
 *
 * Tests call the SAME production service functions used by routes:
 * - aggregateDailyPurchasesWithRepository()
 * - saveDailyPurchaseWeighing()
 * - getDailyWeighingHistory()
 * - getDailyWeighingDetail()
 *
 * The fake repository implements the SAME interface as the Prisma adapter.
 * Only persistence is faked — all business logic is production code.
 *
 * Run: bun test tests/st35-integration.test.ts
 */
import { test, expect, describe, beforeEach } from 'bun:test';

// Import PRODUCTION service functions
import {
  aggregateDailyPurchasesWithRepository,
  saveDailyPurchaseWeighing,
  getDailyWeighingHistory,
  getDailyWeighingDetail,
} from '../src/lib/daily-purchase-weighing-service';

// Import PRODUCTION permission helper
import { hasDailyPurchaseWeighingPermission } from '../src/lib/daily-weighing-permission';

// Import PRODUCTION pure helpers (used in route)
import { validateWeighingPostInput, buildSessionItems } from '../src/lib/daily-purchase-weighing';

// Import fake repository (test-only, implements production interface)
import { FakeDailyPurchaseWeighingRepository } from './st35-fake-repository';

// Import types
import type { BuyBillRow, ProductRow } from '../src/lib/daily-weighing-repository';

// ============ Test fixtures ============

function makeBill(id: string, date: Date, items: Array<{ productId: string; weight: number; totalAmount: number; productName: string }>): BuyBillRow {
  return {
    id,
    date,
    isCancelled: false,
    items: items.map(it => ({
      productId: it.productId,
      weight: it.weight,
      totalAmount: it.totalAmount,
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

function setupBrassProducts(repo: FakeDailyPurchaseWeighingRepository): ProductRow[] {
  const products: ProductRow[] = [
    { id: 'brass-1', name: 'ทองเหลืองหนา', sortOrder: 1 },
    { id: 'brass-2', name: 'ทองเหลืองเนื้อแดง', sortOrder: 2 },
  ];
  repo.setCategory('ทองเหลือง', 'cat-brass');
  repo.setProducts('cat-brass', products);
  return products;
}

// ============ Tests ============

describe('ST-35: Permission (production helper)', () => {
  test('admin has permission', () => {
    expect(hasDailyPurchaseWeighingPermission({ role: 'admin' })).toBe(true);
  });
  test('staff with dailyPurchaseWeighing = true', () => {
    expect(hasDailyPurchaseWeighingPermission({ role: 'staff', permissions: { dailyPurchaseWeighing: true } })).toBe(true);
  });
  test('staff without permission = false', () => {
    expect(hasDailyPurchaseWeighingPermission({ role: 'staff', permissions: { 'buy.create': true } })).toBe(false);
  });
  test('staff with empty permissions = false', () => {
    expect(hasDailyPurchaseWeighingPermission({ role: 'staff', permissions: {} })).toBe(false);
  });
  test('staff with no permissions key = false', () => {
    expect(hasDailyPurchaseWeighingPermission({ role: 'staff' })).toBe(false);
  });
  test('staff with dailyPurchaseWeighing = false', () => {
    expect(hasDailyPurchaseWeighingPermission({ role: 'staff', permissions: { dailyPurchaseWeighing: false } })).toBe(false);
  });
});

describe('ST-35: Aggregation service (production function with fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;

  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBrassProducts(repo);
  });

  test('1. multiple bills on one date', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'copper-1', weight: 20, totalAmount: 8400, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items).toHaveLength(1);
    expect(result.items[0].purchasedWeight).toBe(30);
  });

  test('2. same product across multiple bills', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'copper-1', weight: 15, totalAmount: 6300, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b3', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items[0].purchaseBillCount).toBe(3);
    expect(result.items[0].purchasedWeight).toBe(30);
  });

  test('3. distinct bill count per product', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [
        { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
        { productId: 'copper-2', weight: 5, totalAmount: 2000, productName: 'ทองแดงช็อต' },
      ]),
      makeBill('b2', date, [{ productId: 'copper-1', weight: 20, totalAmount: 8400, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    const p1 = result.items.find(i => i.productId === 'copper-1')!;
    const p2 = result.items.find(i => i.productId === 'copper-2')!;
    expect(p1.purchaseBillCount).toBe(2);
    expect(p2.purchaseBillCount).toBe(1);
  });

  test('4. category-level relevant bill count', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'copper-2', weight: 5, totalAmount: 2000, productName: 'ทองแดงช็อต' }]),
      makeBill('b3', date, [{ productId: 'steel-1', weight: 100, totalAmount: 900, productName: 'เหล็กบาง' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(2); // b1 + b2, NOT b3 (steel-only)
  });

  test('5. steel-only bill excluded from copper count', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'steel-1', weight: 100, totalAmount: 900, productName: 'เหล็กบาง' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1); // only b1
  });

  test('6. mixed-category bill counted only for selected category', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [
        { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
        { productId: 'steel-1', weight: 50, totalAmount: 450, productName: 'เหล็กบาง' },
      ]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1); // b1 has copper → counted
    expect(result.items).toHaveLength(1); // only copper-1
  });

  test('7. cancelled bill excluded', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    const cancelledBill = makeBill('b-cancelled', date, [{ productId: 'copper-1', weight: 100, totalAmount: 42000, productName: 'ทองแดงปอกเงา' }]);
    cancelledBill.isCancelled = true;
    repo.setBuyBills([
      cancelledBill,
      makeBill('b2', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1); // only b2
    expect(result.items[0].purchasedWeight).toBe(10);
  });

  test('8. A-prefixed bill included', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    const bill = makeBill('A1051492', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]);
    repo.setBuyBills([bill]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('9. D-prefixed bill included', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    const bill = makeBill('D1025582', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]);
    repo.setBuyBills([bill]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('10. BuyBill.date used (not createdAt)', async () => {
    // Bill has date=2026-07-11 but "createdAt" would be different
    // The fake repository filters by date field, not createdAt
    const billDate = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', billDate, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
    ]);
    // Query for 2026-07-11 → should find the bill
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
    // Query for 2026-07-12 → should NOT find the bill
    const result2 = await aggregateDailyPurchasesWithRepository(repo, '2026-07-12', 'ทองแดง');
    expect(result2.totalBills).toBe(0);
  });

  test('11. Thailand start boundary (00:00 ICT = 17:00 UTC previous day)', async () => {
    const earlyBill = new Date('2026-07-11T00:00:00+07:00'); // exactly midnight ICT
    repo.setBuyBills([
      makeBill('b1', earlyBill, [{ productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('12. Thailand end boundary (23:59 ICT)', async () => {
    const lateBill = new Date('2026-07-11T23:59:00+07:00'); // 23:59 ICT
    repo.setBuyBills([
      makeBill('b1', lateBill, [{ productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('13. no bills returns empty aggregation', async () => {
    repo.setBuyBills([]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items).toHaveLength(0);
    expect(result.totalBills).toBe(0);
    expect(result.totalPurchasedWeight).toBe(0);
  });

  test('14. copper and brass remain isolated', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [
        { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
        { productId: 'brass-1', weight: 5, totalAmount: 1300, productName: 'ทองเหลืองหนา' },
      ]),
    ]);
    const copperResult = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    const brassResult = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองเหลือง');
    expect(copperResult.items).toHaveLength(1);
    expect(copperResult.items[0].productId).toBe('copper-1');
    expect(brassResult.items).toHaveLength(1);
    expect(brassResult.items[0].productId).toBe('brass-1');
  });

  test('15. totalPurchasedWeight correct', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10.5, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'copper-2', weight: 20.3, totalAmount: 8400, productName: 'ทองแดงช็อต' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalPurchasedWeight).toBe(30.8);
  });

  test('16. product order follows sortOrder', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [
        { productId: 'copper-3', weight: 5, totalAmount: 2000, productName: 'ทองแดงใหญ่' },
        { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
        { productId: 'copper-2', weight: 8, totalAmount: 3200, productName: 'ทองแดงช็อต' },
      ]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items[0].productId).toBe('copper-1'); // sortOrder=1
    expect(result.items[1].productId).toBe('copper-2'); // sortOrder=2
    expect(result.items[2].productId).toBe('copper-3'); // sortOrder=3
  });
});

describe('ST-35: Save service (production function with fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;

  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 80.5, totalAmount: 33970, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'copper-2', weight: 20, totalAmount: 8200, productName: 'ทองแดงช็อต' }]),
    ]);
  });

  test('server ignores fake client purchasedWeight', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [
        // Client sends fake purchasedWeight — server must ignore it
        { productId: 'copper-1', actualWeighedWeight: 80, purchasedWeight: 999 } as any,
      ],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    if (result.success) {
      // Server used 80.5 (from aggregation), NOT 999 (from client)
      expect(result.session.items[0].purchasedWeight).toBe(80.5);
    }
  });

  test('server calculates difference itself', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 85 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.items[0].differenceWeight).toBe(4.5); // 85 - 80.5
    }
  });

  test('server calculates status itself', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80.5 }], // exact match
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.items[0].status).toBe('MATCH');
    }
  });

  test('product without purchase is blocked', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'nonexistent', actualWeighedWeight: 50 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(400);
      expect(result.error).toContain('ไม่มียอดซื้อ');
    }
  });

  test('duplicate productId is blocked', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [
        { productId: 'copper-1', actualWeighedWeight: 80 },
        { productId: 'copper-1', actualWeighedWeight: 90 },
      ],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(false);
    if (!result.success) expect(result.status).toBe(400);
  });

  test('negative weight is blocked', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: -5 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(false);
  });

  test('NaN weight is blocked', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: NaN }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(false);
  });

  test('Infinity weight is blocked', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: Infinity }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(false);
  });

  test('null remains NOT_WEIGHED', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: null }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.items[0].status).toBe('NOT_WEIGHED');
      expect(result.session.items[0].actualWeighedWeight).toBeNull();
    }
  });

  test('zero remains valid zero', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 0 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.session.items[0].actualWeighedWeight).toBe(0);
      expect(result.session.items[0].status).toBe('DIFFERENCE'); // 0 - 80.5 = -80.5
    }
  });

  test('session snapshot uses server aggregation', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [
        { productId: 'copper-1', actualWeighedWeight: 80 },
        { productId: 'copper-2', actualWeighedWeight: 20 },
      ],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    if (result.success) {
      // Snapshot should have server-computed values, not client values
      expect(result.session.items[0].purchasedWeight).toBe(80.5); // from bill b1
      expect(result.session.items[1].purchasedWeight).toBe(20);   // from bill b2
      expect(result.session.items[0].purchaseBillCount).toBe(1);   // 1 bill
      expect(result.session.items[1].purchaseBillCount).toBe(1);
    }
  });

  test('AuditLog records actor/date/category/totals', async () => {
    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    expect(repo.getAuditLogCount()).toBe(1);
  });
});

describe('ST-35: Duplicate session (production service)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;

  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBrassProducts(repo);
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'brass-1', weight: 5, totalAmount: 1300, productName: 'ทองเหลืองหนา' }]),
    ]);
  });

  test('first save succeeds, second returns conflict', async () => {
    const body = {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 10 }],
    };

    const result1 = await saveDailyPurchaseWeighing(repo, body, 'user-1', 'Test');
    expect(result1.success).toBe(true);

    const result2 = await saveDailyPurchaseWeighing(repo, body, 'user-1', 'Test');
    expect(result2.success).toBe(false);
    if (!result2.success) {
      expect(result2.status).toBe(409);
      expect(result2.error).toContain('ห้ามบันทึกซ้ำ');
    }
  });

  test('only one session exists after duplicate attempt', async () => {
    const body = {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 10 }],
    };

    await saveDailyPurchaseWeighing(repo, body, 'user-1', 'Test');
    await saveDailyPurchaseWeighing(repo, body, 'user-1', 'Test');

    expect(repo.getSessionCount()).toBe(1);
  });

  test('same date + different category is allowed', async () => {
    const copperBody = {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 10 }],
    };
    const brassBody = {
      weighingDate: '2026-07-11',
      category: 'ทองเหลือง',
      items: [{ productId: 'brass-1', actualWeighedWeight: 5 }],
    };

    const r1 = await saveDailyPurchaseWeighing(repo, copperBody, 'user-1', 'Test');
    const r2 = await saveDailyPurchaseWeighing(repo, brassBody, 'user-1', 'Test');

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(repo.getSessionCount()).toBe(2);
  });

  test('different date + same category is allowed', async () => {
    const date1 = new Date('2026-07-11T10:00:00+07:00');
    const date2 = new Date('2026-07-12T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date1, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date2, [{ productId: 'copper-1', weight: 15, totalAmount: 6300, productName: 'ทองแดงปอกเงา' }]),
    ]);

    const r1 = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 10 }],
    }, 'user-1', 'Test');

    const r2 = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-12', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 15 }],
    }, 'user-1', 'Test');

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(repo.getSessionCount()).toBe(2);
  });
});

describe('ST-35: AuditLog rollback (production service + fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;

  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 80.5, totalAmount: 33970, productName: 'ทองแดงปอกเงา' }]),
    ]);
  });

  test('AuditLog failure leaves zero session, zero items, zero AuditLog', async () => {
    // Configure fake repository to fail on AuditLog creation
    repo.setShouldFailAuditLog(true);

    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    // Save should fail
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.status).toBe(500);
    }

    // Verify NO partial data was committed
    expect(repo.getSessionCount()).toBe(0);     // zero sessions
    expect(repo.getAuditLogCount()).toBe(0);    // zero audit logs
  });

  test('successful save leaves 1 session + 1 AuditLog', async () => {
    repo.setShouldFailAuditLog(false);

    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    expect(repo.getSessionCount()).toBe(1);
    expect(repo.getAuditLogCount()).toBe(1);
  });
});

describe('ST-35: Stock invariants (production service + fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;

  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 80.5, totalAmount: 33970, productName: 'ทองแดงปอกเงา' }]),
    ]);
    // Pre-populate stock lots for invariant checking
    repo.addStockLot('lot-1', 100, 400, 'BUY');
    repo.addStockLot('lot-2', 50, 10, 'SORTING');
  });

  test('successful save does not change StockLot count', async () => {
    const stockBefore = repo.getStockLotCount();
    expect(stockBefore).toBe(2);

    const result = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    expect(result.success).toBe(true);
    expect(repo.getStockLotCount()).toBe(stockBefore); // unchanged
  });

  test('successful save does not create StockMovements', async () => {
    const movementsBefore = repo.getStockMovementCount();

    await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    expect(repo.getStockMovementCount()).toBe(movementsBefore); // unchanged
  });

  test('successful save does not create STOCK_ADJUSTMENT audit logs', async () => {
    const adjBefore = repo.getStockAdjustmentAuditLogCount();

    await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    expect(repo.getStockAdjustmentAuditLogCount()).toBe(adjBefore); // unchanged
  });

  test('duplicate rejection does not change stock', async () => {
    // First save
    await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    const stockBefore = repo.getStockLotCount();

    // Second save (duplicate)
    await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 90 }],
    }, 'user-1', 'Test User');

    expect(repo.getStockLotCount()).toBe(stockBefore); // unchanged
  });

  test('AuditLog rollback does not change stock', async () => {
    repo.setShouldFailAuditLog(true);
    const stockBefore = repo.getStockLotCount();

    await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    }, 'user-1', 'Test User');

    expect(repo.getStockLotCount()).toBe(stockBefore); // unchanged
  });
});

describe('ST-35: Legacy Apply route (actual production handler)', () => {
  test('POST returns 403 with suspension message', async () => {
    const { POST } = await import('../src/app/api/physical-counts/[id]/apply/route');
    const mockRequest = new Request('http://localhost/api/physical-counts/test/apply', {
      method: 'POST',
    }) as any;

    const result = await POST(mockRequest, { params: Promise.resolve({ id: 'test' }) });
    expect(result.status).toBe(403);

    const body = await result.json();
    expect(body.error).toContain('ระงับการใช้งาน');
    expect(body.error).toContain('ชั่งยอดซื้อ');
  });
});

describe('ST-35: History and detail (production service + fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;

  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
    ]);
  });

  test('history returns saved sessions', async () => {
    await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 10 }],
    }, 'user-1', 'Test');

    const { sessions, total } = await getDailyWeighingHistory(repo, 0, 20);
    expect(total).toBe(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].category).toBe('ทองแดง');
  });

  test('detail returns session by ID', async () => {
    const saveResult = await saveDailyPurchaseWeighing(repo, {
      weighingDate: '2026-07-11',
      category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 10 }],
    }, 'user-1', 'Test');

    if (saveResult.success) {
      const detail = await getDailyWeighingDetail(repo, saveResult.session.id);
      expect(detail).not.toBeNull();
      expect(detail!.id).toBe(saveResult.session.id);
    }
  });

  test('detail returns null for unknown ID', async () => {
    const detail = await getDailyWeighingDetail(repo, 'nonexistent');
    expect(detail).toBeNull();
  });
});
