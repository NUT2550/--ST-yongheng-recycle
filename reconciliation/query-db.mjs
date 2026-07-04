/**
 * Query DB for:
 * - Current stock per stainless product (StockLot sum)
 * - SortingBills from 28/06/2569 onward (stainless-relevant)
 * - StockTransfers from 28/06/2569 onward (stainless-relevant)
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

try {
  // 1. Stainless products + current stock
  console.log('=== STAINLESS PRODUCTS + CURRENT STOCK ===')
  const cat = await db.productCategory.findFirst({ where: { name: { contains: 'แสตน' } }, include: { products: { orderBy: { sortOrder: 'asc' } } } })
  const products = []
  for (const p of cat.products) {
    const lots = await db.stockLot.aggregate({ where: { productId: p.id }, _sum: { remainingWeight: true } })
    const stock = lots._sum.remainingWeight ?? 0
    products.push({ id: p.id, name: p.name, stock })
    console.log(`  ${p.id} | ${p.name} | currentStock=${stock.toFixed(2)} kg`)
  }

  // 2. SortingBills from 28/06/2026 onward
  const cutoff = new Date('2026-06-28T00:00:00+07:00')
  console.log(`\n=== SORTING BILLS from ${cutoff.toISOString()} onward ===`)
  const sortBills = await db.sortingBill.findMany({
    where: {
      date: { gte: cutoff },
      isCancelled: false,
    },
    include: {
      sourceProduct: true,
      items: { include: { product: true } },
    },
    orderBy: { date: 'asc' },
  })
  console.log(`Found ${sortBills.length} sorting bills (not cancelled)`)
  for (const b of sortBills) {
    console.log(`  ${b.billNumber} | ${b.date.toISOString().substring(0,10)} | src: ${b.sourceProduct.name} ${b.sourceWeight}kg | room: ${b.roomNumber ?? '-'}`)
    for (const it of b.items) {
      console.log(`     -> ${it.product.name} ${it.weight}kg (waste=${it.isWaste})`)
    }
  }

  // Also include cancelled ones for reference
  const cancelledSort = await db.sortingBill.findMany({
    where: { date: { gte: cutoff }, isCancelled: true },
    include: { sourceProduct: true, items: { include: { product: true } } },
  })
  console.log(`\n(${cancelledSort.length} cancelled sorting bills in same range — EXCLUDED from calc)`)

  // 3. StockTransfers from 28/06/2026 onward
  console.log(`\n=== STOCK TRANSFERS from ${cutoff.toISOString()} onward ===`)
  const transfers = await db.stockTransfer.findMany({
    where: {
      date: { gte: cutoff },
      isCancelled: false,
    },
    include: {
      sourceProduct: true,
      items: { include: { product: true } },
    },
    orderBy: { date: 'asc' },
  })
  console.log(`Found ${transfers.length} stock transfers (not cancelled)`)
  for (const t of transfers) {
    console.log(`  ${t.billNumber} | ${t.date.toISOString().substring(0,10)} | src: ${t.sourceProduct.name} ${t.sourceWeight}kg | room: ${t.roomNumber ?? '-'}`)
    for (const it of t.items) {
      console.log(`     -> ${it.product.name} ${it.weight}kg (waste=${it.isWaste})`)
    }
  }

  const cancelledTrans = await db.stockTransfer.findMany({
    where: { date: { gte: cutoff }, isCancelled: true },
  })
  console.log(`\n(${cancelledTrans.length} cancelled stock transfers in same range — EXCLUDED from calc)`)

  // Save everything to JSON
  const fs = await import('fs')
  fs.writeFileSync('/home/z/my-project/reconciliation/db-data.json', JSON.stringify({
    products,
    sortBills: sortBills.map(b => ({
      id: b.id, billNumber: b.billNumber, date: b.date,
      sourceProductId: b.sourceProductId, sourceProductName: b.sourceProduct.name,
      sourceWeight: b.sourceWeight, roomNumber: b.roomNumber,
      items: b.items.map(it => ({
        productId: it.productId, productName: it.product.name,
        weight: it.weight, isWaste: it.isWaste,
      })),
    })),
    transfers: transfers.map(t => ({
      id: t.id, billNumber: t.billNumber, date: t.date,
      sourceProductId: t.sourceProductId, sourceProductName: t.sourceProduct.name,
      sourceWeight: t.sourceWeight, roomNumber: t.roomNumber,
      items: t.items.map(it => ({
        productId: it.productId, productName: it.product.name,
        weight: it.weight, isWaste: it.isWaste,
      })),
    })),
  }, null, 2))
  console.log('\nSaved to db-data.json')
} catch (e) {
  console.error('❌ DB error:', e.message)
} finally {
  await db.$disconnect()
}
