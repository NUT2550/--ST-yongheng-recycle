import { NextRequest, NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import * as iconv from 'iconv-lite';
import { verifyToken, getTokenFromRequest } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function fixThai(s: string): string {
  if (!s) return s;
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  try {
    const buf = iconv.encode(s, 'latin1');
    return iconv.decode(buf, 'tis620');
  } catch {
    return s;
  }
}

function parseThaiDate(s: string): string | null {
  if (!s) return null;
  const parts = s.trim().split(/[\/\-\.]/);
  if (parts.length < 3) return null;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);
  if (year > 2500) year -= 543;
  if (!day || !month || !year) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const COLUMN_LAYOUTS = {
  buy: { code: 0, name: 2, weight: 6, total: 8, avg: 9 },
  sell: { code: 1, name: 2, weight: 7, total: 9, avg: 10 },
} as const;

export async function POST(request: NextRequest) {
  const token = getTokenFromRequest(request);
  if (!token) return NextResponse.json({ error: 'ไม่ได้เข้าสู่ระบบ' }, { status: 401 });
  const payload = await verifyToken(token);
  if (!payload) return NextResponse.json({ error: 'token ไม่ถูกต้อง' }, { status: 401 });

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const billType = (formData.get('billType') as string) || 'buy';

    if (!file) {
      return NextResponse.json({ error: 'กรุณาเลือกไฟล์' }, { status: 400 });
    }

    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ error: 'ไฟล์ใหญ่เกิน 5MB' }, { status: 400 });
    }

    const layout = billType === 'sell' ? COLUMN_LAYOUTS.sell : COLUMN_LAYOUTS.buy;
    const buf = Buffer.from(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'buffer' });
    const firstSheet = wb.Sheets[wb.SheetNames[0]];
    if (!firstSheet) {
      return NextResponse.json({ error: 'ไม่พบ sheet ในไฟล์ Excel' }, { status: 400 });
    }

    const data = XLSX.utils.sheet_to_json<any[]>(firstSheet, { header: 1, defval: '' });

    // Extract bill date from cell B1 or similar
    let billDate: string | null = null;
    if (data[0]) {
      for (const cell of data[0]) {
        const s = String(cell || '');
        const parsed = parseThaiDate(s);
        if (parsed) { billDate = parsed; break; }
      }
    }

    const num = (v: any): number => {
      if (typeof v === 'number') return v;
      const s = String(v || '').replace(/,/g, '').trim();
      const n = parseFloat(s);
      return isNaN(n) ? 0 : n;
    };

    const rows: Array<{
      rowIndex: number;
      code: string;
      name: string;
      weight: number;
      totalAmount: number;
      avgPricePerKg: number;
    }> = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i] || [];
      const code = String(row[layout.code] ?? '').trim();
      const name = fixThai(String(row[layout.name] ?? '').trim());
      if (!/^\d{4}$/.test(code) || !name) continue;
      if (name.includes('ยอดรวม') || name.includes('รวมท้าย')) continue;

      const weight = num(row[layout.weight]);
      const totalAmount = num(row[layout.total]);
      let avgPricePerKg = num(row[layout.avg]);
      if ((!avgPricePerKg || avgPricePerKg === 0) && weight > 0) {
        avgPricePerKg = totalAmount / weight;
      }
      if (weight === 0 && totalAmount === 0) continue;

      rows.push({
        rowIndex: i,
        code,
        name,
        weight,
        totalAmount,
        avgPricePerKg: Math.round(avgPricePerKg * 100) / 100,
      });
    }

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'ไม่พบรายการสินค้าในไฟล์ (ต้องมีรหัสสินค้า 4 หลักและชื่อสินค้า)' },
        { status: 400 }
      );
    }

    return NextResponse.json({ rows, billDate });
  } catch (error) {
    console.error('Excel parse error:', error);
    return NextResponse.json(
      { error: 'ไม่สามารถอ่านไฟล์ได้: ' + (error instanceof Error ? error.message : 'unknown') },
      { status: 500 }
    );
  }
}
