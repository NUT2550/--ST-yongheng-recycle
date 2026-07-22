import { describe, expect, test } from 'bun:test'
import {
  createProductController,
  findProductConflict,
  submitProductOnce,
  type ProductConflictCandidate,
  type ProductCreationDependencies,
} from '../src/lib/product-creation-service'

const existing: ProductConflictCandidate = {
  id: 'product-parts',
  name: 'อะไหล่',
  category: { id: 'cat-steel', name: 'เหล็ก' },
}

function deps(overrides: Partial<ProductCreationDependencies> = {}): ProductCreationDependencies {
  return {
    listConflictCandidates: async () => [existing],
    categoryExists: async () => true,
    createProduct: async input => ({ id: 'new-product', ...input }),
    isUniqueConstraintError: () => false,
    ...overrides,
  }
}

describe('ST-64 Product conflict identification', () => {
  test('1. exact duplicate returns the existing product identity and category', async () => {
    const result = await createProductController({ name: 'อะไหล่', categoryId: 'cat-other' }, deps())
    expect(result.status).toBe(409)
    if (result.status !== 409) throw new Error('expected conflict')
    expect(result.body.code).toBe('PRODUCT_NAME_CONFLICT')
    expect(result.body.conflict).toMatchObject({
      productId: 'product-parts', productName: 'อะไหล่', categoryName: 'เหล็ก',
      status: 'ACTIVE', matchType: 'EXACT_NAME',
    })
    expect(result.body.error).toContain('หมวด “เหล็ก”')
  })

  test('2. trimmed duplicate is blocked as a normalized conflict', async () => {
    const result = await createProductController({ name: '  อะไหล่  ', categoryId: 'cat-other' }, deps())
    expect(result.status).toBe(409)
  })

  test('3. Unicode/case/whitespace-normalized duplicate is blocked', () => {
    const conflict = findProductConflict('Ａ  B', [{
      id: 'p', name: 'a b', category: { id: 'c', name: 'อื่นๆ' },
    }])
    expect(conflict?.matchType).toBe('NORMALIZED_NAME')
  })

  test('4. alias conflict identifies both alias and canonical Product', async () => {
    const aliasProduct = { ...existing, name: 'อะไหล่รถ', aliases: ['อะไหล่'] }
    const result = await createProductController(
      { name: 'อะไหล่', categoryId: 'cat-other' },
      deps({ listConflictCandidates: async () => [aliasProduct] }),
    )
    expect(result.status).toBe(409)
    if (result.status !== 409) throw new Error('expected conflict')
    expect(result.body.code).toBe('PRODUCT_ALIAS_CONFLICT')
    expect(result.body.conflict).toMatchObject({ matchType: 'ALIAS', matchedAlias: 'อะไหล่' })
  })

  test('5. inactive Product remains a conflict and recommends reactivation', async () => {
    const result = await createProductController(
      { name: 'อะไหล่', categoryId: 'cat-other' },
      deps({ listConflictCandidates: async () => [{ ...existing, isActive: false }] }),
    )
    expect(result.status).toBe(409)
    if (result.status !== 409) throw new Error('expected conflict')
    expect(result.body.conflict?.status).toBe('INACTIVE')
    expect(result.body.error).toContain('เปิดใช้งานเดิม')
  })

  test('6. a unique Product is created successfully', async () => {
    const result = await createProductController(
      { name: 'สินค้าใหม่', categoryId: 'cat-other', defaultBuyPrice: 2 },
      deps({ listConflictCandidates: async () => [] }),
    )
    expect(result.status).toBe(201)
    if (result.status !== 201) throw new Error('expected creation')
    expect(result.body.product).toMatchObject({ name: 'สินค้าใหม่', defaultBuyPrice: 2 })
  })
})

describe('ST-64 Product UI single-flight behavior', () => {
  test('7. one UI submit emits exactly one POST callback', async () => {
    const lock = { current: false }
    let posts = 0
    await submitProductOnce(lock, async () => { posts += 1 })
    expect(posts).toBe(1)
  })

  test('8. a double click is blocked while the first request is loading', async () => {
    const lock = { current: false }
    let posts = 0
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const first = submitProductOnce(lock, async () => { posts += 1; await pending })
    const second = submitProductOnce(lock, async () => { posts += 1 })
    expect(await second).toBeUndefined()
    expect(posts).toBe(1)
    release()
    await first
  })
})

describe('ST-64 safe API errors', () => {
  test('9. 409 response contains an understandable conflict message', async () => {
    const result = await createProductController({ name: 'อะไหล่', categoryId: 'cat-other' }, deps())
    expect(result.status).toBe(409)
    if (result.status !== 409) throw new Error('expected conflict')
    expect(result.body.error).toBe('มีสินค้า “อะไหล่” อยู่แล้วในหมวด “เหล็ก”')
  })

  test('10. database details are not exposed for P2002 or unknown failures', async () => {
    const p2002 = await createProductController(
      { name: 'race', categoryId: 'cat-other' },
      deps({
        listConflictCandidates: async () => [],
        createProduct: async () => { throw new Error('Unique constraint failed on Product_name_key') },
        isUniqueConstraintError: () => true,
      }),
    )
    expect(p2002.status).toBe(409)
    expect(JSON.stringify(p2002.body)).not.toContain('Product_name_key')

    const unknown = await createProductController(
      { name: 'new', categoryId: 'cat-other' },
      deps({
        listConflictCandidates: async () => [],
        createProduct: async () => { throw new Error('postgres password=secret') },
      }),
    )
    expect(unknown.status).toBe(500)
    expect(JSON.stringify(unknown.body)).not.toContain('postgres')
    expect(JSON.stringify(unknown.body)).not.toContain('secret')
  })
})

