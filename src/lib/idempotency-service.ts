/**
 * ST-62: Idempotency service for durable request-level deduplication.
 *
 * Manages IdempotencyRecord lifecycle: PROCESSING → SUCCEEDED/FAILED.
 * Uses DB unique constraint on key for atomic claim.
 */

import type { PrismaClient } from '@prisma/client'

export type IdempotencyState = 'PROCESSING' | 'SUCCEEDED' | 'FAILED'

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
      return { type: 'IN_PROGRESS', record: toRecord(existing) }
    }
    if (existing.state === 'FAILED') {
      // Delete the failed record and retry
      await db.idempotencyRecord.delete({ where: { id: existing.id } })
      // Fall through to create new
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
  if (!record || record.state !== 'PROCESSING') return null

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
  const transfer = await db.stockTransfer.findFirst({
    where: { idempotencyKey: key },
    select: { id: true },
  })
  if (transfer) {
    // The transfer was committed but markSucceeded failed
    // Reconstruct the record by marking it SUCCEEDED
    try {
      await db.idempotencyRecord.update({
        where: { key },
        data: {
          state: 'SUCCEEDED',
          resourceId: transfer.id,
          responseStatus: 201,
          completedAt: new Date(),
        },
      })
    } catch {
      // If update fails (e.g., record was deleted by another reclaimer),
      // the transfer still exists — return it for response reconstruction
    }
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
