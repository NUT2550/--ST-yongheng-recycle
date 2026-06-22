import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

async function requireAuth(request: NextRequest) {
  const token = getTokenFromRequest(request)
  if (!token) return null
  const payload = await verifyToken(token)
  return payload
}

// PATCH /api/customers/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (!auth) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 })
  try {
    const { id } = await params
    const { name, phone } = await request.json()
    const data: any = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone

    const customer = await db.customer.update({ where: { id }, data })
    return NextResponse.json({ customer })
  } catch (error) {
    return NextResponse.json({ error: 'แก้ไขไม่สำเร็จ' }, { status: 500 })
  }
}

// DELETE /api/customers/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth(request)
  if (!auth) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 })
  try {
    const { id } = await params
    await db.customer.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'ลบไม่สำเร็จ — อาจมีบิลที่อ้างถึงลูกค้านี้' }, { status: 500 })
  }
}
