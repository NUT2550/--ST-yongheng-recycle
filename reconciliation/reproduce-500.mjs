/**
 * Reproduce the 500 error by calling PATCH /api/products/[id]
 * with the exact payload the frontend sends.
 *
 * Frontend payload (from products-page.tsx handleEdit):
 *   { name, defaultBuyPrice: parseFloat(price) || 0, categoryId }
 *
 * For "นิกเกิล(สแตนเลส)":
 *   - name: "นิกเกิล(สแตนเลส)" (unchanged)
 *   - defaultBuyPrice: 0 (whatever was in DB)
 *   - categoryId: <stainless category id>
 */
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

try {
  // Find the nickel product
  const nickel = await db.product.findFirst({ where: { name: { contains: 'นิกเกิล' } }, include: { category: true } })
  if (!nickel) {
    console.log('Nickel product not found')
    process.exit(1)
  }
  console.log('=== NICKEL PRODUCT (target of edit) ===')
  console.log(`  id: ${nickel.id}`)
  console.log(`  name: "${nickel.name}"`)
  console.log(`  categoryId: ${nickel.categoryId}`)
  console.log(`  category.name: ${nickel.category.name}`)
  console.log(`  defaultBuyPrice: ${nickel.defaultBuyPrice}`)
  console.log(`  sortOrder: ${nickel.sortOrder}`)

  // Simulate the frontend payload (no changes — user just clicks Save)
  const payload = {
    name: nickel.name,
    defaultBuyPrice: nickel.defaultBuyPrice,
    categoryId: nickel.categoryId,
  }
  console.log('\n=== FRONTEND PAYLOAD (no changes) ===')
  console.log(JSON.stringify(payload, null, 2))

  // Now simulate the API logic from src/app/api/products/[id]/route.ts PATCH handler
  console.log('\n=== SIMULATING API PATCH LOGIC ===')
  const { name, defaultBuyPrice, categoryId, sortOrder } = payload
  const data = {}
  if (name !== undefined) data.name = name
  if (defaultBuyPrice !== undefined) data.defaultBuyPrice = defaultBuyPrice
  if (categoryId !== undefined) data.categoryId = categoryId
  if (sortOrder !== undefined) data.sortOrder = sortOrder

  console.log('Data object passed to prisma.product.update:')
  console.log(JSON.stringify(data, null, 2))

  // Try the update directly
  console.log('\n=== ATTEMPTING UPDATE ===')
  try {
    const updated = await db.product.update({
      where: { id: nickel.id },
      data,
      include: { category: true },
    })
    console.log('✅ Update succeeded (no error)')
    console.log(`  Updated name: "${updated.name}"`)
    console.log(`  Updated categoryId: ${updated.categoryId}`)
  } catch (e) {
    console.log('❌ UPDATE FAILED with error:')
    console.log('  Error message:', e.message)
    console.log('  Error code:', e.code)
    console.log('  Error name:', e.name)
    console.log('  Full error:', JSON.stringify({
      name: e.name,
      message: e.message,
      code: e.code,
      stack: e.stack?.split('\n').slice(0, 5).join('\n'),
    }, null, 2))
  }
} catch (e) {
  console.error('Fatal:', e.message)
} finally {
  await db.$disconnect()
}
