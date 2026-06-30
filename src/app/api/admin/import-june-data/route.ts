import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

// POST /api/admin/import-june-data — Admin-only one-time import + cleanup
// Requires:
//   1. Authorization: Bearer <token> (authenticated)
//   2. payload.role === 'admin'
//   3. X-CONFIRM-IMPORT: JUNE_2569_DATA header
//   4. Body: { "dryRun": true } (default) or { "dryRun": false }

// Phases:
//   1. Import BUY summary data (7 bills)
//   2. Import SELL summary data (5 bills)
//   3. Import SELL detail data (6 bills)
//   4. Cleanup TEST data (16 BuyBills + 6 SellBills + 8 SortingBills)

// Manual product mapping for spelling differences
const MANUAL_MAP: Record<string, string> = {
  'เหล็กหนา(สปอร์ต)': 'เหล็กหนาสั้น',
  'อลูมิเนียมกระป๋อง': 'กระป๋องอลูมีเนียม',
  'อลูมิเนียมล้อแม็ค': 'อลูมีเนียมล้อแม๊กซ์',
  'อลูมิเนียมแข็ง': 'อลูมีเนียมแข็ง',
  'อลูมิเนียมตูดกะทะ': 'อลูมีเนียมตูดกะทะ',
  'อลูมิเนียมฝาแกะ': 'ฝาอลูมีเนียมเนียม',
  'อลูมิเนียมติดเหล็ก': 'อลูมิเนียมติดเหล็ก',
  'อลูมิเนียมมุ้งลวด': 'อลูมีเนียมมุ้งลวด',
  'อลูมิเนียมหล่อ': 'อลูมีเนียมแข็ง',
  'สายไฟอลูมีเนียม(ไม่ปอก)': 'สายไฟอลูมีเนียม(ไม่ปอก)',
  'อลูมิเนียมอัลลอยด์': 'อลูมีเนียมอัลลอย',
  'อลูมิเนียมมู่ลี่': 'อลูมีเนียมมู่ลี่',
  'หนาติดสี': 'หนาติดสี',
};

const norm = (s: string) => s
  .replace(/\s+/g, '')
  .replace(/[(),[\].,]/g, '')
  // Normalize Thai vowel marks: replace ี (sara ii, U+0E35) with ิ (sara i, U+0E34)
  // This handles the อลูมิเนียม vs อลูมีเนียม spelling difference
  .replace(/\u0E35/g, '\u0E34')
  .toLowerCase();

function matchProduct(excelName: string, products: Array<{ id: string; name: string }>): string | null {
  // Check manual map first
  if (MANUAL_MAP[excelName]) {
    const mapped = MANUAL_MAP[excelName];
    const found = products.find(p => p.name === mapped);
    if (found) return found.id;
    // Try normalized match for manual map value
    const mappedNorm = norm(mapped);
    for (const p of products) {
      if (norm(p.name) === mappedNorm) return p.id;
    }
  }
  const excelNorm = norm(excelName);
  // Exact normalized match
  for (const p of products) {
    if (norm(p.name) === excelNorm) return p.id;
  }
  // Contains match (either direction) — but only if both are at least 4 chars to avoid false positives
  if (excelNorm.length >= 4) {
    for (const p of products) {
      const pNorm = norm(p.name);
      if (pNorm.length >= 4 && (pNorm.includes(excelNorm) || excelNorm.includes(pNorm))) return p.id;
    }
  }
  return null;
}

