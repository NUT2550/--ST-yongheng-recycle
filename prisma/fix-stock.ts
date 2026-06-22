/**
 * Fix stock to match real inventory (as of 21/6/2026)
 * Run: bun run prisma/fix-stock.ts
 *
 * Uses Supabase pooler URL directly (bypasses .env which is SQLite).
 */
import { PrismaClient } from '@prisma/client'

// Use Supabase pooler URL directly
const SUPABASE_POOLER_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'

const db = new PrismaClient({
  datasources: { db: { url: SUPABASE_POOLER_URL } },
})

// Product name → product ID mapping (from Supabase query)
const PRODUCT_MAP: Record<string, string> = {
  'ทองแดงปอก': 'prod_mqgp9aevp2yb18adpkyr3qtr',
  'ทองแดงช๊อต': 'prod_mqgp9alick357v31bqqrlv43',
  'ทองแดงใหญ่': 'prod_mqgp9arb37xlm6b54b0xa44v',
  'ทองแดงท่อใหม่': 'prod_mqgp9arb37xlm6b54b0xa44v',
  'ทองแดงเล็ก': 'prod_mqgp9axign3hnk45ex03l4aw',
  'ทองแดงพิเศษ': 'prod_mqgp9arb37xlm6b54b0xa44v',
  'หม้อน้ำทองแดง': 'prod_mqgp9b9ouoxmoeq34ccaydfj',
  'ทองแดงชุบ': 'prod_mqgp9bgavns7vxc8rzrlsn65',
  'ขี้กลึงทองแดง': 'prod_mqgp9arb37xlm6b54b0xa44v',
  'ทองเหลืองเนื้อแดง': 'prod_mqgp9bmg24ygg55yytz9jphl',
  'เหลืองหนา': 'prod_mqgp9bspglewfbgukggj7wdy',
  'ขี้กลึงทองเหลืองเนื้อเขียว': 'prod_mqgp9bylqjal88hmac4ykwo0',
  'ขี้กลึงทองเหลืองเนื้อแดง': 'prod_mqgp9bylqjal88hmac4ykwo0',
  'หม้อน้ำทองเหลือง': 'prod_mqgp9c4i0fakfeg9387qaqwv',
  'แสตนเลส 304': 'prod_mqgp9caefhv0hs74sfuubrmr',
  'แสตนเลส 304 ยาวเกิน1เมตร': 'prod_mqgp9cgafv9ts0i3ze22h1vb',
  'แสตนเลส 202': 'prod_mqgp9cmnidvf2vafwiepqg0d',
  'แสตนเลสดูดติด': 'prod_mqgp9caefhv0hs74sfuubrmr',
  'อลูมีเนียมสายไฟ': 'prod_mqgp9csvq0takfp04k5d2dv6',
  'อลูมีเนียมฉาก': 'prod_mqgp9cyrr65cu9xaams1daoh',
  'อลูมีเนียมบาง': 'prod_mqgp9d5g7uiu7tttxza864tp',
  'อลูมีเนียมอัลลอย': 'prod_mqgp9dbqtfx0j3mnsbl9mwix',
  'อลูมีเนียมล้อแม๊กซ์': 'prod_mqgp9dhn9ryniksnud8q714g',
  'อลูมีเนียมแข็ง': 'prod_mqgp9do7ui6p53xv2tbjq7tb',
  'กระป๋องอลูมีเนียม': 'prod_mqgp9duo294uh2l320pbg1ru',
  'ฝาอลูมีเนียมเนียม': 'prod_mqgp9e0y2ehae94h2mw403ns',
  'อลูมีเนียมกระทะ': 'prod_mqgp9e6yxtg3mo8mf998qnf6',
  'อลูมีเนียมตูดกะทะ': 'prod_mqgp9edcxnxkocxfu0odbayj',
  'หม้อน้ำอลูมีเนียม': 'prod_mqgp9ejcaz0g567zocy5ub8j',
  'ฝาอลูมีเนียมเผา': 'prod_mqgp9epjox7up6c2k8jrf289',
  'อลูมีเนียมตูดหม้อหุงข้าว': 'prod_mqgp9ew9ar8ckyjn69mr8aq2',
  'อลูมีเนียมตูดกะทะไฟฟ้าล้วน': 'prod_mqgp9f3wvar7pgyoek1zen5k',
  'อลูมีเนียมฉากสี': 'prod_mqgp9fa7fylab8ztuya98a9p',
  'อลูมีเนียมเครื่อง': 'prod_mqgp9fgoheos0xee1ntl0r27',
  'อลูมีเนียมครีบหม้อน้ำ': 'prod_mqgp9fmounwsgwm9xyso0phf',
  'อลูมีเนียมมุ้งลวด': 'prod_mqgp9fsl7s0haidcn5c9t4ee',
  'อลูมีเนียมมู่ลี่': 'prod_mqgp9fz6pqfgrkxoh5nbgchi',
  'อลูมีเนียมเพลท': 'prod_mqgp9g5d78sw9tuoeuem3i1b',
  'อลูมีเนียมมุ้งลวด2': 'prod_mqgp9gbfgywdc71yyps4y1ke',
  'อลูมีเนียมป๋องสเปรย์': 'prod_mqgp9gh81ao3300v6dhcei3x',
  'อลูมีเนียมปั้มกระป๋อง': 'prod_mqgp9gn9lfu942el9hx2undl',
  'อลูมีเนียมฟรอยไม่ติดพลาสติก': 'prod_mqgp9gt8ki5lcwu67ps55equ',
  'อลูมีเนียมซีรี 5,000': 'prod_mqgp9h048rj5720d2yk78tpk',
  'ตะกั่วแข็ง': 'prod_mqgp9h6flpekakyzewnjsp1y',
  'ตะกั่วนิ่ม': 'prod_mqgp9hcgjuw6kt6ob5n75e4s',
  'ขี้กลึงตะกั่ว': 'prod_mqgp9h6flpekakyzewnjsp1y',
  'ของแกะ': 'prod_mqgp9hja0s6zbk3yvapoxjjs',
  'มอเตอร์(ตัวเล็ก)': 'prod_mqgp9hpqehz5267b46pxo5ic',
  'คอมดำ(ทองแดง)': 'prod_mqgp9hwdo411xly6wmmeyg86',
}

