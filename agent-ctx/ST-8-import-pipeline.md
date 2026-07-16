# ST-8 — Safe partial-success import pipeline

**Task ID**: ST-8
**Agent**: Main (full-stack implementation; no merge / deploy / migrate / Prod-write)
**Branch**: `st-8-import-pipeline` (worktree `/tmp/st8-fix`)
**Base**: `origin/main` @ `0e5f28e`
**Head**: see `git log -1` on branch

## Goal

Build a safe partial-success Excel import pipeline. The key principle:
**duplicates are SKIPPED, not blocking**. One duplicate must NOT fail the
entire batch. Valid non-duplicate bills proceed.

## Files changed

### NEW
- `src/lib/import-pipeline.ts` (564 lines) — pure helpers + injectable-deps apply controller
  - `normalizeBillNumber(value)` — trim, NFC, collapse Unicode whitespace, preserve case + `/` + `-` + leading zeroes
  - `classifyBillStatus(bill)` — INVALID / UNMATCHED_PRODUCT / READY (pre-classification)
  - `detectInFileDuplicates(bills)` — first-occurrence policy, later occurrences flagged
  - `buildImportSummary(results)` — pure aggregation → ImportSummary
  - `categorizeBillsForPreview` / `countByCategory` / `shouldEnableApply` — UI helpers (pure)
  - `applyImport(type, bills, deps, actor)` — partial-success controller with per-bill try/catch
  - `ImportApplyDeps` interface: `findExistingBillNumber`, `checkStockAvailability` (sales only), `createPurchaseBill`, `createSalesBill`

- `src/app/api/import/check-duplicates/route.ts` (114 lines)
  - POST `{ billNumbers, type }` → `{ existing: string[] }`
  - Batched DB query (replaces per-bill `/api/buy-bills?externalBillNumber=X` calls)
  - Uses `normalizeBillNumber` for client=server comparison consistency

- `src/app/api/import/apply/route.ts` (406 lines)
  - POST `{ type, bills }` → `ImportSummary`
  - Thin adapter → calls `applyImport(type, bills, deps, actor)`
  - Production deps provided: `findExistingBillNumber`, `checkStockAvailability`, `createPurchaseBill`, `createSalesBill`
  - Purchase creation mirrors `/api/buy-bills` POST (BuyBill + BuyBillItems + StockLots + AuditLog in ONE `$transaction`)
  - Sales creation mirrors `/api/sell-bills` POST (SellBill + SellBillItems + FIFO deduction + AuditLog in ONE `$transaction`)
  - `deductStockFIFOTx` (tx-scoped) — preserves ST-11 atomic rollback (any failure rolls back ALL lot updates + the bill)
  - FIFO_ORDER_BY = `{ dateAdded: 'asc' }` (consistent with existing sell-bills + stock-transfers routes)

- `tests/st8-import-pipeline.test.ts` (1151 lines) — 59 tests
  - 1-7 (+7b, 7c): `normalizeBillNumber` (trim, leading zeroes, multi-line, blank=invalid, Thai, deterministic, case-sensitive, special chars, isBlank helper)
  - 8-15 (+15b-15e): duplicate detection (existing, in-file, first-occurrence policy, batch lookup, preview=apply normalization, concurrent, in-file count, blank non-dup, applyImport classification, classifyBillStatus branches)
  - 16-22 (+22b): Purchase apply (mixed batch, duplicate zero-write, valid creates, failed no-orphan, idempotent re-upload, invalid, unmatched, in-file dup)
  - 23-30 (+30b): Sales apply (mixed batch, duplicate zero-deduction, insufficient-stock skip, valid FIFO once, no negative stock, failure rollback, idempotent, all categories, stock-check gating)
  - 31-38 (+38b, 38c): UI behavior (preview categories, duplicate visibility, apply READY only, skipped not fatal, result matches, empty READY disables, double-submit blocked, re-preview safe, countByCategory)
  - Integration: A-G (large mixed batch, all duplicates, findExisting throws, checkStock throws, JSON-serializable, order preservation, normalize+detect combo)
  - `buildImportSummary` direct unit tests (4 cases)
  - All tests use synthetic fixtures + mock deps with simulated DB state. No Production data.

