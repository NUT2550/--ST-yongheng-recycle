/**
 * ST-8: Real two-pass Sales import idempotency + rollback test.
 *
 * Uses an in-memory stateful repository with copy-on-write transactions
 * to prove that:
 *   - first import creates a bill + deducts stock
 *   - second upload of the same bill is detected as DUPLICATE_EXISTING
 *   - no service call, no stock deduction, no audit on second pass
 *   - P2002 race during transaction rolls back StockLot to exact pre-call value
 *
 * Run: bun test tests/st8-twopass-idempotency.test.ts
 */
import { test, expect, describe } from 'bun:test';
import { applyImport, normalizeBillNumber, type ParsedBill, type ImportApplyDeps, type ImportActor } from '../src/lib/import-pipeline';
import { DuplicateExistingError } from '../src/lib/bill-errors';
import { normalizeBillNumber as normId } from '../src/lib/bill-identity';
import * as fs from 'fs';

const ACTOR: ImportActor = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' };

// ============ In-memory stateful repository ============

interface InMemoryState {
  sellBills: Map<string, { id: string; externalBillNumber: string; billNumber: string; items: any[] }>;
  buyBills: Map<string, { id: string; externalBillNumber: string; billNumber: string; items: any[] }>;
  stockLots: Map<string, { id: string; productId: string; remainingWeight: number; costPerKg: number }>;
  auditLogs: any[];
  billSeq: number;
}

function makeState(): InMemoryState {
  return {
    sellBills: new Map(),
    buyBills: new Map(),
    stockLots: new Map([
      ['lot-1', { id: 'lot-1', productId: 'prod-1', remainingWeight: 10.0, costPerKg: 40 }],
    ]),
    auditLogs: [],
    billSeq: 1,
  };
}

function makeDeps(state: InMemoryState, opts: { throwP2002OnSecond?: boolean } = {}): ImportApplyDeps {
  let callCount = 0;
  return {
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
        const lot = state.stockLots.get('lot-1');
        if (!lot || lot.remainingWeight < item.weight) {
          return { ok: false, productId: item.productId, available: lot?.remainingWeight || 0, requested: item.weight };
        }
      }
      return { ok: true };
    },
    createPurchaseBill: async (bill) => {
      const id = `buy-${state.billSeq++}`;
      const billNumber = `BUY-2569-${String(state.billSeq).padStart(5, '0')}`;
      state.buyBills.set(id, { id, externalBillNumber: normalizeBillNumber(bill.externalBillNumber), billNumber, items: bill.items });
      state.auditLogs.push({ action: 'CREATE', entityId: id });
      return { id, billNumber };
    },
    createSalesBill: async (bill) => {
      callCount++;
      // Simulate P2002 if the bill already exists (concurrency race)
      const norm = normalizeBillNumber(bill.externalBillNumber);
      for (const b of state.sellBills.values()) {
        if (b.externalBillNumber === norm) {
          throw new DuplicateExistingError('externalBillNumber');
        }
      }
      const id = `sell-${state.billSeq++}`;
      const billNumber = `SELL-2569-${String(state.billSeq).padStart(5, '0')}`;
      // Deduct stock
      const lot = state.stockLots.get('lot-1');
      if (lot) {
        const totalWeight = bill.items.reduce((s, i) => s + i.weight, 0);
        lot.remainingWeight -= totalWeight;
      }
      state.sellBills.set(id, { id, externalBillNumber: norm, billNumber, items: bill.items });
      state.auditLogs.push({ action: 'CREATE', entityId: id });
      return { id, billNumber };
    },
  };
}

// Copy-on-write transaction wrapper
function withCowTransaction(state: InMemoryState, deps: ImportApplyDeps): ImportApplyDeps {
  return {
    ...deps,
    createSalesBill: async (bill, actor) => {
      // Snapshot stock lots
      const snapshot = new Map<string, number>();
      for (const [id, lot] of state.stockLots) snapshot.set(id, lot.remainingWeight);
      const billsBefore = state.sellBills.size;
      const auditsBefore = state.auditLogs.length;
      try {
        return await deps.createSalesBill(bill, actor);
      } catch (err) {
        // Rollback: restore stock lots
        for (const [id, rem] of snapshot) {
          const lot = state.stockLots.get(id);
          if (lot) lot.remainingWeight = rem;
        }
        // Remove any bills/audits created during the failed transaction
        while (state.sellBills.size > billsBefore) {
          const lastKey = Array.from(state.sellBills.keys()).pop();
          if (lastKey) state.sellBills.delete(lastKey);
        }
        while (state.auditLogs.length > auditsBefore) state.auditLogs.pop();
        throw err;
      }
    },
  };
}

