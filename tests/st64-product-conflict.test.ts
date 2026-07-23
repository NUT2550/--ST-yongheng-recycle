import { describe, expect, test } from 'bun:test'
import {
  createProductController,
  findProductConflict,
  PRODUCT_NETWORK_ERROR_MESSAGE,
  runProductSubmit,
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

  test('7. exact beats normalized and alias regardless of candidate order', () => {
    const candidates: ProductConflictCandidate[] = [
      { id: 'alias', name: 'Alias product', aliases: ['อะไหล่'], category: existing.category },
      { id: 'normalized', name: '  อะไหล่  ', category: existing.category },
      existing,
    ]
    for (const permutation of permutations(candidates)) {
      expect(findProductConflict('อะไหล่', permutation)?.productId).toBe(existing.id)
    }
  })

  test('8. normalized beats alias regardless of candidate order', () => {
    const candidates: ProductConflictCandidate[] = [
      { id: 'alias', name: 'Alias product', aliases: ['A B'], category: existing.category },
      { id: 'normalized', name: 'a b', category: existing.category },
    ]
    for (const permutation of permutations(candidates)) {
      expect(findProductConflict('Ａ  B', permutation)?.productId).toBe('normalized')
    }
  })

  test('9. normalized ties use normalized name, original name, then Product ID', () => {
    const candidates: ProductConflictCandidate[] = [
      { id: 'z-id', name: 'Ａ B', category: existing.category },
      { id: 'a-id', name: 'A  B', category: existing.category },
      { id: 'b-id', name: 'A  B', category: existing.category },
    ]
    for (const permutation of permutations(candidates)) {
      expect(findProductConflict('a b', permutation)?.productId).toBe('a-id')
    }
  })

  test('10. alias ties and multiple aliases are deterministic', () => {
    const candidates: ProductConflictCandidate[] = [
      { id: 'z-product', name: 'Zulu', aliases: ['Ａ B', 'A  B'], category: existing.category },
      { id: 'a-product', name: 'Alpha', aliases: ['a b'], category: existing.category },
    ]
    for (const permutation of permutations(candidates)) {
      expect(findProductConflict('a b', permutation)).toMatchObject({
        productId: 'a-product',
        matchedAlias: 'a b',
      })
    }
  })

  test('11. empty aliases are safe and candidate order is not mutated', () => {
    const candidates: ProductConflictCandidate[] = [
      { id: 'b', name: 'other', aliases: [], category: existing.category },
      { id: 'a', name: 'a b', category: existing.category },
    ]
    const originalIds = candidates.map(candidate => candidate.id)
    expect(findProductConflict('Ａ B', candidates)?.productId).toBe('a')
    expect(candidates.map(candidate => candidate.id)).toEqual(originalIds)
  })
})

