/**
 * ST-10: Test environment preload.
 *
 * Sets JWT_SECRET for the bun test runner so that `auth-core.createToken`
 * and `auth-core.verifyToken` (which read `process.env.JWT_SECRET` at CALL
 * time) can sign + verify real JWTs in tests.
 *
 * This file is loaded via `bunfig.toml` `test.preload` BEFORE any test
 * imports execute. It does NOT need to stub `server-only` — tests import
 * from `src/lib/auth-core.ts` (no server-only) and `src/lib/permissions.ts`
 * (no server-only), so the server-only guard is never triggered in tests.
 *
 * CI sets JWT_SECRET as an env var as well (belt + suspenders). The local
 * dev workflow uses this preload file alone.
 */
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-st10-tests-not-production'
}
