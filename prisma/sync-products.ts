/**
 * Production-safe product sync script with rename-by-id support.
 *
 * Run:
 *   DRY_RUN=true  bun run prisma/sync-products.ts   (dry-run, no changes)
 *   DRY_RUN=false bun run prisma/sync-products.ts   (production sync)
 *
 * Phases:
 *   1. Create missing categories (อิเล็กทรอนิกส์, พลาสติก)
 *   2. Rename existing products by productId (preserve stock + bill history)
 *   3. Create genuinely missing products (57 new products)
 *   4. Report not-kept products (ทองแดงพิเศษ, มุ้งลวด standalone) — NO delete
 *
 * Owner decisions:
 *   - ทองแดงพิเศษ = do not keep (but no isActive field → cannot deactivate → report only)
 *   - ทองแดงท่อใหม่ = keep
 *   - มุ้งลวด standalone = do not keep (use อลูมิเนียมมุ้งลวด instead)
 *   - All other rename/create items approved
 *
 * Safety:
 *   - Idempotent (safe to run multiple times)
 *   - No delete operations
 *   - No stock/StockLot modifications
 *   - Preserves productId for renamed products
 *   - Dry-run mode by default
 */
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()
const DRY_RUN = process.env.DRY_RUN !== 'false'

// ============================================================================
// CATEGORIES (9 total — 7 existing + 2 new)
// ============================================================================
const CATEGORIES = [
  { name: 'เหล็ก', type: 'STEEL', sortOrder: 1 },
  { name: 'ทองแดง', type: 'METAL', sortOrder: 2 },
  { name: 'ทองเหลือง', type: 'METAL', sortOrder: 3 },
  { name: 'แสตนเลส', type: 'METAL', sortOrder: 4 },
  { name: 'อลูมิเนียม', type: 'METAL', sortOrder: 5 },
  { name: 'ตะกั่ว', type: 'METAL', sortOrder: 6 },
  { name: 'อิเล็กทรอนิกส์', type: 'METAL', sortOrder: 7 },
  { name: 'อื่นๆ', type: 'METAL', sortOrder: 8 },
  { name: 'พลาสติก', type: 'METAL', sortOrder: 9 },
] as const

