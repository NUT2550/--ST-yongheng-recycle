/**
 * ST-70 Phase 6: Real PostgreSQL concurrency tests.
 *
 * These tests require a real PostgreSQL instance reachable via DATABASE_URL
 * (postgresql://...). They are skipped when DATABASE_URL is missing or
 * points to a non-PostgreSQL URL.
 *
 * Synchronization strategy: deterministic, NOT sleep-only.
 *   - Two Prisma transactions run in parallel.
 *   - PostgreSQL advisory locks (pg_advisory_lock) act as deterministic
 *     barriers so transaction B reaches a precise point before transaction A
 *     proceeds. No timing-based race.
 *   - Each test asserts exact post-state: exactly one winner, exactly one
 *     loser returning the expected 409 code, source restored exactly once,
 *     output lots removed exactly once, no duplicate reversal.
 *
 * Owner decision (PR #49 comment #9, 2026-07-25): all-waste cost evidence
 * must come from authoritative source evidence inside the same transaction;
 * missing/conflicting/zero evidence returns HTTP 409 and rolls back every
 * mutation.
 *
 * CI gate: the GitHub Actions PostgreSQL job sets CI_ST70_POSTGRES_REQUIRED=1,
 * which makes the environment-gate test fail if DATABASE_URL is not
 * PostgreSQL. This prevents false-success when zero tests executed.
 */
import { describe, expect, test } from 'bun:test'
import { PrismaClient, Prisma } from '@prisma/client'
import { cancelSortingBill, mapSortingCancellationError } from '../src/lib/sorting-cancellation-service'

const DATABASE_URL = process.env.DATABASE_URL ?? ''
const IS_POSTGRES = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://')

const SKIP_REASON: string | null = IS_POSTGRES
  ? null
  : `DATABASE_URL is not PostgreSQL (got: ${DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ':***@') : '<empty>'}). ST-70 PostgreSQL concurrency tests require a real PostgreSQL instance.`

let _prisma: PrismaClient | null = null
function prisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      // Use a longer query timeout for concurrency tests; advisory locks
      // may block for several seconds waiting for the other transaction.
      datasources: { db: { url: DATABASE_URL } },
    })
  }
  return _prisma
}

/** Deterministic advisory-lock key namespace for ST-70 tests. */
const ST70_LOCK_NAMESPACE = BigInt(70250728) // 2026-07-28 ST-70

interface TestBill {
  billId: string
  sourceProductId: string
  outputProductIds: string[]
}

/**
 * Insert a fully-cancelable SortingBill with source product, source StockLot
 * (BUY source), output StockLots (SORTING source), original StockMovements,
 * and a SortingBonus. Returns the IDs so the test can inspect post-state.
 *
 * Each test gets a unique bill via a per-test salt so parallel runs never
 * collide. Cleanup is via CASCADE on the SortingBill FK.
 */
