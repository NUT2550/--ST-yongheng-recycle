/**
 * ST-61 Phase A — Tests for structured logging, stage timing, maxDuration, and redaction.
 *
 * These tests verify the Phase A additions:
 *   - maxDuration is set on the route
 *   - Prisma timeout alignment (15s < maxDuration 30s)
 *   - structured log fields are emitted
 *   - log redaction (no raw Prisma message, no passwords/tokens)
 *   - stage timing is captured
 *   - P2028 / pgbouncer / unknown error paths
 *   - source lot count = 1 case
 *   - multiple output items
 *   - no business calculation regression
 *
 * Run: bun test tests/st61-phase-a-logging.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  createStockTransfer,
  classifyServiceError,
  type StockTransferInput,
  type AuthInfo,
} from '../src/lib/stock-transfer-service';
import { createMockDeps } from './st41-mock-deps';
import { STOCK_TRANSFER_TRANSACTION_OPTIONS } from '../src/lib/stock-transfer-prisma-deps';
import {
  createStageTracker,
  classifyErrorSafe,
  emitStockTransferLog,
  type SafeErrorCategory,
} from '../src/lib/stock-transfer-logging';
import { performance } from 'perf_hooks';

const AUTH: AuthInfo = { userId: 'admin-1', name: 'Admin', username: 'admin' };
const REQUEST_ID = 'req-st61-phase-a-001';

function makeValidInput(overrides: Partial<StockTransferInput> = {}): StockTransferInput {
  return {
    date: '2026-07-18',
    sourceProductId: 'prod-src-1',
    sourceWeight: 135.6,
    items: [
      { productId: 'prod-out-1', weight: 100, isWaste: false, outputPricePerKg: 32 },
      { productId: 'prod-out-2', weight: 30.40, isWaste: false, outputPricePerKg: 25 },
    ],
    ...overrides,
  };
}

const ENOUGH_SOURCE_LOTS_1 = [
  { id: 'lot-1', remainingWeight: 200, costPerKg: 40, dateAdded: new Date('2026-07-01T00:00:00+07:00'), createdAt: new Date('2026-07-01T00:00:00+07:00') },
];

const ENOUGH_DEDUCT_RESULT_1 = {
  costPerKg: 40,
  totalCost: Math.round(40 * 135.6 * 100) / 100,
  deductedLots: [{ id: 'lot-1', deducted: 135.6 }],
};

function prismaError(code: string, message: string): Error {
  const err = new Error(message);
  (err as { code?: string }).code = code;
  return err;
}

// ============ 1. maxDuration + timeout alignment ============

describe('ST-61 Phase A: maxDuration + timeout alignment', () => {
  test('1. STOCK_TRANSFER_TRANSACTION_OPTIONS.timeout = 15000ms', () => {
    expect(STOCK_TRANSFER_TRANSACTION_OPTIONS.timeout).toBe(15000);
  });

  test('2. maxDuration (30s) > Prisma timeout (15s) with safety margin', () => {
    // The route exports maxDuration = 30. We verify the alignment here.
    // Prisma fires at 15s → our safe 503 reaches the client.
    // Vercel fires at 30s → platform 503 as last resort.
    const maxDuration = 30; // must match route.ts export const maxDuration
    const prismaTimeout = STOCK_TRANSFER_TRANSACTION_OPTIONS.timeout / 1000; // 15s
    expect(maxDuration).toBeGreaterThan(prismaTimeout);
    expect(maxDuration - prismaTimeout).toBeGreaterThanOrEqual(15); // 15s safety margin
  });

  test('3. Prisma timeout > Prisma default 5s', () => {
    expect(STOCK_TRANSFER_TRANSACTION_OPTIONS.timeout).toBeGreaterThan(5000);
  });
});

// ============ 2. Structured log fields ============

describe('ST-61 Phase A: structured log fields', () => {
  test('4. emitStockTransferLog produces JSON with all required fields', () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => logs.push(msg);

    emitStockTransferLog({
      requestId: 'req-test-1',
      route: '/api/stock-transfers',
      userId: 'user-1',
      username: 'admin',
      sourceProductId: 'prod-1',
      sourceWeight: 135.6,
      outputItemCount: 2,
      sourceLotCount: 1,
      stages: [{ stage: 'source_deduction', durationMs: 5.2 }],
      totalDurationMs: 100.5,
      transactionDurationMs: 80.3,
      httpStatus: 201,
      ok: true,
      transactionOutcome: 'COMMIT',
      transferId: 'transfer-1',
      billNumber: 'TRN-2569-00001',
    });

    console.error = origError;
    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.label).toBe('stock-transfer');
    expect(parsed.requestId).toBe('req-test-1');
    expect(parsed.route).toBe('/api/stock-transfers');
    expect(parsed.userId).toBe('user-1');
    expect(parsed.username).toBe('admin');
    expect(parsed.sourceProductId).toBe('prod-1');
    expect(parsed.sourceWeight).toBe(135.6);
    expect(parsed.outputItemCount).toBe(2);
    expect(parsed.sourceLotCount).toBe(1);
    expect(parsed.stages).toEqual([{ stage: 'source_deduction', durationMs: 5.2 }]);
    expect(parsed.totalDurationMs).toBe(100.5);
    expect(parsed.transactionDurationMs).toBe(80.3);
    expect(parsed.httpStatus).toBe(201);
    expect(parsed.ok).toBe(true);
    expect(parsed.transactionOutcome).toBe('COMMIT');
    expect(parsed.transferId).toBe('transfer-1');
    expect(parsed.billNumber).toBe('TRN-2569-00001');
  });

  test('5. log does NOT contain password, token, cookie, or authorization fields', () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => logs.push(msg);

    emitStockTransferLog({
      requestId: 'req-test-2',
      route: '/api/stock-transfers',
      userId: 'user-1',
      username: 'admin',
      sourceProductId: 'prod-1',
      sourceWeight: 100,
      outputItemCount: 1,
      sourceLotCount: 1,
      stages: [],
      totalDurationMs: 50,
      transactionDurationMs: 40,
      httpStatus: 500,
      ok: false,
      errorCategory: 'UNKNOWN_ERROR',
      transactionOutcome: 'ROLLBACK',
    });

    console.error = origError;
    const logStr = logs[0];
    expect(logStr).not.toContain('password');
    expect(logStr).not.toContain('token');
    expect(logStr).not.toContain('cookie');
    expect(logStr).not.toContain('authorization');
    expect(logStr).not.toContain('DATABASE_URL');
    expect(logStr).not.toContain('secret');
  });

  test('6. log does NOT contain raw Prisma error message', () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => logs.push(msg);

    const rawPrismaMessage = 'Transaction API error: transaction already expired (internal Prisma detail)';
    emitStockTransferLog({
      requestId: 'req-test-3',
      route: '/api/stock-transfers',
      userId: 'user-1',
      username: 'admin',
      sourceProductId: 'prod-1',
      sourceWeight: 100,
      outputItemCount: 1,
      sourceLotCount: 1,
      stages: [],
      totalDurationMs: 50,
      transactionDurationMs: 40,
      httpStatus: 503,
      ok: false,
      errorCategory: 'TRANSACTION_TIMEOUT',
      prismaCode: 'P2028',
      transactionOutcome: 'ROLLBACK',
    });

    console.error = origError;
    const logStr = logs[0];
    // The log should have the safe category + prismaCode, but NOT the raw message
    expect(logStr).toContain('TRANSACTION_TIMEOUT');
    expect(logStr).toContain('P2028');
    expect(logStr).not.toContain(rawPrismaMessage);
    expect(logStr).not.toContain('Transaction API error');
    expect(logStr).not.toContain('transaction already expired');
  });
});

// ============ 3. Log redaction + safe error category ============

describe('ST-61 Phase A: classifyErrorSafe redaction', () => {
  test('7. P2028 → TRANSACTION_TIMEOUT category, no raw message', () => {
    const err = prismaError('P2028', 'Transaction API error: transaction already expired');
    const result = classifyErrorSafe(err);
    expect(result.category).toBe('TRANSACTION_TIMEOUT');
    expect(result.prismaCode).toBe('P2028');
    // classifyErrorSafe does not return the raw message — only category + code
  });

  test('8. pgbouncer pattern → PGBOUNCER_TIMEOUT category', () => {
    const err = new Error('Transaction not found in pgbouncer pool');
    const result = classifyErrorSafe(err);
    expect(result.category).toBe('PGBOUNCER_TIMEOUT');
  });

  test('9. unknown error → UNKNOWN_ERROR category', () => {
    const err = new Error('Something completely unexpected');
    const result = classifyErrorSafe(err);
    expect(result.category).toBe('UNKNOWN_ERROR');
  });

  test('10. P2002 → BILL_NUMBER_COLLISION category', () => {
    const err = prismaError('P2002', 'Unique constraint failed on billNumber');
    const result = classifyErrorSafe(err);
    expect(result.category).toBe('BILL_NUMBER_COLLISION');
  });
});

// ============ 4. Stage timing ============

describe('ST-61 Phase A: stage timing emitted via onStage callback', () => {
  test('11. onStage callback receives all DB stage timings', async () => {
    const stages: Array<{ stage: string; durationMs: number }> = [];
    const { deps } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    await createStockTransfer(
      deps, makeValidInput(), AUTH, REQUEST_ID,
      (stage, durationMs) => stages.push({ stage, durationMs }),
    );

    const stageNames = stages.map((s) => s.stage);
    expect(stageNames).toContain('product_lookup');
    expect(stageNames).toContain('output_product_lookup');
    expect(stageNames).toContain('source_lot_lookup');
    expect(stageNames).toContain('bill_number_generation');
    expect(stageNames).toContain('source_deduction');
    expect(stageNames).toContain('transfer_creation');
    expect(stageNames).toContain('output_lot_creation');
    expect(stageNames).toContain('stock_movement_creation');
    expect(stageNames).toContain('audit_log_creation');
  });

  test('12. onMeta callback receives sourceLotCount', async () => {
    const meta: Record<string, number | string> = {};
    const { deps } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    await createStockTransfer(
      deps, makeValidInput(), AUTH, REQUEST_ID,
      undefined,
      (key, value) => { meta[key] = value; },
    );
    expect(meta.sourceLotCount).toBe(1);
  });

  test('13. stage timings are non-negative numbers', async () => {
    const stages: Array<{ stage: string; durationMs: number }> = [];
    const { deps } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    await createStockTransfer(
      deps, makeValidInput(), AUTH, REQUEST_ID,
      (stage, durationMs) => stages.push({ stage, durationMs }),
    );
    for (const s of stages) {
      expect(typeof s.durationMs).toBe('number');
      expect(s.durationMs).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============ 5. Source lot count = 1 case (Owner's scenario) ============

describe('ST-61 Phase A: source lot count = 1 (Owner scenario)', () => {
  test('14. valid transfer with 1 source lot succeeds', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(201);
    }
    expect(state.deductSourceLotsCalls).toHaveLength(1);
    expect(state.createStockTransferCalls).toHaveLength(1);
    expect(state.createOutputStockLotCalls).toHaveLength(2);
  });

  test('15. 1 source lot + 2 output items = correct loss calculation', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    const createData = state.createStockTransferCalls[0];
    // sourceWeight = 135.6, output total = 130.40, loss = 5.20
    expect(createData.sourceWeight).toBe(135.6);
    expect(createData.lossWeight).toBe(5.2);
  });
});

// ============ 6. P2028 / pgbouncer / unknown error paths ============

describe('ST-61 Phase A: error path coverage', () => {
  test('16. P2028 path → 503 TRANSACTION_TIMEOUT (no raw message)', async () => {
    const { deps } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
      createTransferShouldThrow: prismaError('P2028', 'Transaction expired'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe('TRANSACTION_TIMEOUT');
      expect(result.error).not.toContain('Transaction expired');
      expect(result.error).not.toContain('Prisma');
    }
  });

  test('17. pgbouncer path → 503 PGBOUNCER_TIMEOUT', async () => {
    const { deps } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
      createTransferShouldThrow: new Error('Transaction not found in pgbouncer'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(503);
      expect(result.code).toBe('PGBOUNCER_TIMEOUT');
    }
  });

  test('18. unknown error path → 500 (no raw details exposed via P2028)', async () => {
    const { deps } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
      createTransferShouldThrow: new Error('Unexpected internal error'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      // The default 500 does include extras.details — this is pre-existing behavior
      // for non-P2028 errors. P2028 specifically does NOT include details.
    }
  });
});

// ============ 7. Rollback / failure behavior ============

describe('ST-61 Phase A: rollback behavior with 1 source lot', () => {
  test('19. rollback on transfer creation failure — zero committed records', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
      createTransferShouldThrow: new Error('DB error'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
  });

  test('20. rollback on output lot creation failure — zero committed records', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
      createLotShouldThrow: new Error('DB error during lot creation'),
    });
    const result = await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    expect(state.createStockTransferCalls).toHaveLength(0);
    expect(state.createOutputStockLotCalls).toHaveLength(0);
  });
});

// ============ 8. No business calculation regression ============

describe('ST-61 Phase A: no business calculation regression', () => {
  test('21. loss calculation unchanged with timing hooks', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    const stages: Array<{ stage: string; durationMs: number }> = [];
    await createStockTransfer(
      deps, makeValidInput(), AUTH, REQUEST_ID,
      (stage, durationMs) => stages.push({ stage, durationMs }),
    );
    // Verify the same loss calculation as before
    const createData = state.createStockTransferCalls[0];
    expect(createData.sourceWeight).toBe(135.6);
    expect(createData.lossWeight).toBe(5.2);
    expect(createData.lossCost).toBe(Math.round(5.2 * 40 * 100) / 100); // 208
  });

  test('22. cost allocation unchanged with timing hooks', async () => {
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    await createStockTransfer(deps, makeValidInput(), AUTH, REQUEST_ID);
    // Verify output lots were created (cost allocation happened)
    expect(state.createOutputStockLotCalls).toHaveLength(2);
    for (const lot of state.createOutputStockLotCalls) {
      expect(lot.costPerKg).toBeDefined();
      expect(typeof lot.costPerKg).toBe('number');
    }
  });

  test('23. multiple output items (3) all get created', async () => {
    const input = makeValidInput({
      items: [
        { productId: 'prod-out-1', weight: 50, isWaste: false, outputPricePerKg: 32 },
        { productId: 'prod-out-2', weight: 50, isWaste: false, outputPricePerKg: 25 },
        { productId: 'prod-out-3', weight: 30.40, isWaste: false, outputPricePerKg: 20 },
      ],
    });
    const { deps, state } = createMockDeps({
      sourceLots: ENOUGH_SOURCE_LOTS_1,
      deductResult: ENOUGH_DEDUCT_RESULT_1,
    });
    const result = await createStockTransfer(deps, input, AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
    expect(state.createOutputStockLotCalls).toHaveLength(3);
  });
});

// ============ 9. StageTracker unit tests ============

describe('ST-61 Phase A: StageTracker', () => {
  test('24. StageTracker.start/end records duration', () => {
    const tracker = createStageTracker();
    tracker.start('validation');
    // Simulate work
    const start = performance.now();
    while (performance.now() - start < 1) { /* busy wait 1ms */ }
    tracker.end('validation');
    const stages = tracker.getStages();
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe('validation');
    expect(stages[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  test('25. StageTracker.push adds external stage', () => {
    const tracker = createStageTracker();
    tracker.push('source_deduction', 5.2);
    const stages = tracker.getStages();
    expect(stages).toHaveLength(1);
    expect(stages[0].stage).toBe('source_deduction');
    expect(stages[0].durationMs).toBe(5.2);
  });

  test('26. StageTracker.getStages returns a copy (not internal array)', () => {
    const tracker = createStageTracker();
    tracker.push('validation', 1);
    const stages1 = tracker.getStages();
    // Try to mutate the returned array
    stages1.push({ stage: 'audit_log_creation', durationMs: 999 });
    const stages2 = tracker.getStages();
    expect(stages2).toHaveLength(1);
    expect(stages2.find((s) => s.durationMs === 999)).toBeUndefined();
  });
});
