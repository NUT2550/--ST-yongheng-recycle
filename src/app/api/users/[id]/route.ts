import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hashPassword, verifyToken, getTokenFromRequest } from '@/lib/auth'
import { CANONICAL_PERMISSIONS, normalizePermissions, computePermissionDiff } from '@/lib/permissions'

async function requireAdmin(request: NextRequest) {
  const token = getTokenFromRequest(request)
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload || payload.role !== 'admin') return null
  return payload
}

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

    // ST-10: Handle permissions update + AuditLog ATOMICALLY in a single transaction.
    // If AuditLog fails, the permission update rolls back — no partial change.
    if (permissions !== undefined) {
      // Validate permissions array
      if (!Array.isArray(permissions)) {
        return NextResponse.json(
          { error: 'permissions ต้องเป็น array' },
          { status: 400 }
        )
      }
      // Normalize: filter to canonical + deduplicate (uses shared module)
      const permissionsAfter = normalizePermissions(permissions)
      // Read current user for before/after diff
      const currentUser = await db.user.findUnique({
        where: { id },
        select: { permissions: true, username: true, name: true, role: true },
      })
      if (!currentUser) {
        return NextResponse.json({ error: 'ไม่พบผู้ใช้' }, { status: 404 })
      }
      let permissionsBefore: string[]
      try {
        permissionsBefore = currentUser.permissions ? JSON.parse(currentUser.permissions) : []
      } catch {
        permissionsBefore = []
      }
      // Compute diff for audit (uses shared module)
      const diff = computePermissionDiff(permissionsBefore, permissionsAfter)
      // Admin role doesn't need stored permissions (gets all implicitly)
      const permissionsData = currentUser.role === 'admin' ? null : JSON.stringify(permissionsAfter)

      // ATOMIC: update user + create AuditLog in a single Prisma $transaction
      try {
        const user = await db.$transaction(async (tx) => {
          const updated = await tx.user.update({
            where: { id },
            data: { ...data, permissions: permissionsData },
            select: {
              id: true,
              username: true,
              name: true,
              role: true,
              isActive: true,
              permissions: true,
            },
          })
          // AuditLog — if this throws, the entire transaction rolls back (including the permission update)
          await tx.auditLog.create({
            data: {
              action: 'UPDATE',
              entityType: 'USER_PERMISSION',
              entityId: id,
              userId: admin.userId,
              userName: admin.name,
              details: JSON.stringify({
                type: 'PERMISSION_CHANGE',
                targetUserId: id,
                targetUsername: updated.username,
                permissionsBefore,
                permissionsAfter,
                permissionsAdded: diff.added,
                permissionsRemoved: diff.removed,
                changedBy: admin.username,
                actorUserId: admin.userId,
                actorUserName: admin.name,
              }),
            },
          })
          return updated
        })
        const responseUser = {
          ...user,
          permissions: user.permissions ? JSON.parse(user.permissions) : [],
        }
        return NextResponse.json({ success: true, user: responseUser })
      } catch (txErr) {
        console.error('ST-10: Atomic permission update + AuditLog failed:', txErr)
        return NextResponse.json(
          { error: 'เกิดข้อผิดพลาดในการบันทึกสิทธิ์ — การเปลี่ยนแปลงถูกย้อนกลับ' },
          { status: 500 }
        )
      }
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
