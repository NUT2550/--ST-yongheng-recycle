/**
 * ST-68: Dashboard API 500 root cause regression test.
 *
 * Root cause: The Prisma schema includes `weightExpression String?` on
 * BuyBillItem and SellBillItem, but the `add_weight_expression` migration
 * has NOT been applied to the Production database. The dashboard route's
 * recentBuyBills and recentSellBills queries used `include: { items: { include: { product } } }`
 * which selects ALL columns — including the non-existent weightExpression column.
 * Prisma throws when querying a non-existent column → catch block returns 500.
 *
 * Fix: Changed `include` to explicit `select` on items, listing only columns
 * that exist in the Production database. This avoids the weightExpression column
 * without requiring a migration.
 *
 * This test verifies:
 * 1. The dashboard route source uses explicit `select` on items (not `include`)
 * 2. The select does NOT include `weightExpression`
 * 3. The select includes essential fields (weight, pricePerKg, totalAmount, product)
 */

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = join(dirname(__filename), '..')

function readDashboardRoute(): string {
  return readFileSync(join(REPO_ROOT, 'src/app/api/dashboard/route.ts'), 'utf-8')
}

describe('ST-68 Dashboard 500 regression', () => {
  test('recentBuyBills uses explicit select (not include) on items', () => {
    const src = readDashboardRoute()
    // The buy bills query should use 'select' on items, not 'include'
    // Find the recentBuyBills section
    const buySection = src.match(/Recent buy bills[\s\S]*?orderBy:\s*\{\s*date:\s*'desc'[\s\S]*?take:\s*5/)
    expect(buySection).toBeTruthy()
    // Should contain 'select' on items
    expect(buySection![0]).toContain('select:')
    // Should NOT use bare 'include' on items (without select)
    expect(buySection![0]).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('recentSellBills uses explicit select (not include) on items', () => {
    const src = readDashboardRoute()
    const sellSection = src.match(/Recent sell bills[\s\S]*?orderBy:\s*\{\s*date:\s*'desc'[\s\S]*?take:\s*5/)
    expect(sellSection).toBeTruthy()
    expect(sellSection![0]).toContain('select:')
    expect(sellSection![0]).not.toMatch(/items:\s*\{\s*include:\s*\{/)
  })

  test('dashboard queries do not select weightExpression', () => {
    const src = readDashboardRoute()
    // Strip comments before checking
    const stripped = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    // No weightExpression in actual code (comments are OK)
    expect(stripped).not.toContain('weightExpression')
  })

  test('buy items select includes essential fields', () => {
    const src = readDashboardRoute()
    const buySection = src.match(/Recent buy bills[\s\S]*?take:\s*5/)
    expect(buySection).toBeTruthy()
    const section = buySection![0]
    expect(section).toContain('weight:')
    expect(section).toContain('pricePerKg:')
    expect(section).toContain('totalAmount:')
    expect(section).toContain('product:')
  })

  test('sell items select includes essential fields', () => {
    const src = readDashboardRoute()
    const sellSection = src.match(/Recent sell bills[\s\S]*?take:\s*5/)
    expect(sellSection).toBeTruthy()
    const section = sellSection![0]
    expect(section).toContain('weight:')
    expect(section).toContain('pricePerKg:')
    expect(section).toContain('totalAmount:')
    expect(section).toContain('costPerKg:')
    expect(section).toContain('totalCost:')
    expect(section).toContain('product:')
  })
})
