/**
 * ST-71: Cancel PostgreSQL Runtime Regression Harness.
 *
 * Executes real production cancellation logic (extracted services) against an
 * ephemeral PostgreSQL database. Proves:
 *   - successful cancellation (stock, cost, movement, audit, credit integrity)
 *   - duplicate cancellation rejection
 *   - downstream-use rejection (Buy/Transfer)
 *   - rollback after injected failure
 *   - concurrent cancellation safety (CAS guard)
 *
 * SAFETY: Tests run ONLY against an ephemeral PostgreSQL test database.
 * The environment gate (CI_ST71_POSTGRES_REQUIRED=1) fails the suite if
 * DATABASE_URL is not PostgreSQL or points to a Production-like hostname.
 *
 * No Production access. No real bill/customer IDs. No Production credentials.
 */
import { describe, expect, test } from 'bun:test'
import { PrismaClient, Prisma } from '@prisma/client'
import { cancelBuyBill, BuyCancellationError } from '../src/lib/buy-cancellation-service'
import { cancelSellBill, SellCancellationError } from '../src/lib/sell-cancellation-service'
import { cancelTransferBill, TransferCancellationError } from '../src/lib/transfer-cancellation-service'

// ============================================================================
// Phase 1: Safety gate — prove safe database isolation
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL ?? ''
const IS_POSTGRES = DATABASE_URL.startsWith('postgres://') || DATABASE_URL.startsWith('postgresql://')

// Reject Production-like hostnames.
const PRODUCTION_HOST_PATTERNS = [
  'st-yongheng',
  'supabase.co',
  'vercel',
  'neon.tech',
  'railway.app',
]
const HOST_MATCHES_PRODUCTION = PRODUCTION_HOST_PATTERNS.some(p => DATABASE_URL.toLowerCase().includes(p))

// Require database name to clearly indicate test use.
const DB_NAME_MATCH = DATABASE_URL.match(/\/([^/?]+)(\?|$)/)
const DB_NAME = DB_NAME_MATCH ? DB_NAME_MATCH[1] : ''
const DB_NAME_IS_TEST = DB_NAME.includes('test') || DB_NAME.includes('_test') || DB_NAME.includes('concurrency')

const SKIP_REASON: string | null = (() => {
  if (!IS_POSTGRES) {
    return `DATABASE_URL is not PostgreSQL (got: ${DATABASE_URL ? DATABASE_URL.replace(/:[^:@]+@/, ':***@') : '<empty>'}). ST-71 runtime tests require a real PostgreSQL instance.`
  }
  if (HOST_MATCHES_PRODUCTION) {
    return `DATABASE_URL appears to point to Production infrastructure. ABORT for safety.`
  }
  if (!DB_NAME_IS_TEST) {
    return `Database name "${DB_NAME}" does not clearly indicate test use. ABORT for safety.`
  }
  return null
})()

let _prisma: PrismaClient | null = null
function prisma(): PrismaClient {
  if (!_prisma) {
    _prisma = new PrismaClient({
      datasources: { db: { url: DATABASE_URL } },
    })
  }
  return _prisma
}

// ============================================================================
// Phase 4: Fixture builders
// ============================================================================

const ST71_LOCK_NAMESPACE = BigInt(71300728) // 2026-07-30 ST-71

interface BuyFixture {
  billId: string
  productIds: string[]
  itemWeights: number[]
  creditEntryId?: string
}

