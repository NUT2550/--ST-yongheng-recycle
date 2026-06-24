import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyToken, getTokenFromRequest } from '@/lib/auth'

async function requireAdmin(request: NextRequest) {
  const token = getTokenFromRequest(request)
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'admin') return null
  return payload
}

// PATCH /api/employees/[id]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 })
  try {
    const { id } = await params
    const { name, phone, hireDate, isActive } = await request.json()
    const data: any = {}
    if (name !== undefined) data.name = name
    if (phone !== undefined) data.phone = phone
    if (hireDate !== undefined) data.hireDate = hireDate ? new Date(hireDate) : null
    if (isActive !== undefined) data.isActive = isActive

    const emp = await db.employee.update({ where: { id }, data })
    return NextResponse.json({ employee: emp })
  } catch (error) {
    return NextResponse.json({ error: 'แก้ไขไม่สำเร็จ' }, { status: 500 })
  }
}

// DELETE /api/employees/[id]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 })
  try {
    const { id } = await params
    await db.employee.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'ลบไม่สำเร็จ' }, { status: 500 })
  }
}
