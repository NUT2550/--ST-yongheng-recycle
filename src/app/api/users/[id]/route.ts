import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyToken, getTokenFromRequest } from '@/lib/auth'

async function requireAdmin(request: NextRequest) {
  const token = getTokenFromRequest(request)
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'admin') return null
  return payload
}

// PATCH /api/users/[id] - update user (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 })
  }

  try {
    const { id } = await params
    const body = await request.json()
    const { name, role, isActive, password } = body

    // Don't allow admin to deactivate themselves
    if (admin.userId === id && isActive === false) {
      return NextResponse.json(
        { error: 'ไม่สามารถปิดการใช้งานตัวเองได้' },
        { status: 400 }
      )
    }

    const data: any = {}
    if (name !== undefined) data.name = name
    if (role !== undefined) data.role = role === 'admin' ? 'admin' : 'staff'
    if (isActive !== undefined) data.isActive = isActive
    if (password) {
      if (password.length < 4) {
        return NextResponse.json(
          { error: 'รหัสผ่านต้องมีอย่างน้อย 4 ตัวอักษร' },
          { status: 400 }
        )
      }
      data.password = await hashPassword(password)
    }

    const user = await db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        isActive: true,
      },
    })

    return NextResponse.json({ success: true, user })
  } catch (error) {
    console.error('Update user error:', error)
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการแก้ไขผู้ใช้' },
      { status: 500 }
    )
  }
}

// DELETE /api/users/[id] - delete user (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์เข้าถึง' }, { status: 403 })
  }

  try {
    const { id } = await params

    if (admin.userId === id) {
      return NextResponse.json(
        { error: 'ไม่สามารถลบตัวเองได้' },
        { status: 400 }
      )
    }

    await db.user.delete({ where: { id } })

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Delete user error:', error)
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการลบผู้ใช้' },
      { status: 500 }
    )
  }
}
