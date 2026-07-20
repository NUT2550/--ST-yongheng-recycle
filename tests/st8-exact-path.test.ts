/**
 * ST-8: Exact-path tests through real shared bill services.
 *
 * These tests execute:
 *   applyImport → ImportApplyDeps adapter → createBuyBillService/createSellBillService
 *   → shared validation → FIFO → transaction → bill creation → AuditLog → P2002
 *
 * The in-memory deps implement the SAME interfaces as the Prisma adapters,
 * but with rollback-capable copy-on-write transactions. The shared services
 * (createBuyBillService, createSellBillService) are the EXACT production code.
 *
 * Run: bun test tests/st8-exact-path.test.ts
 */
import { test, expect, describe } from 'bun:test';
import { applyImport, type ParsedBill, type ImportApplyDeps, type ImportActor } from '../src/lib/import-pipeline';
import { createBuyBillService, createSellBillService, type BuyBillServiceDeps, type BuyBillTx, type BuyBillCreatedBill, type SellBillServiceDeps, type SellBillTx, type SellBillCreatedBill, type BuyBillInput, type SellBillInput } from '../src/lib/bill-services';
import { DuplicateExistingError } from '../src/lib/bill-errors';
import { normalizeBillNumber } from '../src/lib/bill-identity';
import type { AuthPayload } from '../src/lib/permissions';
import * as fs from "fs";

const AUTH: AuthPayload = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' };
const ACTOR: ImportActor = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' };

// ============ In-memory state with copy-on-write transactions ============

interface MemState {
  buyBills: Map<string, any>;
  sellBills: Map<string, any>;
  stockLots: Map<string, { id: string; productId: string; remainingWeight: number; costPerKg: number; dateAdded: Date; createdAt: Date }>;
  auditLogs: any[];
  creditEntries: any[];
  billSeq: number;
}

function makeState(): MemState {
  return {
    buyBills: new Map(),
    sellBills: new Map(),
    stockLots: new Map([
      ['lot-1', { id: 'lot-1', productId: 'prod-1', remainingWeight: 10.0, costPerKg: 40, dateAdded: new Date('2026-01-01'), createdAt: new Date('2026-01-01') }],
    ]),
    auditLogs: [],
    creditEntries: [],
    billSeq: 1,
  };
}

// ============ In-memory SellBill service deps with copy-on-write transaction ============

function makeInMemorySellDeps(state: MemState, opts: { p2002OnCreate?: boolean; p2002Target?: string[] } = {} = {}): SellBillServiceDeps<SellBillCreatedBill> {
  let serviceCallCount = 0;
  let fifoQueryCount = 0;
  let stockUpdateCount = 0;

  return {
    checkStockAvailability: async (items) => {
      for (const item of items) {
        const lots = Array.from(state.stockLots.values()).filter(l => l.productId === item.productId && l.remainingWeight > 0);
        const total = lots.reduce((s, l) => s + l.remainingWeight, 0);
        if (total < item.weight) return { ok: false, productId: item.productId, available: total, requested: item.weight };
      }
      return { ok: true };
    },
    generateBillNumber: async () => `SELL-2569-${String(++state.billSeq).padStart(5, '0')}`,
    transaction: async <T>(fn: (tx: SellBillTx<SellBillCreatedBill>) => Promise<T>): Promise<T> => {
      // Copy-on-write: snapshot stock lots
      const lotSnapshot = new Map<string, number>();
      for (const [id, lot] of state.stockLots) lotSnapshot.set(id, lot.remainingWeight);
      const billsBefore = state.sellBills.size;
      const auditsBefore = state.auditLogs.length;
      const creditsBefore = state.creditEntries.length;

      const tx: SellBillTx<SellBillCreatedBill> = {
        createSellBill: async (args) => {
          if (opts.p2002OnCreate) {
            // Simulate P2002 with target info
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            err.meta = { target: opts.p2002Target || ['externalBillNumber'] };
            throw err;
          }
          const id = `sell-${state.billSeq++}`;
          const bill = { id, externalBillNumber: args.data.externalBillNumber, items: args.data.items.create.map((it: any) => ({ productId: it.productId, weight: it.weight, pricePerKg: it.pricePerKg })) };
          state.sellBills.set(id, bill);
          return bill as SellBillCreatedBill;
        },
        findSourceLots: async (productId) => {
          fifoQueryCount++;
          return Array.from(state.stockLots.values()).filter(l => l.productId === productId && l.remainingWeight > 0);
        },
        bulkUpdateStockLotRemaining: async (updates) => {
          stockUpdateCount += updates.length;
          for (const update of updates) {
            const lot = state.stockLots.get(update.id);
            if (lot) lot.remainingWeight = update.newRemainingWeight;
          }
          return {};
        },
        createCreditEntry: async (data) => { state.creditEntries.push(data); return {}; },
        createAuditLog: async (data) => { state.auditLogs.push(data); return {}; },
      };

      try {
        const result = await fn(tx);
        // Commit: keep all changes
        return result;
      } catch (err) {
        // Rollback: restore stock lots
        for (const [id, rem] of lotSnapshot) {
          const lot = state.stockLots.get(id);
          if (lot) lot.remainingWeight = rem;
        }
        // Remove any bills/audits/credits created during the failed transaction
        while (state.sellBills.size > billsBefore) {
          const lastKey = Array.from(state.sellBills.keys()).pop();
          if (lastKey) state.sellBills.delete(lastKey);
        }
        while (state.auditLogs.length > auditsBefore) state.auditLogs.pop();
        while (state.creditEntries.length > creditsBefore) state.creditEntries.pop();
        throw err;
      }
    },
  } as any;
}

