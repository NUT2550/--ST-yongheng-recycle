/**
 * ST-8 rev 2: Route + pipeline + service executable tests.
 *
 * These 30 tests execute the REAL production code:
 *   - Authorization: actual `hasPermission` from src/lib/permissions.ts
 *     AND real route invocations (POST /api/import/apply) with valid/invalid
 *     tokens + permission payloads. `server-only` is mocked so the route
 *     module can be imported in the test runner.
 *   - Input safety: actual `applyImport` from src/lib/import-pipeline.ts
 *     (with mock deps), actual `classifyBillStatus`, actual
 *     `overrideMatchedFlagFromServerValidation`, actual `createBuyBillService` /
 *     `createSellBillService` from src/lib/bill-services.ts.
 *   - Shared production path: `fs.readFileSync` source inspections that
 *     prove the import apply route uses the SAME shared services as the
 *     normal POST /api/buy-bills and /api/sell-bills routes, with NO
 *     second bill engine (no direct db.buyBill.create / db.sellBill.create /
 *     db.stockLot.create in the import route).
 *   - Duplicate/batch: prove the normal successful path uses one initial
 *     request-wide lookup, confirmed concurrent duplicate races map to
 *     DUPLICATE_EXISTING, and full re-upload is idempotent.
 *
 * Run: bun test tests/st8-route-tests.test.ts
 */
import { test, expect, describe, mock, beforeEach } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Stub `server-only` so we can import the real route handler in tests.
// The route imports `@/lib/auth` which has `import 'server-only'` —
// without this stub, the import throws in non-RSC environments.
mock.module('server-only', () => ({}));

import { hasPermission, type AuthPayload } from '../src/lib/permissions';
import { createToken, verifyToken, getTokenFromRequest } from '../src/lib/auth-core';
import {
  applyImport,
  classifyBillStatus,
  normalizeBillNumber,
  overrideMatchedFlagFromServerValidation,
  type ParsedBill,
  type ParsedBillItem,
  type ImportApplyDeps,
  type ImportActor,
} from '../src/lib/import-pipeline';
import {
  createBuyBillService,
  createSellBillService,
  DuplicateExistingError,
  isPrismaP2002,
  validateBillItemNumeric,
  validateBillDate,
  FIFO_ORDER_BY,
  type BuyBillTx,
  type BuyBillServiceDeps,
  type SellBillTx,
  type SellBillServiceDeps,
  type SellSourceLot,
} from '../src/lib/bill-services';

// ============================================================================
// Fixtures
// ============================================================================

const ADMIN: AuthPayload = {
  userId: 'admin-1',
  username: 'admin',
  name: 'Admin User',
  role: 'admin',
};

const STAFF_BUY_ONLY: AuthPayload = {
  userId: 'staff-buy',
  username: 'staffbuy',
  name: 'Staff Buy',
  role: 'staff',
  permissions: { 'buy.create': true },
};

const STAFF_SELL_ONLY: AuthPayload = {
  userId: 'staff-sell',
  username: 'staffsell',
  name: 'Staff Sell',
  role: 'staff',
  permissions: { 'sell.create': true },
};

const STAFF_NO_PERMS: AuthPayload = {
  userId: 'staff-none',
  username: 'staffnone',
  name: 'Staff None',
  role: 'staff',
  permissions: {},
};

const ACTOR: ImportActor = {
  userId: 'admin-1',
  username: 'admin',
  name: 'Admin User',
  role: 'admin',
};

function makeItem(overrides: Partial<ParsedBillItem> = {}): ParsedBillItem {
  return {
    productId: 'prod-1',
    productName: 'ทองแดงช็อต',
    weight: 10,
    pricePerKg: 100,
    totalAmount: 1000,
    matched: true,
    ...overrides,
  };
}

function makeBill(overrides: Partial<ParsedBill> = {}): ParsedBill {
  return {
    externalBillNumber: 'A1051492',
    date: '2026-01-01T03:00:00.000Z',
    note: '',
    items: [makeItem()],
    ...overrides,
  };
}

