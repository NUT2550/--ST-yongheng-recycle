import fs from 'fs'
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres.wefqhunzjvsxciiwdhjx:8sY.%23thcN%24Bk5%25G@aws-1-ap-northeast-2.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1' } } })
const bills = JSON.parse(fs.readFileSync('/tmp/fixed_bills.json', 'utf-8'))

const PM: Record<string,string> = {
  'เหล็กบาง':'prod_mqgp98n84w35u63lvp47gmhh','หนาสั้น':'prod_mqgp98443nt9tbljuk6uaxpy',
  'หนายาว':'prod_mqgp98a6ptx33sfd66e4s9ck','ของแกะ':'prod_mqgp9hja0s6zbk3yvapoxjjs',
  'เครื่องจักร':'JAK','เหล็กคละ':'prod_mqgp98gj4g2y4gogoyy5i7m5',
  '304':'prod_mqgp9caefhv0hs74sfuubrmr','202':'prod_mqgp9cmnidvf2vafwiepqg0d',
  '304ยาว':'prod_mqgp9cgafv9ts0i3ze22h1vb','แดงใหญ่':'prod_mqgp9arb37xlm6b54b0xa44v',
  'แดงเล็ก':'prod_mqgp9axign3hnk45ex03l4aw','แดงช็อต':'prod_mqgp9alick357v31bqqrlv43',
  'แดงปอก':'prod_mqgp9aevp2yb18adpkyr3qtr','แดงชุบ':'prod_mqgp9bgavns7vxc8rzrlsn65',
  'ทองเหลือง':'prod_mqgp9bmg24ygg55yytz9jphl','เหลืองหนา':'prod_mqgp9bspglewfbgukggj7wdy',
  'หม้อเหลือง':'prod_mqgp9c4i0fakfeg9387qaqwv','หม้อ/แดง':'prod_mqgp9b9ouoxmoeq34ccaydfj',
  'หม้อ/เนียม':'prod_mqgp9ejcaz0g567zocy5ub8j','หม้อ':'prod_mqgp9b9ouoxmoeq34ccaydfj',
  'เนียมบาง':'prod_mqgp9d5g7uiu7tttxza864tp','เนียมแข็ง':'prod_mqgp9do7ui6p53xv2tbjq7tb',
  'เนียมเครื่อง':'prod_mqgp9fgoheos0xee1ntl0r27','ตะกั่วแข็ง':'prod_mqgp9h6flpekakyzewnjsp1y',
  'ตูดกะทะ':'prod_mqgp9edcxnxkocxfu0odbayj','ฉาก':'prod_mqgp9cyrr65cu9xaams1daoh',
  'ฉากสี':'prod_mqgp9fa7fylab8ztuya98a9p','มอเตอร์':'prod_mqgp9hpqehz5267b46pxo5ic',
  'แผงวงจร':'prod_mqgp9hpqehz5267b46pxo5ic','กระทะ':'prod_mqgp9e6yxtg3mo8mf998qnf6',
  'สายไฟไม่ปอก':'prod_mqgp9csvq0takfp04k5d2dv6','ล้อแม็ค':'prod_mqgp9dhn9ryniksnud8q714g',
  'ขี้กลึงตะกั่ว':'prod_mqgp9h6flpekakyzewnjsp1y','ขี้กลึงเนียม':'prod_mqgp9do7ui6p53xv2tbjq7tb',
  'ขยะ':'WASTE',
}
const BUY = [
  {n:'ทองแดงปอก',w:58.98,id:'prod_mqgp9aevp2yb18adpkyr3qtr'},{n:'ทองแดงช๊อต',w:36.72,id:'prod_mqgp9alick357v31bqqrlv43'},
  {n:'ทองแดงใหญ่',w:93.54,id:'prod_mqgp9arb37xlm6b54b0xa44v'},{n:'ทองแดงเล็ก',w:16.52,id:'prod_mqgp9axign3hnk45ex03l4aw'},
  {n:'หม้อน้ำทองแดง',w:278.1,id:'prod_mqgp9b9ouoxmoeq34ccaydfj'},{n:'ทองแดงชุบ',w:0.34,id:'prod_mqgp9bgavns7vxc8rzrlsn65'},
  {n:'ทองเหลืองเนื้อแดง',w:50.52,id:'prod_mqgp9bmg24ygg55yytz9jphl'},{n:'เหลืองหนา',w:183.1,id:'prod_mqgp9bspglewfbgukggj7wdy'},
  {n:'แสตนเลส 304',w:3571.8,id:'prod_mqgp9caefhv0hs74sfuubrmr'},{n:'304ยาว',w:1874.1,id:'prod_mqgp9cgafv9ts0i3ze22h1vb'},
  {n:'แสตนเลส 202',w:833.9,id:'prod_mqgp9cmnidvf2vafwiepqg0d'},
  {n:'เนียมสายไฟ',w:587.1,id:'prod_mqgp9csvq0takfp04k5d2dv6'},{n:'ฉาก',w:431.4,id:'prod_mqgp9cyrr65cu9xaams1daoh'},
  {n:'เนียมบาง',w:802.9,id:'prod_mqgp9d5g7uiu7tttxza864tp'},{n:'อัลลอย',w:1.4,id:'prod_mqgp9dbqtfx0j3mnsbl9mwix'},
  {n:'ล้อแม๊กซ์',w:73.9,id:'prod_mqgp9dhn9ryniksnud8q714g'},{n:'เนียมแข็ง',w:452.3,id:'prod_mqgp9do7ui6p53xv2tbjq7tb'},
  {n:'ป๋องเนียม',w:1642.4,id:'prod_mqgp9duo294uh2l320pbg1ru'},{n:'ฝาเนียมแกะ',w:78.7,id:'prod_mqgp9e0y2ehae94h2mw403ns'},
  {n:'เนียมกระทะ',w:11.6,id:'prod_mqgp9e6yxtg3mo8mf998qnf6'},{n:'เนียมตูดกะทะ',w:1897,id:'prod_mqgp9edcxnxkocxfu0odbayj'},
  {n:'หม้อน้ำเนียม',w:202.8,id:'prod_mqgp9ejcaz0g567zocy5ub8j'},{n:'ฉากสี',w:327.9,id:'prod_mqgp9fa7fylab8ztuya98a9p'},
  {n:'เนียมเครื่อง',w:30.5,id:'prod_mqgp9fgoheos0xee1ntl0r27'},{n:'ครีบหม้อน้ำ',w:8.6,id:'prod_mqgp9fmounwsgwm9xyso0phf'},
  {n:'มู่ลี่',w:12.6,id:'prod_mqgp9fz6pqfgrkxoh5nbgchi'},
  {n:'ตะกั่วแข็ง',w:143.8,id:'prod_mqgp9h6flpekakyzewnjsp1y'},{n:'ตะกั่วนิ่ม',w:2.9,id:'prod_mqgp9hcgjuw6kt6ob5n75e4s'},
  {n:'ของแกะ',w:884.2,id:'prod_mqgp9hja0s6zbk3yvapoxjjs'},{n:'มอเตอร์',w:5778.7,id:'prod_mqgp9hpqehz5267b46pxo5ic'},
  {n:'คอมดำ',w:986.2,id:'prod_mqgp9hwdo411xly6wmmeyg86'},
]

