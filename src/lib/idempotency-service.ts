/**
 * ST-62: Idempotency service for durable request-level deduplication.
 *
 * Manages IdempotencyRecord lifecycle: PROCESSING → SUCCEEDED/FAILED.
 * Uses DB unique constraint on key for atomic claim.
 *
 * Stale PROCESSING and FAILED claims are only reclaimed after checking the
 * durable StockTransfer correlation. Reclaim uses an updatedAt/state CAS so
 * concurrent workers cannot both acquire the same abandoned claim.
 */

import type { PrismaClient } from '@prisma/client'

export type IdempotencyState = 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

/**
 * ST-62 review fix (M-3): a PROCESSING record older than this with no
 * committed StockTransfer is considered stuck (the originating request
 * likely crashed before commit) and may be reclaimed by a new request.
 * 5 minutes is well above the longest legitimate stock-transfer transaction
 * (Vercel Pro function timeout is 60s; PgBouncer transaction timeout is
 * shorter) so a live in-flight request is never falsely reclaimed.
 */
export const STALE_PROCESSING_TTL_MS = 5 * 60 * 1000;

export interface IdempotencyClaimResult {
  type: 'NEW' | 'REPLAY' | 'CONFLICT' | 'IN_PROGRESS' | 'RETRY_AFTER_FAILURE'
  record?: {
    key: string
    payloadHash: string
    state: IdempotencyState
    resourceId: string | null
    responseStatus: number | null
    responseBody: string | null
  }
}

export interface IdempotencyRecord {
  key: string
  payloadHash: string
  state: IdempotencyState
  resourceId: string | null
  responseStatus: number | null
  responseBody: string | null
}

async function findCommittedTransfer(db: PrismaClient, key: string): Promise<{ id: string } | null> {
  const transfers = await db.stockTransfer.findMany({
    where: { idempotencyKey: key },
    select: { id: true },
    take: 2,
  })
  if (transfers.length > 1) {
    throw new Error('IDEMPOTENCY_INTEGRITY_VIOLATION: multiple StockTransfer rows share one key')
  }
  return transfers[0] ?? null
}

async function resultAfterLostCas(
  db: PrismaClient,
  key: string,
  payloadHash: string,
): Promise<IdempotencyClaimResult> {
  const winner = await db.idempotencyRecord.findUnique({ where: { key } })
  if (!winner) {
    throw new Error('IDEMPOTENCY_CLAIM_DISAPPEARED')
  }
  if (winner.payloadHash !== payloadHash) {
    return { type: 'CONFLICT', record: toRecord(winner) }
  }
  if (winner.state === 'SUCCEEDED') {
    return { type: 'REPLAY', record: toRecord(winner) }
  }
  return { type: 'IN_PROGRESS', record: toRecord(winner) }
}

/**
 * Attempt to claim an idempotency key.
 * Returns NEW if the key was successfully claimed (inserted as PROCESSING).
 * Returns REPLAY if a SUCCEEDED record with the same payload hash exists.
 * Returns CONFLICT if a SUCCEEDED record with a different payload hash exists.
 * Returns IN_PROGRESS if a PROCESSING record exists.
 * Returns RETRY_AFTER_FAILURE if a FAILED record exists (and deletes it).
 */
export async function claimIdempotency(
  db: PrismaClient,
  key: string,
  payloadHash: string,
  operationType: string,
): Promise<IdempotencyClaimResult> {
  // Check for existing record
  const existing = await db.idempotencyRecord.findUnique({
    where: { key },
  })

  if (existing) {
    if (existing.state === 'SUCCEEDED') {
      if (existing.payloadHash === payloadHash) {
        return { type: 'REPLAY', record: toRecord(existing) }
      }
      return { type: 'CONFLICT', record: toRecord(existing) }
    }
    if (existing.state === 'PROCESSING') {
      if (existing.payloadHash !== payloadHash) {
        return { type: 'CONFLICT', record: toRecord(existing) }
      }

      // Always check durable business state before permitting any retry.
      const committed = await findCommittedTransfer(db, key)
      if (committed) {
        return { type: 'IN_PROGRESS', record: toRecord(existing) }
      }

      const ageMs = Date.now() - existing.updatedAt.getTime()
      if (ageMs >= STALE_PROCESSING_TTL_MS) {
        const reclaimed = await db.idempotencyRecord.updateMany({
          where: {
            id: existing.id,
            state: 'PROCESSING',
            updatedAt: existing.updatedAt,
          },
          data: {
            payloadHash,
            operationType,
            updatedAt: new Date(),
            resourceId: null,
            responseStatus: null,
            responseBody: null,
            errorMessage: null,
            completedAt: null,
          },
        })
        if (reclaimed.count === 1) {
          return { type: 'NEW' }
        }
        return resultAfterLostCas(db, key, payloadHash)
      } else {
        return { type: 'IN_PROGRESS', record: toRecord(existing) }
      }
    }
    if (existing.state === 'FAILED') {
      // A FAILED row may have been written by older code for an ambiguous
      // commit. Durable correlation must be checked before reclaiming it.
      const committed = await findCommittedTransfer(db, key)
      if (committed) {
        if (existing.payloadHash !== payloadHash) {
          return { type: 'CONFLICT', record: toRecord(existing) }
        }
        return { type: 'IN_PROGRESS', record: toRecord(existing) }
      }
      const reclaimed = await db.idempotencyRecord.updateMany({
        where: { id: existing.id, state: 'FAILED', updatedAt: existing.updatedAt },
        data: {
          state: 'PROCESSING',
          payloadHash,
          operationType,
          updatedAt: new Date(),
          resourceId: null,
          responseStatus: null,
          responseBody: null,
          errorMessage: null,
          completedAt: null,
        },
      })
      if (reclaimed.count === 1) {
        return { type: 'NEW' }
      }
      return resultAfterLostCas(db, key, payloadHash)
    }
  }

  // Create new PROCESSING record
  try {
    const record = await db.idempotencyRecord.create({
      data: {
        key,
        operationType,
        payloadHash,
        state: 'PROCESSING',
      },
    })
    return { type: 'NEW' }
  } catch (err: unknown) {
    // P2002 = unique constraint violation — concurrent request won the claim
    const code = (err as { code?: string })?.code
    if (code === 'P2002') {
      // Re-read to determine the winner's state
      const winner = await db.idempotencyRecord.findUnique({ where: { key } })
      if (winner) {
        if (winner.state === 'PROCESSING') {
          return { type: 'IN_PROGRESS', record: toRecord(winner) }
        }
        if (winner.state === 'SUCCEEDED') {
          if (winner.payloadHash === payloadHash) {
            return { type: 'REPLAY', record: toRecord(winner) }
          }
          return { type: 'CONFLICT', record: toRecord(winner) }
        }
      }
      // Race: record was deleted between our read and create
      // Retry the create once
      const retry = await db.idempotencyRecord.create({
        data: { key, operationType, payloadHash, state: 'PROCESSING' },
      })
      return { type: 'NEW' }
    }
    throw err
  }
}

