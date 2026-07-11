/**
 * Test the FIX LOGIC against production DB (simulating what the new API will do).
 * This verifies that the validation logic correctly returns 400/404/409
 * instead of letting Prisma throw 500s.
 *
 * NOTE: This does NOT call the API endpoint. It runs the same validation logic
 * against the production DB directly to confirm the fix is correct.
 */
import { PrismaClient, Prisma } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

// Mirror of the new PATCH handler logic
async function simulatePATCH(id, body) {
  const result = { status: 0, error: null, product: null }

  // 1. Verify product exists
  const existing = await db.product.findUnique({
    where: { id },
    select: { id: true, name: true },
  })
  if (!existing) {
    result.status = 404
    result.error = 'ไม่พบสินค้านี้ในระบบ'
    return result
  }

  const { name, defaultBuyPrice, categoryId, sortOrder } = body

  // 2. Validate name
  let trimmedName
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      result.status = 400
      result.error = 'กรุณากรอกชื่อสินค้า'
      return result
    }
    trimmedName = name.trim()
  }

  // 3. Validate defaultBuyPrice
  let numericPrice
  if (defaultBuyPrice !== undefined) {
    if (typeof defaultBuyPrice === 'number') {
      numericPrice = defaultBuyPrice
    } else if (typeof defaultBuyPrice === 'string') {
      if (defaultBuyPrice.trim() === '') {
        numericPrice = 0
      } else {
        const parsed = parseFloat(defaultBuyPrice)
        if (isNaN(parsed)) {
          result.status = 400
          result.error = `ราคารับซื้อไม่ถูกต้อง: "${defaultBuyPrice}" ไม่ใช่ตัวเลข`
          return result
        }
        numericPrice = parsed
      }
    } else {
      result.status = 400
      result.error = 'ราคารับซื้อต้องเป็นตัวเลข'
      return result
    }
  }

  // 4. Validate categoryId
  if (categoryId !== undefined) {
    if (typeof categoryId !== 'string' || !categoryId.trim()) {
      result.status = 400
      result.error = 'กรุณาเลือกหมวดหมู่'
      return result
    }
    const category = await db.productCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    })
    if (!category) {
      result.status = 400
      result.error = 'หมวดหมู่ที่เลือกไม่มีอยู่ในระบบ'
      return result
    }
  }

  // 5. Validate sortOrder
  let numericSortOrder
  if (sortOrder !== undefined) {
    if (typeof sortOrder === 'number') {
      numericSortOrder = sortOrder
    } else if (typeof sortOrder === 'string') {
      const parsed = parseInt(sortOrder, 10)
      if (isNaN(parsed)) {
        result.status = 400
        result.error = 'ลำดับการแสดงผลต้องเป็นตัวเลข'
        return result
      }
      numericSortOrder = parsed
    }
  }

  // 6. Check for duplicate name
  if (trimmedName !== undefined && trimmedName !== existing.name) {
    const duplicate = await db.product.findFirst({
      where: { name: trimmedName, id: { not: id } },
      select: { id: true, name: true },
    })
    if (duplicate) {
      result.status = 409
      result.error = `มีสินค้าชื่อ "${trimmedName}" อยู่แล้วในระบบ`
      return result
    }
  }

  // 7. Build update data
  const data = {}
  if (trimmedName !== undefined) data.name = trimmedName
  if (numericPrice !== undefined) data.defaultBuyPrice = numericPrice
  if (numericSortOrder !== undefined) data.sortOrder = numericSortOrder
  if (categoryId !== undefined) data.categoryId = categoryId

  // 8. Perform update
  try {
    const product = await db.product.update({
      where: { id },
      data,
      include: { category: true },
    })
    result.status = 200
    result.product = { id: product.id, name: product.name, categoryId: product.categoryId }
    return result
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        result.status = 409
        result.error = 'ค่าซ้ำกับที่มีอยู่'
        return result
      }
      if (error.code === 'P2003') {
        result.status = 400
        result.error = 'หมวดหมู่ที่อ้างถึงไม่มีอยู่ในระบบ'
        return result
      }
      if (error.code === 'P2025') {
        result.status = 404
        result.error = 'ไม่พบสินค้านี้ในระบบ'
        return result
      }
    }
    result.status = 500
    result.error = 'แก้ไขสินค้าไม่สำเร็จ: ' + error.message
    return result
  }
}

