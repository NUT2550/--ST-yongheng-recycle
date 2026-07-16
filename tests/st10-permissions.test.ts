/**
 * ST-10: Executable tests for the structured permission system.
 *
 * These tests call the REAL production helpers from src/lib/permissions.ts
 * and verify the permission logic that guards POST /api/customers,
 * POST /api/employees, and POST /api/bonuses.
 *
 * The permission system is already implemented on main (User.permissions JSON
 * field, JWT-embedded permissions, route checks). These tests prove it works
 * and prevent regressions.
 *
 * Run: bun test tests/st10-permissions.test.ts
 */
import { test, expect, describe } from 'bun:test';
import {
  hasPermission,
  isAdmin,
  isValidPermission,
  filterValidPermissions,
  normalizePermissions,
  computePermissionDiff,
  CANONICAL_PERMISSIONS,
  PERMISSION_LABELS,
  type AuthPayload,
} from '../src/lib/permissions';

// ============ Test fixtures ============

const ADMIN: AuthPayload = {
  userId: 'admin-1',
  username: 'admin',
  name: 'Admin',
  role: 'admin',
};

const STAFF_WITH_CUSTOMER_CREATE: AuthPayload = {
  userId: 'staff-1',
  username: 'staff1',
  name: 'Staff With Perm',
  role: 'staff',
  permissions: { 'customer.create': true, 'buy.create': true },
};

const STAFF_NO_PERMISSIONS: AuthPayload = {
  userId: 'staff-2',
  username: 'staff2',
  name: 'Staff No Perm',
  role: 'staff',
  permissions: { 'buy.create': true }, // has buy.create but NOT customer.create
};

const STAFF_NO_PERM_KEY: AuthPayload = {
  userId: 'staff-3',
  username: 'staff3',
  name: 'Staff No Key',
  role: 'staff',
  // no permissions key at all
};

// ============ 1. hasPermission — the core authorization check ============

describe('ST-10: hasPermission — route authorization logic', () => {
  test('1. unauthenticated (null payload) → no permission', () => {
    expect(hasPermission(null, 'customer.create')).toBe(false);
  });

  test('2. Staff without customer.create → false (403)', () => {
    expect(hasPermission(STAFF_NO_PERMISSIONS, 'customer.create')).toBe(false);
  });

  test('3. Staff with customer.create → true (allowed)', () => {
    expect(hasPermission(STAFF_WITH_CUSTOMER_CREATE, 'customer.create')).toBe(true);
  });

  test('4. Admin → true for customer.create (implicit)', () => {
    expect(hasPermission(ADMIN, 'customer.create')).toBe(true);
  });

  test('5. Admin → true for ALL canonical permissions', () => {
    for (const perm of CANONICAL_PERMISSIONS) {
      expect(hasPermission(ADMIN, perm)).toBe(true);
    }
  });

  test('6. Staff with no permissions key → false for all', () => {
    expect(hasPermission(STAFF_NO_PERM_KEY, 'customer.create')).toBe(false);
    expect(hasPermission(STAFF_NO_PERM_KEY, 'buy.create')).toBe(false);
  });

  test('7. Staff with permissions.false explicit → false', () => {
    const staff: AuthPayload = {
      userId: 's',
      username: 's',
      name: 's',
      role: 'staff',
      permissions: { 'customer.create': false },
    };
    expect(hasPermission(staff, 'customer.create')).toBe(false);
  });
});

// ============ 2. isAdmin — admin-only endpoints (employees, bonuses) ============

describe('ST-10: isAdmin — admin-only route guards', () => {
  test('8. Admin → true (employees/bonuses POST allowed)', () => {
    expect(isAdmin(ADMIN)).toBe(true);
  });

  test('9. Staff → false (employees/bonuses POST → 403)', () => {
    expect(isAdmin(STAFF_WITH_CUSTOMER_CREATE)).toBe(false);
    expect(isAdmin(STAFF_NO_PERMISSIONS)).toBe(false);
  });

  test('10. null → false (unauthenticated → 401)', () => {
    expect(isAdmin(null)).toBe(false);
  });
});

// ============ 3. Permission validation (prevents arbitrary client-supplied permissions) ============

