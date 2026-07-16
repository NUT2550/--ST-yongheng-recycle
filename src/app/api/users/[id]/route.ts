import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyToken, getTokenFromRequest } from '@/lib/auth'
import { isAdmin } from '@/lib/permissions'
import {
  permissionUpdateController,
  type PermissionUpdateDeps,
  type PermissionUpdateInput,
} from '@/lib/route-controllers'

async function requireAdmin(request: NextRequest) {
  const token = getTokenFromRequest(request)
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || !isAdmin(payload)) return null
  return payload
}

// PATCH /api/users/[id] - update user (admin only)
// ST-14: Also handles `permissions` field (JSON array of permission strings)
// ST-10: Permission updates flow through `permissionUpdateController`, which
//        wraps user.update + auditLog.create in `db.$transaction` so that an
//        AuditLog failure rolls back the permission change atomically.
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
    const { name, role, isActive, password, permissions } = body

    // Don't allow admin to deactivate themselves
    if (admin.userId === id && isActive === false) {
      return NextResponse.json(
        { error: 'ไม่สามารถปิดการใช้งานตัวเองได้' },
        { status: 400 }
      )
    }

    // ST-14: Staff cannot change own permissions (only admin can, and admin can't target self for permission changes)
    if (permissions !== undefined && admin.userId === id) {
      return NextResponse.json(
        { error: 'ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้' },
        { status: 400 }
      )
    }

    const data: { name?: string; role?: string; isActive?: boolean; password?: string } = {}
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

    // ST-10: Permission updates flow through the controller (atomic transaction).
    if (permissions !== undefined) {
      const deps: PermissionUpdateDeps = {
        findUser: (targetId) =>
          db.user.findUnique({
            where: { id: targetId },
            select: { permissions: true, username: true, name: true, role: true },
          }) as Promise<{ permissions: string | null; username: string; name: string; role: string } | null>,
        transaction: (fn) =>
          db.$transaction(async (tx) => {
            return fn({
              updateUser: (targetId, updateData) =>
                tx.user.update({
                  where: { id: targetId },
                  data: { ...data, ...updateData },
                  select: {
                    id: true,
                    username: true,
                    name: true,
                    role: true,
                    isActive: true,
                    permissions: true,
                  },
                }) as Promise<import('@/lib/route-controllers').PermissionUpdateUser>,
              createAuditLog: async (auditData) => {
            await tx.auditLog.create({ data: auditData })
          },
            })
          }),
      }
      const result = await permissionUpdateController(
        deps,
        { permissions } as PermissionUpdateInput,
        admin,
        id
      )
      return NextResponse.json(result.body, { status: result.status })
    }

    // Non-permission update (name/role/isActive/password) — no transaction needed
    const user = await db.user.update({
      where: { id },
      data,
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        isActive: true,
        permissions: true,
      },
    })
    const responseUser = {
      ...user,
      permissions: user.permissions ? JSON.parse(user.permissions) : [],
    }
    return NextResponse.json({ success: true, user: responseUser })
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
