/**
 * ST-68 Related Routes: Prevent 500 from weightExpression schema mismatch.
 *
 * Verifies that all 6 affected routes use explicit `select` on items
 * (not broad `include`) in their GET handlers, so Prisma does not query
 * the non-existent weightExpression column.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = join(dirname(__filename), '..')

function readRoute(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf-8')
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

function getHandlerBody(src: string, funcName: string): string {
  const regex = new RegExp(`export async function ${funcName}\\([^)]*\\)\\s*{([\\s\\S]*?)^}`, 'm')
  const match = src.match(regex)
  if (!match) throw new Error(`${funcName} not found`)
  return match[1]
}

describe('ST-68 Related Routes — explicit select on items', () => {
  test('GET /api/buy-bills (list) uses select on items, not include', () => {
    const body = getHandlerBody(readRoute('src/app/api/buy-bills/route.ts'), 'GET')
    const stripped = stripComments(body)
    // Should have items with select, not bare include
    expect(stripped).toContain('items:')
    expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('GET /api/buy-bills/[id] uses select on items, not include', () => {
    const body = getHandlerBody(readRoute('src/app/api/buy-bills/[id]/route.ts'), 'GET')
    const stripped = stripComments(body)
    expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('GET /api/sell-bills (list) uses select on items, not include', () => {
    const body = getHandlerBody(readRoute('src/app/api/sell-bills/route.ts'), 'GET')
    const stripped = stripComments(body)
    expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('GET /api/sell-bills/[id] uses select on items, not include', () => {
    const body = getHandlerBody(readRoute('src/app/api/sell-bills/[id]/route.ts'), 'GET')
    const stripped = stripComments(body)
    expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('GET /api/sorting-bills/[id] uses select on items, not include', () => {
    const body = getHandlerBody(readRoute('src/app/api/sorting-bills/[id]/route.ts'), 'GET')
    const stripped = stripComments(body)
    expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('GET /api/stock-transfers/[id] uses select on items, not include', () => {
    const body = getHandlerBody(readRoute('src/app/api/stock-transfers/[id]/route.ts'), 'GET')
    const stripped = stripComments(body)
    expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('no GET handler selects weightExpression in any affected route', () => {
    const routes = [
      'src/app/api/buy-bills/route.ts',
      'src/app/api/buy-bills/[id]/route.ts',
      'src/app/api/sell-bills/route.ts',
      'src/app/api/sell-bills/[id]/route.ts',
      'src/app/api/sorting-bills/[id]/route.ts',
      'src/app/api/stock-transfers/[id]/route.ts',
    ]
    for (const route of routes) {
      const src = readRoute(route)
      // Check GET handler only
      const getMatch = src.match(/export async function GET[\s\S]*?^}/m)
      if (getMatch) {
        const stripped = stripComments(getMatch[0])
        expect(stripped).not.toContain('weightExpression')
      }
    }
  })

  test('buy-bills [id] PATCH uses select on items, not include', () => {
    const src = readRoute('src/app/api/buy-bills/[id]/route.ts')
    const patchMatch = src.match(/export async function PATCH[\s\S]*?^}/m)
    if (patchMatch) {
      const stripped = stripComments(patchMatch[0])
      expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
    }
  })

  test('sell-bills [id] PATCH uses select on items, not include', () => {
    const src = readRoute('src/app/api/sell-bills/[id]/route.ts')
    const patchMatch = src.match(/export async function PATCH[\s\S]*?^}/m)
    if (patchMatch) {
      const stripped = stripComments(patchMatch[0])
      expect(stripped).not.toMatch(/items:\s*\{\s*include:\s*\{/)
    }
  })
})