// ============================================================================
// RENAME MAP: productId → newName (Phase 1)
// 40 products — rename by productId to preserve stock + bill history
// ============================================================================
const RENAME_MAP: Array<{ productId: string; newName: string; category: string }> = [
  // เหล็ก (6)
  { productId: 'prod_mqgp995qaqfnykbbo5ziwi1t', newName: 'เหล็กหล่อชิ้นเล็ก', category: 'เหล็ก' },
  { productId: 'prod_mqgp99bt7vaj0jz2u837j3lm', newName: 'เหล็กหล่อ (ชิ้นใหญ่)', category: 'เหล็ก' },
  { productId: 'prod_mqgp99ij5mr6pceki4s9072l', newName: 'กระป๋อง,ปี๊บ', category: 'เหล็ก' },
  { productId: 'prod_mqgp99vijqwa10dzb68wohxt', newName: 'ถัง 15ถึง200 ลิตร', category: 'เหล็ก' },
  { productId: 'prod_mqgp9a1i7bviukked5gxa43v', newName: 'แม่พิมพ์', category: 'เหล็ก' },
  { productId: 'prod_mqgp9a880imxsartf4d8c14k', newName: 'เหล็กสลิง,สแตน', category: 'เหล็ก' },
  // ทองแดง (5)
  { productId: 'prod_mqgp9aevp2yb18adpkyr3qtr', newName: 'ทองแดงปอกเงา', category: 'ทองแดง' },
  { productId: 'prod_mqgp9alick357v31bqqrlv43', newName: 'ทองแดงปอกช็อต', category: 'ทองแดง' },
  { productId: 'prod_mqgp9axign3hnk45ex03l4aw', newName: 'ทองแดงเส้นเล็ก', category: 'ทองแดง' },
  { productId: 'prod_mqgp9b9ouoxmoeq34ccaydfj', newName: 'หม้อน้ำไส้ทองแดง', category: 'ทองแดง' },
  { productId: 'prod_mqgp9bgavns7vxc8rzrlsn65', newName: 'แดงชุบ', category: 'ทองแดง' },
  // ทองเหลือง (3)
  { productId: 'prod_mqgp9bspglewfbgukggj7wdy', newName: 'ทองเหลืองหนา', category: 'ทองเหลือง' },
  { productId: 'prod_mqgp9bylqjal88hmac4ykwo0', newName: 'ขี้กลึงทองเหลือง (เนื้อเขียว)', category: 'ทองเหลือง' },
  { productId: 'prod_new_1782125294097_e0b882e0b8b5e0b989e0b881', newName: 'ขี้กลึงทองเหลือง (เนื้อแดง)', category: 'ทองเหลือง' },
  // แสตนเลส (1)
  { productId: 'prod_mqgp9cgafv9ts0i3ze22h1vb', newName: 'แสตนเลส 304 (ยาว)', category: 'แสตนเลส' },
  // อลูมิเนียม (23 — romanization: อลูมี→อลูมิ)
  { productId: 'prod_mqgp9csvq0takfp04k5d2dv6', newName: 'อลูมิเนียมสายไฟ', category: 'อลูมิเนียม' },
  { productId: 'prod_mqgp9cyrr65cu9xaams1daoh', newName: 'อลูมิเนียมฉาก', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9d5g7uiu7tttxza864tp', newName: 'อลูมิเneียมบาง', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9dbqtfx0j3mnsbl9mwix', newName: 'อลูมิเneียมอัลลอยด์', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9dhn9ryniksnud8q714g', newName: 'อลูมิเneียมล้อแม็ค', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9do7ui6p53xv2tbjq7tb', newName: 'อลูมิเneียมหล่อ', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9duo294uh2l320pbg1ru', newName: 'อลูมิเneียมกระป๋อง', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9e0y2ehae94h2mw403ns', newName: 'อลูมิเneียมฝาแกะ', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9e6yxtg3mo8mf998qnf6', newName: 'อลูมิเneียมกะทะ', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9edcxnxkocxfu0odbayj', newName: 'อลูมิเneียมตูดกะทะ', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9ejcaz0g567zocy5ub8j', newName: 'หม้อน้ำอลูมีเneียม', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9epjox7up6c2k8jrf289', newName: 'ฝาเนียมเผา', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9ew9ar8ckyjn69mr8aq2', newName: 'ตูดหม้อหุงข้าว', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9f3wvar7pgyoek1zen5k', newName: 'ตูดกะทะไฟฟ้าล้วน', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9fa7fylab8ztuya98a9p', newName: 'อลูมิเneียมฉากสี', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9fgoheos0xee1ntl0r27', newName: 'อลูมีเneียมเครื่อง', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9fmounwsgwm9xyso0phf', newName: 'อลูมีเneียมครีบหม้อน้ำ', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9fsl7s0haidcn5c9t4ee', newName: 'อลูมิเneียมมุ้งลวด', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9fz6pqfgrkxoh5nbgchi', newName: 'อลูมิเneียมมู่ลี่', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9g5d78sw9tuoeuem3i1b', newName: 'อลูมิเneียมเพลท', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9gh81ao3300v6dhcei3x', newName: 'กระป๋องสเปรย์', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9gn9lfu942el9hx2undl', newName: 'ปั้มกระป๋อง', category: 'อลูมิเneียม' },
  { productId: 'prod_mqgp9gt8ki5lcwu67ps55equ', newName: 'ฟรอยไม่ติดพลาสติก', category: 'อลูมิเneียม' },
  // อื่นๆ (2)
  { productId: 'prod_mqgp9hpqehz5267b46pxo5ic', newName: 'มอเตอร์', category: 'อื่นๆ' },
  { productId: 'prod_mqgp9hwdo411xly6wmmeyg86', newName: 'คอมดำ', category: 'อื่นๆ' },
]

