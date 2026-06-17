import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyPassword, createToken, getCookieName } from '@/lib/auth'

export async function POST(request: NextRequest) {
  try {
    const { username, password } = await request.json()

    if (!username || !password) {
      return NextResponse.json(
        { error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' },
        { status: 400 }
      )
    }

    const user = await db.user.findUnique({
      where: { username },
    })

    if (!user || !user.isActive) {
      return NextResponse.json(
        { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' },
        { status: 401 }
      )
    }

    const valid = await verifyPassword(password, user.password)
    if (!valid) {
      return NextResponse.json(
        { error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' },
        { status: 401 }
      )
    }

    const token = await createToken({
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role as 'admin' | 'staff',
    })

    // Build response — include the token in the body so the client can
    // store it in localStorage and send it via the Authorization header.
    // (Cookie-only auth breaks inside cross-origin iframes like the
    // preview panel, where SameSite cookies get blocked.)
    const response = NextResponse.json({
      success: true,
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    })

    // Also set the auth cookie as a fallback (used for direct browser
    // navigation / when localStorage is cleared).
    const host = request.headers.get('host') || ''
    const isLocalhost =
      host.startsWith('localhost:') ||
      host.startsWith('127.0.0.1:') ||
      host.startsWith('::1:')
    const forwardedProto = request.headers.get('x-forwarded-proto') || ''
    const isHttps =
      request.nextUrl.protocol === 'https:' ||
      forwardedProto === 'https' ||
      !isLocalhost
    response.cookies.set({
      name: getCookieName(),
      value: token,
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' },
      { status: 500 }
    )
  }
}