// ============ In-memory BuyBill service deps ============

function makeInMemoryBuyDeps(state: MemState, opts: { p2002OnCreate?: boolean; p2002Target?: string[] } = {} = {}): BuyBillServiceDeps<BuyBillCreatedBill> {
  return {
    generateBillNumber: async () => `BUY-2569-${String(++state.billSeq).padStart(5, '0')}`,
    transaction: async <T>(fn: (tx: BuyBillTx<BuyBillCreatedBill>) => Promise<T>): Promise<T> => {
      const lotSnapshot = new Map<string, number>();
      for (const [id, lot] of state.stockLots) lotSnapshot.set(id, lot.remainingWeight);
      const billsBefore = state.buyBills.size;
      const auditsBefore = state.auditLogs.length;
      const creditsBefore = state.creditEntries.length;

      const tx: BuyBillTx<BuyBillCreatedBill> = {
        createBuyBill: async (args) => {
          if (opts.p2002OnCreate) {
            const err: any = new Error('Unique constraint failed');
            err.code = 'P2002';
            err.meta = { target: opts.p2002Target || ['externalBillNumber'] };
            throw err;
          }
          const id = `buy-${state.billSeq++}`;
          const bill = { id, externalBillNumber: args.data.externalBillNumber, items: args.data.items.create.map((it: any) => ({ productId: it.productId, weight: it.weight, pricePerKg: it.pricePerKg })) };
          state.buyBills.set(id, bill);
          return bill as BuyBillCreatedBill;
        },
        createStockLots: async (data: any[]) => {
          for (const d of data) {
            const lotId = `lot-${state.billSeq++}`;
            state.stockLots.set(lotId, { id: lotId, productId: d.productId, remainingWeight: d.remainingWeight, costPerKg: d.costPerKg, dateAdded: d.dateAdded, createdAt: new Date() });
          }
          return { count: data.length };
        },
        createCreditEntry: async (data) => { state.creditEntries.push(data); return {}; },
        createAuditLog: async (data) => { state.auditLogs.push(data); return {}; },
      };

      try {
        return await fn(tx);
      } catch (err) {
        for (const [id, rem] of lotSnapshot) {
          const lot = state.stockLots.get(id);
          if (lot) lot.remainingWeight = rem;
        }
        while (state.buyBills.size > billsBefore) {
          const lastKey = Array.from(state.buyBills.keys()).pop();
          if (lastKey) state.buyBills.delete(lastKey);
        }
        while (state.auditLogs.length > auditsBefore) state.auditLogs.pop();
        while (state.creditEntries.length > creditsBefore) state.creditEntries.pop();
        throw err;
      }
    },
  } as any;
}

