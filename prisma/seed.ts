/**
 * Seed script for yongheng-recycle
 * Run: bun run prisma/seed.ts
 *
 * Creates:
 *  - Default admin user (admin / admin123)
 *  - 7 product categories (เหล็ก, ทองแดง, ทองเหลือง, แสตนเลส, อลูมีเนียม, ตะกั่ว, อื่นๆ)
 *  - 56 products (no default buy price — user fills in per transaction)
 *
 * NOTE: This script uses upsert for users/categories and upsert-by-name for products,
 *       but it does NOT delete old products. To fully replace the product list,
 *       run `bun run prisma/reset-products.ts` first (or drop the Product/ProductCategory tables).
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // 1. Create admin user (admin / admin123)
  const hashedPassword = await bcrypt.hash('admin123', 10)
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
  console.log(`✓ Admin user: ${admin.username} (admin / admin123)`)

  // 2. Create staff user (01 / 2550)
  const staffHash = await bcrypt.hash('2550', 10)
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
  console.log(`✓ Staff user: ${staff.username} (01 / 2550)`)

  // 3. Delete all existing products + categories (full replacement)
  //    Must delete StockLot/BuyBillItem/etc first due to FK constraints — but for
  //    a fresh dev DB this is safe. For production, use sql/setup_complete.sql instead.
  console.log('🗑️  Clearing old products & categories...')
  await db.product.deleteMany({})
  await db.productCategory.deleteMany({})

  // 4. Create product categories (7 categories)
  const categories = [
    { name: 'เหล็ก', type: 'STEEL', sortOrder: 1 },
    { name: 'ทองแดง', type: 'METAL', sortOrder: 2 },
    { name: 'ทองเหลือง', type: 'METAL', sortOrder: 3 },
    { name: 'แสตนเลส', type: 'METAL', sortOrder: 4 },
    { name: 'อลูมีเนียม', type: 'METAL', sortOrder: 5 },
    { name: 'ตะกั่ว', type: 'METAL', sortOrder: 6 },
    { name: 'อื่นๆ', type: 'METAL', sortOrder: 7 },
  ]

  const categoryMap: Record<string, string> = {}
  for (const cat of categories) {
    const created = await db.productCategory.create({ data: cat })
    categoryMap[cat.name] = created.id
    console.log(`✓ Category: ${created.name} (${created.type})`)
  }

  // 5. Create products (56 total across 7 categories)
  type SeedProduct = { name: string; category: string }
  const products: SeedProduct[] = [
    // เหล็ก (12)
    { name: 'หนาพิเศษ', category: 'เหล็ก' },
    { name: 'หนาสั้น(1เมตร)', category: 'เหล็ก' },
    { name: 'หนายาว', category: 'เหล็ก' },
    { name: 'เหล็กคละ', category: 'เหล็ก' },
    { name: 'เหล็กบาง', category: 'เหล็ก' },
    { name: 'เหล็กหล่อ 40', category: 'เหล็ก' },
    { name: 'เหล็กหล่อ 80', category: 'เหล็ก' },
    { name: 'กระป๋อง , ปี๊บ', category: 'เหล็ก' },
    { name: 'สังกะสี', category: 'เหล็ก' },
    { name: 'ถัง15-200ลิตร (สะอาด)', category: 'เหล็ก' },
    { name: 'แม่พิมพ์,เหล็กแข็ง', category: 'เหล็ก' },
    { name: 'สลิง,สแตน 1.5 ม.', category: 'เหล็ก' },

    // ทองแดง (7)
    { name: 'ปอก', category: 'ทองแดง' },
    { name: 'ช๊อต', category: 'ทองแดง' },
    { name: 'ใหญ่', category: 'ทองแดง' },
    { name: 'เล็ก', category: 'ทองแดง' },
    { name: 'พิเศษ', category: 'ทองแดง' },
    { name: 'หม้อน้ำ/แดง', category: 'ทองแดง' },
    { name: 'ทองแดงชุบ', category: 'ทองแดง' },

    // ทองเหลือง (4)
    { name: 'เนื้อแดง', category: 'ทองเหลือง' },
    { name: 'เหลืองหนา', category: 'ทองเหลือง' },
    { name: 'กลึงเหลือง', category: 'ทองเหลือง' },
    { name: 'หม้อเหลือง', category: 'ทองเหลือง' },

    // แสตนเลส (3)
    { name: 'แสตนเลส 304', category: 'แสตนเลส' },
    { name: '304 ยาวเกิน 1 เมตร', category: 'แสตนเลส' },
    { name: 'แสตนเลส 202', category: 'แสตนเลส' },

    // อลูมีเนียม (25)
    { name: 'เนียมสายไฟ', category: 'อลูมีเนียม' },
    { name: 'ฉาก', category: 'อลูมีเนียม' },
    { name: 'เนียมบาง', category: 'อลูมีเนียม' },
    { name: 'อัลลอย', category: 'อลูมีเนียม' },
    { name: 'ล้อแม๊กซ์', category: 'อลูมีเนียม' },
    { name: 'เนียมแข็ง', category: 'อลูมีเนียม' },
    { name: 'ป๋องเนียม', category: 'อลูมีเนียม' },
    { name: 'ฝาเนียมแกะ', category: 'อลูมีเนียม' },
    { name: 'เนียมกระทะ', category: 'อลูมีเนียม' },
    { name: 'เนียมตูดกะทะ', category: 'อลูมีเนียม' },
    { name: 'หม้อน้ำเนียม', category: 'อลูมีเนียม' },
    { name: 'ฝาเนียมเผา', category: 'อลูมีเนียม' },
    { name: 'ตูดหม้อหุงข้าว', category: 'อลูมีเนียม' },
    { name: 'ตูดกะทะไฟฟ้าล้วน', category: 'อลูมีเนียม' },
    { name: 'ฉากสี', category: 'อลูมีเนียม' },
    { name: 'เนียมเครื่อง', category: 'อลูมีเนียม' },
    { name: 'ครีบหม้อน้ำ', category: 'อลูมีเนียม' },
    { name: 'เนียมมุ้งลวด', category: 'อลูมีเนียม' },
    { name: 'มู่ลี่', category: 'อลูมีเนียม' },
    { name: 'เนียมเพลท', category: 'อลูมีเนียม' },
    { name: 'มุ้งลวด', category: 'อลูมีเนียม' },
    { name: 'ป๋องสเปรย์', category: 'อลูมีเนียม' },
    { name: 'ปั้มกระป๋อง', category: 'อลูมีเนียม' },
    { name: 'ฟรอยไม่ติดพลาสติก', category: 'อลูมีเนียม' },
    { name: 'ซีรี 5,000', category: 'อลูมีเนียม' },

    // ตะกั่ว (2)
    { name: 'ตะกั่วแข็ง', category: 'ตะกั่ว' },
    { name: 'ตะกั่วนิ่ม', category: 'ตะกั่ว' },

    // อื่นๆ (3)
    { name: 'ของแกะ', category: 'อื่นๆ' },
    { name: 'มอเตอร์(ตัวเล็ก)', category: 'อื่นๆ' },
    { name: 'คอมดำ(ทองแดง)', category: 'อื่นๆ' },
  ]

  let sortOrder = 0
  for (const p of products) {
    const categoryId = categoryMap[p.category]
    if (!categoryId) continue
    await db.product.create({
      data: {
        name: p.name,
        defaultBuyPrice: 0,
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
  console.log('   Admin login: admin / admin123')
  console.log('   Staff login: 01 / 2550')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
