import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  createStockTransfer,
  type AuthInfo,
  type StockTransferInput,
} from '../src/lib/stock-transfer-service';
import { createMockDeps } from './st41-mock-deps';

const AUTH: AuthInfo = { userId: 'admin-1', name: 'Admin', username: 'admin' };
const REQUEST_ID = 'req-st61-outcome';
const INPUT: StockTransferInput = {
  date: '2026-07-18',
  sourceProductId: 'source-1',
  sourceWeight: 135.6,
  items: [
    { productId: 'output-1', weight: 100, isWaste: false },
    { productId: 'output-2', weight: 30.4, isWaste: false },
  ],
};
const LOTS = [{
  id: 'lot-1',
  remainingWeight: 200,
  costPerKg: 40,
  dateAdded: new Date('2026-07-01T00:00:00+07:00'),
  createdAt: new Date('2026-07-01T00:00:00+07:00'),
}];

function prismaError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('ST-61 explicit transaction boundary outcome', () => {
  test('pre-transaction malformed input is UNKNOWN', async () => {
    const { deps } = createMockDeps();
    const result = await createStockTransfer(deps, { ...INPUT, sourceWeight: 0 }, AUTH, REQUEST_ID);
    expect(result.transactionOutcome).toBe('UNKNOWN');
  });

  test('pre-transaction product not found is UNKNOWN', async () => {
    const { deps } = createMockDeps({ sourceProduct: null });
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.transactionOutcome).toBe('UNKNOWN');
  });

  test('pre-transaction insufficient stock is UNKNOWN', async () => {
    const { deps } = createMockDeps({ sourceLots: [{ ...LOTS[0], remainingWeight: 1 }] });
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.transactionOutcome).toBe('UNKNOWN');
  });

  test('successful transaction resolution is COMMIT', async () => {
    const { deps } = createMockDeps({ sourceLots: LOTS });
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.ok).toBe(true);
    expect(result.transactionOutcome).toBe('COMMIT');
  });

  test('callback failure followed by transaction rejection is ROLLBACK', async () => {
    const { deps } = createMockDeps({
      sourceLots: LOTS,
      createTransferShouldThrow: new Error('write failed'),
    });
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    expect(result.transactionOutcome).toBe('ROLLBACK');
  });

  test('P2028 inside a started transaction is ROLLBACK', async () => {
    const { deps } = createMockDeps({
      sourceLots: LOTS,
      createTransferShouldThrow: prismaError('P2028', 'expired'),
    });
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.transactionOutcome).toBe('ROLLBACK');
  });

  test('P2028 before the transaction callback starts is UNKNOWN', async () => {
    const { deps } = createMockDeps({ sourceLots: LOTS });
    deps.transaction = async () => { throw prismaError('P2028', 'connection acquisition timeout'); };
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.ok).toBe(false);
    expect(result.transactionOutcome).toBe('UNKNOWN');
    if (!result.ok) {
      expect(result.error).toContain('ไม่สามารถยืนยันผลรายการได้');
      expect(result.error).not.toContain('ยกเลิกรายการทั้งหมดแล้ว');
      expect(result.extras).toBeUndefined();
    }
  });

  test('generic rejection before the transaction callback starts is UNKNOWN', async () => {
    const { deps } = createMockDeps({ sourceLots: LOTS });
    deps.transaction = async () => { throw new Error('pool unavailable'); };
    const result = await createStockTransfer(deps, INPUT, AUTH, REQUEST_ID);
    expect(result.transactionOutcome).toBe('UNKNOWN');
  });

  test('route consumes the explicit service outcome and keeps escaped errors UNKNOWN', () => {
    const route = readFileSync('src/app/api/stock-transfers/route.ts', 'utf8');
    expect(route).toContain('transactionOutcome = result.transactionOutcome');
    expect(route).not.toContain('result.status >= 500');
    expect(route).not.toContain("transactionOutcome = 'ROLLBACK'");
    expect(route).toContain("transactionOutcome = 'UNKNOWN';");
  });
});
