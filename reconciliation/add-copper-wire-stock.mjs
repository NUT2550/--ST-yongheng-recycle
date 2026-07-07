/**
 * Part B: Add owner-approved initial stock for สายไฟทองแดง
 * - 1,000 kg @ 40 THB/kg = 40,000 THB
 * - Create StockLot so FIFO works
 * - Create AuditLog for traceability
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

try {
  // Step 1: Locate product
  console.log('=== STEP 1: LOCATE PRODUCT ===')
  const product = await db.product.findFirst({
    where: { name: 'สายไฟทองแดง' },
    include: { category: true },
  })
  
  if (!product) {
    console.log('❌ Product "สายไฟทองแดง" not found — STOP')
    process.exit(1)
  }
  
  // Check for duplicates
  const duplicates = await db.product.findMany({ where: { name: 'สายไฟทองแดง' } })
  if (duplicates.length > 1) {
    console.log(`❌ Duplicate products found: ${duplicates.length} — STOP`)
    process.exit(1)
  }
  
  console.log(`  Product ID: ${product.id}`)
  console.log(`  Name: ${product.name}`)
  console.log(`  Category: ${product.category.name}`)
  
  // Step 2: Check current state
  console.log('\n=== STEP 2: CURRENT STATE (BEFORE) ===')
  const currentLots = await db.stockLot.findMany({ where: { productId: product.id } })
  const currentStock = currentLots.reduce((s, l) => s + l.remainingWeight, 0)
  console.log(`  Current stock: ${currentStock} kg`)
  console.log(`  Current StockLots: ${currentLots.length}`)
  console.log(`  Total remainingWeight: ${currentStock} kg`)
  
  if (currentStock !== 0) {
    console.log(`❌ Current stock is NOT 0 (it's ${currentStock} kg) — STOP`)
    console.log('   Owner must reconfirm before adding more stock.')
    process.exit(1)
  }
  
  console.log('\n  ✅ Current stock is 0 — safe to proceed')
  
  // Step 3: Record pre-apply counts for safety verification
  const preCounts = {
    totalProducts: await db.product.count(),
    totalStockLots: await db.stockLot.count(),
    totalBuyBills: await db.buyBill.count(),
    totalSellBills: await db.sellBill.count(),
    totalSortingBills: await db.sortingBill.count(),
    totalStockTransfers: await db.stockTransfer.count(),
  }
  const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0
  console.log('\n=== PRE-APPLY COUNTS ===')
  console.log(JSON.stringify(preCounts, null, 2))
  
  // Step 4: Create StockLot
  console.log('\n=== STEP 4: CREATE STOCKLOT ===')
  const stockLot = await db.stockLot.create({
    data: {
      productId: product.id,
      remainingWeight: 1000,
      costPerKg: 40,
      dateAdded: new Date(),
      source: 'BUY',
      sourceId: 'OWNER_INITIAL_STOCK_SETUP',
    },
  })
  console.log(`  ✅ StockLot created: ${stockLot.id}`)
  console.log(`     remainingWeight: ${stockLot.remainingWeight} kg`)
  console.log(`     costPerKg: ${stockLot.costPerKg} THB/kg`)
  console.log(`     source: ${stockLot.source}`)
  console.log(`     sourceId: ${stockLot.sourceId}`)
  
  // Step 5: Create AuditLog
  console.log('\n=== STEP 5: CREATE AUDITLOG ===')
  const auditLog = await db.auditLog.create({
    data: {
      action: 'CREATE',
      entityType: 'STOCK_LOT',
      entityId: stockLot.id,
      userId: null,
      userName: 'SYSTEM (owner-approved initial stock setup)',
      details: JSON.stringify({
        productId: product.id,
        productName: product.name,
        weight: 1000,
        costPerKg: 40,
        totalCost: 40000,
        source: 'OWNER_INITIAL_STOCK_SETUP',
        note: 'Owner-approved initial stock setup for สายไฟทองแดง to enable sorting/transfer source stock',
      }),
    },
  })
  console.log(`  ✅ AuditLog created: ${auditLog.id}`)
  
  // Step 6: Verify after applying
  console.log('\n=== STEP 6: VERIFY AFTER APPLYING ===')
  const verifyLots = await db.stockLot.findMany({ where: { productId: product.id } })
  const verifyStock = verifyLots.reduce((s, l) => s + l.remainingWeight, 0)
  console.log(`  Product stock: ${verifyStock} kg (expected: 1000)`)
  console.log(`  StockLot count: ${verifyLots.length} (expected: 1)`)
  console.log(`  StockLot remainingWeight: ${verifyLots[0]?.remainingWeight} kg (expected: 1000)`)
  console.log(`  StockLot costPerKg: ${verifyLots[0]?.costPerKg} THB/kg (expected: 40)`)
  
  // Verify no other products changed
  const postCounts = {
    totalProducts: await db.product.count(),
    totalStockLots: await db.stockLot.count(),
    totalBuyBills: await db.buyBill.count(),
    totalSellBills: await db.sellBill.count(),
    totalSortingBills: await db.sortingBill.count(),
    totalStockTransfers: await db.stockTransfer.count(),
  }
  const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0
  
  console.log('\n=== POST-APPLY COUNTS ===')
  console.log(JSON.stringify(postCounts, null, 2))
  
  console.log('\n=== SAFETY VERIFICATION ===')
  const checks = [
    { metric: 'Products', before: preCounts.totalProducts, after: postCounts.totalProducts },
    { metric: 'StockLots', before: preCounts.totalStockLots, after: postCounts.totalStockLots },
    { metric: 'BuyBills', before: preCounts.totalBuyBills, after: postCounts.totalBuyBills },
    { metric: 'SellBills', before: preCounts.totalSellBills, after: postCounts.totalSellBills },
    { metric: 'SortingBills', before: preCounts.totalSortingBills, after: postCounts.totalSortingBills },
    { metric: 'StockTransfers', before: preCounts.totalStockTransfers, after: postCounts.totalStockTransfers },
  ]
  let allSafe = true
  for (const c of checks) {
    const changed = c.before !== c.after
    const expected = c.metric === 'StockLots' // only StockLots should change (+1)
    const status = changed ? (expected ? '✅ EXPECTED' : '❌ UNEXPECTED') : '✅ UNCHANGED'
    if (changed && !expected) allSafe = false
    console.log(`  ${c.metric}: ${c.before} → ${c.after} ${status}`)
  }
  const stockDelta = postCounts.totalStockWeight - preCounts.totalStockWeight
  console.log(`  Total stock weight: ${preCounts.totalStockWeight} → ${postCounts.totalStockWeight} (${stockDelta > 0 ? '+' : ''}${stockDelta} kg) ${stockDelta === 1000 ? '✅ EXPECTED (+1000)' : '❌ UNEXPECTED'}`)
  console.log(`\n  All safe: ${allSafe ? '✅ YES' : '❌ NO'}`)
  
  // Final summary
  console.log('\n=== FINAL SUMMARY ===')
  console.log(`  Product ID: ${product.id}`)
  console.log(`  Before stock: 0 kg`)
  console.log(`  After stock: ${verifyStock} kg`)
  console.log(`  StockLot ID: ${stockLot.id}`)
  console.log(`  AuditLog ID: ${auditLog.id}`)
  console.log(`  FIFO ready: ${verifyStock >= 13.7 ? '✅ YES (1000 >= 13.7)' : '❌ NO'}`)
  
} catch (e) {
  console.error('❌ FATAL:', e.message)
  process.exit(1)
} finally {
  await db.$disconnect()
}
