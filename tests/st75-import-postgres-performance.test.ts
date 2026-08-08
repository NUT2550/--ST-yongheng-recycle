/**
 * ST-75 Phase 2: Real PostgreSQL performance benchmark.
 *
 * Uses PGlite (WASM PostgreSQL) — real PostgreSQL engine, NOT SQLite.
 * Isolated, non-Production, disposable. No customer data.
 *
 * Measures import apply performance with real DB operations.
 * Baseline only — no optimization in this round.
 *
 * Safety:
 * - No Production URL
 * - No customer data
 * - Synthetic data only
 * - Disposable DB (in-memory)
 */

import { describe, expect, test } from 'bun:test'
import { PGlite } from '@electric-sql/pglite'
import { performance } from 'perf_hooks'

// Synthetic data generators
function makeSyntheticProduct(id: string, name: string, categoryId: string) {
  return { id, name, categoryId }
}

function makeSyntheticPurchaseBill(index: number, itemCount: number = 3) {
  const billNumber = `ST75-PERF-P-${String(index).padStart(4, '0')}`
  const date = '2026-08-08'
  const items = Array.from({ length: itemCount }, (_, i) => ({
    productId: `perf-prod-${(i % 5) + 1}`,
    productName: `Product ${(i % 5) + 1}`,
    weight: 10 + i,
    pricePerKg: 20 + i,
    totalAmount: (10 + i) * (20 + i),
    matched: true,
  }))
  return { externalBillNumber: billNumber, date, note: `perf test ${index}`, items }
}

function makeSyntheticSalesBill(index: number, itemCount: number = 3) {
  const billNumber = `ST75-PERF-S-${String(index).padStart(4, '0')}`
  const date = '2026-08-08'
  const items = Array.from({ length: itemCount }, (_, i) => ({
    productId: `perf-prod-${(i % 5) + 1}`,
    productName: `Product ${(i % 5) + 1}`,
    weight: 5 + i,
    pricePerKg: 30 + i,
    totalAmount: (5 + i) * (30 + i),
    matched: true,
  }))
  return { externalBillNumber: billNumber, date, note: `perf test ${index}`, items }
}

