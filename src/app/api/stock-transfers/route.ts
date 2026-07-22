import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import {
  createStockTransfer,
  type StockTransferInput,
  type AuthInfo,
  type ServiceResult,
} from '@/lib/stock-transfer-service';
import { createPrismaStockTransferDeps } from '@/lib/stock-transfer-prisma-deps';
import { mapServiceResultToResponse } from '@/lib/stock-transfer-route-mapping';
import { STOCK_TRANSFER_TRANSACTION_OPTIONS } from '@/lib/stock-transfer-prisma-deps';
import {
  createStageTracker,
  emitStockTransferLog,
  classifyErrorSafe,
  type TransactionOutcome,
  type StageTiming,
} from '@/lib/stock-transfer-logging';
import { performance } from 'perf_hooks';

// Task 69: Rebuild trigger — ensures Vercel regenerates Prisma client with businessType field.
//
// ST-41: The POST handler is now a thin adapter. All business logic lives in
// src/lib/stock-transfer-service.ts (the production controller) and is invoked
// via the Prisma-backed deps adapter (src/lib/stock-transfer-prisma-deps.ts).
// The route only handles: requestId, auth, body parsing, response mapping.
// Tests execute the REAL production controller via mock deps — the same code
// this route runs in production.

// ST-61 Phase A: Explicit Vercel function maxDuration.
//
// The Prisma interactive transaction timeout is 15s (STOCK_TRANSFER_TRANSACTION_OPTIONS.timeout).
// Keep the route ceiling above Prisma's 15s transaction timeout so the
// application normally has time to return its safe timeout response.
//
// Setting maxDuration = 30 gives a 15s safety margin above the Prisma timeout:
//   - Prisma fires at 15s → our safe 503 reaches the client
//   - If Prisma somehow hangs, Vercel fires at 30s → platform 503
//
export const maxDuration = 30;

