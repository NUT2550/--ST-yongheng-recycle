/**
 * ST-8: Canonical bill-number identity helpers.
 *
 * Lowest-level shared module — no imports from bill-services, import-pipeline,
 * Prisma, React, or Next.js. Everything else imports from here.
 *
 * Dependency direction:
 *   bill-identity.ts → bill-errors.ts → bill-services.ts / import-pipeline.ts → routes/UI
 */

/**
 * Normalize a bill number for identity comparison and storage.
 *
 * Rules:
 *   - trim leading/trailing whitespace
 *   - collapse internal Unicode whitespace (tabs, newlines, etc.) to single spaces
 *   - preserve case (bill numbers are case-sensitive)
 *   - preserve leading zeroes
 *   - preserve `/`, `-`, Thai characters, and all other meaningful characters
 *   - do NOT convert to numeric
 *   - blank/null/undefined → '' (empty string = invalid)
 */
export function normalizeBillNumber(value: unknown): string {
  if (typeof value !== 'string') return ''
  // Collapse all Unicode whitespace sequences to a single space, then trim
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed
}

/**
 * Check if a bill number is blank (empty or whitespace-only).
 * Blank bill numbers are invalid and must not become a shared duplicate identity.
 */
export function isBlankBillNumber(value: unknown): boolean {
  return normalizeBillNumber(value) === ''
}