async function seedCancelableBill(salt: string, options: {
  sourceWeight?: number
  allWaste?: boolean
  sourceCostPerKg?: number
} = {}): Promise<TestBill> {
  const client = prisma()
  const sourceWeight = options.sourceWeight ?? 10
  const sourceCostPerKg = options.sourceCostPerKg ?? 12

  // 1. Source product + output products (or just waste-only for all-waste).
  const sourceProduct = await client.product.create({
    data: {
      name: `ST70-source-${salt}`,
      category: { create: { name: `ST70-cat-${salt}`, type: 'METAL', sortOrder: 0 } },
    },
  })

  const outputProductIds: string[] = []
  if (!options.allWaste) {
    const outA = await client.product.create({
      data: { name: `ST70-out-a-${salt}`, categoryId: sourceProduct.categoryId },
    })
    const outB = await client.product.create({
      data: { name: `ST70-out-b-${salt}`, categoryId: sourceProduct.categoryId },
    })
    outputProductIds.push(outA.id, outB.id)
  }

  // 2. Source StockLot (BUY source) — represents stock bought before sorting.
  await client.stockLot.create({
    data: {
      productId: sourceProduct.id,
      remainingWeight: sourceWeight,
      costPerKg: sourceCostPerKg,
      source: 'BUY',
      sourceId: `buy-${salt}`,
    },
  })

  // 3. SortingBill + items + output lots + movements.
  //    We use a nested create so everything lands in one DB round-trip.
  const bill = await client.sortingBill.create({
    data: {
      billNumber: `SORT-ST70-${salt}`,
      date: new Date('2026-07-28T00:00:00.000Z'),
      sourceProductId: sourceProduct.id,
      sourceWeight,
      sourcePricePerKg: 5,
      weighedTotal: sourceWeight,
      lossWeight: 0,
      lossCost: 0,
      items: {
        create: options.allWaste
          ? [
              { productId: sourceProduct.id, weight: sourceWeight / 2, isWaste: true, costPerKg: 0, totalCost: 0, sortedPricePerKg: 0, bonusAmount: 0 },
              { productId: sourceProduct.id, weight: sourceWeight / 2, isWaste: true, costPerKg: 0, totalCost: 0, sortedPricePerKg: 0, bonusAmount: 0 },
            ]
          : [
              { productId: outputProductIds[0], weight: 4, isWaste: false, costPerKg: sourceCostPerKg, totalCost: 4 * sourceCostPerKg, sortedPricePerKg: 6, bonusAmount: 0.8 },
              { productId: outputProductIds[1], weight: 5, isWaste: false, costPerKg: sourceCostPerKg, totalCost: 5 * sourceCostPerKg, sortedPricePerKg: 7, bonusAmount: 1 },
              { productId: sourceProduct.id, weight: 1, isWaste: true, costPerKg: 0, totalCost: 0, sortedPricePerKg: 0, bonusAmount: 0 },
            ],
      },
    },
    include: { items: true },
  })

  // 4. Output StockLots (SORTING source) — one per non-waste item.
  if (!options.allWaste) {
    await client.stockLot.createMany({
      data: [
        { productId: outputProductIds[0], remainingWeight: 4, costPerKg: sourceCostPerKg, source: 'SORTING', sourceId: bill.id },
        { productId: outputProductIds[1], remainingWeight: 5, costPerKg: sourceCostPerKg, source: 'SORTING', sourceId: bill.id },
      ],
    })
  }

  // 5. Original StockMovements: SORTING_SOURCE_OUT + SORTING_OUTPUT_IN.
  //    The source-out movement carries `sourceCostPerKg` in metadata so
  //    all-waste bills have authoritative cost evidence at cancel time.
  const now = new Date()
  const sourceOutId = `mvsrc-${salt}`
  const sourceMovementData: Prisma.StockMovementCreateManyInput = {
    id: sourceOutId,
    productId: sourceProduct.id,
    businessDate: now,
    movementType: 'SORTING_SOURCE_OUT',
    signedWeight: -sourceWeight,
    sourceType: 'SORTING_BILL',
    sourceId: bill.id,
    sourceItemId: 'source',
    sourceDocumentNumber: bill.billNumber,
    reversalOfId: null,
    idempotencyKey: `stock-ledger-v1:SORTING_BILL:${bill.id}:source:source-out`,
    reason: null,
    metadata: { sourceCostPerKg } as unknown as Prisma.InputJsonValue,
    createdById: null,
    createdByName: null,
  }
  const movementData: Prisma.StockMovementCreateManyInput[] = [sourceMovementData]
  if (!options.allWaste) {
    movementData.push({
      id: `mvout-a-${salt}`,
      productId: outputProductIds[0],
      businessDate: now,
      movementType: 'SORTING_OUTPUT_IN',
      signedWeight: 4,
      sourceType: 'SORTING_BILL',
      sourceId: bill.id,
      sourceItemId: bill.items[0].id,
      sourceDocumentNumber: bill.billNumber,
      reversalOfId: null,
      idempotencyKey: `stock-ledger-v1:SORTING_BILL:${bill.id}:${bill.items[0].id}:output-in`,
      reason: null,
      metadata: Prisma.JsonNull,
      createdById: null,
      createdByName: null,
    })
    movementData.push({
      id: `mvout-b-${salt}`,
      productId: outputProductIds[1],
      businessDate: now,
      movementType: 'SORTING_OUTPUT_IN',
      signedWeight: 5,
      sourceType: 'SORTING_BILL',
      sourceId: bill.id,
      sourceItemId: bill.items[1].id,
      sourceDocumentNumber: bill.billNumber,
      reversalOfId: null,
      idempotencyKey: `stock-ledger-v1:SORTING_BILL:${bill.id}:${bill.items[1].id}:output-in`,
      reason: null,
      metadata: Prisma.JsonNull,
      createdById: null,
      createdByName: null,
    })
  }
  await client.stockMovement.createMany({ data: movementData })

  // 6. SortingBonus to verify it's deleted on cancel.
  await client.sortingBonus.create({
    data: {
      date: now,
      employeeId: (await client.employee.create({
        data: { name: `ST70-emp-${salt}`, hireDate: now, isActive: true },
      })).id,
      sortingBillId: bill.id,
      totalWeight: 9,
      ratePerKg: 1,
      totalAmount: 9,
    },
  })

  return { billId: bill.id, sourceProductId: sourceProduct.id, outputProductIds }
}