// ============ ImportApplyDeps that calls real shared services ============

function makeImportDeps(state: MemState, opts: { p2002OnCreate?: boolean; p2002Target?: string[]; skipBatchLookup?: boolean } = {}): ImportApplyDeps {
  let sellServiceCalls = 0;
  let buyServiceCalls = 0;

  const deps: ImportApplyDeps = {
    loadExistingBillNumbers: async (type, candidates) => {
      const bills = type === 'sales' ? state.sellBills : state.buyBills;
      const existing = new Set<string>();
      for (const b of bills.values()) {
        if (b.externalBillNumber) existing.add(normalizeBillNumber(b.externalBillNumber));
      }
      return existing;
    },
    checkStockAvailability: async (items) => {
      for (const item of items) {
        const lots = Array.from(state.stockLots.values()).filter(l => l.productId === item.productId && l.remainingWeight > 0);
        const total = lots.reduce((s, l) => s + l.remainingWeight, 0);
        if (total < item.weight) return { ok: false, productId: item.productId, available: total, requested: item.weight };
      }
      return { ok: true };
    },
    createPurchaseBill: async (bill, actor) => {
      buyServiceCalls++;
      const input: BuyBillInput = {
        date: bill.date,
        isCredit: false,
        note: bill.note,
        externalBillNumber: bill.externalBillNumber,
        items: bill.items.map(i => ({ productId: i.productId, weight: i.weight, weightExpression: i.weightExpression, pricePerKg: i.pricePerKg })),
      };
      const result = await createBuyBillService(makeInMemoryBuyDeps(state, opts), input, actor as any);
      return { id: result.bill.id, billNumber: result.billNumber };
    },
    createSalesBill: async (bill, actor) => {
      sellServiceCalls++;
      const input: SellBillInput = {
        date: bill.date,
        isCredit: false,
        note: bill.note,
        externalBillNumber: bill.externalBillNumber,
        items: bill.items.map(i => ({ productId: i.productId, weight: i.weight, weightExpression: i.weightExpression, pricePerKg: i.pricePerKg })),
      };
      const result = await createSellBillService(makeInMemorySellDeps(state, opts), input, actor as any);
      return { id: result.bill.id, billNumber: result.billNumber };
    },
  };
  // Attach call counts for test assertions
  (deps as any)._sellServiceCalls = () => sellServiceCalls;
  (deps as any)._buyServiceCalls = () => buyServiceCalls;
  return deps;
}

function makeSalesBill(extNo: string): ParsedBill {
  return { externalBillNumber: extNo, date: '2026-07-16', note: '', items: [{ productId: 'prod-1', productName: 'Test', weight: 1.0, pricePerKg: 100, totalAmount: 100, matched: true }] };
}
function makePurchaseBill(extNo: string): ParsedBill {
  return { externalBillNumber: extNo, date: '2026-07-16', note: '', items: [{ productId: 'prod-1', productName: 'Test', weight: 5.0, pricePerKg: 40, totalAmount: 200, matched: true }] };
}

// ============ Tests ============

describe('ST-8 exact-path: Sales two-pass through createSellBillService', () => {
  test('1. first Sales import calls createSellBillService, stores identity, deducts stock', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    const result = await applyImport('sales', [makeSalesBill(' A1051583 ')], deps, ACTOR);
    expect(result.importedCount).toBe(1);
    expect(result.duplicateExistingCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect((deps as any)._sellServiceCalls()).toBe(1);
    expect(state.sellBills.size).toBe(1);
    const bill = Array.from(state.sellBills.values())[0];
    expect(bill.externalBillNumber).toBe('A1051583');
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(9.0);
    expect(state.auditLogs.length).toBe(1);
  });

  test('2. second Sales upload skips createSellBillService, zero stock/audit change', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    const stockAfter1 = state.stockLots.get('lot-1')!.remainingWeight;
    const auditsAfter1 = state.auditLogs.length;
    const billsAfter1 = state.sellBills.size;
    const callsAfter1 = (deps as any)._sellServiceCalls();

    const result = await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    expect(result.importedCount).toBe(0);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect((deps as any)._sellServiceCalls()).toBe(callsAfter1); // no new service call
    expect(state.sellBills.size).toBe(billsAfter1);
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(stockAfter1);
    expect(state.auditLogs.length).toBe(auditsAfter1);
  });
});

