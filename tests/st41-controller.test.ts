/**
 * ST-41: Real production-path tests for StockTransfer creation.
 *
 * These tests execute the REAL `createStockTransfer` production controller
 * from src/lib/stock-transfer-service.ts — the same function the POST route
 * calls. Tests inject mock dependencies (tests/st41-mock-deps.ts) that
 * record all calls + payloads, proving the production code path without
 * any database writes.
 *
 * Run: bun test tests/st41-controller.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  createStockTransfer,
  validateStockTransferBusinessDate,
  buildTransferAuditDetails,
  buildStockTransferCreateData,
  buildOutputStockLotData,
  type StockTransferInput,
  type AuthInfo,
} from '../src/lib/stock-transfer-service';
import { createMockDeps } from './st41-mock-deps';

const AUTH: AuthInfo = { userId: 'admin-1', name: 'Admin', username: 'admin' };
const REQUEST_ID = 'req-test-001';

function makeValidInput(overrides: Partial<StockTransferInput> = {}): StockTransferInput {
  return {
    date: '2026-07-15',
    sourceProductId: 'prod-src-1',
    sourceWeight: 20.80,
    items: [
      { productId: 'prod-out-1', weight: 20.80, isWaste: false, outputPricePerKg: 32 },
    ],
    ...overrides,
  };
}

// ============ 1. Date validation rejections (before any stock deduction) ============

describe('ST-41 controller: date validation rejects before deduction', () => {
  test('1. missing date → 400 DATE_REQUIRED, zero deductions', async () => {
    const { deps, state } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: '' as any }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('DATE_REQUIRED');
    }
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
    expect(state.createAuditLogCalls).toHaveLength(0);
    expect(state.compensateCalls).toHaveLength(0);
  });

  test('2. malformed date → 400 DATE_INVALID, zero deductions', async () => {
    const { deps, state } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: 'not-a-date' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DATE_INVALID');
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
  });

  test('3. impossible date 2026-02-30 → 400 DATE_INVALID, zero deductions', async () => {
    const { deps, state } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-02-30' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DATE_INVALID');
    expect(state.deductSourceLotsCalls).toHaveLength(0);
  });

  test('4. future date → 400 DATE_FUTURE, zero deductions', async () => {
    const { deps, state } = createMockDeps();
    const futureDate = '2099-12-31';
    const result = await createStockTransfer(deps, makeValidInput({ date: futureDate }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('DATE_FUTURE');
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
    expect(state.createAuditLogCalls).toHaveLength(0);
    expect(state.compensateCalls).toHaveLength(0);
  });

  test('5. each rejection calls deduction ZERO times', async () => {
    // Already proven above — this test aggregates the count across all 4 rejections
    const { deps, state } = createMockDeps();
    await createStockTransfer(deps, makeValidInput({ date: '' as any }), AUTH, REQUEST_ID);
    await createStockTransfer(deps, makeValidInput({ date: 'bad' }), AUTH, REQUEST_ID);
    await createStockTransfer(deps, makeValidInput({ date: '2026-02-30' }), AUTH, REQUEST_ID);
    await createStockTransfer(deps, makeValidInput({ date: '2099-12-31' }), AUTH, REQUEST_ID);
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.compensateCalls).toHaveLength(0);
  });
});

// ============ 2. Source-lot causality rejection ============

describe('ST-41 controller: source-lot causality', () => {
  test('6. business date before source lot → BUSINESS_DATE_BEFORE_SOURCE, zero deductions', async () => {
    // Source lot acquired 2026-07-16, business date 2026-07-15 → violation
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-16T00:00:00+07:00'), createdAt: new Date('2026-07-16T00:00:00+07:00') },
      ],
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-15' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.code).toBe('BUSINESS_DATE_BEFORE_SOURCE');
    }
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
    expect(state.createAuditLogCalls).toHaveLength(0);
  });

  test('7. equal source date → accepted (no causality violation)', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-15T00:00:00+07:00'), createdAt: new Date('2026-07-15T00:00:00+07:00') },
      ],
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-15' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
  });

  test('8. later than source date → accepted', async () => {
    const { deps } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-14T00:00:00+07:00'), createdAt: new Date('2026-07-14T00:00:00+07:00') },
      ],
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-15' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
  });

  test('9. multiple source lots — uses LATEST source date for causality', async () => {
    const { deps } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 50, costPerKg: 40, dateAdded: new Date('2026-07-10T00:00:00+07:00'), createdAt: new Date('2026-07-10T00:00:00+07:00') },
        { id: 'lot-2', remainingWeight: 50, costPerKg: 40, dateAdded: new Date('2026-07-14T00:00:00+07:00'), createdAt: new Date('2026-07-14T00:00:00+07:00') },
      ],
    });
    // Business date 07-13 is before lot-2's 07-14 → violation
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-13', sourceWeight: 60 }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BUSINESS_DATE_BEFORE_SOURCE');
  });
});

// ============ 3. Successful yesterday case — full production path ============

describe('ST-41 controller: successful yesterday case — full path', () => {
  test('10. yesterday accepted → StockTransfer + StockLot + AuditLog all created', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-10T00:00:00+07:00'), createdAt: new Date('2026-07-10T00:00:00+07:00') },
      ],
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(201);
      expect(result.transfer.id).toBeDefined();
    }
    // Deduction called exactly once
    expect(state.deductSourceLotsCalls).toHaveLength(1);
    expect(state.deductSourceLotsCalls[0].weightToDeduct).toBe(20.80);
    // StockTransfer created exactly once
    expect(state.createStockTransferCalls).toHaveLength(1);
    // Output StockLot created exactly once (1 non-waste item)
    expect(state.createOutputStockLotCalls).toHaveLength(1);
    // AuditLog created exactly once
    expect(state.createAuditLogCalls).toHaveLength(1);
  });

  test('11. StockTransfer create payload has correct Thailand business date', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-10T00:00:00+07:00'), createdAt: new Date('2026-07-10T00:00:00+07:00') },
      ],
    });
    await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    const createData = state.createStockTransferCalls[0];
    // date should be parseThailandBusinessDate('2026-07-14') = 2026-07-13T17:00:00.000Z
    expect((createData.date as Date).toISOString()).toBe('2026-07-13T17:00:00.000Z');
  });

  test('12. StockTransfer create payload does NOT set createdAt (server-generated)', async () => {
    const { deps, state } = createMockDeps();
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    const createData = state.createStockTransferCalls[0];
    expect(createData).not.toHaveProperty('createdAt');
  });

  test('13. StockLot.dateAdded receives the same Thailand business date', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-10T00:00:00+07:00'), createdAt: new Date('2026-07-10T00:00:00+07:00') },
      ],
    });
    await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    const lotData = state.createOutputStockLotCalls[0];
    expect((lotData.dateAdded as Date).toISOString()).toBe('2026-07-13T17:00:00.000Z');
    expect(lotData.source).toBe('TRANSFER');
    expect(lotData.sourceId).toBe('transfer-test-1');
  });

  test('14. StockLot create payload does NOT set createdAt', async () => {
    const { deps, state } = createMockDeps();
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    const lotData = state.createOutputStockLotCalls[0];
    expect(lotData).not.toHaveProperty('createdAt');
  });

  test('15. AuditLog details contain businessDate + storedBusinessDateUtc + requestId + actor', async () => {
    const { deps, state } = createMockDeps();
    await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    expect(state.createAuditLogCalls).toHaveLength(1);
    const audit = state.createAuditLogCalls[0];
    expect(audit.entityType).toBe('STOCK_TRANSFER');
    expect(audit.userId).toBe('admin-1');
    expect(audit.userName).toBe('Admin');
    const details = JSON.parse(audit.details);
    expect(details.businessDate).toBe('2026-07-14');
    expect(details.storedBusinessDateUtc).toBe('2026-07-13T17:00:00.000Z');
    expect(details.requestId).toBe(REQUEST_ID);
    expect(details.actorUserId).toBe('admin-1');
    expect(details.actorUserName).toBe('Admin');
    expect(details.billNumber).toBe('TRN-2569-00001');
  });

  test('16. AuditLog excludes secrets/tokens/passwords', async () => {
    const { deps, state } = createMockDeps();
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    const details = JSON.parse(state.createAuditLogCalls[0].details);
    expect(details).not.toHaveProperty('token');
    expect(details).not.toHaveProperty('authorization');
    expect(details).not.toHaveProperty('password');
    expect(details).not.toHaveProperty('credential');
  });
});

// ============ 4. Failure after deduction — atomic transaction rollback ============

describe('ST-41 controller: failure after deduction rolls back atomically', () => {
  test('17. createStockTransfer failure leaves no partial state', async () => {
    const { deps, state } = createMockDeps({
      createTransferShouldThrow: new Error('DB connection lost'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.compensateCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
    expect(state.createAuditLogCalls).toHaveLength(0);
  });

  test('18. createOutputStockLot failure leaves no partial state', async () => {
    const { deps, state } = createMockDeps({
      createLotShouldThrow: new Error('StockLot insert failed'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(500);
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
    expect(state.createStockMovementCalls).toHaveLength(0);
    expect(state.compensateCalls).toHaveLength(0);
  });

  test('19. ledger insertion failure leaves no partial state', async () => {
    const { deps, state } = createMockDeps({ createMovementShouldThrow: new Error('ledger insert failed') });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
    expect(state.createStockMovementCalls).toHaveLength(0);
  });
});

// ============ 5. validateStockTransferBusinessDate (pure function) ============

describe('ST-41: validateStockTransferBusinessDate — pure function', () => {
  test('20. missing date → DATE_REQUIRED', () => {
    const r = validateStockTransferBusinessDate(undefined);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DATE_REQUIRED');
  });

  test('21. invalid format → DATE_INVALID', () => {
    const r = validateStockTransferBusinessDate('2026/07/15');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DATE_INVALID');
  });

  test('22. future date → DATE_FUTURE', () => {
    const r = validateStockTransferBusinessDate('2099-12-31');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('DATE_FUTURE');
  });

  test('23. valid yesterday → ok with storedBusinessDate', () => {
    const r = validateStockTransferBusinessDate('2026-07-14');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.businessDate).toBe('2026-07-14');
      expect(r.storedBusinessDate.toISOString()).toBe('2026-07-13T17:00:00.000Z');
    }
  });
});

// ============ 6. Build functions (pure, verify exact payloads) ============

describe('ST-41: buildStockTransferCreateData — exact payload', () => {
  test('24. create data has correct date + gainWeight + does NOT have createdAt', () => {
    const input = makeValidInput({ date: '2026-07-14' });
    const data = buildStockTransferCreateData(input, {
      billNumber: 'TRN-2569-00001',
      sourceCostPerKg: 40,
      sourceTotalCost: 832,
      lossWeight: 0,
      lossCost: 0,
      gainWeight: 0,
      weightVariance: 0,
      gainReason: null,
      outputTotalValue: 665.60,
      profitLoss: -166.40,
      allocatedItems: [{ costPerKg: 40, totalCost: 832 }],
      storedBusinessDate: new Date('2026-07-13T17:00:00.000Z'),
    });
    expect((data.date as Date).toISOString()).toBe('2026-07-13T17:00:00.000Z');
    expect(data.gainWeight).toBe(0);
    expect(data).not.toHaveProperty('createdAt');
  });
});

describe('ST-41: buildOutputStockLotData — exact payload', () => {
  test('25. non-waste item → lot data with business date + no createdAt', () => {
    const item = { productId: 'out-1', weight: 20.80, isWaste: false };
    const data = buildOutputStockLotData(item, 40, new Date('2026-07-13T17:00:00.000Z'), 'transfer-1');
    expect(data).not.toBeNull();
    expect(data!.productId).toBe('out-1');
    expect(data!.remainingWeight).toBe(20.80);
    expect(data!.costPerKg).toBe(40);
    expect((data!.dateAdded as Date).toISOString()).toBe('2026-07-13T17:00:00.000Z');
    expect(data!.source).toBe('TRANSFER');
    expect(data!.sourceId).toBe('transfer-1');
    expect(data).not.toHaveProperty('createdAt');
  });

  test('26. waste item → null (no lot created)', () => {
    const item = { productId: 'waste-1', weight: 0.40, isWaste: true };
    const data = buildOutputStockLotData(item, 0, new Date('2026-07-13T17:00:00.000Z'), 'transfer-1');
    expect(data).toBeNull();
  });
});

describe('ST-41: buildTransferAuditDetails — exact fields', () => {
  test('27. contains all required fields + excludes secrets', () => {
    const details = buildTransferAuditDetails({
      billNumber: 'TRN-2569-00001',
      sourceProductName: 'Test',
      sourceCostPerKg: 40,
      sourceTotalCost: 832,
      lossWeight: 0,
      lossCost: 0,
      gainWeight: 3.80,
      weightVariance: 3.80,
      gainReason: 'หักน้ำหนักประเมินตอนซื้อ',
      allocatedOutputTotalCost: 832,
      costConserved: true,
      itemCount: 1,
      nonWasteItemCount: 1,
      fifoAuditDetails: { allocationMethod: 'SOURCE_FIFO_WEIGHTED_AVERAGE' },
      outputItems: [{ productId: 'out-1', weight: 24.60, isWaste: false }],
      businessDate: '2026-07-14',
      storedBusinessDateUtc: '2026-07-13T17:00:00.000Z',
      requestId: 'req-001',
      actorUserId: 'admin-1',
      actorUserName: 'Admin',
    });
    // Required fields
    expect(details.businessDate).toBe('2026-07-14');
    expect(details.storedBusinessDateUtc).toBe('2026-07-13T17:00:00.000Z');
    expect(details.billNumber).toBe('TRN-2569-00001');
    expect(details.requestId).toBe('req-001');
    expect(details.actorUserId).toBe('admin-1');
    expect(details.actorUserName).toBe('Admin');
    // No secrets
    expect(details).not.toHaveProperty('token');
    expect(details).not.toHaveProperty('password');
    expect(details).not.toHaveProperty('authorization');
  });
});