// ============================================================================
// Mock deps for applyImport (records calls + simulates DB state)
// ============================================================================

interface MockApplyState {
  existingBillNumbers: Set<string>;
  insufficientStockProductIds: Set<string>;
  failOnBillNumbers: Set<string>;
  duplicateOnBillNumbers: Set<string>; // createPurchase/SalesBill simulates a concurrent winner + throws DuplicateExistingError
  loadExistingBillNumbersCalls: Array<{ type: 'purchase' | 'sales'; normalizedCandidates: string[] }>;
  checkStockAvailabilityCalls: Array<{ items: ParsedBillItem[] }>;
  createPurchaseBillCalls: Array<{ bill: ParsedBill; actor: ImportActor }>;
  createSalesBillCalls: Array<{ bill: ParsedBill; actor: ImportActor }>;
  stockLotWrites: number; // incremented when createPurchaseBill or createSalesBill "writes" stock
  writtenPurchaseBills: Map<string, { id: string; billNumber: string }>;
  writtenSalesBills: Map<string, { id: string; billNumber: string }>;
  billSeq: number;
}

function makeMockApplyDeps(): { deps: ImportApplyDeps; state: MockApplyState; reset: () => void } {
  const state: MockApplyState = {
    existingBillNumbers: new Set(),
    insufficientStockProductIds: new Set(),
    failOnBillNumbers: new Set(),
    duplicateOnBillNumbers: new Set(),
    loadExistingBillNumbersCalls: [],
    checkStockAvailabilityCalls: [],
    createPurchaseBillCalls: [],
    createSalesBillCalls: [],
    stockLotWrites: 0,
    writtenPurchaseBills: new Map(),
    writtenSalesBills: new Map(),
    billSeq: 0,
  };

  const deps: ImportApplyDeps = {
    loadExistingBillNumbers: async (type, normalizedCandidates) => {
      state.loadExistingBillNumbersCalls.push({ type, normalizedCandidates });
      // Build the set of "existing" normalized numbers: programmable
      // existingBillNumbers + bills "written" via createPurchaseBill/
      // createSalesBill (simulates DB state).
      const result = new Set<string>();
      for (const n of state.existingBillNumbers) result.add(n);
      const written = type === 'purchase' ? state.writtenPurchaseBills : state.writtenSalesBills;
      for (const n of written.keys()) result.add(n);
      return result;
    },
    checkStockAvailability: async (items) => {
      state.checkStockAvailabilityCalls.push({ items });
      for (const item of items) {
        if (state.insufficientStockProductIds.has(item.productId)) {
          return {
            ok: false as const,
            productId: item.productId,
            productName: item.productName,
            available: 0,
            requested: item.weight,
          };
        }
      }
      return { ok: true as const };
    },
    createPurchaseBill: async (bill, actor) => {
      state.createPurchaseBillCalls.push({ bill, actor });
      const norm = normalizeBillNumber(bill.externalBillNumber);
      if (state.duplicateOnBillNumbers.has(norm)) {
        // Model the actual race: the initial lookup missed, then a concurrent
        // winner committed this external number before our create collided.
        state.existingBillNumbers.add(norm);
        throw new DuplicateExistingError('externalBillNumber');
      }
      if (state.failOnBillNumbers.has(norm)) {
        throw new Error(`Simulated purchase bill creation failure for ${norm}`);
      }
      state.billSeq++;
      const id = `buy-${state.billSeq}`;
      const billNumber = `BUY-2569-${String(state.billSeq).padStart(5, '0')}`;
      state.writtenPurchaseBills.set(norm, { id, billNumber });
      state.stockLotWrites += bill.items.length; // purchase creates one StockLot per item
      return { id, billNumber };
    },
    createSalesBill: async (bill, actor) => {
      state.createSalesBillCalls.push({ bill, actor });
      const norm = normalizeBillNumber(bill.externalBillNumber);
      if (state.duplicateOnBillNumbers.has(norm)) {
        state.existingBillNumbers.add(norm);
        throw new DuplicateExistingError('externalBillNumber');
      }
      if (state.failOnBillNumbers.has(norm)) {
        throw new Error(`Simulated sales bill creation failure for ${norm}`);
      }
      state.billSeq++;
      const id = `sell-${state.billSeq}`;
      const billNumber = `SELL-2569-${String(state.billSeq).padStart(5, '0')}`;
      state.writtenSalesBills.set(norm, { id, billNumber });
      state.stockLotWrites += bill.items.length; // sales "deducts" via update (mocked)
      return { id, billNumber };
    },
  };

  const reset = () => {
    state.existingBillNumbers.clear();
    state.insufficientStockProductIds.clear();
    state.failOnBillNumbers.clear();
    state.duplicateOnBillNumbers.clear();
    state.loadExistingBillNumbersCalls.length = 0;
    state.checkStockAvailabilityCalls.length = 0;
    state.createPurchaseBillCalls.length = 0;
    state.createSalesBillCalls.length = 0;
    state.stockLotWrites = 0;
    state.writtenPurchaseBills.clear();
    state.writtenSalesBills.clear();
    state.billSeq = 0;
  };

  return { deps, state, reset };
}

