import type { Prisma } from '@prisma/client'
import { buildReversalMovement, type ReversibleStockMovement } from './stock-movement-ledger'
import { formatThailandBusinessDate, parseThailandBusinessDate } from './thailand-date'

interface MovementClient {
  stockMovement: {
    findMany(args: unknown): Promise<ReversibleStockMovement[]>
    createMany(args: { data: Prisma.StockMovementCreateManyInput[] }): Promise<unknown>
  }
}

/** Append exact inverse rows. Unique keys make retries safe. */
export async function reverseSourceMovements(
  client: MovementClient,
  sourceType: string,
  sourceId: string,
  kind: 'CANCELLATION_REVERSAL' | 'COMPENSATION_REVERSAL',
  occurredAt: Date,
  reason: string,
): Promise<number> {
  const originals = await client.stockMovement.findMany({
    where: {
      sourceType,
      sourceId,
      reversalOfId: null,
      movementType: { notIn: ['CANCELLATION_REVERSAL', 'COMPENSATION_REVERSAL'] },
    },
  })
  if (originals.length === 0) return 0
  const reversalDate = parseThailandBusinessDate(formatThailandBusinessDate(occurredAt))
  await client.stockMovement.createMany({
    data: originals.map(original => buildReversalMovement(original, kind, reason, reversalDate)) as Prisma.StockMovementCreateManyInput[],
  })
  return originals.length
}