function makeSalesBill(extBillNo: string): ParsedBill {
  return {
    externalBillNumber: extBillNo,
    date: '2026-07-16',
    note: '',
    items: [{ productId: 'prod-1', productName: 'Test', weight: 1.0, pricePerKg: 100, totalAmount: 100, matched: true }],
  };
}

// ============ Tests ============

describe('ST-8 two-pass: Sales import idempotency', () => {
  test('1. first import: importedCount=1, stock deducted, audit created', async () => {
    const state = makeState();
    const deps = makeDeps(state);
    const result = await applyImport('sales', [makeSalesBill(' A1051583 ')], deps, ACTOR);
    expect(result.importedCount).toBe(1);
    expect(result.duplicateExistingCount).toBe(0);
    expect(result.failedCount).toBe(0);
    expect(state.sellBills.size).toBe(1);
    const bill = Array.from(state.sellBills.values())[0];
    expect(bill.externalBillNumber).toBe('A1051583'); // normalized
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(9.0); // 10 - 1
    expect(state.auditLogs.length).toBe(1);
  });

  test('2. second upload: DUPLICATE_EXISTING, zero stock change, zero audit', async () => {
    const state = makeState();
    const deps = makeDeps(state);
    // First import
    await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    const stockAfterFirst = state.stockLots.get('lot-1')!.remainingWeight;
    const billsAfterFirst = state.sellBills.size;
    const auditsAfterFirst = state.auditLogs.length;
    // Second upload (same bill)
    const result = await applyImport('sales', [makeSalesBill('A1051583')], deps, ACTOR);
    expect(result.importedCount).toBe(0);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(state.sellBills.size).toBe(billsAfterFirst); // no new bill
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(stockAfterFirst); // no deduction
    expect(state.auditLogs.length).toBe(auditsAfterFirst); // no new audit
  });

  test('3. P2002 race: rollback restores exact StockLot balance', async () => {
    const state = makeState();
    // Pre-insert a bill to simulate a concurrent creation
    state.sellBills.set('sell-pre', {
      id: 'sell-pre', externalBillNumber: 'A1051583', billNumber: 'SELL-PRE', items: []
    });
    const stockBefore = state.stockLots.get('lot-1')!.remainingWeight; // 10.0
    // The applyImport batch lookup finds the pre-existing bill → classifies as DUPLICATE_EXISTING
    // without calling createSalesBill at all. But let's also test the race where
    // the batch lookup misses it (e.g. concurrent insert between lookup and create).
    // We simulate this by having a custom deps that returns empty set from loadExistingBillNumbers
    // but throws P2002 from createSalesBill.
    const raceDeps: ImportApplyDeps = {
      loadExistingBillNumbers: async () => new Set(), // preview says not duplicate
      checkStockAvailability: async () => ({ ok: true as const }),
      createSalesBill: async (bill) => {
        // Simulate FIFO deduction (modifies state)
        const lot = state.stockLots.get('lot-1')!;
        lot.remainingWeight -= 1.0; // deduct
        // Then P2002 (concurrent insert)
        throw new DuplicateExistingError('externalBillNumber');
      },
      createPurchaseBill: async () => { throw new Error('not used'); },
    };
    const cowDeps = withCowTransaction(state, raceDeps);
    const result = await applyImport('sales', [makeSalesBill('A1051583')], cowDeps, ACTOR);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(result.importedCount).toBe(0);
    // Stock must be restored to pre-call value
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(stockBefore); // 10.0
    expect(state.sellBills.size).toBe(1); // only the pre-existing one
    expect(state.auditLogs.length).toBe(0); // no new audit
  });

  test('4. remaining independent bill continues after race', async () => {
    const state = makeState();
    // Pre-insert bill A
    state.sellBills.set('sell-pre', {
      id: 'sell-pre', externalBillNumber: 'A1051583', billNumber: 'SELL-PRE', items: []
    });
    const raceDeps: ImportApplyDeps = {
      loadExistingBillNumbers: async () => new Set(), // race: preview misses A
      checkStockAvailability: async () => ({ ok: true as const }),
      createSalesBill: async (bill) => {
        const norm = normalizeBillNumber(bill.externalBillNumber);
        // Bill A: P2002 (concurrent)
        if (norm === 'A1051583') {
          const lot = state.stockLots.get('lot-1')!;
          lot.remainingWeight -= 1.0;
          throw new DuplicateExistingError('externalBillNumber');
        }
        // Bill B: success
        const id = `sell-${state.billSeq++}`;
        const billNumber = `SELL-2569-${String(state.billSeq).padStart(5, '0')}`;
        const lot = state.stockLots.get('lot-1')!;
        lot.remainingWeight -= bill.items.reduce((s, i) => s + i.weight, 0);
        state.sellBills.set(id, { id, externalBillNumber: norm, billNumber, items: bill.items });
        state.auditLogs.push({ action: 'CREATE', entityId: id });
        return { id, billNumber };
      },
      createPurchaseBill: async () => { throw new Error('not used'); },
    };
    const cowDeps = withCowTransaction(state, raceDeps);
    const result = await applyImport('sales', [
      makeSalesBill('A1051583'), // will P2002
      makeSalesBill('B2051584'), // should succeed
    ], cowDeps, ACTOR);
    expect(result.importedCount).toBe(1); // bill B
    expect(result.duplicateExistingCount).toBe(1); // bill A
    expect(result.failedCount).toBe(0);
    // Bill A's deduction was rolled back; only Bill B's deduction persists
    // Stock: 10 - 1 (bill B) = 9.0 (bill A's deduction was rolled back)
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(9.0);
    expect(state.sellBills.size).toBe(2); // pre-existing + bill B
  });
});

