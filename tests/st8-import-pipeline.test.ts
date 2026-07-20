/**
 * ST-8: Safe partial-success import pipeline tests.
 *
 * These tests exercise the SAME production functions used by:
 *   - src/lib/import-pipeline.ts (pure helpers + applyImport controller)
 *   - src/app/api/import/check-duplicates/route.ts
 *   - src/app/api/import/apply/route.ts
 *   - src/components/detailed-excel-import-dialog.tsx
 *   - src/components/detailed-sell-excel-import-dialog.tsx
 *
 * Tests use synthetic fixtures only — no Production data, no DB.
 *
 * The apply controller is exercised via injectable deps (mock repository
 * with real commit/rollback semantics) — same pattern as ST-10 / ST-35.
 *
 * Run: bun test tests/st8-import-pipeline.test.ts
 */
import { test, expect, describe, beforeEach } from 'bun:test';
import {
  normalizeBillNumber,
  isBlankBillNumber,
  classifyBillStatus,
  detectInFileDuplicates,
  buildImportSummary,
  categorizeBillsForPreview,
  countByCategory,
  shouldEnableApply,
  applyImport,
  type ParsedBill,
  type ParsedBillItem,
  type ImportApplyDeps,
  type ImportActor,
  type ImportSummary,
} from '../src/lib/import-pipeline';

// ============================================================================
// Fixtures
// ============================================================================

