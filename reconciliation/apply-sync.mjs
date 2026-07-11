/**
 * APPLY Product Master Sync — Final Owner Decisions (Task 41)
 *
 * Owner-approved operations:
 * - 10 renames (preserve productId)
 * - 2 category changes
 * - 10 new product creates (initial stock 0, no StockLots)
 * - 1 nickel variant deletion (นิกเกิล(สแตนเลส) — 0 stock, 0 movement)
 * - 13 archive deletions (0 stock, 0 movement, 0 references)
 *
 * Safety:
 * - NO stock quantities changed
 * - NO bill records modified
 * - NO StockLots created or deleted
 * - Products with stock/movement are NEVER deleted
 */
import { PrismaClient, Prisma } from '@prisma/client'
import fs from 'fs'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const results = {
  renames: [],
  creates: [],
  categoryChanges: [],
  deletes: [],
  skipped: [],
  errors: [],
}

try {
  // ========== PHASE 0: RECORD PRE-APPLY COUNTS ==========
  console.log('=== PHASE 0: RECORD PRE-APPLY COUNTS ===\n')
  const preCounts = {
    product: await db.product.count(),
    stockLot: await db.stockLot.count(),
    buyBill: await db.buyBill.count(),
    sellBill: await db.sellBill.count(),
    sortingBill: await db.sortingBill.count(),
    stockTransfer: await db.stockTransfer.count(),
  }
  const preStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  preCounts.totalStockWeight = preStockAgg._sum.remainingWeight ?? 0
  console.log('Pre-apply counts:', JSON.stringify(preCounts, null, 2))

  // ========== PHASE 1: APPLY RENAMES (10 products) ==========
  console.log('\n=== PHASE 1: APPLY 10 APPROVED RENAMES ===\n')
  const renames = [
    { id: 'cmr09vcvf0008l105vtay0h8k', oldName: 'เหล็กเส้น 6 หุน (1.8m ขึ้นไป)', newName: 'เหล็กเส้น 6 หุน' },
    { id: 'cmr09vcvf000al105rdq4ae4s', oldName: 'เหล็กเส้น 1 นิ้ว (1mขึ้นไป)', newName: 'เหล็กเส้น 1 นิ้ว' },
    { id: 'cmr09vcvg000ml105kzmhv6c6', oldName: 'เหล็กเส้น3-4หุน', newName: 'เหล็กเส้น 3-4 หุน' },
    { id: 'prod_mqgp9do7ui6p53xv2tbjq7tb', oldName: 'อลูมิเนียมแข็ง', newName: 'อลูมิเนียมแข็ง (หล่อ/หนา)' },
    { id: 'prod_mqgp9e6yxtg3mo8mf998qnf6', oldName: 'อลูมิเนียมกระทะ', newName: 'อลูมิเนียมกะทะ' },
    { id: 'prod_mqgp9dbqtfx0j3mnsbl9mwix', oldName: 'อลูมิเนียมอัลลอย', newName: 'อลูมิเนียมอัลลอยด์' },
    { id: 'prod_mqgp9gn9lfu942el9hx2undl', oldName: 'อลูมิเนียมปั้มกระป๋อง', newName: 'ปั้มกระป๋อง' },
    { id: 'prod_mqgp9ew9ar8ckyjn69mr8aq2', oldName: 'อลูมิเนียมตูดหม้อหุงข้าว', newName: 'ตูดหม้อหุงข้าว' },
    { id: 'prod_new_1782125294097_e0b882e0b8b5e0b989e0b881', oldName: 'ขี้กลึงทองเหลือง (เนื้อแดง)', newName: 'ขี้กลึงทองเหลืองเนื้อแดง' },
    { id: 'prod_mqgp9cgafv9ts0i3ze22h1vb', oldName: 'แสตนเลส 304 (ยาว)', newName: 'แสตนเลส 304 ยาว' },
  ]

  // NOT renamed (per owner rules):
  // - อลูมิเนียมฝา → อลูมิเนียมฝาไม่แกะ  (Rule 2: separate products, create new instead)
  // - อลูมิเนียมแข็ง → อลูมิเนียมแข็งก้ามเบรค  (Rule 4: typo, use existing ก้านเบรค)

  for (const r of renames) {
    try {
      // Verify product exists and has expected name
      const existing = await db.product.findUnique({ where: { id: r.id }, select: { name: true } })
      if (!existing) {
        results.errors.push({ op: 'rename', id: r.id, error: 'product not found' })
        console.log(`  ❌ ${r.id} not found`)
        continue
      }
      // Check for collision (another product already has the new name)
      const collision = await db.product.findFirst({ where: { name: r.newName, id: { not: r.id } } })
      if (collision) {
        results.errors.push({ op: 'rename', id: r.id, error: `name "${r.newName}" already exists as ${collision.id}` })
        console.log(`  ❌ COLLISION: "${r.newName}" already exists as ${collision.id}`)
        continue
      }
      await db.product.update({ where: { id: r.id }, data: { name: r.newName } })
      results.renames.push({ id: r.id, oldName: r.oldName, newName: r.newName })
      console.log(`  ✅ ${r.id} | "${r.oldName}" → "${r.newName}"`)
    } catch (e) {
      results.errors.push({ op: 'rename', id: r.id, error: e.message })
      console.log(`  ❌ ${r.id} rename failed: ${e.message}`)
    }
  }
  console.log(`\nRenamed: ${results.renames.length} / ${renames.length}`)

  // ========== PHASE 2: APPLY CATEGORY CHANGES (2 products) ==========
  console.log('\n=== PHASE 2: APPLY 2 CATEGORY CHANGES ===\n')
  const electronicsCat = await db.productCategory.findFirst({ where: { name: 'อิเล็กทรอนิกส์' } })
  const stainlessCat = await db.productCategory.findFirst({ where: { name: 'แสตนเลส' } })
  console.log(`  อิเล็กทรอนิกส์ category: ${electronicsCat.id}`)
  console.log(`  แสตนเลส category: ${stainlessCat.id}`)

  const catChanges = [
    { id: 'cmr09vcvk002il1059frrfzsp', name: 'แผงวงจรเขียว', fromCat: 'อื่นๆ', toCatId: electronicsCat.id, toCatName: 'อิเล็กทรอนิกส์' },
    { id: 'cmr09vcvk002gl105fbuztaig', name: 'นิกเกิล', fromCat: 'อื่นๆ', toCatId: stainlessCat.id, toCatName: 'แสตนเลส' },
  ]

  for (const c of catChanges) {
    try {
      const existing = await db.product.findUnique({ where: { id: c.id }, include: { category: true } })
      if (!existing) {
        results.errors.push({ op: 'categoryChange', id: c.id, error: 'product not found' })
        console.log(`  ❌ ${c.id} not found`)
        continue
      }
      await db.product.update({ where: { id: c.id }, data: { categoryId: c.toCatId } })
      results.categoryChanges.push({ id: c.id, name: c.name, fromCategory: c.fromCat, toCategory: c.toCatName })
      console.log(`  ✅ ${c.id} | "${c.name}" category: ${c.fromCat} → ${c.toCatName}`)
    } catch (e) {
      results.errors.push({ op: 'categoryChange', id: c.id, error: e.message })
      console.log(`  ❌ ${c.id} category change failed: ${e.message}`)
    }
  }
  console.log(`\nCategory changes: ${results.categoryChanges.length} / ${catChanges.length}`)

  // ========== PHASE 3: CREATE NEW PRODUCTS (10 products) ==========
  console.log('\n=== PHASE 3: CREATE 10 NEW PRODUCTS (initial stock 0) ===\n')
  const steelCat = await db.productCategory.findFirst({ where: { name: 'เหล็ก' } })
  const aluminumCat = await db.productCategory.findFirst({ where: { name: 'อลูมิเนียม' } })
  const otherCat = await db.productCategory.findFirst({ where: { name: 'อื่นๆ' } })

  const newProducts = [
    { name: 'แหนบ', categoryId: steelCat.id, categoryName: 'เหล็ก' },
    { name: 'เหล็กคัดขาย', categoryId: steelCat.id, categoryName: 'เหล็ก' },
    { name: 'อลูมิเนียมล้อแม็ค', categoryId: aluminumCat.id, categoryName: 'อลูมิเนียม' },
    { name: 'สายไฟอลูมิเนียม', categoryId: aluminumCat.id, categoryName: 'อลูมิเนียม' },  // Rule 1: insulated cable (separate from อลูมิเนียมสายไฟ)
    { name: 'ขี้กลึงอลูมิเนียม', categoryId: aluminumCat.id, categoryName: 'อลูมิเนียม' },
    { name: 'ฟรอยไม่ติดพลาสติก', categoryId: aluminumCat.id, categoryName: 'อลูมิเนียม' },
    { name: 'ฝาเนียมเผา', categoryId: aluminumCat.id, categoryName: 'อลูมิเนียม' },
    { name: 'สายไฟทองแดง', categoryId: otherCat.id, categoryName: 'อื่นๆ' },
    { name: 'เบิกใช้งานภายในบริษัท', categoryId: otherCat.id, categoryName: 'อื่นๆ' },
    { name: 'อลูมิเนียมฝาไม่แกะ', categoryId: aluminumCat.id, categoryName: 'อลูมิเนียม' },  // Rule 2: separate from อลูมิเนียมฝา
  ]

  // Find max sortOrder in each category
  const maxSortSteel = await db.product.aggregate({ where: { categoryId: steelCat.id }, _max: { sortOrder: true } })
  const maxSortAl = await db.product.aggregate({ where: { categoryId: aluminumCat.id }, _max: { sortOrder: true } })
  const maxSortOther = await db.product.aggregate({ where: { categoryId: otherCat.id }, _max: { sortOrder: true } })
  let nextSortSteel = (maxSortSteel._max.sortOrder ?? 0) + 1
  let nextSortAl = (maxSortAl._max.sortOrder ?? 0) + 1
  let nextSortOther = (maxSortOther._max.sortOrder ?? 0) + 1

  for (const p of newProducts) {
    try {
      // Check if product already exists with this exact name
      const existing = await db.product.findFirst({ where: { name: p.name } })
      if (existing) {
        results.skipped.push({ op: 'create', name: p.name, reason: `already exists as ${existing.id}` })
        console.log(`  ⏭️  "${p.name}" already exists as ${existing.id} — skipping`)
        continue
      }
      let sortOrder = 99
      if (p.categoryName === 'เหล็ก') sortOrder = nextSortSteel++
      else if (p.categoryName === 'อลูมิเนียม') sortOrder = nextSortAl++
      else sortOrder = nextSortOther++
      
      const created = await db.product.create({
        data: { name: p.name, categoryId: p.categoryId, defaultBuyPrice: 0, sortOrder },
      })
      results.creates.push({ id: created.id, name: created.name, category: p.categoryName, initialStock: 0 })
      console.log(`  ✅ ${created.id} | "${created.name}" (${p.categoryName}, sortOrder ${sortOrder})`)
    } catch (e) {
      results.errors.push({ op: 'create', name: p.name, error: e.message })
      console.log(`  ❌ "${p.name}" create failed: ${e.message}`)
    }
  }
  console.log(`\nCreated: ${results.creates.length} / ${newProducts.length}`)

  // ========== PHASE 4: DELETE นิกเกิล(สแตนเลส) (Rule 3) ==========
  console.log('\n=== PHASE 4: DELETE นิกเกิล(สแตนเลส) (Rule 3) ===\n')
  const nickelVariant = await db.product.findFirst({
    where: { name: 'นิกเกิล(สแตนเลส)' },
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
  if (nickelVariant) {
    const totalRefs = nickelVariant.stockLots.length + nickelVariant.buyItems.length + nickelVariant.sellItems.length + nickelVariant.sortingSource.length + nickelVariant.sortingItems.length + nickelVariant.transferSource.length + nickelVariant.transferItems.length
    if (totalRefs === 0) {
      await db.product.delete({ where: { id: nickelVariant.id } })
      results.deletes.push({ id: nickelVariant.id, name: nickelVariant.name, reason: 'Rule 3: nickel variant with 0 stock + 0 movement — safe to delete' })
      console.log(`  ✅ Deleted "${nickelVariant.name}" (${nickelVariant.id}) — 0 references`)
    } else {
      results.skipped.push({ op: 'delete', id: nickelVariant.id, name: nickelVariant.name, reason: `has ${totalRefs} references — NOT deleted` })
      console.log(`  ❌ SKIPPED "${nickelVariant.name}" — has ${totalRefs} references`)
    }
  } else {
    console.log(`  ⏭️  นิกเกิล(สแตนเลส) not found — already deleted or never existed`)
  }

  // ========== PHASE 5: DELETE 13 ARCHIVE CANDIDATES ==========
  console.log('\n=== PHASE 5: DELETE 13 ARCHIVE CANDIDATES (0 stock, 0 movement) ===\n')
  // These are MT products not in adjusted file, with 0 stock and 0 movement
  // EXCLUDING: นิกเกิล(สแตนเลส) [already handled in Phase 4] and อลูมิเนียมแข็งก้านเบรค [KEEP per Rule 4]
  
  const archiveCandidateNames = [
    'ทองแดงท่อใหม่ Candy',
    'ทองแดงขาดจาก ST',
    'ขยะ',
    'สูญเสีย',
    'กระสอบขาด',
    'น้ำม้นเก่า',
    'ฝาอลูมิเนียมเผา',   // was renamed in Task 35
    'อลูมิเนียมตูดกะทะไฟฟ้าล้วน',
    'อลูมิเนียมป๋องสเปรย์',
    'อลูมิเนียมฟรอย',
    'อลูมิเนียมซีรี 5,000',
    'ฝาอลูมิเนียมติดพลาสติก',
    'พลาสติกรวม',
  ]
  // KEEP: อลูมิเนียมแข็งก้านเบรค (Rule 4 — use existing, do NOT delete)

  for (const name of archiveCandidateNames) {
    try {
      const p = await db.product.findFirst({
        where: { name },
        include: {
          stockLots: { select: { id: true } },
          buyItems: { select: { id: true } },
          sellItems: { select: { id: true } },
          sortingSource: { select: { id: true } },
          sortingItems: { select: { id: true } },
          transferSource: { select: { id: true } },
          transferItems: { select: { id: true } },
        },
      })
      if (!p) {
        results.skipped.push({ op: 'archive', name, reason: 'not found in DB' })
        console.log(`  ⏭️  "${name}" not found in DB — skipping`)
        continue
      }
      const totalRefs = p.stockLots.length + p.buyItems.length + p.sellItems.length + p.sortingSource.length + p.sortingItems.length + p.transferSource.length + p.transferItems.length
      if (totalRefs === 0) {
        await db.product.delete({ where: { id: p.id } })
        results.deletes.push({ id: p.id, name: p.name, reason: 'Archive: 0 stock + 0 movement + 0 references — safe to delete' })
        console.log(`  ✅ Deleted "${p.name}" (${p.id})`)
      } else {
        results.skipped.push({ op: 'archive', id: p.id, name: p.name, reason: `has ${totalRefs} references — NOT deleted` })
        console.log(`  ❌ SKIPPED "${p.name}" — has ${totalRefs} references`)
      }
    } catch (e) {
      results.errors.push({ op: 'archive', name, error: e.message })
      console.log(`  ❌ "${name}" archive failed: ${e.message}`)
    }
  }

  // ========== PHASE 6: RECORD POST-APPLY COUNTS ==========
  console.log('\n=== PHASE 6: RECORD POST-APPLY COUNTS ===\n')
  const postCounts = {
    product: await db.product.count(),
    stockLot: await db.stockLot.count(),
    buyBill: await db.buyBill.count(),
    sellBill: await db.sellBill.count(),
    sortingBill: await db.sortingBill.count(),
    stockTransfer: await db.stockTransfer.count(),
  }
  const postStockAgg = await db.stockLot.aggregate({ _sum: { remainingWeight: true } })
  postCounts.totalStockWeight = postStockAgg._sum.remainingWeight ?? 0
  console.log('Post-apply counts:', JSON.stringify(postCounts, null, 2))

  // ========== VERIFY: No stock/bill data changed ==========
  console.log('\n=== SAFETY VERIFICATION ===\n')
  const safetyChecks = {
    stockLot: { before: preCounts.stockLot, after: postCounts.stockLot, changed: preCounts.stockLot !== postCounts.stockLot },
    buyBill: { before: preCounts.buyBill, after: postCounts.buyBill, changed: preCounts.buyBill !== postCounts.buyBill },
    sellBill: { before: preCounts.sellBill, after: postCounts.sellBill, changed: preCounts.sellBill !== postCounts.sellBill },
    sortingBill: { before: preCounts.sortingBill, after: postCounts.sortingBill, changed: preCounts.sortingBill !== postCounts.sortingBill },
    stockTransfer: { before: preCounts.stockTransfer, after: postCounts.stockTransfer, changed: preCounts.stockTransfer !== postCounts.stockTransfer },
    totalStockWeight: { before: preCounts.totalStockWeight, after: postCounts.totalStockWeight, changed: preCounts.totalStockWeight !== postCounts.totalStockWeight },
  }
  let allSafe = true
  for (const [k, v] of Object.entries(safetyChecks)) {
    const status = v.changed ? '❌ CHANGED' : '✅ UNCHANGED'
    console.log(`  ${k}: ${v.before} → ${v.after} ${status}`)
    if (v.changed) allSafe = false
  }
  console.log(`\nProduct count: ${preCounts.product} → ${postCounts.product} (expected: ${preCounts.product + results.creates.length - results.deletes.length})`)
  console.log(`All stock/bill data safe: ${allSafe ? '✅ YES' : '❌ NO'}`)

  // ========== SAVE RESULTS ==========
  fs.writeFileSync('/home/z/my-project/reconciliation/apply-results.json', JSON.stringify({
    preCounts, postCounts, safetyChecks,
    summary: {
      renames: results.renames.length,
      creates: results.creates.length,
      categoryChanges: results.categoryChanges.length,
      deletes: results.deletes.length,
      skipped: results.skipped.length,
      errors: results.errors.length,
      allSafe,
    },
    ...results,
  }, null, 2))
  console.log('\nResults saved to apply-results.json')

} catch (e) {
  console.error('❌ FATAL:', e.message)
  process.exit(1)
} finally {
  await db.$disconnect()
}
