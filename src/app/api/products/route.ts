import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { NextRequest, NextResponse } from 'next/server';

// POST /api/products — Create a new product (admin only)
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  if (payload.role !== 'admin') {
    return NextResponse.json({ error: "ไม่มีสิทธิ์ — ต้องเป็น admin" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { name, categoryId, defaultBuyPrice, sortOrder } = body as {
      name?: string;
      categoryId?: string;
      defaultBuyPrice?: number;
      sortOrder?: number;
    };

    // Validation
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "กรุณากรอกชื่อสินค้า" }, { status: 400 });
    }
    if (!categoryId) {
      return NextResponse.json({ error: "กรุณาเลือกหมวดหมู่" }, { status: 400 });
    }

    // Check for duplicate name
    const existing = await db.product.findFirst({
      where: { name: name.trim() },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json({ error: "มีสินค้านี้อยู่แล้ว" }, { status: 409 });
    }

    // Verify category exists
    const category = await db.productCategory.findUnique({
      where: { id: categoryId },
      select: { id: true },
    });
    if (!category) {
      return NextResponse.json({ error: "หมวดหมู่ไม่ถูกต้อง" }, { status: 400 });
    }

    const product = await db.product.create({
      data: {
        name: name.trim(),
        categoryId,
        defaultBuyPrice: typeof defaultBuyPrice === 'number' ? defaultBuyPrice : 0,
        sortOrder: typeof sortOrder === 'number' ? sortOrder : 99,
      },
      include: {
        category: { select: { id: true, name: true, type: true } },
      },
    });

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    console.error('Error creating product:', error);
    const message = error instanceof Error ? error.message : 'unknown';
    return NextResponse.json(
      { error: 'เพิ่มสินค้าไม่สำเร็จ: ' + message },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: "ไม่ได้เข้าสู่ระบบ" }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: "token ไม่ถูกต้อง" }, { status: 401 });
  try {
    const products = await db.product.findMany({
      include: {
        category: {
          select: { id: true, name: true, type: true },
        },
        stockLots: {
          select: { remainingWeight: true, costPerKg: true },
        },
      },
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
    });

    const result = products.map((p) => {
      const totalWeight = p.stockLots.reduce((sum, l) => sum + l.remainingWeight, 0);
      const totalCost = p.stockLots.reduce(
        (sum, l) => sum + l.remainingWeight * l.costPerKg,
        0
      );
      const avgCostPerKg = totalWeight > 0 ? totalCost / totalWeight : 0;

      return {
        id: p.id,
        name: p.name,
        defaultBuyPrice: p.defaultBuyPrice,
        category: p.category,
        stock: {
          totalWeight: Math.round(totalWeight * 100) / 100,
          totalCost: Math.round(totalCost * 100) / 100,
          avgCostPerKg: Math.round(avgCostPerKg * 100) / 100,
        },
      };
    });

    return NextResponse.json({ products: result });
  } catch (error) {
    console.error('Error fetching products:', error);
    return NextResponse.json(
      { error: 'Failed to fetch products' },
      { status: 500 }
    );
  }
}
