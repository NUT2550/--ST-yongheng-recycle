import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const SUPABASE_URL = 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1'
const db = new PrismaClient({ datasources: { db: { url: SUPABASE_URL } } })

const bills = JSON.parse(fs.readFileSync('/tmp/fixed_bills.json', 'utf-8'))

// Fix remaining source name issues
for (const b of bills) {
  if (b.srcName === '' || b.srcName === 'หน้าสั น' || b.srcName === 'หน้าสั้น') b.srcName = 'หนาสั้น'
  if (b.srcName === 'เหลือง' || b.srcName === 'เนื อแดง' || b.srcName === 'เนือแดง') b.srcName = 'ของแกะ'
  if (b.srcName === 'ติด' || b.srcName === 'ล/บาง') b.srcName = 'เหล็กบาง'
}

const PRODUCT_MAP: Record<string, string> = {
  'เหล็กบาง': 'prod_mqgp98n84w35u63lvp47gmhh',
  'หนาสั้น': 'prod_mqgp98443nt9tbljuk6uaxpy',
  'หนายาว': 'prod_mqgp98a6ptx33sfd66e4s9ck',
  'ของแกะ': 'prod_mqgp9hja0s6zbk3yvapoxjjs',
  'เครื่องจักร': 'PROD_NEW',
  'เหล็กคละ': 'prod_mqgp98gj4g2y4gogoyy5i7m5',
  '304': 'prod_mqgp9caefhv0hs74sfuubrmr',
  '202': 'prod_mqgp9cmnidvf2vafwiepqg0d',
  '304ยาว': 'prod_mqgp9cgafv9ts0i3ze22h1vb',
  'แดงใหญ่': 'prod_mqgp9arb37xlm6b54b0xa44v',
  'แดงเล็ก': 'prod_mqgp9axign3hnk45ex03l4aw',
  'แดงช็อต': 'prod_mqgp9alick357v31bqqrlv43',
  'แดงปอก': 'prod_mqgp9aevp2yb18adpkyr3qtr',
  'แดงชุบ': 'prod_mqgp9bgavns7vxc8rzrlsn65',
  'ทองเหลือง': 'prod_mqgp9bmg24ygg55yytz9jphl',
  'เหลืองหนา': 'prod_mqgp9bspglewfbgukggj7wdy',
  'หม้อเหลือง': 'prod_mqgp9c4i0fakfeg9387qaqwv',
  'หม้อ/แดง': 'prod_mqgp9b9ouoxmoeq34ccaydfj',
  'หม้อ/เนียม': 'prod_mqgp9ejcaz0g567zocy5ub8j',
  'หม้อ/น้ำ': 'prod_mqgp9ejcaz0g567zocy5ub8j',
  'หม้อ': 'prod_mqgp9b9ouoxmoeq34ccaydfj',
  'เนียมบาง': 'prod_mqgp9d5g7uiu7tttxza864tp',
  'เนียมแข็ง': 'prod_mqgp9do7ui6p53xv2tbjq7tb',
  'เนียมเครื่อง': 'prod_mqgp9fgoheos0xee1ntl0r27',
  'ตะกั่วแข็ง': 'prod_mqgp9h6flpekakyzewnjsp1y',
  'ตูดกะทะ': 'prod_mqgp9edcxnxkocxfu0odbayj',
  'ฉาก': 'prod_mqgp9cyrr65cu9xaams1daoh',
  'ฉากสี': 'prod_mqgp9fa7fylab8ztuya98a9p',
  'มอเตอร์': 'prod_mqgp9hpqehz5267b46pxo5ic',
  'แผงวงจร': 'prod_mqgp9hpqehz5267b46pxo5ic',
  'กระทะ': 'prod_mqgp9e6yxtg3mo8mf998qnf6',
  'สายไฟไม่ปอก': 'prod_mqgp9csvq0takfp04k5d2dv6',
  'ล้อแม็ค': 'prod_mqgp9dhn9ryniksnud8q714g',
  'ขี้กลึงตะกั่ว': 'prod_mqgp9h6flpekakyzewnjsp1y',
  'ขี้กลึงเนียม': 'prod_mqgp9do7ui6p53xv2tbjq7tb',
  'เหล็กคละ': 'prod_mqgp98gj4g2y4gogoyy5i7m5',
}

