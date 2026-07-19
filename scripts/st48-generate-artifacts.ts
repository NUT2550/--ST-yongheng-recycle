/**
 * ST-48 deterministic allowlist + rollback artifact generator.
 *
 * Generates canonical JSON artifacts for the 49 eligible zero-cost StockLots
 * (excluding the 4 KNOWN_LEGACY_ZERO_COST lots). Computes SHA-256 checksums.
 *
 * READ-ONLY: queries Production for current data. Does NOT write to Production.
 * The artifacts are written to local files for inclusion in the Draft PR.
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'
import { writeFileSync } from 'fs'
import { ST47_OWNER_PRODUCT_BOUNDARIES } from '../src/lib/st47-owner-product-boundaries'
import { KNOWN_LEGACY_LOTS, isLegacyLot } from '../src/lib/st48-revaluation-plan'

const URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:5432/postgres'

const round6 = (n: number) => Math.round(n * 1_000_000) / 1_000_000
const round2 = (n: number) => Math.round(n * 100) / 100

// Canonical decimal string: always 6 decimal places for weights/costs
const dec6 = (n: number) => round6(n).toFixed(6)

interface AllowlistRow {
  lotId: string
  productId: string
  sourceType: string
  sourceId: string
  expectedCurrentCostPerKg: string
  expectedRemainingWeight: string
  proposedCostPerKg: string
  derivationMethod: string
  confidence: string
}

interface RollbackRow {
  lotId: string
  expectedAppliedCostPerKg: string
  rollbackCostPerKg: string
  expectedRemainingWeight: string
  productId: string
  releaseOperationId: string
}

async function main() {
  const db = new PrismaClient({ datasources: { db: { url: URL } } })
  try {
    console.log('=== ST-48 DETERMINISTIC ALLOWLIST + ROLLBACK GENERATOR ===')
    console.log('Cutoff: ' + new Date().toISOString())
    console.log()

    // Fetch all 53 zero-cost active lots
    const lots = await db.$queryRawUnsafe<any[]>(`
      SELECT sl.id, sl."productId", p.name AS "productName", sl."remainingWeight",
             sl."costPerKg", sl."dateAdded", sl.source, sl."sourceId"
        FROM "StockLot" sl JOIN "Product" p ON p.id = sl."productId"
       WHERE sl."remainingWeight" > 0 AND sl."costPerKg" = 0
       ORDER BY sl.id
    `)

    const allowlistRows: AllowlistRow[] = []
    const rollbackRows: RollbackRow[] = []
    const releaseOperationId = 'st48-release-gen1'
    let totalWeight = 0
    let totalValueIncrease = 0

    for (const lot of lots) {
      // Skip legacy lots
      if (isLegacyLot(lot.id)) continue

      // Resolve proposed cost using the same Hybrid priority as the revaluation plan
      let proposedCost = 0
      let method = 'HISTORICAL_WEIGHTED_AVERAGE'
      let confidence = 'MEDIUM'

      // Category D: sorting output — try exact sorting source avg cost
      if (lot.source === 'SORTING') {
        const sortBill = await db.$queryRawUnsafe<{ sourceproductid: string }[]>(`SELECT "sourceProductId" AS sourceproductid FROM "SortingBill" WHERE id = $1`, lot.sourceId)
        if (sortBill.length > 0) {
          const sourceCost = await db.$queryRawUnsafe<{ avg_cost: number }[]>(`SELECT COALESCE(AVG("costPerKg"), 0)::float8 AS avg_cost FROM "StockLot" WHERE "productId" = $1 AND "costPerKg" > 0 AND "dateAdded" <= $2`, sortBill[0].sourceproductid, lot.dateAdded)
          if (Number(sourceCost[0].avg_cost) > 0) {
            proposedCost = round6(Number(sourceCost[0].avg_cost))
            method = 'EXACT_SORTING_ALLOCATION'
            confidence = 'MEDIUM'
          }
        }
      }

      // Fallback: product historical weighted-average
      if (proposedCost === 0) {
        const hist = await db.$queryRawUnsafe<{ avg_cost: number; obs_count: bigint }[]>(`SELECT COALESCE(AVG("costPerKg"), 0)::float8 AS avg_cost, COUNT(*)::bigint AS obs_count FROM "StockLot" WHERE "productId" = $1 AND "costPerKg" > 0`, lot.productId)
        if (Number(hist[0].avg_cost) > 0) {
          proposedCost = round6(Number(hist[0].avg_cost))
          method = 'HISTORICAL_WEIGHTED_AVERAGE'
          confidence = Number(hist[0].obs_count) >= 3 ? 'MEDIUM' : 'LOW'
        }
      }

      if (proposedCost === 0) continue // skip if no cost could be derived (shouldn't happen for 49 eligible)

      totalWeight += Number(lot.remainingWeight)
      totalValueIncrease += round2(Number(lot.remainingWeight) * proposedCost)

      allowlistRows.push({
        lotId: lot.id,
        productId: lot.productId,
        sourceType: lot.source,
        sourceId: lot.sourceId,
        expectedCurrentCostPerKg: dec6(0),
        expectedRemainingWeight: dec6(Number(lot.remainingWeight)),
        proposedCostPerKg: dec6(proposedCost),
        derivationMethod: method,
        confidence,
      })

      rollbackRows.push({
        lotId: lot.id,
        expectedAppliedCostPerKg: dec6(proposedCost),
        rollbackCostPerKg: dec6(0),
        expectedRemainingWeight: dec6(Number(lot.remainingWeight)),
        productId: lot.productId,
        releaseOperationId,
      })
    }

    // Sort by lotId ascending
    allowlistRows.sort((a, b) => a.lotId.localeCompare(b.lotId))
    rollbackRows.sort((a, b) => a.lotId.localeCompare(b.lotId))

    // Canonical JSON: stable key order, sorted rows, UTF-8, one trailing newline
    const allowlistJson = JSON.stringify(allowlistRows, null, 2) + '\n'
    const rollbackJson = JSON.stringify(rollbackRows, null, 2) + '\n'

    // SHA-256 checksums
    const allowlistSha256 = createHash('sha256').update(allowlistJson, 'utf8').digest('hex')
    const rollbackSha256 = createHash('sha256').update(rollbackJson, 'utf8').digest('hex')

    // Write artifacts
    writeFileSync('scripts/st48-allowlist.json', allowlistJson, 'utf8')
    writeFileSync('scripts/st48-rollback.json', rollbackJson, 'utf8')

    console.log(`Allowlist rows: ${allowlistRows.length}`)
    console.log(`Total expected remaining weight: ${round6(totalWeight)} kg`)
    console.log(`Total proposed value increase: ${round2(totalValueIncrease)} THB`)
    console.log(`Allowlist SHA-256: ${allowlistSha256}`)
    console.log(`Allowlist file: scripts/st48-allowlist.json`)
    console.log()
    console.log(`Rollback rows: ${rollbackRows.length}`)
    console.log(`Rollback SHA-256: ${rollbackSha256}`)
    console.log(`Rollback file: scripts/st48-rollback.json`)
    console.log()

    // Verify no legacy lot appears in allowlist
    const legacyIds = KNOWN_LEGACY_LOTS.map(l => l.lotId)
    const legacyInAllowlist = allowlistRows.filter(r => legacyIds.includes(r.lotId))
    console.log(`Legacy lots in allowlist (should be 0): ${legacyInAllowlist.length}`)

    // Verify one-to-one mapping
    const allowlistIds = new Set(allowlistRows.map(r => r.lotId))
    const rollbackIds = new Set(rollbackRows.map(r => r.lotId))
    const missingInRollback = [...allowlistIds].filter(id => !rollbackIds.has(id))
    const extraInRollback = [...rollbackIds].filter(id => !allowlistIds.has(id))
    console.log(`Missing in rollback: ${missingInRollback.length}`)
    console.log(`Extra in rollback: ${extraInRollback.length}`)
    console.log(`One-to-one verified: ${missingInRollback.length === 0 && extraInRollback.length === 0 && allowlistRows.length === rollbackRows.length}`)

    // Method counts
    const methodCounts: Record<string, number> = {}
    for (const r of allowlistRows) methodCounts[r.derivationMethod] = (methodCounts[r.derivationMethod] || 0) + 1
    console.log()
    console.log('Method counts:')
    for (const [m, c] of Object.entries(methodCounts).sort()) console.log(`  ${m}: ${c}`)
  } finally {
    await db.$disconnect()
  }
}

main().catch(e => { console.error('FAILED:', e); process.exit(1) })
