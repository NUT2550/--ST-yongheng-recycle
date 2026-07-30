---
id: ERR-ST69-AUTH-CONFLATION
type: incident
status: verified
area: auth-cancellation
title: 401/403 conflation in Buy/Sell/Transfer cancel routes
date: 2026-07-30
issue: ST-69
pr: 51
commit: 132d21e13ccf5b9ccb9fbd5bc9235b1ee563a733
tags:
  - auth
  - 401
  - 403
  - cancellation
---

## Symptom

Buy/Sell/Transfer cancel routes returned HTTP 403 for both missing-token and
missing-permission cases. Clients could not distinguish "re-login needed" from
"permission denied."

## Root Cause

`requireEditPermission()` returned `null` for both:
- Missing/invalid token (should be 401)
- Valid token but missing `history.edit` permission (should be 403)

The handler then returned 403 for both cases.

## Fix

Extracted shared `resolveHistoryEditAuth` helper in `src/lib/cancel-auth.ts`
that returns a discriminated union:
- 401 `AUTH_REQUIRED` for no/invalid token
- 403 `PERMISSION_DENIED` for valid token without `history.edit`
- `{ ok: true, payload }` for authorized users

Applied to all 4 cancel routes (Buy, Sell, Transfer, Sorting).

## Files/Functions Affected

- `src/lib/cancel-auth.ts` — new shared helper
- `src/app/api/buy-bills/[id]/route.ts` — uses shared helper
- `src/app/api/sell-bills/[id]/route.ts` — uses shared helper
- `src/app/api/stock-transfers/[id]/route.ts` — uses shared helper
- `src/app/api/sorting-bills/[id]/route.ts` — refactored to use shared helper

## Regression Test

- `tests/st71-cancel-auth-regression.test.ts` — 11 tests covering 401/403 separation
- Production smoke: 8/8 HTTP checks passed (401 AUTH_REQUIRED for all 4 routes)

## Prevention Control

- CI: ST-71 targeted tests
- Production smoke workflow: `production-smoke.yml` checks 401 on all 4 cancel routes
- Decision: DEC-ST71-SHARED-AUTH

## Remaining Unknowns

- 403 PERMISSION_DENIED not yet tested in Production (requires STAFF_TOKEN_NO_HISTORY_EDIT secret)