const BUY_STOCK = [
  { name: 'ทองแดงปอก', weight: 58.98 },
  { name: 'ทองแดงช๊อต', weight: 36.72 },
  { name: 'ทองแดงใหญ่', weight: 81.4 },
  { name: 'ทองแดงท่อใหม่', weight: 12.14 },
  { name: 'ทองแดงเล็ก', weight: 16.52 },
  { name: 'หม้อน้ำทองแดง', weight: 278.1 },
  { name: 'ทองแดงชุบ', weight: 0.34 },
  { name: 'ทองเหลืองเนื้อแดง', weight: 50.52 },
  { name: 'เหลืองหนา', weight: 183.1 },
  { name: 'แสตนเลส 304', weight: 3566.8 },
  { name: 'แสตนเลส 304 ยาวเกิน1เมตร', weight: 1874.1 },
  { name: 'แสตนเลส 202', weight: 833.9 },
  { name: 'แสตนเลสดูดติด', weight: 5 },
  { name: 'อลูมีเนียมสายไฟ', weight: 587.1 },
  { name: 'อลูมีเนียมฉาก', weight: 431.4 },
  { name: 'อลูมีเนียมบาง', weight: 802.9 },
  { name: 'อลูมีเนียมอัลลอย', weight: 1.4 },
  { name: 'อลูมีเนียมล้อแม๊กซ์', weight: 73.9 },
  { name: 'อลูมีเนียมแข็ง', weight: 452.3 },
  { name: 'กระป๋องอลูมีเนียม', weight: 1642.4 },
  { name: 'ฝาอลูมีเนียมเนียม', weight: 78.7 },
  { name: 'อลูมีเนียมกระทะ', weight: 11.6 },
  { name: 'อลูมีเนียมตูดกะทะ', weight: 1897 },
  { name: 'หม้อน้ำอลูมีเนียม', weight: 202.8 },
  { name: 'อลูมีเนียมฉากสี', weight: 327.9 },
  { name: 'อลูมีเนียมเครื่อง', weight: 30.5 },
  { name: 'อลูมีเนียมครีบหม้อน้ำ', weight: 8.6 },
  { name: 'อลูมีเนียมมู่ลี่', weight: 12.6 },
  { name: 'ตะกั่วแข็ง', weight: 75.4 },
  { name: 'ตะกั่วนิ่ม', weight: 2.9 },
  { name: 'ขี้กลึงตะกั่ว', weight: 68.4 },
  { name: 'ของแกะ', weight: 884.2 },
  { name: 'มอเตอร์(ตัวเล็ก)', weight: 5778.7 },
  { name: 'คอมดำ(ทองแดง)', weight: 986.2 },
]

