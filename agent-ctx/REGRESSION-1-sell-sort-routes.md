# REGRESSION-1 — Recreate sell-bills/route.ts & sorting-bills/route.ts

**Task ID**: REGRESSION-1
**Agent**: Main (subagent task)
**Date**: 2026-06-26
**Scope**: Recreate two API route files to match the secured pattern from `buy-bills/route.ts` (post-Task 16).

## Context

The pre-Task-16 versions of `sell-bills/route.ts` and `sorting-bills/route.ts` were missing:
- Authentication (`getTokenFromRequest` + `verifyToken`)
- Permission checks (`sell.create` / `sort.create`)
- `billNumber` generation (`SELL-2569-xxxxx` / `SORT-2569-xxxxx`)
- AuditLog writes on CREATE
- Strict server-side validation
- Pagination clamp on GET (page min 1, limit min 1 max 100)

I followed the pattern from the just-fixed `/home/z/my-project/src/app/api/buy-bills/route.ts`.

## Files edited

### 1. `/home/z/my-project/src/app/api/sell-bills/route.ts`

Kept existing `deductStockFIFO` helper verbatim.

**POST** — `/api/sell-bills`
- Auth: `getTokenFromRequest` → `verifyToken` → permission check `payload.role === 'admin' || payload.permissions?.['sell.create'] === true`. 401 if no token / invalid token, 403 if no permission.
- Validation: `items` required + non-empty; per-item `weight > 0`; per-item `pricePerKg > 0` (was `< 0` before — tightened to `<= 0` per task spec).
- Pre-validate stock availability for every item (returns friendly Thai error with product name + available/requested weights).
- Inside `db.$transaction`:
  1. FIFO deduction per item (existing helper).
  2. `generateBillNumber(tx, 'SELL')` → `SELL-2569-xxxxx`.
  3. `tx.sellBill.create` with `billNumber`, includes items + customer.
  4. If `isCredit`, create `CreditEntry` (RECEIVABLE) with description `ใบขาย {billNumber}` (was using `bill.id` before — now uses bill number for consistency with buy-bills).
  5. `writeAuditLog` CREATE with `{ billNumber, totalAmount, totalCost, itemCount, isCredit, customerId }`.
- Returns `{ bill }` 201.

**GET** — `/api/sell-bills`
- Auth: any authenticated user (401 if no token / invalid token).
- Pagination clamp: `page = Math.max(1, …)`, `limit = Math.min(100, Math.max(1, …))`.
- Returns `{ bills, total }` with items + customer.

### 2. `/home/z/my-project/src/app/api/sorting-bills/route.ts`

Kept existing `deductStockFIFO` helper verbatim.

**POST** — `/api/sorting-bills`
- Auth: `getTokenFromRequest` → `verifyToken` → permission check `payload.role === 'admin' || payload.permissions?.['sort.create'] === true`. 401/403 same as sell.
- Validation: `items` required + non-empty; `sourceWeight` must be a number > 0 (message tightened to Thai `น้ำหนักต้นทางต้องมากกว่า 0`).
- Pre-validate source product stock availability (same Thai error format).
- Inside `db.$transaction`:
  1. FIFO deduction of source product (existing helper).
  2. Compute `lossWeight = sourceWeight - sum(item.weight)` (rounded).
  3. Compute `lossCost = lossWeight * sourceCostPerKg`.
  4. Build `sortingItems` array (waste items zeroed).
  5. `generateBillNumber(tx, 'SORT')` → `SORT-2569-xxxxx`.
  6. `tx.sortingBill.create` with `billNumber`, includes sourceProduct + items.
  7. For each non-waste item with weight > 0, create `StockLot` (source: `'SORTING'`).
  8. `writeAuditLog` CREATE with `{ billNumber, sourceProductId, sourceWeight, sourceCostPerKg, lossWeight, lossCost, itemCount, nonWasteItemCount }`.
- Returns `{ bill }` 201.

**GET** — `/api/sorting-bills`
- Auth: any authenticated user (401 if no token / invalid token).
- Pagination clamp: same as sell (`page min 1`, `limit min 1 max 100`).
- Returns `{ bills, total }` with sourceProduct + items.

## Pattern consistency with buy-bills/route.ts

| Concern | buy-bills (reference) | sell-bills (new) | sorting-bills (new) |
|---|---|---|---|
| Auth header parse | `getTokenFromRequest` | ✓ same | ✓ same |
| Token verify | `verifyToken` | ✓ same | ✓ same |
| Permission key | `buy.create` | `sell.create` | `sort.create` |
| billNumber generation | `generateBillNumber(tx, 'BUY')` | `generateBillNumber(tx, 'SELL')` | `generateBillNumber(tx, 'SORT')` |
| Audit log helper | `writeAuditLog` | ✓ same | ✓ same |
| Transaction wrapper | `db.$transaction(async (tx) => …)` | ✓ same | ✓ same |
| GET pagination clamp | `Math.max(1, …)` / `Math.min(100, …)` | ✓ same | ✓ same |
| GET auth | any authenticated user | ✓ same | ✓ same |

## What I did NOT change

- The `[id]` route files (`sell-bills/[id]/route.ts`, `sorting-bills/[id]/route.ts`) — they were already correct per task spec.
- Any UI / component files.
- The `deductStockFIFO` helper logic in either file (kept verbatim).
- `prisma/schema.prisma` (no schema change needed — `billNumber` field is already on `SellBill` and `SortingBill`).
- `src/lib/bill-helpers.ts` and `src/lib/auth.ts` (already correct).
- No git push / commit / deploy.

## Verification

### `npx tsc --noEmit`
Ran across the whole project. Only errors reported are pre-existing and **unrelated** to my changes:
- `examples/websocket/frontend.tsx` — missing `socket.io-client` types (examples folder, not part of main app).
- `examples/websocket/server.ts` — missing `socket.io` types.
- `skills/image-edit/scripts/image-edit.ts` — SDK type mismatch in skill scaffold.
- `skills/stock-analysis-skill/src/analyzer.ts` — SDK type mismatch in skill scaffold.

**Zero TypeScript errors** in `src/app/api/sell-bills/route.ts` and `src/app/api/sorting-bills/route.ts`.

### `bun run lint` (eslint .)
Exit code **0** — clean. No warnings, no errors.

Also ran `npx eslint src/app/api/sell-bills/route.ts src/app/api/sorting-bills/route.ts` directly → exit 0.

## Notes / Pre-existing env issue (NOT caused by my changes)

`/home/z/my-project/.zscripts/dev.log` shows `bun run db:push` failing with `P1001 Can't reach database server at localhost:5432`. This is the same Supabase sandbox-network issue documented in worklog Task 7 — the `prisma/schema.prisma` provider is `postgresql` but TCP 5432 is blocked from the sandbox. This affects DB availability but is unrelated to my route file edits; lint + tsc both pass without DB access.

## Summary

Both routes now match the secured buy-bills pattern: auth → permission check → validation → transaction with FIFO + billNumber + CreditEntry (sell only) + StockLots (sort only) + audit log → return bill. Pagination on GET is clamped. No UI files touched, no [id] routes touched, no commit/push.
