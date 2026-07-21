/**
 * ST-8: Shared bill-service error types.
 *
 * No imports from bill-services, import-pipeline, DB adapters, or routes.
 * Dependency direction: bill-errors.ts → bill-services.ts / import-pipeline.ts
 */

/**
 * Thrown when a Prisma P2002 (unique constraint violation) occurs
 * during bill creation. Callers catch this and classify the bill
 * as DUPLICATE_EXISTING (not FAILED).
 */
export class DuplicateExistingError extends Error {
  constructor(public readonly field: string) {
    super(`Duplicate existing: ${field}`)
    this.name = 'DuplicateExistingError'
  }
}

export type BillFailureCode =
  | 'TRANSACTION_TIMEOUT'
  | 'SOURCE_LOT_CONFLICT'
  | 'INSUFFICIENT_STOCK'
  | 'FIFO_VALIDATION_ERROR'
  | 'FIFO_MISMATCH'
  | 'BILL_CREATE_FAILED'

export class CodedBillError extends Error {
  constructor(public readonly code: BillFailureCode, message: string) {
    super(message)
    this.name = 'CodedBillError'
  }
}

export class SourceLotConflictError extends CodedBillError {
  constructor() {
    super('SOURCE_LOT_CONFLICT', 'Source lot changed during transaction')
    this.name = 'SourceLotConflictError'
  }
}

export class InsufficientStockError extends CodedBillError {
  constructor(
    public readonly productId: string,
    public readonly productName: string | undefined,
    public readonly available: number,
    public readonly requested: number,
  ) {
    super('INSUFFICIENT_STOCK', 'Insufficient stock')
    this.name = 'InsufficientStockError'
  }
}

export class FifoValidationError extends CodedBillError {
  constructor() {
    super('FIFO_VALIDATION_ERROR', 'FIFO source cost validation failed')
    this.name = 'FifoValidationError'
  }
}

export class FifoMismatchError extends CodedBillError {
  constructor() {
    super('FIFO_MISMATCH', 'FIFO execution did not match preview')
    this.name = 'FifoMismatchError'
  }
}

/**
 * Check if an error is a Prisma P2002 (unique constraint violation).
 * Works with both Prisma.PrismaClientKnownRequestError and duck-typed errors.
 */
export function isPrismaP2002(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: string }).code
  return code === 'P2002'
}

/**
 * Check if a P2002 error is on a specific unique field.
 * Inspects error.meta.target when available.
 */
export function isP2002OnField(error: unknown, fieldName: string): boolean {
  if (!isPrismaP2002(error)) return false
  const meta = (error as { meta?: { target?: string[] | string } }).meta
  if (!meta?.target) return false
  // Support both string[] and string target shapes
  if (Array.isArray(meta.target)) {
    return meta.target.includes(fieldName)
  }
  if (typeof meta.target === 'string') {
    return meta.target === fieldName
  }
  return false
}
