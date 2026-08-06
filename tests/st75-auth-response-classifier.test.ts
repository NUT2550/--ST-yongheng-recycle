/**
 * ST-75: Auth response classifier tests.
 *
 * Proves that token/user state is cleared only on 401,
 * not on 403, 429, 500, or network errors.
 */

import { describe, expect, test } from 'bun:test'
import { classifyAuthResponse, shouldClearToken, shouldClearUser } from '../src/lib/auth-response-classifier'

describe('ST-75: auth response classifier', () => {
  test('1. 200 → AUTHENTICATED', () => {
    expect(classifyAuthResponse(200)).toBe('AUTHENTICATED')
    expect(shouldClearToken(200)).toBe(false)
    expect(shouldClearUser(200)).toBe(false)
  })

  test('2. 401 → SESSION_EXPIRED (clear token + user)', () => {
    expect(classifyAuthResponse(401)).toBe('SESSION_EXPIRED')
    expect(shouldClearToken(401)).toBe(true)
    expect(shouldClearUser(401)).toBe(true)
  })

  test('3. 403 → PERMISSION_DENIED (do NOT clear token)', () => {
    expect(classifyAuthResponse(403)).toBe('PERMISSION_DENIED')
    expect(shouldClearToken(403)).toBe(false)
    expect(shouldClearUser(403)).toBe(false)
  })

  test('4. 429 → TRANSIENT_ERROR (do NOT clear token)', () => {
    expect(classifyAuthResponse(429)).toBe('TRANSIENT_ERROR')
    expect(shouldClearToken(429)).toBe(false)
    expect(shouldClearUser(429)).toBe(false)
  })

  test('5. 500 → TRANSIENT_ERROR (do NOT clear token)', () => {
    expect(classifyAuthResponse(500)).toBe('TRANSIENT_ERROR')
    expect(shouldClearToken(500)).toBe(false)
    expect(shouldClearUser(500)).toBe(false)
  })

  test('6. 502 → TRANSIENT_ERROR (do NOT clear token)', () => {
    expect(classifyAuthResponse(502)).toBe('TRANSIENT_ERROR')
    expect(shouldClearToken(502)).toBe(false)
  })

  test('7. 503 → TRANSIENT_ERROR (do NOT clear token)', () => {
    expect(classifyAuthResponse(503)).toBe('TRANSIENT_ERROR')
    expect(shouldClearToken(503)).toBe(false)
  })

  test('8. 400 → UNKNOWN (do NOT clear token)', () => {
    expect(classifyAuthResponse(400)).toBe('UNKNOWN')
    expect(shouldClearToken(400)).toBe(false)
  })

  test('9. 404 → UNKNOWN (do NOT clear token)', () => {
    expect(classifyAuthResponse(404)).toBe('UNKNOWN')
    expect(shouldClearToken(404)).toBe(false)
  })

  test('10. network error (status 0) → UNKNOWN (do NOT clear token)', () => {
    // fetch() returns status 0 on network failure
    expect(classifyAuthResponse(0)).toBe('UNKNOWN')
    expect(shouldClearToken(0)).toBe(false)
  })
})

describe('ST-75: auth status semantics matrix', () => {
  test('11. complete status matrix — only 401 clears token', () => {
    const statuses = [200, 301, 400, 401, 403, 404, 409, 422, 429, 500, 502, 503, 504]
    const clearStatuses = statuses.filter(s => shouldClearToken(s))
    expect(clearStatuses).toEqual([401])
  })
})