const BUY_STOCK = [
  { name: 'ทองแดงปอก', weight: 58.98 }, { name: 'ทองแดงช๊อต', weight: 36.72 },
  { name: 'ทองแดงใหญ่', weight: 81.4 }, { name: 'ทองแดงท่อใหม่', weight: 12.14 },
  { name: 'ทองแดงเล็ก', weight: 16.52 }, { name: 'หม้อน้ำทองแดง', weight: 278.1 },
  { name: 'ทองแดงชุบ', weight: 0.34 }, { name: 'ทองเหลืองเนื้อแดง', weight: 50.52 },
  { name: 'เหลืองหนา', weight: 183.1 }, { name: 'แสตนเลส 304', weight: 3566.8 },
  { name: 'แสตนเลส 304 ยาวเกิน1เมตร', weight: 1874.1 }, { name: 'แสตนเลส 202', weight: 833.9 },
  { name: 'แสตนเลสดูดติด', weight: 5 }, { name: 'อลูมีเนียมสายไฟ', weight: 587.1 },
  { name: 'อลูมีเนียมฉาก', weight: 431.4 }, { name: 'อลูมีเนียมบาง', weight: 802.9 },
  { name: 'อลูมีเนียมอัลลอย', weight: 1.4 }, { name: 'อลูมีเนียมล้อแม๊กซ์', weight: 73.9 },
  { name: 'อลูมีเนียมแข็ง', weight: 452.3 }, { name: 'กระป๋องอลูมีเนียม', weight: 1642.4 },
  { name: 'ฝาอลูมีเนียมเนียม', weight: 78.7 }, { name: 'อลูมีเนียมกระทะ', weight: 11.6 },
  { name: 'อลูมีเนียมตูดกะทะ', weight: 1897 }, { name: 'หม้อน้ำอลูมีเนียม', weight: 202.8 },
  { name: 'อลูมีเนียมฉากสี', weight: 327.9 }, { name: 'อลูมีเนียมเครื่อง', weight: 30.5 },
  { name: 'อลูมีเนียมครีบหม้อน้ำ', weight: 8.6 }, { name: 'อลูมีเนียมมู่ลี่', weight: 12.6 },
  { name: 'ตะกั่วแข็ง', weight: 75.4 }, { name: 'ตะกั่วนิ่ม', weight: 2.9 },
  { name: 'ขี้กลึงตะกั่ว', weight: 68.4 }, { name: 'ของแกะ', weight: 884.2 },
  { name: 'มอเตอร์(ตัวเล็ก)', weight: 5778.7 }, { name: 'คอมดำ(ทองแดง)', weight: 986.2 },
]

