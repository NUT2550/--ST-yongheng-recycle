/**
 * ST-10: Real production-path controller tests.
 *
 * These tests invoke the REAL production controllers from
 * `src/lib/route-controllers.ts` — the exact functions the route handlers
 * call. No source inspection. No boolean assertions. No mock route
 * handlers.
 *
 * Controllers tested:
 *   - customerController   (POST /api/customers)
 *   - employeeController   (POST /api/employees)
 *   - bonusController      (POST /api/bonuses)
 *   - loginController      (POST /api/auth/login)
 *   - permissionUpdateController (PATCH /api/users/[id])
 *
 * Each controller is invoked with mock `deps` so we can verify:
 *   - authorization gates (hasPermission / isAdmin)
 *   - input validation
 *   - DB-side effect calls (deps.createCustomer, deps.createEmployee, etc.)
 *   - atomic transaction contract (deps.transaction + throwing auditLog → 500)
 *
 * Run: bun test tests/st10-controllers.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  customerController,
  employeeController,
  bonusController,
  loginController,
  permissionUpdateController,
  type CustomerDeps,
  type EmployeeDeps,
  type BonusDeps,
  type LoginDeps,
  type LoginUser,
  type PermissionUpdateDeps,
  type PermissionUpdateTx,
  type PermissionUpdateUser,
  type PermissionUpdateTarget,
} from '../src/lib/route-controllers';
import { verifyToken, type JWTPayload } from '../src/lib/auth-core';
import { CANONICAL_PERMISSIONS, hasPermission } from '../src/lib/permissions';

// ============ Shared fixtures ============

const ADMIN: JWTPayload = {
  userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin',
};
const STAFF_WITH_CUSTOMER_CREATE: JWTPayload = {
  userId: 'staff-1', username: 'staff1', name: 'Staff', role: 'staff',
  permissions: { 'customer.create': true },
};
const STAFF_NO_PERMS: JWTPayload = {
  userId: 'staff-2', username: 'staff2', name: 'Staff 2', role: 'staff',
  permissions: {},
};

// ============ 1. customerController ============

describe('ST-10 controllers: customerController', () => {
  test('1. staff with customer.create → 201 + createCustomer called', async () => {
    const calls: Array<{ name: string; phone: string | null }> = [];
    const deps: CustomerDeps = {
      createCustomer: async (data) => {
        calls.push(data);
        return { id: 'c-1', ...data };
      },
    };
    const result = await customerController(
      deps,
      { name: '  Acme  ', phone: '  081-123-4567  ' },
      STAFF_WITH_CUSTOMER_CREATE
    );
    expect(result.status).toBe(201);
    expect(result.body.customer).toEqual({ id: 'c-1', name: 'Acme', phone: '081-123-4567' });
    expect(calls).toEqual([{ name: 'Acme', phone: '081-123-4567' }]);
  });

  test('2. admin → 201 (implicit customer.create)', async () => {
    const deps: CustomerDeps = { createCustomer: async (data) => ({ id: 'c-1', ...data }) };
    const result = await customerController(deps, { name: 'Acme' }, ADMIN);
    expect(result.status).toBe(201);
    expect(result.body.customer).toBeDefined();
  });

  test('3. staff without customer.create → 403 + NO createCustomer call', async () => {
    let called = false;
    const deps: CustomerDeps = {
      createCustomer: async () => { called = true; return {}; },
    };
    const result = await customerController(
      deps,
      { name: 'Acme' },
      STAFF_NO_PERMS
    );
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('ไม่มีสิทธิ์สร้างลูกค้า');
    expect(called).toBe(false);
  });

  test('4. null auth → 403', async () => {
    const deps: CustomerDeps = { createCustomer: async () => ({}) };
    const result = await customerController(deps, { name: 'Acme' }, null);
    expect(result.status).toBe(403);
  });

  test('5. empty name → 400 + NO createCustomer call', async () => {
    let called = false;
    const deps: CustomerDeps = {
      createCustomer: async () => { called = true; return {}; },
    };
    const result = await customerController(
      deps,
      { name: '   ', phone: '' },
      STAFF_WITH_CUSTOMER_CREATE
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Customer name is required');
    expect(called).toBe(false);
  });

  test('6. missing name field → 400', async () => {
    const deps: CustomerDeps = { createCustomer: async () => ({}) };
    const result = await customerController(deps, {}, STAFF_WITH_CUSTOMER_CREATE);
    expect(result.status).toBe(400);
  });

  test('7. null phone → stored as null', async () => {
    const calls: Array<{ name: string; phone: string | null }> = [];
    const deps: CustomerDeps = {
      createCustomer: async (data) => { calls.push(data); return { id: 'c-1', ...data }; },
    };
    const result = await customerController(
      deps,
      { name: 'Acme', phone: undefined },
      STAFF_WITH_CUSTOMER_CREATE
    );
    expect(result.status).toBe(201);
    expect(calls[0].phone).toBeNull();
  });
});

// ============ 2. employeeController ============

describe('ST-10 controllers: employeeController', () => {
  test('8. admin → 201 + createEmployee called with Date', async () => {
    const calls: Array<{ name: string; phone: string | null; hireDate: Date | null }> = [];
    const deps: EmployeeDeps = {
      createEmployee: async (data) => { calls.push(data); return { id: 'e-1', ...data }; },
    };
    const result = await employeeController(
      deps,
      { name: 'Somchai', phone: '081', hireDate: '2026-01-15' },
      ADMIN
    );
    expect(result.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('Somchai');
    expect(calls[0].phone).toBe('081');
    expect(calls[0].hireDate).toBeInstanceOf(Date);
  });

  test('9. staff → 403 + NO createEmployee call', async () => {
    let called = false;
    const deps: EmployeeDeps = {
      createEmployee: async () => { called = true; return {}; },
    };
    const result = await employeeController(
      deps,
      { name: 'Somchai' },
      STAFF_WITH_CUSTOMER_CREATE
    );
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('ต้องเป็นผู้ดูแลระบบ');
    expect(called).toBe(false);
  });

  test('10. null auth → 403', async () => {
    const deps: EmployeeDeps = { createEmployee: async () => ({}) };
    const result = await employeeController(deps, { name: 'X' }, null);
    expect(result.status).toBe(403);
  });

  test('11. empty name → 400', async () => {
    const deps: EmployeeDeps = { createEmployee: async () => ({}) };
    const result = await employeeController(deps, { name: '' }, ADMIN);
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Employee name is required');
  });

  test('12. no hireDate → hireDate null', async () => {
    const calls: Array<{ hireDate: Date | null }> = [];
    const deps: EmployeeDeps = {
      createEmployee: async (data) => { calls.push(data); return { id: 'e-1', ...data }; },
    };
    const result = await employeeController(deps, { name: 'X' }, ADMIN);
    expect(result.status).toBe(201);
    expect(calls[0].hireDate).toBeNull();
  });
});

// ============ 3. bonusController ============

describe('ST-10 controllers: bonusController', () => {
  test('13. admin with totalAmount → 201 + createBonus called', async () => {
    const calls: Array<{ totalAmount: number; totalWeight: number; ratePerKg: number }> = [];
    const deps: BonusDeps = {
      createBonus: async (data) => { calls.push(data); return { id: 'b-1', ...data }; },
    };
    const result = await bonusController(
      deps,
      {
        date: '2026-07-11', employeeId: 'e-1', totalWeight: 10,
        ratePerKg: 50, totalAmount: 600,
      },
      ADMIN
    );
    expect(result.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].totalAmount).toBe(600);
    expect(calls[0].totalWeight).toBe(10);
    expect(calls[0].ratePerKg).toBe(50);
  });

  test('14. admin without totalAmount but with ratePerKg → computes totalAmount', async () => {
    const calls: Array<{ totalAmount: number }> = [];
    const deps: BonusDeps = {
      createBonus: async (data) => { calls.push(data); return { id: 'b-1', ...data }; },
    };
    const result = await bonusController(
      deps,
      { date: '2026-07-11', employeeId: 'e-1', totalWeight: 10, ratePerKg: 50 },
      ADMIN
    );
    expect(result.status).toBe(201);
    expect(calls[0].totalAmount).toBe(500);
  });

  test('15. staff → 403 + NO createBonus call', async () => {
    let called = false;
    const deps: BonusDeps = {
      createBonus: async () => { called = true; return {}; },
    };
    const result = await bonusController(
      deps,
      { date: '2026-07-11', employeeId: 'e-1', totalWeight: 10, ratePerKg: 50 },
      STAFF_WITH_CUSTOMER_CREATE
    );
    expect(result.status).toBe(403);
    expect(result.body.error).toBe('ต้องเป็นผู้ดูแลระบบ');
    expect(called).toBe(false);
  });

  test('16. null auth → 403', async () => {
    const deps: BonusDeps = { createBonus: async () => ({}) };
    const result = await bonusController(
      deps,
      { date: '2026-07-11', employeeId: 'e-1', totalWeight: 10, ratePerKg: 50 },
      null
    );
    expect(result.status).toBe(403);
  });

  test('17. missing employeeId → 400', async () => {
    const deps: BonusDeps = { createBonus: async () => ({}) };
    const result = await bonusController(
      deps,
      { date: '2026-07-11', totalWeight: 10, ratePerKg: 50 },
      ADMIN
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Employee is required');
  });

  test('18. totalWeight <= 0 → 400', async () => {
    const deps: BonusDeps = { createBonus: async () => ({}) };
    const result = await bonusController(
      deps,
      { date: '2026-07-11', employeeId: 'e-1', totalWeight: 0, ratePerKg: 50 },
      ADMIN
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('Total weight must be greater than 0');
  });

  test('19. no totalAmount and no ratePerKg → 400', async () => {
    const deps: BonusDeps = { createBonus: async () => ({}) };
    const result = await bonusController(
      deps,
      { date: '2026-07-11', employeeId: 'e-1', totalWeight: 10, ratePerKg: 0 },
      ADMIN
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toContain('Either totalAmount or ratePerKg');
  });
});

// ============ 4. loginController ============

describe('ST-10 controllers: loginController', () => {
  test('20. admin login → JWT contains admin permission map (NO user.manage)', async () => {
    // Hash a real password for the mock user.
    const { hashPassword } = await import('../src/lib/auth-core');
    const adminUser: LoginUser = {
      id: 'admin-1', username: 'admin', name: 'Admin', role: 'admin',
      password: await hashPassword('secret123'), isActive: true,
      permissions: null,
    };
    const deps: LoginDeps = { findUser: async () => adminUser };
    const result = await loginController(deps, { username: 'admin', password: 'secret123' });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.token).toBeDefined();
    // Verify the JWT — permissions map must be the admin canonical set.
    const verified = await verifyToken(result.token!);
    expect(verified).not.toBeNull();
    expect(verified!.role).toBe('admin');
    for (const perm of CANONICAL_PERMISSIONS) {
      expect(verified!.permissions?.[perm]).toBe(true);
    }
    // CRITICAL: user.manage must NEVER appear in any JWT.
    expect(verified!.permissions?.['user.manage']).toBeUndefined();
  });

  test('21. staff login → JWT contains ONLY stored permissions (canonical filter)', async () => {
    const { hashPassword } = await import('../src/lib/auth-core');
    const staffUser: LoginUser = {
      id: 'staff-1', username: 'staff1', name: 'Staff', role: 'staff',
      password: await hashPassword('pw'), isActive: true,
      // DB contains a mix of valid + invalid permission strings.
      permissions: JSON.stringify(['customer.create', 'buy.create', 'hack.the.server']),
    };
    const deps: LoginDeps = { findUser: async () => staffUser };
    const result = await loginController(deps, { username: 'staff1', password: 'pw' });
    expect(result.status).toBe(200);
    const verified = await verifyToken(result.token!);
    expect(verified!.permissions?.['customer.create']).toBe(true);
    expect(verified!.permissions?.['buy.create']).toBe(true);
    // Invalid permission string filtered out by buildStaffPermissionMap.
    expect(verified!.permissions?.['hack.the.server']).toBeUndefined();
    // user.manage filtered out (not canonical).
    expect(verified!.permissions?.['user.manage']).toBeUndefined();
  });

  test('22. staff with null permissions → empty map (still logs in)', async () => {
    const { hashPassword } = await import('../src/lib/auth-core');
    const staffUser: LoginUser = {
      id: 'staff-2', username: 'staff2', name: 'Staff 2', role: 'staff',
      password: await hashPassword('pw'), isActive: true,
      permissions: null,
    };
    const deps: LoginDeps = { findUser: async () => staffUser };
    const result = await loginController(deps, { username: 'staff2', password: 'pw' });
    expect(result.status).toBe(200);
    const verified = await verifyToken(result.token!);
    expect(verified!.role).toBe('staff');
    expect(hasPermission(verified, 'customer.create')).toBe(false);
  });

  test('23. staff with invalid JSON permissions → empty map (graceful fallback)', async () => {
    const { hashPassword } = await import('../src/lib/auth-core');
    const staffUser: LoginUser = {
      id: 'staff-3', username: 'staff3', name: 'Staff 3', role: 'staff',
      password: await hashPassword('pw'), isActive: true,
      permissions: '{this is not json',
    };
    const deps: LoginDeps = { findUser: async () => staffUser };
    const result = await loginController(deps, { username: 'staff3', password: 'pw' });
    expect(result.status).toBe(200);
    const verified = await verifyToken(result.token!);
    expect(verified!.permissions).toEqual({});
  });

  test('24. wrong password → 401', async () => {
    const { hashPassword } = await import('../src/lib/auth-core');
    const user: LoginUser = {
      id: 'u-1', username: 'u', name: 'U', role: 'admin',
      password: await hashPassword('correct'), isActive: true, permissions: null,
    };
    const deps: LoginDeps = { findUser: async () => user };
    const result = await loginController(deps, { username: 'u', password: 'wrong' });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    expect(result.token).toBeUndefined();
  });

  test('25. user not found → 401 (same message — no user enumeration)', async () => {
    const deps: LoginDeps = { findUser: async () => null };
    const result = await loginController(deps, { username: 'ghost', password: 'whatever' });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  });

  test('26. inactive user → 401 (even with correct password)', async () => {
    const { hashPassword } = await import('../src/lib/auth-core');
    const user: LoginUser = {
      id: 'u-2', username: 'inactive', name: 'Inactive', role: 'staff',
      password: await hashPassword('pw'), isActive: false, permissions: null,
    };
    const deps: LoginDeps = { findUser: async () => user };
    const result = await loginController(deps, { username: 'inactive', password: 'pw' });
    expect(result.status).toBe(401);
  });

  test('27. missing username → 400', async () => {
    const deps: LoginDeps = { findUser: async () => null };
    const result = await loginController(deps, { password: 'pw' });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');
  });

  test('28. missing password → 400', async () => {
    const deps: LoginDeps = { findUser: async () => null };
    const result = await loginController(deps, { username: 'u' });
    expect(result.status).toBe(400);
  });
});

// ============ 5. permissionUpdateController (atomic contract) ============

describe('ST-10 controllers: permissionUpdateController atomic contract', () => {
  const ADMIN_AUTH: JWTPayload = {
    userId: 'admin-1', username: 'admin', name: 'Admin', role: 'admin',
  };

  test('29. happy path: 200 + tx.updateUser + tx.createAuditLog both called', async () => {
    const updateCalls: string[] = [];
    const auditCalls: Array<{ entityId: string; userId: string; details: string }> = [];
    const updated: PermissionUpdateUser = {
      id: 'staff-1', username: 'staff1', name: 'Staff', role: 'staff',
      isActive: true, permissions: JSON.stringify(['customer.create']),
    };
    const target: PermissionUpdateTarget = {
      permissions: null, username: 'staff1', name: 'Staff', role: 'staff',
    };
    const deps: PermissionUpdateDeps = {
      findUser: async () => target,
      transaction: async (fn) => {
        const tx: PermissionUpdateTx = {
          updateUser: async (id) => { updateCalls.push(id); return updated; },
          createAuditLog: async (d) => { auditCalls.push({ entityId: d.entityId, userId: d.userId, details: d.details }); },
        };
        return fn(tx);
      },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create'] },
      ADMIN_AUTH,
      'staff-1'
    );
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(updateCalls).toEqual(['staff-1']);
    expect(auditCalls).toHaveLength(1);
    expect(auditCalls[0].entityId).toBe('staff-1');
    expect(auditCalls[0].userId).toBe('admin-1');
    const details = JSON.parse(auditCalls[0].details);
    expect(details.permissionsAfter).toEqual(['customer.create']);
    expect(details.permissionsBefore).toEqual([]);
    expect(details.permissionsAdded).toEqual(['customer.create']);
  });

  test('30. ATOMIC ROLLBACK: throwing tx.createAuditLog → 500 + rollback message + user.update attempted but not committed', async () => {
    const updateCalls: string[] = [];
    const auditAttempts: number[] = [];
    const target: PermissionUpdateTarget = {
      permissions: JSON.stringify(['buy.create']),
      username: 'staff1', name: 'Staff', role: 'staff',
    };
    const deps: PermissionUpdateDeps = {
      findUser: async () => target,
      transaction: async (fn) => {
        const tx: PermissionUpdateTx = {
          updateUser: async (id) => {
            updateCalls.push(id);
            return {
              id, username: 'staff1', name: 'Staff', role: 'staff',
              isActive: true, permissions: JSON.stringify(['customer.create']),
            };
          },
          // SIMULATE AuditLog failure — Prisma's $transaction will reject
          // the entire callback → user.update is rolled back at the DB level.
          createAuditLog: async () => {
            auditAttempts.push(1);
            throw new Error('AuditLog DB connection lost');
          },
        };
        return fn(tx);
      },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create'] },
      ADMIN_AUTH,
      'staff-1'
    );
    // Controller MUST return 500 with the rollback message (not 200).
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('เกิดข้อผิดพลาดในการบันทึกสิทธิ์ — การเปลี่ยนแปลงถูกย้อนกลับ');
    // tx.updateUser was attempted (controller did try to commit)...
    expect(updateCalls).toEqual(['staff-1']);
    // ...but tx.createAuditLog threw, rejecting the transaction.
    expect(auditAttempts).toHaveLength(1);
    // No success body — the API consumer sees the rollback.
    expect(result.body.success).toBeUndefined();
  });

  test('31. throwing tx.updateUser → 500 + rollback message + NO auditLog call', async () => {
    const auditAttempts: number[] = [];
    const target: PermissionUpdateTarget = {
      permissions: null, username: 'staff1', name: 'Staff', role: 'staff',
    };
    const deps: PermissionUpdateDeps = {
      findUser: async () => target,
      transaction: async (fn) => {
        const tx: PermissionUpdateTx = {
          updateUser: async () => { throw new Error('user.update constraint violation'); },
          createAuditLog: async () => { auditAttempts.push(1); },
        };
        return fn(tx);
      },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create'] },
      ADMIN_AUTH,
      'staff-1'
    );
    expect(result.status).toBe(500);
    expect(result.body.error).toBe('เกิดข้อผิดพลาดในการบันทึกสิทธิ์ — การเปลี่ยนแปลงถูกย้อนกลับ');
    // tx.updateUser threw before tx.createAuditLog was reached.
    expect(auditAttempts).toHaveLength(0);
  });

  test('32. non-admin auth → 403 + NO findUser + NO transaction', async () => {
    const findUserCalls: string[] = [];
    const transactionCalls: number[] = [];
    const deps: PermissionUpdateDeps = {
      findUser: async (id) => { findUserCalls.push(id); return null; },
      transaction: async (fn) => {
        transactionCalls.push(1);
        return fn({
          updateUser: async () => { throw new Error('should not be called'); },
          createAuditLog: async () => { throw new Error('should not be called'); },
        });
      },
    };
    const staff: JWTPayload = {
      userId: 'staff-1', username: 'staff1', name: 'Staff', role: 'staff',
      permissions: { 'customer.create': true },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create'] },
      staff,
      'staff-2'
    );
    expect(result.status).toBe(403);
    expect(findUserCalls).toHaveLength(0);
    expect(transactionCalls).toHaveLength(0);
  });

  test('33. admin targeting self → 400 (cannot change own permissions)', async () => {
    const deps: PermissionUpdateDeps = {
      findUser: async () => { throw new Error('should not be called'); },
      transaction: async () => { throw new Error('should not be called'); },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create'] },
      ADMIN_AUTH,
      'admin-1' // same as ADMIN_AUTH.userId
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้');
  });

  test('34. permissions not an array → 400', async () => {
    const deps: PermissionUpdateDeps = {
      findUser: async () => null,
      transaction: async () => { throw new Error('should not be called'); },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: 'not-an-array' },
      ADMIN_AUTH,
      'staff-1'
    );
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('permissions ต้องเป็น array');
  });

  test('35. target user not found → 404', async () => {
    const deps: PermissionUpdateDeps = {
      findUser: async () => null,
      transaction: async () => { throw new Error('should not be called'); },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create'] },
      ADMIN_AUTH,
      'ghost-user'
    );
    expect(result.status).toBe(404);
    expect(result.body.error).toBe('ไม่พบผู้ใช้');
  });

  test('36. invalid permissions filtered out by normalizePermissions', async () => {
    const updateCalls: Array<{ data: { permissions: string | null } }> = [];
    const target: PermissionUpdateTarget = {
      permissions: null, username: 'staff1', name: 'Staff', role: 'staff',
    };
    const deps: PermissionUpdateDeps = {
      findUser: async () => target,
      transaction: async (fn) => {
        const tx: PermissionUpdateTx = {
          updateUser: async (_id, data) => {
            updateCalls.push({ data });
            return {
              id: 'staff-1', username: 'staff1', name: 'Staff', role: 'staff',
              isActive: true, permissions: data.permissions,
            };
          },
          createAuditLog: async () => {},
        };
        return fn(tx);
      },
    };
    const result = await permissionUpdateController(
      deps,
      // Mix of valid + invalid + duplicate
      { permissions: ['customer.create', 'customer.create', 'hack.the.server', 'buy.create'] },
      ADMIN_AUTH,
      'staff-1'
    );
    expect(result.status).toBe(200);
    // Only canonical + deduplicated permissions stored.
    expect(updateCalls[0].data.permissions).toBe(JSON.stringify(['customer.create', 'buy.create']));
  });

  test('37. admin target → permissions stored as null (admin has all implicitly)', async () => {
    const updateCalls: Array<{ data: { permissions: string | null } }> = [];
    const target: PermissionUpdateTarget = {
      permissions: JSON.stringify(['customer.create']),
      username: 'admin2', name: 'Admin 2', role: 'admin',
    };
    const deps: PermissionUpdateDeps = {
      findUser: async () => target,
      transaction: async (fn) => {
        const tx: PermissionUpdateTx = {
          updateUser: async (_id, data) => {
            updateCalls.push({ data });
            return {
              id: 'admin-2', username: 'admin2', name: 'Admin 2', role: 'admin',
              isActive: true, permissions: data.permissions,
            };
          },
          createAuditLog: async () => {},
        };
        return fn(tx);
      },
    };
    const result = await permissionUpdateController(
      deps,
      { permissions: ['customer.create', 'buy.create'] },
      ADMIN_AUTH,
      'admin-2'
    );
    expect(result.status).toBe(200);
    expect(updateCalls[0].data.permissions).toBeNull();
  });
});