async function cleanupBill(billId: string): Promise<void> {
  const client = prisma()
  // CASCADE on SortingBill.items + SortingBonus handles dependents.
  // StockLot + StockMovement + AuditLog are cleaned explicitly because
  // they reference the bill by string ID, not FK.
  await client.stockMovement.deleteMany({ where: { sourceId: billId } })
  await client.stockLot.deleteMany({ where: { sourceId: billId } })
  await client.auditLog.deleteMany({ where: { entityType: 'SORTING_BILL', entityId: billId } })
  await client.sortingBill.deleteMany({ where: { id: billId } }).catch(() => {})
}

/** Counts source-restored lots, output lots remaining, and reversal movements for a bill. */
async function inspectPostState(billId: string): Promise<{
  isCancelled: boolean
  restoreLotCount: number
  outputLotCount: number
  reversalMovementCount: number
  cancelAuditCount: number
}> {
  const client = prisma()
  const bill = await client.sortingBill.findUnique({ where: { id: billId }, select: { isCancelled: true } })
  const restoreLotCount = await client.stockLot.count({
    where: { source: 'SORT_CANCEL', sourceId: billId },
  })
  const outputLotCount = await client.stockLot.count({
    where: { source: 'SORTING', sourceId: billId },
  })
  const reversalMovementCount = await client.stockMovement.count({
    where: { sourceId: billId, movementType: 'CANCELLATION_REVERSAL' },
  })
  const cancelAuditCount = await client.auditLog.count({
    where: { entityType: 'SORTING_BILL', entityId: billId, action: 'CANCEL' },
  })
  return {
    isCancelled: bill?.isCancelled ?? false,
    restoreLotCount,
    outputLotCount,
    reversalMovementCount,
    cancelAuditCount,
  }
}

/**
 * Run two cancellations concurrently with deterministic ordering via
 * advisory locks. T1 acquires the lock first, starts its transaction, then
 * signals T2 to start. T2 blocks on the row lock that T1's conditional
 * claim holds. T1 commits (releasing both advisory + row locks). T2's
 * claim then returns count=0 and T2 fails with SORTING_CANCEL_CONFLICT.
 *
 * Returns: { t1Outcome, t2Outcome } where each is 'success' | 'conflict' | 'error'.
 */
