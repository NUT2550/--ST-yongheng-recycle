/**
 * ST-42: Login malformed/empty JSON body regression.
 *
 * Symptom (before fix):
 *   POST /api/auth/login with a non-JSON or malformed-JSON body makes
 *   `await request.json()` throw inside the route handler. The catch
 *   block returns HTTP 500 with `{ error, detail }` where `detail` is
 *   `${error.name}: ${error.message}` — leaking the implementation
 *   detail (e.g. "SyntaxError: Unexpected token...").
 *
 * Expected behavior:
 *   Malformed or empty JSON body should return a safe HTTP 400 with a
 *   user-facing error message and NO implementation detail leak.
 *
 * These tests invoke the REAL route handler `POST` from
 * `src/app/api/auth/login/route.ts` with a NextRequest whose body is
 * malformed. No source inspection. No boolean shortcuts.
 *
 * Run: bun test tests/st42-login-malformed-json.test.ts
 */

import { describe, expect, test, mock } from 'bun:test'

// Stub `server-only` so we can import the real route handler in tests.
// The login route imports `@/lib/auth` which has `import 'server-only'`.
mock.module('server-only', () => ({}))

// Dynamic import so the mock is registered before the route module loads.
const { POST } = await import('../src/app/api/auth/login/route')

type LoginRouteRequest = Parameters<typeof POST>[0]

function makeJsonRequest(body: string, contentType = 'application/json'): LoginRouteRequest {
  const headers = new Headers()
  headers.set('content-type', contentType)
  return new Request('https://test.local/api/auth/login', {
    method: 'POST',
    headers,
    body,
  }) as unknown as LoginRouteRequest
}

function makeEmptyRequest(): LoginRouteRequest {
  // No body, no content-type — simulates a client that sent zero bytes.
  return new Request('https://test.local/api/auth/login', {
    method: 'POST',
  }) as unknown as LoginRouteRequest
}

describe('ST-42: login malformed JSON body — safe 400, no detail leak', () => {
  test('1. malformed JSON body → 400, not 500', async () => {
    const request = makeJsonRequest('{ this is not valid json')
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  test('2. empty body → 400, not 500', async () => {
    const request = makeEmptyRequest()
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  test('3. valid JSON but not an object → 400, not 500', async () => {
    const request = makeJsonRequest('"just a string"')
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  test('4. valid JSON array (not an object) → 400, not 500', async () => {
    const request = makeJsonRequest('[]')
    const response = await POST(request)
    expect(response.status).toBe(400)
  })

  test('5. malformed JSON → response body must NOT leak error.name/message', async () => {
    const request = makeJsonRequest('{ this is not valid json')
    const response = await POST(request)
    const body = await response.json()
    const bodyStr = JSON.stringify(body).toLowerCase()
    // Must not contain implementation-detail leak.
    expect(bodyStr).not.toContain('syntaxerror')
    expect(bodyStr).not.toContain('unexpected token')
    expect(bodyStr).not.toContain('error.name')
    expect(bodyStr).not.toContain('error.message')
    // detail field must not exist or must be safe (no implementation detail).
    expect(body.detail).toBeUndefined()
  })

  test('6. malformed JSON → response body contains user-facing error message', async () => {
    const request = makeJsonRequest('{ this is not valid json')
    const response = await POST(request)
    const body = await response.json()
    expect(body.error).toBeTruthy()
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })

  test('7. valid JSON object with missing username/password still returns 400 via controller', async () => {
    // Sanity: well-formed JSON with missing fields must still reach the controller's 400 path.
    const request = makeJsonRequest(JSON.stringify({}))
    const response = await POST(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
  })

  test('8. malformed JSON → no Set-Cookie auth token in response', async () => {
    const request = makeJsonRequest('{ this is not valid json')
    const response = await POST(request)
    // Must not set an auth cookie on a failed login attempt.
    const setCookie = response.headers.get('set-cookie')
    if (setCookie) {
      expect(setCookie.toLowerCase()).not.toContain('auth_token')
      expect(setCookie.toLowerCase()).not.toContain('httponly')
    }
  })
})