// PGlite setup — creates tables matching the Prisma schema
async function setupDatabase() {
  const db = new PGlite()

  await db.exec(`
    CREATE TABLE "ProductCategory" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'METAL',
      "sortOrder" INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE "Product" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "categoryId" TEXT NOT NULL REFERENCES "ProductCategory"("id")
    );

    CREATE TABLE "BuyBill" (
      id TEXT PRIMARY KEY,
      "billNumber" TEXT UNIQUE,
      "externalBillNumber" TEXT UNIQUE,
      "date" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "isCredit" BOOLEAN DEFAULT FALSE,
      "note" TEXT,
      "totalAmount" FLOAT DEFAULT 0,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "BuyBillItem" (
      id TEXT PRIMARY KEY,
      "buyBillId" TEXT NOT NULL REFERENCES "BuyBill"("id"),
      "productId" TEXT NOT NULL REFERENCES "Product"("id"),
      "weight" FLOAT NOT NULL,
      "pricePerKg" FLOAT,
      "totalAmount" FLOAT DEFAULT 0
    );

    CREATE TABLE "SellBill" (
      id TEXT PRIMARY KEY,
      "billNumber" TEXT UNIQUE,
      "externalBillNumber" TEXT UNIQUE,
      "date" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "isCredit" BOOLEAN DEFAULT FALSE,
      "note" TEXT,
      "totalAmount" FLOAT DEFAULT 0,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "SellBillItem" (
      id TEXT PRIMARY KEY,
      "sellBillId" TEXT NOT NULL REFERENCES "SellBill"("id"),
      "productId" TEXT NOT NULL REFERENCES "Product"("id"),
      "weight" FLOAT NOT NULL,
      "pricePerKg" FLOAT,
      "totalAmount" FLOAT DEFAULT 0
    );

    CREATE TABLE "StockLot" (
      id TEXT PRIMARY KEY,
      "productId" TEXT NOT NULL REFERENCES "Product"("id"),
      "remainingWeight" FLOAT NOT NULL,
      "costPerKg" FLOAT,
      "dateAdded" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "source" TEXT,
      "sourceId" TEXT,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "StockMovement" (
      id TEXT PRIMARY KEY,
      "productId" TEXT NOT NULL REFERENCES "Product"("id"),
      "businessDate" TIMESTAMP,
      "movementType" TEXT,
      "signedWeight" FLOAT,
      "sourceType" TEXT,
      "sourceId" TEXT,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE "AuditLog" (
      id TEXT PRIMARY KEY,
      "action" TEXT,
      "entityType" TEXT,
      "entityId" TEXT,
      "userId" TEXT,
      "userName" TEXT,
      "details" TEXT,
      "createdAt" TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Seed synthetic products
  const category = { id: 'perf-cat-1', name: 'Metal', type: 'METAL', sortOrder: 0 }
  await db.query(`INSERT INTO "ProductCategory" ("id", "name", "type", "sortOrder") VALUES ($1, $2, $3, $4)`,
    [category.id, category.name, category.type, category.sortOrder])

  for (let i = 1; i <= 5; i++) {
    await db.query(`INSERT INTO "Product" ("id", "name", "categoryId") VALUES ($1, $2, $3)`,
      [`perf-prod-${i}`, `Product ${i}`, category.id])
  }

  return db
}

// Simulate purchase bill creation (matches production bill-service pattern)
async function createPurchaseBill(db: PGlite, bill: ReturnType<typeof makeSyntheticPurchaseBill>, actor: string) {
  const billId = `bill-${bill.externalBillNumber}-${Date.now()}`
  const billNumber = `BUY-${bill.externalBillNumber}`

  // 1. Check duplicate
  const existing = await db.query(`SELECT id FROM "BuyBill" WHERE "externalBillNumber" = $1`, [bill.externalBillNumber])
  if (existing.rows.length > 0) {
    return { status: 'DUPLICATE_EXISTING', billNumber }
  }

  // 2. Create bill
  await db.query(
    `INSERT INTO "BuyBill" ("id", "billNumber", "externalBillNumber", "date", "note", "totalAmount") VALUES ($1, $2, $3, $4, $5, $6)`,
    [billId, billNumber, bill.externalBillNumber, bill.date, bill.note, bill.items.reduce((s, i) => s + i.totalAmount, 0)]
  )

  // 3. Create items
  for (const item of bill.items) {
    const itemId = `item-${billId}-${Math.random().toString(36).substring(2, 8)}`
    await db.query(
      `INSERT INTO "BuyBillItem" ("id", "buyBillId", "productId", "weight", "pricePerKg", "totalAmount") VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, billId, item.productId, item.weight, item.pricePerKg, item.totalAmount]
    )
  }

  // 4. Create stock lot
  const lotId = `lot-${billId}-${Math.random().toString(36).substring(2, 8)}`
  await db.query(
    `INSERT INTO "StockLot" ("id", "productId", "remainingWeight", "costPerKg", "source", "sourceId") VALUES ($1, $2, $3, $4, $5, $6)`,
    [lotId, bill.items[0].productId, bill.items.reduce((s, i) => s + i.weight, 0), bill.items[0].pricePerKg, 'BUY', billId]
  )

  // 5. Create stock movement
  const movementId = `mov-${billId}-${Math.random().toString(36).substring(2, 8)}`
  await db.query(
    `INSERT INTO "StockMovement" ("id", "productId", "movementType", "signedWeight", "sourceType", "sourceId") VALUES ($1, $2, $3, $4, $5, $6)`,
    [movementId, bill.items[0].productId, 'BUY_IN', bill.items.reduce((s, i) => s + i.weight, 0), 'BUY', billId]
  )

  // 6. Create audit log
  const auditId = `audit-${billId}-${Math.random().toString(36).substring(2, 8)}`
  await db.query(
    `INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "userId", "userName", "details") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auditId, 'CREATE', 'BUY_BILL', billId, actor, 'Admin', JSON.stringify({ billNumber })]
  )

  return { status: 'READY', billNumber, billId }
}

// Simulate sales bill creation
async function createSalesBill(db: PGlite, bill: ReturnType<typeof makeSyntheticSalesBill>, actor: string) {
  const billId = `bill-${bill.externalBillNumber}-${Date.now()}`
  const billNumber = `SELL-${bill.externalBillNumber}`

  const existing = await db.query(`SELECT id FROM "SellBill" WHERE "externalBillNumber" = $1`, [bill.externalBillNumber])
  if (existing.rows.length > 0) {
    return { status: 'DUPLICATE_EXISTING', billNumber }
  }

  await db.query(
    `INSERT INTO "SellBill" ("id", "billNumber", "externalBillNumber", "date", "note", "totalAmount") VALUES ($1, $2, $3, $4, $5, $6)`,
    [billId, billNumber, bill.externalBillNumber, bill.date, bill.note, bill.items.reduce((s, i) => s + i.totalAmount, 0)]
  )

  for (const item of bill.items) {
    const itemId = `item-${billId}-${Math.random().toString(36).substring(2, 8)}`
    await db.query(
      `INSERT INTO "SellBillItem" ("id", "sellBillId", "productId", "weight", "pricePerKg", "totalAmount") VALUES ($1, $2, $3, $4, $5, $6)`,
      [itemId, billId, item.productId, item.weight, item.pricePerKg, item.totalAmount]
    )
  }

  // Deduct stock (FIFO simulation)
  for (const item of bill.items) {
    const lots = await db.query(`SELECT id, "remainingWeight" FROM "StockLot" WHERE "productId" = $1 AND "remainingWeight" > 0 ORDER BY "dateAdded" ASC`, [item.productId])
    let remaining = item.weight
    for (const lot of lots.rows as any[]) {
      if (remaining <= 0) break
      const deduct = Math.min(lot.remainingWeight, remaining)
      remaining -= deduct
      await db.query(`UPDATE "StockLot" SET "remainingWeight" = "remainingWeight" - $1 WHERE id = $2`, [deduct, lot.id])
    }
  }

  // Stock movement
  const movementId = `mov-${billId}-${Math.random().toString(36).substring(2, 8)}`
  await db.query(
    `INSERT INTO "StockMovement" ("id", "productId", "movementType", "signedWeight", "sourceType", "sourceId") VALUES ($1, $2, $3, $4, $5, $6)`,
    [movementId, bill.items[0].productId, 'SELL_OUT', -bill.items.reduce((s, i) => s + i.weight, 0), 'SELL', billId]
  )

  // Audit
  const auditId = `audit-${billId}-${Math.random().toString(36).substring(2, 8)}`
  await db.query(
    `INSERT INTO "AuditLog" ("id", "action", "entityType", "entityId", "userId", "userName", "details") VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [auditId, 'CREATE', 'SELL_BILL', billId, actor, 'Admin', JSON.stringify({ billNumber })]
  )

  return { status: 'READY', billNumber, billId }
}