async function seedBuyBill(salt: string, options: {
  itemCount?: number
  isCredit?: boolean
  consumedWeight?: number
} = {}): Promise<BuyFixture> {
  const client = prisma()
  const itemCount = options.itemCount ?? 1
  const isCredit = options.isCredit ?? true

  // Category + Products
  const cat = await client.productCategory.create({
    data: { name: `ST71-buy-cat-${salt}`, type: 'METAL', sortOrder: 0 },
  })
  const productIds: string[] = []
  const itemWeights: number[] = []
  for (let i = 0; i < itemCount; i++) {
    const prod = await client.product.create({
      data: { name: `ST71-buy-prod-${salt}-${i}`, categoryId: cat.id },
    })
    productIds.push(prod.id)
    const weight = 10 * (i + 1)
    itemWeights.push(weight)
  }

  // BuyBill + items
  const totalAmount = itemWeights.reduce((s, w, i) => s + w * 20, 0)
  const bill = await client.buyBill.create({
    data: {
      billNumber: `BUY-ST71-${salt}`,
      date: new Date('2026-07-30T00:00:00.000Z'),
      isCredit,
      totalAmount,
      items: {
        create: itemWeights.map((w, i) => ({
          productId: productIds[i],
          weight: w,
          pricePerKg: 20,
          totalAmount: w * 20,
        })),
      },
    },
    include: { items: true },
  })

  // StockLot (BUY source) — one per item
  await client.stockLot.createMany({
    data: itemWeights.map((w, i) => ({
      productId: productIds[i],
      remainingWeight: options.consumedWeight && i === 0 ? w - options.consumedWeight : w,
      costPerKg: 20,
      source: 'BUY',
      sourceId: bill.id,
    })),
  })

  // StockMovements (PURCHASE_IN)
  const now = new Date()
  await client.stockMovement.createMany({
    data: itemWeights.map((w, i) => ({
      id: `st71-buymv-${salt}-${i}`,
      productId: productIds[i],
      businessDate: now,
      movementType: 'PURCHASE_IN',
      signedWeight: w,
      sourceType: 'BUY_BILL',
      sourceId: bill.id,
      sourceItemId: bill.items[i].id,
      sourceDocumentNumber: bill.billNumber,
      reversalOfId: null,
      idempotencyKey: `stock-ledger-v1:BUY_BILL:${bill.id}:${bill.items[i].id}:purchase-in`,
      reason: null,
      metadata: Prisma.JsonNull,
      createdById: null,
      createdByName: null,
    })) as Prisma.StockMovementCreateManyInput[],
  })

  // CreditEntry
  let creditEntryId: string | undefined
  if (isCredit) {
    const ce = await client.creditEntry.create({
      data: {
        type: 'PAYABLE',
        amount: totalAmount,
        paidAmount: 0,
        referenceType: 'BUY_BILL',
        referenceId: bill.id,
        description: `ใบซื้อ ${bill.billNumber}`,
        date: now,
        isSettled: false,
      },
    })
    creditEntryId = ce.id
  }

  return { billId: bill.id, productIds, itemWeights, creditEntryId }
}

async function cleanupBuyBill(billId: string): Promise<void> {
  const client = prisma()
  await client.stockMovement.deleteMany({ where: { sourceId: billId } }).catch(() => {})
  await client.stockLot.deleteMany({ where: { sourceId: billId } }).catch(() => {})
  await client.auditLog.deleteMany({ where: { entityType: 'BUY_BILL', entityId: billId } }).catch(() => {})
  await client.creditEntry.deleteMany({ where: { referenceId: billId } }).catch(() => {})
  await client.buyBillItem.deleteMany({ where: { buyBillId: billId } }).catch(() => {})
  await client.buyBill.deleteMany({ where: { id: billId } }).catch(() => {})
}

interface SellFixture {
  billId: string
  productIds: string[]
  itemWeights: number[]
  itemCosts: number[]
  creditEntryId?: string
}

async function seedSellBill(salt: string, options: {
  itemCount?: number
  isCredit?: boolean
} = {}): Promise<SellFixture> {
  const client = prisma()
  const itemCount = options.itemCount ?? 1
  const isCredit = options.isCredit ?? true

  const cat = await client.productCategory.create({
    data: { name: `ST71-sell-cat-${salt}`, type: 'METAL', sortOrder: 0 },
  })
  const productIds: string[] = []
  const itemWeights: number[] = []
  const itemCosts: number[] = []
  for (let i = 0; i < itemCount; i++) {
    const prod = await client.product.create({
      data: { name: `ST71-sell-prod-${salt}-${i}`, categoryId: cat.id },
    })
    productIds.push(prod.id)
    itemWeights.push(10 * (i + 1))
    itemCosts.push(15 + i * 5) // 15, 20, 25, ...
  }

  const totalAmount = itemWeights.reduce((s, w, i) => s + w * 25, 0)
  const totalCost = itemWeights.reduce((s, w, i) => s + w * itemCosts[i], 0)
  const bill = await client.sellBill.create({
    data: {
      billNumber: `SELL-ST71-${salt}`,
      date: new Date('2026-07-30T00:00:00.000Z'),
      isCredit,
      totalAmount,
      totalCost,
      items: {
        create: itemWeights.map((w, i) => ({
          productId: productIds[i],
          weight: w,
          pricePerKg: 25,
          totalAmount: w * 25,
          costPerKg: itemCosts[i],
          totalCost: w * itemCosts[i],
        })),
      },
    },
    include: { items: true },
  })

  // StockMovements (SALE_OUT)
  const now = new Date()
  await client.stockMovement.createMany({
    data: itemWeights.map((w, i) => ({
      id: `st71-sellmv-${salt}-${i}`,
      productId: productIds[i],
      businessDate: now,
      movementType: 'SALE_OUT',
      signedWeight: -w,
      sourceType: 'SELL_BILL',
      sourceId: bill.id,
      sourceItemId: bill.items[i].id,
      sourceDocumentNumber: bill.billNumber,
      reversalOfId: null,
      idempotencyKey: `stock-ledger-v1:SELL_BILL:${bill.id}:${bill.items[i].id}:sale-out`,
      reason: null,
      metadata: Prisma.JsonNull,
      createdById: null,
      createdByName: null,
    })) as Prisma.StockMovementCreateManyInput[],
  })

  let creditEntryId: string | undefined
  if (isCredit) {
    const ce = await client.creditEntry.create({
      data: {
        type: 'RECEIVABLE',
        amount: totalAmount,
        paidAmount: 0,
        referenceType: 'SELL_BILL',
        referenceId: bill.id,
        description: `ใบขาย ${bill.billNumber}`,
        date: now,
        isSettled: false,
      },
    })
    creditEntryId = ce.id
  }

  return { billId: bill.id, productIds, itemWeights, itemCosts, creditEntryId }
}

