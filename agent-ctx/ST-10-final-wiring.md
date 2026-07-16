# ST-10 Final Permission Integration — Work Record

**Task ID**: ST-10 (final completion)
**Agent**: Main (production wiring + real tests; no merge/deploy/migrate/Prod-write)
**Branch**: `st-10-permission-system` (worktree `/tmp/st10-fix`)
**Base commit**: `643413e` (prior ST-10 head — server-only CI mutation, hardcoded user.manage in login route, employees/bonuses/users-page NOT wired)

## Summary

Completed the 4 verified blockers flagged by Owner review. The production
permission path is now fully wired through the shared permission module +
extracted route controllers, with REAL controller tests proving the
authorization, validation, and atomic-rollback contracts.

## Blockers Resolved

### Blocker 1 — Login route hardcoded `user.manage`
- Added `buildAdminPermissionMap()` and `buildStaffPermissionMap(storedPermissions)` to `src/lib/permissions.ts` (lines 113-180).
- Created `loginController(deps, input)` in `src/lib/route-controllers.ts` (lines 209-289) that calls these builders.
- Refactored `src/app/api/auth/login/route.ts` to a thin adapter that wires Prisma `db.user.findUnique` as `deps.findUser` and calls `loginController`.
- The hardcoded `{ 'user.manage': true, ... }` map is GONE. No JWT contains `user.manage`. Verified by `grep -rn "user.manage" src/` → only comment references remain.

### Blocker 2 — employees/bonuses/users-page not wired
- `src/app/api/employees/route.ts`: imports `isAdmin` from `@/lib/permissions` (line 3), uses `!isAdmin(payload)` on line 36. Replaced `payload.role !== 'admin'`.
- `src/app/api/bonuses/route.ts`: imports `isAdmin` (line 3), uses it on line 80.
- `src/components/users-page.tsx`: imports `PERMISSION_LABELS` from `@/lib/permissions` (line 33), derives `PERMISSION_KEYS = Object.entries(PERMISSION_LABELS).map(...)` (line 35). Local `PERMISSION_KEYS` array deleted.

### Blocker 3 — server-only CI mutation
- Created `src/lib/auth-core.ts` (138 lines): `JWTPayload`, `hashPassword`, `verifyPassword`, `createToken`, `verifyToken`, `getCookieName`, `getTokenFromCookies`, `getTokenFromRequest`. NO `import 'server-only'`. NO module-load-time `JWT_SECRET` check — instead, `createToken`/`verifyToken` read `process.env.JWT_SECRET` at CALL TIME via `getJwtSecret()`.
- Refactored `src/lib/auth.ts` to a 46-line facade: `import 'server-only'` + module-load-time `JWT_SECRET` check + re-export everything from `./auth-core`.
- Tests import from `auth-core` directly (no server-only trigger):
  - `tests/st10-production.test.ts:18`
  - `tests/st10-controllers.test.ts:41`
- Removed CI step `echo 'export {}' > node_modules/server-only/index.js` from `.github/workflows/ci.yml`. `grep -n "server-only" .github/workflows/ci.yml` → 0 matches.
- Replaced `tests/st10-server-only-stub.ts` + `tests/st10-server-only-noop.ts` with a single `tests/st10-test-env.ts` that ONLY sets `JWT_SECRET`. `bunfig.toml` preloads it.

### Blocker 4 — Real handler/controller tests
- Created `src/lib/route-controllers.ts` (420 lines) with 5 controllers, each accepting injectable `deps`:
  - `customerController(deps, input, auth)` — hasPermission gate, name validation, deps.createCustomer
  - `employeeController(deps, input, auth)` — isAdmin gate, name validation, deps.createEmployee
  - `bonusController(deps, input, auth)` — isAdmin gate, employeeId/totalWeight/totalAmount validation, deps.createBonus
  - `loginController(deps, input)` — deps.findUser, verifyPassword, buildAdminPermissionMap/buildStaffPermissionMap, createToken
  - `permissionUpdateController(deps, input, auth, targetUserId)` — isAdmin gate, self-change block, normalizePermissions, deps.transaction(tx → { updateUser + createAuditLog })
- Wired the 4 routes (login, customers, employees, bonuses, users/[id]) to call these controllers as thin adapters.
- Replaced documentation-only tests 27-29 in `tests/st10-production.test.ts` with REAL `permissionUpdateController` execution (happy path, atomic rollback with throwing auditLog, non-admin 403).
- Added `tests/st10-controllers.test.ts` (37 tests) covering all 5 controllers.
- The atomic-rollback test (`st10-controllers.test.ts:464`) makes `tx.createAuditLog` throw → controller returns 500 with rollback message → user.update was ATTEMPTED but transaction rejected (Prisma would roll back in real DB).

## Files Changed

### Modified
- `.github/workflows/ci.yml` — removed `Stub server-only for test environment` step
- `bunfig.toml` — preload `./tests/st10-test-env.ts` (was `./tests/st10-server-only-stub.ts`)
- `src/app/api/auth/login/route.ts` — thin adapter calling `loginController`
- `src/app/api/bonuses/route.ts` — imports `isAdmin` + calls `bonusController`
- `src/app/api/customers/route.ts` — calls `customerController`
- `src/app/api/employees/route.ts` — imports `isAdmin` + calls `employeeController`
- `src/app/api/users/[id]/route.ts` — calls `permissionUpdateController` for permission updates
- `src/components/users-page.tsx` — uses `PERMISSION_LABELS` (no local array)
- `src/lib/auth.ts` — 46-line facade: server-only + JWT_SECRET check + re-export from auth-core
- `src/lib/permissions.ts` — added `buildAdminPermissionMap()` + `buildStaffPermissionMap()`
- `tests/st10-production.test.ts` — import from auth-core; tests 27-29 replaced with real controller execution

### Created
- `src/lib/auth-core.ts` — JWT + password crypto core (no server-only, JWT_SECRET at call time)
- `src/lib/route-controllers.ts` — 5 injectable-deps controllers (the real production path)
- `tests/st10-controllers.test.ts` — 37 controller tests including atomic rollback
- `tests/st10-test-env.ts` — bunfig preload that sets JWT_SECRET (replaces server-only stubs)

### Deleted
- `tests/st10-server-only-noop.ts` — useless (was `export {}`)
- `tests/st10-server-only-stub.ts` — replaced by `tests/st10-test-env.ts`

## Verification

| Check | Result |
|---|---|
| `bunx tsc --noEmit` | EXIT 0 |
| `bun run lint` | EXIT 0 |
| `bun test` | 376 pass / 0 fail / 1031 expect() calls / 11 files |
| `grep -rn "user.manage" src/` | 6 matches — ALL in comments (no active occurrences) |
| `grep -n "server-only" .github/workflows/ci.yml` | 0 matches |
| `git diff origin/main --name-only` | includes employees/route.ts, bonuses/route.ts, users-page.tsx ✓ |

## Test Breakdown (376 total)

- `tests/st10-permissions.test.ts` — 23 (unchanged)
- `tests/st10-production.test.ts` — 29 (tests 27-29 now real controller execution)
- `tests/st10-controllers.test.ts` — 37 (NEW: real controller tests)
- Other test files — 287 (unchanged)

## Did NOT

- Run `db:push` or apply migrations
- Write to the database
- Run `bun run build`
- Merge to main
- Deploy
- Push to origin
- Modify PR #7
- Weaken ST-11/ST-20/ST-39/ST-40

## Safety

- No Production write
- No schema change
- No migration
- No merge
- No deploy
- No direct main push
- PR #7 unchanged (will be updated by this commit but not pushed)