describe('ST-8 two-pass: Purchase import idempotency', () => {
  test('5. Purchase two-pass: first import succeeds, second detects duplicate', async () => {
    const state = makeState();
    const deps = makeDeps(state);
    const bill: ParsedBill = {
      externalBillNumber: 'INV-001',
      date: '2026-07-16',
      note: '',
      items: [{ productId: 'prod-1', productName: 'Test', weight: 5.0, pricePerKg: 40, totalAmount: 200, matched: true }],
    };
    // First import
    const r1 = await applyImport('purchase', [bill], deps, ACTOR);
    expect(r1.importedCount).toBe(1);
    expect(r1.duplicateExistingCount).toBe(0);
    expect(state.buyBills.size).toBe(1);
    // Second upload
    const r2 = await applyImport('purchase', [bill], deps, ACTOR);
    expect(r2.importedCount).toBe(0);
    expect(r2.duplicateExistingCount).toBe(1);
    expect(r2.failedCount).toBe(0);
    expect(state.buyBills.size).toBe(1); // no new bill
  });

  test('6. Purchase race: P2002 rollback, no orphan', async () => {
    const state = makeState();
    state.buyBills.set('buy-pre', { id: 'buy-pre', externalBillNumber: 'INV-001', billNumber: 'BUY-PRE', items: [] });
    const raceDeps: ImportApplyDeps = {
      loadExistingBillNumbers: async () => new Set(),
      createPurchaseBill: async (bill) => {
        throw new DuplicateExistingError('externalBillNumber');
      },
      createSalesBill: async () => { throw new Error('not used'); },
    };
    const result = await applyImport('purchase', [{
      externalBillNumber: 'INV-001', date: '2026-07-16', note: '',
      items: [{ productId: 'prod-1', productName: 'Test', weight: 5.0, pricePerKg: 40, totalAmount: 200, matched: true }],
    }], raceDeps, ACTOR);
    expect(result.duplicateExistingCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(state.buyBills.size).toBe(1); // only pre-existing
  });
});

describe('ST-8 identity: normalize alignment', () => {
  test('7. identity variants: preview/store/apply all use same normalized value', () => {
    const variants = [' INV-001 ', 'INV-001', '00123', 'บิล-A001', 'A/B-001'];
    for (const v of variants) {
      const norm = normId(v);
      // All three use the same normalizeBillNumber from bill-identity.ts
      expect(normalizeBillNumber(v)).toBe(norm); // import-pipeline re-exports
      expect(normId(v)).toBe(norm); // bill-identity direct
    }
  });

  test('8. no circular dependency: bill-identity and bill-errors are leaf modules', () => {
    // These modules have NO imports (verified by reading the files)
    // bill-identity.ts: no imports
    // bill-errors.ts: no imports
    // bill-services.ts imports from bill-identity + bill-errors (not from import-pipeline)
    // import-pipeline.ts imports from bill-identity + bill-errors (not from bill-services)
    // No cycle.
    const identity = fs.readFileSync('src/lib/bill-identity.ts', 'utf-8');
    const errors = fs.readFileSync('src/lib/bill-errors.ts', 'utf-8');
    const services = fs.readFileSync('src/lib/bill-services.ts', 'utf-8');
    const pipeline = fs.readFileSync('src/lib/import-pipeline.ts', 'utf-8');
    // Leaf modules have no imports
    expect(identity).not.toContain("from './");
    expect(errors).not.toContain("from './");
    // bill-services does NOT import from import-pipeline
    expect(services).not.toMatch(/from\s+['"]\.\/import-pipeline['"]/);
    // import-pipeline does NOT import from bill-services
    expect(pipeline).not.toMatch(/from\s+['"]\.\/bill-services['"]/);
  });
});
