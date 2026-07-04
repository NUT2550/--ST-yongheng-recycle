/**
 * System-level configuration constants.
 *
 * These are hardcoded values that describe the system's operational context.
 * In the future, these could be moved to a database-backed settings table,
 * but for now they are constants to avoid schema changes.
 */

/**
 * The date when the system's stock tracking became authoritative.
 *
 * Stock balances before this date are not tracked in this system.
 * All stock lots, bills, and movements in the database are from this date onward.
 *
 * Format: ISO date string (AD year) — convert to Buddhist year for display.
 */
export const SYSTEM_STOCK_START_DATE = '2026-06-22' // AD = 22/06/2569 (Buddhist)

/**
 * Get the stock start date in Thai display format (dd/mm/yyyy Buddhist year).
 */
export function getStockStartDateThai(): string {
  const d = new Date(SYSTEM_STOCK_START_DATE)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const buddhistYear = d.getFullYear() + 543
  return `${day}/${month}/${buddhistYear}`
}
