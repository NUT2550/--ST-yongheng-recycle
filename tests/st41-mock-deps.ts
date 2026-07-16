/**
 * ST-41: Mock StockTransferDeps for testing the real production controller.
 *
 * Records all calls + payloads so tests can assert exactly what the
 * production service would send to Prisma — without any DB writes.
 */
import type {
  StockTransferDeps,
  SourceProductRow,
  SourceLotRow,
  DeductResult,
  CreatedTransfer,
  AuditLogInput,
} from '../src/lib/stock-transfer-service';

export interface MockState {
  findSourceProductCalls: string[];
  findSourceLotsCalls: string[];
  generateBillNumberCalls: number;
  deductSourceLotsCalls: Array<{ productId: string; weightToDeduct: number }>;
  createStockTransferCalls: Record<string, unknown>[];
  createOutputStockLotCalls: Record<string, unknown>[];
  createAuditLogCalls: AuditLogInput[];
  compensateCalls: Array<{ deductedLots: Array<{ id: string; deducted: number }>; requestId: string; reason?: string }>;
  deletePartialTransferCalls: string[];
  deletePartialOutputLotsCalls: string[];
}

export function createMockDeps(options: {
  sourceProduct?: SourceProductRow | null;
  sourceLots?: SourceLotRow[];
  deductResult?: DeductResult;
  deductShouldThrow?: Error;
  createTransferShouldThrow?: Error;
  createLotShouldThrow?: Error;
  transferId?: string;
} = {}): { deps: StockTransferDeps; state: MockState } {
  const state: MockState = {
    findSourceProductCalls: [],
    findSourceLotsCalls: [],
    generateBillNumberCalls: 0,
    deductSourceLotsCalls: [],
    createStockTransferCalls: [],
    createOutputStockLotCalls: [],
    createAuditLogCalls: [],
    compensateCalls: [],
    deletePartialTransferCalls: [],
    deletePartialOutputLotsCalls: [],
  };

  const deps: StockTransferDeps = {
    async findSourceProduct(productId: string) {
      state.findSourceProductCalls.push(productId);
      return options.sourceProduct ?? { id: productId, name: 'Test Product' };
    },
    async findSourceLots(productId: string) {
      state.findSourceLotsCalls.push(productId);
      return options.sourceLots ?? [
        { id: 'lot-1', remainingWeight: 100, costPerKg: 40, dateAdded: new Date('2026-01-01T00:00:00+07:00'), createdAt: new Date('2026-01-01T00:00:00+07:00') },
      ];
    },
    async generateBillNumber() {
      state.generateBillNumberCalls++;
      return 'TRN-2569-00001';
    },
    async deductSourceLots(productId: string, weightToDeduct: number) {
      state.deductSourceLotsCalls.push({ productId, weightToDeduct });
      if (options.deductShouldThrow) {
        const err = options.deductShouldThrow;
        (err as any).deductedLots = options.deductResult?.deductedLots || [];
        throw err;
      }
      return options.deductResult ?? {
        costPerKg: 40,
        totalCost: Math.round(40 * weightToDeduct * 100) / 100,
        deductedLots: [{ id: 'lot-1', deducted: weightToDeduct }],
      };
    },
    async createStockTransfer(data: Record<string, unknown>) {
      state.createStockTransferCalls.push(data);
      if (options.createTransferShouldThrow) throw options.createTransferShouldThrow;
      const id = options.transferId ?? 'transfer-test-1';
      const itemCount = (data.items as any)?.create?.length ?? 0;
      return {
        id,
        items: Array.from({ length: itemCount }, (_, i) => ({ id: `item-${i}`, productId: `prod-${i}` })),
      } as CreatedTransfer;
    },
    async createOutputStockLot(data: Record<string, unknown>) {
      state.createOutputStockLotCalls.push(data);
      if (options.createLotShouldThrow) throw options.createLotShouldThrow;
    },
    async createAuditLog(data: AuditLogInput) {
      state.createAuditLogCalls.push(data);
    },
    async compensate(deductedLots, requestId, reason?) {
      state.compensateCalls.push({ deductedLots, requestId, reason });
    },
    async deletePartialTransfer(transferId: string) {
      state.deletePartialTransferCalls.push(transferId);
    },
    async deletePartialOutputLots(transferId: string) {
      state.deletePartialOutputLotsCalls.push(transferId);
    },
  };

  return { deps, state };
}