const mockApply = makeMockApplyDeps();

beforeEach(() => {
  mockApply.reset();
});

// ============================================================================
// Source file paths for source-inspection tests
// ============================================================================

const IMPORT_APPLY_ROUTE_PATH = join(process.cwd(), 'src/app/api/import/apply/route.ts');
const IMPORT_PIPELINE_PATH = join(process.cwd(), 'src/lib/import-pipeline.ts');
const BILL_SERVICES_PATH = join(process.cwd(), 'src/lib/bill-services.ts');
const BUY_BILLS_ROUTE_PATH = join(process.cwd(), 'src/app/api/buy-bills/route.ts');
const SELL_BILLS_ROUTE_PATH = join(process.cwd(), 'src/app/api/sell-bills/route.ts');

function readSource(p: string): string {
  return readFileSync(p, 'utf-8');
}

// ============================================================================
// 1-7: Authorization tests (real hasPermission + real route invocation)
// ============================================================================

describe('ST-8 rev 2: Authorization (real hasPermission + real route)', () => {
  test('1. no token → 401', async () => {
    // Real route invocation: no Authorization header, no cookie.
    const { POST } = await import('../src/app/api/import/apply/route');
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'purchase', bills: [] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('ไม่ได้เข้าสู่ระบบ');
  });

  test('2. invalid token → 401', async () => {
    // Real route invocation: invalid bearer token.
    const { POST } = await import('../src/app/api/import/apply/route');
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer not.a.real.jwt',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ type: 'purchase', bills: [] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('token ไม่ถูกต้อง');
  });

  test('3. Purchase with only sell.create → 403', async () => {
    expect(hasPermission(STAFF_SELL_ONLY, 'buy.create')).toBe(false);
    const { POST } = await import('../src/app/api/import/apply/route');
    const token = await createToken(STAFF_SELL_ONLY);
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'purchase', bills: [] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('ไม่มีสิทธิ์นำเข้าใบซื้อ');
  });

  test('4. Purchase with buy.create → allowed', async () => {
    expect(hasPermission(STAFF_BUY_ONLY, 'buy.create')).toBe(true);
    const { POST } = await import('../src/app/api/import/apply/route');
    const token = await createToken(STAFF_BUY_ONLY);
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'purchase', bills: [] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.importedCount).toBe(0);
  });

  test('5. Sales with only buy.create → 403', async () => {
    expect(hasPermission(STAFF_BUY_ONLY, 'sell.create')).toBe(false);
    const { POST } = await import('../src/app/api/import/apply/route');
    const token = await createToken(STAFF_BUY_ONLY);
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sales', bills: [] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(403);
    const body = await response.json();
    expect(body.error).toBe('ไม่มีสิทธิ์นำเข้าใบขาย');
  });

  test('6. Sales with sell.create → allowed', async () => {
    expect(hasPermission(STAFF_SELL_ONLY, 'sell.create')).toBe(true);
    const { POST } = await import('../src/app/api/import/apply/route');
    const token = await createToken(STAFF_SELL_ONLY);
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sales', bills: [] }),
    });
    const response = await POST(request as never);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.importedCount).toBe(0);
  });

  test('7. Admin → both purchase and sales allowed', async () => {
    expect(hasPermission(ADMIN, 'buy.create')).toBe(true);
    expect(hasPermission(ADMIN, 'sell.create')).toBe(true);
    const { POST } = await import('../src/app/api/import/apply/route');
    const token = await createToken(ADMIN);
    const reqPurchase = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'purchase', bills: [] }),
    });
    const resPurchase = await POST(reqPurchase as never);
    expect(resPurchase.status).toBe(200);
    const reqSales = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'sales', bills: [] }),
    });
    const resSales = await POST(reqSales as never);
    expect(resSales.status).toBe(200);
  });
});

