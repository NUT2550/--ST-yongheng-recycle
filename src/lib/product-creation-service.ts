export type ProductConflictMatch = 'EXACT_NAME' | 'NORMALIZED_NAME' | 'ALIAS'

export interface ProductConflictCandidate {
  id: string
  name: string
  category: { id: string; name: string }
  aliases?: string[]
  isActive?: boolean
}

export interface CreateProductInput {
  name?: string
  categoryId?: string
  defaultBuyPrice?: number
  sortOrder?: number
}

export interface ProductCreationDependencies {
  listConflictCandidates(): Promise<ProductConflictCandidate[]>
  categoryExists(categoryId: string): Promise<boolean>
  createProduct(input: {
    name: string
    categoryId: string
    defaultBuyPrice: number
    sortOrder: number
  }): Promise<unknown>
  isUniqueConstraintError(error: unknown): boolean
  logInternalError?(message: string, error: unknown): void
}

export interface ProductConflict {
  productId: string
  productName: string
  categoryId: string
  categoryName: string
  status: 'ACTIVE' | 'INACTIVE'
  matchType: ProductConflictMatch
  matchedAlias?: string
}

export type ProductCreationResult =
  | { status: 201; body: { product: unknown } }
  | { status: 400; body: { error: string; code: 'INVALID_INPUT' | 'INVALID_CATEGORY' } }
  | {
      status: 409
      body: {
        error: string
        code: 'PRODUCT_NAME_CONFLICT' | 'PRODUCT_ALIAS_CONFLICT'
        conflict?: ProductConflict
      }
    }
  | { status: 500; body: { error: string; code: 'PRODUCT_CREATE_FAILED' } }

/**
 * Product identity comparison used before creation. NFKC handles canonical and
 * compatibility Unicode variants; whitespace is collapsed so visually-identical
 * names cannot bypass the conflict check.
 */
export function normalizeProductName(value: string): string {
  return value.trim().normalize('NFKC').replace(/\s+/g, ' ').toLocaleLowerCase('th-TH')
}

export function findProductConflict(
  requestedName: string,
  candidates: ProductConflictCandidate[],
): ProductConflict | null {
  const trimmed = requestedName.trim()
  const normalized = normalizeProductName(trimmed)

  for (const candidate of candidates) {
    const matchType: ProductConflictMatch | null =
      candidate.name === trimmed
        ? 'EXACT_NAME'
        : normalizeProductName(candidate.name) === normalized
          ? 'NORMALIZED_NAME'
          : null

    if (matchType) {
      return {
        productId: candidate.id,
        productName: candidate.name,
        categoryId: candidate.category.id,
        categoryName: candidate.category.name,
        status: candidate.isActive === false ? 'INACTIVE' : 'ACTIVE',
        matchType,
      }
    }

    const matchedAlias = candidate.aliases?.find(
      alias => normalizeProductName(alias) === normalized,
    )
    if (matchedAlias) {
      return {
        productId: candidate.id,
        productName: candidate.name,
        categoryId: candidate.category.id,
        categoryName: candidate.category.name,
        status: candidate.isActive === false ? 'INACTIVE' : 'ACTIVE',
        matchType: 'ALIAS',
        matchedAlias,
      }
    }
  }

  return null
}

function conflictResult(conflict: ProductConflict): ProductCreationResult {
  const inactiveGuidance = conflict.status === 'INACTIVE'
    ? ' สินค้านี้ถูกปิดใช้งาน กรุณาใช้ขั้นตอนเปิดใช้งานเดิมแทนการสร้างซ้ำ'
    : ''

  if (conflict.matchType === 'ALIAS') {
    return {
      status: 409,
      body: {
        error: `ชื่อที่กรอกตรงกับ alias “${conflict.matchedAlias}” ของสินค้า “${conflict.productName}” (หมวด ${conflict.categoryName})${inactiveGuidance}`,
        code: 'PRODUCT_ALIAS_CONFLICT',
        conflict,
      },
    }
  }

  return {
    status: 409,
    body: {
      error: `มีสินค้า “${conflict.productName}” อยู่แล้วในหมวด “${conflict.categoryName}”${inactiveGuidance}`,
      code: 'PRODUCT_NAME_CONFLICT',
      conflict,
    },
  }
}

export async function createProductController(
  input: CreateProductInput,
  deps: ProductCreationDependencies,
): Promise<ProductCreationResult> {
  const name = input.name?.trim() ?? ''
  if (!name) {
    return { status: 400, body: { error: 'กรุณากรอกชื่อสินค้า', code: 'INVALID_INPUT' } }
  }
  if (!input.categoryId) {
    return { status: 400, body: { error: 'กรุณาเลือกหมวดหมู่', code: 'INVALID_INPUT' } }
  }

  const candidates = await deps.listConflictCandidates()
  const conflict = findProductConflict(name, candidates)
  if (conflict) return conflictResult(conflict)

  if (!(await deps.categoryExists(input.categoryId))) {
    return { status: 400, body: { error: 'หมวดหมู่ไม่ถูกต้อง', code: 'INVALID_CATEGORY' } }
  }

  try {
    const product = await deps.createProduct({
      name,
      categoryId: input.categoryId,
      defaultBuyPrice: typeof input.defaultBuyPrice === 'number' ? input.defaultBuyPrice : 0,
      sortOrder: typeof input.sortOrder === 'number' ? input.sortOrder : 99,
    })
    return { status: 201, body: { product } }
  } catch (error) {
    deps.logInternalError?.('Product creation failed', error)
    if (deps.isUniqueConstraintError(error)) {
      const refreshed = findProductConflict(name, await deps.listConflictCandidates())
      if (refreshed) return conflictResult(refreshed)
      return {
        status: 409,
        body: {
          error: 'ชื่อสินค้าชนกับข้อมูลที่มีอยู่ กรุณารีเฟรชรายการแล้วตรวจสอบอีกครั้ง',
          code: 'PRODUCT_NAME_CONFLICT',
        },
      }
    }

    return {
      status: 500,
      body: { error: 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่ภายหลัง', code: 'PRODUCT_CREATE_FAILED' },
    }
  }
}

export interface ProductSubmitLock { current: boolean }

/** Single-flight guard shared by the Product UI and executable tests. */
export async function submitProductOnce<T>(
  lock: ProductSubmitLock,
  submit: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.current) return undefined
  lock.current = true
  try {
    return await submit()
  } finally {
    lock.current = false
  }
}
