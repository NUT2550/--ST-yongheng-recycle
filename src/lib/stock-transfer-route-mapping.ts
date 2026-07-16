/**
 * ST-41: HTTP-layer mapping from ServiceResult → NextResponse.
 *
 * Extracted from the POST /api/stock-transfers route so it can be unit-tested
 * without transitively importing `server-only` (via @/lib/auth). The route
 * imports + uses this; tests import + exercise it directly.
 */

import { NextResponse } from 'next/server';
import type { ServiceResult } from './stock-transfer-service';

/**
 * Map a ServiceResult from createStockTransfer() to a NextResponse.
 *
 *   - ok:true  → 201 with `{ bill: result.transfer }` + X-Request-ID header
 *   - ok:false → status (400/404/409/500/503) with `{ error, code?, ...extras, requestId }`
 *               + X-Request-ID header
 */
export function mapServiceResultToResponse(
  result: ServiceResult,
  requestId: string
): NextResponse {
  if (result.ok) {
    return NextResponse.json(
      { bill: result.transfer },
      { status: 201, headers: { 'X-Request-ID': requestId } }
    );
  }
  const body: Record<string, unknown> = { error: result.error };
  if (result.code) body.code = result.code;
  if (result.extras) Object.assign(body, result.extras);
  body.requestId = requestId;
  return NextResponse.json(
    body,
    { status: result.status, headers: { 'X-Request-ID': requestId } }
  );
}
