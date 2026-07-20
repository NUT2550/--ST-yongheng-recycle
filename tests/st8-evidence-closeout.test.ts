/**
 * ST-8: Evidence closeout — exact error assertions, mixed import, Purchase through service.
 *
 * Replaces empty catch blocks with explicit error assertions.
 * Adds mixed Sales import through real createSellBillService.
 * Adds Purchase zero-price through real createBuyBillService.
 *
 * Run: bun test tests/st8-evidence-closeout.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  createBuyBillService,
  createSellBillService,
  validateBuyBillItemNumeric,
  validateSellBillItemNumeric,
  type BuyBillServiceDeps,
  type SellBillServiceDeps,
  type SellBillTx,
  type BuyBillTx,
  type BuyBillCreatedBill,
  type SellBillCreatedBill,
  type BuyBillInput,
  type SellBillInput,
} from '../src/lib/bill-services';
import { applyImport, type ParsedBill, type ImportApplyDeps, type ImportActor } from '../src/lib/import-pipeline';
import { DuplicateExistingError } from '../src/lib/bill-errors';
import type { AuthPayload } from '../src/lib/permissions';

const AUTH: AuthPayload = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' };
const ACTOR: ImportActor = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' };

// ============ In-memory state for service tests ============

interface MemState {
  sellBills: Map<string, { id: string; externalBillNumber: string; billNumber: string; items: any[] }>;
  buyBills: Map<string, { id: string; externalBillNumber: string; billNumber: string; items: any[] }>;
  stockLots: Map<string, { id: string; productId: string; remainingWeight: number; costPerKg: number; source: string; sourceId: string }>;
  auditLogs: any[];
  billSeq: number;
  callCounts: { stockCheck: number; generateBillNumber: number; transaction: number; fifoQuery: number; stockLotUpdate: number; sellBillCreate: number; buyBillCreate: number; creditEntry: number; auditLog: number };
}

function makeState(): MemState {
  return {
    sellBills: new Map(),
    buyBills: new Map(),
    stockLots: new Map([
      ['lot-1', { id: 'lot-1', productId: 'prod-1', remainingWeight: 10.0, costPerKg: 40, source: 'BUY', sourceId: 'buy-0' }],
    ]),
    auditLogs: [],
    billSeq: 1,
    callCounts: { stockCheck: 0, generateBillNumber: 0, transaction: 0, fifoQuery: 0, stockLotUpdate: 0, sellBillCreate: 0, buyBillCreate: 0, creditEntry: 0, auditLog: 0 },
  };
}

function makeSellDeps(state: MemState, opts: { p2002Target?: string[] } = {}): SellBillServiceDeps {
  return {
    checkStockAvailability: async (items) => {
      state.callCounts.stockCheck++;
      for (const item of items) {
        const lot = state.stockLots.get('lot-1');
        if (!lot || lot.remainingWeight < item.weight) {
          return { ok: false, productId: item.productId, available: lot?.remainingWeight || 0, requested: item.weight };
        }
      }
      return { ok: true as const };
    },
    generateBillNumber: async () => { state.callCounts.generateBillNumber++; return `SELL-${state.billSeq++}`; },
    transaction: async (fn) => {
      state.callCounts.transaction++;
      const snapshot = new Map<string, number>();
      for (const [id, lot] of state.stockLots) snapshot.set(id, lot.remainingWeight);
      const billsBefore = state.sellBills.size;
      const auditsBefore = state.auditLogs.length;
      try {
        const tx: SellBillTx = {
          createSellBill: async (args) => {
            state.callCounts.sellBillCreate++;
            if (opts.p2002Target) {
              const e = new Error('Unique constraint failed') as any;
              e.code = 'P2002';
              e.meta = { target: opts.p2002Target };
              throw e;
            }
            const id = `sell-${state.billSeq++}`;
            const bill = { id, externalBillNumber: args.data.externalBillNumber || '', billNumber: args.data.billNumber, items: args.data.items.create };
            state.sellBills.set(id, bill);
            return bill as unknown as SellBillCreatedBill;
          },
          findSourceLots: async (productId) => {
            state.callCounts.fifoQuery++;
            return Array.from(state.stockLots.values()).filter(l => l.productId === productId).map(l => ({
              id: l.id, productId: l.productId, remainingWeight: l.remainingWeight, costPerKg: l.costPerKg, dateAdded: new Date('2026-01-01'), createdAt: new Date('2026-01-01')
            }));
          },
          updateStockLotRemaining: async (id, newRem, expected) => {
            state.callCounts.stockLotUpdate++;
            const lot = state.stockLots.get(id);
            if (lot) lot.remainingWeight = newRem;
          },
          createCreditEntry: async () => { state.callCounts.creditEntry++; },
          createAuditLog: async (data) => { state.callCounts.auditLog++; state.auditLogs.push(data); },
        };
        return fn(tx);
      } catch (err) {
        // Rollback
        for (const [id, rem] of snapshot) {
          const lot = state.stockLots.get(id);
          if (lot) lot.remainingWeight = rem;
        }
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

function makeBuyDeps(state: MemState, opts: { p2002Target?: string[] } = {}): BuyBillServiceDeps {
  return {
    generateBillNumber: async () => { state.callCounts.generateBillNumber++; return `BUY-${state.billSeq++}`; },
    transaction: async (fn) => {
      state.callCounts.transaction++;
      const billsBefore = state.buyBills.size;
      const lotsBefore = state.stockLots.size;
      const auditsBefore = state.auditLogs.length;
      try {
        const tx: BuyBillTx = {
          createBuyBill: async (args) => {
            state.callCounts.buyBillCreate++;
            if (opts.p2002Target) {
              const e = new Error('Unique constraint failed') as any;
              e.code = 'P2002';
              e.meta = { target: opts.p2002Target };
              throw e;
            }
            const id = `buy-${state.billSeq++}`;
            const bill = { id, externalBillNumber: args.data.externalBillNumber || '', billNumber: args.data.billNumber, items: args.data.items.create };
            state.buyBills.set(id, bill);
            return bill as unknown as BuyBillCreatedBill;
          },
          createStockLots: async (lots) => {
            for (const lot of lots) {
              const lotId = `lot-${state.billSeq++}`;
              state.stockLots.set(lotId, { id: lotId, productId: lot.productId, remainingWeight: lot.remainingWeight, costPerKg: lot.costPerKg, source: lot.source, sourceId: lot.sourceId });
            }
          },
          createAuditLog: async (data) => { state.callCounts.auditLog++; state.auditLogs.push(data); },
          createCreditEntry: async () => { state.callCounts.creditEntry++; },
        };
        return fn(tx);
      } catch (err) {
        // Rollback
        while (state.buyBills.size > billsBefore) {
          const lastKey = Array.from(state.buyBills.keys()).pop();
          if (lastKey) state.buyBills.delete(lastKey);
        }
        while (state.stockLots.size > lotsBefore) {
          const lastKey = Array.from(state.stockLots.keys()).pop();
          if (lastKey && lastKey !== 'lot-1') state.stockLots.delete(lastKey);
        }
        while (state.auditLogs.length > auditsBefore) state.auditLogs.pop();
        throw err;
      }
    },
  };
}

function makeImportDeps(state: MemState): ImportApplyDeps {
  return {
    loadExistingBillNumbers: async (type, candidates) => {
      const bills = type === 'sales' ? state.sellBills : state.buyBills;
      const existing = new Set<string>();
      for (const b of bills.values()) {
        if (b.externalBillNumber) existing.add(b.externalBillNumber);
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
      return { ok: true as const };
    },
    createPurchaseBill: async (bill, actor) => {
      const input: BuyBillInput = {
        date: bill.date, isCredit: false, note: bill.note,
        externalBillNumber: bill.externalBillNumber,
        items: bill.items.map(i => ({ productId: i.productId, weight: i.weight, pricePerKg: i.pricePerKg })),
      };
      const result = await createBuyBillService(makeBuyDeps(state), input, actor as AuthPayload);
      return { id: result.bill.id, billNumber: result.billNumber };
    },
    createSalesBill: async (bill, actor) => {
      const input: SellBillInput = {
        date: bill.date, isCredit: false, note: bill.note,
        externalBillNumber: bill.externalBillNumber,
        items: bill.items.map(i => ({ productId: i.productId, weight: i.weight, pricePerKg: i.pricePerKg })),
      };
      const result = await createSellBillService(makeSellDeps(state), input, actor as AuthPayload);
      return { id: result.bill.id, billNumber: result.billNumber };
    },
  };
}

function makeSalesBill(extNo: string, price: number, weight: number = 1): ParsedBill {
  return {
    externalBillNumber: extNo, date: '2026-07-16', note: '',
    items: [{ productId: 'prod-1', productName: 'Test', weight, pricePerKg: price, totalAmount: weight * price, matched: true }],
  };
}

function makePurchaseBill(extNo: string, price: number, weight: number = 1): ParsedBill {
  return {
    externalBillNumber: extNo, date: '2026-07-16', note: '',
    items: [{ productId: 'prod-1', productName: 'Test', weight, pricePerKg: price, totalAmount: weight * price, matched: true }],
  };
}

// ============ Fix 1: Exact error assertions (no empty catch) ============

describe('ST-8 closeout: exact Sales zero-price error', () => {
  test('1. zero-price Sales: exact error message + zero side effects', async () => {
    const state = makeState();
    const deps = makeSellDeps(state);
    let caughtError: Error | null = null;
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch (err) {
      caughtError = err as Error;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError!.message).toBe('ราคา/กก. ต้องมากกว่า 0');
    expect(state.callCounts.stockCheck).toBe(0);
    expect(state.callCounts.generateBillNumber).toBe(0);
    expect(state.callCounts.transaction).toBe(0);
    expect(state.callCounts.fifoQuery).toBe(0);
    expect(state.callCounts.stockLotUpdate).toBe(0);
    expect(state.callCounts.sellBillCreate).toBe(0);
    expect(state.callCounts.creditEntry).toBe(0);
    expect(state.callCounts.auditLog).toBe(0);
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(10.0);
  });

  test('2. negative Sales price: exact error message', async () => {
    let caughtError: Error | null = null;
    try {
      await createSellBillService(makeSellDeps(makeState()), {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: -5 }],
      }, AUTH);
    } catch (err) { caughtError = err as Error; }
    expect(caughtError!.message).toBe('ราคา/กก. ต้องมากกว่า 0');
  });

  test('3. NaN Sales price: exact error', async () => {
    let caughtError: Error | null = null;
    try {
      await createSellBillService(makeSellDeps(makeState()), {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: NaN }],
      }, AUTH);
    } catch (err) { caughtError = err as Error; }
    expect(caughtError!.message).toBe('ราคา/กก. ต้องมากกว่า 0');
  });

  test('4. Infinity Sales price: exact error', async () => {
    let caughtError: Error | null = null;
    try {
      await createSellBillService(makeSellDeps(makeState()), {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: Infinity }],
      }, AUTH);
    } catch (err) { caughtError = err as Error; }
    expect(caughtError!.message).toBe('ราคา/กก. ต้องมากกว่า 0');
  });
});

// ============ Fix 2: Real mixed Sales import ============

describe('ST-8 closeout: mixed Sales import through createSellBillService', () => {
  test('5. valid + zero-price + valid: imports 2, rejects 1, stock 10→8', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    const result = await applyImport('sales', [
      makeSalesBill('SALE-A', 100),
      makeSalesBill('SALE-B', 0),
      makeSalesBill('SALE-C', 50),
    ], deps, ACTOR);
    expect(result.importedCount).toBe(2);
    expect(result.failedCount).toBe(1); // zero-price → service throws → FAILED
    expect(result.duplicateExistingCount).toBe(0);
    expect(state.sellBills.size).toBe(2);
    expect(state.auditLogs.length).toBe(2);
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(8.0); // 10 - 1 - 1
    expect(result.failedBills.some(b => b.externalBillNumber === 'SALE-B')).toBe(true);
    expect(result.failedBills[0].errorCode).toBe('BILL_CREATE_FAILED');
  });
});

// ============ Fix 3: Single zero-price Sales import ============

describe('ST-8 closeout: single zero-price Sales import', () => {
  test('6. zero-price import: zero side effects, FAILED classification', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    const result = await applyImport('sales', [makeSalesBill('SALE-ZERO', 0)], deps, ACTOR);
    expect(result.importedCount).toBe(0);
    expect(result.failedCount).toBe(1);
    expect(state.sellBills.size).toBe(0);
    expect(state.stockLots.get('lot-1')!.remainingWeight).toBe(10.0);
    expect(state.auditLogs.length).toBe(0);
    expect(result.failedBills[0].errorCode).toBe('BILL_CREATE_FAILED');
  });
});

// ============ Fix 4: Purchase zero-price through createBuyBillService ============

describe('ST-8 closeout: Purchase zero-price through createBuyBillService', () => {
  test('7. Purchase price 0: service succeeds, totalAmount=0, StockLot cost=0', async () => {
    const state = makeState();
    const deps = makeBuyDeps(state);
    const result = await createBuyBillService(deps, {
      date: '2026-07-16', isCredit: false,
      externalBillNumber: 'BUY-ZERO-001',
      items: [{ productId: 'prod-1', weight: 1.0, pricePerKg: 0 }],
    }, AUTH);
    expect(result.bill.id).toBeDefined();
    expect(result.totalAmount).toBe(0);
    expect(state.buyBills.size).toBe(1);
    const bill = Array.from(state.buyBills.values())[0];
    expect(bill.externalBillNumber).toBe('BUY-ZERO-001');
    // StockLot created
    const newLots = Array.from(state.stockLots.values()).filter(l => l.sourceId === bill.id);
    expect(newLots.length).toBe(1);
    expect(newLots[0].remainingWeight).toBe(1.0);
    expect(newLots[0].costPerKg).toBe(0);
    expect(newLots[0].source).toBe('BUY');
    // AuditLog
    expect(state.auditLogs.length).toBe(1);
    const audit = JSON.parse(state.auditLogs[0].details);
    expect(audit.billNumber).toBeDefined();
    expect(audit.externalBillNumber).toBe('BUY-ZERO-001');
  });

  test('8. Purchase negative price: rejected, zero records', async () => {
    const state = makeState();
    let caughtError: Error | null = null;
    try {
      await createBuyBillService(makeBuyDeps(state), {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'prod-1', weight: 1, pricePerKg: -1 }],
      }, AUTH);
    } catch (err) { caughtError = err as Error; }
    expect(caughtError!.message).toBe('ราคา/กก. ต้องไม่ติดลบ');
    expect(state.buyBills.size).toBe(0);
    expect(state.auditLogs.length).toBe(0);
  });
});

// ============ Fix 6: Result classification policy ============

describe('ST-8 closeout: result classification policy', () => {
  test('9. service rejection → FAILED (not INVALID)', async () => {
    const state = makeState();
    const deps = makeImportDeps(state);
    const result = await applyImport('sales', [makeSalesBill('SALE-Z', 0)], deps, ACTOR);
    // Policy: parsing/schema issues → INVALID; service/business-rule rejection → FAILED
    // Zero-price passes parsing (it's a valid number) but fails service validation → FAILED
    expect(result.failedCount).toBe(1);
    expect(result.invalidCount).toBe(0);
    expect(result.failedBills[0].status).toBe('FAILED');
    expect(result.failedBills[0].errorCode).toBe('BILL_CREATE_FAILED');
  });
});
