/**
 * ST-41: Thailand business-date helpers.
 *
 * The application uses Thailand timezone (UTC+7, ICT) for business dates.
 * JavaScript's `new Date('YYYY-MM-DD')` parses date-only strings as UTC midnight,
 * which can shift the visible business date when converted via `.toISOString()`
 * or displayed in a different timezone. These helpers ensure consistent
 * Thailand business-date handling across UI, API, and storage.
 *
 * Strategy:
 *   - Client sends a date-only ISO string: `YYYY-MM-DD`
 *   - Backend validates the format + real calendar date + not-future (Thailand)
 *   - Backend stores the business date as Thailand-midnight-converted-to-UTC:
 *     `new Date(YYYY-MM-DD + 'T00:00:00+07:00')` → UTC timestamp that represents
 *     the start of that business day in Thailand.
 *   - Reads/history format using Thailand timezone so the business date displays
 *     correctly regardless of the viewer's browser timezone.
 *
 * Pure functions — no DB, no side effects. Used by routes AND tests.
 */

// Thailand timezone offset: UTC+7
const THAILAND_OFFSET_MINUTES = 7 * 60

/**
 * Get today's date in Thailand timezone as a YYYY-MM-DD string.
 * Uses the current UTC time + Thailand offset to determine the Thailand "today".
 *
 * This is safe regardless of the server/browser timezone because it computes
 * from UTC + a fixed offset.
 */
export function getThailandTodayDateString(): string {
  const now = new Date()
  // Convert UTC to Thailand time by adding the offset
  const thailandMs = now.getTime() + THAILAND_OFFSET_MINUTES * 60 * 1000
  const thailandDate = new Date(thailandMs)
  const year = thailandDate.getUTCFullYear()
  const month = String(thailandDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(thailandDate.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Validate that a string is a real calendar date in YYYY-MM-DD format.
 *
 * Checks:
 *   - matches /^\d{4}-\d{2}-\d{2}$/
 *   - is a real calendar date (e.g. rejects 2026-02-30, 2026-13-01)
 *   - handles leap years correctly (2024-02-29 valid, 2025-02-29 invalid)
 *
 * Returns true only if the date is a valid calendar date.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false
  const regex = /^\d{4}-\d{2}-\d{2}$/
  if (!regex.test(dateStr)) return false

  const [yearStr, monthStr, dayStr] = dateStr.split('-')
  const year = parseInt(yearStr, 10)
  const month = parseInt(monthStr, 10)
  const day = parseInt(dayStr, 10)

  // Range checks
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false

  // Real calendar date check: construct the date at UTC noon (avoids TZ shift)
  // and verify the components match (catches 2026-02-30 → March 2 rollover)
  const test = new Date(Date.UTC(year, month - 1, day, 12, 0, 0))
  if (
    test.getUTCFullYear() !== year ||
    test.getUTCMonth() !== month - 1 ||
    test.getUTCDate() !== day
  ) {
    return false
  }

  return true
}

/**
 * Check if a date string is in the future relative to Thailand today.
 * Assumes the input has already been validated with isValidDateString().
 */
export function isFutureThailandDate(dateStr: string): boolean {
  if (!isValidDateString(dateStr)) return false
  const today = getThailandTodayDateString()
  return dateStr > today
}

/**
 * Convert a validated YYYY-MM-DD business date to a UTC Date timestamp
 * representing Thailand midnight of that business date.
 *
 * This ensures the business date does not shift when stored or read back.
 * Example: '2026-07-15' → 2026-07-14T17:00:00.000Z (UTC midnight minus 7h = Thailand midnight)
 *
 * The stored Date will display as 2026-07-15 when formatted in Thailand timezone.
 */
export function parseThailandBusinessDate(dateStr: string): Date {
  // Construct explicitly with +07:00 offset → JS converts to UTC correctly
  return new Date(dateStr + 'T00:00:00+07:00')
}

/**
 * Format a stored Date (UTC timestamp) as a Thailand business-date YYYY-MM-DD string.
 * Uses the Thailand offset to convert the UTC timestamp back to Thailand calendar date.
 */
export function formatThailandBusinessDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  // Convert UTC to Thailand time
  const thailandMs = d.getTime() + THAILAND_OFFSET_MINUTES * 60 * 1000
  const thailandDate = new Date(thailandMs)
  const year = thailandDate.getUTCFullYear()
  const month = String(thailandDate.getUTCMonth() + 1).padStart(2, '0')
  const day = String(thailandDate.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Format a Thailand business date for Thai/Buddhist display: DD/MM/YYYY (Buddhist year).
 * Example: '2026-07-15' → '15/07/2569'
 */
export function formatThailandBuddhistDate(date: Date | string): string {
  const isoStr = formatThailandBusinessDate(date)
  const [year, month, day] = isoStr.split('-')
  const buddhistYear = parseInt(year, 10) + 543
  return `${day}/${month}/${buddhistYear}`
}

/**
 * ST-41: Format a stored UTC date as Thailand date+time for history display.
 * Returns DD/MM/YYYY (Buddhist) HH:MM — Thailand timezone, no browser-TZ dependency.
 *
 * Replaces the browser-local formatDate() for bill dates stored as Thailand
 * business dates (UTC timestamps). The old formatDate() used getDate()/
 * getMonth()/getFullYear() which shift in non-Thailand timezones.
 */
export function formatThailandDateTimeDisplay(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const thailandMs = d.getTime() + THAILAND_OFFSET_MINUTES * 60 * 1000
  const thailandDate = new Date(thailandMs)
  const day = String(thailandDate.getUTCDate()).padStart(2, '0')
  const month = String(thailandDate.getUTCMonth() + 1).padStart(2, '0')
  const year = thailandDate.getUTCFullYear() + 543
  const hours = String(thailandDate.getUTCHours()).padStart(2, '0')
  const minutes = String(thailandDate.getUTCMinutes()).padStart(2, '0')
  return `${day}/${month}/${year} ${hours}:${minutes}`
}


/**
 * ST-41: Check if a business date is before any of the consumed source lot dates.
 *
 * Causality rule: an output StockLot cannot predate its consumed source lots.
 * If the selected business date is earlier than any source lot's dateAdded,
 * the output would chronologically predate its input — a causality violation.
 *
 * @param businessDateStr - YYYY-MM-DD business date
 * @param sourceLotDates - array of Date objects (dateAdded of consumed source lots)
 * @returns { violated: boolean, latestSourceDate: string, violatingLotIndex: number }
 */
export function checkSourceLotCausality(
  businessDateStr: string,
  sourceLotDates: Date[]
): { violated: boolean; latestSourceDateStr: string; latestSourceDateMs: number } {
  // Find the latest source lot date (by raw timestamp)
  let latestMs = 0
  for (const lotDate of sourceLotDates) {
    if (lotDate.getTime() > latestMs) latestMs = lotDate.getTime()
  }
  // Convert the latest source lot date to a Thailand business-date string (YYYY-MM-DD)
  // This normalizes away the time-of-day component — we compare CALENDAR dates, not timestamps
  const latestSourceDateStr = formatThailandBusinessDate(new Date(latestMs))
  // Violation: business date is STRICTLY BEFORE the latest source lot's calendar date
  // String comparison on YYYY-MM-DD works correctly for calendar date ordering
  return {
    violated: businessDateStr < latestSourceDateStr,
    latestSourceDateStr,
    latestSourceDateMs: latestMs,
  }
}