async function cleanupSellBill(billId: string): Promise<void> {
  const client = prisma()
  await client.stockMovement.deleteMany({ where: { sourceId: billId } }).catch(() => {})
  await client.stockLot.deleteMany({ where: { sourceId: billId } }).catch(() => {})
  await client.auditLog.deleteMany({ where: { entityType: 'SELL_BILL', entityId: billId } }).catch(() => {})
  await client.creditEntry.deleteMany({ where: { referenceId: billId } }).catch(() => {})
  await client.sellBillItem.deleteMany({ where: { sellBillId: billId } }).catch(() => {})
  await client.sellBill.deleteMany({ where: { id: billId } }).catch(() => {})
}

interface TransferFixture {
  billId: string
  sourceProductId: string
  outputProductIds: string[]
  sourceWeight: number
  sourceCostPerKg: number
  itemWeights: number[]
}

async function seedTransferBill(salt: string, options: {
  outputCount?: number
  consumedWeight?: number
} = {}): Promise<TransferFixture> {
  const client = prisma()
  const outputCount = options.outputCount ?? 2

  const cat = await client.productCategory.create({
    data: { name: `ST71-xfer-cat-${salt}`, type: 'METAL', sortOrder: 0 },
  })
  const sourceProd = await client.product.create({
    data: { name: `ST71-xfer-src-${salt}`, categoryId: cat.id },
  })
  const outputProductIds: string[] = []
  const itemWeights: number[] = []
  for (let i = 0; i < outputCount; i++) {
    const prod = await client.product.create({
      data: { name: `ST71-xfer-out-${salt}-${i}`, categoryId: cat.id },
    })
    outputProductIds.push(prod.id)
    itemWeights.push(5 * (i + 1)) // 5, 10, 15, ...
  }

  const sourceWeight = itemWeights.reduce((s, w) => s + w, 0)
  const sourceCostPerKg = 18

  const bill = await client.stockTransfer.create({
    data: {
      billNumber: `XFER-ST71-${salt}`,
      date: new Date('2026-07-30T00:00:00.000Z'),
      sourceProductId: sourceProd.id,
      sourceWeight,
      sourceCostPerKg,
      sourceTotalCost: sourceWeight * sourceCostPerKg,
      items: {
        create: itemWeights.map((w, i) => ({
          productId: outputProductIds[i],
          weight: w,
          isWaste: false,
          costPerKg: sourceCostPerKg,
          totalCost: w * sourceCostPerKg,
        })),
      },
    },
    include: { items: true },
  })

  // Output StockLots (TRANSFER source)
  await client.stockLot.createMany({
    data: itemWeights.map((w, i) => ({
      productId: outputProductIds[i],
      remainingWeight: options.consumedWeight && i === 0 ? w - options.consumedWeight : w,
      costPerKg: sourceCostPerKg,
      source: 'TRANSFER',
      sourceId: bill.id,
    })),
  })

  // StockMovements: TRANSFER_SOURCE_OUT + TRANSFER_OUTPUT_IN
  const now = new Date()
  const movements: Prisma.StockMovementCreateManyInput[] = [{
    id: `st71-xfersrc-${salt}`,
    productId: sourceProd.id,
    businessDate: now,
    movementType: 'TRANSFER_SOURCE_OUT',
    signedWeight: -sourceWeight,
    sourceType: 'STOCK_TRANSFER',
    sourceId: bill.id,
    sourceItemId: 'source',
    sourceDocumentNumber: bill.billNumber,
    reversalOfId: null,
    idempotencyKey: `stock-ledger-v1:STOCK_TRANSFER:${bill.id}:source:source-out`,
    reason: null,
    metadata: { sourceCostPerKg } as unknown as Prisma.InputJsonValue,
    createdById: null,
    createdByName: null,
  }]
  for (let i = 0; i < outputCount; i++) {
    movements.push({
      id: `st71-xferout-${salt}-${i}`,
      productId: outputProductIds[i],
      businessDate: now,
      movementType: 'TRANSFER_OUTPUT_IN',
      signedWeight: itemWeights[i],
      sourceType: 'STOCK_TRANSFER',
      sourceId: bill.id,
      sourceItemId: bill.items[i].id,
      sourceDocumentNumber: bill.billNumber,
      reversalOfId: null,
      idempotencyKey: `stock-ledger-v1:STOCK_TRANSFER:${bill.id}:${bill.items[i].id}:output-in`,
      reason: null,
      metadata: Prisma.JsonNull,
      createdById: null,
      createdByName: null,
    })
  }
  await client.stockMovement.createMany({ data: movements })

  return {
    billId: bill.id,
    sourceProductId: sourceProd.id,
    outputProductIds,
    sourceWeight,
    sourceCostPerKg,
    itemWeights,
  }
}

