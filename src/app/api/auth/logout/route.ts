import { NextRequest, NextResponse } from 'next/server'
import { getCookieName } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ success: true })
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
    value: '',
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
