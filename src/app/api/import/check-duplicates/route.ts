import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';
import { normalizeBillNumber } from '@/lib/import-pipeline';
import { hasPermission } from '@/lib/permissions';

/**
 * ST-8: Batch duplicate-check API.
 *
 * POST /api/import/check-duplicates
 *   body: { billNumbers: string[], type: 'purchase' | 'sales' }
 *   returns: { existing: string[] } — array of NORMALIZED bill numbers
 *                                  that already exist in the database.
 *
 * This replaces the old per-bill duplicate check (which called
 * /api/buy-bills?externalBillNumber=X for each bill) with a single
 * batched query.
 *
 * Comparison uses normalizeBillNumber() so that leading/trailing
 * whitespace and Unicode variants are normalized consistently
 * between client (preview) and server (apply).
 */
export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) {
    return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  }
  const payload = await verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { billNumbers, type } = body as {
      billNumbers?: unknown;
      type?: unknown;
    };

    // ST-8 Blocker 1: Type-specific authorization
    if (type === 'purchase' && !hasPermission(payload, 'buy.create')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์นำเข้าใบซื้อ' }, { status: 403 });
    }
    if (type === 'sales' && !hasPermission(payload, 'sell.create')) {
      return NextResponse.json({ error: 'ไม่มีสิทธิ์นำเข้าใบขาย' }, { status: 403 });
    }

    if (type !== 'purchase' && type !== 'sales') {
      return NextResponse.json(
        { error: "type must be 'purchase' or 'sales'" },
        { status: 400 }
      );
    }

    // Validate billNumbers: must be an array of strings
    if (!Array.isArray(billNumbers)) {
      return NextResponse.json(
        { error: 'billNumbers must be an array' },
        { status: 400 }
      );
    }

    // Normalize + deduplicate input. Drop blank entries.
    const normalizedSet = new Set<string>();
    for (const raw of billNumbers) {
      if (typeof raw !== 'string') continue;
      const norm = normalizeBillNumber(raw);
      if (norm === '') continue;
      normalizedSet.add(norm);
    }

    if (normalizedSet.size === 0) {
      return NextResponse.json({ existing: [] });
    }

    const normalizedList = Array.from(normalizedSet);

    // Batched DB query: find all existing bills whose externalBillNumber
    // (after normalization) matches any of the input numbers.
    //
    // Note: we store externalBillNumber as the raw string in DB. We must
    // normalize both sides for comparison. We fetch all bills with a
    // non-null externalBillNumber and filter in JS — this is acceptable
    // because the typical batch is < 200 bills and the DB only stores
    // one row per existing bill number (the @unique constraint).
    //
    // For a production-scale system we'd index on a normalized column,
    // but that's a schema migration — out of scope for ST-8.
    const existingBills =
      type === 'purchase'
        ? await db.buyBill.findMany({
            where: {
              externalBillNumber: { not: null },
            },
            select: { externalBillNumber: true },
          })
        : await db.sellBill.findMany({
            where: {
              externalBillNumber: { not: null },
            },
            select: { externalBillNumber: true },
          });

    const existingNormalizedSet = new Set<string>();
    for (const b of existingBills) {
      const norm = normalizeBillNumber(b.externalBillNumber);
      if (norm === '') continue;
      existingNormalizedSet.add(norm);
    }

    // Intersect: which input numbers exist in DB?
    const existing = normalizedList.filter((n) => existingNormalizedSet.has(n));

    return NextResponse.json({ existing });
  } catch (error) {
    console.error('[ST-8] check-duplicates failed:', error);
    return NextResponse.json(
      { error: 'Failed to check duplicates' },
      { status: 500 }
    );
  }
}