describe('ST-10: permission validation — no client-supplied arbitrary permissions', () => {
  test('11. isValidPermission — canonical names accepted', () => {
    expect(isValidPermission('customer.create')).toBe(true);
    expect(isValidPermission('dailyPurchaseWeighing')).toBe(true);
    expect(isValidPermission('product.manage')).toBe(true);
  });

  test('12. isValidPermission — non-canonical names rejected', () => {
    expect(isValidPermission('createCustomer')).toBe(false);
    expect(isValidPermission('customerCreate')).toBe(false);
    expect(isValidPermission('customers.write')).toBe(false);
    expect(isValidPermission('admin')).toBe(false);
    expect(isValidPermission('')).toBe(false);
  });

  test('13. filterValidPermissions — strips invalid names from client payload', () => {
    const clientSupplied = ['customer.create', 'createCustomer', 'customerCreate', 'buy.create', 'hack.the.server'];
    const filtered = filterValidPermissions(clientSupplied);
    expect(filtered).toEqual(['customer.create', 'buy.create']);
    expect(filtered).not.toContain('hack.the.server');
  });

  test('14. normalizePermissions — deduplicates + filters', () => {
    const input = ['customer.create', 'customer.create', 'buy.create', 'invalid.perm'];
    const normalized = normalizePermissions(input);
    expect(normalized).toEqual(['customer.create', 'buy.create']);
    expect(normalized).toHaveLength(2);
  });

  test('15. forged client permissions (non-string entries) rejected', () => {
    const forged = ['customer.create', 123, null, { hack: true }, undefined, 'buy.create'];
    const filtered = filterValidPermissions(forged as unknown[]);
    expect(filtered).toEqual(['customer.create', 'buy.create']);
  });
});

// ============ 4. Permission diff (for AuditLog) ============

describe('ST-10: computePermissionDiff — audit before/after', () => {
  test('16. permission added → added array has it', () => {
    const diff = computePermissionDiff(['buy.create'], ['buy.create', 'customer.create']);
    expect(diff.added).toEqual(['customer.create']);
    expect(diff.removed).toEqual([]);
  });

  test('17. permission removed → removed array has it', () => {
    const diff = computePermissionDiff(['buy.create', 'customer.create'], ['buy.create']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual(['customer.create']);
  });

  test('18. no change → both arrays empty', () => {
    const diff = computePermissionDiff(['customer.create'], ['customer.create']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
  });

  test('19. swap permissions → one added, one removed', () => {
    const diff = computePermissionDiff(['customer.create'], ['buy.create']);
    expect(diff.added).toEqual(['buy.create']);
    expect(diff.removed).toEqual(['customer.create']);
  });
});

// ============ 5. Canonical permission names (single source of truth) ============

describe('ST-10: canonical permission names', () => {
  test('20. customer.create is in CANONICAL_PERMISSIONS', () => {
    expect(CANONICAL_PERMISSIONS).toContain('customer.create');
  });

  test('21. dailyPurchaseWeighing (existing) is in CANONICAL_PERMISSIONS', () => {
    expect(CANONICAL_PERMISSIONS).toContain('dailyPurchaseWeighing');
  });

  test('22. all canonical permissions have Thai labels', () => {
    for (const perm of CANONICAL_PERMISSIONS) {
      expect(PERMISSION_LABELS[perm]).toBeDefined();
      expect(typeof PERMISSION_LABELS[perm]).toBe('string');
      expect(PERMISSION_LABELS[perm].length).toBeGreaterThan(0);
    }
  });

  test('23. no inconsistent permission names (createCustomer, customerCreate, etc.)', () => {
    expect(CANONICAL_PERMISSIONS).not.toContain('createCustomer');
    expect(CANONICAL_PERMISSIONS).not.toContain('customerCreate');
    expect(CANONICAL_PERMISSIONS).not.toContain('customers.write');
  });
});

// ============ 6. Token strategy — REMOVED documentation-only tests ============
// Tests 24-26 (hard-coded boolean assertions) were removed.
// were removed per Owner review. Real JWT behavior is tested in
// tests/st10-production.test.ts via createToken/verifyToken.