function parseThaiDate(s: string): string | null {
  if (!s) return null;
  const parts = s.trim().split(/[\/\-\.]/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  if (year > 2500) year -= 543;
  if (year < 100) year += 2000;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const num = (v: unknown): number => {
  const s = String(v ?? '').replace(/,/g, '').trim();
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};

export async function POST(request: NextRequest) {
  const startTime = Date.now();

  // Auth check
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
  if (payload.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

  // Confirmation header
  const confirmHeader = request.headers.get('X-CONFIRM-IMPORT');
  if (confirmHeader !== 'JUNE_2569_DATA') {
    return NextResponse.json({ error: 'Missing X-CONFIRM-IMPORT: JUNE_2569_DATA header' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const DRY_RUN = body.dryRun !== false;

  try {
    // === BEFORE COUNTS ===
    const [beforeProducts, beforeCategories, beforeBuyBills, beforeSellBills, beforeSortBills, beforeStockLots] = await Promise.all([
      db.product.count(), db.productCategory.count(),
      db.buyBill.count(), db.sellBill.count(), db.sortingBill.count(),
      db.stockLot.count(),
    ]);

    // Get all products for matching
    const allProducts = await db.product.findMany({ select: { id: true, name: true } });

    // Pre-fetch all stock lots in one query for stock validation
    const allStockLots = await db.stockLot.findMany({
      where: { remainingWeight: { gt: 0 } },
      select: { productId: true, remainingWeight: true, costPerKg: true, id: true, dateAdded: true },
      orderBy: { dateAdded: 'asc' },
    });

    // Build in-memory stock map: productId → total available
    const stockMap = new Map<string, number>();
    for (const lot of allStockLots) {
      stockMap.set(lot.productId, (stockMap.get(lot.productId) || 0) + lot.remainingWeight);
    }

    // Helper: check stock availability in-memory
    function checkStock(productId: string, weight: number): boolean {
      const available = stockMap.get(productId) || 0;
      return available >= weight;
    }

    // Helper: deduct stock in-memory (for dry-run simulation)
    function deductStock(productId: string, weight: number): void {
      const current = stockMap.get(productId) || 0;
      stockMap.set(productId, Math.max(0, current - weight));
    }

    // === BUY SUMMARY DATA ===
    // Hardcoded from Excel parse — 7 sheets, 148 rows (123 matched, 25 unmatched→mapped via MANUAL_MAP)
    const BUY_DATA: Array<{
      sheet: string; fromDate: string; toDate: string;
      items: Array<{ code: string; name: string; weight: number; totalAmount: number; avgPrice: number }>;
    }> = [
      {
        sheet: 'ซื้อ 1-20 06 2569', fromDate: '2026-06-01', toDate: '2026-06-20',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 29120, totalAmount: 290544.8, avgPrice: 9.98 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 60868.3, totalAmount: 573297.51, avgPrice: 9.42 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 44029.9, totalAmount: 398368.83, avgPrice: 9.05 },
          { code: '0105', name: 'เหล็กคละ', weight: 4414.3, totalAmount: 40315.92, avgPrice: 9.13 },
          { code: '0106', name: 'เหล็กบาง', weight: 31499.3, totalAmount: 278861.64, avgPrice: 8.85 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 5275.4, totalAmount: 31960.38, avgPrice: 6.06 },
          { code: '0108', name: 'สังกะสี', weight: 1103, totalAmount: 5853.1, avgPrice: 5.31 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 500, totalAmount: 5250, avgPrice: 10.5 },
          { code: '0115', name: 'เหล็กหล่อ (ชิ้นใหญ่)', weight: 3230, totalAmount: 31757, avgPrice: 9.83 },
          { code: '0116', name: 'ถัง 15ถึง200 ลิตร', weight: 5763.7, totalAmount: 50389.64, avgPrice: 8.74 },
          { code: '0117', name: 'โช๊ค', weight: 0.9, totalAmount: 6.75, avgPrice: 7.5 },
          { code: '0124', name: 'เครื่องจักร', weight: 59443.1, totalAmount: 541744.2, avgPrice: 9.11 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 20073, totalAmount: 170730.8, avgPrice: 8.51 },
          { code: '0201', name: 'อลูมิเนียมกระป๋อง', weight: 379.6, totalAmount: 32326.9, avgPrice: 85.16 },
          { code: '0202', name: 'อลูมิเนียมล้อแม็ค', weight: 66.2, totalAmount: 6329.8, avgPrice: 95.62 },
          { code: '0203', name: 'อลูมิเนียมสายไฟ', weight: 2.8, totalAmount: 305, avgPrice: 108.93 },
          { code: '0204', name: 'อลูมิเนียมบาง', weight: 613.6, totalAmount: 46269.1, avgPrice: 75.41 },
          { code: '0205', name: 'อลูมิเนียมแข็ง', weight: 210.8, totalAmount: 16474.7, avgPrice: 78.15 },
          { code: '0210', name: 'อลูมิเนียมตูดกะทะ', weight: 52.2, totalAmount: 2873.9, avgPrice: 55.06 },
          { code: '0213', name: 'อลูมิเนียมฝาแกะ', weight: 5.2, totalAmount: 321.8, avgPrice: 61.88 },
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 49, totalAmount: 4963.6, avgPrice: 101.3 },
          { code: '0216', name: 'หม้อน้ำอลูมีเนียม', weight: 25.3, totalAmount: 1563.2, avgPrice: 61.79 },
          { code: '0218', name: 'อลูมีเนียมครีบหม้อน้ำ', weight: 1.4, totalAmount: 47.6, avgPrice: 34 },
          { code: '0227', name: 'อลูมิเนียมติดเหล็ก', weight: 21, totalAmount: 1554, avgPrice: 74 },
          { code: '0231', name: 'อลูมิเนียมฉากสี', weight: 17.9, totalAmount: 1683.6, avgPrice: 94.06 },
          { code: '0301', name: 'ทองแดงปอกเงา', weight: 184.8, totalAmount: 78660.6, avgPrice: 425.65 },
          { code: '0302', name: 'ทองแดงปอกช็อต', weight: 171.6, totalAmount: 71456.7, avgPrice: 416.41 },
          { code: '0303', name: 'ทองแดงใหญ่', weight: 325.5, totalAmount: 130278.6, avgPrice: 400.24 },
          { code: '0304', name: 'ทองแดงเส้นเล็ก', weight: 119.3, totalAmount: 47394.1, avgPrice: 397.27 },
          { code: '0306', name: 'หม้อน้ำไส้ทองแดง', weight: 292.4, totalAmount: 58520.4, avgPrice: 200.14 },
          { code: '0308', name: 'แดงชุบ', weight: 1.8, totalAmount: 673.2, avgPrice: 374 },
          { code: '0309', name: 'ทองแดงเกินจาก ST', weight: 3.5, totalAmount: 0, avgPrice: 0 },
          { code: '0401', name: 'ทองเหลืองหนา', weight: 126.9, totalAmount: 33160.9, avgPrice: 261.32 },
          { code: '0404', name: 'หม้อน้ำทองเหลือง', weight: 95.5, totalAmount: 22156, avgPrice: 232 },
          { code: '0408', name: 'ทองเหลืองเกินจาก ST', weight: 1.6, totalAmount: 0, avgPrice: 0 },
          { code: '0501', name: 'แสตนเลส 304', weight: 348.8, totalAmount: 13375.3, avgPrice: 38.35 },
          { code: '0502', name: 'แสตนเลส 202', weight: 41.8, totalAmount: 542, avgPrice: 12.97 },
          { code: '0504', name: 'แสตนเลส 304 (ยาว)', weight: 567.2, totalAmount: 21390.2, avgPrice: 37.71 },
          { code: '0601', name: 'ตะกั่วนิ่ม', weight: 1.3, totalAmount: 61.1, avgPrice: 47 },
          { code: '0602', name: 'ตะกั่วแข็ง', weight: 54.6, totalAmount: 3766.9, avgPrice: 68.99 },
          { code: '0802', name: 'ของแกะ', weight: 73, totalAmount: 964.4, avgPrice: 13.21 },
          { code: '0803', name: 'คอมดำ', weight: 38.6, totalAmount: 849.2, avgPrice: 22 },
          { code: '0804', name: 'สายไฟไม่ปอก', weight: 18.2, totalAmount: 1174, avgPrice: 64.51 },
          { code: '0816', name: 'ของแกะราคาสูง', weight: 2.5, totalAmount: 425, avgPrice: 170 },
        ],
      },
      {
        sheet: 'ซื้อ 23-6-2569', fromDate: '2026-06-23', toDate: '2026-06-23',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 1250, totalAmount: 12625, avgPrice: 10.1 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 2177.3, totalAmount: 20459.47, avgPrice: 9.4 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 380, totalAmount: 3500, avgPrice: 9.21 },
          { code: '0105', name: 'เหล็กคละ', weight: 300, totalAmount: 2670, avgPrice: 8.9 },
          { code: '0106', name: 'เหล็กบาง', weight: 480, totalAmount: 4200, avgPrice: 8.75 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 250, totalAmount: 1500, avgPrice: 6 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 50, totalAmount: 500, avgPrice: 10 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 550, totalAmount: 4400, avgPrice: 8 },
          { code: '0204', name: 'อลูมิเนียมบาง', weight: 18.5, totalAmount: 1313.5, avgPrice: 71 },
          { code: '0205', name: 'อลูมิเนียมแข็ง', weight: 7.7, totalAmount: 585.2, avgPrice: 76 },
          { code: '0210', name: 'อลูมิเนียมตูดกะทะ', weight: 1.6, totalAmount: 81.6, avgPrice: 51 },
          { code: '0303', name: 'ทองแดงใหญ่', weight: 0.4, totalAmount: 160, avgPrice: 400 },
          { code: '0404', name: 'หม้อน้ำทองเหลือง', weight: 5.5, totalAmount: 1276, avgPrice: 232 },
          { code: '0802', name: 'ของแกะ', weight: 25.5, totalAmount: 262.65, avgPrice: 10.3 },
          { code: '0803', name: 'คอมดำ', weight: 0.5, totalAmount: 12.5, avgPrice: 25 },
        ],
      },
      {
        sheet: 'ซื้อ 24-6-2569', fromDate: '2026-06-24', toDate: '2026-06-24',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 3760, totalAmount: 37600, avgPrice: 10 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 6241.2, totalAmount: 58730.18, avgPrice: 9.41 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 800, totalAmount: 7200, avgPrice: 9 },
          { code: '0105', name: 'เหล็กคละ', weight: 500, totalAmount: 4500, avgPrice: 9 },
          { code: '0106', name: 'เหล็กบาง', weight: 600, totalAmount: 5280, avgPrice: 8.8 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 300, totalAmount: 1800, avgPrice: 6 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 80, totalAmount: 800, avgPrice: 10 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 620, totalAmount: 4960, avgPrice: 8 },
          { code: '0203', name: 'อลูมิเนียมสายไฟ', weight: 0.3, totalAmount: 31.5, avgPrice: 105 },
          { code: '0204', name: 'อลูมิเนียมบาง', weight: 22, totalAmount: 1595, avgPrice: 72.5 },
          { code: '0205', name: 'อลูมิเนียมแข็ง', weight: 38, totalAmount: 2888, avgPrice: 76 },
          { code: '0211', name: 'อลูมิเนียมมุ้งลวด', weight: 0.2, totalAmount: 3.4, avgPrice: 17 },
          { code: '0303', name: 'ทองแดงใหญ่', weight: 0.6, totalAmount: 240, avgPrice: 400 },
        ],
      },
      {
        sheet: 'ซื้อ 25-6-2569', fromDate: '2026-06-25', toDate: '2026-06-25',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 5730, totalAmount: 56727, avgPrice: 9.9 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 3980, totalAmount: 37412, avgPrice: 9.4 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 1200, totalAmount: 10800, avgPrice: 9 },
          { code: '0105', name: 'เหล็กคละ', weight: 700, totalAmount: 6300, avgPrice: 9 },
          { code: '0106', name: 'เหล็กบาง', weight: 900, totalAmount: 7920, avgPrice: 8.8 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 400, totalAmount: 2400, avgPrice: 6 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 100, totalAmount: 1000, avgPrice: 10 },
          { code: '0115', name: 'เหล็กหล่อ (ชิ้นใหญ่)', weight: 300, totalAmount: 2940, avgPrice: 9.8 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 800, totalAmount: 6400, avgPrice: 8 },
          { code: '0201', name: 'อลูมิเนียมกระป๋อง', weight: 4.9, totalAmount: 381.8, avgPrice: 77.92 },
          { code: '0205', name: 'อลูมิเนียมหล่อ', weight: 9.3, totalAmount: 706.8, avgPrice: 76 },
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 5.6, totalAmount: 560, avgPrice: 100 },
          { code: '0228', name: 'สายไฟอลูมีเนียม(ไม่ปอก)', weight: 3.8, totalAmount: 76, avgPrice: 20 },
          { code: '0302', name: 'ทองแดงปอกช็อต', weight: 0.5, totalAmount: 200, avgPrice: 400 },
          { code: '0303', name: 'ทองแดงใหญ่', weight: 0.8, totalAmount: 320, avgPrice: 400 },
          { code: '0401', name: 'ทองเหลืองหนา', weight: 2, totalAmount: 520, avgPrice: 260 },
        ],
      },
      {
        sheet: 'ซื้อ 26-6-2569', fromDate: '2026-06-26', toDate: '2026-06-26',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 3850, totalAmount: 38115, avgPrice: 9.9 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 4000, totalAmount: 37600, avgPrice: 9.4 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 950, totalAmount: 8550, avgPrice: 9 },
          { code: '0105', name: 'เหล็กคละ', weight: 550, totalAmount: 4950, avgPrice: 9 },
          { code: '0106', name: 'เหล็กบาง', weight: 750, totalAmount: 6600, avgPrice: 8.8 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 350, totalAmount: 2100, avgPrice: 6 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 70, totalAmount: 700, avgPrice: 10 },
          { code: '0115', name: 'เหล็กหล่อ (ชิ้นใหญ่)', weight: 250, totalAmount: 2450, avgPrice: 9.8 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 600, totalAmount: 4800, avgPrice: 8 },
          { code: '0124', name: 'เครื่องจักร', weight: 150, totalAmount: 1350, avgPrice: 9 },
          { code: '0201', name: 'อลูมิเนียมกระป๋อง', weight: 66.7, totalAmount: 5373.5, avgPrice: 80.56 },
          { code: '0203', name: 'อลูมิเนียมสายไฟ', weight: 1.2, totalAmount: 126, avgPrice: 105 },
          { code: '0204', name: 'อลูมิเนียมบาง', weight: 28.5, totalAmount: 2052, avgPrice: 72 },
          { code: '0205', name: 'อลูมิเนียมหล่อ', weight: 15.7, totalAmount: 1058.1, avgPrice: 67.4 },
          { code: '0213', name: 'อลูมิเนียมฝาแกะ', weight: 1.2, totalAmount: 67.2, avgPrice: 56 },
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 10.5, totalAmount: 1050, avgPrice: 100 },
          { code: '0221', name: 'อลูมิเนียมอัลลอยด์', weight: 2.2, totalAmount: 105.6, avgPrice: 48 },
          { code: '0231', name: 'อลูมิเนียมฉากสี', weight: 8.4, totalAmount: 747.6, avgPrice: 89 },
          { code: '0301', name: 'ทองแดงปอกเงา', weight: 1.5, totalAmount: 630, avgPrice: 420 },
          { code: '0303', name: 'ทองแดงใหญ่', weight: 0.8, totalAmount: 320, avgPrice: 400 },
          { code: '0306', name: 'หม้อน้ำไส้ทองแดง', weight: 1.2, totalAmount: 240, avgPrice: 200 },
          { code: '0401', name: 'ทองเหลืองหนา', weight: 3.5, totalAmount: 910, avgPrice: 260 },
          { code: '0404', name: 'หม้อน้ำทองเหลือง', weight: 2, totalAmount: 464, avgPrice: 232 },
          { code: '0501', name: 'แสตนเลส 304', weight: 50, totalAmount: 1900, avgPrice: 38 },
          { code: '0802', name: 'ของแกะ', weight: 22, totalAmount: 220, avgPrice: 10 },
          { code: '0803', name: 'คอมดำ', weight: 0.8, totalAmount: 20, avgPrice: 25 },
        ],
      },
      {
        sheet: 'ซื้อ 27-6-2569', fromDate: '2026-06-27', toDate: '2026-06-27',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 2500, totalAmount: 24750, avgPrice: 9.9 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 3200, totalAmount: 30080, avgPrice: 9.4 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 600, totalAmount: 5400, avgPrice: 9 },
          { code: '0105', name: 'เหล็กคละ', weight: 400, totalAmount: 3600, avgPrice: 9 },
          { code: '0106', name: 'เหล็กบาง', weight: 500, totalAmount: 4400, avgPrice: 8.8 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 200, totalAmount: 1200, avgPrice: 6 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 50, totalAmount: 500, avgPrice: 10 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 450, totalAmount: 3600, avgPrice: 8 },
          { code: '0124', name: 'เครื่องจักร', weight: 100, totalAmount: 900, avgPrice: 9 },
          { code: '0201', name: 'อลูมิเนียมกระป๋อง', weight: 38.4, totalAmount: 2902, avgPrice: 75.57 },
          { code: '0205', name: 'อลูมิเนียมหล่อ', weight: 73, totalAmount: 4535.2, avgPrice: 62.13 },
          { code: '0210', name: 'อลูมิเนียมตูดกะทะ', weight: 2.8, totalAmount: 121.5, avgPrice: 43.39 },
          { code: '0212', name: 'อลูมิเนียมมู่ลี่', weight: 7.2, totalAmount: 280.8, avgPrice: 39 },
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 6, totalAmount: 600, avgPrice: 100 },
          { code: '0301', name: 'ทองแดงปอกเงา', weight: 2.5, totalAmount: 1050, avgPrice: 420 },
          { code: '0302', name: 'ทองแดงปอกช็อต', weight: 1.2, totalAmount: 480, avgPrice: 400 },
          { code: '0401', name: 'ทองเหลืองหนา', weight: 4, totalAmount: 1040, avgPrice: 260 },
          { code: '0404', name: 'หม้อน้ำทองเหลือง', weight: 3, totalAmount: 696, avgPrice: 232 },
          { code: '0501', name: 'แสตนเลส 304', weight: 80, totalAmount: 3040, avgPrice: 38 },
          { code: '0602', name: 'ตะกั่วแข็ง', weight: 3, totalAmount: 207, avgPrice: 69 },
          { code: '0802', name: 'ของแกะ', weight: 15, totalAmount: 150, avgPrice: 10 },
          { code: '0803', name: 'คอมดำ', weight: 0.5, totalAmount: 12.5, avgPrice: 25 },
        ],
      },
      {
        sheet: 'ซื้อ 29-6-2569', fromDate: '2026-06-29', toDate: '2026-06-29',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 3500, totalAmount: 34650, avgPrice: 9.9 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 2800, totalAmount: 26320, avgPrice: 9.4 },
          { code: '0104', name: 'เหล็กหนา(ยาว)', weight: 700, totalAmount: 6300, avgPrice: 9 },
          { code: '0105', name: 'เหล็กคละ', weight: 450, totalAmount: 4050, avgPrice: 9 },
          { code: '0106', name: 'เหล็กบาง', weight: 600, totalAmount: 5280, avgPrice: 8.8 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 250, totalAmount: 1500, avgPrice: 6 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 500, totalAmount: 4000, avgPrice: 8 },
          { code: '0124', name: 'เครื่องจักร', weight: 80, totalAmount: 720, avgPrice: 9 },
          { code: '0205', name: 'อลูมิเนียมหล่อ', weight: 41, totalAmount: 2987.7, avgPrice: 72.87 },
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 5, totalAmount: 500, avgPrice: 100 },
          { code: '0301', name: 'ทองแดงปอกเงา', weight: 2, totalAmount: 840, avgPrice: 420 },
          { code: '0404', name: 'หม้อน้ำทองเหลือง', weight: 2, totalAmount: 464, avgPrice: 232 },
        ],
      },
    ];

    // === SELL SUMMARY DATA ===
    const SELL_SUMMARY_DATA: Array<{
      sheet: string; fromDate: string; toDate: string;
      items: Array<{ code: string; name: string; weight: number; totalAmount: number; avgPrice: number }>;
    }> = [
      {
        sheet: 'ขาย 1-20 06 2569', fromDate: '2026-06-01', toDate: '2026-06-20',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 116895, totalAmount: 1263750, avgPrice: 10.81 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 114345, totalAmount: 1222878.4, avgPrice: 10.69 },
          { code: '0106', name: 'เหล็กบาง', weight: 58275, totalAmount: 589715, avgPrice: 10.12 },
          { code: '0107', name: 'กระป๋อง,ปี๊บ', weight: 12.4, totalAmount: 80.1, avgPrice: 6.46 },
          { code: '0108', name: 'สังกะสี', weight: 9310, totalAmount: 61446, avgPrice: 6.6 },
          { code: '0114', name: 'เหล็กหล่อชิ้นเล็ก', weight: 31470, totalAmount: 292022.2, avgPrice: 9.28 },
          { code: '0124', name: 'เครื่องจักร', weight: 1470, totalAmount: 13230, avgPrice: 9 },
          { code: '0199', name: 'เหล็กคัดใช้งาน', weight: 359, totalAmount: 18094.9, avgPrice: 50.4 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 30240, totalAmount: 311119.5, avgPrice: 10.29 },
          { code: '0301', name: 'ทองแดงปอกเงา', weight: 273.5, totalAmount: 123818.5, avgPrice: 452.72 },
          { code: '0302', name: 'ทองแดงปอกช็อต', weight: 62.9, totalAmount: 29227.5, avgPrice: 464.67 },
          { code: '0303', name: 'ทองแดงใหญ่', weight: 274.3, totalAmount: 115717.5, avgPrice: 421.86 },
          { code: '0304', name: 'ทองแดงเส้นเล็ก', weight: 127.3, totalAmount: 54252, avgPrice: 426.17 },
          { code: '0308', name: 'แดงชุบ', weight: 11.3, totalAmount: 2346, avgPrice: 207.61 },
        ],
      },
      {
        sheet: 'ขาย 25-6-2569', fromDate: '2026-06-25', toDate: '2026-06-25',
        items: [
          { code: '0201', name: 'อลูมิเนียมกระป๋อง', weight: 770, totalAmount: 65450, avgPrice: 85 },
        ],
      },
      {
        sheet: 'ขาย 26-6-2569', fromDate: '2026-06-26', toDate: '2026-06-26',
        items: [
          { code: '0115', name: 'เหล็กหล่อ (ชิ้นใหญ่)', weight: 10725, totalAmount: 140497.5, avgPrice: 13.1 },
        ],
      },
      {
        sheet: 'ขาย 27-6-2569', fromDate: '2026-06-27', toDate: '2026-06-27',
        items: [
          { code: '0101', name: 'เหล็กหนาพิเศษ', weight: 11780, totalAmount: 129580, avgPrice: 11 },
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 14000, totalAmount: 147000, avgPrice: 10.5 },
          { code: '0106', name: 'เหล็กบาง', weight: 3500, totalAmount: 38500, avgPrice: 11 },
          { code: '0115', name: 'เหล็กหล่อ (ชิ้นใหญ่)', weight: 800, totalAmount: 10400, avgPrice: 13 },
          { code: '0205', name: 'อลูมิเนียมหล่อ', weight: 198.4, totalAmount: 15108, avgPrice: 76.15 },
          { code: '0200', name: 'เหล็กสลิง,สแตน', weight: 75.5, totalAmount: 755, avgPrice: 10 },
        ],
      },
      {
        sheet: 'ขาย 29-6-2569', fromDate: '2026-06-29', toDate: '2026-06-29',
        items: [
          { code: '0103', name: 'เหล็กหนา(สปอร์ต)', weight: 2, totalAmount: 30, avgPrice: 15 },
        ],
      },
    ];

    // === SELL DETAIL DATA ===
    const SELL_DETAIL_DATA: Array<{
      customer: string; date: string; vehiclePlate: string; note: string;
      items: Array<{ code: string; name: string; weight: number; pricePerKg: number }>;
    }> = [
      {
        customer: 'ลูกค้าทั่วไป', date: '2026-06-23', vehiclePlate: 'A2007605', note: '7 15.16',
        items: [{ code: '0199', name: 'เหล็กคัดใช้งาน', weight: 0.7, pricePerKg: 42.86 }],
      },
      {
        customer: 'ลูกค้าทั่วไป', date: '2026-06-24', vehiclePlate: 'A2007608', note: '12 13.09',
        items: [{ code: '0198', name: 'เมทัลชีส(มือสอง)', weight: 285, pricePerKg: 17 }],
      },
      {
        customer: 'ร้าน เอส.เอ็ม.เอ รีไซเคิล (สมพร)', date: '2026-06-23', vehiclePlate: 'A2007604', note: '23 12.49 พขร กรกนก น้อยพินิจ ทบ ตจ2599 ยงเฮง',
        items: [
          { code: '0202', name: 'อลูมิเนียมล้อแม็ค', weight: 74.6, pricePerKg: 100.99 },
          { code: '0203', name: 'อลูมิเนียมสายไฟ', weight: 398.4, pricePerKg: 112.26 },
          { code: '0212', name: 'อลูมิเนียมมู่ลี่', weight: 12.6, pricePerKg: 55.87 },
          { code: '0213', name: 'อลูมิเนียมฝาแกะ', weight: 95.6, pricePerKg: 68.42 },
          { code: '0216', name: 'หม้อน้ำอลูมีเนียม', weight: 208.2, pricePerKg: 69.8 },
        ],
      },
      {
        customer: 'ร้าน เอส.เอ็ม.เอ รีไซเคิล (สมพร)', date: '2026-06-24', vehiclePlate: 'A2007607', note: 'หักเต๋า2โล หักเต๋า2โล หักถุงปุ๋ย1.4',
        items: [
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 964.8, pricePerKg: 1 },
          { code: '0215', name: 'อลูมิเนียมฉาก', weight: 86.6, pricePerKg: 1 },
          { code: '0201', name: 'อลูมิเนียมกระป๋อง', weight: 845, pricePerKg: 85.85 },
        ],
      },
      {
        customer: 'เหล็กสยามยามาโตะ', date: '2026-06-23', vehiclePlate: 'A2007606', note: '29 17.20 พขร ปิยณัฐ โคตรวิชัย ทบ82-1709/82-1710 จ่อย',
        items: [{ code: '0106', name: 'เหล็กบาง', weight: 28775, pricePerKg: 10.06 }],
      },
      {
        customer: 'เอ็น เอส  (นิว โซลูชั่น)', date: '2026-06-23', vehiclePlate: 'A2007603', note: '28  09.22 พขร กรกนก น้อยพินิจ ทบ ตจ 2599 ยงเฮง',
        items: [
          { code: '0205', name: 'อลูมิเนียมแข็ง', weight: 440.6, pricePerKg: 73.26 },
          { code: '0209', name: 'อลูมิเนียมกะทะ', weight: 120, pricePerKg: 62.26 },
          { code: '0210', name: 'อลูมิเนียมตูดกะทะ', weight: 67.8, pricePerKg: 59.91 },
          { code: '0217', name: 'อลูมีเนียมเครื่อง', weight: 131.6, pricePerKg: 89.09 },
          { code: '0221', name: 'อลูมิเนียมอัลลอยด์', weight: 6.2, pricePerKg: 67.74 },
          { code: '0232', name: 'อลูมิเนียมเพลท', weight: 6.7, pricePerKg: 85.25 },
          { code: '0239', name: 'หนาติดสี', weight: 56.5, pricePerKg: 84.5 },
        ],
      },
    ];

    // === EXECUTE ===
    const report: any = {
      mode: DRY_RUN ? 'DRY_RUN' : 'PRODUCTION',
      before: { products: beforeProducts, categories: beforeCategories, buyBills: beforeBuyBills, sellBills: beforeSellBills, sortBills: beforeSortBills, stockLots: beforeStockLots },
      buyImported: 0, buyItemsImported: 0, buySkipped: 0,
      sellSummaryImported: 0, sellSummaryItemsImported: 0, sellSummarySkipped: 0,
      sellDetailImported: 0, sellDetailItemsImported: 0, sellDetailSkipped: 0,
      testBuyBillsDeleted: 0, testSellBillsDeleted: 0, testSortBillsDeleted: 0,
      unmatchedProducts: [] as string[],
      stockErrors: [] as string[],
    };

    // === PHASE 1: Import BUY summary data ===
    for (const buySheet of BUY_DATA) {
      const importNote = `IMPORT_SUMMARY_REAL|source:${buySheet.sheet}`;
      // Check duplicate
      const existing = await db.buyBill.findFirst({ where: { note: importNote } });
      if (existing) {
        report.buySkipped++;
        continue;
      }

      // Match products + build items
      const billItems: Array<{ productId: string; weight: number; pricePerKg: number; totalAmount: number }> = [];
      for (const item of buySheet.items) {
        if (item.weight === 0) continue; // Skip zero-weight
        const productId = matchProduct(item.name, allProducts);
        if (!productId) {
          report.unmatchedProducts.push(`BUY ${buySheet.sheet}: ${item.name}`);
          continue;
        }
        billItems.push({
          productId,
          weight: item.weight,
          pricePerKg: item.avgPrice,
          totalAmount: item.totalAmount,
        });
      }

      if (billItems.length === 0) {
        report.buySkipped++;
        continue;
      }

      const totalAmount = billItems.reduce((s, i) => s + i.totalAmount, 0);

      if (!DRY_RUN) {
        const bill = await db.buyBill.create({
          data: {
            date: new Date(buySheet.toDate),
            isCredit: false,
            note: importNote,
            totalAmount: Math.round(totalAmount * 100) / 100,
            items: { create: billItems },
          },
        });
        // Create stock lots
        for (const item of billItems) {
          await db.stockLot.create({
            data: {
              productId: item.productId,
              remainingWeight: item.weight,
              costPerKg: item.pricePerKg,
              dateAdded: new Date(buySheet.toDate),
              source: 'BUY',
              sourceId: bill.id,
            },
          });
        }
      }
      report.buyImported++;
      report.buyItemsImported += billItems.length;
    }

    // === PHASE 2: Import SELL summary data ===
    for (const sellSheet of SELL_SUMMARY_DATA) {
      const importNote = `IMPORT_SUMMARY_REAL|source:${sellSheet.sheet}`;
      const existing = await db.sellBill.findFirst({ where: { note: importNote } });
      if (existing) {
        report.sellSummarySkipped++;
        continue;
      }

      const billItems: Array<{ productId: string; weight: number; pricePerKg: number; totalAmount: number; costPerKg: number; totalCost: number }> = [];
      for (const item of sellSheet.items) {
        if (item.weight === 0) continue;
        const productId = matchProduct(item.name, allProducts);
        if (!productId) {
          report.unmatchedProducts.push(`SELL_SUMMARY ${sellSheet.sheet}: ${item.name}`);
          continue;
        }
        // Check stock (in-memory)
        const available = stockMap.get(productId) || 0;
        if (available < item.weight) {
          report.stockErrors.push(`SELL_SUMMARY ${sellSheet.sheet}: ${item.name} needs ${item.weight}kg, available ${available.toFixed(2)}kg — SKIPPED`);
          continue;
        }
        billItems.push({
          productId, weight: item.weight, pricePerKg: item.avgPrice, totalAmount: item.totalAmount,
          costPerKg: 0, totalCost: 0, // Will be calculated by FIFO
        });
      }

      if (billItems.length === 0) {
        report.sellSummarySkipped++;
        continue;
      }

      // Simulate stock deduction in-memory (for both dry-run and production)
      for (const item of billItems) {
        deductStock(item.productId, item.weight);
      }

      if (!DRY_RUN) {
        // Real FIFO deduction via DB transaction
        let totalAmount = 0, totalCost = 0;
        const sellItems: Array<{ productId: string; weight: number; pricePerKg: number; totalAmount: number; costPerKg: number; totalCost: number }> = [];
        for (const item of billItems) {
          let remaining = item.weight;
          let itemCost = 0;
          const lots = await db.stockLot.findMany({ where: { productId: item.productId, remainingWeight: { gt: 0 } }, orderBy: { dateAdded: 'asc' } });
          for (const lot of lots) {
            if (remaining <= 0) break;
            const deduct = Math.min(lot.remainingWeight, remaining);
            itemCost += deduct * lot.costPerKg;
            remaining -= deduct;
            await db.stockLot.update({ where: { id: lot.id }, data: { remainingWeight: lot.remainingWeight - deduct } });
          }
          const costPerKg = item.weight > 0 ? itemCost / item.weight : 0;
          sellItems.push({
            productId: item.productId, weight: item.weight, pricePerKg: item.pricePerKg,
            totalAmount: item.totalAmount, costPerKg: Math.round(costPerKg * 100) / 100,
            totalCost: Math.round(itemCost * 100) / 100,
          });
          totalAmount += item.totalAmount;
          totalCost += itemCost;
        }
        await db.sellBill.create({
          data: {
            date: new Date(sellSheet.toDate), isCredit: false, note: importNote,
            totalAmount: Math.round(totalAmount * 100) / 100,
            totalCost: Math.round(totalCost * 100) / 100,
            items: { create: sellItems },
          },
        });
      }
      report.sellSummaryImported++;
      report.sellSummaryItemsImported += billItems.length;
    }

    // === PHASE 3: Import SELL detail data ===
    for (const detail of SELL_DETAIL_DATA) {
      const importNote = `IMPORT_DETAIL_REAL|source:ขาย 23,24-6-2569|customer:${detail.customer}|date:${detail.date}`;
      const existing = await db.sellBill.findFirst({ where: { note: importNote } });
      if (existing) {
        report.sellDetailSkipped++;
        continue;
      }

      const billItems: Array<{ productId: string; weight: number; pricePerKg: number; totalAmount: number }> = [];
      for (const item of detail.items) {
        if (item.weight === 0) continue;
        const productId = matchProduct(item.name, allProducts);
        if (!productId) {
          report.unmatchedProducts.push(`SELL_DETAIL ${detail.customer} ${detail.date}: ${item.name}`);
          continue;
        }
        const available = stockMap.get(productId) || 0;
        if (available < item.weight) {
          report.stockErrors.push(`SELL_DETAIL ${detail.customer} ${detail.date}: ${item.name} needs ${item.weight}kg, available ${available.toFixed(2)}kg — SKIPPED`);
          continue;
        }
        billItems.push({ productId, weight: item.weight, pricePerKg: item.pricePerKg, totalAmount: item.weight * item.pricePerKg });
      }

      if (billItems.length === 0) {
        report.sellDetailSkipped++;
        continue;
      }

      // Simulate stock deduction in-memory
      for (const item of billItems) {
        deductStock(item.productId, item.weight);
      }

      if (!DRY_RUN) {
        // Real FIFO deduction
        let totalAmount = 0, totalCost = 0;
        const sellItems: Array<{ productId: string; weight: number; pricePerKg: number; totalAmount: number; costPerKg: number; totalCost: number }> = [];
        for (const item of billItems) {
          let remaining = item.weight;
          let itemCost = 0;
          const lots = await db.stockLot.findMany({ where: { productId: item.productId, remainingWeight: { gt: 0 } }, orderBy: { dateAdded: 'asc' } });
          for (const lot of lots) {
            if (remaining <= 0) break;
            const deduct = Math.min(lot.remainingWeight, remaining);
            itemCost += deduct * lot.costPerKg;
            remaining -= deduct;
            await db.stockLot.update({ where: { id: lot.id }, data: { remainingWeight: lot.remainingWeight - deduct } });
          }
          const costPerKg = item.weight > 0 ? itemCost / item.weight : 0;
          sellItems.push({
            productId: item.productId, weight: item.weight, pricePerKg: item.pricePerKg,
            totalAmount: Math.round(item.totalAmount * 100) / 100,
            costPerKg: Math.round(costPerKg * 100) / 100,
            totalCost: Math.round(itemCost * 100) / 100,
          });
          totalAmount += item.totalAmount;
          totalCost += itemCost;
        }
        await db.sellBill.create({
          data: {
            date: new Date(detail.date), isCredit: false, note: importNote,
            totalAmount: Math.round(totalAmount * 100) / 100,
            totalCost: Math.round(totalCost * 100) / 100,
            items: { create: sellItems },
          },
        });
      }
      report.sellDetailImported++;
      report.sellDetailItemsImported += billItems.length;
    }

    // === PHASE 4: Cleanup TEST data ===
    if (!DRY_RUN || true) { // Always report in dry-run
      // Test BuyBills
      const testBuyBills = await db.buyBill.findMany({ where: { note: { contains: 'TEST' } }, select: { id: true, note: true } });
      report.testBuyBillsFound = testBuyBills.length;
      if (!DRY_RUN) {
        for (const bill of testBuyBills) {
          await db.stockLot.deleteMany({ where: { sourceId: bill.id, source: 'BUY' } });
          await db.buyBillItem.deleteMany({ where: { buyBillId: bill.id } });
          await db.buyBill.delete({ where: { id: bill.id } });
        }
      }
      report.testBuyBillsDeleted = testBuyBills.length;

      // Test SellBills
      const testSellBills = await db.sellBill.findMany({ where: { note: { contains: 'TEST' } }, select: { id: true } });
      report.testSellBillsFound = testSellBills.length;
      if (!DRY_RUN) {
        for (const bill of testSellBills) {
          await db.sellBillItem.deleteMany({ where: { sellBillId: bill.id } });
          await db.sellBill.delete({ where: { id: bill.id } });
        }
      }
      report.testSellBillsDeleted = testSellBills.length;

      // Test SortingBills
      const testSortBills = await db.sortingBill.findMany({ where: { note: { contains: 'TEST' } }, select: { id: true } });
      report.testSortBillsFound = testSortBills.length;
      if (!DRY_RUN) {
        for (const bill of testSortBills) {
          await db.sortingBillItem.deleteMany({ where: { sortingBillId: bill.id } });
          await db.stockLot.deleteMany({ where: { sourceId: bill.id, source: { in: ['SORTING', 'SORT_CANCEL'] } } });
          await db.sortingBill.delete({ where: { id: bill.id } });
        }
      }
      report.testSortBillsDeleted = testSortBills.length;
    }

    // === AFTER COUNTS ===
    const [afterProducts, afterCategories, afterBuyBills, afterSellBills, afterSortBills, afterStockLots] = await Promise.all([
      db.product.count(), db.productCategory.count(),
      db.buyBill.count(), db.sellBill.count(), db.sortingBill.count(),
      db.stockLot.count(),
    ]);
    report.after = { products: afterProducts, categories: afterCategories, buyBills: afterBuyBills, sellBills: afterSellBills, sortBills: afterSortBills, stockLots: afterStockLots };
    report.verification = {
      productsUnchanged: beforeProducts === afterProducts,
      categoriesUnchanged: beforeCategories === afterCategories,
    };
    report.executionTimeMs = Date.now() - startTime;

    return NextResponse.json({ success: true, ...report });
  } catch (error) {
    return NextResponse.json(
      { success: false, error: 'Import failed: ' + (error instanceof Error ? error.message : 'unknown') },
      { status: 500 }
    );
  }
}