const ACTOR: ImportActor = {
  userId: 'user-1',
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
// Mock deps (same pattern as ST-10 / ST-35)
// ============================================================================

interface MockState {
  // Programmable inputs
  existingBillNumbers: Set<string>; // normalized numbers considered "existing" in DB
  insufficientStockProductIds: Set<string>; // productIds with insufficient stock
  failOnBillNumbers: Set<string>; // normalized bill numbers that should fail on create
  // Recorded calls
  loadExistingBillNumbersCalls: Array<{ type: 'purchase' | 'sales'; normalizedCandidates: string[] }>;
  checkStockAvailabilityCalls: Array<{ items: ParsedBillItem[] }>;
  createPurchaseBillCalls: Array<{ bill: ParsedBill; actor: ImportActor }>;
  createSalesBillCalls: Array<{ bill: ParsedBill; actor: ImportActor }>;
  // Simulated DB state (written bills)
  writtenPurchaseBills: Map<string, { id: string; billNumber: string }>;
  writtenSalesBills: Map<string, { id: string; billNumber: string }>;
  // Bill number sequence
  billSeq: number;
}

function makeMockDeps(): { deps: ImportApplyDeps; state: MockState; reset: () => void } {
  const state: MockState = {
    existingBillNumbers: new Set(),
    insufficientStockProductIds: new Set(),
    failOnBillNumbers: new Set(),
    loadExistingBillNumbersCalls: [],
    checkStockAvailabilityCalls: [],
    createPurchaseBillCalls: [],
    createSalesBillCalls: [],
    writtenPurchaseBills: new Map(),
    writtenSalesBills: new Map(),
    billSeq: 0,
  };

  const deps: ImportApplyDeps = {
    loadExistingBillNumbers: async (type, normalizedCandidates) => {
      state.loadExistingBillNumbersCalls.push({ type, normalizedCandidates });
      // Build the set of "existing" normalized numbers: programmable
      // existingBillNumbers + bills "written" via createPurchaseBill/
      // createSalesBill (simulates DB state). This models concurrent +
      // idempotent re-upload cases. applyImport calls this ONCE per
      // import request (not per bill) and checks membership in-memory.
      const result = new Set<string>();
      for (const n of state.existingBillNumbers) result.add(n);
      const written =
        type === 'purchase' ? state.writtenPurchaseBills : state.writtenSalesBills;
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
      if (state.failOnBillNumbers.has(norm)) {
        throw new Error(`Simulated purchase bill creation failure for ${norm}`);
      }
      state.billSeq++;
      const id = `buy-${state.billSeq}`;
      const billNumber = `BUY-2569-${String(state.billSeq).padStart(5, '0')}`;
      state.writtenPurchaseBills.set(norm, { id, billNumber });
      return { id, billNumber };
    },
    createSalesBill: async (bill, actor) => {
      state.createSalesBillCalls.push({ bill, actor });
      const norm = normalizeBillNumber(bill.externalBillNumber);
      if (state.failOnBillNumbers.has(norm)) {
        throw new Error(`Simulated sales bill creation failure for ${norm}`);
      }
      state.billSeq++;
      const id = `sell-${state.billSeq}`;
      const billNumber = `SELL-2569-${String(state.billSeq).padStart(5, '0')}`;
      state.writtenSalesBills.set(norm, { id, billNumber });
      return { id, billNumber };
    },
  };

  const reset = () => {
    state.existingBillNumbers.clear();
    state.insufficientStockProductIds.clear();
    state.failOnBillNumbers.clear();
    state.loadExistingBillNumbersCalls.length = 0;
    state.checkStockAvailabilityCalls.length = 0;
    state.createPurchaseBillCalls.length = 0;
    state.createSalesBillCalls.length = 0;
    state.writtenPurchaseBills.clear();
    state.writtenSalesBills.clear();
    state.billSeq = 0;
  };

  return { deps, state, reset };
}

const mock = makeMockDeps();

beforeEach(() => {
  mock.reset();
});

// ============================================================================
// 1-7: normalizeBillNumber
// ============================================================================

describe('ST-8: normalizeBillNumber', () => {
  test('1. trims leading/trailing whitespace', () => {
    expect(normalizeBillNumber('  A1051492  ')).toBe('A1051492');
    expect(normalizeBillNumber('\tA1051492\n')).toBe('A1051492');
    expect(normalizeBillNumber(' A1051492')).toBe('A1051492');
  });

  test('2. preserves leading zeroes', () => {
    expect(normalizeBillNumber('A0001234')).toBe('A0001234');
    expect(normalizeBillNumber('0123')).toBe('0123');
    expect(normalizeBillNumber('A1051492')).toBe('A1051492');
    // Make sure we don't accidentally strip leading zeros
    expect(normalizeBillNumber('A0001234')).not.toBe('A1234');
  });

  test('3. multi-line grouping — newlines collapse to single space', () => {
    // Two bill numbers separated by newline → normalized as if a single string with space
    // (this models the case where Excel cell contains embedded line break)
    expect(normalizeBillNumber('A1051492\nA1051493')).toBe('A1051492 A1051493');
    expect(normalizeBillNumber('A1051492\r\nA1051493')).toBe('A1051492 A1051493');
    expect(normalizeBillNumber('A1051492\t\tA1051493')).toBe('A1051492 A1051493');
    // Multiple spaces collapse
    expect(normalizeBillNumber('A1051492   A1051493')).toBe('A1051492 A1051493');
  });

  test('4. blank input returns empty string (invalid)', () => {
    expect(normalizeBillNumber('')).toBe('');
    expect(normalizeBillNumber('   ')).toBe('');
    expect(normalizeBillNumber('\t\n')).toBe('');
    expect(normalizeBillNumber(null)).toBe('');
    expect(normalizeBillNumber(undefined)).toBe('');
    expect(normalizeBillNumber(123)).toBe('');
    expect(normalizeBillNumber({})).toBe('');
  });

  test('5. handles Thai characters (preserves)', () => {
    // Bill numbers in production are Latin-letter-prefixed, but we should
    // preserve any Thai characters that might appear (e.g. in note-like fields)
    expect(normalizeBillNumber('บิล-A1051492')).toBe('บิล-A1051492');
    expect(normalizeBillNumber(' อลูมิเนียม ')).toBe('อลูมิเนียม');
    // NFC normalization: precomposed and combining forms should canonicalize
    // สินค้า: แดง + combining tone mark vs precomposed
    const precomposed = 'ปอกเงา';
    const decomposed = 'ปอกเงา'.normalize('NFD');
    expect(normalizeBillNumber(precomposed)).toBe(normalizeBillNumber(decomposed));
  });

  test('6. deterministic — same input always produces same output', () => {
    const inputs = ['A1051492', '  A1051492  ', 'A0001234', 'บิล-1', 'A1051492 A1051493'];
    for (const input of inputs) {
      const a = normalizeBillNumber(input);
      const b = normalizeBillNumber(input);
      const c = normalizeBillNumber(input);
      expect(a).toBe(b);
      expect(b).toBe(c);
    }
    // Deterministic across multiple invocations
    const input = '  A1051492\nบิล-A  ';
    const first = normalizeBillNumber(input);
    for (let i = 0; i < 10; i++) {
      expect(normalizeBillNumber(input)).toBe(first);
    }
  });

  test('7. case-sensitive — A1051492 ≠ a1051492 (per existing data)', () => {
    expect(normalizeBillNumber('A1051492')).toBe('A1051492');
    expect(normalizeBillNumber('a1051492')).toBe('a1051492');
    expect(normalizeBillNumber('A1051492')).not.toBe(normalizeBillNumber('a1051492'));
    expect(normalizeBillNumber('D1025582')).not.toBe(normalizeBillNumber('d1025582'));
  });

  test('7b. preserves special characters (/ - . etc.)', () => {
    expect(normalizeBillNumber('A-1051492')).toBe('A-1051492');
    expect(normalizeBillNumber('A/1051492')).toBe('A/1051492');
    expect(normalizeBillNumber('A10.51492')).toBe('A10.51492');
    expect(normalizeBillNumber('INV-2026-001')).toBe('INV-2026-001');
  });

  test('7c. isBlankBillNumber helper', () => {
    expect(isBlankBillNumber('')).toBe(true);
    expect(isBlankBillNumber('  ')).toBe(true);
    expect(isBlankBillNumber(null)).toBe(true);
    expect(isBlankBillNumber('A1051492')).toBe(false);
    expect(isBlankBillNumber('  A1051492  ')).toBe(false);
  });
});

// ============================================================================
// 8-15: Duplicate detection
// ============================================================================

describe('ST-8: Duplicate detection', () => {
  test('8. existing duplicate detected via loadExistingBillNumbers', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    const bills = [makeBill({ externalBillNumber: 'A1051492' })];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('9. in-file duplicate detected — later occurrence flagged', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051492' }), // same number → in-file dup
      makeBill({ externalBillNumber: 'A1051493' }),
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.duplicateInFileCount).toBe(1);
    expect(summary.importedCount).toBe(2); // first A1051492 + A1051493
    expect(mock.state.createPurchaseBillCalls).toHaveLength(2);
  });

  test('10. first-occurrence policy — first NOT flagged, subsequent ARE', () => {
    const bills = [
      makeBill({ externalBillNumber: 'D1025582' }),
      makeBill({ externalBillNumber: 'D1025582' }),
      makeBill({ externalBillNumber: 'D1025582' }),
    ];
    const result = detectInFileDuplicates(bills);
    expect(result.duplicateFlags).toEqual([false, true, true]);
    expect(result.duplicateNumbers).toEqual(['D1025582']);
  });

  test('11. batch lookup — multiple bills, only some exist', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    mock.state.existingBillNumbers.add('A1051494');
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }), // exists
      makeBill({ externalBillNumber: 'A1051493' }), // ready
      makeBill({ externalBillNumber: 'A1051494' }), // exists
      makeBill({ externalBillNumber: 'A1051495' }), // ready
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(2);
    expect(summary.importedCount).toBe(2);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(2);
    // Verify the right bills were created
    const createdNumbers = mock.state.createPurchaseBillCalls.map(
      (c) => c.bill.externalBillNumber
    );
    expect(createdNumbers).toEqual(['A1051493', 'A1051495']);
  });

  test('12. preview=apply normalization — same normalize function used', async () => {
    // Bill number with leading/trailing whitespace and tab in middle
    const bills = [makeBill({ externalBillNumber: '  A1051492\t' })];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    // Verify the normalized number was passed in the loadExistingBillNumbers call
    expect(mock.state.loadExistingBillNumbersCalls[0].normalizedCandidates).toContain('A1051492');
    // Verify the createPurchaseBill recorded the normalized number
    expect(mock.state.createPurchaseBillCalls[0].bill.externalBillNumber).toBe(
      '  A1051492\t'
    );
    // The writtenPurchaseBills map uses the normalized key
    expect(mock.state.writtenPurchaseBills.has('A1051492')).toBe(true);
  });

  test('13. concurrent duplicate — bill appears between preview and apply', async () => {
    // Simulate: at preview time, bill didn't exist. At apply time, it does.
    // We model this by adding to existingBillNumbers BEFORE applyImport runs.
    const bills = [makeBill({ externalBillNumber: 'A1051492' })];
    mock.state.existingBillNumbers.add('A1051492'); // appears between preview and apply
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('14. in-file duplicate not double-counted — 3 same → 2 dups', () => {
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051493' }), // different
    ];
    const result = detectInFileDuplicates(bills);
    expect(result.duplicateFlags).toEqual([false, true, true, false]);
    expect(result.duplicateNumbers).toEqual(['A1051492']);
  });

  test('15. blank bill numbers NOT considered duplicates of each other', () => {
    const bills = [
      makeBill({ externalBillNumber: '' }),
      makeBill({ externalBillNumber: '   ' }),
      makeBill({ externalBillNumber: 'A1051492' }),
    ];
    const result = detectInFileDuplicates(bills);
    // None of the blank ones should be flagged
    expect(result.duplicateFlags).toEqual([false, false, false]);
    expect(result.duplicateNumbers).toEqual([]);
  });

  test('15b. applyImport classifies blank-number bills as INVALID', async () => {
    const bills = [makeBill({ externalBillNumber: '' })];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(summary.importedCount).toBe(0);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('15c. classifyBillStatus for INVALID', () => {
    expect(classifyBillStatus(makeBill({ externalBillNumber: '' }))).toBe('INVALID');
    expect(classifyBillStatus(makeBill({ externalBillNumber: '   ' }))).toBe('INVALID');
    expect(classifyBillStatus(makeBill({ items: [] }))).toBe('INVALID');
    expect(
      classifyBillStatus(makeBill({ items: [makeItem({ weight: 0 })] }))
    ).toBe('INVALID');
    expect(
      classifyBillStatus(makeBill({ items: [makeItem({ weight: -5 })] }))
    ).toBe('INVALID');
  });

  test('15d. classifyBillStatus for UNMATCHED_PRODUCT', () => {
    expect(
      classifyBillStatus(
        makeBill({ items: [makeItem({ matched: false, productId: '' })] })
      )
    ).toBe('UNMATCHED_PRODUCT');
    // Mixed matched + unmatched still = UNMATCHED_PRODUCT
    expect(
      classifyBillStatus(
        makeBill({
          items: [makeItem({ matched: true }), makeItem({ matched: false, productId: '' })],
        })
      )
    ).toBe('UNMATCHED_PRODUCT');
  });

  test('15e. classifyBillStatus for READY', () => {
    expect(classifyBillStatus(makeBill())).toBe('READY');
    expect(
      classifyBillStatus(
        makeBill({
          items: [makeItem({ matched: true }), makeItem({ matched: true, productId: 'prod-2' })],
        })
      )
    ).toBe('READY');
  });
});

// ============================================================================
// 16-22: Purchase apply
// ============================================================================

describe('ST-8: Purchase apply', () => {
  test('16. mixed batch — ready + duplicate + invalid + unmatched', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }), // existing dup
      makeBill({ externalBillNumber: 'A1051493' }), // ready
      makeBill({ externalBillNumber: 'A1051494' }), // ready
      makeBill({ externalBillNumber: '' }), // invalid
      makeBill({
        externalBillNumber: 'A1051495',
        items: [makeItem({ matched: false, productId: '' })],
      }), // unmatched
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(2);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(2);
  });

  test('17. duplicate → zero writes (createPurchaseBill not called)', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    const bills = [makeBill({ externalBillNumber: 'A1051492' })];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
    // Verify no orphaned records in simulated DB
    expect(mock.state.writtenPurchaseBills.size).toBe(0);
  });

  test('18. valid bill → creates BuyBill record', async () => {
    const bills = [
      makeBill({
        externalBillNumber: 'A1051492',
        items: [
          makeItem({ productId: 'prod-1', productName: 'ทองแดง' }),
          makeItem({ productId: 'prod-2', productName: 'ทองเหลือง' }),
        ],
      }),
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(1);
    expect(mock.state.createPurchaseBillCalls[0].bill.externalBillNumber).toBe('A1051492');
    expect(mock.state.createPurchaseBillCalls[0].bill.items).toHaveLength(2);
    expect(mock.state.createPurchaseBillCalls[0].actor.userId).toBe('user-1');
    // Verify the returned billNumber/id is in the summary
    expect(summary.importedBills[0].billNumber).toMatch(/^BUY-2569-\d{5}$/);
    expect(summary.importedBills[0].billId).toMatch(/^buy-\d+$/);
  });

  test('19. failed bill → no orphan, others succeed', async () => {
    mock.state.failOnBillNumbers.add('A1051493');
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }), // ready → success
      makeBill({ externalBillNumber: 'A1051493' }), // ready but will fail
      makeBill({ externalBillNumber: 'A1051494' }), // ready → success
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.failedBills[0].externalBillNumber).toBe('A1051493');
    expect(summary.failedBills[0].errorCode).toBe('BILL_CREATE_FAILED');
    expect(mock.state.createPurchaseBillCalls).toHaveLength(3);
    // The failed bill must NOT be in the simulated DB
    expect(mock.state.writtenPurchaseBills.has('A1051493')).toBe(false);
    expect(mock.state.writtenPurchaseBills.has('A1051492')).toBe(true);
    expect(mock.state.writtenPurchaseBills.has('A1051494')).toBe(true);
  });

  test('20. idempotent re-upload — all return DUPLICATE_EXISTING', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051493' }),
    ];
    // First upload — both should succeed
    const first = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(first.importedCount).toBe(2);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(2);

    // Reset call counters (but keep written bills in state)
    mock.state.createPurchaseBillCalls.length = 0;
    mock.state.loadExistingBillNumbersCalls.length = 0;

    // Second upload — both should now be DUPLICATE_EXISTING (because they're in writtenPurchaseBills)
    const second = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(second.importedCount).toBe(0);
    expect(second.duplicateExistingCount).toBe(2);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('21. invalid bill (no items) → status INVALID, no create call', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'A1051492', items: [] }),
      makeBill({ externalBillNumber: 'A1051493' }), // valid
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.invalidCount).toBe(1);
    expect(summary.importedCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(1);
    expect(mock.state.createPurchaseBillCalls[0].bill.externalBillNumber).toBe('A1051493');
  });

  test('22. unmatched product → status UNMATCHED_PRODUCT, no create call', async () => {
    const bills = [
      makeBill({
        externalBillNumber: 'A1051492',
        items: [makeItem({ matched: false, productId: '' })],
      }),
      makeBill({ externalBillNumber: 'A1051493' }), // valid
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.importedCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(1);
    expect(mock.state.createPurchaseBillCalls[0].bill.externalBillNumber).toBe('A1051493');
  });

  test('22b. in-file duplicate → first created, later skipped', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051492' }),
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    expect(summary.duplicateInFileCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(1);
  });
});