async function cleanupTransferBill(billId: string): Promise<void> {
  const client = prisma()
  await client.stockMovement.deleteMany({ where: { sourceId: billId } }).catch(() => {})
  await client.stockLot.deleteMany({ where: { sourceId: billId } }).catch(() => {})
  await client.auditLog.deleteMany({ where: { entityType: 'STOCK_TRANSFER', entityId: billId } }).catch(() => {})
  await client.stockTransferItem.deleteMany({ where: { stockTransferId: billId } }).catch(() => {})
  await client.stockTransfer.deleteMany({ where: { id: billId } }).catch(() => {})
}

// ============================================================================
// Inspection helpers
// ============================================================================

async function inspectBuyPostState(billId: string) {
  const client = prisma()
  const bill = await client.buyBill.findUnique({ where: { id: billId }, select: { isCancelled: true, cancelledAt: true, cancelledBy: true, cancelReason: true } })
  const buyLotCount = await client.stockLot.count({ where: { source: 'BUY', sourceId: billId } })
  const reversalCount = await client.stockMovement.count({ where: { sourceId: billId, movementType: 'CANCELLATION_REVERSAL' } })
  const auditCount = await client.auditLog.count({ where: { entityType: 'BUY_BILL', entityId: billId, action: 'CANCEL' } })
  const creditEntries = await client.creditEntry.findMany({ where: { referenceId: billId, referenceType: 'BUY_BILL' }, select: { isSettled: true } })
  return {
    isCancelled: bill?.isCancelled ?? false,
    cancelledAt: bill?.cancelledAt ?? null,
    cancelledBy: bill?.cancelledBy ?? null,
    cancelReason: bill?.cancelReason ?? null,
    buyLotCount,
    reversalCount,
    auditCount,
    creditSettled: creditEntries.every(e => e.isSettled),
    creditCount: creditEntries.length,
  }
}

async function inspectSellPostState(billId: string) {
  const client = prisma()
  const bill = await client.sellBill.findUnique({ where: { id: billId }, select: { isCancelled: true } })
  const restoreLots = await client.stockLot.findMany({ where: { source: 'SELL_CANCEL', sourceId: billId }, select: { remainingWeight: true, costPerKg: true, productId: true } })
  const reversalCount = await client.stockMovement.count({ where: { sourceId: billId, movementType: 'CANCELLATION_REVERSAL' } })
  const auditCount = await client.auditLog.count({ where: { entityType: 'SELL_BILL', entityId: billId, action: 'CANCEL' } })
  const credits = await client.creditEntry.findMany({ where: { referenceId: billId, referenceType: 'SELL_BILL' }, select: { isSettled: true } })
  return {
    isCancelled: bill?.isCancelled ?? false,
    restoreLotCount: restoreLots.length,
    restoreLots,
    reversalCount,
    auditCount,
    creditSettled: credits.every(e => e.isSettled),
    creditCount: credits.length,
  }
}

async function inspectTransferPostState(billId: string) {
  const client = prisma()
  const bill = await client.stockTransfer.findUnique({ where: { id: billId }, select: { isCancelled: true } })
  const outputLotCount = await client.stockLot.count({ where: { source: 'TRANSFER', sourceId: billId } })
  const restoreLots = await client.stockLot.findMany({ where: { source: 'TRANSFER_CANCEL', sourceId: billId }, select: { remainingWeight: true, costPerKg: true } })
  const reversalCount = await client.stockMovement.count({ where: { sourceId: billId, movementType: 'CANCELLATION_REVERSAL' } })
  const auditCount = await client.auditLog.count({ where: { entityType: 'STOCK_TRANSFER', entityId: billId, action: 'CANCEL' } })
  return {
    isCancelled: bill?.isCancelled ?? false,
    outputLotCount,
    restoreLotCount: restoreLots.length,
    restoreLots,
    reversalCount,
    auditCount,
  }
}

