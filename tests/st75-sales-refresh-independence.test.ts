import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SELL_PAGE_PATH = join(process.cwd(), 'src/components/sell-page.tsx')

function readLoadDataBody(): string {
  const src = readFileSync(SELL_PAGE_PATH, 'utf8')
  const start = src.indexOf('async function loadData() {')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\n  // Filter products with stock > 0', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end)
}

describe('ST-75 P2-H: sales stock refresh is independent from customer refresh', () => {
  test('1. product and customer requests settle independently', () => {
    const body = readLoadDataBody()

    expect(body).toContain('Promise.allSettled([')
    expect(body).not.toContain('Promise.all([')
    expect(body).toMatch(/if \(prodResult\.status === 'fulfilled'\) \{[\s\S]*?setProducts\(/)
    expect(body).toMatch(/if \(custResult\.status === 'fulfilled'\) \{[\s\S]*?setCustomers\(/)
  })

  test('2. successful products are applied before customer outcome handling', () => {
    const body = readLoadDataBody()
    const productBranch = body.indexOf("if (prodResult.status === 'fulfilled')")
    const setProducts = body.indexOf('setProducts(', productBranch)
    const customerBranch = body.indexOf("if (custResult.status === 'fulfilled')")

    expect(productBranch).toBeGreaterThan(-1)
    expect(setProducts).toBeGreaterThan(productBranch)
    expect(customerBranch).toBeGreaterThan(setProducts)

    const productOnlyBlock = body.slice(productBranch, customerBranch)
    expect(productOnlyBlock).not.toContain('custResult')
  })

  test('3. customer failure is recorded without clearing or replacing products', () => {
    const body = readLoadDataBody()
    const customerBranch = body.indexOf("if (custResult.status === 'fulfilled')")
    expect(customerBranch).toBeGreaterThan(-1)

    const customerSection = body.slice(customerBranch)
    expect(customerSection).toContain('hadError = true')
    expect(customerSection).not.toContain('setProducts([])')
    expect(customerSection).not.toContain('setProducts(')
  })

  test('4. import dialog still uses loadData as the authoritative refresh callback', () => {
    const src = readFileSync(SELL_PAGE_PATH, 'utf8')
    expect(src).toContain('onRefreshAfterImport={loadData}')
  })
})
