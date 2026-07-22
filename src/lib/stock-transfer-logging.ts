/**
 * ST-61 Phase A: Structured server-side logging for stock-transfer creation.
 *
 * Emits a single JSON log line per request with:
 *   - requestId
 *   - route
 *   - stage timings (validation, product lookup, bill number, deduction, etc.)
 *   - total duration
 *   - HTTP outcome
 *   - Prisma error code (if any)
 *   - safe error category (never raw Prisma message)
 *   - transaction outcome (COMMIT/ROLLBACK/UNKNOWN — only as proven by evidence)
 *   - source lot count
 *   - output item count
 *
 * Security:
 *   - NEVER logs passwords, tokens, cookies, authorization headers, DATABASE_URL
 *   - NEVER logs raw request body
 *   - NEVER logs raw Prisma error message (only the code + safe category)
 *   - NEVER claims rollback succeeded without transaction-boundary evidence
 *
 * The log is designed to be searchable in Vercel logs via:
 *   grep '"label":"stock-transfer"' or grep '"requestId":"req-xxx"'
 */

import { performance } from 'perf_hooks';

/** Safe error category — never exposes internal Prisma details. */
export type SafeErrorCategory =
  | 'VALIDATION'
  | 'AUTH'
  | 'INSUFFICIENT_STOCK'
  | 'FIFO_VALIDATION'
  | 'BILL_NUMBER_COLLISION'
  | 'FK_CONSTRAINT'
  | 'NOT_FOUND'
  | 'TRANSACTION_TIMEOUT'
  | 'PGBOUNCER_TIMEOUT'
  | 'UNKNOWN_ERROR';

/** Transaction outcome — only set to COMMIT/ROLLBACK when proven. */
export type TransactionOutcome = 'COMMIT' | 'ROLLBACK' | 'UNKNOWN';

/** Stage names matching the service flow. */
export type StageName =
  | 'validation'
  | 'product_lookup'
  | 'output_product_lookup'
  | 'source_lot_lookup'
  | 'fifo_preview'
  | 'causality_check'
  | 'bill_number_generation'
  | 'source_deduction'
  | 'transfer_creation'
  | 'output_lot_creation'
  | 'stock_movement_creation'
  | 'audit_log_creation';

export interface StageTiming {
  stage: StageName;
  durationMs: number;
}

export interface StockTransferLogData {
  requestId: string;
  route: string;
  userId: string;
  username: string;
  sourceProductId: string;
  sourceWeight: number;
  outputItemCount: number;
  sourceLotCount: number;
  stages: StageTiming[];
  totalDurationMs: number;
  transactionDurationMs: number;
  httpStatus: number;
  ok: boolean;
  errorCode?: string;
  errorCategory?: SafeErrorCategory;
  prismaCode?: string;
  transactionOutcome: TransactionOutcome;
  transferId?: string;
  billNumber?: string;
}

/**
 * ST-61: Timing tracker for stock-transfer creation stages.
 *
 * Usage:
 *   const tracker = createStageTracker();
 *   tracker.start('validation');
 *   ... do validation ...
 *   tracker.end('validation');
 *   // later:
 *   tracker.start('source_deduction');
 *   ... do deduction ...
 *   tracker.end('source_deduction');
 */
export class StageTracker {
  private stages: StageTiming[] = [];
  private activeStarts = new Map<StageName, number>();

  start(stage: StageName): void {
    this.activeStarts.set(stage, performance.now());
  }

  end(stage: StageName): void {
    const start = this.activeStarts.get(stage);
    if (start === undefined) return;
    this.stages.push({ stage, durationMs: Math.round((performance.now() - start) * 1000) / 1000 });
    this.activeStarts.delete(stage);
  }

  /** ST-61: Allow the route to push service-reported stage timings. */
  push(stage: string, durationMs: number): void {
    this.stages.push({ stage: stage as StageName, durationMs });
  }

  getStages(): StageTiming[] {
    return [...this.stages];
  }
}

export function createStageTracker(): StageTracker {
  return new StageTracker();
}

/**
 * Classify an error into a safe category + extract Prisma code.
 * Never exposes the raw Prisma message to the client.
 */
export function classifyErrorSafe(err: unknown): {
  category: SafeErrorCategory;
  prismaCode?: string;
} {
  const code = (err as { code?: string } | null | undefined)?.code;
  const message = err instanceof Error ? err.message : '';

  if (code === 'P2002') return { category: 'BILL_NUMBER_COLLISION', prismaCode: code };
  if (code === 'P2003') return { category: 'FK_CONSTRAINT', prismaCode: code };
  if (code === 'P2025') return { category: 'NOT_FOUND', prismaCode: code };
  if (code === 'P2028') return { category: 'TRANSACTION_TIMEOUT', prismaCode: code };
  if (message.includes('Transaction not found') || message.includes('drained')) {
    return { category: 'PGBOUNCER_TIMEOUT', prismaCode: code };
  }
  if (message.includes('Insufficient stock')) return { category: 'INSUFFICIENT_STOCK' };
  if (message.includes('NEGATIVE_COST_SOURCE_LOT') || message.includes('ZERO_COST_SOURCE_LOT') || message.includes('ZERO_SOURCE_COST')) {
    return { category: 'FIFO_VALIDATION', prismaCode: code };
  }
  return { category: 'UNKNOWN_ERROR', prismaCode: code };
}

/**
 * Emit a structured log line for a stock-transfer request.
 *
 * This is the ONLY function that writes stock-transfer logs.
 * It enforces redaction: never logs raw Prisma message, request body,
 * passwords, tokens, or cookies.
 */
export function emitStockTransferLog(data: StockTransferLogData): void {
  const logLine = JSON.stringify({
    label: 'stock-transfer',
    timestamp: new Date().toISOString(),
    requestId: data.requestId,
    route: data.route,
    userId: data.userId,
    username: data.username,
    sourceProductId: data.sourceProductId,
    sourceWeight: data.sourceWeight,
    outputItemCount: data.outputItemCount,
    sourceLotCount: data.sourceLotCount,
    stages: data.stages,
    totalDurationMs: data.totalDurationMs,
    transactionDurationMs: data.transactionDurationMs,
    httpStatus: data.httpStatus,
    ok: data.ok,
    errorCode: data.errorCode,
    errorCategory: data.errorCategory,
    prismaCode: data.prismaCode,
    // ST-61: transactionOutcome is only set to COMMIT/ROLLBACK when proven
    // by transaction-boundary evidence. Default is UNKNOWN.
    transactionOutcome: data.transactionOutcome,
    transferId: data.transferId,
    billNumber: data.billNumber,
  });
  // Use console.error so it appears in Vercel logs (server-side stderr)
  console.error(logLine);
}