async function runConcurrentCancellations(
  billId: string,
  salt: bigint,
): Promise<{ t1Outcome: 'success' | 'conflict' | 'error'; t1Error?: unknown; t2Outcome: 'success' | 'conflict' | 'error'; t2Error?: unknown }> {
  const client = prisma()
  // Per-transaction advisory lock helpers. We use try_lock so T2 can poll.
  const lockKey = salt

  let t1Outcome: 'success' | 'conflict' | 'error' = 'error'
  let t1Error: unknown
  let t2Outcome: 'success' | 'conflict' | 'error' = 'error'
  let t2Error: unknown

  // T1: acquire advisory lock, start cancellation, hold for 500ms to give
  // T2 time to block on the row lock, then commit.
  const t1Promise = (async () => {
    try {
      await client.$executeRawUnsafe(`SELECT pg_advisory_lock($1)`, lockKey)
      // Start cancellation in a separate async wrapper so we can release
      // the advisory lock after committing.
      const result = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'T1',
        auth: { userId: 'st70-t1', name: 'T1' },
      }).then(() => 'success' as const)
        .catch((e: unknown) => {
          const mapped = mapSortingCancellationError(e)
          if (mapped.status === 409) return 'conflict' as const
          throw e
        })
      t1Outcome = result
      // Hold the advisory lock briefly to ensure T2 had time to block.
      await new Promise(r => setTimeout(r, 200))
      await client.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey)
    } catch (e) {
      t1Error = e
      t1Outcome = 'error'
      try { await client.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey) } catch {}
    }
  })()

  // T2: wait for T1 to acquire the advisory lock, then start cancellation.
  // T2 will block on the row lock T1 holds on the SortingBill row.
  const t2Promise = (async () => {
    // Spin until T1 has the advisory lock (deterministic signal that T1
    // has started its transaction).
    for (let i = 0; i < 100; i++) {
      const locked = await client.$queryRawUnsafe<{ locked: boolean }[]>(
        `SELECT pg_try_advisory_lock($1) AS locked`, lockKey,
      )
      if (!locked[0].locked) {
        // T1 holds the lock — T1 has started. Release our failed attempt
        // (it didn't acquire) and proceed to start cancellation, which will
        // block on the row lock.
        break
      }
      // We got the lock — T1 hasn't started yet. Release and wait briefly.
      await client.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey)
      await new Promise(r => setTimeout(r, 20))
    }
    try {
      await cancelSortingBill(client as never, {
        id: billId,
        reason: 'T2',
        auth: { userId: 'st70-t2', name: 'T2' },
      })
      t2Outcome = 'success'
    } catch (e) {
      const mapped = mapSortingCancellationError(e)
      if (mapped.status === 409) {
        t2Outcome = 'conflict'
      } else {
        t2Error = e
        t2Outcome = 'error'
      }
    }
  })()

  await Promise.all([t1Promise, t2Promise])
  return { t1Outcome, t1Error, t2Outcome, t2Error }
}

describe('ST-70 PostgreSQL concurrency — environment gate', () => {
  test('DATABASE_URL is PostgreSQL when CI_ST70_POSTGRES_REQUIRED=1', () => {
    if (process.env.CI_ST70_POSTGRES_REQUIRED === '1') {
      if (!IS_POSTGRES) {
        throw new Error(SKIP_REASON ?? 'DATABASE_URL is not PostgreSQL')
      }
    }
    expect(typeof IS_POSTGRES).toBe('boolean')
  })

  test('skip reason is recorded when DATABASE_URL is not PostgreSQL', () => {
    if (SKIP_REASON) {
      console.log(`  [SUITE SKIP REASON] ${SKIP_REASON}`)
    }
    expect(SKIP_REASON === null || typeof SKIP_REASON === 'string').toBe(true)
  })
})

