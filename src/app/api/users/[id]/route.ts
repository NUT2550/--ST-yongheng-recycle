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

// ST-14: Canonical permission keys (staff-grantable; admin gets all implicitly)
const VALID_PERMISSIONS = [
  'customer.create',
  'buy.create',
  'sell.create',
  'sort.create',
  'transfer.create',
  'history.edit',
  'physical-count.apply',
  'dailyPurchaseWeighing',
  'product.manage',
] as const

// PATCH /api/users/[id] - update user (admin only)
// ST-14: Also handles `permissions` field (JSON array of permission strings)
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

    // ST-14: Handle permissions update with AuditLog (before/after)
    let permissionsBefore: string[] | null = null
    let permissionsAfter: string[] | null = null
    if (permissions !== undefined) {
      // Validate permissions array
      if (!Array.isArray(permissions)) {
        return NextResponse.json(
          { error: 'permissions ต้องเป็น array' },
          { status: 400 }
        )
      }
      // Filter to only valid permission keys
      const validSet = new Set<string>(VALID_PERMISSIONS)
      permissionsAfter = permissions.filter((p: unknown) => typeof p === 'string' && validSet.has(p as string))
      // Read current permissions for AuditLog before/after
      const currentUser = await db.user.findUnique({
        where: { id },
        select: { permissions: true, username: true, name: true, role: true },
      })
      if (!currentUser) {
        return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })
      }
      try {
        permissionsBefore = currentUser.permissions ? JSON.parse(currentUser.permissions) : []
      } catch {
        permissionsBefore = []
      }
      // Admin role doesn't need stored permissions (gets all implicitly)
      if (currentUser.role === 'admin') {
        data.permissions = null // clear stored permissions for admin
      } else {
        data.permissions = JSON.stringify(permissionsAfter)
      }
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
        permissions: true,
      },
    })

    // ST-14: Write AuditLog for permission changes (before/after)
    if (permissions !== undefined && permissionsBefore !== null && permissionsAfter !== null) {
      try {
        await db.auditLog.create({
          data: {
            action: 'UPDATE',
            entityType: 'USER_PERMISSION',
            entityId: id,
            userId: admin.userId,
            userName: admin.name,
            details: JSON.stringify({
              type: 'PERMISSION_CHANGE',
              targetUserId: id,
              targetUsername: user.username,
              permissionsBefore,
              permissionsAfter,
              changedBy: admin.username,
            }),
          },
        })
      } catch (auditErr) {
        console.error('ST-14: AuditLog write failed for permission change (non-fatal):', auditErr)
      }
    }

    // Parse permissions for response (don't expose raw JSON string)
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
