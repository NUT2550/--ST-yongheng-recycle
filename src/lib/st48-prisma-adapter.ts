import type { Prisma, PrismaClient } from '@prisma/client'
import type { AuditInput, DurableOperation, ExecutorAdapter, PersistedLot, TransactionClient } from './st48-executor'

type PrismaTransaction = Prisma.TransactionClient

function client(tx: PrismaTransaction): TransactionClient {
  return {
    async findOperation(requestId): Promise<DurableOperation | null> {
      return tx.compensationOperation.findUnique({ where: { requestId }, select: { requestId: true, operationType: true, sourceEntityId: true, status: true } })
    },
    async createOperation(operation): Promise<void> {
      await tx.compensationOperation.create({ data: operation })
    },
    async completeOperation(requestId): Promise<void> {
      await tx.compensationOperation.update({ where: { requestId }, data: { status: 'COMPLETED', completedAt: new Date() } })
    },
    async loadLots(ids): Promise<PersistedLot[]> {
      return tx.stockLot.findMany({ where: { id: { in: [...ids] } }, select: { id: true, productId: true, source: true, sourceId: true, remainingWeight: true, costPerKg: true } })
    },
    async loadRevaluationEvidence(lotId, releaseOperationId): Promise<{ productId: string; sourceType: string; sourceId: string | null } | null> {
      const audits = await tx.auditLog.findMany({ where: { entityType: 'STOCK_LOT', entityId: lotId, action: 'REVALUE' }, select: { details: true }, orderBy: { createdAt: 'desc' } })
      for (const audit of audits) {
        if (!audit.details) continue
        let value: unknown
        try { value = JSON.parse(audit.details) } catch { continue }
        if (typeof value !== 'object' || value === null) continue
        const details = value as Record<string, unknown>
        if (details.operationId === releaseOperationId && typeof details.productId === 'string' && typeof details.sourceType === 'string' && (typeof details.sourceId === 'string' || details.sourceId === null)) {
          return { productId: details.productId, sourceType: details.sourceType, sourceId: details.sourceId as string | null }
        }
      }
      return null
    },
    async updateLotCost(lotId, expectedCost, proposedCost): Promise<void> {
      const result = await tx.stockLot.updateMany({ where: { id: lotId, costPerKg: expectedCost }, data: { costPerKg: proposedCost } })
      if (result.count !== 1) throw new Error(`Atomic cost guard failed for ${lotId}`)
    },
    async createAudit(input: AuditInput): Promise<void> {
      await tx.auditLog.create({ data: input })
    },
  }
}

export function createSt48PrismaAdapter(db: PrismaClient, databaseIdentity: string | undefined): ExecutorAdapter {
  if (!databaseIdentity) throw new Error('ST48 database identity is required')
  return {
    async databaseIdentity(): Promise<string> { return databaseIdentity },
    async transaction<T>(work: (tx: TransactionClient) => Promise<T>): Promise<T> {
      return db.$transaction(async tx => work(client(tx)), { isolationLevel: 'Serializable' })
    },
  }
}