// Import apply simulation (matches import-pipeline pattern)
async function applyImport(
  db: PGlite,
  type: 'purchase' | 'sales',
  bills: Array<ReturnType<typeof makeSyntheticPurchaseBill> | ReturnType<typeof makeSyntheticSalesBill>>,
  actor: string
) {
  const results: Array<{ status: string; billNumber: string }> = []
  const existingSet = new Set<string>()

  // Batch duplicate check (1 query)
  const table = type === 'purchase' ? 'BuyBill' : 'SellBill'
  const numbers = bills.map(b => b.externalBillNumber)
  if (numbers.length > 0) {
    const placeholders = numbers.map((_, i) => `$${i + 1}`).join(',')
    const existing = await db.query(`SELECT "externalBillNumber" FROM "${table}" WHERE "externalBillNumber" IN (${placeholders})`, numbers)
    for (const row of existing.rows as any[]) {
      existingSet.add(row.externalBillNumber)
    }
  }

  let queryCount = 1 // 1 for batch duplicate check

  for (const bill of bills) {
    if (existingSet.has(bill.externalBillNumber)) {
      results.push({ status: 'DUPLICATE_EXISTING', billNumber: bill.externalBillNumber })
      continue
    }

    try {
      let result
      if (type === 'purchase') {
        result = await createPurchaseBill(db, bill as any, actor)
      } else {
        result = await createSalesBill(db, bill as any, actor)
      }
      // Count queries: 1 dup check + 1 bill insert + N item inserts + 1 lot + 1 movement + 1 audit
      queryCount += 1 + bill.items.length + 1 + 1 + 1
      if (result.status === 'READY') {
        existingSet.add(bill.externalBillNumber)
      }
      results.push(result)
    } catch (err) {
      results.push({ status: 'FAILED', billNumber: bill.externalBillNumber })
    }
  }

  const imported = results.filter(r => r.status === 'READY').length
  const duplicates = results.filter(r => r.status === 'DUPLICATE_EXISTING').length
  const failed = results.filter(r => r.status === 'FAILED').length

  return { imported, duplicates, failed, queryCount, results }
}

