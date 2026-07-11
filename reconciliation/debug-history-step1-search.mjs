/**
 * Task 67: Debug Missing 08/07/2569 Sorting Records in History Page
 * Step 1: Search DB for TRN-2569-00006, TRN-2569-00008, TRN-2569-00009
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const TARGETS = ['TRN-2569-00006', 'TRN-2569-00008', 'TRN-2569-00009']

function fmt(d) { return d ? new Date(d).toISOString() : null }

console.log('=== STEP 1: SEARCH DB FOR TARGET BILLS ===\n')

// Search in SortingBill
console.log('--- Searching SortingBill ---')
const sortingBills = await db.sortingBill.findMany({
  where: { billNumber: { in: TARGETS } },
  include: { items: true, sourceProduct: { select: { name: true } } },
})
console.log(`Found ${sortingBills.length} in SortingBill`)
for (const b of sortingBills) {
  console.log(`\n  billNumber: ${b.billNumber}`)
  console.log(`  id: ${b.id}`)
  console.log(`  type: ${b.type}`)
  console.log(`  room: ${b.room}`)
  console.log(`  transactionDate: ${fmt(b.transactionDate)}`)
  console.log(`  createdAt: ${fmt(b.createdAt)}`)
  console.log(`  updatedAt: ${fmt(b.updatedAt)}`)
  console.log(`  status/cancelled: isCancelled=${b.isCancelled}, cancelledAt=${fmt(b.cancelledAt)}`)
  console.log(`  sourceProductId: ${b.sourceProductId}`)
  console.log(`  sourceProduct: ${b.sourceProduct?.name}`)
  console.log(`  inputWeight: ${b.inputWeight}`)
  console.log(`  outputWeight: ${b.outputWeight}`)
  console.log(`  lossWeight: ${b.lossWeight}`)
  console.log(`  totalAmount: ${b.totalAmount}`)
  console.log(`  note: ${b.note}`)
  console.log(`  items count: ${b.items.length}`)
  console.log(`  items roles: ${b.items.map(i => i.role).join(', ')}`)
}

// Search in StockTransfer (the "แกะของ" might be a stock transfer)
console.log('\n--- Searching StockTransfer ---')
const stockTransfers = await db.stockTransfer.findMany({
  where: { billNumber: { in: TARGETS } },
  include: { items: true, sourceProduct: { select: { name: true } } },
})
console.log(`Found ${stockTransfers.length} in StockTransfer`)
for (const b of stockTransfers) {
  console.log(`\n  billNumber: ${b.billNumber}`)
  console.log(`  id: ${b.id}`)
  console.log(`  type: ${b.type}`)
  console.log(`  room: ${b.room}`)
  console.log(`  transactionDate: ${fmt(b.transactionDate)}`)
  console.log(`  createdAt: ${fmt(b.createdAt)}`)
  console.log(`  status/cancelled: isCancelled=${b.isCancelled}, cancelledAt=${fmt(b.cancelledAt)}`)
  console.log(`  sourceProductId: ${b.sourceProductId}`)
  console.log(`  sourceProduct: ${b.sourceProduct?.name}`)
  console.log(`  inputWeight: ${b.inputWeight}`)
  console.log(`  totalAmount: ${b.totalAmount}`)
  console.log(`  note: ${b.note}`)
  console.log(`  items count: ${b.items.length}`)
}

// Also do a broader search by billNumber prefix to catch any TRN-2569 records
console.log('\n--- Broader search: all SortingBills with TRN-2569 billNumber ---')
const allTrnSorting = await db.sortingBill.findMany({
  where: { billNumber: { startsWith: 'TRN-2569-' } },
  select: { id: true, billNumber: true, type: true, room: true, transactionDate: true, createdAt: true, isCancelled: true, inputWeight: true },
  orderBy: { billNumber: 'asc' },
})
console.log(`Found ${allTrnSorting.length} SortingBills with TRN-2569-* billNumber:`)
for (const b of allTrnSorting) console.log(`  ${b.billNumber} | type=${b.type} | room=${b.room} | date=${fmt(b.transactionDate)?.split('T')[0]} | created=${fmt(b.createdAt)?.split('T')[0]} | cancelled=${b.isCancelled} | input=${b.inputWeight}`)

console.log('\n--- Broader search: all StockTransfers with TRN-2569 billNumber ---')
const allTrnTransfers = await db.stockTransfer.findMany({
  where: { billNumber: { startsWith: 'TRN-2569-' } },
  select: { id: true, billNumber: true, type: true, room: true, transactionDate: true, createdAt: true, isCancelled: true, inputWeight: true },
  orderBy: { billNumber: 'asc' },
})
console.log(`Found ${allTrnTransfers.length} StockTransfers with TRN-2569-* billNumber:`)
for (const b of allTrnTransfers) console.log(`  ${b.billNumber} | type=${b.type} | room=${b.room} | date=${fmt(b.transactionDate)?.split('T')[0]} | created=${fmt(b.createdAt)?.split('T')[0]} | cancelled=${b.isCancelled} | input=${b.inputWeight}`)

// Check recent SortingBills by date (any with transactionDate in July 2569)
console.log('\n--- All SortingBills with transactionDate in July 2026 ---')
const julySorting = await db.sortingBill.findMany({
  where: { transactionDate: { gte: new Date('2026-07-01'), lte: new Date('2026-07-31') } },
  select: { id: true, billNumber: true, type: true, room: true, transactionDate: true, createdAt: true, isCancelled: true, inputWeight: true },
  orderBy: { transactionDate: 'desc' },
})
console.log(`Found ${julySorting.length} SortingBills in July 2026:`)
for (const b of julySorting) console.log(`  ${b.billNumber || '(no billNumber)'} | type=${b.type} | room=${b.room} | date=${fmt(b.transactionDate)?.split('T')[0]} | created=${fmt(b.createdAt)} | cancelled=${b.isCancelled} | input=${b.inputWeight}`)

// Check recent StockTransfers by date
console.log('\n--- All StockTransfers with transactionDate in July 2026 ---')
const julyTransfers = await db.stockTransfer.findMany({
  where: { transactionDate: { gte: new Date('2026-07-01'), lte: new Date('2026-07-31') } },
  select: { id: true, billNumber: true, type: true, room: true, transactionDate: true, createdAt: true, isCancelled: true, inputWeight: true },
  orderBy: { transactionDate: 'desc' },
})
console.log(`Found ${julyTransfers.length} StockTransfers in July 2026:`)
for (const b of julyTransfers) console.log(`  ${b.billNumber || '(no billNumber)'} | type=${b.type} | room=${b.room} | date=${fmt(b.transactionDate)?.split('T')[0]} | created=${fmt(b.createdAt)} | cancelled=${b.isCancelled} | input=${b.inputWeight}`)

await db.$disconnect()
