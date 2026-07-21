import { Prisma } from '@prisma/client'
import { SourceLotConflictError } from './bill-errors'

export interface StockLotCasUpdate {
  id: string
  productId: string
  expectedRemainingWeight: number
  expectedCostPerKg: number
  newRemainingWeight: number
}

export type StockLotBulkCasExecutor = (
  query: Prisma.Sql
) => Promise<Array<{ id: string }>>

function assertFiniteNonNegative(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new SourceLotConflictError()
  }
}

export function validateStockLotCasUpdates(updates: StockLotCasUpdate[]): void {
  if (updates.length === 0) return

  const ids = new Set<string>()
  for (const update of updates) {
    if (!update.id || !update.productId || ids.has(update.id)) {
      throw new SourceLotConflictError()
    }
    ids.add(update.id)
    assertFiniteNonNegative(update.expectedRemainingWeight)
    assertFiniteNonNegative(update.expectedCostPerKg)
    assertFiniteNonNegative(update.newRemainingWeight)
    if (update.newRemainingWeight > update.expectedRemainingWeight) {
      throw new SourceLotConflictError()
    }
  }
}

/** Execute guarded StockLot deductions in one parameterized SQL statement. */
export async function executeStockLotBulkCas(
  execute: StockLotBulkCasExecutor,
  updates: StockLotCasUpdate[]
): Promise<void> {
  validateStockLotCasUpdates(updates)
  if (updates.length === 0) return

  const values = updates.map((update) => Prisma.sql`(
    ${update.id}::text,
    ${update.productId}::text,
    ${update.expectedRemainingWeight}::double precision,
    ${update.expectedCostPerKg}::double precision,
    ${update.newRemainingWeight}::double precision
  )`)

  const returned = await execute(Prisma.sql`
    UPDATE "StockLot" AS lot
    SET "remainingWeight" = updates.new_remaining
    FROM (
      VALUES ${Prisma.join(values)}
    ) AS updates(id, product_id, expected_remaining, expected_cost, new_remaining)
    WHERE lot.id = updates.id
      AND lot."productId" = updates.product_id
      AND lot."remainingWeight" = updates.expected_remaining
      AND lot."costPerKg" = updates.expected_cost
      AND updates.new_remaining >= 0
    RETURNING lot.id
  `)

  const returnedIds = new Set(returned.map((row) => row.id))
  if (
    returned.length !== updates.length ||
    returnedIds.size !== updates.length ||
    updates.some((update) => !returnedIds.has(update.id))
  ) {
    throw new SourceLotConflictError()
  }
}
