---
id: INV-ST70-REVERSAL-IDENTITY
type: invariant
status: active
area: stock-movement-ledger
title: Reversal movements must have fresh IDs and idempotency keys
date: 2026-07-24
issue: ST-70
pr: 49
commit: de9848e1f3d634b4c47eb9f529626f4bd0c8aff7
tags:
  - reversal
  - idempotency
  - stock-integrity
---

## Invariant Statement

Every `CANCELLATION_REVERSAL` or `COMPENSATION_REVERSAL` StockMovement must:
1. Have a database-generated `id` (never copied from the original)
2. Have a `reversalOfId` that references the original movement's `id`
3. Have a fresh `idempotencyKey` in the format `stock-ledger-v1:<KIND>:<originalId>`

## Rationale

If a reversal copies the original's `id`, it violates the self-referential FK
constraint on `StockMovement.reversalOfId` (a row cannot reference itself as
its own reversal). This caused HTTP 500 in ST-70.

## Enforcement

- `buildReversalMovement()` in `src/lib/stock-movement-ledger.ts` is the single
  function that constructs reversal rows — it never copies the `id` field
- `tests/st70-sorting-cancellation-history.test.ts` — 2 tests verify reversal identity
- `tests/st70-postgres-concurrency.test.ts` — 14 tests verify with real PostgreSQL

## Violation Consequences

- HTTP 500 on cancellation attempts
- StockMovement ledger inconsistency
- Potential duplicate reversal rows if retried
- Stock balance may diverge from ledger
