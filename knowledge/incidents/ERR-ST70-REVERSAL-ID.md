---
id: ERR-ST70-REVERSAL-ID
type: incident
status: verified
area: sorting-cancellation
title: Sorting cancellation 500 from reversal identity collision
date: 2026-07-24
issue: ST-70
pr: 49
commit: de9848e1f3d634b4c47eb9f529626f4bd0c8aff7
tags:
  - postgres
  - reversal
  - stock-integrity
  - sorting
---

## Symptom

DELETE /api/sorting-bills/{id} returned HTTP 500. The error was caused by a
database constraint violation when creating StockMovement reversal rows.

## Root Cause

The reversal draft copied the persisted `StockMovement.id` from the original
movement. The attempted reversal therefore had the same identity as the
`reversalOfId` reference, violating the self-referential FK constraint on
`StockMovement.reversalOfId`.

## Fix

`buildReversalMovement` in `src/lib/stock-movement-ledger.ts` was modified to:
- Never copy the persisted movement `id`
- Set `reversalOfId = original.id` (reference, not copy)
- Generate a fresh `idempotencyKey` = `stock-ledger-v1:CANCELLATION_REVERSAL:<originalId>`

## Files/Functions Affected

- `src/lib/stock-movement-ledger.ts` — `buildReversalMovement()` — fresh ID + idempotency key
- `src/lib/stock-movement-reversal.ts` — `reverseSourceMovements()` — uses buildReversalMovement
- `src/lib/sorting-cancellation-service.ts` — `cancelSortingBill()` — atomic transaction with reversal

## Regression Test

- `tests/st70-sorting-cancellation-history.test.ts` — `buildReversalMovement never copies the persisted movement id`
- `tests/st70-sorting-cancellation-history.test.ts` — `reverseSourceMovements submits fresh reversal rows linked to each original`
- `tests/st70-postgres-concurrency.test.ts` — 14 concurrency tests with real PostgreSQL

## Prevention Control

- CI: ST-70 targeted tests + PostgreSQL concurrency workflow
- Invariant: INV-ST70-REVERSAL-IDENTITY
- Code pattern: `buildReversalMovement` is the single function that constructs reversal rows

## Remaining Unknowns

- Whether legacy bills (created before ST-70) have StockMovements without `sourceCostPerKg` metadata
- Whether the original incident bill (SORT-2569-00161) needs manual cleanup
