/**
 * ST-41: HTTP-layer mapping tests for the POST /api/stock-transfers route.
 *
 * The route is now a thin adapter: auth + body parsing + service call + response
 * mapping. The service (createStockTransfer) is already tested with mock deps
 * in st41-controller.test.ts. These tests verify the HTTP-layer mapping from
 * ServiceResult → NextResponse, using the REAL createStockTransfer + the REAL
 * mapServiceResultToResponse exported from the route module.
 *
 * Run: bun test tests/st41-handler.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  createStockTransfer,
  type StockTransferInput,
  type AuthInfo,
  type ServiceResult,
} from '../src/lib/stock-transfer-service';
import { createMockDeps } from './st41-mock-deps';
import { mapServiceResultToResponse } from '../src/lib/stock-transfer-route-mapping';

const AUTH: AuthInfo = { userId: 'admin-1', name: 'Admin', username: 'admin' };
const REQUEST_ID = 'req-handler-001';

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

/** Extract the JSON body + status + headers from a NextResponse. */
async function readResponse(res: Response): Promise<{
  status: number;
  body: Record<string, unknown>;
  requestIdHeader: string | null;
}> {
  const status = res.status;
  const body = (await res.json()) as Record<string, unknown>;
  const requestIdHeader = res.headers.get('X-Request-ID');
  return { status, body, requestIdHeader };
}

// ============ 1. Date validation rejections → 400 + X-Request-ID ============

describe('ST-41 handler: date validation HTTP mapping', () => {
  test('1. DATE_REQUIRED → 400 + X-Request-ID + { error, code, requestId }', async () => {
    const { deps, state } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: '' as any }), AUTH, REQUEST_ID);
    const res = mapServiceResultToResponse(result, REQUEST_ID);
    const { status, body, requestIdHeader } = await readResponse(res);
    expect(status).toBe(400);
    expect(requestIdHeader).toBe(REQUEST_ID);
    expect(body.code).toBe('DATE_REQUIRED');
    expect(body.requestId).toBe(REQUEST_ID);
    expect(body.error).toBe('กรุณาระบุวันที่แกะของ');
    // Rejection calls deduction 0 times
    expect(state.deductSourceLotsCalls).toHaveLength(0);
  });

  test('2. DATE_INVALID → 400 + X-Request-ID', async () => {
    const { deps, state } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: 'not-a-date' }), AUTH, REQUEST_ID);
    const res = mapServiceResultToResponse(result, REQUEST_ID);
    const { status, body, requestIdHeader } = await readResponse(res);
    expect(status).toBe(400);
    expect(requestIdHeader).toBe(REQUEST_ID);
    expect(body.code).toBe('DATE_INVALID');
    expect(state.deductSourceLotsCalls).toHaveLength(0);
  });

  test('3. DATE_FUTURE → 400 + X-Request-ID', async () => {
    const { deps, state } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: '2099-12-31' }), AUTH, REQUEST_ID);
    const res = mapServiceResultToResponse(result, REQUEST_ID);
    const { status, body, requestIdHeader } = await readResponse(res);
    expect(status).toBe(400);
    expect(requestIdHeader).toBe(REQUEST_ID);
    expect(body.code).toBe('DATE_FUTURE');
    expect(state.deductSourceLotsCalls).toHaveLength(0);
  });
});

// ============ 2. BUSINESS_DATE_BEFORE_SOURCE → 400 ============

describe('ST-41 handler: causality HTTP mapping', () => {
  test('4. BUSINESS_DATE_BEFORE_SOURCE → 400 + extras { businessDate, latestSourceDate }', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-16T00:00:00+07:00'), createdAt: new Date('2026-07-16T00:00:00+07:00') },
      ],
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-15' }), AUTH, REQUEST_ID);
    const res = mapServiceResultToResponse(result, REQUEST_ID);
    const { status, body, requestIdHeader } = await readResponse(res);
    expect(status).toBe(400);
    expect(requestIdHeader).toBe(REQUEST_ID);
    expect(body.code).toBe('BUSINESS_DATE_BEFORE_SOURCE');
    expect(body.businessDate).toBe('2026-07-15');
    expect(body.latestSourceDate).toBeDefined();
    // Rejection calls deduction 0 times
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.createStockTransferCalls).toHaveLength(0);
  });
});

// ============ 3. Successful → 201 + { bill } ============

