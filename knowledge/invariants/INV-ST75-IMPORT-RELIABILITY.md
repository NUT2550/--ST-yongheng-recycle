---
id: INV-ST75-IMPORT-RELIABILITY
type: invariant
status: active
area: import-reliability
title: Excel import must handle ambiguous transport, concurrent races, and malformed responses safely
date: 2026-08-18
issue: ST-75
pr: 81
commit: fdb3d23
tags:
  - import
  - auth
  - stock
  - cas
  - refresh
  - ambiguity
---

## Invariant Statement

The Excel import apply flow (Purchase + Sales) must:

1. **Classify transport ambiguity correctly**: 429/5xx after /api/import/apply
   dispatch → AMBIGUOUS_RESULT (never FAILED_CONFIRMED). Network error after
   dispatch → AMBIGUOUS_RESULT. Malformed 2xx summary → AMBIGUOUS_RESULT.
2. **Never auto-retry the POST mutation**: Reconciliation retries are GET/read
   refreshes only. No automatic re-dispatch of /api/import/apply.
3. **Bounded delayed reconciliation**: After AMBIGUOUS_RESULT, schedule
   immediate + bounded delayed GET/read refreshes (default 1.5s, 4s). Refreshes
   are serialized — no overlapping authoritative fetches.
4. **Preserve auth semantics**: 401 → SESSION_EXPIRED (clear token).
   403 → PERMISSION_DENIED (preserve session). 429/5xx → preserve session.
5. **Validate before storing**: classifyImportOutcome runs BEFORE
   setApplyResult. Malformed summaries are NOT stored in UI state.
6. **Distinguish duplicate provenance**: Ordinary pre-existing duplicates
   (found in initial lookup) → FAILED_CONFIRMED. Post-failure reconciled
   duplicates (reconciledAfterFailure: true) → PARTIAL_SUCCESS (concurrent
   winner may have committed stock).
7. **Product-only Sales reconciliation**: Sales onRefreshAfterImport uses
   refreshProductsAfterImport (product-only), NOT loadData (which waits for
   customers). A slow customer fetch must NOT block stock reconciliation.
8. **CAS concurrency**: Production executeStockLotBulkCas is exercised in
   PostgreSQL CI tests. C3 barrier synchronizes both transactions' source-lot
   reads before either CAS update. Loser fails with SOURCE_LOT_CONFLICT,
   not INSUFFICIENT_STOCK.
9. **Close guard**: handleOpenChange blocks all close paths (X, Cancel,
   Escape, outside click) while importOutcome === 'IMPORTING'.

## Rationale

Excel import is a high-risk partial-write operation. Multiple bills are
created per-bill in sequential transactions. Transport failures (429/5xx,
network drops) can occur after the server has committed some bills but
before the client receives the response. Without the above invariants:

- UI can display stale stock after a committed-but-ambiguous import
- Concurrent duplicate imports can double-deduct stock
- Malformed API responses can crash the UI (applyResult.failedBills.map)
- Slow customer fetches can indefinitely block stock reconciliation
- Ordinary duplicates can falsely trigger refresh (wasting API calls)

## Enforcement

- **Automated tests**: tests/st75-p2-ambiguous-refresh.test.ts (170+ tests),
  tests/st75-import-state-helper.test.ts, tests/st75-post-ready-fixes.test.ts,
  tests/st75-import-postgres-production-path.test.ts (PostgreSQL CI),
  tests/st75-import-reliability-audit.test.ts
- **CI workflows**: ST-75 PostgreSQL Import (zero-skip, C1/C2/C3, response-lost),
  CI (lint, tsc, unit, build, foundation validation)
- **Code patterns**: classifyImportOutcome pure function, isValidImportSummary
  runtime validator, scheduleAmbiguousRefresh bounded helper,
  runTrackedRefresh serialized refresh wrapper, refreshProductsAfterImport
  product-only Sales callback

## Violation Consequences

- **Stock integrity**: Double-deduction if CAS guard fails; stale stock
  display if reconciliation is blocked by customer fetch
- **Cost calculation**: Incorrect cost basis if CAS conflict allows
  duplicate FIFO deduction
- **History/audit**: Missing or duplicate StockMovement records if
  per-bill atomicity is violated
- **User-facing**: Modal stuck open (IMPORTING never transitions);
  crash from malformed summary rendering; false "success" claim from
  ambiguous transport

## Verification Status

- **Automated/local/CI PostgreSQL evidence**: VERIFIED
- **Production import verification**: NOT PERFORMED / NOT VERIFIED
