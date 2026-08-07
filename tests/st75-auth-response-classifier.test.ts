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

// ============ ST-75 Layer B: production-integration tests ============
// Prove that production code imports and uses the tested classifier.

import { readFileSync } from 'fs'
import { join } from 'path'

describe('ST-75: production classifier integration', () => {
  test('12. page.tsx imports classifyAuthResponse', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(src).toContain("import { classifyAuthResponse } from '@/lib/auth-response-classifier'")
    expect(src).toContain('classifyAuthResponse(res.status)')
  })

  test('13. buy dialog imports classifyAuthResponse', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain("import { classifyAuthResponse } from '@/lib/auth-response-classifier'")
    expect(src).toContain('classifyAuthResponse(res.status)')
  })

  test('14. sell dialog imports classifyAuthResponse', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-sell-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain("import { classifyAuthResponse } from '@/lib/auth-response-classifier'")
    expect(src).toContain('classifyAuthResponse(res.status)')
  })

  test('15. page.tsx uses classifier for SESSION_EXPIRED (401)', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    expect(src).toContain("authAction === 'SESSION_EXPIRED'")
    expect(src).toContain('setAuthToken(null)')
    expect(src).toContain('setUser(null)')
  })

  test('16. page.tsx does NOT use ad-hoc res.status === 401 check', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/page.tsx'), 'utf8')
    // The classifier should be used, not direct status comparison
    expect(src).not.toContain('res.status === 401')
  })

  test('17. buy dialog uses classifier for checkDuplicates', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain("checkAction === 'SESSION_EXPIRED'")
    expect(src).toContain("checkAction === 'PERMISSION_DENIED'")
    expect(src).toContain("checkAction === 'TRANSIENT_ERROR'")
  })

  test('18. buy dialog uses classifier for apply', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain("applyAction === 'SESSION_EXPIRED'")
    expect(src).toContain("applyAction === 'PERMISSION_DENIED'")
    expect(src).toContain("applyAction === 'TRANSIENT_ERROR'")
  })

  test('19. sell dialog uses classifier for checkDuplicates', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-sell-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain("checkAction === 'SESSION_EXPIRED'")
    expect(src).toContain("checkAction === 'PERMISSION_DENIED'")
    expect(src).toContain("checkAction === 'TRANSIENT_ERROR'")
  })

  test('20. sell dialog uses classifier for apply', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-sell-excel-import-dialog.tsx'), 'utf8')
    expect(src).toContain("applyAction === 'SESSION_EXPIRED'")
    expect(src).toContain("applyAction === 'PERMISSION_DENIED'")
    expect(src).toContain("applyAction === 'TRANSIENT_ERROR'")
  })

  test('21. buy dialog does NOT use ad-hoc res.status === 401 in checkDuplicates/apply', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    // Should not have direct status checks for 401/403 in fetch handlers
    // (handleSessionExpired/handlePermissionDenied are called via classifier)
    const lines = src.split('\n')
    const adHocLines = lines.filter(l =>
      l.includes('res.status === 401') || l.includes('res.status === 403')
    )
    expect(adHocLines.length).toBe(0)
  })

  test('22. sell dialog does NOT use ad-hoc res.status === 401 in checkDuplicates/apply', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/detailed-sell-excel-import-dialog.tsx'), 'utf8')
    const lines = src.split('\n')
    const adHocLines = lines.filter(l =>
      l.includes('res.status === 401') || l.includes('res.status === 403')
    )
    expect(adHocLines.length).toBe(0)
  })

  test('23. purchase/sales parity — both use classifier for all 4 paths', () => {
    const buySrc = readFileSync(join(process.cwd(), 'src/components/detailed-excel-import-dialog.tsx'), 'utf8')
    const sellSrc = readFileSync(join(process.cwd(), 'src/components/detailed-sell-excel-import-dialog.tsx'), 'utf8')
    // Count actual classifier CALLS (not import line)
    const buyCalls = (buySrc.match(/= classifyAuthResponse\(res\.status\)/g) || []).length
    const sellCalls = (sellSrc.match(/= classifyAuthResponse\(res\.status\)/g) || []).length
    expect(buyCalls).toBe(2) // checkDuplicates + apply
    expect(sellCalls).toBe(2) // checkDuplicates + apply
  })

  test('24. no no-op onSessionExpired callbacks remain', () => {
    const buySrc = readFileSync(join(process.cwd(), 'src/components/buy-page.tsx'), 'utf8')
    const sellSrc = readFileSync(join(process.cwd(), 'src/components/sell-page.tsx'), 'utf8')
    expect(buySrc).not.toContain('/* parent handles')
    expect(sellSrc).not.toContain('/* parent handles')
  })
})
