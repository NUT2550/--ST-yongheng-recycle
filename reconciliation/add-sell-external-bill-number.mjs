/**
 * Add externalBillNumber column to SellBill table directly via SQL.
 * pgbouncer in transaction mode supports single-statement DDL fine.
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

async function main() {
  console.log('Adding externalBillNumber column to SellBill...')

  // Check if column exists first
  const colCheck = await db.$queryRaw`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'SellBill' AND column_name = 'externalBillNumber'
  `
  console.log('Column check:', colCheck)

  if (Array.isArray(colCheck) && colCheck.length === 0) {
    await db.$executeRawUnsafe(`ALTER TABLE "SellBill" ADD COLUMN "externalBillNumber" TEXT`)
    console.log('✅ Column added')
  } else {
    console.log('ℹ️  Column already exists, skipping')
  }

  // Check if unique constraint exists
  const conCheck = await db.$queryRaw`
    SELECT conname FROM pg_constraint
    WHERE conrelid = '"SellBill"'::regclass AND conname = 'SellBill_externalBillNumber_key'
  `
  console.log('Constraint check:', conCheck)

  if (Array.isArray(conCheck) && conCheck.length === 0) {
    await db.$executeRawUnsafe(`ALTER TABLE "SellBill" ADD CONSTRAINT "SellBill_externalBillNumber_key" UNIQUE ("externalBillNumber")`)
    console.log('✅ Unique constraint added')
  } else {
    console.log('ℹ️  Constraint already exists, skipping')
  }

  // Verify
  const verify = await db.$queryRaw`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_name = 'SellBill' ORDER BY ordinal_position
  `
  console.log('\nSellBill columns:')
  for (const row of verify) console.log(`  - ${row.column_name} (${row.data_type})`)
}

main().catch(e => { console.error('ERROR:', e); process.exit(1) }).finally(() => db.$disconnect())