// ============================================================================
// 8-17: Input safety tests
// ============================================================================

describe('ST-8 rev 2: Input safety', () => {
  test('8. malformed JSON → 400', async () => {
    const { POST } = await import('../src/app/api/import/apply/route');
    const token = await createToken(ADMIN);
    const request = new Request('http://x/api/import/apply', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: 'not valid json {{{',
    });
    const response = await POST(request as never);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Invalid JSON body');
  });

  test('9. missing date → INVALID, zero write', async () => {
    const bill = makeBill({ date: '' });
    expect(classifyBillStatus(bill)).toBe('INVALID');
    const summary = await applyImport('purchase', [bill], mockApply.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
    expect(mockApply.state.stockLotWrites).toBe(0);
  });

  test('10. malformed date → INVALID, zero write', async () => {
    const bill = makeBill({ date: 'not-a-date' });
    expect(classifyBillStatus(bill)).toBe('INVALID');
    expect(validateBillDate('not-a-date')).not.toBeNull();
    const summary = await applyImport('purchase', [bill], mockApply.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
    expect(mockApply.state.stockLotWrites).toBe(0);
  });

  test('11. invalid product ID → UNMATCHED_PRODUCT, zero write', async () => {
    const bill = makeBill({ items: [makeItem({ productId: 'invalid-id', matched: false })] });
    expect(classifyBillStatus(bill)).toBe('UNMATCHED_PRODUCT');
    const summary = await applyImport('purchase', [bill], mockApply.deps, ACTOR);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
    expect(mockApply.state.stockLotWrites).toBe(0);
  });

  test('12. forged matched=true → zero write (server overrides to false)', async () => {
    const bills = [makeBill({ externalBillNumber: 'FORGED-1', items: [makeItem({ productId: 'invalid-id', matched: true })] })];
    overrideMatchedFlagFromServerValidation(bills, new Set<string>(['prod-1']));
    expect(bills[0].items[0].matched).toBe(false);
    const summary = await applyImport('purchase', bills, mockApply.deps, ACTOR);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
    expect(mockApply.state.stockLotWrites).toBe(0);
  });

  test('13. negative weight → INVALID', async () => {
    const bill = makeBill({ items: [makeItem({ weight: -5 })] });
    expect(classifyBillStatus(bill)).toBe('INVALID');
    expect(validateBillItemNumeric({ weight: -5, pricePerKg: 100 })).not.toBeNull();
    const summary = await applyImport('purchase', [bill], mockApply.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('14. zero weight → INVALID', async () => {
    const bill = makeBill({ items: [makeItem({ weight: 0 })] });
    expect(classifyBillStatus(bill)).toBe('INVALID');
    expect(validateBillItemNumeric({ weight: 0, pricePerKg: 100 })).not.toBeNull();
    const summary = await applyImport('purchase', [bill], mockApply.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('15. NaN/Infinity weight → INVALID', async () => {
    expect(classifyBillStatus(makeBill({ items: [makeItem({ weight: NaN })] }))).toBe('INVALID');
    expect(classifyBillStatus(makeBill({ items: [makeItem({ weight: Infinity })] }))).toBe('INVALID');
    expect(classifyBillStatus(makeBill({ items: [makeItem({ weight: -Infinity })] }))).toBe('INVALID');
    expect(validateBillItemNumeric({ weight: NaN, pricePerKg: 100 })).not.toBeNull();
    expect(validateBillItemNumeric({ weight: Infinity, pricePerKg: 100 })).not.toBeNull();
    const summary = await applyImport('purchase', [makeBill({ items: [makeItem({ weight: NaN })] })], mockApply.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('16. negative price → INVALID', async () => {
    const bill = makeBill({ items: [makeItem({ pricePerKg: -50 })] });
    expect(classifyBillStatus(bill)).toBe('INVALID');
    expect(validateBillItemNumeric({ weight: 10, pricePerKg: -50 })).not.toBeNull();
    const summary = await applyImport('purchase', [bill], mockApply.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('17. client totalAmount ignored (server recomputes)', async () => {
    let recordedArgs: { data: { totalAmount: number; items: { create: Array<{ totalAmount: number }> } } } | null = null;
    const mockDeps: BuyBillServiceDeps = {
      generateBillNumber: async () => 'BUY-TEST-001',
      transaction: async (fn) => {
        const tx: BuyBillTx = {
          createBuyBill: async (args) => {
            recordedArgs = args as never;
            return { id: 'buy-1', items: args.data.items.create.map((it) => ({ productId: it.productId, weight: it.weight, pricePerKg: it.pricePerKg })) };
          },
          createStockLots: async () => undefined,
          createAuditLog: async () => undefined,
        };
        return fn(tx);
      },
    };
    const result = await createBuyBillService(mockDeps, {
      date: '2026-01-01T03:00:00.000Z', isCredit: false,
      items: [{ productId: 'prod-1', weight: 10, pricePerKg: 100 }, { productId: 'prod-2', weight: 5, pricePerKg: 200 }],
    }, ADMIN);
    expect(result.totalAmount).toBe(2000);
    expect(recordedArgs).not.toBeNull();
    expect(recordedArgs!.data.totalAmount).toBe(2000);
    expect(recordedArgs!.data.items.create[0].totalAmount).toBe(1000);
    expect(recordedArgs!.data.items.create[1].totalAmount).toBe(1000);
  });
});

// ============================================================================
// 18-23: Shared production path tests
// ============================================================================

describe('ST-8 rev 2: Shared production path (source inspection)', () => {
  test('18. normal Purchase route and import call createBuyBillService', () => {
    const buyBillsSrc = readSource(BUY_BILLS_ROUTE_PATH);
    const importApplySrc = readSource(IMPORT_APPLY_ROUTE_PATH);
    expect(buyBillsSrc).toContain('createBuyBillService');
    expect(buyBillsSrc).toMatch(/from ['"]@\/lib\/bill-services['"]/);
    expect(importApplySrc).toContain('createBuyBillService');
    expect(importApplySrc).toMatch(/from ['"]@\/lib\/bill-services['"]/);
  });

  test('19. normal Sales route and import call createSellBillService', () => {
    const sellBillsSrc = readSource(SELL_BILLS_ROUTE_PATH);
    const importApplySrc = readSource(IMPORT_APPLY_ROUTE_PATH);
    expect(sellBillsSrc).toContain('createSellBillService');
    expect(sellBillsSrc).toMatch(/from ['"]@\/lib\/bill-services['"]/);
    expect(importApplySrc).toContain('createSellBillService');
    expect(importApplySrc).toMatch(/from ['"]@\/lib\/bill-services['"]/);
  });

  test('20. no direct BuyBill/SellBill/StockLot creation in import route', () => {
    const src = readSource(IMPORT_APPLY_ROUTE_PATH);
    expect(src).not.toMatch(/db\.buyBill\.create\s*\(/);
    expect(src).not.toMatch(/db\.sellBill\.create\s*\(/);
    expect(src).not.toMatch(/db\.stockLot\.create\s*\(/);
    expect(src).not.toMatch(/db\.stockLot\.createMany\s*\(/);
    expect(src).not.toMatch(/db\.stockLot\.update\s*\(/);
    expect(src).toContain('createBuyBillService');
    expect(src).toContain('createSellBillService');
  });

  test('21. canonical deterministic FIFO (FIFO_ORDER_BY used)', () => {
    const billServicesSrc = readSource(BILL_SERVICES_PATH);
    expect(billServicesSrc).toMatch(/import\s+\{[^}]*FIFO_ORDER_BY[^}]*\}\s*from\s*['"]\.\/fifo-validation['"]/);
    expect(billServicesSrc).toMatch(/FIFO_ORDER_BY/);
    const importApplySrc = readSource(IMPORT_APPLY_ROUTE_PATH);
    expect(importApplySrc).toMatch(/FIFO_ORDER_BY/);
    expect(FIFO_ORDER_BY).toEqual([{ dateAdded: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }]);
  });

  test('22. zero-cost source rejection (validateSourceLotCosts called in bill-services)', () => {
    const billServicesSrc = readSource(BILL_SERVICES_PATH);
    expect(billServicesSrc).toMatch(/import\s+\{[^}]*validateSourceLotCosts[^}]*\}\s*from\s*['"]\.\/fifo-validation['"]/);
    expect(billServicesSrc).toMatch(/validateSourceLotCosts\s*\(/);
    const sellServiceStart = billServicesSrc.indexOf('export async function createSellBillService');
    expect(sellServiceStart).toBeGreaterThan(-1);
    let braceDepth = 0;
    let sellServiceEnd = -1;
    for (let i = sellServiceStart; i < billServicesSrc.length; i++) {
      const ch = billServicesSrc[i];
      if (ch === '{') braceDepth++;
      else if (ch === '}') {
        braceDepth--;
        if (braceDepth === 0) { sellServiceEnd = i + 1; break; }
      }
    }
    expect(sellServiceEnd).toBeGreaterThan(sellServiceStart);
    const sellServiceBody = billServicesSrc.slice(sellServiceStart, sellServiceEnd);
    expect(sellServiceBody).toMatch(/validateSourceLotCosts\s*\(/);
  });

  test('23. P2002 duplicate signal requires post-failure row confirmation', () => {
    const src = readSource(IMPORT_PIPELINE_PATH);
    expect(src).toMatch(/import.*DuplicateExistingError.*from ['"]\.\/bill-errors['"]/);
    expect(src).toContain('const afterFailureExisting = await deps.loadExistingBillNumbers(type, [norm])');
    expect(src).toMatch(/duplicateAfterRace = afterFailureExisting\.has\(norm\)/);
    expect(src).not.toMatch(/duplicateAfterRace\s*=\s*err instanceof DuplicateExistingError/);
    expect(src).toMatch(/status: 'DUPLICATE_EXISTING'/);
    const billServicesSrc = readSource(BILL_SERVICES_PATH);
    expect(billServicesSrc).toMatch(/isP2002OnField\s*\(/);
    expect(billServicesSrc).toMatch(/throw new DuplicateExistingError/);
    expect(isPrismaP2002({ code: 'P2002' } as never)).toBe(true);
    expect(isPrismaP2002(new Error('random error'))).toBe(false);
  });
});

// ============================================================================
// 24-27: Duplicate / batch tests
// ============================================================================

describe('ST-8 rev 2: Duplicate / batch behavior', () => {
  test('24. confirmed P2002 race does not increment failedCount', async () => {
    mockApply.state.duplicateOnBillNumbers.add('A1051492');
    const bills = [makeBill({ externalBillNumber: 'A1051492' })];
    const summary = await applyImport('purchase', bills, mockApply.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(summary.importedCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(1);
    expect(mockApply.state.loadExistingBillNumbersCalls).toHaveLength(2); // initial + post-failure confirmation
    expect(mockApply.state.stockLotWrites).toBe(0);
  });

  test('25. duplicate causes zero stock side effects', async () => {
    mockApply.state.existingBillNumbers.add('DUP-001');
    const bills = [makeBill({ externalBillNumber: 'DUP-001', items: [makeItem({ productId: 'prod-1', weight: 50 }), makeItem({ productId: 'prod-2', weight: 30 })] })];
    const summary = await applyImport('purchase', bills, mockApply.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
    expect(mockApply.state.stockLotWrites).toBe(0);
    mockApply.reset();
    const nonDupBills = [makeBill({ externalBillNumber: 'NEW-001', items: [makeItem({ productId: 'prod-1', weight: 50 }), makeItem({ productId: 'prod-2', weight: 30 })] })];
    const summary2 = await applyImport('purchase', nonDupBills, mockApply.deps, ACTOR);
    expect(summary2.importedCount).toBe(1);
    expect(mockApply.state.stockLotWrites).toBe(2);
  });

  test('26. one lookup for 100 successful/non-racing bills', async () => {
    const bills: ParsedBill[] = [];
    for (let i = 0; i < 100; i++) bills.push(makeBill({ externalBillNumber: `B${String(i).padStart(5, '0')}` }));
    mockApply.state.existingBillNumbers.add('B00010');
    mockApply.state.existingBillNumbers.add('B00050');
    const summary = await applyImport('purchase', bills, mockApply.deps, ACTOR);
    expect(mockApply.state.loadExistingBillNumbersCalls).toHaveLength(1);
    expect(mockApply.state.loadExistingBillNumbersCalls[0].normalizedCandidates).toHaveLength(100);
    expect(summary.importedCount).toBe(98);
    expect(summary.duplicateExistingCount).toBe(2);
  });

  test('27. full re-upload is idempotent', async () => {
    const bills = [makeBill({ externalBillNumber: 'IDEMP-1' }), makeBill({ externalBillNumber: 'IDEMP-2' }), makeBill({ externalBillNumber: 'IDEMP-3' })];
    const first = await applyImport('purchase', bills, mockApply.deps, ACTOR);
    expect(first.importedCount).toBe(3);
    expect(first.duplicateExistingCount).toBe(0);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(3);
    expect(mockApply.state.loadExistingBillNumbersCalls).toHaveLength(1);
    mockApply.state.createPurchaseBillCalls.length = 0;
    mockApply.state.loadExistingBillNumbersCalls.length = 0;
    const second = await applyImport('purchase', bills, mockApply.deps, ACTOR);
    expect(second.importedCount).toBe(0);
    expect(second.duplicateExistingCount).toBe(3);
    expect(mockApply.state.createPurchaseBillCalls).toHaveLength(0);
    expect(mockApply.state.loadExistingBillNumbersCalls).toHaveLength(1);
    expect(mockApply.state.stockLotWrites).toBe(3);
  });
});

// ============================================================================
// 28-30: Additional tests
// ============================================================================

describe('ST-8 rev 2: Transaction / rollback parity', () => {
  test('28. server total recomputed (not client)', async () => {
    let recordedSellArgs: { data: { totalAmount: number; totalCost: number } } | null = null;
    const sourceLots: SellSourceLot[] = [{ id: 'lot-1', productId: 'p1', remainingWeight: 100, costPerKg: 50, dateAdded: new Date('2026-01-01'), createdAt: new Date('2026-01-01') }];
    const mockDeps: SellBillServiceDeps = {
      checkStockAvailability: async () => ({ ok: true as const }),
      generateBillNumber: async () => 'SELL-TEST-001',
      transaction: async (fn) => {
        const tx: SellBillTx = {
          createSellBill: async (args) => {
            recordedSellArgs = args as never;
            return { id: 'sell-1', externalBillNumber: args.data.externalBillNumber, items: args.data.items.create.map((it) => ({ productId: it.productId, weight: it.weight, pricePerKg: it.pricePerKg })) };
          },
          findSourceLots: async () => sourceLots,
          bulkUpdateStockLotRemaining: async () => undefined,
          createAuditLog: async () => undefined,
        };
        return fn(tx);
      },
    };
    const result = await createSellBillService(mockDeps, {
      date: '2026-01-01T03:00:00.000Z', isCredit: false,
      items: [{ productId: 'prod-1', weight: 10, pricePerKg: 100 }, { productId: 'prod-1', weight: 5, pricePerKg: 200 }],
    }, ADMIN);
    expect(result.totalAmount).toBe(2000);
    expect(result.totalCost).toBe(750);
    expect(recordedSellArgs).not.toBeNull();
    expect(recordedSellArgs!.data.totalAmount).toBe(2000);
    expect(recordedSellArgs!.data.totalCost).toBe(750);
  });

  test('29. AuditLog failure rollback parity ($transaction in bill-services)', () => {
    const billServicesSrc = readSource(BILL_SERVICES_PATH);
    const buyServiceStart = billServicesSrc.indexOf('export async function createBuyBillService');
    expect(buyServiceStart).toBeGreaterThan(-1);
    let buyBraceDepth = 0;
    let buyServiceEnd = -1;
    for (let i = buyServiceStart; i < billServicesSrc.length; i++) {
      const ch = billServicesSrc[i];
      if (ch === '{') buyBraceDepth++;
      else if (ch === '}') {
        buyBraceDepth--;
        if (buyBraceDepth === 0) { buyServiceEnd = i + 1; break; }
      }
    }
    expect(buyServiceEnd).toBeGreaterThan(buyServiceStart);
    const buyServiceBody = billServicesSrc.slice(buyServiceStart, buyServiceEnd);
    expect(buyServiceBody).toMatch(/deps\.transaction\s*\(/);
    expect(buyServiceBody).toMatch(/tx\.createBuyBill\s*\(/);
    expect(buyServiceBody).toMatch(/tx\.createStockLots\s*\(/);
    expect(buyServiceBody).toMatch(/tx\.createAuditLog\s*\(/);
    const txStart = buyServiceBody.indexOf('deps.transaction(async (tx) => {');
    const txEnd = buyServiceBody.indexOf('return buyBill', txStart);
    const txBody = buyServiceBody.slice(txStart, txEnd);
    expect(txBody).toMatch(/createBuyBill/);
    expect(txBody).toMatch(/createStockLots/);
    expect(txBody).toMatch(/createAuditLog/);

    const sellServiceStart = billServicesSrc.indexOf('export async function createSellBillService');
    expect(sellServiceStart).toBeGreaterThan(-1);
    let sellBraceDepth = 0;
    let sellServiceEnd = -1;
    for (let i = sellServiceStart; i < billServicesSrc.length; i++) {
      const ch = billServicesSrc[i];
      if (ch === '{') sellBraceDepth++;
      else if (ch === '}') {
        sellBraceDepth--;
        if (sellBraceDepth === 0) { sellServiceEnd = i + 1; break; }
      }
    }
    expect(sellServiceEnd).toBeGreaterThan(sellServiceStart);
    const sellServiceBody = billServicesSrc.slice(sellServiceStart, sellServiceEnd);
    expect(sellServiceBody).toMatch(/deps\.transaction\s*\(/);
    expect(sellServiceBody).toMatch(/tx\.createSellBill\s*\(/);
    expect(sellServiceBody).toMatch(/tx\.bulkUpdateStockLotRemaining\s*\(/);
    expect(sellServiceBody).toMatch(/tx\.createAuditLog\s*\(/);
  });

  test('30. bill creation failure rollback parity', async () => {
    let stockLotsCalled = false;
    let auditLogCalled = false;
    const mockDeps: BuyBillServiceDeps = {
      generateBillNumber: async () => 'BUY-TEST-FAIL',
      transaction: async (fn) => {
        const tx: BuyBillTx = {
          createBuyBill: async () => { throw new Error('Prisma createBuyBill failed (simulated)'); },
          createStockLots: async () => { stockLotsCalled = true; return undefined; },
          createAuditLog: async () => { auditLogCalled = true; return undefined; },
        };
        return fn(tx);
      },
    };
    await expect(createBuyBillService(mockDeps, {
      date: '2026-01-01T03:00:00.000Z', isCredit: false,
      items: [{ productId: 'prod-1', weight: 10, pricePerKg: 100 }],
    }, ADMIN)).rejects.toThrow('Prisma createBuyBill failed');
    expect(stockLotsCalled).toBe(false);
    expect(auditLogCalled).toBe(false);
  });
});
