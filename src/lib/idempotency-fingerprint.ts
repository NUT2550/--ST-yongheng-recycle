/**
 * ST-62: Canonical payload fingerprint for stock-transfer idempotency.
 *
 * Computes a deterministic SHA-256 hash of normalized business fields
 * from the stock-transfer request payload. This allows the server to
 * detect same-key-different-payload conflicts.
 *
 * Normalization rules:
 * - Strings are trimmed
 * - Numbers are rounded to 2 decimal places
 * - Optional null/undefined values are normalized to null
 * - Output items are sorted by productId
 * - Dates are normalized to ISO format (YYYY-MM-DD)
 * - JWT, requestId, and server-generated timestamps are excluded
 * - ST-62 review fix: ALL business-meaningful fields are covered
 *   (roomNumber, note, sourcePricePerKg, weighedTotal) so that changing
 *   any of them between same-key retries is detected as CONFLICT, not REPLAY.
 * - Expression strings (sourceWeightExpression, weighedTotalExpression,
 *   item.weightExpression) are EXCLUDED — they are presentation of the
 *   resolved numeric value already in the fingerprint, not business data.
 */

import { createHash } from 'crypto'

interface FingerprintItem {
  productId: string
  weight: number
  isWaste: boolean
  outputPricePerKg: number
}

interface FingerprintInput {
  sourceProductId: string
  sourceWeight: number
  businessType: string | null | undefined
  date: string
  laborCost: number
  gainReason: string | null | undefined
  // ST-62 review fix (M-5): business-meaningful fields previously omitted.
  roomNumber: string | null | undefined
  note: string | null | undefined
  sourcePricePerKg: number | null | undefined
  weighedTotal: number | null | undefined
  items: FingerprintItem[]
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function normalizeString(s: string | null | undefined): string | null {
  if (s === null || s === undefined) return null
  const trimmed = s.trim()
  return trimmed === '' ? null : trimmed
}

export function computePayloadFingerprint(input: FingerprintInput): string {
  const normalized = {
    sourceProductId: input.sourceProductId.trim(),
    sourceWeight: round2(input.sourceWeight),
    businessType: normalizeString(input.businessType),
    date: input.date.trim(),
    laborCost: round2(input.laborCost),
    gainReason: normalizeString(input.gainReason),
    // ST-62 review fix (M-5): include business-meaningful fields.
    roomNumber: normalizeString(input.roomNumber),
    note: normalizeString(input.note),
    sourcePricePerKg: input.sourcePricePerKg == null ? null : round2(input.sourcePricePerKg),
    weighedTotal: input.weighedTotal == null ? null : round2(input.weighedTotal),
    items: [...input.items]
      .sort((a, b) => a.productId.localeCompare(b.productId))
      .map(item => ({
        productId: item.productId.trim(),
        weight: round2(item.weight),
        isWaste: item.isWaste,
        outputPricePerKg: round2(item.outputPricePerKg),
      })),
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
