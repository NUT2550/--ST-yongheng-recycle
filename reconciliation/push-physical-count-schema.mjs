import { PrismaClient } from '@prisma/client'
import { requireDbUrl } from '../scripts/lib/require-db-url.mjs'
const SUPABASE_URL = requireDbUrl('SUPABASE_URL')
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

import pg from 'pg'
const pool = new pg.Pool({ connectionString: SUPABASE_URL })

try {
  // Create tables directly via SQL (pgbouncer DDL limitation)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS "PhysicalCountSession" (
      id TEXT PRIMARY KEY,
      "countDate" TIMESTAMP(3) NOT NULL,
      "group" TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      note TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL
    )
  `)
  console.log('✅ PhysicalCountSession table created')

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "PhysicalCountItem" (
      id TEXT PRIMARY KEY,
      "sessionId" TEXT NOT NULL REFERENCES "PhysicalCountSession"(id) ON DELETE CASCADE,
      "productId" TEXT NOT NULL REFERENCES "Product"(id),
      "systemWeight" DOUBLE PRECISION NOT NULL,
      "physicalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "differenceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "averageCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "valueDifference" DOUBLE PRECISION NOT NULL DEFAULT 0,
      note TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL
    )
  `)
  console.log('✅ PhysicalCountItem table created')

  await pool.query('CREATE INDEX IF NOT EXISTS "PhysicalCountSession_countDate_idx" ON "PhysicalCountSession"("countDate")')
  await pool.query('CREATE INDEX IF NOT EXISTS "PhysicalCountSession_group_idx" ON "PhysicalCountSession"("group")')
  await pool.query('CREATE INDEX IF NOT EXISTS "PhysicalCountItem_sessionId_idx" ON "PhysicalCountItem"("sessionId")')
  await pool.query('CREATE INDEX IF NOT EXISTS "PhysicalCountItem_productId_idx" ON "PhysicalCountItem"("productId")')
  console.log('✅ Indexes created')

  // Verify
  const res = await pool.query('SELECT COUNT(*) FROM "PhysicalCountSession"')
  console.log(`PhysicalCountSession rows: ${res.rows[0].count}`)
} catch (e) {
  console.error('❌:', e.message)
} finally {
  await pool.end()
  await db.$disconnect()
}
