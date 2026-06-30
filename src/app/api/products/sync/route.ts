import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

// POST /api/products/sync — Admin-only endpoint to sync product master
// This is a TEMPORARY endpoint for one-time product master sync.
// Should be removed after sync is complete.

export async function POST(request: NextRequest) {
  // Admin-only
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: 'ต้องการสิทธิ์ admin' }, { status: 403 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const DRY_RUN = body.dryRun !== false; // default: dry-run

    // === BEFORE COUNTS ===
    const before = {
      products: await db.product.count(),
      categories: await db.productCategory.count(),
      stockLots: await db.stockLot.count(),
      buyItems: await db.buyBillItem.count(),
      sellItems: await db.sellBillItem.count(),
      sortItems: await db.sortingBillItem.count(),
    };

    // === CATEGORIES (9) ===
    const CATEGORIES = [
      { name: 'เหล็ก', type: 'STEEL', sortOrder: 1 },
      { name: 'ทองแดง', type: 'METAL', sortOrder: 2 },
      { name: 'ทองเหลือง', type: 'METAL', sortOrder: 3 },
      { name: 'แสตนเลส', type: 'METAL', sortOrder: 4 },
      { name: 'อลูมิเนียม', type: 'METAL', sortOrder: 5 },
      { name: 'ตะกั่ว', type: 'METAL', sortOrder: 6 },
      { name: 'อิเล็กทรอนิกส์', type: 'METAL', sortOrder: 7 },
      { name: 'อื่นๆ', type: 'METAL', sortOrder: 8 },
      { name: 'พลาสติก', type: 'METAL', sortOrder: 9 },
    ];

    let categoriesCreated = 0;
    let categoriesExisted = 0;
    const categoryMap: Record<string, string> = {};

    for (const cat of CATEGORIES) {
      const existing = await db.productCategory.findUnique({ where: { name: cat.name } });
      if (existing) {
        categoryMap[cat.name] = existing.id;
        categoriesExisted++;
      } else {
        if (!DRY_RUN) {
          const created = await db.productCategory.create({ data: { ...cat } });
          categoryMap[cat.name] = created.id;
        }
        categoriesCreated++;
      }
    }

    // === RENAME MAP (40 products — rename by productId) ===
    const RENAME_MAP = [
      { productId: 'prod_mqgp995qaqfnykbbo5ziwi1t', newName: 'เหล็กหล่อชิ้นเล็ก', category: 'เหล็ก' },
      { productId: 'prod_mqgp99bt7vaj0jz2u837j3lm', newName: 'เหล็กหล่อ (ชิ้นใหญ่)', category: 'เหล็ก' },
      { productId: 'prod_mqgp99ij5mr6pceki4s9072l', newName: 'กระป๋อง,ปี๊บ', category: 'เหล็ก' },
      { productId: 'prod_mqgp99vijqwa10dzb68wohxt', newName: 'ถัง 15ถึง200 ลิตร', category: 'เหล็ก' },
      { productId: 'prod_mqgp9a1i7bviukked5gxa43v', newName: 'แม่พิมพ์', category: 'เหล็ก' },
      { productId: 'prod_mqgp9a880imxsartf4d8c14k', newName: 'เหล็กสลิง,สแตน', category: 'เหล็ก' },
      { productId: 'prod_mqgp9aevp2yb18adpkyr3qtr', newName: 'ทองแดงปอกเงา', category: 'ทองแดง' },
      { productId: 'prod_mqgp9alick357v31bqqrlv43', newName: 'ทองแดงปอกช็อต', category: 'ทองแดง' },
      { productId: 'prod_mqgp9axign3hnk45ex03l4aw', newName: 'ทองแดงเส้นเล็ก', category: 'ทองแดง' },
      { productId: 'prod_mqgp9b9ouoxmoeq34ccaydfj', newName: 'หม้อน้ำไส้ทองแดง', category: 'ทองแดง' },
      { productId: 'prod_mqgp9bgavns7vxc8rzrlsn65', newName: 'แดงชุบ', category: 'ทองแดง' },
      { productId: 'prod_mqgp9bspglewfbgukggj7wdy', newName: 'ทองเหลืองหนา', category: 'ทองเหลือง' },
      { productId: 'prod_mqgp9bylqjal88hmac4ykwo0', newName: 'ขี้กลึงทองเหลือง (เนื้อเขียว)', category: 'ทองเหลือง' },
      { productId: 'prod_new_1782125294097_e0b882e0b8b5e0b989e0b881', newName: 'ขี้กลึงทองเหลือง (เนื้อแดง)', category: 'ทองเหลือง' },
      { productId: 'prod_mqgp9cgafv9ts0i3ze22h1vb', newName: 'แสตนเลส 304 (ยาว)', category: 'แสตนเลส' },
      { productId: 'prod_mqgp9csvq0takfp04k5d2dv6', newName: 'อลูมิเนียมสายไฟ', category: 'อลูมิเนียม' },
      { productId: 'prod_mqgp9cyrr65cu9xaams1daoh', newName: 'อลูมิเนียมฉาก', category: 'อลูมิเนียม' },
      { productId: 'prod_mqgp9d5g7uiu7tttxza864tp', newName: 'อลูมิเนียมบาง', category: 'อลูมิเนียม' },
      { productId: 'prod_mqgp9dbqtfx0j3mnsbl9mwix', newName: 'อลูมิเนียมอัลลอยด์', category: 'อลูมิเนียม' },
      { productId: 'prod_mqgp9dhn9ryniksnud8q714g', newName: 'อลูมิเนียมล้อแม็ค', category: 'อลูมิเนียม' },
      { productId: 'prod_mqgp9do7ui6p53xv2tbjq7tb', newName: 'อลูมิเนียมหล่อ', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9duo294uh2l320pbg1ru', newName: 'อลูมิเneียมกระป๋อง', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9e0y2ehae94h2mw403ns', newName: 'อลูมิเneียมฝาแกะ', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9e6yxtg3mo8mf998qnf6', newName: 'อลูมิเneียมกะทะ', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9edcxnxkocxfu0odbayj', newName: 'อลูมิเneียมตูดกะทะ', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9ejcaz0g567zocy5ub8j', newName: 'หม้อน้ำอลูมีเneียม', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9epjox7up6c2k8jrf289', newName: 'ฝาเนียมเผา', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9ew9ar8ckyjn69mr8aq2', newName: 'ตูดหม้อหุงข้าว', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9f3wvar7pgyoek1zen5k', newName: 'ตูดกะทะไฟฟ้าล้วน', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9fa7fylab8ztuya98a9p', newName: 'อลูมิเneียมฉากสี', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9fgoheos0xee1ntl0r27', newName: 'อลูมีเneียมเครื่อง', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9fmounwsgwm9xyso0phf', newName: 'อลูมีเneียมครีบหม้อน้ำ', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9fsl7s0haidcn5c9t4ee', newName: 'อลูมิเneียมมุ้งลวด', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9fz6pqfgrkxoh5nbgchi', newName: 'อลูมิเneียมมู่ลี่', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9g5d78sw9tuoeuem3i1b', newName: 'อลูมิเneียมเพลท', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9gh81ao3300v6dhcei3x', newName: 'กระป๋องสเปรย์', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9gn9lfu942el9hx2undl', newName: 'ปั้มกระป๋อง', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9gt8ki5lcwu67ps55equ', newName: 'ฟรอยไม่ติดพลาสติก', category: 'อลูมิเneียม' },
      { productId: 'prod_mqgp9hpqehz5267b46pxo5ic', newName: 'มอเตอร์', category: 'อื่นๆ' },
      { productId: 'prod_mqgp9hwdo411xly6wmmeyg86', newName: 'คอมดำ', category: 'อื่นๆ' },
    ];

    let productsRenamed = 0;
    let productsRenameSkipped = 0;

    for (const r of RENAME_MAP) {
      const product = await db.product.findUnique({ where: { id: r.productId } });
      if (!product) {
        productsRenameSkipped++;
        continue;
      }
      if (product.name === r.newName) {
        productsRenameSkipped++;
        continue;
      }
      const conflict = await db.product.findUnique({ where: { name: r.newName } });
      if (conflict && conflict.id !== r.productId) {
        productsRenameSkipped++;
        continue;
      }
      const categoryId = categoryMap[r.category];
      if (!DRY_RUN) {
        await db.product.update({
          where: { id: r.productId },
          data: { name: r.newName, categoryId },
        });
      }
      productsRenamed++;
    }

    // === CREATE NEW PRODUCTS (57) ===
    const NEW_PRODUCTS = [
      { name: 'เหล็กหนาพิเศษยาว', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กเส้น 5 หุน', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กเส้น 6 หุน (1.8m ขึ้นไป)', category: 'เหล็ก', defaultBuyPrice: 14.8 },
      { name: 'เหล็กเส้น 1 นิ้ว (1mขึ้นไป)', category: 'เหล็ก', defaultBuyPrice: 15 },
      { name: 'ขี้กลึงเหล็ก', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'โช๊ค', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'ปั๊มสังกะสี', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'ปั๊มบาง', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'ปั๊มหนา', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กเส้น3-4หุน', category: 'เหล็ก', defaultBuyPrice: 11 },
      { name: 'อะไหล่', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'แหนบ', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กบางยาว', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กลวดรถ', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กคัดขาย', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เบิกใช้งานต่างๆในบริษัท', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เมทัลชีส(มือสอง)', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'เหล็กคัดใช้งาน', category: 'เหล็ก', defaultBuyPrice: 0 },
      { name: 'อลูมิเneียมผ้าเบรค', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'อลูมิเneียมกะทะไฟฟ้า', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'กระทะดำ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'อลูมิเneียมฝาไม่แกะ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'อลูมิเneียมแผ่นเพจ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'อลูมิเneียมติดเหล็ก', category: 'อลูมิเneียม', defaultBuyPrice: 19 },
      { name: 'สายไฟอลูมีเneียม(ไม่ปอก)', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'ขี้กลึงอลูมิเneียม', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'หนาติดสี', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'หนาลูกสูบ', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'หนาก้ามเบรค', category: 'อลูมิเneียม', defaultBuyPrice: 0 },
      { name: 'ทองแดงติดเหล็ก', category: 'ทองแดง', defaultBuyPrice: 0 },
      { name: 'ทองแดงเกินจาก ST', category: 'ทองแดง', defaultBuyPrice: 0 },
      { name: 'ทองแดงขาดจาก ST', category: 'ทองแดง', defaultBuyPrice: 0 },
      { name: 'ทองแดงเส้นเล็ก(ไม่ชุบ)', category: 'ทองแดง', defaultBuyPrice: 0 },
      { name: 'ทองแดงท่อCandy', category: 'ทองแดง', defaultBuyPrice: 0 },
      { name: 'ทองเหลืองติดเหล็ก', category: 'ทองเหลือง', defaultBuyPrice: 0 },
      { name: 'ทองเหลืองเนื้อแดงติดเหล็ก', category: 'ทองเหลือง', defaultBuyPrice: 0 },
      { name: 'ทองเหลืองเกินจาก ST', category: 'ทองเหลือง', defaultBuyPrice: 0 },
      { name: 'ทองเหลืองขาดจาก ST', category: 'ทองเหลือง', defaultBuyPrice: 0 },
      { name: 'แสตนเลสติดเหล็ก', category: 'แสตนเลส', defaultBuyPrice: 0 },
      { name: 'นิกเกิล(สแตนเลส)', category: 'แสตนเลส', defaultBuyPrice: 0 },
      { name: 'ขี้กลึงสแตนเลส304', category: 'แสตนเลส', defaultBuyPrice: 0 },
      { name: 'แบตเตอรี่ขาว', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
      { name: 'แบตเตอรี่ดำ', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
      { name: 'แบตเตอรี่เล็ก', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
      { name: 'แบตเตอรี่มอไซต์', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
      { name: 'แท็บเล็ต', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
      { name: 'พวงแผงวงจรติดสายไฟ', category: 'อิเล็กทรอนิกส์', defaultBuyPrice: 0 },
      { name: 'สายไฟไม่ปอก', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'เปลือกสายไฟ', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'ขยะ', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'สูญเสีย', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'กระสอบขาด', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'น้ำม้นเก่า', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'นิกเกิล', category: 'อื่นๆ', defaultBuyPrice: 550 },
      { name: 'แผงวงจรเขียว', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'ของแกะราคาสูง', category: 'อื่นๆ', defaultBuyPrice: 0 },
      { name: 'พลาสติกรวม', category: 'พลาสติก', defaultBuyPrice: 0 },
    ];

    let productsCreated = 0;
    let productsCreateSkipped = 0;
    let sortOrder = (await db.product.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? -1;
    sortOrder++;

    for (const p of NEW_PRODUCTS) {
      const existing = await db.product.findUnique({ where: { name: p.name } });
      if (existing) {
        productsCreateSkipped++;
        continue;
      }
      const categoryId = categoryMap[p.category];
      if (!categoryId) {
        productsCreateSkipped++;
        continue;
      }
      if (!DRY_RUN) {
        await db.product.create({
          data: { name: p.name, defaultBuyPrice: p.defaultBuyPrice, categoryId, sortOrder: sortOrder++ },
        });
      }
      productsCreated++;
    }

    // === NOT-KEPT PRODUCTS (report only — no delete) ===
    const NOT_KEPT = [
      { productId: 'prod_mqgp9b3h7g448yu1xgzuu4pr', name: 'ทองแดงพิเศษ', reason: 'Owner: do not keep' },
      { productId: 'prod_mqgp9gbfgywdc71yyps4y1ke', name: 'มุ้งลวด', reason: 'Owner: use อลูมิเneียมมุ้งลวด instead' },
    ];

    const notKeptReport: Array<{
      productId: string; name: string; reason: string; found: boolean;
      hasStock?: boolean; hasHistory?: boolean;
      stockLots?: number; buyItems?: number; sellItems?: number; sortItems?: number;
      action?: string;
    }> = [];
    for (const nk of NOT_KEPT) {
      const product = await db.product.findUnique({ where: { id: nk.productId } });
      if (!product) { notKeptReport.push({ ...nk, found: false }); continue; }
      const stockLots = await db.stockLot.count({ where: { productId: nk.productId, remainingWeight: { gt: 0 } } });
      const buyItems = await db.buyBillItem.count({ where: { productId: nk.productId } });
      const sellItems = await db.sellBillItem.count({ where: { productId: nk.productId } });
      const sortItems = await db.sortingBillItem.count({ where: { productId: nk.productId } });
      notKeptReport.push({
        ...nk,
        found: true,
        hasStock: stockLots > 0,
        hasHistory: buyItems + sellItems + sortItems > 0,
        stockLots, buyItems, sellItems, sortItems,
        action: 'LEFT IN DB — Product model has no isActive field',
      });
    }

    // === AFTER COUNTS ===
    const after = {
      products: await db.product.count(),
      categories: await db.productCategory.count(),
      stockLots: await db.stockLot.count(),
      buyItems: await db.buyBillItem.count(),
      sellItems: await db.sellBillItem.count(),
      sortItems: await db.sortingBillItem.count(),
    };

    return NextResponse.json({
      success: true,
      mode: DRY_RUN ? 'DRY_RUN' : 'PRODUCTION',
      before,
      after,
      verification: {
        stockLotsUnchanged: before.stockLots === after.stockLots,
        buyItemsUnchanged: before.buyItems === after.buyItems,
        sellItemsUnchanged: before.sellItems === after.sellItems,
        sortItemsUnchanged: before.sortItems === after.sortItems,
      },
      summary: {
        categoriesCreated,
        categoriesExisted,
        productsRenamed,
        productsRenameSkipped,
        productsCreated,
        productsCreateSkipped,
        notKeptProducts: notKeptReport,
      },
    });
  } catch (error) {
    console.error('Product sync error:', error);
    return NextResponse.json(
      { error: 'Sync failed: ' + (error instanceof Error ? error.message : 'unknown') },
      { status: 500 }
    );
  }
}
