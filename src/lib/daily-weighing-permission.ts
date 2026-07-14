/**
 * ST-35: Production authorization helper for daily purchase weighing.
 *
 * Used by all daily-weighing API routes AND tests — single source of truth.
 */

export interface AuthPayload {
  role: string;
  permissions?: Record<string, boolean>;
}

/**
 * Check if the authenticated user has permission to use daily purchase weighing.
 *
 * Admin: implicit access (all permissions)
 * Staff: needs explicit `dailyPurchaseWeighing` permission
 */
export function hasDailyPurchaseWeighingPermission(payload: AuthPayload): boolean {
  if (payload.role === 'admin') return true;
  return payload.permissions?.['dailyPurchaseWeighing'] === true;
}
