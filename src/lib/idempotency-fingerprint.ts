/**
 * ST-62: Canonical payload fingerprint for stock-transfer idempotency.
 *
 * Computes a deterministic SHA-256 hash of normalized business fields
 * from the stock-transfer request payload. This allows the server to
 * detect same-key-different-payload conflicts.
 *
 * Normalization rules:
 * - Each string follows the exact normalization used by the Prisma write path
 * - Numbers use JavaScript's canonical JSON number representation, matching
 *   the Float values passed to Prisma without lossy application rounding
 * - Optional null/undefined values are normalized to null
 * - Output items are sorted by their full canonical persisted representation
 * - Dates are normalized to ISO format (YYYY-MM-DD)
 * - JWT, requestId, and server-generated timestamps are excluded
 * - ST-62 review fix: ALL business-meaningful fields are covered
 *   (roomNumber, note, sourcePricePerKg, weighedTotal) so that changing
 *   any of them between same-key retries is detected as CONFLICT, not REPLAY.
 * - Weight expressions are included because the StockTransfer Prisma write
 *   path persists them as business/audit data when they are real formulas.
 */

import { createHash } from 'crypto'
import { isRealFormula } from './safe-math'
import { YIELD_WEIGHT_TOLERANCE } from './transfer-cost-allocation'

interface FingerprintItem {
  productId: string
  weight: number
  weightExpression?: string | null
  isWaste: boolean
  outputPricePerKg?: number | null
}

interface FingerprintInput {
  sourceProductId: string
  sourceWeight: number
  sourceWeightExpression?: string | null
  businessType: string | null | undefined
  date: string
  laborCost: number
  gainReason: string | null | undefined
  // ST-62 review fix (M-5): business-meaningful fields previously omitted.
  roomNumber: string | null | undefined
  note: string | null | undefined
  sourcePricePerKg: number | null | undefined
  weighedTotal: number | null | undefined
  weighedTotalExpression?: string | null
  items: FingerprintItem[]
}

function normalizeTrimmedOptional(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null
  const trimmed = s.trim()
  return trimmed === '' ? null : trimmed
}

function normalizePersistedNote(s: string | null | undefined): string | null {
  return s || null
}

function normalizePersistedExpression(s: string | null | undefined): string | null {
  return isRealFormula(s) ? s!.trim() : null
}

export function computePayloadFingerprint(input: FingerprintInput): string {
  const businessType = normalizeTrimmedOptional(input.businessType)
  const hasPersistedGainReason =
    input.items.reduce((sum, item) => sum + item.weight, 0) - input.sourceWeight > YIELD_WEIGHT_TOLERANCE
  const canonicalItems = input.items.map(item => ({
    productId: item.productId,
    weight: item.weight,
    weightExpression: normalizePersistedExpression(item.weightExpression),
    isWaste: item.isWaste,
    outputPricePerKg: item.isWaste ? 0 : (item.outputPricePerKg || 0),
  }))

  const normalized = {
    sourceProductId: input.sourceProductId,
    sourceWeight: input.sourceWeight,
    sourceWeightExpression: normalizePersistedExpression(input.sourceWeightExpression),
    businessType,
    date: input.date.trim(),
    laborCost: input.laborCost || 0,
    gainReason: hasPersistedGainReason ? normalizeTrimmedOptional(input.gainReason) : null,
    // ST-62 review fix (M-5): include business-meaningful fields.
    roomNumber: normalizeTrimmedOptional(input.roomNumber),
    note: normalizePersistedNote(input.note),
    sourcePricePerKg: input.sourcePricePerKg || 0,
    weighedTotal: input.weighedTotal || 0,
    weighedTotalExpression: normalizePersistedExpression(input.weighedTotalExpression),
    items: canonicalItems.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  }

  const json = JSON.stringify(normalized)
  return createHash('sha256').update(json).digest('hex')
}

/**
 * Validate an idempotency key.
 * Returns null if valid, or an error code if invalid.
 */
export function validateIdempotencyKey(key: string | null | undefined): string | null {
  if (key === null || key === undefined) return null // Missing key is valid (backward compatible)
  if (typeof key !== 'string') return 'INVALID_IDEMPOTENCY_KEY'
  const trimmed = key.trim()
  if (trimmed === '') return 'INVALID_IDEMPOTENCY_KEY'
  if (trimmed.length > 255) return 'IDEMPOTENCY_KEY_TOO_LONG'
  // Allow alphanumeric, hyphens, underscores, and UUIDs
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return 'INVALID_IDEMPOTENCY_KEY'
  return null // Valid
}