const BUY_MAP: Record<string, string> = {
  'ทองแดงปอก': 'prod_mqgp9aevp2yb18adpkyr3qtr', 'ทองแดงช๊อต': 'prod_mqgp9alick357v31bqqrlv43',
  'ทองแดงใหญ่': 'prod_mqgp9arb37xlm6b54b0xa44v', 'ทองแดงท่อใหม่': 'prod_mqgp9arb37xlm6b54b0xa44v',
  'ทองแดงเล็ก': 'prod_mqgp9axign3hnk45ex03l4aw', 'หม้อน้ำทองแดง': 'prod_mqgp9b9ouoxmoeq34ccaydfj',
  'ทองแดงชุบ': 'prod_mqgp9bgavns7vxc8rzrlsn65', 'ทองเหลืองเนื้อแดง': 'prod_mqgp9bmg24ygg55yytz9jphl',
  'เหลืองหนา': 'prod_mqgp9bspglewfbgukggj7wdy', 'แสตนเลส 304': 'prod_mqgp9caefhv0hs74sfuubrmr',
  'แสตนเลส 304 ยาวเกิน1เมตร': 'prod_mqgp9cgafv9ts0i3ze22h1vb', 'แสตนเลส 202': 'prod_mqgp9cmnidvf2vafwiepqg0d',
  'แสตนเลสดูดติด': 'prod_mqgp9caefhv0hs74sfuubrmr', 'อลูมีเนียมสายไฟ': 'prod_mqgp9csvq0takfp04k5d2dv6',
  'อลูมีเนียมฉาก': 'prod_mqgp9cyrr65cu9xaams1daoh', 'อลูมีเนียมบาง': 'prod_mqgp9d5g7uiu7tttxza864tp',
  'อลูมีเนียมอัลลอย': 'prod_mqgp9dbqtfx0j3mnsbl9mwix', 'อลูมีเนียมล้อแม๊กซ์': 'prod_mqgp9dhn9ryniksnud8q714g',
  'อลูมีเนียมแข็ง': 'prod_mqgp9do7ui6p53xv2tbjq7tb', 'กระป๋องอลูมีเนียม': 'prod_mqgp9duo294uh2l320pbg1ru',
  'ฝาอลูมีเนียมเนียม': 'prod_mqgp9e0y2ehae94h2mw403ns', 'อลูมีเนียมกระทะ': 'prod_mqgp9e6yxtg3mo8mf998qnf6',
  'อลูมีเนียมตูดกะทะ': 'prod_mqgp9edcxnxkocxfu0odbayj', 'หม้อน้ำอลูมีเนียม': 'prod_mqgp9ejcaz0g567zocy5ub8j',
  'อลูมีเนียมฉากสี': 'prod_mqgp9fa7fylab8ztuya98a9p', 'อลูมีเนียมเครื่อง': 'prod_mqgp9fgoheos0xee1ntl0r27',
  'อลูมีเนียมครีบหม้อน้ำ': 'prod_mqgp9fmounwsgwm9xyso0phf', 'อลูมีเนียมมู่ลี่': 'prod_mqgp9fz6pqfgrkxoh5nbgchi',
  'ตะกั่วแข็ง': 'prod_mqgp9h6flpekakyzewnjsp1y', 'ตะกั่วนิ่ม': 'prod_mqgp9hcgjuw6kt6ob5n75e4s',
  'ขี้กลึงตะกั่ว': 'prod_mqgp9h6flpekakyzewnjsp1y', 'ของแกะ': 'prod_mqgp9hja0s6zbk3yvapoxjjs',
  'มอเตอร์(ตัวเล็ก)': 'prod_mqgp9hpqehz5267b46pxo5ic', 'คอมดำ(ทองแดง)': 'prod_mqgp9hwdo411xly6wmmeyg86',
}

