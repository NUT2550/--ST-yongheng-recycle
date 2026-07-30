---
id: DEC-ST70-OUTPUT-DELETE
type: decision
status: active
area: sorting-cancellation
title: Output StockLots are atomically deleted on cancellation, not left untouched
date: 2026-07-25
issue: ST-70
pr: 49
commit: de9848e1f3d634b4c47eb9f529626f4bd0c8aff7
tags:
  - sorting
  - cancellation
  - stocklot
---

## Decision

On SortingBill cancellation, output StockLots (source='SORTING', sourceId=bill.id)
are atomically deleted inside the cancellation transaction. If any output lot
has been consumed downstream (remainingWeight changed), the cancellation fails
closed with HTTP 409.

## Context

The original business rule (pre-ST-70) stated "output stock left untouched by
design" to avoid deleting lots that might have been sold downstream. This
created a stock divergence risk: the ledger would reverse both source-out and
output-in movements, but the output StockLots would remain spendable.

## Alternatives Considered

1. **Leave output lots untouched** (original rule) — rejected because ledger
   reversal makes them phantom stock
2. **Block cancellation if any output consumed** (fail closed) — chosen as the
   safe default; only allow cancellation when all outputs are intact
3. **Partial cancellation** — rejected as too complex and error-prone

## Rationale

Owner decision (PR #49 comment #9, 2026-07-25): cancellation is allowed only
when all output lots are intact. If any lot is missing, consumed, or changed,
fail closed with 409 and commit zero mutation. This prevents stock divergence
between StockLots and the ledger.

## Impact

- Code: `assertIntact()` + `atomicDeleteOutputLots()` in sorting-cancellation-service.ts
- Testing: 6 unit tests + 2 PostgreSQL concurrency tests verify CAS protection
- Operations: cancellation may be rejected if output was sold — users must
  reverse downstream transactions first
- Documentation: `process/BUSINESS_RULES.md` Section 2 updated to supersede
  the old "left untouched by design" rule
