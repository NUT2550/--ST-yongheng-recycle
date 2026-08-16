import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { runInNewContext } from 'node:vm'
import * as ts from 'typescript'

const SELL_PAGE_PATH = join(process.cwd(), 'src/components/sell-page.tsx')

type RuntimeDeps = {
  fetchProducts: () => Promise<unknown>
  fetchCustomers: () => Promise<unknown>
  setProducts: (value: unknown) => void
  setCustomers: (value: unknown) => void
  setLoading: (value: boolean) => void
  toast: { error: (message: string) => void }
}

type MakeLoadData = (deps: RuntimeDeps) => () => Promise<void>

function readLoadDataSource(): string {
  const src = readFileSync(SELL_PAGE_PATH, 'utf8')
  const start = src.indexOf('async function loadData() {')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('\n  // Filter products with stock > 0', start)
  expect(end).toBeGreaterThan(start)
  return src.slice(start, end).trim()
}

function instantiateActualLoadData(deps: RuntimeDeps): () => Promise<void> {
  const loadDataSource = readLoadDataSource()
  const wrapperSource = `
    export default function makeLoadData(deps: any) {
      const { fetchProducts, fetchCustomers, setProducts, setCustomers, setLoading, toast } = deps;
      ${loadDataSource}
      return loadData;
    }
  `

  const compiled = ts.transpileModule(wrapperSource, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText

  const moduleBox: { exports: { default?: MakeLoadData } } = { exports: {} }
  const context = {
    module: moduleBox,
    exports: moduleBox.exports,
  }
  runInNewContext(compiled, context)

  const makeLoadData = moduleBox.exports.default
  expect(makeLoadData).toBeDefined()
  return makeLoadData!(deps)
}

describe('ST-75 P2-H: sales stock refresh is independent from customer refresh', () => {
  test('1. applies authoritative products even when customers reject', async () => {
    const freshProducts = [{ id: 'fresh-product', stock: { totalWeight: 42 } }]
    let productState: unknown = [{ id: 'stale-product' }]
    let customerState: unknown = [{ id: 'existing-customer' }]
    let loading = true
    const errors: string[] = []

    const loadData = instantiateActualLoadData({
      fetchProducts: async () => freshProducts,
      fetchCustomers: async () => {
        throw new Error('customer endpoint unavailable')
      },
      setProducts: (value) => {
        productState = value
      },
      setCustomers: (value) => {
        customerState = value
      },
      setLoading: (value) => {
        loading = value
      },
      toast: {
        error: (message) => {
          errors.push(message)
        },
      },
    })

    await loadData()

    expect(productState).toEqual(freshProducts)
    expect(customerState).toEqual([{ id: 'existing-customer' }])
    expect(loading).toBe(false)
    expect(errors).toEqual(['ไม่สามารถโหลดข้อมูลบางส่วนได้'])
  })

  test('2. applies customers independently when products reject', async () => {
    const freshCustomers = [{ id: 'fresh-customer', name: 'Customer' }]
    let productState: unknown = [{ id: 'existing-product' }]
    let customerState: unknown = [{ id: 'stale-customer' }]
    const errors: string[] = []

    const loadData = instantiateActualLoadData({
      fetchProducts: async () => {
        throw new Error('product endpoint unavailable')
      },
      fetchCustomers: async () => freshCustomers,
      setProducts: (value) => {
        productState = value
      },
      setCustomers: (value) => {
        customerState = value
      },
      setLoading: () => undefined,
      toast: {
        error: (message) => {
          errors.push(message)
        },
      },
    })

    await loadData()

    expect(productState).toEqual([{ id: 'existing-product' }])
    expect(customerState).toEqual(freshCustomers)
    expect(errors).toEqual(['ไม่สามารถโหลดข้อมูลบางส่วนได้'])
  })

  test('3. applies both successful results without an error', async () => {
    const freshProducts = [{ id: 'product-1' }]
    const freshCustomers = [{ id: 'customer-1' }]
    let productState: unknown = []
    let customerState: unknown = []
    const errors: string[] = []

    const loadData = instantiateActualLoadData({
      fetchProducts: async () => freshProducts,
      fetchCustomers: async () => freshCustomers,
      setProducts: (value) => {
        productState = value
      },
      setCustomers: (value) => {
        customerState = value
      },
      setLoading: () => undefined,
      toast: {
        error: (message) => {
          errors.push(message)
        },
      },
    })

    await loadData()

    expect(productState).toEqual(freshProducts)
    expect(customerState).toEqual(freshCustomers)
    expect(errors).toEqual([])
  })

  test('4. import dialog still uses loadData as the authoritative refresh callback', () => {
    const src = readFileSync(SELL_PAGE_PATH, 'utf8')
    expect(src).toContain('onRefreshAfterImport={loadData}')
  })
})