// ============================================================================
// Concurrent cancellation helper (advisory-lock based, deterministic)
// ============================================================================

async function runConcurrentCancellations(
  cancelFn: (db: never, input: { id: string; reason: string; auth: { userId: string; name: string } }) => Promise<void>,
  db: never,
  billId: string,
  lockKey: bigint,
): Promise<{ t1Outcome: string; t2Outcome: string }> {
  const client = prisma()
  let t1Outcome = 'error'
  let t2Outcome = 'error'

  const t1Promise = (async () => {
    try {
      await client.$executeRawUnsafe(`SELECT pg_advisory_lock($1)`, lockKey)
      try {
        await cancelFn(db, { id: billId, reason: 'T1', auth: { userId: 'st71-t1', name: 'T1' } })
        t1Outcome = 'success'
      } catch (e: unknown) {
        const code = (e as { code?: string }).code
        if (code?.includes('CONFLICT')) t1Outcome = 'conflict'
        else if (code?.includes('ALREADY_CANCELLED')) t1Outcome = 'conflict'
        else throw e
      }
      await new Promise(r => setTimeout(r, 200))
      await client.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey)
    } catch (e) {
      t1Outcome = 'error'
      try { await client.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey) } catch {}
    }
  })()

  const t2Promise = (async () => {
    for (let i = 0; i < 100; i++) {
      const locked = await client.$queryRawUnsafe<{ locked: boolean }[]>(`SELECT pg_try_advisory_lock($1) AS locked`, lockKey)
      if (!locked[0].locked) break
      await client.$executeRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey)
      await new Promise(r => setTimeout(r, 20))
    }
    try {
      await cancelFn(db, { id: billId, reason: 'T2', auth: { userId: 'st71-t2', name: 'T2' } })
      t2Outcome = 'success'
    } catch (e: unknown) {
      const code = (e as { code?: string }).code
      if (code?.includes('CONFLICT')) t2Outcome = 'conflict'
      else if (code?.includes('ALREADY_CANCELLED')) t2Outcome = 'conflict'
      else t2Outcome = 'error'
    }
  })()

  await Promise.all([t1Promise, t2Promise])
  return { t1Outcome, t2Outcome }
}

// ============================================================================
// Tests
// ============================================================================

describe('ST-71 PostgreSQL runtime — environment gate', () => {
  test('DATABASE_URL is PostgreSQL when CI_ST71_POSTGRES_REQUIRED=1', () => {
    if (process.env.CI_ST71_POSTGRES_REQUIRED === '1') {
      if (!IS_POSTGRES) throw new Error(SKIP_REASON ?? 'DATABASE_URL is not PostgreSQL')
      if (HOST_MATCHES_PRODUCTION) throw new Error('DATABASE_URL points to Production infrastructure')
      if (!DB_NAME_IS_TEST) throw new Error(`Database name "${DB_NAME}" does not indicate test use`)
    }
    expect(typeof IS_POSTGRES).toBe('boolean')
  })

  test('skip reason is recorded when DATABASE_URL is not safe', () => {
    if (SKIP_REASON) console.log(`  [SUITE SKIP REASON] ${SKIP_REASON}`)
    expect(SKIP_REASON === null || typeof SKIP_REASON === 'string').toBe(true)
  })
})

// ============================================================================
// Buy runtime tests
// ============================================================================