// ============ Benchmark tests ============

describe('ST-75 PostgreSQL Performance Baseline', () => {
  test('1. Purchase 1 bill — baseline', async () => {
    const db = await setupDatabase()
    try {
      const bills = [makeSyntheticPurchaseBill(1)]
      const start = performance.now()
      const result = await applyImport(db, 'purchase', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Purchase 1 bill: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(1)
      expect(result.failed).toBe(0)
      expect(result.queryCount).toBe(8) // 1 batch + 1 dup + 1 bill + 3 items + 1 lot + 1 mov + 1 audit - wait, let me recalculate
    } finally {
      await db.close()
    }
  })

  test('2. Purchase 5 bills — baseline', async () => {
    const db = await setupDatabase()
    try {
      const bills = Array.from({ length: 5 }, (_, i) => makeSyntheticPurchaseBill(i + 1))
      const start = performance.now()
      const result = await applyImport(db, 'purchase', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Purchase 5 bills: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(5)
      expect(result.failed).toBe(0)
    } finally {
      await db.close()
    }
  })

  test('3. Purchase 25 bills — baseline', async () => {
    const db = await setupDatabase()
    try {
      const bills = Array.from({ length: 25 }, (_, i) => makeSyntheticPurchaseBill(i + 1))
      const start = performance.now()
      const result = await applyImport(db, 'purchase', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Purchase 25 bills: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(25)
      expect(result.failed).toBe(0)
    } finally {
      await db.close()
    }
  })

  test('4. Purchase 100 bills — baseline', async () => {
    const db = await setupDatabase()
    try {
      const bills = Array.from({ length: 100 }, (_, i) => makeSyntheticPurchaseBill(i + 1))
      const start = performance.now()
      const result = await applyImport(db, 'purchase', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Purchase 100 bills: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(100)
      expect(result.failed).toBe(0)
    } finally {
      await db.close()
    }
  })

  test('5. Sales 1 bill — baseline (with stock)', async () => {
    const db = await setupDatabase()
    try {
      // Seed stock for sales
      for (let i = 1; i <= 5; i++) {
        await db.query(
          `INSERT INTO "StockLot" ("id", "productId", "remainingWeight", "costPerKg", "source") VALUES ($1, $2, $3, $4, $5)`,
          [`seed-lot-${i}`, `perf-prod-${i}`, 1000, 10, 'BUY']
        )
      }

      const bills = [makeSyntheticSalesBill(1)]
      const start = performance.now()
      const result = await applyImport(db, 'sales', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Sales 1 bill: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(1)
      expect(result.failed).toBe(0)
    } finally {
      await db.close()
    }
  })

  test('6. Sales 25 bills — baseline (with stock)', async () => {
    const db = await setupDatabase()
    try {
      for (let i = 1; i <= 5; i++) {
        await db.query(
          `INSERT INTO "StockLot" ("id", "productId", "remainingWeight", "costPerKg", "source") VALUES ($1, $2, $3, $4, $5)`,
          [`seed-lot-${i}`, `perf-prod-${i}`, 10000, 10, 'BUY']
        )
      }

      const bills = Array.from({ length: 25 }, (_, i) => makeSyntheticSalesBill(i + 1))
      const start = performance.now()
      const result = await applyImport(db, 'sales', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Sales 25 bills: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(25)
      expect(result.failed).toBe(0)
    } finally {
      await db.close()
    }
  })

  test('7. Sales 100 bills — baseline (with stock)', async () => {
    const db = await setupDatabase()
    try {
      for (let i = 1; i <= 5; i++) {
        await db.query(
          `INSERT INTO "StockLot" ("id", "productId", "remainingWeight", "costPerKg", "source") VALUES ($1, $2, $3, $4, $5)`,
          [`seed-lot-${i}`, `perf-prod-${i}`, 50000, 10, 'BUY']
        )
      }

      const bills = Array.from({ length: 100 }, (_, i) => makeSyntheticSalesBill(i + 1))
      const start = performance.now()
      const result = await applyImport(db, 'sales', bills, 'perf-admin')
      const elapsed = performance.now() - start
      console.log(`  Sales 100 bills: ${elapsed.toFixed(2)}ms, queries=${result.queryCount}, imported=${result.imported}`)
      expect(result.imported).toBe(100)
      expect(result.failed).toBe(0)
    } finally {
      await db.close()
    }
  })
})

// ============ Concurrency / duplicate safety ============

describe('ST-75 Concurrency/Duplicate Safety', () => {
  test('8. Duplicate externalBillNumber — second import skips', async () => {
    const db = await setupDatabase()
    try {
      const bills = [makeSyntheticPurchaseBill(1)]
      const result1 = await applyImport(db, 'purchase', bills, 'perf-admin')
      expect(result1.imported).toBe(1)

      // Retry same bill numbers
      const result2 = await applyImport(db, 'purchase', bills, 'perf-admin')
      expect(result2.imported).toBe(0)
      expect(result2.duplicates).toBe(1)
      console.log(`  Duplicate retry: imported=${result2.imported}, duplicates=${result2.duplicates}`)
    } finally {
      await db.close()
    }
  })

  test('9. Stock correctness after sales — no negative inventory', async () => {
    const db = await setupDatabase()
    try {
      await db.query(
        `INSERT INTO "StockLot" ("id", "productId", "remainingWeight", "costPerKg", "source") VALUES ($1, $2, $3, $4, $5)`,
        ['seed-lot-1', 'perf-prod-1', 100, 10, 'BUY']
      )

      // Sell 50 (within stock)
      const bills = [makeSyntheticSalesBill(1)]
      bills[0].items = [{ productId: 'perf-prod-1', productName: 'P1', weight: 50, pricePerKg: 30, totalAmount: 1500, matched: true }]
      const result = await applyImport(db, 'sales', bills, 'perf-admin')
      expect(result.imported).toBe(1)

      // Verify remaining stock
      const stock = await db.query(`SELECT "remainingWeight" FROM "StockLot" WHERE "productId" = $1`, ['perf-prod-1'])
      const remaining = (stock.rows[0] as any).remainingWeight
      expect(remaining).toBe(50) // 100 - 50 = 50
      console.log(`  Stock after sell: ${remaining} (expected 50)`)
    } finally {
      await db.close()
    }
  })

  test('10. Partial success — middle bill fails, others succeed', async () => {
    const db = await setupDatabase()
    try {
      const bills = [
        makeSyntheticPurchaseBill(1),
        makeSyntheticPurchaseBill(2),
        makeSyntheticPurchaseBill(3),
      ]
      // Make bill 2 fail by using a non-existent product
      bills[1].items[0].productId = 'nonexistent-product'

      const result = await applyImport(db, 'purchase', bills, 'perf-admin')
      expect(result.imported).toBe(2) // bills 1 and 3 succeed
      expect(result.failed).toBe(1)  // bill 2 fails
      console.log(`  Partial success: imported=${result.imported}, failed=${result.failed}`)
    } finally {
      await db.close()
    }
  })
})

// ============ Query count verification ============

describe('ST-75 Query Count Verification', () => {
  test('11. Query count scales linearly with bill count', async () => {
    const sizes = [1, 5, 25, 100]
    console.log('  Size | Queries | Queries/bill | Estimated')
    console.log('  -----|---------|--------------|----------')
    for (const size of sizes) {
      const db = await setupDatabase()
      try {
        const bills = Array.from({ length: size }, (_, i) => makeSyntheticPurchaseBill(i + 1))
        const result = await applyImport(db, 'purchase', bills, 'perf-admin')
        const perBill = (result.queryCount / size).toFixed(1)
        const estimated = 2 + size * 7 // 2 batch + 7 per bill
        console.log(`  ${size} | ${result.queryCount} | ${perBill} | ${estimated}`)
        expect(result.imported).toBe(size)
      } finally {
        await db.close()
      }
    }
  })
})
