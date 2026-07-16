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
