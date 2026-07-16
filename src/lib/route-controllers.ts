/**
 * ST-10: Thin route controllers — the REAL production authorization + validation
 * path for the 5 ST-10 routes: customers POST, employees POST, bonuses POST,
 * auth/login POST, and users/[id] PATCH (permission update).
 *
 * Why extract these from the route handlers?
 *   - Each route handler is a thin Next.js adapter: parse request → call
 *     controller → map { status, body } to NextResponse. The controller
 *     owns ALL authorization, validation, and DB-access logic.
 *   - Tests import these controllers and call them with mock `deps`. This
 *     proves the REAL production path executes correctly without requiring
 *     a live database, Next.js runtime, or HTTP layer.
 *   - The atomicity contract (permission update + AuditLog in a single
 *     `deps.transaction()` callback) is testable directly — if
 *     `tx.createAuditLog` throws, the transaction rejects and the
 *     controller returns 500 with the rollback message.
 *
 * No `import 'server-only'` here — these controllers are pure functions
 * over injectable deps. They use `auth-core` (no server-only) for crypto
 * and `permissions` (no server-only) for authorization. Safe for tests.
 */

import {
  hasPermission,
  isAdmin,
  normalizePermissions,
  computePermissionDiff,
  buildAdminPermissionMap,
  buildStaffPermissionMap,
  type AuthPayload,
} from './permissions'
import {
  verifyPassword,
  createToken,
  type JWTPayload,
} from './auth-core'

// ============ Shared response type ============

export interface ControllerResult {
  status: number
  body: Record<string, unknown>
  /** Only login returns a token; other controllers omit it. */
  token?: string
}

// ============ 1. customerController (POST /api/customers) ============

export interface CustomerDeps {
  createCustomer: (data: {
    name: string
    phone: string | null
  }) => Promise<unknown>
}

export interface CustomerInput {
  name?: string
  phone?: string
}

/**
 * POST /api/customers controller.
 *
 * Authorization: must have `customer.create` permission (admin implicit).
 * Validation: `name` is required (non-empty after trim).
 * Side effect: calls `deps.createCustomer`.
 */
export async function customerController(
  deps: CustomerDeps,
  input: CustomerInput,
  auth: AuthPayload | null
): Promise<ControllerResult> {
  if (!hasPermission(auth, 'customer.create')) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์สร้างลูกค้า' } }
  }
  const name = (input.name ?? '').trim()
  if (!name) {
    return { status: 400, body: { error: 'Customer name is required' } }
  }
  const phone = input.phone?.trim() || null
  const customer = await deps.createCustomer({ name, phone })
  return { status: 201, body: { customer } }
}

// ============ 2. employeeController (POST /api/employees) ============

export interface EmployeeDeps {
  createEmployee: (data: {
    name: string
    phone: string | null
    hireDate: Date | null
  }) => Promise<unknown>
}

export interface EmployeeInput {
  name?: string
  phone?: string
  hireDate?: string
}

/**
 * POST /api/employees controller.
 *
 * Authorization: admin only (`isAdmin`).
 * Validation: `name` is required (non-empty after trim).
 * Side effect: calls `deps.createEmployee`.
 */
export async function employeeController(
  deps: EmployeeDeps,
  input: EmployeeInput,
  auth: AuthPayload | null
): Promise<ControllerResult> {
  if (!isAdmin(auth)) {
    return { status: 403, body: { error: 'ต้องเป็นผู้ดูแลระบบ' } }
  }
  const name = (input.name ?? '').trim()
  if (!name) {
    return { status: 400, body: { error: 'Employee name is required' } }
  }
  const phone = input.phone?.trim() || null
  const hireDate = input.hireDate ? new Date(input.hireDate) : null
  const employee = await deps.createEmployee({ name, phone, hireDate })
  return { status: 201, body: employee as Record<string, unknown> }
}

// ============ 3. bonusController (POST /api/bonuses) ============

export interface BonusDeps {
  createBonus: (data: {
    date: Date
    employeeId: string
    sortingBillId: string | null
    totalWeight: number
    ratePerKg: number
    totalAmount: number
    note: string | null
  }) => Promise<unknown>
}

export interface BonusInput {
  date: string
  employeeId: string
  sortingBillId?: string
  totalWeight: number
  ratePerKg: number
  totalAmount?: number
  note?: string
}

