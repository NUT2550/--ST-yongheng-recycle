/**
 * Task 41: Apply final owner-approved product master sync.
 *
 * OPERATIONS (all owner-approved):
 *
 * Phase A — Renames (3, preserve productId):
 *   1. cmr09vcvf0008l105vtay0h8k: "เหล็กเส้น 6 หุน (1.8m ขึ้นไป)" → "เหล็กเส้น 6 หุน"
 *   2. prod_mqgp9do7ui6p53xv2tbjq7tb: "อลูมิเนียมแข็ง" → "อลูมิเนียมแข็ง (หล่อ/หนา)"
 *   3. prod_mqgp9cgafv9ts0i3ze22h1vb: "แสตนเลส 304 (ยาว)" → "แสตนเลส 304 ยาว"
 *
 * Phase B — Category change (1):
 *   4. cmr09vcvk002il1059frrfzsp: "แผงวงจรเขียว" — อื่นๆ → อิเล็กทรอนิกส์
 *
 * Phase C — Nickel consolidation (Rule 3):
 *   5. cmr09vcvk002gl105fbuztaig: "นิกเกิล" — change category อื่นๆ → แสตนเลส
 *   6. cmr09vcvi001ol105nmz9gye6: "นิกเกิล(สแตนเลส)" — DELETE (0 stock, 0 movement, safe)
 *      Final: only one active nickel product = "นิกเกิล" in แสตนเลส
 *
 * Phase D — Create missing products (10, initial stock 0, no StockLots):
 *   7. สายไฟอลูมิเนียม (อลูมิเนียม) — Rule 1: separate from อลูมิเนียมสายไฟ
 *   8. อลูมิเนียมฝาไม่แกะ (อลูมิเนียม) — Rule 2: separate from อลูมิเนียมฝา
 *   9. แหนบ (เหล็ก)
 *  10. เหล็กคัดขาย (เหล็ก)
 *  11. อลูมิเนียมล้อแม็ค (อลูมิเนียม)
 *  12. ขี้กลึงอลูมิเนียม (อลูมิเนียม)
 *  13. ฟรอยไม่ติดพลาสติก (อลูมิเนียม)
 *  14. ฝาเนียมเผา (อลูมิเนียม)
 *  15. สายไฟทองแดง (อื่นๆ)
 *  16. เบิกใช้งานภายในบริษัท (อื่นๆ)
 *
 * Rule 4: Do NOT create "อลูมิเนียมแข็งก้ามเบรค" — use existing "อลูมิเนียมแข็งก้านเบรค" (already in MT)
 *
 * SAFETY:
 * - No stock quantities changed
 * - No StockLots created/deleted
 * - No bill records modified
 * - No products with stock/movement deleted
 */
import { PrismaClient } from '@prisma/client'
const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const results = { renames: [], creates: [], categoryChanges: [], deletes: [], errors: [] }

