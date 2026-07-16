/**
 * ST-10: Server-only auth facade.
 *
 * This file re-exports the pure crypto layer from `./auth-core` and adds two
 * production-only guarantees:
 *
 *   1. `import 'server-only'` — Next.js will refuse to bundle this module
 *      into client code, preventing accidental leakage of JWT signing /
 *      verification / password hashing into the browser.
 *
 *   2. Module-load-time `JWT_SECRET` check — production fails fast at boot
 *      if the secret is missing, instead of waiting for the first login
 *      attempt to throw. This makes misconfiguration immediately visible
 *      in deploy logs.
 *
 * Tests should import from `./auth-core` directly (NOT from this file) so
 * they don't trigger the server-only guard and don't need JWT_SECRET set
 * at module load time. `auth-core`'s `createToken` / `verifyToken` read
 * JWT_SECRET at call time, which lets `bunfig.toml` preload set a test
 * secret before any test invokes them.
 */

import 'server-only'

// Production safety: fail fast if the JWT secret is missing at boot.
// Without this, the first login attempt would throw an opaque error inside
// `auth-core.createToken` instead of failing at startup.
const JWT_SECRET_STRING = process.env.JWT_SECRET
if (!JWT_SECRET_STRING) {
  throw new Error(
    'JWT_SECRET environment variable is required. Set it in .env or Vercel env vars.'
  )
}

// Re-export everything from the pure crypto layer.
export {
  TOKEN_STORAGE_KEY,
  type JWTPayload,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  getCookieName,
  getTokenFromCookies,
  getTokenFromRequest,
} from './auth-core'
