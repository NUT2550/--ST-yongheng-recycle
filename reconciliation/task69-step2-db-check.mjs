/**
 * Task 69: Verify production DB businessType values + production API responses.
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const TARGETS = ['TRN-2569-00006', 'TRN-2569-00008', 'TRN-2569-00009']

function fmt(d) { return d ? new Date(d).toISOString() : null }

console.log('=== TASK 2: VERIFY PRODUCTION DB businessType VALUES ===\n')

// First check if businessType column exists on production DB
const colCheck = await db.$queryRaw`
  SELECT column_name, data_type, is_nullable FROM information_schema.columns
  WHERE table_name = 'StockTransfer' AND column_name = 'businessType'
`
console.log('businessType column on StockTransfer:', colCheck)
const columnExists = Array.isArray(colCheck) && colCheck.length > 0

if (!columnExists) {
  console.log('\n❌ businessType column DOES NOT EXIST on production DB!')
  console.log('   This is the root cause — Task 68 added the column but it may not have persisted.')
} else {
  console.log('\n✅ businessType column EXISTS on production DB')
}

// Fetch the 3 target records
console.log('\n--- Target records ---')
const records = await db.stockTransfer.findMany({
  where: { billNumber: { in: TARGETS } },
  select: { id: true, billNumber: true, businessType: true, date: true, roomNumber: true, sourceProductId: true, sourceWeight: true, isCancelled: true },
  orderBy: { billNumber: 'asc' },
})

for (const t of TARGETS) {
  const r = records.find(x => x.billNumber === t)
  if (r) {
    const expected = t === 'TRN-2569-00006' ? 'แกะของ' : 'คัดแยก'
    const actual = r.businessType
    const match = actual === expected
    console.log(`  ${t}: id=${r.id}, businessType=${JSON.stringify(actual)}, date=${fmt(r.date)?.split('T')[0]}, room=${r.roomNumber}, sourceProductId=${r.sourceProductId}, sourceWeight=${r.sourceWeight}, cancelled=${r.isCancelled} → expected=${expected} ${match ? '✅ MATCH' : '❌ MISMATCH'}`)
  } else {
    console.log(`  ${t}: ❌ NOT FOUND in DB`)
  }
}

// Count all StockTransfers by businessType
console.log('\n--- All StockTransfers grouped by businessType ---')
const allTransfers = await db.stockTransfer.findMany({
  select: { billNumber: true, businessType: true, date: true, roomNumber: true, isCancelled: true },
  orderBy: { date: 'desc' },
})
const groups = {}
for (const t of allTransfers) {
  const key = t.businessType === null ? 'null' : t.businessType === '' ? 'empty' : t.businessType
  if (!groups[key]) groups[key] = []
  groups[key].push(t)
}
for (const [key, items] of Object.entries(groups)) {
  console.log(`  businessType=${key}: ${items.length} records`)
  for (const i of items) console.log(`    ${i.billNumber} | ${fmt(i.date)?.split('T')[0]} | room=${i.roomNumber} | cancelled=${i.isCancelled}`)
}

// Expected filter results
console.log('\n--- Expected API filter results ---')
const sortTab = allTransfers.filter(t => !t.isCancelled && t.businessType === 'คัดแยก')
const transferTab = allTransfers.filter(t => !t.isCancelled && (t.businessType === null || t.businessType === '' || t.businessType === 'แกะของ'))
console.log(`  businessType=คัดแยก (คัดแยก tab StockTransfers): ${sortTab.length} records`)
for (const t of sortTab) console.log(`    ${t.billNumber}`)
console.log(`  businessType=แกะของ OR null/empty (แกะของ tab): ${transferTab.length} records`)
for (const t of transferTab) console.log(`    ${t.billNumber}`)

await db.$disconnect()