describe('ST-8 exact-path: Sales P2002 race through createSellBillService', () => {
  test('3. P2002 externalBillNumber → DuplicateExistingError → rollback restores stock', async () => {
    const state = makeState();
    const deps = makeImportDeps(state, { p2002OnCreate: true, p2002Target: ['externalBillNumber'] });
    const stockBefore = state.stockLots.get('lot-1')!.remainingWeight; // 10.0
    const result = await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    expect(result.importedCount).toBe(0);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect((deps as any)._sellServiceCalls()).toBe(1); // service WAS called (race)
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(stockBefore); // 10.0 — rollback
    expect(state.sellBills.size).toBe(0);
    expect(state.auditLogs.length).toBe(0);
  });

  test('4. remaining bill continues after race', async () => {
    const state = makeState();
    // Bill A: will P2002; Bill B: will succeed
    // Need different deps per bill — use a custom approach
    let callIdx = 0;
    const deps: ImportApplyDeps = {
      loadExistingBillNumbers: async () => new Set(),
      checkStockAvailability: async () => ({ ok: true as const }),
      createSalesBill: async (bill, actor) => {
        callIdx++;
        const opts = callIdx === 1 ? { p2002OnCreate: true, p2002Target: ['externalBillNumber'] } : {};
        const input: SellBillInput = {
          date: bill.date, isCredit: false, note: bill.note,
          externalBillNumber: bill.externalBillNumber,
          items: bill.items.map(i => ({ productId: i.productId, weight: i.weight, pricePerKg: i.pricePerKg })),
        };
        const result = await createSellBillService(makeInMemorySellDeps(state, opts), input, actor as any);
        return { id: result.bill.id, billNumber: result.billNumber };
      },
      createPurchaseBill: async () => { throw new Error('not used'); },
    };
    const result = await applyImport('sales', [makeSalesBill('A1051583'), makeSalesBill('B2051584')], deps, ACTOR);
    expect(result.importedCount).toBe(1); // Bill B
    expect(result.duplicateExistingCount).toBe(1); // Bill A
    expect(result.failedCount).toBe(0);
    expect(state.sellBills.size).toBe(1); // only Bill B
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(9.0); // 10 - 1 (Bill B only)
  });
});

describe('ST-8 exact-path: Purchase two-pass through createBuyBillService', () => {
  test('5. first Purchase import calls createBuyBillService, creates BuyBill + StockLots', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    const result = await applyImport('purchase', [makePurchaseBill('INV-001')], deps, ACTOR);
    expect(result.importedCount).toBe(1);
    expect(result.duplicateExistingCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect((deps as any)._buyServiceCalls()).toBe(1);
    expect(state.buyBills.size).toBe(1);
    const bill = Array.from(state.buyBills.values())[0];
    expect(bill.externalBillNumber).toBe('INV-001');
    // StockLots created (BUY lots added)
    expect(state.stockLots.size).toBe(2); // original lot-1 + new BUY lot
    expect(state.auditLogs.length).toBe(1);
  });

  test('6. second Purchase upload skips createBuyBillService, zero change', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    await applyImport('purchase', [makePurchaseBill('INV-001')], deps, ACTOR);
    const billsAfter1 = state.buyBills.size;
    const lotsAfter1 = state.stockLots.size;
    const auditsAfter1 = state.auditLogs.length;
    const callsAfter1 = (deps as any)._buyServiceCalls();

    const result = await applyImport('purchase', [makePurchaseBill('INV-001')], deps, ACTOR);
    expect(result.importedCount).toBe(0);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect((deps as any)._buyServiceCalls()).toBe(callsAfter1);
    expect(state.buyBills.size).toBe(billsAfter1);
    expect(state.stockLots.size).toBe(lotsAfter1);
    expect(state.auditLogs.length).toBe(auditsAfter1);
  });

  test('7. Purchase P2002 race: rollback, no orphan', async () => {
    const state = makeState();
    const deps = makeImportDeps(state, { p2002OnCreate: true, p2002Target: ['externalBillNumber'] });
    const billsBefore = state.buyBills.size;
    const lotsBefore = state.stockLots.size;
    const auditsBefore = state.auditLogs.length;
    const result = await applyImport('purchase', [makePurchaseBill('INV-001')], deps, ACTOR);
    expect(result.importedCount).toBe(0);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(state.buyBills.size).toBe(billsBefore);
    expect(state.stockLots.size).toBe(lotsBefore);
    expect(state.auditLogs.length).toBe(auditsBefore);
  });
});