describe('ST-71 Buy runtime cancellation', () => {
  test('1. successful cancellation: bill cancelled, lots deleted, reversal, audit, credit settled', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `buy1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { itemCount: 2, isCredit: true })
    try {
      await cancelBuyBill(prisma() as never, {
        id: fx.billId,
        reason: 'test cancel',
        auth: { userId: 'st71-user', name: 'Test User' },
      })
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.cancelledBy).toBe('st71-user')
      expect(post.cancelReason).toBe('test cancel')
      expect(post.cancelledAt).toBeTruthy()
      expect(post.buyLotCount).toBe(0) // all BUY lots deleted
      expect(post.reversalCount).toBe(2) // 2 PURCHASE_IN movements → 2 reversals
      expect(post.auditCount).toBe(1) // exactly one CANCEL audit
      expect(post.creditSettled).toBe(true) // credit settled
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })

  test('2. duplicate cancellation: second attempt rejected, no extra writes', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `buy2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { isCredit: false })
    try {
      await cancelBuyBill(prisma() as never, { id: fx.billId, reason: 'first', auth: { userId: 'u1', name: 'U1' } })
      // Second cancellation should fail
      await expect(
        cancelBuyBill(prisma() as never, { id: fx.billId, reason: 'second', auth: { userId: 'u2', name: 'U2' } })
      ).rejects.toThrow()
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.auditCount).toBe(1) // no extra audit
      expect(post.reversalCount).toBe(1) // no extra reversal (1 item = 1 movement)
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })

  test('3. downstream-use rejection: consumed stock blocks cancellation', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `buy3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { isCredit: true, consumedWeight: 3 })
    try {
      await expect(
        cancelBuyBill(prisma() as never, { id: fx.billId, reason: 'should fail', auth: { userId: 'u', name: 'U' } })
      ).rejects.toThrow()
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(false) // bill remains active
      expect(post.buyLotCount).toBeGreaterThan(0) // lots unchanged
      expect(post.auditCount).toBe(0) // no audit
      expect(post.reversalCount).toBe(0) // no reversal
      expect(post.creditSettled).toBe(false) // credit NOT settled
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })

  test('4a. rollback: failure after CAS claim (beforeAudit) leaves zero partial writes', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `buy4a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { isCredit: true })
    try {
      await expect(
        cancelBuyBill(prisma() as never, {
          id: fx.billId, reason: 'rb-audit', auth: { userId: 'u', name: 'U' },
          _testHook: { beforeAudit: () => { throw new Error('INJECTED_BEFORE_AUDIT') } },
        })
      ).rejects.toThrow('INJECTED_BEFORE_AUDIT')
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(false)
      expect(post.buyLotCount).toBeGreaterThan(0)
      expect(post.auditCount).toBe(0)
      expect(post.reversalCount).toBe(0)
      expect(post.creditSettled).toBe(false)
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })

  test('4b. rollback: failure after CAS claim (afterClaim) leaves zero partial writes', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `buy4b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { isCredit: true })
    try {
      await expect(
        cancelBuyBill(prisma() as never, {
          id: fx.billId, reason: 'rb-claim', auth: { userId: 'u', name: 'U' },
          _testHook: { afterClaim: () => { throw new Error('INJECTED_AFTER_CLAIM') } },
        })
      ).rejects.toThrow('INJECTED_AFTER_CLAIM')
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(false) // CAS claim rolled back
      expect(post.buyLotCount).toBeGreaterThan(0) // lots NOT deleted
      expect(post.auditCount).toBe(0)
      expect(post.reversalCount).toBe(0)
      expect(post.creditSettled).toBe(false)
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })

  test('4c. rollback: failure before reversal (after lot deletion + credit) leaves zero partial writes', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `buy4c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { isCredit: true })
    try {
      await expect(
        cancelBuyBill(prisma() as never, {
          id: fx.billId, reason: 'rb-rev', auth: { userId: 'u', name: 'U' },
          _testHook: { beforeReversal: () => { throw new Error('INJECTED_BEFORE_REVERSAL') } },
        })
      ).rejects.toThrow('INJECTED_BEFORE_REVERSAL')
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(false) // everything rolled back
      expect(post.buyLotCount).toBeGreaterThan(0) // lots restored
      expect(post.auditCount).toBe(0)
      expect(post.reversalCount).toBe(0)
      expect(post.creditSettled).toBe(false) // credit restored
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })
})

// ============================================================================
// Sell runtime tests
// ============================================================================