// ============================================================================
// 23-30: Sales apply
// ============================================================================

describe('ST-8: Sales apply', () => {
  test('23. mixed batch — ready + duplicate + insufficient + invalid + unmatched', async () => {
    mock.state.existingBillNumbers.add('S1051492');
    mock.state.insufficientStockProductIds.add('prod-low-stock');
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }), // existing dup
      makeBill({ externalBillNumber: 'S1051493' }), // ready
      makeBill({
        externalBillNumber: 'S1051494',
        items: [makeItem({ productId: 'prod-low-stock' })],
      }), // insufficient stock
      makeBill({ externalBillNumber: '' }), // invalid
      makeBill({
        externalBillNumber: 'S1051495',
        items: [makeItem({ matched: false, productId: '' })],
      }), // unmatched
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.insufficientStockCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(mock.state.createSalesBillCalls).toHaveLength(1);
  });

  test('24. duplicate → zero deduction (createSalesBill not called)', async () => {
    mock.state.existingBillNumbers.add('S1051492');
    const bills = [makeBill({ externalBillNumber: 'S1051492' })];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(mock.state.createSalesBillCalls).toHaveLength(0);
    expect(mock.state.writtenSalesBills.size).toBe(0);
    // checkStockAvailability should also NOT be called (duplicate short-circuits)
    expect(mock.state.checkStockAvailabilityCalls).toHaveLength(0);
  });

  test('25. insufficient-stock skip → status INSUFFICIENT_STOCK, no create call', async () => {
    mock.state.insufficientStockProductIds.add('prod-low');
    const bills = [
      makeBill({
        externalBillNumber: 'S1051492',
        items: [makeItem({ productId: 'prod-low', productName: 'ทองแดงต่ำ' })],
      }),
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.insufficientStockCount).toBe(1);
    expect(mock.state.createSalesBillCalls).toHaveLength(0);
    expect(mock.state.checkStockAvailabilityCalls).toHaveLength(1);
    expect(summary.failedBills[0].error).toContain('สต็อกไม่เพียงพอ');
    expect(summary.failedBills[0].error).toContain('ทองแดงต่ำ');
  });

  test('26. valid FIFO once → createSalesBill called, returns success', async () => {
    const bills = [
      makeBill({
        externalBillNumber: 'S1051492',
        items: [
          makeItem({ productId: 'prod-1', weight: 50, productName: 'ทองแดงช็อต' }),
          makeItem({ productId: 'prod-2', weight: 30, productName: 'ทองเหลือง' }),
        ],
      }),
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    expect(mock.state.createSalesBillCalls).toHaveLength(1);
    expect(mock.state.checkStockAvailabilityCalls).toHaveLength(1);
    expect(summary.importedBills[0].billNumber).toMatch(/^SELL-2569-\d{5}$/);
  });

  test('27. no negative stock — FIFO deduction respects available', async () => {
    // If checkStockAvailability returns ok, the createSalesBill is called.
    // The mock simulates a successful FIFO deduction (since we don't have real DB).
    // The point: the apply controller does NOT bypass the stock check.
    mock.state.insufficientStockProductIds.add('prod-low');
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }), // ready
      makeBill({
        externalBillNumber: 'S1051493',
        items: [makeItem({ productId: 'prod-low' })],
      }), // insufficient
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    expect(summary.insufficientStockCount).toBe(1);
    // Only the ready bill was created — the insufficient one was skipped
    expect(mock.state.createSalesBillCalls).toHaveLength(1);
    expect(mock.state.createSalesBillCalls[0].bill.externalBillNumber).toBe('S1051492');
  });

  test('28. failure rollback — createSalesBill throws → status FAILED, others continue', async () => {
    mock.state.failOnBillNumbers.add('S1051493');
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }), // success
      makeBill({ externalBillNumber: 'S1051493' }), // will fail
      makeBill({ externalBillNumber: 'S1051494' }), // success
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.failedBills[0].externalBillNumber).toBe('S1051493');
    expect(mock.state.createSalesBillCalls).toHaveLength(3);
    expect(mock.state.writtenSalesBills.has('S1051493')).toBe(false);
    expect(mock.state.writtenSalesBills.has('S1051492')).toBe(true);
    expect(mock.state.writtenSalesBills.has('S1051494')).toBe(true);
  });

  test('29. idempotent re-upload — sales', async () => {
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }),
      makeBill({ externalBillNumber: 'S1051493' }),
    ];
    const first = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(first.importedCount).toBe(2);

    mock.state.createSalesBillCalls.length = 0;
    mock.state.loadExistingBillNumbersCalls.length = 0;
    mock.state.checkStockAvailabilityCalls.length = 0;

    const second = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(second.importedCount).toBe(0);
    expect(second.duplicateExistingCount).toBe(2);
    expect(mock.state.createSalesBillCalls).toHaveLength(0);
    // checkStockAvailability also not called (duplicate short-circuits before stock check)
    expect(mock.state.checkStockAvailabilityCalls).toHaveLength(0);
  });

  test('30. sales: all categories represented in one batch', async () => {
    mock.state.existingBillNumbers.add('S1051492');
    mock.state.insufficientStockProductIds.add('prod-low');
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }), // existing dup
      makeBill({ externalBillNumber: 'S1051493' }), // ready
      makeBill({
        externalBillNumber: 'S1051493', // in-file dup (later occurrence)
      }),
      makeBill({ externalBillNumber: '' }), // invalid
      makeBill({
        externalBillNumber: 'S1051495',
        items: [makeItem({ matched: false, productId: '' })],
      }), // unmatched
      makeBill({
        externalBillNumber: 'S1051496',
        items: [makeItem({ productId: 'prod-low' })],
      }), // insufficient stock
      makeBill({ externalBillNumber: 'S1051497' }), // ready
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(2);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.duplicateInFileCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.insufficientStockCount).toBe(1);
    expect(summary.failedCount).toBe(0);
    expect(mock.state.createSalesBillCalls).toHaveLength(2);
  });

  test('30b. sales stock check only fires for non-duplicate, non-invalid bills', async () => {
    mock.state.existingBillNumbers.add('S1051492');
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }), // existing dup — no stock check
      makeBill({ externalBillNumber: '' }), // invalid — no stock check
      makeBill({
        externalBillNumber: 'S1051493',
        items: [makeItem({ matched: false, productId: '' })],
      }), // unmatched — no stock check
      makeBill({ externalBillNumber: 'S1051494' }), // ready — stock check fires
    ];
    await applyImport('sales', bills, mock.deps, ACTOR);
    expect(mock.state.checkStockAvailabilityCalls).toHaveLength(1);
  });
});

