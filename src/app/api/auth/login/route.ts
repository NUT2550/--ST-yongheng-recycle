import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCookieName } from '@/lib/auth'
import { loginController, type LoginDeps, type LoginInput } from '@/lib/route-controllers'

export async function POST(request: NextRequest) {
  // ST-42: Parse the JSON body separately so malformed/empty JSON returns a
  // safe 400 instead of falling through to the generic 500 catch (which
  // previously leaked `error.name: error.message`).
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { error: 'คำขอไม่ถูกต้อง กรุณาส่งข้อมูลในรูปแบบ JSON ที่ถูกต้อง' },
      { status: 400 }
    )
  }

  // Reject non-object bodies (e.g. JSON string, number, array) early so the
  // controller receives a shaped input.
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json(
      { error: 'คำขอไม่ถูกต้อง กรุณาส่งข้อมูลในรูปแบบ JSON ที่ถูกต้อง' },
      { status: 400 }
    )
  }

  try {
    // Wire the real Prisma adapter as the controller's deps.
    const deps: LoginDeps = {
      findUser: (username) =>
        db.user.findUnique({
          where: { username },
          select: {
            id: true,
            username: true,
            name: true,
            role: true,
            password: true,
            isActive: true,
            permissions: true,
          },
        }) as Promise<import('@/lib/route-controllers').LoginUser | null>,
    }

    const result = await loginController(deps, body as LoginInput)

    if (result.status !== 200 || !result.token) {
      return NextResponse.json(result.body, { status: result.status })
    }

    // Build response — include the token in the body so the client can
    // store it in localStorage and send it via the Authorization header.
    // (Cookie-only auth breaks inside cross-origin iframes like the
    // preview panel, where SameSite cookies get blocked.)
    const response = NextResponse.json(result.body, { status: result.status })

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
      value: result.token,
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7, // 7 days
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    // ST-42: Do not leak `error.name`/`error.message` in the response body.
    // Return a generic safe 500 — the detailed error is logged server-side.
    return NextResponse.json(
      { error: 'เกิดข้อผิดพลาดในการเข้าสู่ระบบ' },
      { status: 500 }
    )
  }
}