describe('ST-71 Sell runtime cancellation', () => {
  test('1. successful cancellation: SELL_CANCEL lots created, reversal, audit, credit', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `sell1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedSellBill(salt, { itemCount: 2, isCredit: true })
    try {
      await cancelSellBill(prisma() as never, { id: fx.billId, reason: 'test', auth: { userId: 'u', name: 'U' } })
      const post = await inspectSellPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.restoreLotCount).toBe(2) // one SELL_CANCEL lot per item
      expect(post.reversalCount).toBe(2) // 2 SALE_OUT → 2 reversals
      expect(post.auditCount).toBe(1)
      expect(post.creditSettled).toBe(true)
      // Verify restored weight and cost
      const totalRestored = post.restoreLots.reduce((s, l) => s + l.remainingWeight, 0)
      expect(totalRestored).toBeCloseTo(fx.itemWeights.reduce((s, w) => s + w, 0), 2)
    } finally {
      await cleanupSellBill(fx.billId)
    }
  })

  test('2. duplicate cancellation: no duplicate restore lots', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `sell2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedSellBill(salt, { isCredit: false })
    try {
      await cancelSellBill(prisma() as never, { id: fx.billId, reason: 'first', auth: { userId: 'u', name: 'U' } })
      await expect(
        cancelSellBill(prisma() as never, { id: fx.billId, reason: 'second', auth: { userId: 'u', name: 'U' } })
      ).rejects.toThrow()
      const post = await inspectSellPostState(fx.billId)
      expect(post.restoreLotCount).toBe(1) // no duplicate
      expect(post.auditCount).toBe(1)
      expect(post.reversalCount).toBe(1)
    } finally {
      await cleanupSellBill(fx.billId)
    }
  })

  test('3. multi-item mixed-cost: each restored lot has correct cost', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `sell3-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedSellBill(salt, { itemCount: 3, isCredit: false })
    try {
      await cancelSellBill(prisma() as never, { id: fx.billId, reason: 'multi', auth: { userId: 'u', name: 'U' } })
      const post = await inspectSellPostState(fx.billId)
      expect(post.restoreLotCount).toBe(3)
      // Each restored lot should have the correct costPerKg from the sell item
      for (let i = 0; i < 3; i++) {
        const lot = post.restoreLots.find(l => l.remainingWeight === fx.itemWeights[i])
        expect(lot).toBeTruthy()
        expect(lot!.costPerKg).toBeCloseTo(fx.itemCosts[i], 2)
      }
    } finally {
      await cleanupSellBill(fx.billId)
    }
  })

  test('4. rollback: failure before audit leaves zero partial writes', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `sell4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedSellBill(salt, { isCredit: true })
    try {
      await expect(
        cancelSellBill(prisma() as never, {
          id: fx.billId, reason: 'rb', auth: { userId: 'u', name: 'U' },
          _testHook: { beforeAudit: () => { throw new Error('INJECTED') } },
        })
      ).rejects.toThrow('INJECTED')
      const post = await inspectSellPostState(fx.billId)
      expect(post.isCancelled).toBe(false)
      expect(post.restoreLotCount).toBe(0)
      expect(post.auditCount).toBe(0)
      expect(post.reversalCount).toBe(0)
    } finally {
      await cleanupSellBill(fx.billId)
    }
  })
})

// ============================================================================
// Transfer runtime tests
// ============================================================================

describe('ST-71 Transfer runtime cancellation', () => {
  test('1. successful cancellation: output lots deleted, source restored, reversal, audit', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `xfer1-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedTransferBill(salt, { outputCount: 2 })
    try {
      await cancelTransferBill(prisma() as never, { id: fx.billId, reason: 'test', auth: { userId: 'u', name: 'U' } })
      const post = await inspectTransferPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.outputLotCount).toBe(0) // all output lots deleted
      expect(post.restoreLotCount).toBe(1) // one source restore lot
      expect(post.restoreLots[0].remainingWeight).toBeCloseTo(fx.sourceWeight, 2)
      expect(post.restoreLots[0].costPerKg).toBeCloseTo(fx.sourceCostPerKg, 2)
      expect(post.reversalCount).toBe(3) // 1 source-out + 2 output-in = 3
      expect(post.auditCount).toBe(1)
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })

  test('2. duplicate cancellation: no duplicate restore', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `xfer2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedTransferBill(salt, { outputCount: 1 })
    try {
      await cancelTransferBill(prisma() as never, { id: fx.billId, reason: 'first', auth: { userId: 'u', name: 'U' } })
      await expect(
        cancelTransferBill(prisma() as never, { id: fx.billId, reason: 'second', auth: { userId: 'u', name: 'U' } })
      ).rejects.toThrow()
      const post = await inspectTransferPostState(fx.billId)
      expect(post.restoreLotCount).toBe(1)
      expect(post.auditCount).toBe(1)
      expect(post.reversalCount).toBe(2) // 1 source + 1 output = 2
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })

  test('3a. downstream rejection: above tolerance (consumed > 0.01)', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `xfer3a-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedTransferBill(salt, { outputCount: 1, consumedWeight: 1.0 })
    try {
      await expect(
        cancelTransferBill(prisma() as never, { id: fx.billId, reason: 'fail', auth: { userId: 'u', name: 'U' } })
      ).rejects.toThrow()
      const post = await inspectTransferPostState(fx.billId)
      expect(post.isCancelled).toBe(false)
      expect(post.outputLotCount).toBeGreaterThan(0)
      expect(post.restoreLotCount).toBe(0)
      expect(post.auditCount).toBe(0)
      expect(post.reversalCount).toBe(0)
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })

  test('3b. downstream rejection: below tolerance (consumed < 0.01)', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `xfer3b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    // consumedWeight = 0.005 (below 0.01 tolerance) → cancellation should SUCCEED
    const fx = await seedTransferBill(salt, { outputCount: 1, consumedWeight: 0.005 })
    try {
      await cancelTransferBill(prisma() as never, { id: fx.billId, reason: 'ok', auth: { userId: 'u', name: 'U' } })
      const post = await inspectTransferPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.outputLotCount).toBe(0)
      expect(post.restoreLotCount).toBe(1)
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })

  test('3c. downstream rejection: exact boundary (consumed = 0.01) succeeds', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `xfer3c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    // consumed = exactly 0.01 → condition is consumed > 0.01 (strict), so 0.01 does NOT trigger rejection
    const fx = await seedTransferBill(salt, { outputCount: 1, consumedWeight: 0.01 })
    try {
      await cancelTransferBill(prisma() as never, { id: fx.billId, reason: 'boundary', auth: { userId: 'u', name: 'U' } })
      const post = await inspectTransferPostState(fx.billId)
      expect(post.isCancelled).toBe(true) // exactly 0.01 is NOT > 0.01, so succeeds
      expect(post.restoreLotCount).toBe(1)
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })

  test('4. rollback: failure before audit leaves zero partial writes', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `xfer4-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedTransferBill(salt, { outputCount: 2 })
    try {
      await expect(
        cancelTransferBill(prisma() as never, {
          id: fx.billId, reason: 'rb', auth: { userId: 'u', name: 'U' },
          _testHook: { beforeAudit: () => { throw new Error('INJECTED') } },
        })
      ).rejects.toThrow('INJECTED')
      const post = await inspectTransferPostState(fx.billId)
      expect(post.isCancelled).toBe(false)
      expect(post.outputLotCount).toBeGreaterThan(0)
      expect(post.restoreLotCount).toBe(0)
      expect(post.auditCount).toBe(0)
      expect(post.reversalCount).toBe(0)
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })
})

