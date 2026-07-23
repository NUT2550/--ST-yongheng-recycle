import { NextResponse } from 'next/server'
import {
  createProductController,
  type ProductCreationDependencies,
  type ProductCreationResult,
} from './product-creation-service'

export function mapProductCreationResultToResponse(result: ProductCreationResult): Response {
  return NextResponse.json(result.body, { status: result.status })
}

export function productCreationFailureResponse(): Response {
  return NextResponse.json(
    { error: 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่ภายหลัง', code: 'PRODUCT_CREATE_FAILED' },
    { status: 500 },
  )
}

/**
 * Small executable HTTP adapter: inject production/test dependencies, execute
 * the controller, and preserve its status/body contract.
 */
export async function handleProductCreationPost(
  input: unknown,
  deps: ProductCreationDependencies,
): Promise<Response> {
  try {
    return mapProductCreationResultToResponse(
      await createProductController(input, deps),
    )
  } catch (error) {
    deps.logInternalError?.('Product creation request failed', error)
    return productCreationFailureResponse()
  }
}