async function main() {
  console.log('🚀 Batch 1: Clean + BUY stock + Bills 1-40')

  // 1. Create เครื่องจักร product
  let jakId = 'JAK'
  try {
    const ex = await db.product.findFirst({ where: { name: 'เครื่องจักร' } })
    if (ex) jakId = ex.id
    else {
      const now = new Date()
      const p = await db.product.create({ data: { name: 'เครื่องจักร', categoryId: 'cat_mqgp96fx33ba2pp09s8ikynf', defaultBuyPrice: 0, sortOrder: 99, createdAt: now, updatedAt: now } })
      jakId = p.id
    }
  } catch {}
  PM['เครื่องจักร'] = jakId
  console.log('  เครื่องจักร:', jakId)

  // 2. Delete all old data
  console.log('  Deleting old data...')
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

  // 3. BUY stock
  console.log('  Inserting BUY stock...')
  for (const b of BUY) {
    await db.stockLot.create({ data: { productId: b.id, remainingWeight: b.w, costPerKg: 0, dateAdded: new Date('2026-06-21'), source: 'BUY', sourceId: 'manual' } })
  }
  console.log('  ✓ BUY stock:', BUY.length)

  // 4. Sorting bills 1-40
  console.log('  Creating bills 1-40...')
  let bc = 0, ic = 0, sc = 0, tb = 0
  for (let i = 0; i < 40 && i < bills.length; i++) {
    const b = bills[i]
    const spid = PM[b.srcName]
    if (!spid) { console.log('    ⚠️ Skip:', b.date, b.srcName); continue }
    const isGa = b.srcName === 'ของแกะ'
    const itw = b.items.filter((x:any)=>x.name!=='ขยะ').reduce((s:number,x:any)=>s+x.weight,0)
    const lw = Math.round((b.srcWeight - itw) * 100) / 100
    const lc = Math.round(lw * b.srcCostPerKg * 100) / 100

    const bill = await db.sortingBill.create({ data: {
      date: new Date(b.date+'T10:00:00Z'), sourceProductId: spid, sourceWeight: b.srcWeight,
      sourcePricePerKg: b.srcCostPerKg, weighedTotal: b.srcWeight, lossWeight: lw, lossCost: lc,
      note: `ห้อง ${b.room}`, createdAt: new Date(b.date+'T10:00:00Z'), updatedAt: new Date(b.date+'T10:00:00Z'),
    }})

    for (const item of b.items) {
      const isW = item.name === 'ขยะ'
      const pid = isW ? spid : PM[item.name]
      if (!pid) { console.log('    ⚠️ Unknown item:', item.name); continue }
      const bn = (!isGa && !isW) ? Math.max(0, Math.round((item.buyPrice - b.srcCostPerKg) * item.weight * 0.1 * 100) / 100) : 0
      tb += bn
      await db.sortingBillItem.create({ data: {
        sortingBillId: bill.id, productId: pid, weight: item.weight, isWaste: isW,
        costPerKg: isW ? 0 : b.srcCostPerKg, totalCost: isW ? 0 : Math.round(item.weight * b.srcCostPerKg * 100) / 100,
        sortedPricePerKg: isW ? 0 : item.buyPrice, bonusAmount: bn,
      }})
      ic++
      if (!isW && item.weight > 0) {
        await db.stockLot.create({ data: { productId: pid, remainingWeight: item.weight, costPerKg: b.srcCostPerKg, dateAdded: new Date(b.date+'T10:00:00Z'), source: 'SORTING', sourceId: bill.id } })
        sc++
      }
    }
    bc++
  }
  console.log(`  ✓ Bills: ${bc}, Items: ${ic}, StockLots: ${sc}, Bonus: ${tb.toFixed(2)}`)
  console.log('  ✅ Batch 1 done!')
}
main().catch(e=>{console.error('❌',e.message);process.exit(1)}).finally(()=>db.$disconnect())
