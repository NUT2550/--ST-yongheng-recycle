/**
 * Create user "01" with password from CLI arg
 * Run: bun run prisma/create-user-01.ts
 *
 * Role: staff (default). To promote to admin, edit via the Users page
 *       (login as admin/[REDACTED] first) or change role below and re-run.
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const db = new PrismaClient()

async function main() {
  const username = '01'
  const password = process.argv[2] || "[REDACTED-DEFAULT]"
  const name = 'ผู้ใช้ 01'
  const role: 'staff' | 'admin' = 'staff'

  const hashedPassword = await bcrypt.hash(password, 10)

  const user = await db.user.upsert({
    where: { username },
    update: {
      password: hashedPassword,
      name,
      role,
      isActive: true,
    },
    create: {
      username,
      password: hashedPassword,
      name,
      role,
      isActive: true,
    },
  })

  console.log('✓ User created/updated:')
  console.log(`  username: ${user.username}`)
  console.log(`  name:     ${user.name}`)
  console.log(`  role:     ${user.role}`)
  console.log(`  active:   ${user.isActive}`)
  console.log(`  password: ${password} (plain, for your record only)`)
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
