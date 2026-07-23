import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from "@/lib/auth";
import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import {
  handleProductCreationPost,
  productCreationFailureResponse,
} from '@/lib/product-creation-route-handler';

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
    const input = body as {
      name?: string;
      categoryId?: string;
      defaultBuyPrice?: number;
      sortOrder?: number;
    };

    return handleProductCreationPost(input, {
      listConflictCandidates: () => db.product.findMany({
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true } },
        },
      }),
      categoryExists: async categoryId => Boolean(await db.productCategory.findUnique({
        where: { id: categoryId },
        select: { id: true },
      })),
      createProduct: data => db.product.create({
        data,
        include: {
          category: { select: { id: true, name: true, type: true } },
        },
      }),
      isUniqueConstraintError: error =>
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002',
      logInternalError: (message, error) => console.error(message, error),
    });

  } catch (error) {
    console.error('Error creating product:', error);
    return productCreationFailureResponse();
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
