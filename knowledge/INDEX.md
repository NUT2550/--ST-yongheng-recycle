# Knowledge Index

> Searchable index of all knowledge records.
> Update this file when adding a new record.

## Incidents

| ID | Title | Area | Root Cause | Status |
|---|---|---|---|---|
| ERR-ST70-REVERSAL-ID | Sorting cancellation 500 from reversal identity collision | sorting-cancellation | Reversal copied persisted StockMovement.id | verified |
| ERR-ST69-AUTH-CONFLATION | 401/403 conflation in Buy/Sell/Transfer cancel routes | auth-cancellation | requireEditPermission returned null for both missing token and missing permission | verified |

## Invariants

| ID | Title | Area | Enforced By |
|---|---|---|---|
| INV-ST70-REVERSAL-IDENTITY | Reversal movements must have fresh IDs and idempotency keys | stock-movement-ledger | tests/st70-sorting-cancellation-history.test.ts |
| INV-ST70-ATOMIC-CANCEL | Sorting cancellation must be atomic with CAS-protected output lot deletion | sorting-cancellation | tests/st70-postgres-concurrency.test.ts |
| INV-ST75-IMPORT-RELIABILITY | Excel import must handle ambiguous transport, concurrent races, and malformed responses safely | import-reliability | tests/st75-p2-ambiguous-refresh.test.ts + tests/st75-import-postgres-production-path.test.ts |

## Decisions

| ID | Title | Area | Rationale |
|---|---|---|---|
| DEC-ST70-OUTPUT-DELETE | Output StockLots are atomically deleted on cancellation, not left untouched | sorting-cancellation | Owner decision: prevent stock divergence between StockLots and ledger |
| DEC-ST71-SHARED-AUTH | All cancel routes use shared resolveHistoryEditAuth helper | auth-cancellation | Consistency: 401 AUTH_REQUIRED vs 403 PERMISSION_DENIED across all bill types |