// POST /api/stock-transfers - Create a stock transfer (แกะของ/ย้ายสต็อก)
export async function POST(request: NextRequest) {
  const requestStart = performance.now();

  // ST-13: Read client request ID for traceability (or generate one if missing).
  const requestId =
    request.headers.get('x-request-id') ||
    `srv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  const tracker = createStageTracker();

  // --- Auth: admin or transfer.create permission (staff allowed by default) ---
  tracker.start('validation');
  const token = getTokenFromRequest(request);
  if (!token) {
    tracker.end('validation');
    emitStockTransferLog({
      requestId, route: '/api/stock-transfers', userId: '-', username: '-',
      sourceProductId: '-', sourceWeight: 0, outputItemCount: 0, sourceLotCount: 0,
      stages: tracker.getStages(), totalDurationMs: Math.round((performance.now() - requestStart) * 1000) / 1000,
      transactionDurationMs: 0, httpStatus: 401, ok: false, errorCategory: 'AUTH',
      transactionOutcome: 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'ไม่ได้เข้าสู่ระบบ' },
      { status: 401, headers: { 'X-Request-ID': requestId } }
    );
  }
  const payload = await verifyToken(token);
  if (!payload) {
    tracker.end('validation');
    emitStockTransferLog({
      requestId, route: '/api/stock-transfers', userId: '-', username: '-',
      sourceProductId: '-', sourceWeight: 0, outputItemCount: 0, sourceLotCount: 0,
      stages: tracker.getStages(), totalDurationMs: Math.round((performance.now() - requestStart) * 1000) / 1000,
      transactionDurationMs: 0, httpStatus: 401, ok: false, errorCategory: 'AUTH',
      transactionOutcome: 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'token ไม่ถูกต้อง' },
      { status: 401, headers: { 'X-Request-ID': requestId } }
    );
  }
  const hasPermission = payload.role === 'admin' || payload.permissions?.['transfer.create'] === true;
  if (!hasPermission) {
    tracker.end('validation');
    emitStockTransferLog({
      requestId, route: '/api/stock-transfers', userId: payload.userId, username: payload.username,
      sourceProductId: '-', sourceWeight: 0, outputItemCount: 0, sourceLotCount: 0,
      stages: tracker.getStages(), totalDurationMs: Math.round((performance.now() - requestStart) * 1000) / 1000,
      transactionDurationMs: 0, httpStatus: 403, ok: false, errorCategory: 'AUTH',
      transactionOutcome: 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'ไม่มีสิทธิ์' },
      { status: 403, headers: { 'X-Request-ID': requestId } }
    );
  }

  // --- Parse body ---
  let body: StockTransferInput;
  try {
    body = (await request.json()) as StockTransferInput;
  } catch (parseErr) {
    tracker.end('validation');
    const safeClass = classifyErrorSafe(parseErr);
    emitStockTransferLog({
      requestId, route: '/api/stock-transfers', userId: payload.userId, username: payload.username,
      sourceProductId: '-', sourceWeight: 0, outputItemCount: 0, sourceLotCount: 0,
      stages: tracker.getStages(), totalDurationMs: Math.round((performance.now() - requestStart) * 1000) / 1000,
      transactionDurationMs: 0, httpStatus: 400, ok: false,
      errorCategory: 'VALIDATION', prismaCode: safeClass.prismaCode,
      transactionOutcome: 'UNKNOWN',
    });
    return NextResponse.json(
      { error: 'รูปแบบ JSON ไม่ถูกต้อง', requestId },
      { status: 400, headers: { 'X-Request-ID': requestId } }
    );
  }
  tracker.end('validation');

  // --- Call the production service via the Prisma deps adapter ---
  const auth: AuthInfo = {
    userId: payload.userId,
    name: payload.name,
    username: payload.username,
  };
  const deps = createPrismaStockTransferDeps();

  // ST-61: Measure total service + transaction duration
  const serviceStart = performance.now();
  let result: ServiceResult;
  let transactionOutcome: TransactionOutcome = 'UNKNOWN';
  let prismaCode: string | undefined;
  let errorCategory: ReturnType<typeof classifyErrorSafe> | undefined;
  let sourceLotCount = 0;

  try {
    result = await createStockTransfer(
      deps, body, auth, requestId,
      (stage, durationMs) => { tracker.push(stage, durationMs); },
      (key, value) => { if (key === 'sourceLotCount') sourceLotCount = value as number; },
    );
    transactionOutcome = result.transactionOutcome;
  } catch (err) {
    // Defensive: the service catches all known errors internally and returns
    // a ServiceResult. Any throw that escapes is unexpected — log + 500.
    transactionOutcome = 'UNKNOWN';
    errorCategory = classifyErrorSafe(err);
    prismaCode = errorCategory.prismaCode;
    const totalDurationMs = Math.round((performance.now() - requestStart) * 1000) / 1000;
    const transactionDurationMs = Math.round((performance.now() - serviceStart) * 1000) / 1000;
    emitStockTransferLog({
      requestId, route: '/api/stock-transfers', userId: payload.userId, username: payload.username,
      sourceProductId: body?.sourceProductId ?? '-', sourceWeight: body?.sourceWeight ?? 0,
      outputItemCount: body?.items?.length ?? 0, sourceLotCount: 0,
      stages: tracker.getStages(), totalDurationMs, transactionDurationMs,
      httpStatus: 500, ok: false, errorCategory: errorCategory.category, prismaCode,
      transactionOutcome,
    });
    // ST-61: Do NOT expose raw Prisma message to client — use safe message
    return NextResponse.json(
      { error: 'บันทึกใบย้ายสต็อกไม่สำเร็จ', requestId },
      { status: 500, headers: { 'X-Request-ID': requestId } }
    );
  }

  const transactionDurationMs = Math.round((performance.now() - serviceStart) * 1000) / 1000;
  const totalDurationMs = Math.round((performance.now() - requestStart) * 1000) / 1000;

  // Extract Prisma code + safe category for logging
  if (!result.ok) {
    errorCategory = classifyErrorSafe({ code: undefined, message: result.error });
    // Map service error codes to safe categories
    if (result.code === 'TRANSACTION_TIMEOUT') errorCategory = { category: 'TRANSACTION_TIMEOUT', prismaCode: 'P2028' };
    else if (result.code === 'PGBOUNCER_TIMEOUT') errorCategory = { category: 'PGBOUNCER_TIMEOUT' };
    else if (result.code === 'BILL_NUMBER_COLLISION') errorCategory = { category: 'BILL_NUMBER_COLLISION', prismaCode: 'P2002' };
    else if (result.code === 'FK_CONSTRAINT') errorCategory = { category: 'FK_CONSTRAINT', prismaCode: 'P2003' };
    else if (result.code === 'NOT_FOUND') errorCategory = { category: 'NOT_FOUND', prismaCode: 'P2025' };
    else if (result.status === 400) errorCategory = { category: 'VALIDATION' };
    prismaCode = errorCategory.prismaCode;
  }

  // ST-61: Emit structured log for every request (success + failure)
  emitStockTransferLog({
    requestId,
    route: '/api/stock-transfers',
    userId: payload.userId,
    username: payload.username,
    sourceProductId: body?.sourceProductId ?? '-',
    sourceWeight: body?.sourceWeight ?? 0,
    outputItemCount: body?.items?.length ?? 0,
    sourceLotCount, // ST-61: captured from service via onMeta callback
    stages: tracker.getStages(),
    totalDurationMs,
    transactionDurationMs,
    httpStatus: result.ok ? 201 : result.status,
    ok: result.ok,
    errorCode: result.ok ? undefined : (result as { code?: string }).code,
    errorCategory: result.ok ? undefined : errorCategory?.category,
    prismaCode,
    transactionOutcome,
    transferId: result.ok ? result.transfer.id : undefined,
    billNumber: result.ok ? (result.transfer as { billNumber?: string }).billNumber : undefined,
  });

  return mapServiceResultToResponse(result, requestId);
}

// GET /api/stock-transfers - List stock transfers with pagination
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    // By default hide cancelled bills. Pass ?includeCancelled=true to include them.
    const includeCancelled = searchParams.get('includeCancelled') === 'true';
    // Optional businessType filter:
    //   ?businessType=คัดแยก   → only StockTransfers classified as คัดแยก
    //   ?businessType=แกะของ   → StockTransfers classified as แกะของ OR null (default business type)
    //   ?businessType=ALL      → no filter (all StockTransfers, default behavior)
    const businessTypeFilter = searchParams.get('businessType');

    const where: any = includeCancelled ? {} : { isCancelled: false };
    if (businessTypeFilter && businessTypeFilter !== 'ALL') {
      if (businessTypeFilter === 'แกะของ') {
        // แกะของ tab: show StockTransfers where businessType is null/empty OR explicitly 'แกะของ'
        where.OR = [
          { businessType: null },
          { businessType: '' },
          { businessType: 'แกะของ' },
        ];
      } else {
        // คัดแยก tab: show StockTransfers where businessType === 'คัดแยก'
        where.businessType = businessTypeFilter;
      }
    }

    const [bills, total] = await Promise.all([
      db.stockTransfer.findMany({
        where,
        include: {
          sourceProduct: { select: { id: true, name: true } },
          items: { include: { product: { select: { id: true, name: true } } } },
        },
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      db.stockTransfer.count({ where }),
    ]);

    return NextResponse.json({ bills, total });
  } catch (error) {
    console.error('Error fetching stock transfers:', error);
    return NextResponse.json({ error: 'Failed to fetch stock transfers' }, { status: 500 });
  }
}
