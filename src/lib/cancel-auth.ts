/**
 * ST-71: Shared 401/403 auth helper for bill cancellation/edit routes.
 *
 * All bill cancel/edit routes (Buy, Sell, Sorting, Transfer) require the
 * `history.edit` permission. This helper enforces a consistent contract:
 *
 * - No token / invalid token → 401 AUTH_REQUIRED
 * - Valid token but missing permission → 403 PERMISSION_DENIED
 * - Valid authorized user → returns payload
 *
 * This was first implemented in ST-70 for Sorting cancel (`resolveAuth` in
 * `sorting-bills/[id]/route.ts`). ST-71 extends the same contract to Buy,
 * Sell, and Transfer cancel/edit routes, and extracts this shared helper
 * so all four routes use identical auth behavior.
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, getTokenFromRequest } from './auth-core'

export type CancelAuthResult =
  | { ok: true; payload: { userId: string; name: string; role: string; permissions?: Record<string, boolean> } }
  | { ok: false; status: 401; code: 'AUTH_REQUIRED'; error: string }
  | { ok: false; status: 403; code: 'PERMISSION_DENIED'; error: string }

/**
 * Resolve authentication and `history.edit` permission for a request.
 *
 * Returns a discriminated union:
 * - `{ ok: true, payload }` — proceed with the request
 * - `{ ok: false, status: 401, code: 'AUTH_REQUIRED', error }` — no/invalid token
 * - `{ ok: false, status: 403, code: 'PERMISSION_DENIED', error }` — valid token, no permission
 */
export async function resolveHistoryEditAuth(request: NextRequest): Promise<CancelAuthResult> {
  const token = getTokenFromRequest(request)
  if (!token) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', error: 'ไม่ได้เข้าสู่ระบบ' }
  }
  const payload = await verifyToken(token)
  if (!payload) {
    return { ok: false, status: 401, code: 'AUTH_REQUIRED', error: 'token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่' }
  }
  const hasPermission = payload.role === 'admin' || payload.permissions?.['history.edit'] === true
  if (!hasPermission) {
    return { ok: false, status: 403, code: 'PERMISSION_DENIED', error: 'ไม่มีสิทธิ์ — ต้องการสิทธิ์ history.edit' }
  }
  return { ok: true, payload }
}

/**
 * Convert a failed auth result into a NextResponse JSON.
 */
export function authFailedResponse(result: { status: number; code: string; error: string }) {
  return NextResponse.json({ error: result.error, code: result.code }, { status: result.status })
}
