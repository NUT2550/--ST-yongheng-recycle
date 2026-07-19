/**
 * ST-48 Production dry-run adapter — connects the revaluation plan tool to
 * the Production database. READ-ONLY: performs SELECT queries only.
 *
 * This script is the authoritative dry-run entry point. It uses the
 * st48-revaluation-plan tool with a Prisma adapter that resolves costs
 * deterministically without prefix heuristics.
 */
import { PrismaClient } from '@prisma/client'
import { generateRevaluationPlan, type RevaluationDeps } from '../src/lib/st48-revaluation-plan'

const URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres'

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } })
  try {
    const deps: RevaluationDeps = {
      async getZeroCostActiveLots() {
        return db.$queryRawUnsafe<Array<{
          id: string; productId: string; productName: string; remainingWeight: number;
          costPerKg: number; dateAdded: Date; createdAt: Date; source: string; sourceId: string;
        }>>(`
          SELECT sl.id, sl."productId", p.name AS "productName", sl."remainingWeight",
                 sl."costPerKg", sl."dateAdded", sl."createdAt", sl.source, sl."sourceId"
            FROM "StockLot" sl JOIN "Product" p ON p.id = sl."productId"
           WHERE sl."remainingWeight" > 0 AND sl."costPerKg" = 0
           ORDER BY sl."remainingWeight" DESC
        `)
      },

      async getBuyBillItemCost(buyBillId: string, productId: string) {
        // Deterministic resolution: find the BuyBillItem by buyBillId + productId.
        // If multiple items match (ambiguous), return null to block rather than guess.
        const items = await db.$queryRawUnsafe<{ pricePerKg: number }[]>(`
          SELECT "pricePerKg" FROM "BuyBillItem"
           WHERE "buyBillId" = $1 AND "productId" = $2
        `, buyBillId, productId)
        if (items.length === 0) return null
        if (items.length > 1) return null // ambiguous — block
        const cost = Number(items[0].pricePerKg)
        if (!Number.isFinite(cost) || cost <= 0) return null
        return cost
      },

      async getSortingSourceAvgCost(sourceProductId: string, beforeDate: Date) {
        const result = await db.$queryRawUnsafe<{ avg_cost: number }[]>(`
          SELECT COALESCE(AVG("costPerKg"), 0)::float8 AS avg_cost FROM "StockLot"
           WHERE "productId" = $1 AND "costPerKg" > 0 AND "dateAdded" <= $2
        `, sourceProductId, beforeDate)
        const avg = Number(result[0]?.avg_cost ?? 0)
        return avg > 0 ? avg : null
      },

      async getProductHistoricalAvgCost(productId: string) {
        const result = await db.$queryRawUnsafe<{ avg_cost: number; min_cost: number; max_cost: number; obs_count: bigint; total_weight: number }[]>(`
          SELECT COALESCE(AVG("costPerKg"), 0)::float8 AS avg_cost,
                 COALESCE(MIN("costPerKg"), 0)::float8 AS min_cost,
                 COALESCE(MAX("costPerKg"), 0)::float8 AS max_cost,
                 COUNT(*)::bigint AS obs_count,
                 COALESCE(SUM("remainingWeight"), 0)::float8 AS total_weight
            FROM "StockLot"
           WHERE "productId" = $1 AND "costPerKg" > 0
        `, productId)
        if (result.length === 0) return null
        const r = result[0]
        const avgCost = Number(r.avg_cost)
        if (avgCost <= 0) return null
        return {
          avgCost,
          obsCount: Number(r.obs_count),
          minCost: Number(r.min_cost),
          maxCost: Number(r.max_cost),
          totalWeight: Number(r.total_weight),
        }
      },

      async getFifoPosition(productId: string, lotId: string) {
        const result = await db.$queryRawUnsafe<{ rn: bigint }[]>(`
          WITH ranked AS (
            SELECT id, ROW_NUMBER() OVER (ORDER BY "dateAdded", "createdAt", id) AS rn
              FROM "StockLot" WHERE "productId" = $1 AND "remainingWeight" > 0
          ) SELECT rn::bigint FROM ranked WHERE id = $2
        `, productId, lotId)
        return result.length > 0 ? Number(result[0].rn) : null
      },
    }

    const cutoff = new Date().toISOString()
    const plan = await generateRevaluationPlan(deps, cutoff)

    console.log('=== ST-48 HYBRID DRY-RUN REVALUATION (CORRECTED) ===')
    console.log(`Cutoff: ${cutoff}`)
    console.log(`Apply mode: ${plan.applyMode ? 'ENABLED' : 'BLOCKED'}`)
    console.log()
    console.log(`Eligible lots: ${plan.totalLots}`)
    console.log(`Total remaining weight: ${plan.totalRemainingWeight} kg`)
    console.log(`Before inventory value: ${plan.totalBeforeValue} THB`)
    console.log(`Proposed after inventory value: ${plan.totalAfterValue} THB`)
    console.log(`Total value increase: ${plan.totalValueIncrease} THB`)
    console.log()
    console.log('Derivation methods:')
    for (const [m, c] of Object.entries(plan.byMethod).sort()) console.log(`  ${m}: ${c}`)
    console.log()
    console.log(`Exact-cost lots: ${plan.exactCount}`)
    console.log(`Weighted-average lots: ${plan.weightedAverageCount}`)
    console.log(`Unresolved: ${plan.unresolvedCount}`)
    console.log()
    console.log('By category:')
    for (const [cat, data] of Object.entries(plan.byCategory).sort()) {
      console.log(`  ${cat}: ${data.lots} lots, ${Math.round(data.weight * 1e6) / 1e6} kg, ${Math.round(data.value * 100) / 100} THB`)
    }

    // Print the 3 Category B lots specifically
    console.log()
    console.log('=== CATEGORY B (EXACT_BUY_SOURCE) LOTS ===')
    const catB = plan.eligibleLots.filter(l => l.category === 'B_MANUAL_PURCHASE')
    for (const l of catB) {
      console.log(`  ${l.lotId.slice(-8)} | ${l.productName} | ${l.remainingWeight} kg | cost=${l.proposedCostPerKg} | method=${l.derivationMethod} | conf=${l.confidence}`)
    }

    // Print unresolved lots
    console.log()
    console.log('=== UNRESOLVED LOTS ===')
    const unresolved = plan.eligibleLots.filter(l => l.derivationMethod === 'OWNER_DECISION_REQUIRED')
    for (const l of unresolved) {
      console.log(`  ${l.lotId.slice(-8)} | ${l.productName} | ${l.remainingWeight} kg | ${l.unresolvedWarning}`)
    }

    // Top 10 exposures
    console.log()
    console.log('=== TOP 10 VALUE EXPOSURES ===')
    const sorted = [...plan.eligibleLots].sort((a, b) => (b.afterValue ?? 0) - (a.afterValue ?? 0))
    for (const l of sorted.slice(0, 10)) {
      console.log(`  ${l.productName}: ${l.remainingWeight} kg × ${l.proposedCostPerKg} = ${l.afterValue} THB (${l.derivationMethod}, ${l.confidence})`)
    }
  } finally {
    await db.$disconnect()
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
