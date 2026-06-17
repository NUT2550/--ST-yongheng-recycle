/**
 * Seed script for yongheng-recycle
 * Run: bun run prisma/seed.ts
 *
 * Creates:
 *  - Default admin user (admin / admin123)
 *  - 7 product categories (Steel + Metal)
 *  - 56 products with default buy prices
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

  // 2. Create product categories
  const categories = [
    { name: 'เหล็กม้วน', type: 'STEEL', sortOrder: 1 },
    { name: 'เหล็กเส้น', type: 'STEEL', sortOrder: 2 },
    { name: 'เหล็กแผ่น', type: 'STEEL', sortOrder: 3 },
    { name: 'เหล็กโครงสร้าง', type: 'STEEL', sortOrder: 4 },
    { name: 'ทองแดง', type: 'METAL', sortOrder: 5 },
    { name: 'อลูมิเนียม', type: 'METAL', sortOrder: 6 },
    { name: 'โลหะอื่นๆ', type: 'METAL', sortOrder: 7 },
  ]

  const categoryMap: Record<string, string> = {}
  for (const cat of categories) {
    const created = await db.productCategory.upsert({
      where: { name: cat.name },
      update: { type: cat.type, sortOrder: cat.sortOrder },
      create: cat,
    })
    categoryMap[cat.name] = created.id
    console.log(`✓ Category: ${created.name} (${created.type})`)
  }

  // 3. Create products (56 total across 7 categories)
  type SeedProduct = { name: string; category: string; price: number }
  const products: SeedProduct[] = [
    // เหล็กม้วน (8)
    { name: 'ม้วนสังกะสีเก่า', category: 'เหล็กม้วน', price: 8 },
    { name: 'ม้วนสังกะสีใหม่', category: 'เหล็กม้วน', price: 12 },
    { name: 'ม้วนสีฟ้า', category: 'เหล็กม้วน', price: 10 },
    { name: 'ม้วนสีแดง', category: 'เหล็กม้วน', price: 10 },
    { name: 'ม้วนสีเขียว', category: 'เหล็กม้วน', price: 10 },
    { name: 'ม้วนเกรด A', category: 'เหล็กม้วน', price: 15 },
    { name: 'ม้วนเกรด B', category: 'เหล็กม้วน', price: 9 },
    { name: 'ม้วนเกรด C', category: 'เหล็กม้วน', price: 6 },

    // เหล็กเส้น (8)
    { name: 'เหล็กข้ออ้อยรีด', category: 'เหล็กเส้น', price: 14 },
    { name: 'เหล็กข้ออ้อยเดือย', category: 'เหล็กเส้น', price: 16 },
    { name: 'เหล็กกลม', category: 'เหล็กเส้น', price: 13 },
    { name: 'เหล็กเส้นเล็ก', category: 'เหล็กเส้น', price: 11 },
    { name: 'เหล็กเส้นใหญ่', category: 'เหล็กเส้น', price: 14 },
    { name: 'เหล็กกลม SS400', category: 'เหล็กเส้น', price: 15 },
    { name: 'เหล็กข้ออ้อย 9 มม.', category: 'เหล็กเส้น', price: 14 },
    { name: 'เหล็กข้ออ้อย 12 มม.', category: 'เหล็กเส้น', price: 14 },

    // เหล็กแผ่น (8)
    { name: 'แผ่นเหล็กดำ', category: 'เหล็กแผ่น', price: 13 },
    { name: 'แผ่นเหล็กขาว', category: 'เหล็กแผ่น', price: 14 },
    { name: 'แผ่นเหล็กลูกฟูก', category: 'เหล็กแผ่น', price: 12 },
    { name: 'แผ่นเหล็กฝ้า', category: 'เหล็กแผ่น', price: 10 },
    { name: 'แผ่นเหล็กเชื่อม', category: 'เหล็กแผ่น', price: 9 },
    { name: 'แผ่นสังกะสีเก่า', category: 'เหล็กแผ่น', price: 7 },
    { name: 'แผ่นสังกะสีใหม่', category: 'เหล็กแผ่น', price: 11 },
    { name: 'แผ่นสแตนเลส', category: 'เหล็กแผ่น', price: 35 },

    // เหล็กโครงสร้าง (8)
    { name: 'เหล็กฉาก', category: 'เหล็กโครงสร้าง', price: 14 },
    { name: 'เหล็ก I-Beam', category: 'เหล็กโครงสร้าง', price: 15 },
    { name: 'เหล็ก H-Beam', category: 'เหล็กโครงสร้าง', price: 15 },
    { name: 'เหล็ก U-Channel', category: 'เหล็กโครงสร้าง', price: 14 },
    { name: 'เหล็ก L-Angle', category: 'เหล็กโครงสร้าง', price: 14 },
    { name: 'เหล็กกล่อง', category: 'เหล็กโครงสร้าง', price: 15 },
    { name: 'เหล็กท่อดำ', category: 'เหล็กโครงสร้าง', price: 13 },
    { name: 'เหล็กท่อกลวง', category: 'เหล็กโครงสร้าง', price: 13 },

    // ทองแดง (8)
    { name: 'สายไฟทองแดง', category: 'ทองแดง', price: 180 },
    { name: 'ทองแดงแท่ง', category: 'ทองแดง', price: 220 },
    { name: 'ทองแดงแผ่น', category: 'ทองแดง', price: 200 },
    { name: 'ทองแดงเส้น', category: 'ทองแดง', price: 190 },
    { name: 'ทองแดงท่อ', category: 'ทองแดง', price: 210 },
    { name: 'มอเตอร์ทองแดง', category: 'ทองแดง', price: 250 },
    { name: 'ขดลวดทองแดง', category: 'ทองแดง', price: 230 },
    { name: 'เศษทองแดง', category: 'ทองแดง', price: 170 },

    // อลูมิเนียม (8)
    { name: 'อลูมิเนียมแผ่น', category: 'อลูมิเนียม', price: 45 },
    { name: 'อลูมิเนียมฉาก', category: 'อลูมิเนียม', price: 50 },
    { name: 'อลูมิเนียมขอบข้าง', category: 'อลูมิเนียม', price: 48 },
    { name: 'อลูมิเนียมกรอบประตู', category: 'อลูมิเนียม', price: 42 },
    { name: 'อลูมิเนียมหน้าต่าง', category: 'อลูมิเนียม', price: 40 },
    { name: 'อลูมิเนียมวงแหวน', category: 'อลูมิเนียม', price: 47 },
    { name: 'ลวดอลูมิเนียม', category: 'อลูมิเนียม', price: 38 },
    { name: 'เศษอลูมิเนียม', category: 'อลูมิเนียม', price: 30 },

    // โลหะอื่นๆ (8)
    { name: 'ตะกั่ว', category: 'โลหะอื่นๆ', price: 70 },
    { name: 'สังกะสีเหลว', category: 'โลหะอื่นๆ', price: 65 },
    { name: 'นิเกิล', category: 'โลหะอื่นๆ', price: 120 },
    { name: 'สแตนเลส 304', category: 'โลหะอื่นๆ', price: 40 },
    { name: 'สแตนเลส 316', category: 'โลหะอื่นๆ', price: 50 },
    { name: 'ทองเหลือง', category: 'โลหะอื่นๆ', price: 130 },
    { name: 'แมกนีเซียม', category: 'โลหะอื่นๆ', price: 25 },
    { name: 'โลหะผสม', category: 'โลหะอื่นๆ', price: 20 },
  ]

  let sortOrder = 0
  for (const p of products) {
    const categoryId = categoryMap[p.category]
    if (!categoryId) continue
    await db.product.upsert({
      where: { name: p.name },
      update: { defaultBuyPrice: p.price, categoryId },
      create: {
        name: p.name,
        defaultBuyPrice: p.price,
        categoryId,
        sortOrder: sortOrder++,
      },
    })
  }
  console.log(`✓ Created ${products.length} products`)

  // 4. Create sample employees
  const employees = [
    { name: 'คุณสมชาย', phone: '081-234-5678', hireDate: new Date('2024-01-15') },
    { name: 'คุณสมหญิง', phone: '082-345-6789', hireDate: new Date('2024-03-10') },
    { name: 'คุณวิชัย', phone: '089-456-7890', hireDate: new Date('2024-06-01') },
  ]
  for (const emp of employees) {
    const existing = await db.employee.findFirst({ where: { name: emp.name } })
    if (!existing) {
      await db.employee.create({ data: emp })
    }
  }
  console.log(`✓ Created ${employees.length} employees`)

  // 5. Create sample customer
  const existingCustomer = await db.customer.findFirst({ where: { name: 'ลูกค้าทั่วไป' } })
  if (!existingCustomer) {
    await db.customer.create({
      data: { name: 'ลูกค้าทั่วไป', phone: '-' },
    })
    console.log('✓ Created default customer')
  }

  console.log('\n🎉 Seed complete!')
  console.log('   Admin login: admin / admin123')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