async function main() {
  console.log('🚀 Starting import...')

  // 1. Create "เครื่องจักร" product
  console.log('1. Creating เครื่องจักร product...')
  let jakProdId = 'PROD_NEW'
  try {
    const existing = await db.product.findFirst({ where: { name: 'เครื่องจักร' } })
    if (existing) {
      jakProdId = existing.id
    } else {
      const now = new Date()
      const jak = await db.product.create({
        data: {
          name: 'เครื่องจักร',
          categoryId: 'cat_mqgp96fx33ba2pp09s8ikynf', // เหล็ก category
          defaultBuyPrice: 0,
          sortOrder: 99,
          createdAt: now,
          updatedAt: now,
        },
      })
      jakProdId = jak.id
      console.log(`   ✓ Created: ${jakProdId}`)
    }
  } catch (e: any) {
    // If create fails, try upsert via raw
    console.log('   Using existing or skip')
  }
  PRODUCT_MAP['เครื่องจักร'] = jakProdId

  // 2. Delete all old data
  console.log('2. Deleting old data...')
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
  console.log('   ✓ Deleted')

  // 3. Insert BUY stock
  console.log('3. Inserting BUY stock...')
  let buyCount = 0
  for (const item of BUY_STOCK) {
    if (item.weight <= 0) continue
    const pid = BUY_MAP[item.name]
    if (!pid) continue
    await db.stockLot.create({
      data: { productId: pid, remainingWeight: item.weight, costPerKg: 0, dateAdded: new Date('2026-06-21'), source: 'BUY', sourceId: 'manual' }
    })
    buyCount++
  }
  console.log(`   ✓ ${buyCount} BUY stock lots`)

  // 4. Create sorting bills
  console.log('4. Creating sorting bills...')
  let billCount = 0
  let itemCount = 0
  let sortStockCount = 0
  let totalBonus = 0
  let skipped = 0

  for (const b of bills) {
    const srcProductId = PRODUCT_MAP[b.srcName]
    if (!srcProductId) {
      console.log(`   ⚠️ Skip bill ${b.date}: unknown source "${b.srcName}"`)
      skipped++
      continue
    }

    const isGa = b.srcName === 'ของแกะ'
    const itemsTotalWeight = b.items
      .filter((i: any) => i.name !== 'ขยะ')
      .reduce((s: number, i: any) => s + i.weight, 0)
    const lossWeight = Math.round((b.srcWeight - itemsTotalWeight) * 100) / 100
    const lossCost = Math.round(lossWeight * b.srcCostPerKg * 100) / 100

    // Create bill
    const bill = await db.sortingBill.create({
      data: {
        date: new Date(b.date + 'T10:00:00Z'),
        sourceProductId: srcProductId,
        sourceWeight: b.srcWeight,
        sourcePricePerKg: b.srcCostPerKg,
        weighedTotal: b.srcWeight,
        lossWeight,
        lossCost,
        note: `ห้อง ${b.room}`,
        createdAt: new Date(b.date + 'T10:00:00Z'),
        updatedAt: new Date(b.date + 'T10:00:00Z'),
      },
    })

    // Create items + stock lots
    for (const item of b.items) {
      const isWaste = item.name === 'ขยะ'
      const sortProductId = PRODUCT_MAP[item.name]
      if (!sortProductId && !isWaste) {
        console.log(`   ⚠️ Unknown sorted item: "${item.name}" in bill ${b.date}`)
        continue
      }

      const bonus = (!isGa && !isWaste)
        ? Math.max(0, Math.round((item.buyPrice - b.srcCostPerKg) * item.weight * 0.1 * 100) / 100)
        : 0
      totalBonus += bonus

      await db.sortingBillItem.create({
        data: {
          sortingBillId: bill.id,
          productId: isWaste ? srcProductId : sortProductId,
          weight: item.weight,
          isWaste,
          costPerKg: isWaste ? 0 : b.srcCostPerKg,
          totalCost: isWaste ? 0 : Math.round(item.weight * b.srcCostPerKg * 100) / 100,
          sortedPricePerKg: isWaste ? 0 : item.buyPrice,
          bonusAmount: bonus,
        }
      })
      itemCount++

      // Create stock lot for non-waste items
      if (!isWaste && item.weight > 0) {
        await db.stockLot.create({
          data: {
            productId: sortProductId,
            remainingWeight: item.weight,
            costPerKg: b.srcCostPerKg,
            dateAdded: new Date(b.date + 'T10:00:00Z'),
            source: 'SORTING',
            sourceId: bill.id,
          }
        })
        sortStockCount++
      }
    }
    billCount++
  }

  console.log(`   ✓ ${billCount} bills, ${itemCount} items, ${sortStockCount} stock lots`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Total bonus: ${totalBonus.toFixed(2)} THB`)

  // 5. Distribute bonus among employees
  console.log('5. Distributing bonus...')
  const employees = await db.employee.findMany()
  if (employees.length > 0) {
    const perEmp = Math.round((totalBonus / employees.length) * 100) / 100
    for (const emp of employees) {
      await db.sortingBonus.create({
        data: {
          date: new Date('2026-06-21'),
          employeeId: emp.id,
          totalWeight: 0,
          ratePerKg: 0,
          totalAmount: perEmp,
          note: 'โบนัสรวม 1/1/2026 - 21/6/2026 (จากการคัดแยก)',
          isPaid: false,
        }
      })
    }
    console.log(`   ✓ ${perEmp} THB × ${employees.length} = ${(perEmp * employees.length).toFixed(2)} THB`)
  }

  // 6. Summary
  const totalLots = await db.stockLot.count()
  const totalBills = await db.sortingBill.count()
  const totalBonuses = await db.sortingBonus.count()
  console.log('\n🎉 Import complete!')
  console.log(`   SortingBills: ${totalBills}`)
  console.log(`   StockLots: ${totalLots}`)
  console.log(`   SortingBonuses: ${totalBonuses}`)
}

main().catch(e => { console.error('❌', e); process.exit(1) }).finally(() => db.$disconnect())
