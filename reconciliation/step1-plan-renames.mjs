/**
 * Step 1: Load current MetalTrack products, identify all containing "อลูมีเนียม",
 * check for collisions after rename to "อลูมิเนียม".
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

try {
  const allProducts = await db.product.findMany({ include: { category: true }, orderBy: { sortOrder: 'asc' } })
  console.log(`Total MetalTrack products: ${allProducts.length}\n`)

  // Identify products containing "อลูมีเนียม" (with อี vowel)
  const toRename = []
  for (const p of allProducts) {
    if (p.name.includes('อลูมีเนียม')) {
      const newName = p.name.replace(/อลูมีเนียม/g, 'อลูมิเนียม')
      toRename.push({ id: p.id, oldName: p.name, newName, categoryId: p.categoryId, categoryName: p.category.name })
    }
  }
  console.log(`=== PRODUCTS TO RENAME (containing "อลูมีเนียม") ===`)
  for (const r of toRename) {
    console.log(`  ${r.id} | "${r.oldName}" → "${r.newName}" (${r.categoryName})`)
  }
  console.log(`Total: ${toRename.length} products to rename\n`)

  // Check for collisions: does any new name already exist as a different product?
  const existingNames = new Map()
  for (const p of allProducts) {
    existingNames.set(p.name.normalize('NFC'), p)
  }
  const collisions = []
  for (const r of toRename) {
    const newNameNorm = r.newName.normalize('NFC')
    if (existingNames.has(newNameNorm)) {
      const existing = existingNames.get(newNameNorm)
      if (existing.id !== r.id) {
        collisions.push({ rename: r, existing: { id: existing.id, name: existing.name, category: existing.category.name } })
      }
    }
  }
  console.log(`=== COLLISION CHECK ===`)
  if (collisions.length === 0) {
    console.log(`✅ No collisions — all renames are safe to apply.`)
  } else {
    console.log(`❌ COLLISIONS FOUND — STOP and report:`)
    for (const c of collisions) {
      console.log(`  Rename "${c.rename.oldName}" (${c.rename.id}) → "${c.rename.newName}" would collide with existing product "${c.existing.name}" (${c.existing.id}, category: ${c.existing.category})`)
    }
  }

  // Save the rename plan for next step
  const fs = await import('fs')
  fs.writeFileSync('/home/z/my-project/reconciliation/rename-plan.json', JSON.stringify({ toRename, collisions }, null, 2))
  console.log(`\nRename plan saved to rename-plan.json`)
} catch (e) {
  console.error('❌ DB error:', e.message)
} finally {
  await db.$disconnect()
}
