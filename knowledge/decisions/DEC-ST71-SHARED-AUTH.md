---
id: DEC-ST71-SHARED-AUTH
type: decision
status: active
area: auth-cancellation
title: All cancel routes use shared resolveHistoryEditAuth helper
date: 2026-07-30
issue: ST-71
pr: 51
commit: 132d21e13ccf5b9ccb9fbd5bc9235b1ee563a733
tags:
  - auth
  - 401
  - 403
  - cancellation
---

## Decision

All bill cancel/edit routes (Buy, Sell, Sorting, Transfer) use a single shared
`resolveHistoryEditAuth` helper (`src/lib/cancel-auth.ts`) that enforces
consistent 401/403 separation.

## Context

ST-70 first implemented `resolveAuth` inline in the Sorting cancel route to
fix the 401/403 conflation. Buy/Sell/Transfer routes still used the old
`requireEditPermission` pattern (returned null for both cases → 403 for both).

## Alternatives Considered

1. **Fix each route independently** — rejected because it duplicates the same
   auth logic 4 times, risking drift
2. **Middleware-based auth** — rejected as too broad for this bounded change
3. **Shared helper (chosen)** — extract `resolveHistoryEditAuth` to
   `src/lib/cancel-auth.ts`, import from `auth-core` (no `server-only` guard)

## Rationale

A single shared helper ensures:
- Consistent 401 AUTH_REQUIRED vs 403 PERMISSION_DENIED across all routes
- Single point of testing (11 regression tests cover all routes)
- No drift when auth behavior changes in the future
- `auth-core` import avoids `server-only` guard for test compatibility

## Impact

- Code: `src/lib/cancel-auth.ts` is the canonical auth helper for cancel routes
- Testing: `tests/st71-cancel-auth-regression.test.ts` — 11 tests
- Production: 8/8 HTTP checks passed (401 on all 4 routes)
- Future: any new cancel route should import and use this helper
