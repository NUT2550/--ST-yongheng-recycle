import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

// GET /api/physical-counts — list sessions or get products for a group
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'list';

    if (action === 'products') {
      const category = searchParams.get('category');
      if (!category) {
        return NextResponse.json({ error: 'กรุณาระบุหมวดหมู่' }, { status: 400 });
      }
      const cat = await db.productCategory.findFirst({ where: { name: category } });
      if (!cat) {
        return NextResponse.json({ error: `ไม่พบหมวดหมู่ "${category}"` }, { status: 400 });
      }
      const products = await db.product.findMany({
        where: { categoryId: cat.id },
        include: { stockLots: { select: { remainingWeight: true, costPerKg: true } } },
        orderBy: { sortOrder: 'asc' },
      });
      const result = products.map((p) => {
        const totalWeight = p.stockLots.reduce((s, l) => s + l.remainingWeight, 0);
        const totalCost = p.stockLots.reduce((s, l) => s + l.remainingWeight * l.costPerKg, 0);
        const avgCost = totalWeight > 0 ? totalCost / totalWeight : 0;
        return {
          id: p.id,
          name: p.name,
          systemWeight: Math.round(totalWeight * 100) / 100,
          averageCost: Math.round(avgCost * 100) / 100,
          systemValue: Math.round(totalCost * 100) / 100,
        };
      });
      return NextResponse.json({ products: result });
    }

    // Default: list sessions
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
    const skip = (page - 1) * limit;
    const where: any = {};
    if (searchParams.get('group')) where.group = searchParams.get('group');

    const [sessions, total] = await Promise.all([
      db.physicalCountSession.findMany({
        where,
        include: { items: { include: { product: { select: { name: true } } } } },
        orderBy: { countDate: 'desc' },
        skip,
        take: limit,
      }),
      db.physicalCountSession.count({ where }),
    ]);
    return NextResponse.json({ sessions, total });
  } catch (error) {
    console.error('Error fetching physical counts:', error);
    return NextResponse.json({ error: 'Failed to fetch physical counts' }, { status: 500 });
  }
}

// POST /api/physical-counts — save draft session
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const body = await request.json();
    const { countDate, group, note, items } = body as {
      countDate: string;
      group: string;
      note?: string;
      items: Array<{
        productId: string;
        systemWeight: number;
        physicalWeight: number;
        differenceWeight: number;
        averageCost: number;
        valueDifference: number;
        note?: string;
      }>;
    };

    if (!countDate) return NextResponse.json({ error: 'กรุณาเลือกวันที่' }, { status: 400 });
    if (!group) return NextResponse.json({ error: 'กรุณาเลือกหมวดหมู่' }, { status: 400 });
    if (!items || items.length === 0) return NextResponse.json({ error: 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ' }, { status: 400 });

    // Validate items
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.productId) return NextResponse.json({ error: `รายการที่ ${i + 1} ไม่มีสินค้า` }, { status: 400 });
      if (typeof item.physicalWeight !== 'number' || isNaN(item.physicalWeight) || item.physicalWeight < 0) {
        return NextResponse.json({ error: `น้ำหนักชั่งจริงรายการที่ ${i + 1} ต้องไม่ติดลบ` }, { status: 400 });
      }
    }

    // Pre-validate all productIds exist
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const product = await db.product.findUnique({ where: { id: item.productId }, select: { id: true } });
      if (!product) {
        return NextResponse.json({ error: `ไม่พบสินค้ารายการที่ ${i + 1} (ID: ${item.productId})` }, { status: 400 });
      }
    }

    const session = await db.physicalCountSession.create({
      data: {
        countDate: new Date(countDate),
        group,
        status: 'DRAFT',
        note: note || null,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            systemWeight: item.systemWeight,
            physicalWeight: item.physicalWeight,
            differenceWeight: item.differenceWeight,
            averageCost: item.averageCost,
            valueDifference: item.valueDifference,
            note: item.note || null,
          })),
        },
      },
      include: { items: { include: { product: { select: { name: true } } } } },
    });
    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Error creating physical count:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ: ' + message }, { status: 500 });
  }
}
