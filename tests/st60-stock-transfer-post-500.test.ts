/**
 * ST-60: POST /api/stock-transfers 500 root cause regression test.
 *
 * Root cause: createStockTransfer used 'include: { items: { include: { product } } }'
 * which selects ALL columns of StockTransferItem — including weightExpression
 * which doesn't exist in Production DB. Prisma throws → 500.
 *
 * Fix: Changed include to explicit select on items, avoiding weightExpression.
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = join(dirname(__filename), '..')

function readSource(): string {
  return readFileSync(join(REPO_ROOT, 'src/lib/stock-transfer-prisma-deps.ts'), 'utf-8')
}

function stripComments(src: string): string {
  return src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
}

describe('ST-60 stock-transfer POST 500 regression', () => {
  test('createStockTransfer uses explicit select on items (not include)', () => {
    const src = readSource()
    const stripped = stripComments(src)
    const funcMatch = stripped.match(/async createStockTransfer[\s\S]*?return created/)
    expect(funcMatch).toBeTruthy()
    const funcBody = funcMatch![0]
    expect(funcBody).toContain('items:')
    expect(funcBody).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('createStockTransfer does not select weightExpression', () => {
    const src = readSource()
    const stripped = stripComments(src)
    const funcMatch = stripped.match(/async createStockTransfer[\s\S]*?return created/)
    expect(funcMatch).toBeTruthy()
    expect(funcMatch![0]).not.toContain('weightExpression')
  })

  test('createStockTransfer selects essential StockTransferItem fields', () => {
    const src = readSource()
    const stripped = stripComments(src)
    const funcMatch = stripped.match(/async createStockTransfer[\s\S]*?return created/)
    expect(funcMatch).toBeTruthy()
    const funcBody = funcMatch![0]
    expect(funcBody).toContain('id:')
    expect(funcBody).toContain('productId:')
    expect(funcBody).toContain('weight:')
    expect(funcBody).toContain('isWaste:')
    expect(funcBody).toContain('costPerKg:')
    expect(funcBody).toContain('totalCost:')
    expect(funcBody).toContain('outputPricePerKg:')
    expect(funcBody).toContain('product:')
  })

  test('createStockTransfer preserves sourceProduct relation', () => {
    const src = readSource()
    const stripped = stripComments(src)
    const funcMatch = stripped.match(/async createStockTransfer[\s\S]*?return created/)
    expect(funcMatch).toBeTruthy()
    expect(funcMatch![0]).toContain('sourceProduct:')
  })
})
