/**
 * Step 2: Check 11 owner-approved new products against existing MetalTrack products
 * (after planned renames). Report which need to be created vs already exist.
 */
import { PrismaClient } from '@prisma/client'
import fs from 'fs'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

try {
  const allProducts = await db.product.findMany({ include: { category: true }, orderBy: { sortOrder: 'asc' } })
  const renamePlan = JSON.parse(fs.readFileSync('/home/z/my-project/reconciliation/rename-plan.json', 'utf8'))

  // Build the "post-rename" product name set (apply planned renames)
  const postRenameProducts = allProducts.map(p => {
    const rename = renamePlan.toRename.find(r => r.id === p.id)
    return {
      id: p.id,
      name: rename ? rename.newName : p.name,
      categoryId: p.categoryId,
      categoryName: p.category.name,
    }
  })
  console.log(`Post-rename product count: ${postRenameProducts.length}`)

  // The 11 owner-approved new products
  const newProducts = [
    'อลูมิเนียมผ้าเบรค',
    'อลูมิเนียมตูดกะทะไฟฟ้า',
    'ฝาอลูมิเนียมติดพลาสติก',
    'ฝาอลูมิเนียมเผา',
    'สายไฟอลูมิเนียม',
    'อลูมิเนียมติดเหล็ก',
    'อลูมิเนียมแผ่นเพลท',
    'กระป๋องสเปรย์อลูมิเนียม',
    'อลูมิเนียมแข็งติดสี',
    'อลูมิเนียมแข็งลูกสูบ',
    'อลูมิเนียมแข็งก้านเบรค',
  ]

  // Get aluminum category
  const aluminumCategory = await db.productCategory.findFirst({ where: { name: 'อลูมิเนียม' } })
  console.log(`\nAluminum category: ${aluminumCategory.id} (${aluminumCategory.name})\n`)

  console.log(`=== CHECKING 11 NEW PRODUCTS (against post-rename MT) ===\n`)
  const toCreate = []
  const alreadyExists = []
  const nearDuplicates = []

  for (const newName of newProducts) {
    const newNameNorm = newName.normalize('NFC').trim()
    // 1. Exact match?
    const exact = postRenameProducts.find(p => p.name.normalize('NFC').trim() === newNameNorm)
    if (exact) {
      alreadyExists.push({ requestedName: newName, existingId: exact.id, existingName: exact.name, reason: 'EXACT match (after rename)' })
      continue
    }
    // 2. Near-duplicate? (contains either way)
    const near = postRenameProducts.filter(p => {
      const pn = p.name.normalize('NFC').trim()
      return pn.includes(newNameNorm) || newNameNorm.includes(pn)
    })
    if (near.length > 0) {
      nearDuplicates.push({ requestedName: newName, candidates: near })
      continue
    }
    // 3. Truly missing — safe to create
    toCreate.push({ name: newName, categoryId: aluminumCategory.id, categoryName: aluminumCategory.name })
  }

  console.log(`✅ EXACT EXISTS (will NOT create duplicate):`)
  for (const e of alreadyExists) {
    console.log(`  Requested: "${e.requestedName}"`)
    console.log(`    → Already exists as: "${e.existingName}" (${e.existingId})`)
    console.log(`    Reason: ${e.reason}`)
  }
  console.log(`Total exact-exists: ${alreadyExists.length}\n`)

  console.log(`⚠️  NEAR-DUPLICATES (need owner review before creating):`)
  for (const n of nearDuplicates) {
    console.log(`  Requested: "${n.requestedName}"`)
    for (const c of n.candidates) {
      console.log(`    → Near-duplicate: "${c.name}" (${c.id}, ${c.categoryName})`)
    }
  }
  console.log(`Total near-duplicate cases: ${nearDuplicates.length}\n`)

  console.log(`🆕 TO CREATE (truly missing):`)
  for (const c of toCreate) {
    console.log(`  + ${c.name} (category: ${c.categoryName})`)
  }
  console.log(`Total to create: ${toCreate.length}\n`)

  fs.writeFileSync('/home/z/my-project/reconciliation/create-plan.json', JSON.stringify({
    newProducts,
    alreadyExists,
    nearDuplicates,
    toCreate,
    aluminumCategoryId: aluminumCategory.id,
  }, null, 2))
  console.log('Create plan saved to create-plan.json')
} catch (e) {
  console.error('❌ DB error:', e.message)
} finally {
  await db.$disconnect()
}
