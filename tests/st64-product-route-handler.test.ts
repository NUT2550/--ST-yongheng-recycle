import { describe, expect, test } from 'bun:test'
import {
  handleProductCreationPost,
  productCreationFailureResponse,
} from '../src/lib/product-creation-route-handler'
import type { ProductCreationDependencies } from '../src/lib/product-creation-service'

function dependencies(
  overrides: Partial<ProductCreationDependencies> = {},
): ProductCreationDependencies {
  return {
    listConflictCandidates: async () => [],
    categoryExists: async () => true,
    createProduct: async input => ({ id: 'new-product', ...input }),
    isUniqueConstraintError: () => false,
    ...overrides,
  }
}

describe('ST-64 Product POST route handler', () => {
  test('1. injected dependencies execute and controller status/body pass through unchanged', async () => {
    let listCalls = 0
    let categoryCalls = 0
    let createCalls = 0
    const response = await handleProductCreationPost(
      { name: 'สินค้าใหม่', categoryId: 'cat', defaultBuyPrice: 2 },
      dependencies({
        listConflictCandidates: async () => { listCalls += 1; return [] },
        categoryExists: async () => { categoryCalls += 1; return true },
        createProduct: async input => {
          createCalls += 1
          return { id: 'created', ...input }
        },
      }),
    )

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      product: {
        id: 'created',
        name: 'สินค้าใหม่',
        categoryId: 'cat',
        defaultBuyPrice: 2,
        sortOrder: 99,
      },
    })
    expect({ listCalls, categoryCalls, createCalls }).toEqual({
      listCalls: 1,
      categoryCalls: 1,
      createCalls: 1,
    })
  })

  test('2. conflict status/body preserve the backward-compatible error field', async () => {
    const response = await handleProductCreationPost(
      { name: 'อะไหล่', categoryId: 'cat' },
      dependencies({
        listConflictCandidates: async () => [{
          id: 'existing',
          name: 'อะไหล่',
          category: { id: 'steel', name: 'เหล็ก' },
        }],
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('มีสินค้า “อะไหล่” อยู่แล้วในหมวด “เหล็ก”')
    expect(body.code).toBe('PRODUCT_NAME_CONFLICT')
    expect(body.conflict.productId).toBe('existing')
  })

  test('3. unexpected dependency exception returns safe 500 and logs internally only', async () => {
    const internal = new Error('Prisma database URL password=secret')
    const logs: unknown[] = []
    const response = await handleProductCreationPost(
      { name: 'new', categoryId: 'cat' },
      dependencies({
        listConflictCandidates: async () => { throw internal },
        logInternalError: (_message, error) => { logs.push(error) },
      }),
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
      code: 'PRODUCT_CREATE_FAILED',
    })
    expect(JSON.stringify(body)).not.toContain('Prisma')
    expect(JSON.stringify(body)).not.toContain('password')
    expect(logs).toEqual([internal])
  })

  test('4. outer malformed-body failure response is safe and stable', async () => {
    const response = productCreationFailureResponse()
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      error: 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่ภายหลัง',
      code: 'PRODUCT_CREATE_FAILED',
    })
  })
})
