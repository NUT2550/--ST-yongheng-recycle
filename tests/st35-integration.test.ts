/**
 * ST-35: Executable controller tests.
 *
 * These tests call the SAME production controller functions used by routes.
 * No source-code inspection. No fs.readFileSync. No mock route handlers.
 *
 * Controllers accept a pre-authenticated AuthPayload and a repository.
 * Tests provide fake payloads (admin, staff with/without permission) and
 * a fake repository with real commit/rollback.
 *
 * Run: bun test tests/st35-integration.test.ts
 */
import { test, expect, describe, beforeEach } from 'bun:test';

// Import PRODUCTION controllers (same functions used by routes)
import {
  getAggregationController,
  getHistoryController,
  getDetailController,
  postSaveController,
  type AuthPayload,
} from '../src/lib/daily-weighing-controller';

// Import PRODUCTION service functions (for service-level tests)
import {
  aggregateDailyPurchasesWithRepository,
  saveDailyPurchaseWeighing,
  getDailyWeighingHistory,
  getDailyWeighingDetail,
} from '../src/lib/daily-purchase-weighing-service';

// Import PRODUCTION pure helpers
import { hasDailyPurchaseWeighingPermission } from '../src/lib/daily-weighing-permission';
import { validateWeighingPostInput, buildSessionItems } from '../src/lib/daily-purchase-weighing';

// Import fake repository (test-only, implements production interface)
import { FakeDailyPurchaseWeighingRepository } from './st35-fake-repository';

// Import types
import type { BuyBillRow, ProductRow } from '../src/lib/daily-weighing-repository';

// ============ Test fixtures ============

const ADMIN: AuthPayload = { userId: 'admin-1', name: 'Admin', role: 'admin' };
const STAFF_WITH_PERM: AuthPayload = { userId: 'staff-1', name: 'Staff With Perm', role: 'staff', permissions: { dailyPurchaseWeighing: true } };
const STAFF_NO_PERM: AuthPayload = { userId: 'staff-2', name: 'Staff No Perm', role: 'staff', permissions: { 'buy.create': true } };
const STAFF_NO_PERMS_KEY: AuthPayload = { userId: 'staff-3', name: 'Staff No Key', role: 'staff' };

