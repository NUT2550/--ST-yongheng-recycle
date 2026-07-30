---
id: INV-ST70-ATOMIC-CANCEL
type: invariant
status: active
area: sorting-cancellation
title: Sorting cancellation must be atomic with CAS-protected output lot deletion
date: 2026-07-24
issue: ST-70
pr: 49
commit: de9848e1f3d634b4c47eb9f529626f4bd0c8aff7
tags:
  - atomic
  - cas
  - stock-integrity
  - sorting
---

## Invariant Statement

SortingBill cancellation must:
1. Execute all reads, claim, output-lot deletion, source restoration, bonus
   deletion, reversal, and audit in a single Prisma transaction
2. Use atomic compare-and-delete (CAS) for output StockLots — each lot is
   deleted only if `(id, productId, remainingWeight)` matches the read values
3. Fail closed with HTTP 409 if any CAS guard fails — transaction rolls back
   every mutation

## Rationale

Without CAS protection, a concurrent sale/transfer/sort can modify an output
lot between the read and delete, causing the cancellation to delete a
modified lot and restore the full source — resulting in stock divergence.

## Enforcement

- `cancelSortingBill()` in `src/lib/sorting-cancellation-service.ts` — single transaction
- `atomicDeleteOutputLots()` — per-lot CAS delete with `(id, productId, remainingWeight)`
- `tests/st70-postgres-concurrency.test.ts` — tests 6 and 8 verify CAS protection with real PostgreSQL

## Violation Consequences

- Stock divergence: output lots deleted after being consumed downstream
- Source stock restored even when cancellation should have been rejected
- Ledger does not match StockLot balances
- Financial cost tracking becomes unreliable
