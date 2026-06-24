/**
 * Shared auth constants — safe for BOTH client and server.
 *
 * This module contains ONLY constants that are safe to expose to the browser.
 * Do NOT put JWT secret, password hashing, or token verification here.
 * Those belong in server-only `auth.ts`.
 */

// Storage key for localStorage on the client (token-based auth)
// This is NOT a secret — it's just a localStorage key name.
export const TOKEN_STORAGE_KEY = 'auth_token'