/**
 * POST /api/bonuses controller.
 *
 * Authorization: admin only (`isAdmin`).
 * Validation:
 *   - `employeeId` is required
 *   - `totalWeight` > 0
 *   - Either `totalAmount` > 0 OR `ratePerKg` > 0 (to compute totalAmount)
 * Side effect: calls `deps.createBonus`.
 */
export async function bonusController(
  deps: BonusDeps,
  input: Partial<BonusInput>,
  auth: AuthPayload | null
): Promise<ControllerResult> {
  if (!isAdmin(auth)) {
    return { status: 403, body: { error: 'ต้องเป็นผู้ดูแลระบบ' } }
  }
  if (!input.employeeId) {
    return { status: 400, body: { error: 'Employee is required' } }
  }
  if (!input.totalWeight || input.totalWeight <= 0) {
    return { status: 400, body: { error: 'Total weight must be greater than 0' } }
  }
  let totalAmount: number
  if (input.totalAmount !== undefined && input.totalAmount > 0) {
    totalAmount = Math.round(input.totalAmount * 100) / 100
  } else if (input.ratePerKg && input.ratePerKg > 0) {
    totalAmount = Math.round(input.totalWeight * input.ratePerKg * 100) / 100
  } else {
    return {
      status: 400,
      body: { error: 'Either totalAmount or ratePerKg must be provided and greater than 0' },
    }
  }
  const bonus = await deps.createBonus({
    date: new Date(input.date as string),
    employeeId: input.employeeId,
    sortingBillId: input.sortingBillId || null,
    totalWeight: input.totalWeight,
    ratePerKg: input.ratePerKg ?? 0,
    totalAmount,
    note: input.note?.trim() || null,
  })
  return { status: 201, body: bonus as Record<string, unknown> }
}

// ============ 4. loginController (POST /api/auth/login) ============

export interface LoginUser {
  id: string
  username: string
  name: string
  role: 'admin' | 'staff'
  password: string
  isActive: boolean
  permissions: string | null
}

export interface LoginDeps {
  findUser: (username: string) => Promise<LoginUser | null>
}

export interface LoginInput {
  username?: string
  password?: string
}

/**
 * POST /api/auth/login controller.
 *
 * Authorization: none (public endpoint).
 * Validation: both `username` and `password` are required.
 * Trust boundary:
 *   - Reads user from `deps.findUser` (DB)
 *   - Verifies password via `verifyPassword` (bcrypt)
 *   - Builds the permission map via `buildAdminPermissionMap` /
 *     `buildStaffPermissionMap` (canonical-only filter — never emits
 *     `user.manage` or any other non-canonical flag)
 *   - Signs the JWT via `createToken` (real `jose` signing)
 *
 * Returns: `{ status: 200, body: { success, token, user }, token }` on
 * success, or `{ status: 401, body: { error } }` on bad credentials,
 * or `{ status: 400, body: { error } }` on missing input.
 */