// ============================================================================
// 31-38: UI behavior (pure functions used by the dialogs)
// ============================================================================

describe('ST-8: UI behavior (pure helpers)', () => {
  test('31. preview categories — all 6 represented', () => {
    const existing = new Set<string>(['A1051492']);
    const insufficient = new Set<string>(['A1051496']);
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }), // existing dup
      makeBill({ externalBillNumber: 'A1051493' }), // ready
      makeBill({ externalBillNumber: 'A1051493' }), // in-file dup
      makeBill({ externalBillNumber: '' }), // invalid
      makeBill({
        externalBillNumber: 'A1051495',
        items: [makeItem({ matched: false, productId: '' })],
      }), // unmatched
      makeBill({ externalBillNumber: 'A1051496' }), // insufficient stock (preview)
    ];
    const rows = categorizeBillsForPreview(bills, existing, insufficient);
    const categories = rows.map((r) => r.category);
    expect(categories).toContain('duplicate-existing');
    expect(categories).toContain('ready');
    expect(categories).toContain('duplicate-in-file');
    expect(categories).toContain('invalid');
    expect(categories).toContain('unmatched');
    expect(categories).toContain('insufficient-stock');
  });

  test('32. duplicate visibility — duplicateBillNumbers derived from preview', () => {
    const existing = new Set<string>(['A1051492']);
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051493' }),
      makeBill({ externalBillNumber: 'A1051493' }),
    ];
    const rows = categorizeBillsForPreview(bills, existing);
    const dupNumbers = rows
      .filter(
        (r) =>
          r.category === 'duplicate-existing' || r.category === 'duplicate-in-file'
      )
      .map((r) => ({ number: r.externalBillNumber, category: r.category }));
    expect(dupNumbers).toHaveLength(2);
    expect(dupNumbers.find((d) => d.category === 'duplicate-existing')?.number).toBe('A1051492');
    expect(dupNumbers.find((d) => d.category === 'duplicate-in-file')?.number).toBe('A1051493');
  });

  test('33. apply READY only — only ready bills sent to create endpoint', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }), // dup-existing
      makeBill({ externalBillNumber: 'A1051493' }), // ready
      makeBill({ externalBillNumber: 'A1051493' }), // in-file dup
      makeBill({ externalBillNumber: '' }), // invalid
      makeBill({
        externalBillNumber: 'A1051495',
        items: [makeItem({ matched: false, productId: '' })],
      }), // unmatched
    ];
    // Use the same categorize function the dialog uses to pick READY bills
    const rows = categorizeBillsForPreview(bills, new Set(mock.state.existingBillNumbers));
    const readyIndices = new Set(
      rows.filter((r) => r.category === 'ready').map((r) => r.index)
    );
    const billsToApply = bills
      .map((b, idx) => ({ b, idx }))
      .filter(({ idx }) => readyIndices.has(idx))
      .map(({ b }) => b);
    expect(billsToApply).toHaveLength(1);
    expect(billsToApply[0].externalBillNumber).toBe('A1051493');
    // Now apply only those — verify the duplicate is NOT re-sent
    const summary = await applyImport('purchase', billsToApply, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(1);
  });

  test('34. skipped not fatal — readyCount > 0 → canImport true even with duplicates', () => {
    // 3 ready + 2 dup → apply still enabled
    expect(shouldEnableApply(3, false, false)).toBe(true);
    // 0 ready + 5 dup → apply disabled (nothing to do)
    expect(shouldEnableApply(0, false, false)).toBe(false);
    // 1 ready + 100 dup → apply enabled
    expect(shouldEnableApply(1, false, false)).toBe(true);
  });

  test('35. result matches — applyResult structurally matches summary', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051493' }),
      makeBill({ externalBillNumber: 'A1051494' }),
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    // Structural checks
    expect(typeof summary.importedCount).toBe('number');
    expect(typeof summary.duplicateExistingCount).toBe('number');
    expect(typeof summary.duplicateInFileCount).toBe('number');
    expect(typeof summary.invalidCount).toBe('number');
    expect(typeof summary.unmatchedCount).toBe('number');
    expect(typeof summary.insufficientStockCount).toBe('number');
    expect(typeof summary.failedCount).toBe('number');
    expect(Array.isArray(summary.importedBills)).toBe(true);
    expect(Array.isArray(summary.skippedDuplicateBills)).toBe(true);
    expect(Array.isArray(summary.failedBills)).toBe(true);
    // Counts must agree with array lengths
    expect(summary.importedBills.length).toBe(summary.importedCount);
    expect(summary.skippedDuplicateBills.length).toBe(
      summary.duplicateExistingCount + summary.duplicateInFileCount
    );
    expect(summary.failedBills.length).toBe(
      summary.invalidCount +
        summary.unmatchedCount +
        summary.insufficientStockCount +
        summary.failedCount
    );
    // Specific values
    expect(summary.importedCount).toBe(2);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.importedBills[0].billNumber).toMatch(/^BUY-2569-\d{5}$/);
  });

  test('36. empty READY disables Apply — shouldEnableApply(0, false, false) === false', () => {
    expect(shouldEnableApply(0, false, false)).toBe(false);
    // Even with 0 ready and not importing, still disabled
    expect(shouldEnableApply(0, false, false)).toBe(false);
  });

  test('37. double-submit blocked — shouldEnableApply(1, true, false) === false', () => {
    // importing = true → disabled
    expect(shouldEnableApply(1, true, false)).toBe(false);
    // loading = true → disabled
    expect(shouldEnableApply(1, false, true)).toBe(false);
    // both true → disabled
    expect(shouldEnableApply(1, true, true)).toBe(false);
    // readyCount=0 + importing → disabled (no work to do)
    expect(shouldEnableApply(0, true, false)).toBe(false);
  });

  test('38. re-preview safe — re-categorizing after apply still works', async () => {
    // First upload: 1 bill, gets imported
    const bills = [makeBill({ externalBillNumber: 'A1051492' })];
    const first = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(first.importedCount).toBe(1);

    // Re-preview the same bills: now the apply controller will see the bill
    // as DUPLICATE_EXISTING (because writtenPurchaseBills has it).
    // Simulate the dialog's re-check: categorizeBillsForPreview with the
    // updated existingDuplicates set.
    const updatedExisting = new Set(mock.state.writtenPurchaseBills.keys());
    const rows = categorizeBillsForPreview(bills, updatedExisting);
    expect(rows[0].category).toBe('duplicate-existing');

    // Re-applying the same batch: now 0 imported, 1 dup-existing
    const second = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(second.importedCount).toBe(0);
    expect(second.duplicateExistingCount).toBe(1);
  });

  test('38b. countByCategory — all zero for empty input', () => {
    const rows = categorizeBillsForPreview([], new Set());
    const counts = countByCategory(rows);
    expect(counts.ready).toBe(0);
    expect(counts['duplicate-existing']).toBe(0);
    expect(counts['duplicate-in-file']).toBe(0);
    expect(counts.invalid).toBe(0);
    expect(counts.unmatched).toBe(0);
    expect(counts['insufficient-stock']).toBe(0);
  });

  test('38c. countByCategory — counts match categorization', () => {
    const existing = new Set<string>(['A1051492']);
    const insufficient = new Set<string>(['A1051496']);
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051493' }),
      makeBill({ externalBillNumber: 'A1051493' }),
      makeBill({ externalBillNumber: '' }),
      makeBill({
        externalBillNumber: 'A1051495',
        items: [makeItem({ matched: false, productId: '' })],
      }),
      makeBill({ externalBillNumber: 'A1051496' }),
    ];
    const rows = categorizeBillsForPreview(bills, existing, insufficient);
    const counts = countByCategory(rows);
    expect(counts.ready).toBe(1);
    expect(counts['duplicate-existing']).toBe(1);
    expect(counts['duplicate-in-file']).toBe(1);
    expect(counts.invalid).toBe(1);
    expect(counts.unmatched).toBe(1);
    expect(counts['insufficient-stock']).toBe(1);
  });
});

