/**
 * Step 4: Delete the duplicate "สายไฟอลูมิเนียม" that I just created.
 * Reason: MT already has "อลูมิเนียมสายไฟ" (same product, different word order).
 * The just-created product has 0 stock and no bill references — safe to delete.
 *
 * SAFETY: Only deleting a product I created in this same task (cmr7a7olr0003mzieoc9q18u2).
 *         NOT touching any pre-existing products.
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const DUPLICATE_ID = 'cmr7a7olr0003mzieoc9q18u2'  // "สายไฟอลูมิเนียม" — just created
const KEEP_ID = 'prod_mqgp9csvq0takfp04k5d2dv6'    // "อลูมิเนียมสายไฟ" — pre-existing

try {
  // Verify the duplicate exists and has 0 stock + no references
  const dup = await db.product.findUnique({
    where: { id: DUPLICATE_ID },
    include: {
      stockLots: { select: { id: true, remainingWeight: true } },
      buyItems: { select: { id: true } },
      sellItems: { select: { id: true } },
      sortingSource: { select: { id: true } },
      sortingItems: { select: { id: true } },
      transferSource: { select: { id: true } },
      transferItems: { select: { id: true } },
    },
  })

  if (!dup) {
    console.log(`Duplicate product ${DUPLICATE_ID} not found — nothing to delete.`)
    process.exit(0)
  }

  console.log(`Found duplicate: "${dup.name}" (${dup.id})`)
  console.log(`  StockLots: ${dup.stockLots.length} (total weight: ${dup.stockLots.reduce((s, l) => s + l.remainingWeight, 0)})`)
  console.log(`  BuyItems: ${dup.buyItems.length}`)
  console.log(`  SellItems: ${dup.sellItems.length}`)
  console.log(`  SortingSource: ${dup.sortingSource.length}`)
  console.log(`  SortingItems: ${dup.sortingItems.length}`)
  console.log(`  TransferSource: ${dup.transferSource.length}`)
  console.log(`  TransferItems: ${dup.transferItems.length}`)

  const hasReferences =
    dup.stockLots.length > 0 ||
    dup.buyItems.length > 0 ||
    dup.sellItems.length > 0 ||
    dup.sortingSource.length > 0 ||
    dup.sortingItems.length > 0 ||
    dup.transferSource.length > 0 ||
    dup.transferItems.length > 0

  if (hasReferences) {
    console.log(`\n❌ ABORT: duplicate has references — manual review needed`)
    process.exit(1)
  }

  // Verify the keeper exists
  const keeper = await db.product.findUnique({ where: { id: KEEP_ID } })
  if (!keeper) {
    console.log(`\n❌ ABORT: keeper product ${KEEP_ID} ("อลูมิเนียมสายไฟ") not found`)
    process.exit(1)
  }
  console.log(`\nKeeper: "${keeper.name}" (${keeper.id})`)

  // Delete the duplicate
  console.log(`\nDeleting duplicate "${dup.name}" (${dup.id})...`)
  await db.product.delete({ where: { id: DUPLICATE_ID } })
  console.log(`✅ Deleted.`)

  // Verify
  const finalCount = await db.product.count()
  console.log(`\nFinal MetalTrack product count: ${finalCount} (was 118, now 117)`)
} catch (e) {
  console.error('❌ DB error:', e.message)
  process.exit(1)
} finally {
  await db.$disconnect()
}