const SORTING_STOCK = [
  { name: 'หม้อน้ำทองแดง', weight: 249 },
  { name: 'ทองเหลืองเนื้อแดง', weight: 46 },
  { name: 'เหลืองหนา', weight: 55.5 },
  { name: 'หม้อน้ำทองเหลือง', weight: 1.4 },
  { name: 'แสตนเลส 304', weight: 871.3 },
  { name: 'แสตนเลส 304 ยาวเกิน1เมตร', weight: 224.2 },
  { name: 'แสตนเลส 202', weight: 448.9 },
  { name: 'อลูมีเนียมฉาก', weight: 27.2 },
  { name: 'อลูมีเนียมแข็ง', weight: 133.6 },
  { name: 'กระป๋องอลูมีเนียม', weight: 0.6 },
  { name: 'อลูมีเนียมกระทะ', weight: 0.4 },
  { name: 'อลูมีเนียมตูดกะทะ', weight: 0.2 },
  { name: 'หม้อน้ำอลูมีเนียม', weight: 14.2 },
  { name: 'อลูมีเนียมเครื่อง', weight: 11.5 },
  { name: 'ตะกั่วแข็ง', weight: 0.3 },
  { name: 'ของแกะ', weight: 111.6 },
  { name: 'มอเตอร์(ตัวเล็ก)', weight: 3890.9 },
  { name: 'คอมดำ(ทองแดง)', weight: 165.2 },
]

async function main() {
  console.log('🔧 Fixing stock to match real inventory...')

  console.log('1. Deleting old data...')
  await db.sortingBonus.deleteMany({})
  await db.creditPayment.deleteMany({})
  await db.creditEntry.deleteMany({})
  await db.stockLot.deleteMany({})
  await db.buyBillItem.deleteMany({})
  await db.sellBillItem.deleteMany({})
  await db.sortingBillItem.deleteMany({})
  await db.buyBill.deleteMany({})
  await db.sellBill.deleteMany({})
  await db.sortingBill.deleteMany({})
  console.log('   ✓ Old data deleted')

  console.log('2. Inserting stock from BUY...')
  let buyCount = 0
  for (const item of BUY_STOCK) {
    if (item.weight <= 0) continue
    const productId = PRODUCT_MAP[item.name]
    if (!productId) {
      console.log(`   ⚠️  No mapping for "${item.name}"`)
      continue
    }
    await db.stockLot.create({
      data: {
        productId,
        remainingWeight: item.weight,
        costPerKg: 0,
        dateAdded: new Date('2026-06-21'),
        source: 'BUY',
        sourceId: 'manual-import',
      },
    })
    buyCount++
  }
  console.log(`   ✓ Inserted ${buyCount} BUY stock lots`)

  console.log('3. Inserting stock from SORTING...')
  let sortCount = 0
  for (const item of SORTING_STOCK) {
    if (item.weight <= 0) continue
    const productId = PRODUCT_MAP[item.name]
    if (!productId) {
      console.log(`   ⚠️  No mapping for "${item.name}"`)
      continue
    }
    await db.stockLot.create({
      data: {
        productId,
        remainingWeight: item.weight,
        costPerKg: 0,
        dateAdded: new Date('2026-06-21'),
        source: 'SORTING',
        sourceId: 'manual-import',
      },
    })
    sortCount++
  }
  console.log(`   ✓ Inserted ${sortCount} SORTING stock lots`)

  console.log('4. Inserting sorting bonus (30,277.59 THB)...')
  const employees = await db.employee.findMany({ select: { id: true, name: true } })
  if (employees.length > 0) {
    const bonusPerEmployee = Math.round((30277.59 / employees.length) * 100) / 100
    for (const emp of employees) {
      await db.sortingBonus.create({
        data: {
          date: new Date('2026-06-21'),
          employeeId: emp.id,
          sortingBillId: null,
          totalWeight: 0,
          ratePerKg: 0,
          totalAmount: bonusPerEmployee,
          note: 'โบนัสรวม 1/1/2026 - 21/6/2026',
          isPaid: false,
        },
      })
    }
    console.log(`   ✓ Inserted ${bonusPerEmployee} THB × ${employees.length} employees`)
  }

  const totalLots = await db.stockLot.count()
  const totalBonuses = await db.sortingBonus.count()
  console.log('\n🎉 Stock fix complete!')
  console.log(`   StockLots: ${totalLots}`)
  console.log(`   SortingBonuses: ${totalBonuses}`)
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await db.$disconnect()
  })