/**
 * Mark an idempotency record as SUCCEEDED with response snapshot.
 */
export async function markSucceeded(
  db: PrismaClient,
  key: string,
  resourceId: string,
  responseStatus: number,
  responseBody: string,
): Promise<void> {
  await db.idempotencyRecord.updateMany({
    where: { key, state: 'PROCESSING' },
    data: {
      state: 'SUCCEEDED',
      resourceId,
      responseStatus,
      responseBody,
      completedAt: new Date(),
    },
  })
}

/** Finalize a recovery only after the route rebuilt the original response. */
export async function markRecoveredSucceeded(
  db: PrismaClient,
  key: string,
  resourceId: string,
  responseStatus: number,
  responseBody: string,
): Promise<void> {
  await db.idempotencyRecord.updateMany({
    where: { key, state: { in: ['PROCESSING', 'FAILED'] } },
    data: {
      state: 'SUCCEEDED',
      resourceId,
      responseStatus,
      responseBody,
      errorMessage: null,
      completedAt: new Date(),
    },
  })
}

/**
 * Mark an idempotency record as FAILED.
 */
export async function markFailed(
  db: PrismaClient,
  key: string,
  errorMessage: string,
): Promise<void> {
  await db.idempotencyRecord.updateMany({
    where: { key, state: 'PROCESSING' },
    data: {
      state: 'FAILED',
      errorMessage,
      completedAt: new Date(),
    },
  })
}

/**
 * Check if a stale PROCESSING record has a corresponding committed StockTransfer.
 * Used for recovery when the success-state update (markSucceeded) may have failed.
 *
 * ST-62 atomicity fix: The idempotencyKey is written to StockTransfer DURING
 * creation (same Prisma create call), so if the transfer committed, we can
 * always find it by querying StockTransfer WHERE idempotencyKey = key.
 * This closes the commit-versus-state-update window.
 */
export async function checkStaleProcessing(
  db: PrismaClient,
  key: string,
): Promise<{ resourceId: string | null } | null> {
  const record = await db.idempotencyRecord.findUnique({ where: { key } })
  if (!record || (record.state !== 'PROCESSING' && record.state !== 'FAILED')) return null

  // First check if resourceId was already set (markSucceeded partially ran)
  if (record.resourceId) {
    const transfer = await db.stockTransfer.findUnique({
      where: { id: record.resourceId },
      select: { id: true },
    })
    if (transfer) {
      return { resourceId: record.resourceId }
    }
  }

  // ST-62 atomicity fix: query StockTransfer by idempotencyKey
  // This finds transfers that committed but whose markSucceeded failed
  const transfer = await findCommittedTransfer(db, key)
  if (transfer) {
    // The route must reconstruct the response body before finalizing SUCCEEDED;
    // otherwise a later REPLAY could return an empty body.
    return { resourceId: transfer.id }
  }

  // No committed transfer found — safe to treat as failed
  return { resourceId: null }
}

function toRecord(row: {
  key: string
  payloadHash: string
  state: string
  resourceId: string | null
  responseStatus: number | null
  responseBody: string | null
}): IdempotencyRecord {
  return {
    key: row.key,
    payloadHash: row.payloadHash,
    state: row.state as IdempotencyState,
    resourceId: row.resourceId,
    responseStatus: row.responseStatus,
    responseBody: row.responseBody,
  }
}
