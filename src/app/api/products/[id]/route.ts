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

// PATCH /api/products/[id] — update product (admin only)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 })
  }
  try {
    const { id } = await params
    const body = await request.json()
    const { name, defaultBuyPrice, categoryId, sortOrder } = body

    const data: any = {}
    if (name !== undefined) data.name = name
    if (defaultBuyPrice !== undefined) data.defaultBuyPrice = defaultBuyPrice
    if (categoryId !== undefined) data.categoryId = categoryId
    if (sortOrder !== undefined) data.sortOrder = sortOrder

    const product = await db.product.update({
      where: { id },
      data,
      include: { category: true },
    })
    return NextResponse.json({ product })
  } catch (error) {
    return NextResponse.json({ error: 'แก้ไขไม่สำเร็จ: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 500 })
  }
}

// DELETE /api/products/[id] — delete product (admin only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await requireAdmin(request)
  if (!admin) {
    return NextResponse.json({ error: 'ไม่มีสิทธิ์' }, { status: 403 })
  }
  try {
    const { id } = await params
    // Check if product has stock lots
    const stockCount = await db.stockLot.count({ where: { productId: id, remainingWeight: { gt: 0 } } })
    if (stockCount > 0) {
      return NextResponse.json({ error: 'ไม่สามารถลบได้ — สินค้านี้มีสต็อกอยู่' }, { status: 400 })
    }
    await db.product.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    return NextResponse.json({ error: 'ลบไม่สำเร็จ: ' + (error instanceof Error ? error.message : 'unknown') }, { status: 500 })
  }
}