function makeBill(id: string, date: Date, items: Array<{ productId: string; weight: number; totalAmount: number; productName: string }>): BuyBillRow {
  return {
    id, date, isCancelled: false,
    items: items.map(it => ({
      productId: it.productId, weight: it.weight, totalAmount: it.totalAmount,
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

function setupBills(repo: FakeDailyPurchaseWeighingRepository): void {
  const date = new Date('2026-07-11T10:00:00+07:00');
  repo.setBuyBills([
    makeBill('b1', date, [{ productId: 'copper-1', weight: 80.5, totalAmount: 33970, productName: 'ทองแดงปอกเงา' }]),
    makeBill('b2', date, [{ productId: 'copper-2', weight: 20, totalAmount: 8200, productName: 'ทองแดงช็อต' }]),
  ]);
}

// ============ Permission helper tests ============

describe('ST-35: Permission (production helper)', () => {
  test('admin has permission', () => {
    expect(hasDailyPurchaseWeighingPermission(ADMIN)).toBe(true);
  });
  test('staff with dailyPurchaseWeighing = true', () => {
    expect(hasDailyPurchaseWeighingPermission(STAFF_WITH_PERM)).toBe(true);
  });
  test('staff without permission = false', () => {
    expect(hasDailyPurchaseWeighingPermission(STAFF_NO_PERM)).toBe(false);
  });
  test('staff with no permissions key = false', () => {
    expect(hasDailyPurchaseWeighingPermission(STAFF_NO_PERMS_KEY)).toBe(false);
  });
});

// ============ Controller: GET aggregation ============

describe('ST-35: GET aggregation controller (production function)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBills(repo);
  });

  test('admin → 200 with aggregation', async () => {
    const result = await getAggregationController(repo, ADMIN, '2026-07-11', 'ทองแดง');
    expect(result.status).toBe(200);
    expect((result.data as any).items).toHaveLength(2);
  });

  test('staff with permission → 200', async () => {
    const result = await getAggregationController(repo, STAFF_WITH_PERM, '2026-07-11', 'ทองแดง');
    expect(result.status).toBe(200);
  });

  test('staff without permission → 403', async () => {
    const result = await getAggregationController(repo, STAFF_NO_PERM, '2026-07-11', 'ทองแดง');
    expect(result.status).toBe(403);
    expect((result.data as any).error).toContain('สิทธิ์');
  });

  test('staff with no permissions key → 403', async () => {
    const result = await getAggregationController(repo, STAFF_NO_PERMS_KEY, '2026-07-11', 'ทองแดง');
    expect(result.status).toBe(403);
  });

  test('missing date → 400', async () => {
    const result = await getAggregationController(repo, ADMIN, null, 'ทองแดง');
    expect(result.status).toBe(400);
  });

  test('invalid date → 400', async () => {
    const result = await getAggregationController(repo, ADMIN, 'not-a-date', 'ทองแดง');
    expect(result.status).toBe(400);
  });

  test('invalid category → 400', async () => {
    const result = await getAggregationController(repo, ADMIN, '2026-07-11', 'เหล็ก');
    expect(result.status).toBe(400);
  });
});

// ============ Controller: GET history ============

describe('ST-35: GET history controller (production function)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBills(repo);
  });

  test('admin → 200 with sessions list', async () => {
    // Save a session first
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    const result = await getHistoryController(repo, ADMIN, 1, 20);
    expect(result.status).toBe(200);
    expect((result.data as any).total).toBe(1);
  });

  test('staff with permission → 200', async () => {
    const result = await getHistoryController(repo, STAFF_WITH_PERM, 1, 20);
    expect(result.status).toBe(200);
  });

  test('staff without permission → 403', async () => {
    const result = await getHistoryController(repo, STAFF_NO_PERM, 1, 20);
    expect(result.status).toBe(403);
  });
});

// ============ Controller: GET detail ============

describe('ST-35: GET detail controller (production function)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  let sessionId: string;

  beforeEach(async () => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBills(repo);
    const saveResult = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    sessionId = (saveResult.data as any).session.id;
  });

  test('admin → 200 with session', async () => {
    const result = await getDetailController(repo, ADMIN, sessionId);
    expect(result.status).toBe(200);
    expect((result.data as any).session.id).toBe(sessionId);
  });

  test('staff with permission → 200', async () => {
    const result = await getDetailController(repo, STAFF_WITH_PERM, sessionId);
    expect(result.status).toBe(200);
  });

  test('staff without permission → 403', async () => {
    const result = await getDetailController(repo, STAFF_NO_PERM, sessionId);
    expect(result.status).toBe(403);
  });

  test('unknown session → 404', async () => {
    const result = await getDetailController(repo, ADMIN, 'nonexistent');
    expect(result.status).toBe(404);
  });
});

// ============ Controller: POST save ============

describe('ST-35: POST save controller (production function)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBills(repo);
  });

  test('admin → 201 on success', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(result.status).toBe(201);
    expect((result.data as any).session).toBeDefined();
  });

  test('staff with permission → 201', async () => {
    const result = await postSaveController(repo, STAFF_WITH_PERM, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(result.status).toBe(201);
  });

  test('staff without permission → 403', async () => {
    const result = await postSaveController(repo, STAFF_NO_PERM, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(result.status).toBe(403);
  });

  test('server ignores fake client purchaseWeight', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80, purchaseWeight: 999 } as any],
    });
    expect(result.status).toBe(201);
    expect((result.data as any).session.items[0].purchaseWeight).toBe(80.5); // server value, not 999
  });

  test('negative weight → 400', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: -5 }],
    });
    expect(result.status).toBe(400);
  });

  test('NaN weight → 400', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: NaN }],
    });
    expect(result.status).toBe(400);
  });

  test('null = NOT_WEIGHED', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: null }],
    });
    expect(result.status).toBe(201);
    expect((result.data as any).session.items[0].status).toBe('NOT_WEIGHED');
  });

  test('zero = valid', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 0 }],
    });
    expect(result.status).toBe(201);
    expect((result.data as any).session.items[0].actualWeighedWeight).toBe(0);
  });

  test('product without purchase → 400', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'nonexistent', actualWeighedWeight: 50 }],
    });
    expect(result.status).toBe(400);
  });

  test('duplicate productId → 400', async () => {
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [
        { productId: 'copper-1', actualWeighedWeight: 80 },
        { productId: 'copper-1', actualWeighedWeight: 90 },
      ],
    });
    expect(result.status).toBe(400);
  });
});