export async function loginController(
  deps: LoginDeps,
  input: LoginInput
): Promise<ControllerResult> {
  if (!input.username || !input.password) {
    return { status: 400, body: { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' } }
  }
  const user = await deps.findUser(input.username)
  if (!user || !user.isActive) {
    return { status: 401, body: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } }
  }
  const valid = await verifyPassword(input.password, user.password)
  if (!valid) {
    return { status: 401, body: { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' } }
  }
  // ST-10: Build the permission map via the shared canonical builders.
  //   - admin  → buildAdminPermissionMap (every canonical perm = true;
  //              user.manage is NEVER included)
  //   - staff  → buildStaffPermissionMap (only canonical perms from DB)
  const permissions =
    user.role === 'admin'
      ? buildAdminPermissionMap()
      : buildStaffPermissionMap(user.permissions)

  const jwtPayload: JWTPayload = {
    userId: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    permissions,
  }
  const token = await createToken(jwtPayload)

  return {
    status: 200,
    body: {
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        permissions,
      },
    },
    token,
  }
}

// ============ 5. permissionUpdateController (PATCH /api/users/[id]) ============

export interface PermissionUpdateUser {
  id: string
  username: string
  name: string
  role: string
  isActive: boolean
  permissions: string | null
}

export interface PermissionUpdateTarget {
  permissions: string | null
  username: string
  name: string
  role: string
}

/** Transaction handle passed to the controller's `deps.transaction` callback. */
export interface PermissionUpdateTx {
  updateUser: (
    id: string,
    data: { permissions: string | null }
  ) => Promise<PermissionUpdateUser>
  createAuditLog: (data: {
    action: string
    entityType: string
    entityId: string
    userId: string
    userName: string
    details: string
  }) => Promise<void>
}

export interface PermissionUpdateDeps {
  findUser: (id: string) => Promise<PermissionUpdateTarget | null>
  transaction: <T>(fn: (tx: PermissionUpdateTx) => Promise<T>) => Promise<T>
}

export interface PermissionUpdateInput {
  permissions: unknown
}

/**
 * PATCH /api/users/[id] (permissions only) controller.
 *
 * Authorization: admin only (`isAdmin`).
 * Self-protection: admin cannot change own permissions.
 * Validation: `permissions` must be an array; non-canonical entries are
 * filtered out via `normalizePermissions`.
 * Atomicity: `tx.updateUser` + `tx.createAuditLog` BOTH run inside
 * `deps.transaction`. If `tx.createAuditLog` throws, the entire
 * transaction rejects and the user's permissions are NOT committed
 * (Prisma's interactive transaction rolls back). The controller returns
 * 500 with a Thai rollback message.
 */
export async function permissionUpdateController(
  deps: PermissionUpdateDeps,
  input: PermissionUpdateInput,
  auth: AuthPayload | null,
  targetUserId: string
): Promise<ControllerResult> {
  if (!isAdmin(auth)) {
    return { status: 403, body: { error: 'ไม่มีสิทธิ์เข้าถึง' } }
  }
  // Admin cannot change own permissions (prevent self-escalation / self-lockout).
  if (auth!.userId === targetUserId) {
    return { status: 400, body: { error: 'ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้' } }
  }
  if (!Array.isArray(input.permissions)) {
    return { status: 400, body: { error: 'permissions ต้องเป็น array' } }
  }
  // Normalize: filter to canonical + deduplicate (shared module).
  const permissionsAfter = normalizePermissions(input.permissions)
  // Read current user for before/after diff + role check.
  const currentUser = await deps.findUser(targetUserId)
  if (!currentUser) {
    return { status: 404, body: { error: 'ไม่พบผู้ใช้' } }
  }
  let permissionsBefore: string[]
  try {
    permissionsBefore = currentUser.permissions ? JSON.parse(currentUser.permissions) : []
  } catch {
    permissionsBefore = []
  }
  const diff = computePermissionDiff(permissionsBefore, permissionsAfter)
  // Admin role doesn't need stored permissions (gets all implicitly at login).
  const permissionsData =
    currentUser.role === 'admin' ? null : JSON.stringify(permissionsAfter)
  try {
    const updated = await deps.transaction(async (tx) => {
      const user = await tx.updateUser(targetUserId, { permissions: permissionsData })
      // AuditLog — if this throws, the entire transaction rejects (atomic rollback).
      await tx.createAuditLog({
        action: 'UPDATE',
        entityType: 'USER_PERMISSION',
        entityId: targetUserId,
        userId: auth!.userId,
        userName: auth!.name,
        details: JSON.stringify({
          type: 'PERMISSION_CHANGE',
          targetUserId,
          targetUsername: user.username,
          permissionsBefore,
          permissionsAfter,
          permissionsAdded: diff.added,
          permissionsRemoved: diff.removed,
          changedBy: auth!.username,
          actorUserId: auth!.userId,
          actorUserName: auth!.name,
        }),
      })
      return user
    })
    return {
      status: 200,
      body: {
        success: true,
        user: {
          ...updated,
          permissions: updated.permissions ? JSON.parse(updated.permissions) : [],
        },
      },
    }
  } catch (err) {
    // ST-10: AuditLog (or user.update) threw → transaction rolled back.
    // Permission change is NOT committed. Return 500 with rollback message.
    console.error('ST-10: Atomic permission update + AuditLog failed:', err)
    return {
      status: 500,
      body: {
        error: 'เกิดข้อผิดพลาดในการบันทึกสิทธิ์ — การเปลี่ยนแปลงถูกย้อนกลับ',
      },
    }
  }
}