// ============================================================================
// buildImportSummary — direct unit tests
// ============================================================================

describe('ST-8: buildImportSummary (pure aggregation)', () => {
  test('aggregates counts correctly across all 7 statuses', () => {
    const results = [
      { externalBillNumber: 'A1', normalizedBillNumber: 'A1', status: 'READY' as const, billNumber: 'BUY-1', billId: 'id-1' },
      { externalBillNumber: 'A2', normalizedBillNumber: 'A2', status: 'READY' as const, billNumber: 'BUY-2', billId: 'id-2' },
      { externalBillNumber: 'A3', normalizedBillNumber: 'A3', status: 'DUPLICATE_EXISTING' as const },
      { externalBillNumber: 'A4', normalizedBillNumber: 'A4', status: 'DUPLICATE_IN_FILE' as const },
      { externalBillNumber: '', normalizedBillNumber: '', status: 'INVALID' as const, error: 'no bill number' },
      { externalBillNumber: 'A5', normalizedBillNumber: 'A5', status: 'UNMATCHED_PRODUCT' as const, error: 'unmatched' },
      { externalBillNumber: 'A6', normalizedBillNumber: 'A6', status: 'INSUFFICIENT_STOCK' as const, error: 'low stock' },
      { externalBillNumber: 'A7', normalizedBillNumber: 'A7', status: 'FAILED' as const, error: 'boom' },
    ];
    const summary = buildImportSummary(results);
    expect(summary.importedCount).toBe(2);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.duplicateInFileCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.insufficientStockCount).toBe(1);
    expect(summary.failedCount).toBe(1);
    expect(summary.importedBills).toHaveLength(2);
    expect(summary.skippedDuplicateBills).toHaveLength(2);
    expect(summary.failedBills).toHaveLength(4); // invalid + unmatched + insufficient + failed
  });

  test('empty input → all zeros + empty arrays', () => {
    const summary = buildImportSummary([]);
    expect(summary.importedCount).toBe(0);
    expect(summary.duplicateExistingCount).toBe(0);
    expect(summary.duplicateInFileCount).toBe(0);
    expect(summary.invalidCount).toBe(0);
    expect(summary.unmatchedCount).toBe(0);
    expect(summary.insufficientStockCount).toBe(0);
    expect(summary.failedCount).toBe(0);
    expect(summary.importedBills).toEqual([]);
    expect(summary.skippedDuplicateBills).toEqual([]);
    expect(summary.failedBills).toEqual([]);
  });

  test('only READY bills → all in importedBills, others empty', () => {
    const results = [
      { externalBillNumber: 'A1', normalizedBillNumber: 'A1', status: 'READY' as const },
      { externalBillNumber: 'A2', normalizedBillNumber: 'A2', status: 'READY' as const },
    ];
    const summary = buildImportSummary(results);
    expect(summary.importedCount).toBe(2);
    expect(summary.skippedDuplicateBills).toEqual([]);
    expect(summary.failedBills).toEqual([]);
  });

  test('only DUPLICATE_EXISTING bills → all in skippedDuplicateBills', () => {
    const results = [
      { externalBillNumber: 'A1', normalizedBillNumber: 'A1', status: 'DUPLICATE_EXISTING' as const },
      { externalBillNumber: 'A2', normalizedBillNumber: 'A2', status: 'DUPLICATE_IN_FILE' as const },
    ];
    const summary = buildImportSummary(results);
    expect(summary.skippedDuplicateBills).toHaveLength(2);
    expect(summary.duplicateExistingCount).toBe(1);
    expect(summary.duplicateInFileCount).toBe(1);
  });
});