describe('ST-8 exact-path: P2002 target detection', () => {
  test('8. P2002 target externalBillNumber → DUPLICATE_EXISTING', async () => {
    const state = makeState();
    const deps = makeImportDeps(state, { p2002OnCreate: true, p2002Target: ['externalBillNumber'] });
    const result = await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
  });

  test('9. P2002 target billNumber → FAILED (not external duplicate)', async () => {
    const state = makeState();
    const deps = makeImportDeps(state, { p2002OnCreate: true, p2002Target: ['billNumber'] });
    const result = await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    // billNumber collision is NOT an external duplicate — should be FAILED
    expect(result.failedCount).toBe(1);
    expect(result.duplicateExistingCount).toBe(0);
  });

  test('10. unknown P2002 target → FAILED', async () => {
    const state = makeState();
    const deps = makeImportDeps(state, { p2002OnCreate: true, p2002Target: ['someOtherField'] });
    const result = await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    expect(result.failedCount).toBe(1);
    expect(result.duplicateExistingCount).toBe(0);
  });
});

describe('ST-8 exact-path: route adapter parity', () => {
  test('11. buy-bills route imports makeBuyBillServiceDeps from shared adapter', () => {

    const src = fs.readFileSync('src/app/api/buy-bills/route.ts', 'utf-8');
    expect(src).toContain("makeBuyBillServiceDeps");
    expect(src).not.toContain("function makeBuyBillDeps()");
  });

  test('12. sell-bills route imports makeSellBillServiceDeps from shared adapter', () => {

    const src = fs.readFileSync('src/app/api/sell-bills/route.ts', 'utf-8');
    expect(src).toContain("makeSellBillServiceDeps");
    expect(src).not.toContain("function makeSellBillDeps()");
  });

  test('13. import apply route imports both from shared adapter', () => {

    const src = fs.readFileSync('src/app/api/import/apply/route.ts', 'utf-8');
    expect(src).toContain("makeBuyBillServiceDeps");
    expect(src).toContain("makeSellBillServiceDeps");
    expect(src).not.toContain("function makeBuyBillDeps()");
    expect(src).not.toContain("function makeSellBillDeps()");
    expect(src).not.toContain("function makeSellBillServiceDeps()");
  });

  test('14. shared adapter module exists and exports both factories', () => {

    const src = fs.readFileSync('src/lib/bill-service-prisma-adapters.ts', 'utf-8');
    expect(src).toContain("export function makeBuyBillServiceDeps");
    expect(src).toContain("export function makeSellBillServiceDeps");
  });
});

describe('ST-8 exact-path: identity alignment + no circular dependency', () => {
  test('15. identity variants: preview/store/apply use same normalizeBillNumber', () => {
    const variants = [' INV-001 ', 'INV-001', '00123', 'บิล-A001', 'A/B-001'];
    for (const v of variants) {
      const norm = normalizeBillNumber(v);
      expect(normalizeBillNumber(v)).toBe(norm);
    }
  });

  test('16. no circular dependency remains', () => {

    const identity = fs.readFileSync('src/lib/bill-identity.ts', 'utf-8');
    const errors = fs.readFileSync('src/lib/bill-errors.ts', 'utf-8');
    const services = fs.readFileSync('src/lib/bill-services.ts', 'utf-8');
    const pipeline = fs.readFileSync('src/lib/import-pipeline.ts', 'utf-8');
    expect(identity).not.toContain("from './");
    expect(errors).not.toContain("from './");
    expect(services).not.toMatch(/from\s+['"]\.\/import-pipeline['"]/);
    expect(pipeline).not.toMatch(/from\s+['"]\.\/bill-services['"]/);
  });
});
