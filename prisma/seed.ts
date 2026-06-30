/**
 * Seed script for yongheng-recycle
 * Run: bun run prisma/seed.ts
 *
 * Creates:
 *  - Default admin user (admin / [REDACTED-DEFAULT])
 *  - Staff user (01 / [REDACTED-DEFAULT])
 *  - 9 product categories (เหล็ก, ทองแดง, ทองเหลือง, แสตนเลส, อลูมิเนียม, ตะกั่ว, อิเล็กทรอนิกส์, อื่นๆ, พลาสติก)
 *  - 115 products from old-system Excel (รายการสิ้นต้า.xls) — all valid items, excluding owner-specified excluded codes
 *
 * Product names use old-system names directly (owner decision: simpler + safer).
 * Default buy prices from old-system Excel column G (ซื้อ-A@).
 *
 * NOTE: This script uses upsert for users/categories and deleteMany+create for products,
 *       so it fully replaces the product list. Only run on fresh dev DB or after backup.
 *       For production, use safe additive upsert logic instead (see prisma/sync-products.ts).
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Create admin user (admin / [REDACTED-DEFAULT])
  const hashedPassword = await bcrypt.hash('[REDACTED-DEFAULT]', 10)
  const admin = await db.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      id: 'user_admin_default',
      username: 'admin',
      password: hashedPassword,
      name: 'ผู้ดูแลระบบ',
      role: 'admin',
      isActive: true,
    },
  })
  console.log(`✓ Admin user: ${admin.username} (admin / [REDACTED-DEFAULT])`)

  // 2. Create staff user (01 / [REDACTED-DEFAULT])
  const staffHash = await bcrypt.hash('[REDACTED-DEFAULT]', 10)
  const staff = await db.user.upsert({
    where: { username: '01' },
    update: {},
    create: {
      username: '01',
      password: staffHash,
      name: 'ผู้ใช้ 01',
      role: 'staff',
      isActive: true,
    },
  })
  console.log(`✓ Staff user: ${staff.username} (01 / [REDACTED-DEFAULT])`)

  // 3. Delete all existing products + categories (full replacement)
  //    Must delete StockLot/BuyBillItem/etc first due to FK constraints — but for
  //    a fresh dev DB this is safe. For production, use prisma/sync-products.ts instead.
  console.log('🗑️  Clearing old products & categories...')
  await db.product.deleteMany({})
  await db.productCategory.deleteMany({})

  // 4. Create product categories (9 categories)
  //    Added อิเล็กทรอนิกส์ (group 07 from old system) and พลาสติก (group 09)
  const categories = [
    { name: 'เหล็ก', type: 'STEEL', sortOrder: 1 },
    { name: 'ทองแดง', type: 'METAL', sortOrder: 2 },
    { name: 'ทองเหลือง', type: 'METAL', sortOrder: 3 },
    { name: 'แสตนเลส', type: 'METAL', sortOrder: 4 },
    { name: 'อลูมิเนียม', type: 'METAL', sortOrder: 5 },
    { name: 'ตะกั่ว', type: 'METAL', sortOrder: 6 },
    { name: 'อิเล็กทรอนิกส์', type: 'METAL', sortOrder: 7 },
    { name: 'อื่นๆ', type: 'METAL', sortOrder: 8 },
    { name: 'พลาสติก', type: 'METAL', sortOrder: 9 },
  ]

  const categoryMap: Record<string, string> = {}
  for (const cat of categories) {
    const created = await db.productCategory.create({ data: cat })
    categoryMap[cat.name] = created.id
    console.log(`✓ Category: ${created.name} (${created.type})`)
  }

  // 5. Create products — 115 products from old-system Excel (รายการสิ้นต้า.xls)
  //    Using old-system names directly (owner decision).
  //    Excluded items (owner-specified): 49 codes (คัดแยก variants, ชั่งรถ, ค่าบริการ, etc.)
  //    defaultBuyPrice from old-system Excel column G (ซื้อ-A@).
  type SeedProduct = { name: string; category: string; defaultBuyPrice: number }
  const products: SeedProduct[] = [
    // เหล็ก (31 items — group 01)
    { name: 'เหล็กหนาพิเศษ', category: 'เหล็ก', defaultBuyPrice: 9.8 },
    { name: 'เหล็กหนาพิเศษยาว', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กหนาสั้น', category: 'เหล็ก', defaultBuyPrice: 9.4 },
    { name: 'เหล็กหนายาว', category: 'เหล็ก', defaultBuyPrice: 9.1 },
    { name: 'เหล็กคละ', category: 'เหล็ก', defaultBuyPrice: 9.1 },
    { name: 'เหล็กบาง', category: 'เหล็ก', defaultBuyPrice: 9 },
    { name: 'กระป๋อง,ปี๊บ', category: 'เหล็ก', defaultBuyPrice: 6.5 },
    { name: 'สังกะสี', category: 'เหล็ก', defaultBuyPrice: 5 },
    { name: 'เหล็กเส้น 5 หุน', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กเส้น 6 หุน (1.8m ขึ้นไป)', category: 'เหล็ก', defaultBuyPrice: 14.8 },
    { name: 'เหล็กเส้น 1 นิ้ว (1mขึ้นไป)', category: 'เหล็ก', defaultBuyPrice: 15 },
    { name: 'ขี้กลึงเหล็ก', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กหล่อชิ้นเล็ก', category: 'เหล็ก', defaultBuyPrice: 10.5 },
    { name: 'เหล็กหล่อ (ชิ้นใหญ่)', category: 'เหล็ก', defaultBuyPrice: 9.5 },
    { name: 'ถัง 15ถึง200 ลิตร', category: 'เหล็ก', defaultBuyPrice: 8.7 },
    { name: 'โช๊ค', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'ปั๊มสังกะสี', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'ปั๊มบาง', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'ปั๊มหนา', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กเส้น3-4หุน', category: 'เหล็ก', defaultBuyPrice: 11 },
    { name: 'อะไหล่', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เครื่องจักร', category: 'เหล็ก', defaultBuyPrice: 13.3 },
    { name: 'แหนบ', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กบางยาว', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กลวดรถ', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กคัดขาย', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'แม่พิมพ์', category: 'เหล็ก', defaultBuyPrice: 9.5 },
    { name: 'เบิกใช้งานต่างๆในบริษัท', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เมทัลชีส(มือสอง)', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กคัดใช้งาน', category: 'เหล็ก', defaultBuyPrice: 0 },
    { name: 'เหล็กสลิง,สแตน', category: 'เหล็ก', defaultBuyPrice: 9.2 },

    // อลูมิเนียม (34 items — group 02)
    { name: 'อลูมิเนียมกระป๋อง', category: 'อลูมิเนียม', defaultBuyPrice: 76 },
    { name: 'อลูมิเนียมล้อแม็ค', category: 'อลูมิเนียม', defaultBuyPrice: 93 },
    { name: 'อลูมิเนียมสายไฟ', category: 'อลูมิเนียม', defaultBuyPrice: 105 },
    { name: 'อลูมิเนียมบาง', category: 'อลูมิเนียม', defaultBuyPrice: 70 },
    { name: 'อลูมิเนียมหล่อ', category: 'อลูมิเนียม', defaultBuyPrice: 76 },
    { name: 'อลูมิเนียมผ้าเบรค', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'อลูมิเนียมกะทะไฟฟ้า', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'กระทะดำ', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'อลูมิเนียมกะทะ', category: 'อลูมิเนียม', defaultBuyPrice: 53 },
    { name: 'อลูมิเนียมตูดกะทะ', category: 'อลูมิเนียม', defaultBuyPrice: 51 },
    { name: 'อลูมิเนียมมุ้งลวด', category: 'อลูมิเนียม', defaultBuyPrice: 20 },
    { name: 'อลูมิเนียมมู่ลี่', category: 'อลูมิเนียม', defaultBuyPrice: 47 },
    { name: 'อลูมิเนียมฝาแกะ', category: 'อลูมิเนียม', defaultBuyPrice: 61 },
    { name: 'อลูมิเนียมฝาไม่แกะ', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'อลูมิเนียมฉาก', category: 'อลูมิเนียม', defaultBuyPrice: 97 },
    { name: 'หม้อน้ำอลูมีเนียม', category: 'อลูมิเนียม', defaultBuyPrice: 62 },
    { name: 'อลูมีเนียมเครื่อง', category: 'อลูมิเนียม', defaultBuyPrice: 81 },
    { name: 'อลูมีเนียมครีบหม้อน้ำ', category: 'อลูมิเนียม', defaultBuyPrice: 37 },
    { name: 'อลูมิเนียมอัลลอยด์', category: 'อลูมิเนียม', defaultBuyPrice: 60 },
    { name: 'อลูมิเนียมแผ่นเพจ', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'อลูมิเนียมติดเหล็ก', category: 'อลูมิเนียม', defaultBuyPrice: 19 },
    { name: 'สายไฟอลูมีเนียม(ไม่ปอก)', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'ขี้กลึงอลูมิเนียม', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'อลูมิเนียมฉากสี', category: 'อลูมิเนียม', defaultBuyPrice: 92 },
    { name: 'อลูมิเนียมเพลท', category: 'อลูมิเนียม', defaultBuyPrice: 84 },
    { name: 'กระป๋องสเปรย์', category: 'อลูมิเนียม', defaultBuyPrice: 75 },
    { name: 'ปั้มกระป๋อง', category: 'อลูมิเนียม', defaultBuyPrice: 75 },
    { name: 'ฟรอยไม่ติดพลาสติก', category: 'อลูมิเนียม', defaultBuyPrice: 30 },
    { name: 'ฝาเนียมเผา', category: 'อลูมิเนียม', defaultBuyPrice: 59 },
    { name: 'ตูดหม้อหุงข้าว', category: 'อลูมิเนียม', defaultBuyPrice: 51 },
    { name: 'ตูดกะทะไฟฟ้าล้วน', category: 'อลูมิเนียม', defaultBuyPrice: 28 },
    { name: 'หนาติดสี', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'หนาลูกสูบ', category: 'อลูมิเนียม', defaultBuyPrice: 0 },
    { name: 'หนาก้ามเบรค', category: 'อลูมิเนียม', defaultBuyPrice: 0 },

    // ทองแดง (12 items — group 03)
    { name: 'ทองแดงปอกเงา', category: 'ทองแดง', defaultBuyPrice: 434 },
    { name: 'ทองแดงปอกช็อต', category: 'ทองแดง', defaultBuyPrice: 424 },
    { name: 'ทองแดงใหญ่', category: 'ทองแดง', defaultBuyPrice: 406 },
    { name: 'ทองแดงเส้นเล็ก', category: 'ทองแดง', defaultBuyPrice: 402 },
    { name: 'ขี้กลึงทองแดง', category: 'ทองแดง', defaultBuyPrice: 0 },
    { name: 'หม้อน้ำไส้ทองแดง', category: 'ทองแดง', defaultBuyPrice: 203 },
    { name: 'ทองแดงติดเหล็ก', category: 'ทองแดง', defaultBuyPrice: 0 },
    { name: 'แดงชุบ', category: 'ทองแดง', defaultBuyPrice: 373 },
    { name: 'ทองแดงเกินจาก ST', category: 'ทองแดง', defaultBuyPrice: 0 },
    { name: 'ทองแดงขาดจาก ST', category: 'ทองแดง', defaultBuyPrice: 0 },
    { name: 'ทองแดงเส้นเล็ก(ไม่ชุบ)', category: 'ทองแดง', defaultBuyPrice: 0 },
    { name: 'ทองแดงท่อCandy', category: 'ทองแดง', defaultBuyPrice: 0 },

    // ทองเหลือง (9 items — group 04)
    { name: 'ทองเหลืองหนา', category: 'ทองเหลือง', defaultBuyPrice: 264 },
    { name: 'ทองเหลืองเนื้อแดง', category: 'ทองเหลือง', defaultBuyPrice: 360 },
    { name: 'ขี้กลึงทองเหลือง (เนื้อเขียว)', category: 'ทองเหลือง', defaultBuyPrice: 195 },
    { name: 'หม้อน้ำทองเหลือง', category: 'ทองเหลือง', defaultBuyPrice: 232 },
    { name: 'ขี้กลึงทองเหลือง (เนื้อแดง)', category: 'ทองเหลือง', defaultBuyPrice: 0 },
    { name: 'ทองเหลืองติดเหล็ก', category: 'ทองเหลือง', defaultBuyPrice: 0 },
    { name: 'ทองเหลืองเนื้อแดงติดเหล็ก', category: 'ทองเหลือง', defaultBuyPrice: 0 },
    { name: 'ทองเหลืองเกินจาก ST', category: 'ทองเหลือง', defaultBuyPrice: 0 },
    { name: 'ทองเหลืองขาดจาก ST', category: 'ทองเหลือง', defaultBuyPrice: 0 },

    // แสตนเลส (7 items — group 05)
    { name: 'แสตนเลส 304', category: 'แสตนเลส', defaultBuyPrice: 42 },
    { name: 'แสตนเลส 202', category: 'แสตนเลส', defaultBuyPrice: 13 },
    { name: 'แสตนเลสดูดติด', category: 'แสตนเลส', defaultBuyPrice: 0 },
    { name: 'แสตนเลส 304 (ยาว)', category: 'แสตนเลส', defaultBuyPrice: 38 },
    { name: 'แสตนเลสติดเหล็ก', category: 'แสตนเลส', defaultBuyPrice: 0 },
    { name: 'นิกเกิล(สแตนเลส)', category: 'แสตนเลส', defaultBuyPrice: 0 },
    { name: 'ขี้กลึงสแตนเลส304', category: 'แสตนเลส', defaultBuyPrice: 0 },

    // ตะกั่ว (3 items — group 06)
    { name: 'ตะกั่วนิ่ม', category: 'ตะกั่ว', defaultBuyPrice: 52 },
    { name: 'ตะกั่วแข็ง', category: 'ตะกั่ว', defaultBuyPrice: 69 },
    { name: 'ขี้กลึงตะกั่ว', category: 'ตะกั่ว', defaultBuyPrice: 0 },

    // อิเล็กทรอนิกส์ (6 items — group 07)
    { name: 'แบตเตอรี่ขาว', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
    { name: 'แบตเตอรี่ดำ', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
    { name: 'แบตเตอรี่เล็ก', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
    { name: 'แบตเตอรี่มอไซต์', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
    { name: 'แท็บเล็ต', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
    { name: 'พวงแผงวงจรติดสายไฟ', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },

    // อื่นๆ (12 items — group 08, excluding 0805, 0809, 0812, 0814)
    { name: 'มอเตอร์', category: 'อื่นๆ', defaultBuyPrice: 24 },
    { name: 'ของแกะ', category: 'อื่นๆ', defaultBuyPrice: 15 },
    { name: 'คอมดำ', category: 'อื่นๆ', defaultBuyPrice: 25 },
    { name: 'สายไฟไม่ปอก', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'เปลือกสายไฟ', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'ขยะ', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'สูญเสีย', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'กระสอบขาด', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'น้ำม้นเก่า', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'นิกเกิล', category: 'อื่นๆ', defaultBuyPrice: 550 },
    { name: 'แผงวงจรเขียว', category: 'อื่นๆ', defaultBuyPrice: 0 },
    { name: 'ของแกะราคาสูง', category: 'อื่นๆ', defaultBuyPrice: 0 },

    // พลาสติก (1 item — group 09)
    { name: 'พลาสติกรวม', category: 'พลาสติก', defaultBuyPrice: 0 },
  ]

  let sortOrder = 0
  for (const p of products) {
    const categoryId = categoryMap[p.category]
    if (!categoryId) continue
    await db.product.create({
      data: {
        name: p.name,
        defaultBuyPrice: p.defaultBuyPrice,
        categoryId,
        sortOrder: sortOrder++,
      },
    })
  }
  console.log(`✓ Created ${products.length} products`)

  // 6. Create sample employees (only if none exist)
  const employeeCount = await db.employee.count()
  if (employeeCount === 0) {
    const employees = [
      { name: 'คุณสมชาย', phone: '081-234-5678', hireDate: new Date('2024-01-15') },
      { name: 'คุณสมหญิง', phone: '082-345-6789', hireDate: new Date('2024-03-10') },
      { name: 'คุณวิชัย', phone: '089-456-7890', hireDate: new Date('2024-06-01') },
    ]
    for (const emp of employees) {
      await db.employee.create({ data: emp })
    }
    console.log(`✓ Created ${employees.length} employees`)
  } else {
    console.log(`✓ Employees already exist (${employeeCount}), skipping`)
  }

  // 7. Create default customer (only if none exist)
  const customerCount = await db.customer.count()
  if (customerCount === 0) {
    await db.customer.create({
      data: { name: 'ลูกค้าทั่วไป', phone: '-' },
    })
    console.log('✓ Created default customer')
  } else {
    console.log(`✓ Customers already exist (${customerCount}), skipping`)
  }

  console.log('\n🎉 Seed complete!')
  console.log('   Admin login: admin / [REDACTED-DEFAULT]')
  console.log('   Staff login: 01 / [REDACTED-DEFAULT]')
  console.log(`   Products: ${products.length} (9 categories)`)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