// ============================================================================
// Integration: full applyImport flow with realistic scenarios
// ============================================================================

describe('ST-8: Integration scenarios', () => {
  test('A. Large mixed batch — 10 bills, 4 statuses, partial success', async () => {
    mock.state.existingBillNumbers.add('B1000002');
    mock.state.existingBillNumbers.add('B1000005');
    mock.state.failOnBillNumbers.add('B1000007');
    mock.state.insufficientStockProductIds.add('prod-low');
    const bills: ParsedBill[] = [];
    for (let i = 1; i <= 10; i++) {
      const items: ParsedBillItem[] =
        i === 8
          ? [makeItem({ productId: 'prod-low' })]
          : i === 9
          ? [makeItem({ matched: false, productId: '' })]
          : i === 10
          ? []
          : [makeItem({ productId: `prod-${i}` })];
      bills.push(
        makeBill({
          externalBillNumber: `B1000${String(i).padStart(3, '0')}`,
          items,
        })
      );
    }
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    // B1000001 — ready (imported)
    // B1000002 — existing dup
    // B1000003 — ready (imported)
    // B1000004 — ready (imported)
    // B1000005 — existing dup
    // B1000006 — ready (imported)
    // B1000007 — failed (failOnBillNumbers)
    // B1000008 — insufficient stock (prod-low)
    // B1000009 — unmatched
    // B1000010 — invalid (no items)
    expect(summary.importedCount).toBe(4);
    expect(summary.duplicateExistingCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.insufficientStockCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
  });

  test('B. All duplicates — zero writes, zero failures', async () => {
    mock.state.existingBillNumbers.add('A1');
    mock.state.existingBillNumbers.add('A2');
    mock.state.existingBillNumbers.add('A3');
    const bills = [
      makeBill({ externalBillNumber: 'A1' }),
      makeBill({ externalBillNumber: 'A2' }),
      makeBill({ externalBillNumber: 'A3' }),
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(0);
    expect(summary.duplicateExistingCount).toBe(3);
    expect(summary.failedCount).toBe(0);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
  });

  test('C. loadExistingBillNumbers throws → all READY bills FAILED, others keep classification', async () => {
    // ST-8 rev 2: loadExistingBillNumbers is called ONCE per import request.
    // If it throws, the apply controller conservatively marks every READY
    // bill as FAILED (no DB writes) — preserving the "never create a
    // duplicate" invariant. INVALID / UNMATCHED / in-file-dup bills keep
    // their original classification (they don't need the existing-set).
    const originalLoad = mock.deps.loadExistingBillNumbers;
    mock.deps.loadExistingBillNumbers = async () => {
      throw new Error('DB connection failed');
    };
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }), // READY → FAILED
      makeBill({ externalBillNumber: 'A1051493' }), // READY → FAILED
      makeBill({ externalBillNumber: '' }),         // INVALID (no bill number)
      makeBill({
        externalBillNumber: 'A1051494',
        items: [makeItem({ matched: false, productId: '' })],
      }), // UNMATCHED
      makeBill({ externalBillNumber: 'A1051495' }), // first occurrence
      makeBill({ externalBillNumber: 'A1051495' }), // in-file dup (later)
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(0);
    // 3 READY bills (A1051492, A1051493, A1051495 first occurrence) → all FAILED
    expect(summary.failedCount).toBe(3);
    expect(summary.invalidCount).toBe(1);
    expect(summary.unmatchedCount).toBe(1);
    expect(summary.duplicateInFileCount).toBe(1);
    expect(mock.state.createPurchaseBillCalls).toHaveLength(0);
    // Restore for subsequent tests
    mock.deps.loadExistingBillNumbers = originalLoad;
  });

  test('D. checkStockAvailability throws → bill FAILED, others continue', async () => {
    const originalCheck = mock.deps.checkStockAvailability!;
    mock.deps.checkStockAvailability = async (items) => {
      if (items.some((i) => i.productId === 'prod-throw')) {
        throw new Error('Stock query failed');
      }
      return originalCheck(items);
    };
    const bills = [
      makeBill({ externalBillNumber: 'S1051492' }),
      makeBill({
        externalBillNumber: 'S1051493',
        items: [makeItem({ productId: 'prod-throw' })],
      }),
      makeBill({ externalBillNumber: 'S1051494' }),
    ];
    const summary = await applyImport('sales', bills, mock.deps, ACTOR);
    expect(summary.importedCount).toBe(2);
    expect(summary.failedCount).toBe(1);
    expect(summary.failedBills[0].externalBillNumber).toBe('S1051493');
    expect(summary.failedBills[0].error).toBe('Stock availability check failed');
    mock.deps.checkStockAvailability = originalCheck;
  });

  test('E. Summary is JSON-serializable (safe for API response)', async () => {
    mock.state.existingBillNumbers.add('A1051492');
    const bills = [
      makeBill({ externalBillNumber: 'A1051492' }),
      makeBill({ externalBillNumber: 'A1051493' }),
    ];
    const summary = await applyImport('purchase', bills, mock.deps, ACTOR);
    // Must be JSON-serializable (no Date objects, no functions, no undefined)
    const json = JSON.stringify(summary);
    const parsed = JSON.parse(json);
    expect(parsed.importedCount).toBe(1);
    expect(parsed.duplicateExistingCount).toBe(1);
    expect(parsed.importedBills[0].billNumber).toMatch(/^BUY-2569-\d{5}$/);
  });

  test('F. detectInFileDuplicates preserves order — flags aligned to input', () => {
    const bills = [
      makeBill({ externalBillNumber: 'A1' }),
      makeBill({ externalBillNumber: 'A2' }),
      makeBill({ externalBillNumber: 'A1' }), // dup of index 0
      makeBill({ externalBillNumber: 'A3' }),
      makeBill({ externalBillNumber: 'A2' }), // dup of index 1
    ];
    const result = detectInFileDuplicates(bills);
    expect(result.duplicateFlags).toEqual([false, false, true, false, true]);
    expect(result.duplicateNumbers.sort()).toEqual(['A1', 'A2']);
  });

  test('G. normalizeBillNumber + detectInFileDuplicates work together', () => {
    // Two bills with different whitespace but same logical number
    const bills = [
      makeBill({ externalBillNumber: '  A1051492  ' }),
      makeBill({ externalBillNumber: 'A1051492' }),
    ];
    const result = detectInFileDuplicates(bills);
    // After normalization, both are 'A1051492' → second is in-file dup
    expect(result.duplicateFlags).toEqual([false, true]);
    expect(result.duplicateNumbers).toEqual(['A1051492']);
  });
});