// ============ Aggregation service tests (production function) ============

describe('ST-35: Aggregation service (production function with fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBrassProducts(repo);
  });

  test('multiple bills on one date', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'copper-1', weight: 20, totalAmount: 8400, productName: 'ทองแดงปอกเงา' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items[0].purchaseWeight).toBe(30);
  });

  test('steel-only bill excluded from copper count', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }]),
      makeBill('b2', date, [{ productId: 'steel-1', weight: 100, totalAmount: 900, productName: 'เหล็กบาง' }]),
    ]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('cancelled bill excluded', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    const cancelled = makeBill('b-cancel', date, [{ productId: 'copper-1', weight: 100, totalAmount: 42000, productName: 'ทองแดงปอกเงา' }]);
    cancelled.isCancelled = true;
    repo.setBuyBills([cancelled, makeBill('b2', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
    expect(result.items[0].purchaseWeight).toBe(10);
  });

  test('A-prefixed bill included', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([makeBill('A1051492', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('D-prefixed bill included', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([makeBill('D1025582', date, [{ productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' }])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('copper and brass isolated', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([makeBill('b1', date, [
      { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
      { productId: 'brass-1', weight: 5, totalAmount: 1300, productName: 'ทองเหลืองหนา' },
    ])]);
    const copper = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    const brass = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองเหลือง');
    expect(copper.items).toHaveLength(1);
    expect(copper.items[0].productId).toBe('copper-1');
    expect(brass.items).toHaveLength(1);
    expect(brass.items[0].productId).toBe('brass-1');
  });

  test('no bills returns empty', async () => {
    repo.setBuyBills([]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items).toHaveLength(0);
    expect(result.totalBills).toBe(0);
  });

  test('ICT start boundary', async () => {
    repo.setBuyBills([makeBill('b1', new Date('2026-07-11T00:00:00+07:00'), [{ productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' }])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('ICT end boundary', async () => {
    repo.setBuyBills([makeBill('b1', new Date('2026-07-11T23:59:00+07:00'), [{ productId: 'copper-1', weight: 5, totalAmount: 2100, productName: 'ทองแดงปอกเงา' }])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.totalBills).toBe(1);
  });

  test('product order follows sortOrder', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([makeBill('b1', date, [
      { productId: 'copper-3', weight: 5, totalAmount: 2000, productName: 'ทองแดงใหญ่' },
      { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
      { productId: 'copper-2', weight: 8, totalAmount: 3200, productName: 'ทองแดงช็อต' },
    ])]);
    const result = await aggregateDailyPurchasesWithRepository(repo, '2026-07-11', 'ทองแดง');
    expect(result.items[0].productId).toBe('copper-1');
    expect(result.items[1].productId).toBe('copper-2');
    expect(result.items[2].productId).toBe('copper-3');
  });
});

// ============ Duplicate session tests (production service) ============

describe('ST-35: Duplicate session (production controller)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBrassProducts(repo);
    setupBills(repo);
  });

  test('first save → 201, second → 409', async () => {
    const body = { weighingDate: '2026-07-11', category: 'ทองแดง', items: [{ productId: 'copper-1', actualWeighedWeight: 80 }] };
    const r1 = await postSaveController(repo, ADMIN, body);
    expect(r1.status).toBe(201);
    const r2 = await postSaveController(repo, ADMIN, body);
    expect(r2.status).toBe(409);
  });

  test('only 1 session after duplicate attempt', async () => {
    const body = { weighingDate: '2026-07-11', category: 'ทองแดง', items: [{ productId: 'copper-1', actualWeighedWeight: 80 }] };
    await postSaveController(repo, ADMIN, body);
    await postSaveController(repo, ADMIN, body);
    expect(repo.getSessionCount()).toBe(1);
  });

  test('same date + different category allowed', async () => {
    const date = new Date('2026-07-11T10:00:00+07:00');
    repo.setBuyBills([
      makeBill('b1', date, [
        { productId: 'copper-1', weight: 10, totalAmount: 4200, productName: 'ทองแดงปอกเงา' },
        { productId: 'brass-1', weight: 5, totalAmount: 1300, productName: 'ทองเหลืองหนา' },
      ]),
    ]);
    const r1 = await postSaveController(repo, ADMIN, { weighingDate: '2026-07-11', category: 'ทองแดง', items: [{ productId: 'copper-1', actualWeighedWeight: 10 }] });
    const r2 = await postSaveController(repo, ADMIN, { weighingDate: '2026-07-11', category: 'ทองเหลือง', items: [{ productId: 'brass-1', actualWeighedWeight: 5 }] });
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    expect(repo.getSessionCount()).toBe(2);
  });
});

// ============ AuditLog rollback test (production service) ============

describe('ST-35: AuditLog rollback (production controller + fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBills(repo);
  });

  test('AuditLog failure → zero sessions, zero items, zero audit logs', async () => {
    repo.setShouldFailAuditLog(true);
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(result.status).toBe(500);
    expect(repo.getSessionCount()).toBe(0);
    expect(repo.getItemCount()).toBe(0);
    expect(repo.getAuditLogCount()).toBe(0);
  });

  test('success → 1 session, 1+ items, 1 audit log', async () => {
    repo.setShouldFailAuditLog(false);
    const result = await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(result.status).toBe(201);
    expect(repo.getSessionCount()).toBe(1);
    expect(repo.getItemCount()).toBe(1);
    expect(repo.getAuditLogCount()).toBe(1);
  });
});

// ============ Stock invariant tests (production controller) ============

describe('ST-35: Stock invariants (production controller + fake repository)', () => {
  let repo: FakeDailyPurchaseWeighingRepository;
  beforeEach(() => {
    repo = new FakeDailyPurchaseWeighingRepository();
    setupCopperProducts(repo);
    setupBills(repo);
    repo.addStockLot('lot-1', 100, 400, 'BUY');
    repo.addStockLot('lot-2', 50, 10, 'SORTING');
  });

  test('successful save: StockLot count unchanged', async () => {
    const before = repo.getStockLotCount();
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(repo.getStockLotCount()).toBe(before);
  });

  test('successful save: StockMovement count unchanged', async () => {
    const before = repo.getStockMovementCount();
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(repo.getStockMovementCount()).toBe(before);
  });

  test('successful save: STOCK_ADJUSTMENT count unchanged', async () => {
    const before = repo.getStockAdjustmentAuditLogCount();
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(repo.getStockAdjustmentAuditLogCount()).toBe(before);
  });

  test('duplicate rejection: stock unchanged', async () => {
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    const before = repo.getStockLotCount();
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 90 }],
    });
    expect(repo.getStockLotCount()).toBe(before);
  });

  test('AuditLog rollback: stock unchanged', async () => {
    repo.setShouldFailAuditLog(true);
    const before = repo.getStockLotCount();
    await postSaveController(repo, ADMIN, {
      weighingDate: '2026-07-11', category: 'ทองแดง',
      items: [{ productId: 'copper-1', actualWeighedWeight: 80 }],
    });
    expect(repo.getStockLotCount()).toBe(before);
  });
});

// ============ Legacy Apply route removed (ST-44) ============
// The /api/physical-counts/[id]/apply route and the entire physical-count page
// were removed in ST-44. The previous 403-suspension tests are obsolete.