// ============================================================================
// Concurrent cancellation tests (CAS guard verification)
// ============================================================================

describe('ST-71 concurrent cancellation — CAS guard', () => {
  test('Buy: exactly one winner, loser gets 409 conflict', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc-buy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedBuyBill(salt, { isCredit: false })
    try {
      const result = await runConcurrentCancellations(cancelBuyBill, prisma() as never, fx.billId, ST71_LOCK_NAMESPACE + BigInt(1))
      const outcomes = [result.t1Outcome, result.t2Outcome].sort()
      expect(outcomes).toEqual(['conflict', 'success'])
      const post = await inspectBuyPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.auditCount).toBe(1) // exactly one audit
      expect(post.reversalCount).toBe(1) // exactly one set of reversals
      expect(post.buyLotCount).toBe(0) // lots deleted exactly once
    } finally {
      await cleanupBuyBill(fx.billId)
    }
  })

  test('Sell: exactly one winner, no duplicate restore lots', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc-sell-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedSellBill(salt, { isCredit: false })
    try {
      const result = await runConcurrentCancellations(cancelSellBill, prisma() as never, fx.billId, ST71_LOCK_NAMESPACE + BigInt(2))
      const outcomes = [result.t1Outcome, result.t2Outcome].sort()
      expect(outcomes).toEqual(['conflict', 'success'])
      const post = await inspectSellPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.restoreLotCount).toBe(1) // no duplicate restore
      expect(post.auditCount).toBe(1)
      expect(post.reversalCount).toBe(1)
    } finally {
      await cleanupSellBill(fx.billId)
    }
  })

  test('Transfer: exactly one winner, no duplicate restore', async () => {
    if (SKIP_REASON) { console.log(`  [SKIPPED] ${SKIP_REASON}`); return }
    const salt = `conc-xfer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,6)}`
    const fx = await seedTransferBill(salt, { outputCount: 1 })
    try {
      const result = await runConcurrentCancellations(cancelTransferBill, prisma() as never, fx.billId, ST71_LOCK_NAMESPACE + BigInt(3))
      const outcomes = [result.t1Outcome, result.t2Outcome].sort()
      expect(outcomes).toEqual(['conflict', 'success'])
      const post = await inspectTransferPostState(fx.billId)
      expect(post.isCancelled).toBe(true)
      expect(post.restoreLotCount).toBe(1)
      expect(post.outputLotCount).toBe(0)
      expect(post.auditCount).toBe(1)
      expect(post.reversalCount).toBe(2)
    } finally {
      await cleanupTransferBill(fx.billId)
    }
  })
})
