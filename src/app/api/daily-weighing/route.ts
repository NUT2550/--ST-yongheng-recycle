import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

const TOLERANCE = 0.10; // ±0.10 kg per Owner decision

// GET /api/daily-weighing — list sessions OR aggregate purchases for a date
export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'list';

  if (action === 'aggregate') {
    // Aggregate BuyBillItems for a specific date + category
    const dateStr = searchParams.get('date');
    const category = searchParams.get('category');
    if (!dateStr || !category) {
      return NextResponse.json({ error: 'กรุณาระบุวันที่และหมวดหมู่' }, { status: 400 });
    }

    // Parse date: input is CE ISO date (e.g. "2026-07-11")
    const startDate = new Date(dateStr + 'T00:00:00+07:00');
    const endDate = new Date(dateStr + 'T23:59:59+07:00');

    // Find category
    const cat = await db.productCategory.findFirst({ where: { name: category } });
    if (!cat) {
      return NextResponse.json({ error: `ไม่พบหมวดหมู่ "${category}"` }, { status: 400 });
    }

    // Get all products in this category
    const products = await db.product.findMany({
      where: { categoryId: cat.id },
      select: { id: true, name: true, sortOrder: true },
      orderBy: { sortOrder: 'asc' },
    });
    const productIds = new Set(products.map(p => p.id));

    // Get all non-cancelled BuyBills for this date
    const bills = await db.buyBill.findMany({
      where: {
        isCancelled: false,
        date: { gte: startDate, lte: endDate },
      },
      include: {
        items: { include: { product: { select: { id: true, name: true } } } },
      },
    });

    // Aggregate by product
    const aggMap = new Map<string, { productId: string; productName: string; purchasedWeight: number; purchaseBillCount: number; totalAmount: number }>();
    const billCountByProduct = new Map<string, Set<string>>(); // productId → set of billIds

    for (const bill of bills) {
      for (const item of bill.items) {
        if (!productIds.has(item.productId)) continue; // Skip products not in this category
        if (!aggMap.has(item.productId)) {
          aggMap.set(item.productId, {
            productId: item.productId,
            productName: item.product.name,
            purchasedWeight: 0,
            purchaseBillCount: 0,
            totalAmount: 0,
          });
          billCountByProduct.set(item.productId, new Set());
        }
        const agg = aggMap.get(item.productId)!;
        agg.purchasedWeight += item.weight;
        agg.totalAmount += item.totalAmount;
        billCountByProduct.get(item.productId)!.add(bill.id);
      }
    }

    // Set bill counts
    for (const [pid, billSet] of billCountByProduct) {
      const agg = aggMap.get(pid)!;
      agg.purchaseBillCount = billSet.size;
      agg.purchasedWeight = Math.round(agg.purchasedWeight * 100) / 100;
      agg.totalAmount = Math.round(agg.totalAmount * 100) / 100;
    }

    // Sort by product sortOrder
    const result = products
      .filter(p => aggMap.has(p.id))
      .map(p => aggMap.get(p.id)!)
      .sort((a, b) => {
        const pa = products.find(p => p.id === a.productId)?.sortOrder ?? 0;
        const pb = products.find(p => p.id === b.productId)?.sortOrder ?? 0;
        return pa - pb;
      });

    return NextResponse.json({
      date: dateStr,
      category,
      totalBills: bills.length,
      items: result,
    });
  }

  // Default: list sessions (paginated)
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get('limit') || '20', 10)));
  const skip = (page - 1) * limit;

  const [sessions, total] = await Promise.all([
    db.dailyPurchaseWeighingSession.findMany({
      orderBy: { weighingDate: 'desc' },
      skip,
      take: limit,
      include: {
        items: { include: { product: { select: { name: true } } } },
      },
    }),
    db.dailyPurchaseWeighingSession.count(),
  ]);

  return NextResponse.json({ sessions, total });
}

// POST /api/daily-weighing — save a daily weighing session
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const body = await request.json();
    const { weighingDate, category, note, items } = body as {
      weighingDate: string;
      category: string;
      note?: string;
      items: Array<{
        productId: string;
        productName: string;
        purchasedWeight: number;
        purchaseBillCount: number;
        actualWeighedWeight: number | null;
        note?: string;
      }>;
    };

    if (!weighingDate) return NextResponse.json({ error: 'กรุณาระบุวันที่' }, { status: 400 });
    if (!category) return NextResponse.json({ error: 'กรุณาระบุหมวดหมู่' }, { status: 400 });
    if (!items || items.length === 0) return NextResponse.json({ error: 'กรุณาเพิ่มรายการอย่างน้อย 1 รายการ' }, { status: 400 });

    // Check duplicate session (one per date + category)
    const date = new Date(weighingDate + 'T00:00:00+07:00');
    const existing = await db.dailyPurchaseWeighingSession.findFirst({
      where: { weighingDate: date, category },
    });
    if (existing) {
      return NextResponse.json(
        { error: `มีผลชั่งของวันที่ ${weighingDate} หมวด ${category} อยู่แล้ว — ห้ามบันทึกซ้ำ` },
        { status: 409 }
      );
    }

    // Build items with status + difference
    const sessionItems = items.map(item => {
      const actual = item.actualWeighedWeight;
      let difference: number | null = null;
      let status: string;

      if (actual === null || actual === undefined) {
        status = 'NOT_WEIGHED';
      } else {
        difference = Math.round((actual - item.purchasedWeight) * 100) / 100;
        status = Math.abs(difference) <= TOLERANCE ? 'MATCH' : 'DIFFERENCE';
      }

      return {
        productId: item.productId,
        purchasedWeight: item.purchasedWeight,
        purchaseBillCount: item.purchaseBillCount,
        actualWeighedWeight: actual ?? null,
        differenceWeight: difference,
        status,
        note: item.note || null,
      };
    });

    const session = await db.dailyPurchaseWeighingSession.create({
      data: {
        weighingDate: date,
        category,
        status: 'SAVED',
        note: note || null,
        createdById: payload.userId,
        items: { create: sessionItems },
      },
      include: { items: { include: { product: { select: { name: true } } } } },
    });

    // Audit log
    await db.auditLog.create({
      data: {
        action: 'CREATE',
        entityType: 'DAILY_WEIGHING',
        entityId: session.id,
        userId: payload.userId,
        userName: payload.name,
        details: JSON.stringify({
          weighingDate: session.weighingDate,
          category: session.category,
          itemCount: session.items.length,
          note: session.note,
        }),
      },
    });

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Error creating daily weighing:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json({ error: 'บันทึกไม่สำเร็จ: ' + message }, { status: 500 });
  }
}
