/**
 * ST-47 Product-mapping gate + dry-run reconciliation (READ-ONLY).
 *
 * Performs ONLY SELECT queries against Production. Creates, updates, deletes
 * NOTHING. Verifies every Owner-boundary product ID exists in Production and
 * derives per-product movement totals from 2026-01-01 onward.
 *
 * Output: a reconciliation table for all mapped products.
 */
import { PrismaClient } from '@prisma/client'
import { ST47_OWNER_PRODUCT_BOUNDARIES, OWNER_ACCEPTED_VARIANCES, assertUniqueOwnerProductBoundaries } from '../src/lib/st47-owner-product-boundaries'

const SUPABASE_POOLER_URL =
  'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'

interface ProductRow {
  id: string
  name: string
  categoryName: string | null
}

interface MovementRow {
  productId: string
  purchaseIn: number
  salesOut: number
  sortingSourceOut: number
  sortingOutputIn: number
  transferSourceOut: number
  transferOutputIn: number
  recordCount: number
}

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: SUPABASE_POOLER_URL } } })
  try {
    assertUniqueOwnerProductBoundaries()

    const productIds = ST47_OWNER_PRODUCT_BOUNDARIES.map(b => b.productId)

    // 1. Verify every product ID exists in Production.
    const products = await db.$queryRawUnsafe<ProductRow[]>(
      `SELECT p.id, p.name, c.name AS "categoryName"
         FROM "Product" p
         LEFT JOIN "ProductCategory" c ON p."categoryId" = c.id
        WHERE p.id = ANY ($1::text[])`,
      productIds
    )
    const productMap = new Map(products.map(p => [p.id, p]))

    // 2. Derive movements from 2026-01-01 to 2026-07-18 (Thailand business dates).
    //    Use the bill `date` field (business date), not createdAt.
    //    Exclude cancelled bills.
    const movements = await db.$queryRawUnsafe<MovementRow[]>(
      `
      WITH movement_data AS (
        SELECT bi."productId" AS pid, bi.weight AS w, 'PURCHASE_IN' AS mt
          FROM "BuyBillItem" bi
          JOIN "BuyBill" b ON bi."buyBillId" = b.id
         WHERE b."isCancelled" = false
           AND b.date >= '2026-01-01'
           AND b.date < '2026-07-19'
        UNION ALL
        SELECT si."productId" AS pid, -si.weight AS w, 'SALE_OUT' AS mt
          FROM "SellBillItem" si
          JOIN "SellBill" s ON si."sellBillId" = s.id
         WHERE s."isCancelled" = false
           AND s.date >= '2026-01-01'
           AND s.date < '2026-07-19'
        UNION ALL
        SELECT sb."sourceProductId" AS pid, -sb."sourceWeight" AS w, 'SORTING_SOURCE_OUT' AS mt
          FROM "SortingBill" sb
         WHERE sb."isCancelled" = false
           AND sb.date >= '2026-01-01'
           AND sb.date < '2026-07-19'
        UNION ALL
        SELECT si."productId" AS pid, si.weight AS w, 'SORTING_OUTPUT_IN' AS mt
          FROM "SortingBillItem" si
          JOIN "SortingBill" sb ON si."sortingBillId" = sb.id
         WHERE sb."isCancelled" = false
           AND sb.date >= '2026-01-01'
           AND sb.date < '2026-07-19'
           AND si."isWaste" = false
        UNION ALL
        SELECT st."sourceProductId" AS pid, -st."sourceWeight" AS w, 'TRANSFER_SOURCE_OUT' AS mt
          FROM "StockTransfer" st
         WHERE st."isCancelled" = false
           AND st.date >= '2026-01-01'
           AND st.date < '2026-07-19'
        UNION ALL
        SELECT sti."productId" AS pid, sti.weight AS w, 'TRANSFER_OUTPUT_IN' AS mt
          FROM "StockTransferItem" sti
          JOIN "StockTransfer" st ON sti."stockTransferId" = st.id
         WHERE st."isCancelled" = false
           AND st.date >= '2026-01-01'
           AND st.date < '2026-07-19'
           AND sti."isWaste" = false
      )
      SELECT pid AS "productId",
             COALESCE(SUM(CASE WHEN mt = 'PURCHASE_IN' THEN w ELSE 0 END), 0)::float8 AS "purchaseIn",
             COALESCE(SUM(CASE WHEN mt = 'SALE_OUT' THEN w ELSE 0 END), 0)::float8 AS "salesOut",
             COALESCE(SUM(CASE WHEN mt = 'SORTING_SOURCE_OUT' THEN w ELSE 0 END), 0)::float8 AS "sortingSourceOut",
             COALESCE(SUM(CASE WHEN mt = 'SORTING_OUTPUT_IN' THEN w ELSE 0 END), 0)::float8 AS "sortingOutputIn",
             COALESCE(SUM(CASE WHEN mt = 'TRANSFER_SOURCE_OUT' THEN w ELSE 0 END), 0)::float8 AS "transferSourceOut",
             COALESCE(SUM(CASE WHEN mt = 'TRANSFER_OUTPUT_IN' THEN w ELSE 0 END), 0)::float8 AS "transferOutputIn",
             COUNT(*)::int AS "recordCount"
        FROM movement_data
       WHERE pid = ANY ($1::text[])
       GROUP BY pid
      `,
      productIds
    )
    const movementMap = new Map(movements.map(m => [m.productId, m]))

    // 3. Current StockLot totals (for reconciliation comparison)
    const stockLotTotals = await db.$queryRawUnsafe<{ productId: string; total: number }[]>(
      `SELECT "productId", COALESCE(SUM("remainingWeight"),0)::float8 AS total
         FROM "StockLot"
        WHERE "productId" = ANY ($1::text[])
        GROUP BY "productId"`,
      productIds
    )
    const stockLotMap = new Map(stockLotTotals.map(s => [s.productId, Number(s.total)]))

    // 4. Build reconciliation table
    const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000
    const ownerConfirmedClosing: Record<string, number | undefined> = {
      'ขี้กลึงทองเหลืองเนื้อแดง': 0,
      'แท็บเล็ต': 0,
      'แผงวงจรติดสายไฟ': 0,
      'สายไฟไม่ปอก': 987.8,
      'เปลือกสายไฟ': 1000,
    }

    const rows = ST47_OWNER_PRODUCT_BOUNDARIES.map(b => {
      const product = productMap.get(b.productId)
      const movement = movementMap.get(b.productId)
      const stockLotTotal = stockLotMap.get(b.productId) ?? null
      const startingWeight = b.startingWeight ?? 0
      // All movement fields are SIGNED (the SQL stores -weight for OUT categories).
      // netMovement is the direct sum of all signed components — no double negation.
      const purchaseIn = movement?.purchaseIn ?? 0        // positive (in)
      const salesOut = movement?.salesOut ?? 0            // negative (out)
      const sortingSourceOut = movement?.sortingSourceOut ?? 0  // negative (out)
      const sortingOutputIn = movement?.sortingOutputIn ?? 0    // positive (in)
      const transferSourceOut = movement?.transferSourceOut ?? 0  // negative (out)
      const transferOutputIn = movement?.transferOutputIn ?? 0    // positive (in)
      const netMovement = purchaseIn + salesOut + sortingSourceOut + sortingOutputIn + transferSourceOut + transferOutputIn
      const calculatedClosing = round6(startingWeight + netMovement)
      const ownerTarget = b.currentTarget ?? ownerConfirmedClosing[b.ownerLabel]
      const stockLotDiff = stockLotTotal == null ? null : round6(calculatedClosing - stockLotTotal)
      const ownerDiff = ownerTarget == null ? null : round6(calculatedClosing - ownerTarget)
      const acceptedVariance = OWNER_ACCEPTED_VARIANCES[b.ownerLabel]

      let classification = 'NOT_VERIFIED'
      if (!product) classification = 'MISSING_PRODUCT'
      else if (acceptedVariance && ownerDiff !== null &&
               Math.abs(round6(ownerDiff - acceptedVariance.acceptedVariance)) < 0.01) {
        classification = 'OWNER_ACCEPTED_VARIANCE'
      }
      else if (ownerTarget != null && ownerDiff !== null && Math.abs(ownerDiff) < 0.01) classification = 'OWNER_VALUE_MATCH'
      else if (stockLotTotal != null && stockLotDiff !== null && Math.abs(stockLotDiff) < 0.01) classification = 'MATCH'
      else if (stockLotTotal != null && stockLotDiff !== null) classification = 'STOCKLOT_MISMATCH'
      else if (ownerTarget != null && ownerDiff !== null) classification = 'OWNER_VALUE_MISMATCH'

      return {
        ownerLabel: b.ownerLabel,
        productId: b.productId,
        productName: product?.name ?? '(MISSING)',
        originalStartDate: b.originalStartDate,
        effectiveStartDate: b.effectiveStartDate,
        startingWeight: round6(startingWeight),
        startingWeightSource: b.startingWeight != null ? 'OWNER_BOUNDARY' : (ownerConfirmedClosing[b.ownerLabel] != null ? 'DERIVED_FROM_OWNER_CLOSING' : 'ZERO_DEFAULT'),
        purchaseIn: round6(purchaseIn),
        salesOut: round6(salesOut),
        sortingSourceOut: round6(sortingSourceOut),
        sortingOutputIn: round6(sortingOutputIn),
        transferSourceOut: round6(transferSourceOut),
        transferOutputIn: round6(transferOutputIn),
        netMovement: round6(netMovement),
        calculatedClosing,
        currentStockLotTotal: stockLotTotal == null ? null : round6(stockLotTotal),
        ownerConfirmedClosing: ownerTarget ?? null,
        stockLotDiff,
        ownerDiff,
        acceptedVariance: acceptedVariance ?? null,
        classification,
      }
    })

    console.log(JSON.stringify({ generatedAt: new Date().toISOString(), productCount: rows.length, rows }, null, 2))
  } finally {
    await db.$disconnect()
  }
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1) })
