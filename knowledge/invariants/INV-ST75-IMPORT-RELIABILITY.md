---
id: INV-ST75-IMPORT-RELIABILITY
type: invariant
status: active
area: import-reliability
title: Excel import must handle ambiguous transport, concurrent races, and malformed responses safely
date: 2026-08-19
issue: ST-75
pr: 81
commit: 3eab22c
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

### Detailed Contracts

#### 1. AMBIGUOUS TRANSPORT

After /api/import/apply has been dispatched:

- 429
- 5xx
- network/transport uncertainty

=> AMBIGUOUS_RESULT

Never FAILED_CONFIRMED merely because the response was unavailable.

#### 2. MALFORMED 2XX

Malformed or semantically invalid HTTP 2xx summary:

=> AMBIGUOUS_RESULT

The malformed summary must:

- NOT be stored in applyResult
- NOT be dereferenced afterward
- NOT be passed to onApplied
- cause safe early return
- trigger bounded authoritative READ reconciliation

No POST mutation retry.

#### 3. DISPATCHED RESULT COUNT

For a valid 2xx apply response, the accounted bill-result count must equal the
ACTUAL number dispatched:

billsToApply.length

Current accounting contract:

importedBills.length
+ skippedDuplicateBills.length
+ failedBills.length
=== billsToApply.length

Mismatch in either direction:

=> AMBIGUOUS_RESULT

Examples:

expected 3 / returned 0 => ambiguous
expected 3 / returned 2 => ambiguous
expected 3 / returned 4 => ambiguous

Do not guess missing bill outcomes.

#### 4. NO MUTATION RETRY

Never automatically retry:

POST /api/import/apply

after an ambiguous result.

Reconciliation retries are GET/read refreshes only.

#### 5. BOUNDED AUTHORITATIVE RECONCILIATION

AMBIGUOUS_RESULT schedules immediate + bounded delayed authoritative READ
refreshes.

Refreshes must remain serialized/coalesced so:

- overlapping authoritative refreshes do not race unsafely
- a required fresh refresh is not silently dropped
- stale older responses cannot overwrite newer authoritative stock state

#### 6. AUTH SEMANTICS

401 => SESSION_EXPIRED
403 => PERMISSION_DENIED

429 / 5xx after mutation dispatch => AMBIGUOUS_RESULT

Do not conflate these states.

#### 7. DUPLICATE PROVENANCE

Clearly distinguish:

A. ordinary pre-existing duplicate found by the initial lookup

from:

B. duplicate confirmed AFTER create failure / concurrent winner

Every create failure with a nonblank normalized external bill number must
perform bounded authoritative:

loadExistingBillNumbers(type, [norm])

before converting the result to a reconciled DUPLICATE_EXISTING.

Direct P2002 / DuplicateExistingError alone is NOT sufficient proof.

Only confirmed post-failure existence may set:

reconciledAfterFailure: true

If lookup fails or finds nothing:
preserve the original safe failure classification.

#### 8. reconciledAfterFailure VALIDITY

reconciledAfterFailure=true is valid only for the appropriate:

DUPLICATE_EXISTING

post-failure reconciliation result.

Invalid combinations must be rejected, including:

DUPLICATE_IN_FILE + true
READY + true
FAILED + true

Ordinary DUPLICATE_EXISTING without the marker remains valid for a normal
pre-existing duplicate.

#### 9. SALES PRODUCT REFRESH

Sales post-import authoritative reconciliation uses:

refreshProductsAfterImport

not customer-dependent loadData.

Slow/failed customer loading must not block fresh stock/product state.

#### 10. PRODUCTION CAS

Concurrent Sales correctness uses the shared production:

executeStockLotBulkCas

PostgreSQL CI must exercise the real CAS implementation.

A concurrent loser must safely produce:

SOURCE_LOT_CONFLICT

where that CAS race is intended.

No double stock deduction.
No negative inventory.
Exactly one effective business mutation.

#### 11. CLOSE GUARD

All modal dismissal paths are blocked while the critical import write is
running:

X
Cancel
Escape
outside click

The UI must not silently hide an in-flight critical write.

#### 12. PRODUCTION VERIFICATION

Retain clearly:

Automated/local/isolated PostgreSQL CI evidence:
VERIFIED

Production import verification:
NOT PERFORMED / NOT VERIFIED

Do not upgrade Production status.

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

- **Automated tests**:
  - tests/st75-p2-ambiguous-refresh.test.ts (ambiguous transport, malformed 2xx, dispatch count, bounded refresh serialization)
  - tests/st75-import-state-helper.test.ts (classifyImportOutcome, isValidImportSummary, duplicate provenance, reconciledAfterFailure validity)
  - tests/st75-post-ready-fixes.test.ts (auth semantics, close guard)
  - tests/st75-defect-fix-validation.test.ts (regression coverage for ST-70/71/72/73/74)
  - tests/st75-sales-refresh-independence.test.ts (product-only Sales reconciliation)
  - tests/st75-import-postgres-production-path.test.ts (PostgreSQL CI, CAS concurrency, C3 barrier, SOURCE_LOT_CONFLICT)
  - tests/st75-import-reliability-audit.test.ts (audit trail, stock integrity)
- **CI workflows**: ST-75 PostgreSQL Import (zero-skip, C1/C2/C3, response-lost), CI (lint, tsc, unit, build, foundation validation)
- **Code patterns**: classifyImportOutcome pure function, isValidImportSummary runtime validator, scheduleAmbiguousRefresh bounded helper, runTrackedRefresh serialized refresh wrapper, refreshProductsAfterImport product-only Sales callback

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

Runtime behavior documented here was verified at exact code head
3eab22cd1971500ace084d899b63c2294fb8fe20.
A later documentation-only commit does not change runtime behavior.

ST-75 small/medium/large before/after performance acceptance evidence is
recorded in PR #81 comment #5344449877 using historical/current isolated
PostgreSQL CI runs. This is not a performance optimization claim and not
Production verification.