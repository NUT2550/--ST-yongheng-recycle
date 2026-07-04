# Task 13 — Security Vulnerability Fixes

**Agent**: security-fixer (GLM)
**Date**: 2025-06-23
**Task**: Fix CRITICAL security vulnerabilities found by code-reviewer skill

## Summary

Fixed all 3 issues from the code review:

### CRITICAL Issue 1 — 14 API routes had NO auth (FIXED)
Added authentication checks to all listed routes. Used the pattern from `src/app/api/products/route.ts` (`requireAdmin`) and `src/app/api/buy-bills/[id]/route.ts` (`requireEditPermission`).

- **any-auth**: dashboard, stock, customers (GET/POST), employees GET, bonuses GET, bonus-calculation, credit GET, buy-bills/sell-bills/sorting-bills GET, excel/parse POST, credit/[id]/pay POST (additional fix)
- **admin-only**: bonuses POST, bonuses/[id] PATCH/DELETE, employees POST
- **permission-based**: buy-bills POST (`buy.create`), sell-bills POST (`sell.create`), sorting-bills POST (`sort.create`)

### CRITICAL Issue 2 — JWT_SECRET hardcoded fallback (FIXED)
`src/lib/auth.ts` line 4-6 had `process.env.JWT_SECRET || 'yongheng-recycle-secret-key-change-in-production-2024'`. Replaced with fail-fast throw if env var is missing. Verified `.env` has `JWT_SECRET` set, dev server boots fine.

### HIGH Issue 3 — N+1 query in buy-bills POST (FIXED)
The for-loop `await db.stockLot.create({...})` was:
1. N+1 (10 items = 10 DB calls)
2. NOT in a transaction (bill created without stock if loop fails)

Fix: wrapped the whole bill creation in `db.$transaction(async (tx) => {...})` and replaced the loop with `tx.stockLot.createMany({ data: created.items.map(...) })`. Bonus: also moved the `creditEntry.create` inside the transaction so everything is atomic.

## Additional fix beyond scope
`src/app/api/credit/[id]/pay/route.ts` POST (record credit payment) was also unauthenticated — same critical vuln in the credit namespace. Added any-auth check. Documented in worklog.

## Verification
- `npx tsc --noEmit` → 0 errors
- `bun run lint` → clean
- Dev server: `/` returns 200; all 17 protected endpoints return 401 without auth (10 GET + 7 POST)
- `/api/auth/login` correctly stays public (returns 400 for empty body, not 401)

## Pre-existing issue (NOT caused by this work)
DATABASE_URL in `.env` is `file:...` (SQLite) but `prisma/schema.prisma` provider is `postgresql` → PrismaClientInitializationError in sandbox. Auth checks return 401 BEFORE hitting DB so they work correctly regardless. Production (Vercel + Supabase) uses real `postgresql://` URL so this is sandbox-only.

## Files modified (14 total)
1. `src/lib/auth.ts`
2. `src/app/api/buy-bills/route.ts`
3. `src/app/api/sell-bills/route.ts`
4. `src/app/api/sorting-bills/route.ts`
5. `src/app/api/bonuses/route.ts`
6. `src/app/api/bonuses/[id]/route.ts`
7. `src/app/api/credit/route.ts`
8. `src/app/api/credit/[id]/pay/route.ts`
9. `src/app/api/customers/route.ts`
10. `src/app/api/dashboard/route.ts`
11. `src/app/api/employees/route.ts`
12. `src/app/api/stock/route.ts`
13. `src/app/api/bonus-calculation/route.ts`
14. `src/app/api/excel/parse/route.ts`
