export interface CombinedHistoryRow {
  id: string
  date: Date
  createdAt: Date
}

export const MAX_COMBINED_HISTORY_LIMIT = 100
export const MAX_COMBINED_HISTORY_WINDOW = 1000

export type HistoryPaginationResult =
  | { ok: true; page: number; limit: number; skip: number; window: number }
  | { ok: false; code: 'INVALID_PAGINATION' | 'PAGINATION_WINDOW_EXCEEDED'; error: string }

function parsePositiveInteger(raw: string | null, fallback: number): number | null {
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return Number.isSafeInteger(value) && value > 0 ? value : null
}

export function parseHistoryPagination(
  rawPage: string | null,
  rawLimit: string | null,
): HistoryPaginationResult {
  const page = parsePositiveInteger(rawPage, 1)
  const limit = parsePositiveInteger(rawLimit, 20)
  if (page === null || limit === null || limit > MAX_COMBINED_HISTORY_LIMIT) {
    return {
      ok: false,
      code: 'INVALID_PAGINATION',
      error: `page และ limit ต้องเป็นจำนวนเต็มบวก และ limit ต้องไม่เกิน ${MAX_COMBINED_HISTORY_LIMIT}`,
    }
  }
  const window = page * limit
  if (!Number.isSafeInteger(window) || window > MAX_COMBINED_HISTORY_WINDOW) {
    return {
      ok: false,
      code: 'PAGINATION_WINDOW_EXCEEDED',
      error: `รองรับการเรียกดูประวัติครั้งละไม่เกิน ${MAX_COMBINED_HISTORY_WINDOW} รายการ`,
    }
  }
  return { ok: true, page, limit, skip: (page - 1) * limit, window }
}

interface CombinedHistoryPageInput<T extends CombinedHistoryRow> {
  sources: T[][]
  page: number
  limit: number
  total: number
}

function compareHistoryRows(a: CombinedHistoryRow, b: CombinedHistoryRow): number {
  const byBusinessDate = b.date.getTime() - a.date.getTime()
  if (byBusinessDate !== 0) return byBusinessDate

  const byCreatedAt = b.createdAt.getTime() - a.createdAt.getTime()
  if (byCreatedAt !== 0) return byCreatedAt

  return b.id.localeCompare(a.id)
}

/**
 * Merge the leading window from each history source before applying the
 * combined offset. Callers must fetch `skip + limit` rows from every source.
 */
export function buildCombinedHistoryPage<T extends CombinedHistoryRow>(
  input: CombinedHistoryPageInput<T>,
): { rows: T[]; total: number } {
  const page = Math.max(1, input.page)
  const limit = Math.max(1, input.limit)
  const skip = (page - 1) * limit

  const rows = input.sources
    .flat()
    .sort(compareHistoryRows)
    .slice(skip, skip + limit)

  return { rows, total: input.total }
}