// ============================================================================
// CREATE LIST: genuinely new products (Phase 2)
// 57 products — create with old-system names
// ============================================================================
type NewProduct = { name: string; category: string; defaultBuyPrice: number }
const NEW_PRODUCTS: NewProduct[] = [
  // เหล็ก (18 new)
  { name: 'เหล็กหนาพิเศษยาว', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กเส้น 5 หุน', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กเส้น 6 หุน (1.8m ขึ้นไป)', category: 'เหล็ก', defaultBuyPrice: 14.8 },
  { name: 'เหล็กเส้น 1 นิ้ว (1mขึ้นไป)', category: 'เหล็ก', defaultBuyPrice: 15 },
  { name: 'ขี้กลึงเหล็ก', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'โช๊ค', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'ปั๊มสังกะสี', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'ปั๊มบาง', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'ปั๊มหนา', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กเส้น3-4หุน', category: 'เหล็ก', defaultBuyPrice: 11 },
  { name: 'อะไหล่', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'แหนบ', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กบางยาว', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กลวดรถ', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กคัดขาย', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เบิกใช้งานต่างๆในบริษัท', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เมทัลชีส(มือสอง)', category: 'เหล็ก', defaultBuyPrice: 0 },
  { name: 'เหล็กคัดใช้งาน', category: 'เหล็ก', defaultBuyPrice: 0 },
  // อลูมิเneียม (11 new)
  { name: 'อลูมิเneียมผ้าเบรค', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'อลูมิเneียมกะทะไฟฟ้า', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'กระทะดำ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'อลูมิเneียมฝาไม่แกะ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'อลูมิเneียมแผ่นเพจ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'อลูมิเneียมติดเหล็ก', category: 'อลูมิเneียม', defaultBuyPrice: 19 },
  { name: 'สายไฟอลูมีเneียม(ไม่ปอก)', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'ขี้กลึงอลูมิเneียม', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'หนาติดสี', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'หนาลูกสูบ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  { name: 'หนาก้ามเบรค', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
  // ทองแดง (5 new)
  { name: 'ทองแดงติดเหล็ก', category: 'ทองแดง', defaultBuyPrice: 0 },
  { name: 'ทองแดงเกินจาก ST', category: 'ทองแดง', defaultBuyPrice: 0 },
  { name: 'ทองแดงขาดจาก ST', category: 'ทองแดง', defaultBuyPrice: 0 },
  { name: 'ทองแดงเส้นเล็ก(ไม่ชุบ)', category: 'ทองแดง', defaultBuyPrice: 0 },
  { name: 'ทองแดงท่อCandy', category: 'ทองแดง', defaultBuyPrice: 0 },
  // ทองเหลือง (4 new)
  { name: 'ทองเหลืองติดเหล็ก', category: 'ทองเหลือง', defaultBuyPrice: 0 },
  { name: 'ทองเหลืองเนื้อแดงติดเหล็ก', category: 'ทองเหลือง', defaultBuyPrice: 0 },
  { name: 'ทองเหลืองเกินจาก ST', category: 'ทองเหลือง', defaultBuyPrice: 0 },
  { name: 'ทองเหลืองขาดจาก ST', category: 'ทองเหลือง', defaultBuyPrice: 0 },
  // แสตนเลส (3 new)
  { name: 'แสตนเลสติดเหล็ก', category: 'แสตนเลส', defaultBuyPrice: 0 },
  { name: 'นิกเกิล(สแตนเลส)', category: 'แสตนเลส', defaultBuyPrice: 0 },
  { name: 'ขี้กลึงสแตนเลส304', category: 'แสตนเลส', defaultBuyPrice: 0 },
  // อิเล็กทรอนิกส์ (6 new — new category)
  { name: 'แบตเตอรี่ขาว', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
  { name: 'แบตเตอรี่ดำ', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
  { name: 'แบตเตอรี่เล็ก', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
  { name: 'แบตเตอรี่มอไซต์', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
  { name: 'แท็บเล็ต', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
  { name: 'พวงแผงวงจรติดสายไฟ', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
  // อื่นๆ (9 new)
  { name: 'สายไฟไม่ปอก', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'เปลือกสายไฟ', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'ขยะ', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'สูญเสีย', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'กระสอบขาด', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'น้ำม้นเก่า', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'นิกเกิล', category: 'อื่นๆ', defaultBuyPrice: 550 },
  { name: 'แผงวงจรเขียว', category: 'อื่นๆ', defaultBuyPrice: 0 },
  { name: 'ของแกะราคาสูง', category: 'อื่นๆ', defaultBuyPrice: 0 },
  // พลาสติก (1 new — new category)
  { name: 'พลาสติกรวม', category: 'พลาสติก', defaultBuyPrice: 0 },
]

// ============================================================================
// NOT-KEPT products (owner decision — Phase 3)
// Product model has NO isActive field → cannot soft-delete → report only
// ============================================================================
const NOT_KEPT_PRODUCTS = [
  { productId: 'prod_mqgp9b3h7g448yu1xgzuu4pr', name: 'ทองแดงพิเศษ', reason: 'Owner: do not keep — no equivalent in old system' },
  { productId: 'prod_mqgp9gbfgywdc71yyps4y1ke', name: 'มุ้งลวด', reason: 'Owner: use อลูมิเneียมมุ้งลวด instead — duplicate' },
]

// ============================================================================
// KEPT products (owner decision — confirm these remain active)
// ============================================================================
const KEPT_UNIQUE_PRODUCTS = [
  { productId: 'prod_new_1782125293615_e0b897e0b8ade0b887e0b981', name: 'ทองแดงท่อใหม่', reason: 'Owner: keep — unique to new system' },
  { productId: 'prod_mqgp9h048rj5720d2yk78tpk', name: 'อลูมีเneียมซีรี 5,000', reason: 'Owner: keep — unique to new system' },
]

async function main() {
  console.log(`🔄 Product Sync Script (${DRY_RUN ? 'DRY RUN' : 'PRODUCTION'})`)
  console.log('=' .repeat(60))
  console.log('')

  // === PRE-SYNC COUNTS ===
  const beforeCounts = {
    products: await db.product.count(),
    categories: await db.productCategory.count(),
    stockLots: await db.stockLot.count(),
    buyItems: await db.buyBillItem.count(),
    sellItems: await db.sellBillItem.count(),
    sortItems: await db.sortingBillItem.count(),
  }
  console.log('=== BEFORE SYNC COUNTS ===')
  console.log(JSON.stringify(beforeCounts, null, 2))
  console.log('')

  let categoriesCreated = 0
  let categoriesExisted = 0
  let productsRenamed = 0
  let productsRenameSkipped = 0
  let productsCreated = 0
  let productsCreateSkipped = 0
  const notKeptReport: Array<{ name: string; hasStock: boolean; hasHistory: boolean; action: string }> = []

  // === PHASE 1: Create missing categories ===
  console.log('--- Phase 1: Categories ---')
  const categoryMap: Record<string, string> = {}
  for (const cat of CATEGORIES) {
    const existing = await db.productCategory.findUnique({ where: { name: cat.name } })
    if (existing) {
      categoryMap[cat.name] = existing.id
      categoriesExisted++
    } else {
      console.log(`  + CREATE category: ${cat.name}`)
      if (!DRY_RUN) {
        const created = await db.productCategory.create({ data: { ...cat } })
        categoryMap[cat.name] = created.id
      }
      categoriesCreated++
    }
  }
  console.log(`Categories: ${categoriesCreated} to create, ${categoriesExisted} existed`)
  console.log('')

  // === PHASE 2: Rename existing products by productId ===
  console.log('--- Phase 2: Rename existing products ---')
  for (const r of RENAME_MAP) {
    const product = await db.product.findUnique({ where: { id: r.productId } })
    if (!product) {
      console.log(`  ⚠️ SKIP (not found): ${r.productId} → ${r.newName}`)
      productsRenameSkipped++
      continue
    }
    if (product.name === r.newName) {
      console.log(`  ✓ ALREADY RENAMED: ${r.newName}`)
      productsRenameSkipped++
      continue
    }
    // Check for name conflict
    const conflict = await db.product.findUnique({ where: { name: r.newName } })
    if (conflict && conflict.id !== r.productId) {
      console.log(`  ⚠️ CONFLICT: "${r.newName}" already exists (id=${conflict.id}) — SKIP rename of ${r.productId}`)
      productsRenameSkipped++
      continue
    }
    const categoryId = categoryMap[r.category]
    console.log(`  ~ RENAME: "${product.name}" → "${r.newName}" (id=${r.productId})`)
    if (!DRY_RUN) {
      await db.product.update({
        where: { id: r.productId },
        data: { name: r.newName, categoryId },
      })
    }
    productsRenamed++
  }
  console.log(`Renames: ${productsRenamed} done, ${productsRenameSkipped} skipped`)
  console.log('')

  // === PHASE 3: Create genuinely missing products ===
  console.log('--- Phase 3: Create new products ---')
  let sortOrder = (await db.product.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1
  sortOrder++
  for (const p of NEW_PRODUCTS) {
    const existing = await db.product.findUnique({ where: { name: p.name } })
    if (existing) {
      productsCreateSkipped++
      continue
    }
    const categoryId = categoryMap[p.category]
    if (!categoryId) {
      console.log(`  ⚠️ SKIP (no category): ${p.name}`)
      productsCreateSkipped++
      continue
    }
    console.log(`  + CREATE: ${p.name} (${p.category})`)
    if (!DRY_RUN) {
      await db.product.create({
        data: {
          name: p.name,
          defaultBuyPrice: p.defaultBuyPrice,
          categoryId,
          sortOrder: sortOrder++,
        },
      })
    }
    productsCreated++
  }
  console.log(`New products: ${productsCreated} created, ${productsCreateSkipped} already existed`)
  console.log('')

  // === PHASE 4: Not-kept products (report only — no delete) ===
  console.log('--- Phase 4: Not-kept products (report only) ---')
  console.log('⚠️ Product model has NO isActive field — cannot soft-delete')
  console.log('   Not-kept products are LEFT IN DB — owner must handle manually')
  console.log('')
  for (const nk of NOT_KEPT_PRODUCTS) {
    const product = await db.product.findUnique({ where: { id: nk.productId } })
    if (!product) {
      console.log(`  ⚠️ NOT FOUND: ${nk.name} (${nk.productId})`)
      continue
    }
    const stockLots = await db.stockLot.count({ where: { productId: nk.productId, remainingWeight: { gt: 0 } } })
    const buyItems = await db.buyBillItem.count({ where: { productId: nk.productId } })
    const sellItems = await db.sellBillItem.count({ where: { productId: nk.productId } })
    const sortItems = await db.sortingBillItem.count({ where: { productId: nk.productId } })
    const hasStock = stockLots > 0
    const hasHistory = buyItems + sellItems + sortItems > 0
    const action = hasStock || hasHistory ? 'CANNOT DELETE (has stock/history) — left in DB' : 'SAFE TO DELETE (no stock/history) — but no isActive field, left in DB'
    console.log(`  ⚠️ NOT-KEPT: "${product.name}" (id=${nk.productId})`)
    console.log(`     Reason: ${nk.reason}`)
    console.log(`     Stock lots: ${stockLots}, Buy items: ${buyItems}, Sell items: ${sellItems}, Sort items: ${sortItems}`)
    console.log(`     Action: ${action}`)
    notKeptReport.push({ name: product.name, hasStock, hasHistory, action })
  }
  console.log('')

  // === KEPT products confirmation ===
  console.log('--- Kept unique products (confirmed) ---')
  for (const k of KEPT_UNIQUE_PRODUCTS) {
    const product = await db.product.findUnique({ where: { id: k.productId } })
    if (product) {
      console.log(`  ✓ KEPT: "${product.name}" — ${k.reason}`)
    }
  }
  console.log('')

  // === POST-SYNC COUNTS ===
  const afterCounts = {
    products: await db.product.count(),
    categories: await db.productCategory.count(),
    stockLots: await db.stockLot.count(),
    buyItems: await db.buyBillItem.count(),
    sellItems: await db.sellBillItem.count(),
    sortItems: await db.sortingBillItem.count(),
  }
  console.log('=== AFTER SYNC COUNTS ===')
  console.log(JSON.stringify(afterCounts, null, 2))
  console.log('')

  // === VERIFICATION ===
  console.log('=== VERIFICATION ===')
  console.log(`Stock lots unchanged: ${beforeCounts.stockLots === afterCounts.stockLots ? '✅' : '❌'} (${beforeCounts.stockLots} → ${afterCounts.stockLots})`)
  console.log(`Buy items unchanged: ${beforeCounts.buyItems === afterCounts.buyItems ? '✅' : '❌'} (${beforeCounts.buyItems} → ${afterCounts.buyItems})`)
  console.log(`Sell items unchanged: ${beforeCounts.sellItems === afterCounts.sellItems ? '✅' : '❌'} (${beforeCounts.sellItems} → ${afterCounts.sellItems})`)
  console.log(`Sort items unchanged: ${beforeCounts.sortItems === afterCounts.sortItems ? '✅' : '❌'} (${beforeCounts.sortItems} → ${afterCounts.sortItems})`)
  console.log('')

  // === SUMMARY ===
  console.log('=== SYNC SUMMARY ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes made)' : 'PRODUCTION (changes applied)'}`)
  console.log(`Categories: ${categoriesCreated} created, ${categoriesExisted} existed`)
  console.log(`Products renamed: ${productsRenamed}`)
  console.log(`Products rename skipped: ${productsRenameSkipped}`)
  console.log(`Products created: ${productsCreated}`)
  console.log(`Products create skipped (already existed): ${productsCreateSkipped}`)
  console.log(`Not-kept products: ${notKeptReport.length} (left in DB — no isActive field)`)
  console.log(`Total products: ${beforeCounts.products} → ${afterCounts.products}`)
  console.log(`Total categories: ${beforeCounts.categories} → ${afterCounts.categories}`)
  console.log('')
  if (DRY_RUN) {
    console.log('⚠️ DRY RUN — no changes were made. Run with DRY_RUN=false to apply.')
  } else {
    console.log('✅ Sync complete — changes applied.')
  }
}

main()
  .catch((e) => {
    console.error('❌ Sync failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
