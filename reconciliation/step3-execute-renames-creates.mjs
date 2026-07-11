/**
 * Step 3: Execute owner-approved renames + new product creations.
 *
 * APPROVED OPERATIONS:
 * - Rename 21 products: อลูมีเนียม → อลูมิเนียม (no collisions found)
 * - Create 10 new products (skip ฝาอลูมิเนียมเผา which already exists post-rename)
 *
 * SAFETY:
 * - No BuyBills created
 * - No StockLots created (initial stock = 0)
 * - No bill history modified
 * - No products deleted
 * - All operations are owner-approved
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const results = {
  renames: [],
  creates: [],
  errors: [],
}

try {
  // ========== PHASE 1: RENAME ==========
  console.log('=== PHASE 1: RENAME 21 products (อลูมีเนียม → อลูมิเนียม) ===\n')
  const renamePlan = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/rename-plan.json', 'utf8'))

  if (renamePlan.collisions.length > 0) {
    throw new Error('Collisions detected — aborting renames')
  }

  // Find max sortOrder in aluminum category for context (not needed for rename, just info)
  for (const r of renamePlan.toRename) {
    try {
      const before = await db.product.findUnique({ where: { id: r.id }, select: { name: true } })
      if (!before) {
        results.errors.push({ op: 'rename', id: r.id, error: 'product not found' })
        console.log(`  ❌ ${r.id} not found`)
        continue
      }
      if (before.name !== r.oldName) {
        results.errors.push({ op: 'rename', id: r.id, error: `name mismatch: expected "${r.oldName}", found "${before.name}"` })
        console.log(`  ⚠️ ${r.id} name mismatch — skipping`)
        continue
      }
      await db.product.update({
        where: { id: r.id },
        data: { name: r.newName },
      })
      results.renames.push({ id: r.id, oldName: r.oldName, newName: r.newName })
      console.log(`  ✅ ${r.id} | "${r.oldName}" → "${r.newName}"`)
    } catch (e) {
      results.errors.push({ op: 'rename', id: r.id, error: e.message })
      console.log(`  ❌ ${r.id} rename failed: ${e.message}`)
    }
  }
  console.log(`\nRenamed: ${results.renames.length} / ${renamePlan.toRename.length}\n`)

  // ========== PHASE 2: CREATE NEW PRODUCTS ==========
  console.log('=== PHASE 2: CREATE 10 new products (owner-approved) ===\n')
  const createPlan = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/create-plan.json', 'utf8'))

  // Skip the 1 that already exists (ฝาอลูมิเนียมเผา)
  // For the 5 near-duplicates, the owner EXPLICITLY approved creating them by name — proceed
  // For the 5 truly-missing, proceed
  const productsToCreate = [
    ...createPlan.toCreate,  // 5 truly missing
    ...createPlan.nearDuplicates.map(n => ({ name: n.requestedName, categoryId: createPlan.aluminumCategoryId, categoryName: 'อลูมิเนียม' })),  // 5 near-duplicates (owner-approved)
  ]

  // Find max sortOrder in aluminum category
  const maxSortOrder = await db.product.aggregate({
    where: { categoryId: createPlan.aluminumCategoryId },
    _max: { sortOrder: true },
  })
  let nextSortOrder = (maxSortOrder._max.sortOrder ?? 0) + 1

  for (const c of productsToCreate) {
    try {
      // Final safety check: does this name already exist?
      const existing = await db.product.findFirst({ where: { name: c.name } })
      if (existing) {
        results.errors.push({ op: 'create', name: c.name, error: `already exists as ${existing.id}`, skipped: true })
        console.log(`  ⏭️  "${c.name}" already exists as ${existing.id} — skipping`)
        continue
      }
      const created = await db.product.create({
        data: {
          name: c.name,
          categoryId: c.categoryId,
          defaultBuyPrice: 0,
          sortOrder: nextSortOrder++,
        },
      })
      results.creates.push({
        id: created.id,
        name: created.name,
        categoryId: created.categoryId,
        categoryName: c.categoryName,
        initialStock: 0,
      })
      console.log(`  ✅ ${created.id} | "${created.name}" (sortOrder: ${created.sortOrder})`)
    } catch (e) {
      results.errors.push({ op: 'create', name: c.name, error: e.message })
      console.log(`  ❌ "${c.name}" create failed: ${e.message}`)
    }
  }
  console.log(`\nCreated: ${results.creates.length} / ${productsToCreate.length}\n`)

  // ========== SUMMARY ==========
  console.log('=== EXECUTION SUMMARY ===')
  console.log(`  Renames applied:  ${results.renames.length}`)
  console.log(`  Products created: ${results.creates.length}`)
  console.log(`  Errors/skips:     ${results.errors.length}`)
  if (results.errors.length > 0) {
    console.log('\nErrors/skips detail:')
    for (const e of results.errors) {
      console.log(`  - ${e.op}: ${e.name || e.id} → ${e.error}`)
    }
  }

  // Verify final product count
  const finalCount = await db.product.count()
  console.log(`\nFinal MetalTrack product count: ${finalCount} (was 108, expected 118)`)

  fs.writeFileSync('/home/z/my-project/reconciliation/execution-results.json', JSON.stringify(results, null, 2))
  console.log('\nResults saved to execution-results.json')
} catch (e) {
  console.error('❌ FATAL:', e.message)
  process.exit(1)
} finally {
  await db.$disconnect()
}