const NICKEL_ID = 'cmr09vcvi001ol105nmz9gye6'
const STAINLESS_CAT = 'cat_mqgp96yrcbn9ui8fqmikp7u1'

const tests = [
  { name: 'TEST 1: Save with no changes (nickel)', body: { name: 'นิกเกิล(สแตนเลส)', defaultBuyPrice: 0, categoryId: STAINLESS_CAT }, expect: 200 },
  { name: 'TEST 2: Empty name', body: { name: '', defaultBuyPrice: 0, categoryId: STAINLESS_CAT }, expect: 400 },
  { name: 'TEST 3: Rename to existing name (duplicate)', body: { name: 'นิกเกิล', defaultBuyPrice: 0, categoryId: STAINLESS_CAT }, expect: 409 },
  { name: 'TEST 4: Invalid categoryId', body: { name: 'นิกเกิล(สแตนเลส)', defaultBuyPrice: 0, categoryId: 'invalid_cat_id' }, expect: 400 },
  { name: 'TEST 5: defaultBuyPrice as non-numeric string', body: { name: 'นิกเกิล(สแตนเลส)', defaultBuyPrice: 'abc', categoryId: STAINLESS_CAT }, expect: 400 },
  { name: 'TEST 6: Non-existent productId', body: { name: 'Test', defaultBuyPrice: 0, categoryId: STAINLESS_CAT }, id: 'nonexistent_id_12345', expect: 404 },
  { name: 'TEST 7: Rename to new unique name', body: { name: 'นิกเกิล(สแตนเลส) TEST', defaultBuyPrice: 0, categoryId: STAINLESS_CAT }, expect: 200, cleanup: true },
  { name: 'TEST 8: Empty string price → 0', body: { name: 'นิกเกิล(สแตนเลส)', defaultBuyPrice: '', categoryId: STAINLESS_CAT }, expect: 200 },
  { name: 'TEST 9: String number price', body: { name: 'นิกเกิล(สแตนเลส)', defaultBuyPrice: '12.5', categoryId: STAINLESS_CAT }, expect: 200 },
  { name: 'TEST 10: Change category to อื่นๆ', body: { name: 'นิกเกิล(สแตนเลส)', defaultBuyPrice: 0, categoryId: 'cat_mqgp97rabmhxn0sn7pr3ozky' }, expect: 200, restoreCat: STAINLESS_CAT },
]

console.log('=== TESTING NEW PATCH LOGIC (against production DB) ===\n')
let passCount = 0
let failCount = 0
for (const t of tests) {
  const id = t.id || NICKEL_ID
  const result = await simulatePATCH(id, t.body)
  const passed = result.status === t.expect
  const status = passed ? '✅ PASS' : '❌ FAIL'
  console.log(`${status} ${t.name}`)
  console.log(`   expected: ${t.expect}, got: ${result.status}`)
  if (result.error) console.log(`   error: ${result.error}`)
  if (result.product) console.log(`   product: ${result.product.name} (cat: ${result.product.categoryId})`)
  if (passed) passCount++; else failCount++

  // Cleanup if needed
  if (t.cleanup && result.status === 200) {
    // Restore the name
    await db.product.update({ where: { id: NICKEL_ID }, data: { name: 'นิกเกิล(สแตนเลส)' } })
    console.log(`   (cleanup: restored name to "นิกเกิล(สแตนเลส)")`)
  }
  if (t.restoreCat && result.status === 200) {
    // Restore the category
    await db.product.update({ where: { id: NICKEL_ID }, data: { categoryId: t.restoreCat } })
    console.log(`   (cleanup: restored category to ${t.restoreCat})`)
  }
  console.log()
}

console.log(`=== SUMMARY ===`)
console.log(`Passed: ${passCount} / ${tests.length}`)
console.log(`Failed: ${failCount} / ${tests.length}`)

await db.$disconnect()
