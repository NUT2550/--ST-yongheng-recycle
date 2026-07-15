import { NextRequest, NextResponse } from 'next/server';

// POST /api/physical-counts/[id]/apply — Apply a DRAFT physical count session.
// ST-9: Adjusts stock to match physical count. Creates STOCK_ADJUSTMENT lots.
//
// ST-35: This endpoint is DISABLED. Physical Count Apply is superseded by
// the Daily Purchase Weighing page. The old process does not match the
// actual business workflow. Return 403 to prevent accidental stock modification.
//
// Owner-approved rules (original, now suspended):
// - Any authenticated user can apply (not admin-only)
// - Must not cause negative stock after adjustment
// - Note is optional
// - Must record: actor, timestamp, before, physical, difference, after
// - Applied sessions cannot be edited or deleted
// - Reversal = create a new adjustment referencing the original (not delete/edit)
// - All steps have failure handling — no half-applied state
export async function POST(
  _request: NextRequest,
  { params: _params }: { params: Promise<{ id: string }> }
) {
  // ST-35: Disabled — return 403 immediately, no DB access
  return NextResponse.json(
    { error: 'ระบบ Physical Count Apply ถูกระงับการใช้งาน กรุณาใช้หน้าชั่งยอดซื้อทองแดง/ทองเหลืองประจำวัน' },
    { status: 403 }
  );
}