### MODIFIED
- `src/components/detailed-excel-import-dialog.tsx` (621 → 813 lines)
  - Replaced per-bill `/api/buy-bills?externalBillNumber=X` with batch `/api/import/check-duplicates`
  - `hasBlockers` removed — duplicates no longer block (Apply enabled when readyCount > 0)
  - Preview shows 6 categories: ready, duplicate-existing, duplicate-in-file, invalid, unmatched, (insufficient-stock hidden for purchase)
  - Duplicate bill numbers shown as visible badge list
  - Apply calls `/api/import/apply` directly (no longer calls `onImport(bills)` for parent to loop-create)
  - Structured apply result panel: imported / skipped-dup-existing / skipped-dup-in-file / failed
  - Loading + double-submit protection (Apply disabled while `importing || loading`)
  - New optional `onApplied?: (summary) => void` prop for parent to refresh data
  - `onImport` kept optional for backward compat (called with `[]` after apply)

- `src/components/detailed-sell-excel-import-dialog.tsx` (557 → 848 lines)
  - Same changes as Purchase, plus:
  - 7-category preview (adds insufficient-stock)
  - Client-side stock pre-check using `product.stock.totalWeight` from products list
  - Bills with insufficient stock shown with itemized shortfall (product name, requested, available)
  - Sales apply uses FIFO pre-check at apply time + per-bill try/catch (preserves ST-11 atomic rollback per bill)

## normalizeBillNumber examples

| Input | Output | Notes |
|---|---|---|
| `'  A1051492  '` | `'A1051492'` | trims |
| `'A0001234'` | `'A0001234'` | preserves leading zeroes |
| `'A1051492\nA1051493'` | `'A1051492 A1051493'` | multi-line → single space |
| `''`, `'   '`, `null`, `undefined`, `123` | `''` | blank/invalid |
| `'บิล-A1051492'` | `'บิล-A1051492'` | Thai preserved |
| `'a1051492'` | `'a1051492'` | case preserved (≠ `'A1051492'`) |
| `'A-1051492'`, `'A/1051492'`, `'INV-2026-001'` | unchanged | special chars preserved |
| `'  A1051492\t'` | `'A1051492'` | tab → space → trim |

## Verification

- `bunx tsc --noEmit` → **exit 0**
- `bun run lint` → **exit 0**
- `bun test` → **513 pass / 0 fail** (454 baseline + 59 new ST-8 tests)
- `git status` → clean working tree (only intended changes)

## Safety

- No merge, no deploy, no `db:push`, no migrations applied
- No Production DB writes (only test fixtures, no real DB calls in tests)
- No schema changes (`BuyBill.externalBillNumber @unique` and `SellBill.externalBillNumber @unique` unchanged)
- Worktree isolated at `/tmp/st8-fix` — main worktree at `/home/z/my-project` untouched
- Branch `st-8-import-pipeline` created from `origin/main @ 0e5f28e`
- Commit message includes "ST-8" — NOT pushed

## Architecture decisions

1. **Pure helpers + injectable controller** (same pattern as ST-10's `route-controllers.ts` and ST-35's `daily-weighing-controller.ts`). Tests call the same `applyImport` function the route uses — no duplicated logic.

2. **`normalizeBillNumber` is minimal**: only whitespace + NFC. Does NOT mutate case, does NOT strip characters. This is intentional — bill numbers are case-sensitive identifiers (verified against existing data per task spec).

3. **Per-bill try/catch is in `applyImport` (controller)**, NOT in the route handler. This keeps the route handler thin (just auth + body parsing + adapter) and the controller testable with mock deps.

4. **`findExistingBillNumber` is per-bill** (not batched at apply time). The batched check is only for preview. At apply time, we re-check each bill individually right before creating it — this is the concurrency protection (another process may have created it between preview and apply). The per-bill check accepts the slight overhead in exchange for stronger correctness.

5. **ST-11 compensation preserved**: each bill's creation runs inside its own `db.$transaction`. If anything inside the transaction throws (e.g., FIFO mid-loop failure, unique constraint violation), the ENTIRE transaction rolls back — no partial deduction state. The per-bill try/catch (in `applyImport`) catches the rolled-back error and classifies the bill as FAILED/INSUFFICIENT_STOCK — the rest of the batch continues. This is functionally equivalent to ST-11's compensation ledger for the import-pipeline use case (each bill is independent, no shared state between bills).

6. **`onImport` prop kept for backward compat** (called with `[]` after apply). Parent components (`buy-page`, `sell-page`) still work without changes. New `onApplied?: (summary) => void` prop added for parents that want to refresh data after apply.