describe('ST-64 Product UI single-flight behavior', () => {
  test('12. one UI submit emits exactly one POST callback', async () => {
    const lock = { current: false }
    let posts = 0
    await submitProductOnce(lock, async () => { posts += 1 })
    expect(posts).toBe(1)
  })

  test('13. a double click is blocked while the first request is loading', async () => {
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

  test('14. network rejection shows one safe message and releases loading/lock', async () => {
    const state = makeSubmitState(async () => { throw new Error('raw socket URL secret') })
    await expect(runProductSubmit(state.lock, state.callbacks)).resolves.toBe('NETWORK_ERROR')
    expect(state.errors).toEqual([PRODUCT_NETWORK_ERROR_MESSAGE])
    expect(state.errors.join(' ')).not.toContain('socket')
    expect(state.loading).toEqual([true, false])
    expect(state.lock.current).toBe(false)
  })

  test('15. a second attempt can succeed after network rejection', async () => {
    let attempts = 0
    const state = makeSubmitState(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('offline')
      return response(true, {})
    })
    expect(await runProductSubmit(state.lock, state.callbacks)).toBe('NETWORK_ERROR')
    expect(await runProductSubmit(state.lock, state.callbacks)).toBe('SUCCESS')
    expect(attempts).toBe(2)
    expect(state.successes).toBe(1)
  })

  test('16. HTTP 409 and 500 use the server error message without duplicate toast', async () => {
    for (const message of ['มีสินค้าอยู่แล้ว', 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่ภายหลัง']) {
      const state = makeSubmitState(async () => response(false, { error: message }))
      expect(await runProductSubmit(state.lock, state.callbacks)).toBe('SERVER_ERROR')
      expect(state.errors).toEqual([message])
      expect(state.successes).toBe(0)
    }
  })

  test('17. success runs reset/refresh callback and releases loading', async () => {
    const state = makeSubmitState(async () => response(true, { product: { id: 'new' } }))
    expect(await runProductSubmit(state.lock, state.callbacks)).toBe('SUCCESS')
    expect(state.successes).toBe(1)
    expect(state.errors).toEqual([])
    expect(state.loading).toEqual([true, false])
    expect(state.lock.current).toBe(false)
  })

  test('18. concurrent UI submission is ignored while request is pending', async () => {
    let release!: () => void
    const pending = new Promise<void>(resolve => { release = resolve })
    const state = makeSubmitState(async () => {
      await pending
      return response(true, {})
    })
    const first = runProductSubmit(state.lock, state.callbacks)
    expect(await runProductSubmit(state.lock, state.callbacks)).toBe('IGNORED')
    expect(state.requests).toBe(1)
    release()
    expect(await first).toBe('SUCCESS')
  })
})

describe('ST-64 safe API errors', () => {
  test('19. 409 response contains an understandable conflict message', async () => {
    const result = await createProductController({ name: 'อะไหล่', categoryId: 'cat-other' }, deps())
    expect(result.status).toBe(409)
    if (result.status !== 409) throw new Error('expected conflict')
    expect(result.body.error).toBe('มีสินค้า “อะไหล่” อยู่แล้วในหมวด “เหล็ก”')
  })

  test('20. database details are not exposed for P2002 or unknown failures', async () => {
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

  test('21. malformed and invalid inputs return safe 400 responses', async () => {
    for (const input of [null, [], 'bad', {}, { name: '   ', categoryId: 'cat' }]) {
      const result = await createProductController(input, deps())
      expect(result.status).toBe(400)
      expect(JSON.stringify(result.body)).not.toContain('TypeError')
    }
    const invalidCategory = await createProductController(
      { name: 'new', categoryId: 'missing' },
      deps({ listConflictCandidates: async () => [], categoryExists: async () => false }),
    )
    expect(invalidCategory).toEqual({
      status: 400,
      body: { error: 'หมวดหมู่ไม่ถูกต้อง', code: 'INVALID_CATEGORY' },
    })
  })

  test('22. success and conflict preserve backward-compatible response shapes', async () => {
    const success = await createProductController(
      { name: 'new', categoryId: 'cat' },
      deps({ listConflictCandidates: async () => [] }),
    )
    expect(success.status).toBe(201)
    expect(success.body).toHaveProperty('product')

    const conflict = await createProductController(
      { name: 'อะไหล่', categoryId: 'cat' },
      deps(),
    )
    expect(conflict.status).toBe(409)
    expect(conflict.body).toHaveProperty('error')
  })
})

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()]
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)])
      .map(rest => [item, ...rest]))
}

function response(ok: boolean, body: unknown) {
  return { ok, json: async () => body }
}

function makeSubmitState(request: () => Promise<ReturnType<typeof response>>) {
  const lock = { current: false }
  const errors: string[] = []
  const loading: boolean[] = []
  let requests = 0
  let successes = 0
  return {
    lock,
    errors,
    loading,
    get requests() { return requests },
    get successes() { return successes },
    callbacks: {
      request: async () => {
        requests += 1
        return request()
      },
      setLoading: (value: boolean) => { loading.push(value) },
      showError: (message: string) => { errors.push(message) },
      onSuccess: () => { successes += 1 },
    },
  }
}
