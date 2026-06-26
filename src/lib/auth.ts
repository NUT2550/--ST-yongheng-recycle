import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import bcrypt from 'bcryptjs'
import { TOKEN_STORAGE_KEY } from './auth-constants'

export { TOKEN_STORAGE_KEY }

// JWT secret MUST be provided via environment variable.
// Never fall back to a hardcoded value — that would allow attackers to forge
// tokens if the env var is missing. Fail fast at module load instead.
const JWT_SECRET_STRING = process.env.JWT_SECRET
if (!JWT_SECRET_STRING) {
  throw new Error(
    'JWT_SECRET environment variable is required. Set it in .env or Vercel env vars.'
  )
}
const JWT_SECRET = new TextEncoder().encode(JWT_SECRET_STRING)

const COOKIE_NAME = TOKEN_STORAGE_KEY

export interface JWTPayload {
  userId: string
  username: string
  name: string
  role: 'admin' | 'staff'
  permissions?: Record<string, boolean>
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

// Verify password
export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword)
}

// Create JWT token
export async function createToken(payload: JWTPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(JWT_SECRET)
}

// Verify JWT token
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

// Get cookie name
export function getCookieName(): string {
  return COOKIE_NAME
}

// Parse cookie from request headers
export function getTokenFromCookies(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null
  const cookies = cookieHeader.split(';')
  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === COOKIE_NAME) {
      return value
    }
  }
  return null
}

// Extract token from a request, preferring the Authorization header (Bearer)
// and falling back to the auth_token cookie. This makes auth work in both:
//   - direct browser access (cookie)
//   - cross-origin iframes where SameSite cookies may be blocked (header)
export function getTokenFromRequest(request: Request): string | null {
  // 1) Authorization: Bearer <token>
  const authHeader = request.headers.get('authorization') || request.headers.get('Authorization')
  if (authHeader) {
    const match = authHeader.match(/^Bearer\s+(.+)$/i)
    if (match) return match[1].trim()
  }
  // 2) Cookie fallback
  const cookieHeader = request.headers.get('cookie')
  if (cookieHeader) {
    return getTokenFromCookies(cookieHeader)
  }
  return null
}
