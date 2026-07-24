export interface CombinedHistoryRow {
  id: string
  date: Date
  createdAt: Date
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