describe('ST-41 handler: success HTTP mapping', () => {
  test('5. successful → 201 + { bill: transfer } + X-Request-ID', async () => {
    const { deps } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-10T00:00:00+07:00'), createdAt: new Date('2026-07-10T00:00:00+07:00') },
      ],
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    const res = mapServiceResultToResponse(result, REQUEST_ID);
    const { status, body, requestIdHeader } = await readResponse(res);
    expect(status).toBe(201);
    expect(requestIdHeader).toBe(REQUEST_ID);
    expect(body.bill).toBeDefined();
    expect((body.bill as { id: string }).id).toBe('transfer-test-1');
  });
});

// ============ 4. FIFO_MISMATCH → 409 + extras ============

describe('ST-41 handler: FIFO mismatch HTTP mapping', () => {
  test('6. FIFO_MISMATCH → 409 + extras { sourceProductId, sourceWeight, previewCost, actualCost }', async () => {
    // Force a FIFO mismatch by having deductSourceLots return a different costPerKg
    // than the preview computed from sourceLots.
    const { deps, state } = createMockDeps({
      sourceLots: [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-10T00:00:00+07:00'), createdAt: new Date('2026-07-10T00:00:00+07:00') },
      ],
      // Preview computes costPerKg=40 from the lot above; deduct returns 99 → mismatch
      deductResult: {
        costPerKg: 99,
        totalCost: 99 * 20.80,
        deductedLots: [{ id: 'lot-1', deducted: 20.80 }],
      },
    });
    const result = await createStockTransfer(deps, makeValidInput({ date: '2026-07-14' }), AUTH, REQUEST_ID);
    const res = mapServiceResultToResponse(result, REQUEST_ID);
    const { status, body, requestIdHeader } = await readResponse(res);
    expect(status).toBe(409);
    expect(requestIdHeader).toBe(REQUEST_ID);
    expect(body.code).toBe('FIFO_MISMATCH');
    expect(body.sourceProductId).toBe('prod-src-1');
    expect(body.previewCost).toBe(40);
    expect(body.actualCost).toBe(99);
    // The transaction rollback removes the attempted deduction without compensation.
    expect(state.deductSourceLotsCalls).toHaveLength(0);
    expect(state.compensateCalls).toHaveLength(0);
    // No StockTransfer created on mismatch
    expect(state.createStockTransferCalls).toHaveLength(0);
  });
});

// ============ 5. Rejection evidence — deduction 0 times ============

describe('ST-41 handler: rejections call deduction 0 times', () => {
  test('7. all date/causality rejections — zero deductions across the board', async () => {
    type Case = { name: string; input: StockTransferInput; sourceLots?: import('../src/lib/stock-transfer-service').SourceLotRow[] };
    const cases: Case[] = [
      { name: 'DATE_REQUIRED', input: makeValidInput({ date: '' as any }) },
      { name: 'DATE_INVALID', input: makeValidInput({ date: 'bad' }) },
      { name: 'DATE_FUTURE', input: makeValidInput({ date: '2099-12-31' }) },
      {
        name: 'BUSINESS_DATE_BEFORE_SOURCE',
        input: makeValidInput({ date: '2026-07-15' }),
        sourceLots: [
          { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-07-16T00:00:00+07:00'), createdAt: new Date('2026-07-16T00:00:00+07:00') },
        ],
      },
    ];

    for (const c of cases) {
      const { deps, state } = createMockDeps({ sourceLots: c.sourceLots });
      const result = await createStockTransfer(deps, c.input, AUTH, REQUEST_ID);
      // Map to response — verifies no throw in the mapping layer
      const res = mapServiceResultToResponse(result, REQUEST_ID);
      expect(res.status).toBe(400);
      expect(state.deductSourceLotsCalls).toHaveLength(0);
      expect(state.createStockTransferCalls).toHaveLength(0);
      expect(state.createOutputStockLotCalls).toHaveLength(0);
    }
  });
});

// ============ 6. ServiceResult shape invariants ============

describe('ST-41 handler: ServiceResult shape invariants', () => {
  test('8. ok:true result has status 201 + transfer', async () => {
    const { deps } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(201);
      expect(result.transfer.id).toBeDefined();
      expect(result.auditDetails).toBeDefined();
    }
  });

  test('9. ok:false result has status + error + requestId', async () => {
    const { deps } = createMockDeps();
    const result = await createStockTransfer(deps, makeValidInput({ date: '' as any }), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(typeof result.status).toBe('number');
      expect(typeof result.error).toBe('string');
      expect(result.requestId).toBe(REQUEST_ID);
    }
  });
});