try {
  // Get category IDs
  const categories = await db.productCategory.findMany()
  const catByName = new Map(categories.map(c => [c.name, c.id]))
  console.log('Categories:', [...catByName.keys()].join(', '))

  // ========== PHASE A: RENAMES ==========
  console.log('\n=== PHASE A: RENAMES (3 products) ===\n')
  const renames = [
    { id: 'cmr09vcvf0008l105vtay0h8k', oldName: 'เหล็กเส้น 6 หุน (1.8m ขึ้นไป)', newName: 'เหล็กเส้น 6 หุน' },
    { id: 'prod_mqgp9do7ui6p53xv2tbjq7tb', oldName: 'อลูมิเนียมแข็ง', newName: 'อลูมิเนียมแข็ง (หล่อ/หนา)' },
    { id: 'prod_mqgp9cgafv9ts0i3ze22h1vb', oldName: 'แสตนเลส 304 (ยาว)', newName: 'แสตนเลส 304 ยาว' },
  ]
  for (const r of renames) {
    try {
      // Verify product exists with expected name
      const existing = await db.product.findUnique({ where: { id: r.id }, select: { name: true } })
      if (!existing) { results.errors.push({ op: 'rename', id: r.id, error: 'not found' }); console.log(`  ❌ ${r.id} not found`); continue }
      if (existing.name !== r.oldName) { results.errors.push({ op: 'rename', id: r.id, error: `name mismatch: expected "${r.oldName}", found "${existing.name}"` }); console.log(`  ⚠️ ${r.id} name mismatch — skipping`); continue }
      // Check for collision (new name already exists as different product)
      const collision = await db.product.findFirst({ where: { name: r.newName, id: { not: r.id } } })
      if (collision) { results.errors.push({ op: 'rename', id: r.id, error: `new name "${r.newName}" collides with existing product ${collision.id}` }); console.log(`  ❌ ${r.id} collision — skipping`); continue }
      // Apply rename
      await db.product.update({ where: { id: r.id }, data: { name: r.newName } })
      results.renames.push({ id: r.id, oldName: r.oldName, newName: r.newName })
      console.log(`  ✅ ${r.id} | "${r.oldName}" → "${r.newName}"`)
    } catch (e) { results.errors.push({ op: 'rename', id: r.id, error: e.message }); console.log(`  ❌ ${r.id} failed: ${e.message}`) }
  }

  // ========== PHASE B: CATEGORY CHANGE ==========
  console.log('\n=== PHASE B: CATEGORY CHANGE (1 product) ===\n')
  const catChange = { id: 'cmr09vcvk002il1059frrfzsp', name: 'แผงวงจรเขียว', oldCat: 'อื่นๆ', newCat: 'อิเล็กทรอนิกส์' }
  try {
    const newCatId = catByName.get(catChange.newCat)
    if (!newCatId) { results.errors.push({ op: 'categoryChange', id: catChange.id, error: `category "${catChange.newCat}" not found` }); console.log(`  ❌ category not found`) }
    else {
      await db.product.update({ where: { id: catChange.id }, data: { categoryId: newCatId } })
      results.categoryChanges.push({ id: catChange.id, name: catChange.name, oldCat: catChange.oldCat, newCat: catChange.newCat })
      console.log(`  ✅ ${catChange.id} | "${catChange.name}" category: ${catChange.oldCat} → ${catChange.newCat}`)
    }
  } catch (e) { results.errors.push({ op: 'categoryChange', id: catChange.id, error: e.message }); console.log(`  ❌ ${catChange.id} failed: ${e.message}`) }

  // ========== PHASE C: NICKEL CONSOLIDATION ==========
  console.log('\n=== PHASE C: NICKEL CONSOLIDATION ===\n')
  // 5. Move นิกเกิล to แสตนเลส
  const nickelId = 'cmr09vcvk002gl105fbuztaig'
  const stainlessCatId = catByName.get('แสตนเลส')
  try {
    const nickel = await db.product.findUnique({ where: { id: nickelId }, include: { category: true } })
    if (!nickel) { results.errors.push({ op: 'nickelMove', id: nickelId, error: 'not found' }); console.log(`  ❌ นิกเกิล not found`) }
    else {
      console.log(`  Before: "${nickel.name}" in category "${nickel.category.name}"`)
      await db.product.update({ where: { id: nickelId }, data: { categoryId: stainlessCatId } })
      results.categoryChanges.push({ id: nickelId, name: 'นิกเกิล', oldCat: 'อื่นๆ', newCat: 'แสตนเลส', reason: 'Rule 3: nickel final category' })
      console.log(`  ✅ ${nickelId} | "นิกเกิล" category: อื่นๆ → แสตนเลส`)
    }
  } catch (e) { results.errors.push({ op: 'nickelMove', id: nickelId, error: e.message }); console.log(`  ❌ นิกเกิล move failed: ${e.message}`) }

  // 6. Delete นิกเกิล(สแตนเลส) — safe (0 stock, 0 movement, verified)
  const nickelStainlessId = 'cmr09vcvi001ol105nmz9gye6'
  try {
    const ns = await db.product.findUnique({ where: { id: nickelStainlessId }, select: { name: true } })
    if (!ns) { console.log(`  ⏭️  นิกเกิล(สแตนเลส) already deleted`); results.deletes.push({ id: nickelStainlessId, name: 'นิกเกิล(สแตนเลส)', status: 'already_deleted' }) }
    else {
      // Final safety check: 0 stock, 0 movement
      const stockCount = await db.stockLot.count({ where: { productId: nickelStainlessId, remainingWeight: { gt: 0 } } })
      const buyItem = await db.buyBillItem.count({ where: { productId: nickelStainlessId } })
      const sellItem = await db.sellBillItem.count({ where: { productId: nickelStainlessId } })
      const sortSource = await db.sortingBill.count({ where: { sourceProductId: nickelStainlessId } })
      const sortItem = await db.sortingBillItem.count({ where: { productId: nickelStainlessId } })
      const transferSource = await db.stockTransfer.count({ where: { sourceProductId: nickelStainlessId } })
      const transferItem = await db.stockTransferItem.count({ where: { productId: nickelStainlessId } })
      const safe = (stockCount + buyItem + sellItem + sortSource + sortItem + transferSource + transferItem) === 0
      if (!safe) {
        results.errors.push({ op: 'delete', id: nickelStainlessId, error: `NOT SAFE: stock=${stockCount} buy=${buyItem} sell=${sellItem} sortSrc=${sortSource} sortItem=${sortItem} trnSrc=${transferSource} trnItem=${transferItem}` })
        console.log(`  ❌ นิกเกิล(สแตนเลส) NOT safe to delete — has references`)
      } else {
        await db.product.delete({ where: { id: nickelStainlessId } })
        results.deletes.push({ id: nickelStainlessId, name: 'นิกเกิล(สแตนเลส)', status: 'deleted', reason: 'Rule 3: consolidated into นิกเกิล (0 stock, 0 movement)' })
        console.log(`  ✅ ${nickelStainlessId} | "นิกเกิล(สแตนเลส)" DELETED (safe: 0 stock, 0 movement)`)
      }
    }
  } catch (e) { results.errors.push({ op: 'delete', id: nickelStainlessId, error: e.message }); console.log(`  ❌ นิกเกิล(สแตนเลส) delete failed: ${e.message}`) }

  // ========== PHASE D: CREATE MISSING PRODUCTS ==========
  console.log('\n=== PHASE D: CREATE MISSING PRODUCTS (10 products) ===\n')
  const toCreate = [
    { name: 'สายไฟอลูมิเนียม', category: 'อลูมิเนียม', reason: 'Rule 1: insulated aluminum cable (separate from อลูมิเนียมสายไฟ)' },
    { name: 'อลูมิเนียมฝาไม่แกะ', category: 'อลูมิเนียม', reason: 'Rule 2: separate from อลูมิเนียมฝา' },
    { name: 'แหนบ', category: 'เหล็ก', reason: 'missing product' },
    { name: 'เหล็กคัดขาย', category: 'เหล็ก', reason: 'missing product' },
    { name: 'อลูมิเนียมล้อแม็ค', category: 'อลูมิเนียม', reason: 'missing product' },
    { name: 'ขี้กลึงอลูมิเนียม', category: 'อลูมิเนียม', reason: 'missing product' },
    { name: 'ฟรอยไม่ติดพลาสติก', category: 'อลูมิเนียม', reason: 'missing product' },
    { name: 'ฝาเนียมเผา', category: 'อลูมิเนียม', reason: 'missing product' },
    { name: 'สายไฟทองแดง', category: 'อื่นๆ', reason: 'missing product' },
    { name: 'เบิกใช้งานภายในบริษัท', category: 'อื่นๆ', reason: 'missing product' },
  ]

  // Find max sortOrder per category for proper ordering
  const maxSortByCat = new Map()
  for (const c of ['เหล็ก', 'อลูมิเนียม', 'อื่นๆ']) {
    const catId = catByName.get(c)
    const agg = await db.product.aggregate({ where: { categoryId: catId }, _max: { sortOrder: true } })
    maxSortByCat.set(c, (agg._max.sortOrder ?? 0))
  }

  for (const c of toCreate) {
    try {
      // Check if already exists (safety)
      const existing = await db.product.findFirst({ where: { name: c.name } })
      if (existing) { results.errors.push({ op: 'create', name: c.name, error: 'already exists', skipped: true }); console.log(`  ⏭️  "${c.name}" already exists — skipping`); continue }
      const catId = catByName.get(c.category)
      if (!catId) { results.errors.push({ op: 'create', name: c.name, error: `category "${c.category}" not found` }); console.log(`  ❌ "${c.name}" category not found`); continue }
      const nextSort = maxSortByCat.get(c.category) + 1
      maxSortByCat.set(c.category, nextSort)
      const created = await db.product.create({ data: { name: c.name, categoryId: catId, defaultBuyPrice: 0, sortOrder: nextSort } })
      results.creates.push({ id: created.id, name: created.name, category: c.category, initialStock: 0, reason: c.reason })
      console.log(`  ✅ ${created.id} | "${created.name}" (${c.category}, sortOrder=${nextSort}) — ${c.reason}`)
    } catch (e) { results.errors.push({ op: 'create', name: c.name, error: e.message }); console.log(`  ❌ "${c.name}" create failed: ${e.message}`) }
  }

  // ========== SUMMARY ==========
  console.log('\n=== EXECUTION SUMMARY ===')
  console.log(`  Renames applied:      ${results.renames.length}`)
  console.log(`  Creates applied:      ${results.creates.length}`)
  console.log(`  Category changes:     ${results.categoryChanges.length}`)
  console.log(`  Deletes applied:      ${results.deletes.filter(d => d.status === 'deleted').length}`)
  console.log(`  Errors/skips:         ${results.errors.length}`)
  if (results.errors.length > 0) {
    console.log('\nErrors/skips:')
    for (const e of results.errors) console.log(`  - ${e.op}: ${e.name || e.id} → ${e.error}`)
  }

  const finalCount = await db.product.count()
  console.log(`\nFinal product count: ${finalCount} (was 114, expected 114 + 10 creates - 1 delete = 123)`)

  const fs = await import('fs')
  fs.writeFileSync('/home/z/my-project/reconciliation/apply-task41-results.json', JSON.stringify(results, null, 2))
  console.log('\nResults saved to apply-task41-results.json')
} catch (e) {
  console.error('❌ FATAL:', e.message)
  process.exit(1)
} finally {
  await db.$disconnect()
}