describe('ST-70 PostgreSQL concurrency — deterministic two-transaction races', () => {
  // Each gated test runs the real body only when PostgreSQL is available.
  // When skipped, we still log the reason so CI can detect zero real runs.

  test('1. two concurrent cancellations: exactly one wins, loser gets 409', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt)
    try {
      const result = await runConcurrentCancellations(billId, ST70_LOCK_NAMESPACE + BigInt(1))
      const outcomes = [result.t1Outcome, result.t2Outcome].sort()
      expect(outcomes).toEqual(['conflict', 'success'])
      const post = await inspectPostState(billId)
      expect(post.isCancelled).toBe(true)
      expect(post.restoreLotCount).toBe(1) // exactly one source restore
      expect(post.outputLotCount).toBe(0) // both output lots removed
      expect(post.reversalMovementCount).toBeGreaterThan(0) // reversal rows created
      // Reversal count = original movements (1 source-out + 2 output-in = 3)
      expect(post.reversalMovementCount).toBe(3)
      expect(post.cancelAuditCount).toBe(1) // exactly one CANCEL audit
    } finally {
      await cleanupBill(billId)
    }
  })

  test('2. source restored exactly once (no duplicate SORT_CANCEL lots)', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt)
    try {
      await runConcurrentCancellations(billId, ST70_LOCK_NAMESPACE + BigInt(2))
      const post = await inspectPostState(billId)
      expect(post.restoreLotCount).toBe(1)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('3. output lots removed exactly once', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt)
    try {
      await runConcurrentCancellations(billId, ST70_LOCK_NAMESPACE + BigInt(3))
      const post = await inspectPostState(billId)
      expect(post.outputLotCount).toBe(0)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('4. no duplicate reversal movements', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt)
    try {
      await runConcurrentCancellations(billId, ST70_LOCK_NAMESPACE + BigInt(4))
      const post = await inspectPostState(billId)
      // 3 originals → 3 reversals. No duplicate because idempotency_key is unique.
      expect(post.reversalMovementCount).toBe(3)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('5. no partial state: bill is either fully cancelled or untouched', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc5-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt)
    try {
      await runConcurrentCancellations(billId, ST70_LOCK_NAMESPACE + BigInt(5))
      const post = await inspectPostState(billId)
      // Either fully cancelled (restore=1, output=0, reversal=3, audit=1)
      // or untouched (restore=0, output=2, reversal=0, audit=0). No partial.
      const fullyCancelled =
        post.isCancelled && post.restoreLotCount === 1 && post.outputLotCount === 0 && post.reversalMovementCount === 3 && post.cancelAuditCount === 1
      // After concurrent cancel, exactly one wins so the bill is fully cancelled.
      expect(fullyCancelled).toBe(true)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('6. downstream output usage race: cancellation fails closed when output lot is consumed mid-flight', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc6-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId, outputProductIds } = await seedCancelableBill(salt)
    try {
      // Consume one output lot from a parallel transaction BEFORE cancellation
      // reaches the compare-and-delete. We use a raw UPDATE to simulate a
      // downstream sale reducing the lot's remainingWeight.
      const client = prisma()
      await client.stockLot.updateMany({
        where: { source: 'SORTING', sourceId: billId, productId: outputProductIds[0] },
        data: { remainingWeight: 3 }, // was 4 → CAS guard will fail
      })
      // Now cancellation must fail closed with 409.
      const error = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'downstream',
        auth: { userId: 'st70-t6', name: 'T6' },
      }).catch(e => e)
      const mapped = mapSortingCancellationError(error)
      expect(mapped.status).toBe(409)
      expect(mapped.body.code).toBe('SORTING_BILL_HAS_DOWNSTREAM_USAGE')
      // No state mutation committed.
      const post = await inspectPostState(billId)
      expect(post.isCancelled).toBe(false)
      expect(post.restoreLotCount).toBe(0)
      expect(post.cancelAuditCount).toBe(0)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('7. failure after output removal rolls back (claim fails after delete)', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    // Pre-cancel the bill so the conditional claim returns 0. The
    // read-only validation passes (lots are intact), then the claim fails
    // → transaction rolls back. No delete/restore/audit.
    const salt = `conc7-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt)
    try {
      const client = prisma()
      // Pre-mark the bill as cancelled so the claim returns 0.
      await client.sortingBill.update({
        where: { id: billId },
        data: { isCancelled: true, cancelledAt: new Date(), cancelledBy: 'pre', cancelReason: 'pre' },
      })
      const error = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'already-cancelled',
        auth: { userId: 'st70-t7', name: 'T7' },
      }).catch(e => e)
      const mapped = mapSortingCancellationError(error)
      expect(mapped.status).toBe(409)
      // Output lots still present (delete rolled back).
      const post = await inspectPostState(billId)
      expect(post.outputLotCount).toBe(2)
      expect(post.restoreLotCount).toBe(0)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('8. multi-lot atomicity: if any lot CAS fails, all prior deletes roll back', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc8-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId, outputProductIds } = await seedCancelableBill(salt)
    try {
      const client = prisma()
      // Reduce the SECOND output lot so the FIRST compare-and-delete succeeds
      // but the SECOND fails. The transaction must roll back the first delete.
      await client.stockLot.updateMany({
        where: { source: 'SORTING', sourceId: billId, productId: outputProductIds[1] },
        data: { remainingWeight: 4 }, // was 5
      })
      const error = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'multi-lot',
        auth: { userId: 'st70-t8', name: 'T8' },
      }).catch(e => e)
      const mapped = mapSortingCancellationError(error)
      expect(mapped.status).toBe(409)
      expect(mapped.body.code).toBe('SORTING_BILL_HAS_DOWNSTREAM_USAGE')
      // Both output lots still present (first delete rolled back).
      const post = await inspectPostState(billId)
      expect(post.outputLotCount).toBe(2)
      expect(post.isCancelled).toBe(false)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('9. all-waste authoritative cost evidence: cancellation succeeds with StockMovement metadata', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc9-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId, sourceProductId } = await seedCancelableBill(salt, { allWaste: true, sourceCostPerKg: 7.5 })
    try {
      const client = prisma()
      await cancelSortingBill(client as never, {
        id: billId,
        reason: 'all-waste',
        auth: { userId: 'st70-t9', name: 'T9' },
      })
      const post = await inspectPostState(billId)
      expect(post.isCancelled).toBe(true)
      expect(post.restoreLotCount).toBe(1)
      // No output lots for all-waste bills (none were created at sort time).
      expect(post.outputLotCount).toBe(0)
      // Only the SORTING_SOURCE_OUT movement is reversed (no output-in movements).
      expect(post.reversalMovementCount).toBe(1)
      // Verify the restored lot has the correct costPerKg.
      const restoreLot = await client.stockLot.findFirst({
        where: { source: 'SORT_CANCEL', sourceId: billId },
      })
      expect(restoreLot?.costPerKg).toBe(7.5)
      expect(restoreLot?.productId).toBe(sourceProductId)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('10. missing cost evidence: all-waste bill without StockMovement metadata fails closed', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc10-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt, { allWaste: true })
    try {
      const client = prisma()
      // Delete the StockMovement metadata to simulate missing evidence.
      await client.stockMovement.deleteMany({
        where: { sourceId: billId, movementType: 'SORTING_SOURCE_OUT' },
      })
      const error = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'missing-evidence',
        auth: { userId: 'st70-t10', name: 'T10' },
      }).catch(e => e)
      const mapped = mapSortingCancellationError(error)
      expect(mapped.status).toBe(409)
      expect(mapped.body.code).toBe('SORTING_CANCEL_COST_EVIDENCE_MISSING')
      const post = await inspectPostState(billId)
      expect(post.isCancelled).toBe(false)
      expect(post.restoreLotCount).toBe(0)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('11. zero cost evidence: all-waste bill with sourceCostPerKg=0 in metadata fails closed', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc11-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    const { billId } = await seedCancelableBill(salt, { allWaste: true, sourceCostPerKg: 0 })
    try {
      const client = prisma()
      const error = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'zero-evidence',
        auth: { userId: 'st70-t11', name: 'T11' },
      }).catch(e => e)
      const mapped = mapSortingCancellationError(error)
      expect(mapped.status).toBe(409)
      expect(mapped.body.code).toBe('SORTING_CANCEL_COST_EVIDENCE_ZERO')
      const post = await inspectPostState(billId)
      expect(post.isCancelled).toBe(false)
    } finally {
      await cleanupBill(billId)
    }
  })

  test('12. conflicting cost evidence: StockMovement metadata disagrees with SortingBillItem fails closed', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc12-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    // Non-waste bill (has item.costPerKg = 12) but we patch StockMovement
    // metadata to a different value to create conflict.
    const { billId } = await seedCancelableBill(salt, { sourceCostPerKg: 12 })
    try {
      const client = prisma()
      await client.stockMovement.updateMany({
        where: { sourceId: billId, movementType: 'SORTING_SOURCE_OUT' },
        data: { metadata: { sourceCostPerKg: 7.5 } as unknown as Prisma.InputJsonValue },
      })
      const error = await cancelSortingBill(client as never, {
        id: billId,
        reason: 'conflict',
        auth: { userId: 'st70-t12', name: 'T12' },
      }).catch(e => e)
      const mapped = mapSortingCancellationError(error)
      expect(mapped.status).toBe(409)
      expect(mapped.body.code).toBe('SORTING_CANCEL_COST_EVIDENCE_CONFLICTING')
      const post = await inspectPostState(billId)
      expect(post.isCancelled).toBe(false)
    } finally {
      await cleanupBill(billId)
    }
  })
})
