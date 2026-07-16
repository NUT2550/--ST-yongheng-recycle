/**
 * ST-10: JWT + password crypto core — safe for test environments.
 *
 * This module is the *pure* crypto layer of the auth system. It is
 * intentionally SHARED between:
 *   - production code  (`src/lib/auth.ts` re-exports everything and adds
 *                       `import 'server-only'` + module-load-time JWT_SECRET
 *                       check, so production fails fast if the env var is
 *                       missing)
 *   - test code        (tests import directly from `auth-core.ts` so they
 *                       do NOT trigger the server-only import and do NOT
 *                       require JWT_SECRET to be set at module load)
 *
 * Differences from `auth.ts`:
 *   - NO `import 'server-only'` (test environments don't have the package
 *     shimmed, and Next.js's server-only guard throws in any non-RSC
 *     context).
 *   - NO module-load-time JWT_SECRET check. Instead, `createToken` and
 *     `verifyToken` read `process.env.JWT_SECRET` at CALL TIME and throw
 *     a clear error if missing. This lets tests point them at a test
 *     secret via `bunfig.toml` preload BEFORE the first call.
 */

import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { TOKEN_STORAGE_KEY } from './auth-constants'

export { TOKEN_STORAGE_KEY }

const COOKIE_NAME = TOKEN_STORAGE_KEY

export interface JWTPayload {
  userId: string
  username: string
  name: string
  role: 'admin' | 'staff'
  permissions?: Record<string, boolean>
}

/**
 * Read the JWT secret from the environment at call time.
 * Throws a clear error if missing — never falls back to a default.
 */
function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error(
      'JWT_SECRET environment variable is required. Set it in .env, Vercel env vars, or bunfig.toml preload for tests.'
    )
  }
  return new TextEncoder().encode(secret)
}

/**
 * Hash a plaintext password using bcrypt (10 rounds).
 * Pure crypto — no I/O, safe to call from tests.
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * Verify a plaintext password against a bcrypt hash.
 * Pure crypto — no I/O, safe to call from tests.
 */
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

/**
 * Create a signed JWT for the given payload. Expires in 7 days.
 * Reads `process.env.JWT_SECRET` at CALL TIME (not module load) so tests
 * can set the secret via preload before this is invoked.
 */
export async function createToken(payload: JWTPayload): Promise<string> {
  const secret = getJwtSecret()
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

/**
 * Verify a JWT and return its payload, or null if invalid/expired/tampered.
 * Reads `process.env.JWT_SECRET` at CALL TIME so tests can configure it.
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const secret = getJwtSecret()
    const { payload } = await jwtVerify(token, secret)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

/**
 * Get the cookie name used to store the auth token.
 */
export function getCookieName(): string {
  return COOKIE_NAME
}

/**
 * Parse a cookie header and extract the auth-token value.
 */
export function getTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === COOKIE_NAME) {
      return value
    }
  }
  return null
}

/**
 * Extract the bearer token from a request, preferring the Authorization
 * header (works in cross-origin iframes where SameSite cookies are blocked)
 * and falling back to the auth_token cookie (used for direct browser nav).
 */
export function getTokenFromRequest(request: Request): string | null {
  // 1) Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1].trim()
  }
  // 2) Cookie fallback
  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader) {
    return getTokenFromCookies(cookieHeader)
  }
  return null
}
