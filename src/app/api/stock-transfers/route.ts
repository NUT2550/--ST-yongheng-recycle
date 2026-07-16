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

// Task 69: Rebuild trigger — ensures Vercel regenerates Prisma client with businessType field.
//
// ST-41: The POST handler is now a thin adapter. All business logic lives in
// src/lib/stock-transfer-service.ts (the production controller) and is invoked
// via the Prisma-backed deps adapter (src/lib/stock-transfer-prisma-deps.ts).
// The route only handles: requestId, auth, body parsing, response mapping.
// Tests execute the REAL production controller via mock deps — the same code
// this route runs in production.

// POST /api/stock-transfers - Create a stock transfer (แกะของ/ย้ายสต็อก)
export async function POST(request: NextRequest) {
  // ST-13: Read client request ID for traceability (or generate one if missing).
  const requestId =
    request.headers.get('x-request-id') ||
    `srv-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

  // --- Auth: admin or transfer.create permission (staff allowed by default) ---
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json(
      { error: 'ไม่ได้เข้าสู่ระบบ' },
      { status: 401, headers: { 'X-Request-ID': requestId } }
    );
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json(
      { error: 'token ไม่ถูกต้อง' },
      { status: 401, headers: { 'X-Request-ID': requestId } }
    );
  }
  const hasPermission = payload.role === 'admin' || payload.permissions?.['transfer.create'] === true;
  if (!hasPermission) {
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
    console.error(
      `[ST-13] StockTransfer POST body parse failed | requestId=${requestId} | user=${payload.username} (${payload.userId}) | error=`,
      parseErr
    );
    return NextResponse.json(
      { error: 'รูปแบบ JSON ไม่ถูกต้อง', requestId },
      { status: 400, headers: { 'X-Request-ID': requestId } }
    );
  }

  // --- Call the production service via the Prisma deps adapter ---
  const auth: AuthInfo = {
    userId: payload.userId,
    name: payload.name,
    username: payload.username,
  };
  const deps = createPrismaStockTransferDeps();

  let result: ServiceResult;
  try {
    result = await createStockTransfer(deps, body, auth, requestId);
  } catch (err) {
    // Defensive: the service catches all known errors internally and returns
    // a ServiceResult. Any throw that escapes is unexpected — log + 500.
    console.error(
      `[ST-13] StockTransfer POST unexpected error | requestId=${requestId} | user=${payload.username} (${payload.userId}) | error=`,
      err
    );
    const message = err instanceof Error ? err.message : 'Failed to create stock transfer';
    return NextResponse.json(
      { error: 'บันทึกใบย้ายสต็อกไม่สำเร็จ', details: message, requestId },
      { status: 500, headers: { 'X-Request-ID': requestId } }
    );
  }

  // ST-13: Structured server log for traceability on failures.
  if (!result.ok) {
    console.error(
      `[ST-13] StockTransfer POST failed | requestId=${requestId} | user=${payload.username} (${payload.userId}) | status=${result.status} | code=${result.code ?? '-'} | error=${result.error}`
    );
  }

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
