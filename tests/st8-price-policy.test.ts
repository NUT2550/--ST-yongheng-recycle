/**
 * ST-8: Purchase/Sales price policy + zero-price rejection tests.
 *
 * Purchase: pricePerKg >= 0 (zero allowed — matches pre-ST-8 behavior)
 * Sales: pricePerKg > 0 (zero rejected — matches pre-ST-8 behavior)
 *
 * Run: bun test tests/st8-price-policy.test.ts
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
import { isP2002OnField, isPrismaP2002 } from '../src/lib/bill-errors';
import type { AuthPayload } from '../src/lib/permissions';

const AUTH: AuthPayload = { userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin' };

// ============ Pure validation tests ============

describe('ST-8 price policy: pure validation', () => {
  test('1. Purchase price 0 accepted', () => {
    expect(validateBuyBillItemNumeric({ weight: 1, pricePerKg: 0 })).toBeNull();
  });

  test('2. Purchase negative price rejected', () => {
    expect(validateBuyBillItemNumeric({ weight: 1, pricePerKg: -1 })).toBe('ราคา/กก. ต้องไม่ติดลบ');
  });

  test('3. Sales price 0 rejected', () => {
    expect(validateSellBillItemNumeric({ weight: 1, pricePerKg: 0 })).toBe('ราคา/กก. ต้องมากกว่า 0');
  });

  test('4. Sales negative price rejected', () => {
    expect(validateSellBillItemNumeric({ weight: 1, pricePerKg: -1 })).toBe('ราคา/กก. ต้องมากกว่า 0');
  });

  test('5. Sales price 0.01 accepted', () => {
    expect(validateSellBillItemNumeric({ weight: 1, pricePerKg: 0.01 })).toBeNull();
  });

  test('6. Sales NaN rejected', () => {
    expect(validateSellBillItemNumeric({ weight: 1, pricePerKg: NaN })).not.toBeNull();
  });

  test('7. Sales Infinity rejected', () => {
    expect(validateSellBillItemNumeric({ weight: 1, pricePerKg: Infinity })).not.toBeNull();
  });
});

// ============ Service-level: zero-price Sales causes zero side effects ============

describe('ST-8 price policy: zero-price Sales service behavior', () => {
  test('8. zero-price Sales: checkStockAvailability called 0 times', async () => {
    let stockCheckCount = 0;
    const deps: SellBillServiceDeps = {
      checkStockAvailability: async () => { stockCheckCount++; return { ok: true as const }; },
      generateBillNumber: async () => 'SELL-TEST',
      transaction: async (fn) => fn({} as unknown as SellBillTx),
    };
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch {}
    expect(stockCheckCount).toBe(0); // validation rejects before stock check
  });

  test('9. zero-price Sales: FIFO query 0 times', async () => {
    let fifoCount = 0;
    const deps: SellBillServiceDeps = {
      checkStockAvailability: async () => { fifoCount++; return { ok: true as const }; },
      generateBillNumber: async () => 'SELL-TEST',
      transaction: async (fn) => fn({
        findSourceLots: async () => { fifoCount++; return []; },
        createSellBill: async () => ({}),
        updateStockLotRemaining: async () => ({}),
        createAuditLog: async () => ({}),
      } as unknown as SellBillTx),
    };
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch {}
    expect(fifoCount).toBe(0); // validation rejects before transaction
  });

  test('10. zero-price Sales: StockLot update 0 times', async () => {
    let updateCount = 0;
    const deps: SellBillServiceDeps = {
      checkStockAvailability: async () => ({ ok: true as const }),
      generateBillNumber: async () => 'SELL-TEST',
      transaction: async (fn) => fn({
        findSourceLots: async () => [],
        createSellBill: async () => ({}),
        updateStockLotRemaining: async () => { updateCount++; },
        createAuditLog: async () => ({}),
      } as unknown as SellBillTx),
    };
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch {}
    expect(updateCount).toBe(0);
  });

  test('11. zero-price Sales: SellBill create 0 times', async () => {
    let createCount = 0;
    const deps: SellBillServiceDeps = {
      checkStockAvailability: async () => ({ ok: true as const }),
      generateBillNumber: async () => 'SELL-TEST',
      transaction: async (fn) => fn({
        findSourceLots: async () => [],
        createSellBill: async () => { createCount++; return {}; },
        updateStockLotRemaining: async () => ({}),
        createAuditLog: async () => ({}),
      } as unknown as SellBillTx),
    };
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch {}
    expect(createCount).toBe(0);
  });

  test('12. zero-price Sales: AuditLog create 0 times', async () => {
    let auditCount = 0;
    const deps: SellBillServiceDeps = {
      checkStockAvailability: async () => ({ ok: true as const }),
      generateBillNumber: async () => 'SELL-TEST',
      transaction: async (fn) => fn({
        findSourceLots: async () => [],
        createSellBill: async () => ({}),
        updateStockLotRemaining: async () => ({}),
        createAuditLog: async () => { auditCount++; },
      } as unknown as SellBillTx),
    };
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch {}
    expect(auditCount).toBe(0);
  });

  test('13. zero-price Sales: persisted stock unchanged', async () => {
    const stockBalance = 10.0;
    let currentBalance = stockBalance;
    const deps: SellBillServiceDeps = {
      checkStockAvailability: async () => ({ ok: true as const }),
      generateBillNumber: async () => 'SELL-TEST',
      transaction: async (fn) => fn({
        findSourceLots: async () => [],
        createSellBill: async () => ({}),
        updateStockLotRemaining: async () => { currentBalance -= 1; },
        createAuditLog: async () => ({}),
      } as unknown as SellBillTx),
    };
    try {
      await createSellBillService(deps, {
        date: '2026-07-16', isCredit: false,
        items: [{ productId: 'p1', weight: 1, pricePerKg: 0 }],
      }, AUTH);
    } catch {}
    expect(currentBalance).toBe(stockBalance); // unchanged — validation rejected before transaction
  });
});

// ============ P2002 target robustness ============

describe('ST-8 P2002: target shape robustness', () => {
  test('17. P2002 meta.target string[] externalBillNumber', () => {
    const err = { code: 'P2002', meta: { target: ['externalBillNumber'] } };
    expect(isP2002OnField(err, 'externalBillNumber')).toBe(true);
  });

  test('18. P2002 meta.target string externalBillNumber', () => {
    const err = { code: 'P2002', meta: { target: 'externalBillNumber' } };
    expect(isP2002OnField(err, 'externalBillNumber')).toBe(true);
  });

  test('19. P2002 billNumber not misclassified as external duplicate', () => {
    const err = { code: 'P2002', meta: { target: ['billNumber'] } };
    expect(isP2002OnField(err, 'externalBillNumber')).toBe(false);
  });

  test('20. missing target not misclassified', () => {
    const err = { code: 'P2002' };
    expect(isP2002OnField(err, 'externalBillNumber')).toBe(false);
  });

  test('non-P2002 not misclassified', () => {
    const err = { code: 'P2001' };
    expect(isP2002OnField(err, 'externalBillNumber')).toBe(false);
  });
});
