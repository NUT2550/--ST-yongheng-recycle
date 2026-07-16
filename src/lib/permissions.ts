/**
 * ST-10: Structured permission system helpers.
 *
 * The permission system is backed by:
 *   - User.role: 'admin' | 'staff' (admin gets all permissions implicitly)
 *   - User.permissions: JSON string array of canonical permission strings (staff only)
 *   - JWT: permissions embedded as Record<string, boolean> at login time
 *
 * Canonical permission names (single source of truth — used by login route,
 * users management API, and all route authorization checks):
 *   customer.create, buy.create, sell.create, sort.create, transfer.create,
 *   history.edit, physical-count.apply, dailyPurchaseWeighing, product.manage
 *
 * Note: user management (PATCH /api/users/[id]) is admin-only via role check,
 * not a staff-grantable permission. 'user.manage' is intentionally NOT in this list.
 *
 * Token strategy:
 *   - JWT expires after 7 days (setExpirationTime('7d')).
 *   - Permissions are embedded at login from trusted DB state.
 *   - No token version/security stamp — revoked permissions take effect on
 *     next login (within 7 days). Admin must instruct staff to re-login after
 *     permission changes. The users-page UI shows this warning.
 *
 * Pure functions — no DB, no side effects. Used by routes AND tests.
 */

export const CANONICAL_PERMISSIONS = [
  'customer.create',
  'buy.create',
  'sell.create',
  'sort.create',
  'transfer.create',
  'history.edit',
  'physical-count.apply',
  'dailyPurchaseWeighing',
  'product.manage',
] as const

export type CanonicalPermission = (typeof CANONICAL_PERMISSIONS)[number]

export const PERMISSION_LABELS: Record<string, string> = {
  'customer.create': 'สร้างลูกค้า',
  'buy.create': 'สร้างใบรับซื้อ',
  'sell.create': 'สร้างใบขาย',
  'sort.create': 'สร้างใบคัดแยก',
  'transfer.create': 'สร้างใบย้ายสต็อก',
  'history.edit': 'แก้ไข/ยกเลิกบิลในประวัติ',
  'physical-count.apply': 'Apply การชั่งสต็อกจริง (Legacy)',
  'dailyPurchaseWeighing': 'ชั่งยอดซื้อทองแดง/ทองเหลือง',
  'product.manage': 'จัดการสินค้า',
}

export interface AuthPayload {
  userId: string
  username: string
  name: string
  role: 'admin' | 'staff'
  permissions?: Record<string, boolean>
}

/**
 * Check if the authenticated user has a specific permission.
 * Admin has all permissions implicitly. Staff must have the permission
 * explicitly set in their JWT permissions map.
 *
 * Pure function — used by all route authorization checks.
 */
export function hasPermission(
  payload: AuthPayload | null,
  permission: string
): boolean {
  if (!payload) return false
  if (payload.role === 'admin') return true
  return payload.permissions?.[permission] === true
}

/**
 * Check if the user is an admin.
 */
export function isAdmin(payload: AuthPayload | null): boolean {
  return payload?.role === 'admin'
}

/**
 * Validate that a permission string is a canonical permission name.
 */
export function isValidPermission(permission: string): permission is CanonicalPermission {
  return (CANONICAL_PERMISSIONS as readonly string[]).includes(permission)
}

/**
 * Filter an array of permission strings to only canonical ones.
 * Used when saving user permissions — prevents arbitrary/invalid permission
 * strings from being stored.
 */
export function filterValidPermissions(permissions: unknown[]): string[] {
  const validSet = new Set<string>(CANONICAL_PERMISSIONS)
  return permissions.filter((p): p is string => typeof p === 'string' && validSet.has(p))
}

/**
 * Normalize a permissions array: filter to valid, deduplicate.
 */
export function normalizePermissions(permissions: unknown[]): string[] {
  const filtered = filterValidPermissions(permissions)
  return Array.from(new Set(filtered))
}

/**
 * Compute the diff between two permission arrays (for AuditLog).
 */
export function computePermissionDiff(
  before: string[],
  after: string[]
): { added: string[]; removed: string[] } {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  return {
    added: after.filter((p) => !beforeSet.has(p)),
    removed: before.filter((p) => !afterSet.has(p)),
  }
}

/**
 * ST-10: Build the admin permission map (every canonical permission = true).
 *
 * Admin role gets all canonical permissions implicitly at login time. The
 * map is embedded into the JWT so that downstream route handlers using
 * `hasPermission(payload, perm)` succeed uniformly for admins.
 *
 * NOTE: 'user.manage' is intentionally NOT in this map. User management
 * (PATCH /api/users/[id]) is admin-only via the `isAdmin()` role check, NOT
 * a permission flag. Removing 'user.manage' from JWTs eliminates the
 * stale-permission-flag attack surface — even a tampered or stale JWT
 * cannot grant user-management rights because the flag is never emitted.
 *
 * Pure function — used by the login route AND the loginController tests.
 */
export function buildAdminPermissionMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  for (const perm of CANONICAL_PERMISSIONS) {
    map[perm] = true
  }
  return map
}

/**
 * ST-10: Build the staff permission map from the stored DB JSON string.
 *
 * Staff role gets ONLY the permissions explicitly stored in `user.permissions`
 * (a JSON array of canonical permission strings). Anything that isn't a
 * canonical permission string is silently dropped via `filterValidPermissions`
 * — this is the trust boundary that prevents forged / stale / typo'd
 * permission strings from being embedded in the JWT.
 *
 * Pure function — used by the login route AND the loginController tests.
 *
 * @param storedPermissions  The raw `user.permissions` column value
 *                           (JSON string array) — may be null or invalid JSON.
 */
export function buildStaffPermissionMap(
  storedPermissions: string | null
): Record<string, boolean> {
  const map: Record<string, boolean> = {}
  if (!storedPermissions) return map
  let parsed: unknown
  try {
    parsed = JSON.parse(storedPermissions)
  } catch {
    return map
  }
  if (!Array.isArray(parsed)) return map
  for (const p of filterValidPermissions(parsed)) {
    map[p] = true
  }
  return map
}
