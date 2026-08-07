# Feature Inventory — YH Stock System

> Durable feature map and verification method. This file must not act as a dated live-status snapshot.
> Last reconciled: 2026-08-07

## 1. Purpose

Use this file to define the feature areas that must be discoverable and verifiable across code, tests, database readiness, and Production evidence.

For **current** feature status, use:

1. `process/CURRENT_STATE.md`
2. current code/tests on the exact branch/head
3. current GitHub issue/PR and CI evidence
4. Production evidence when runtime verification is required
5. Linear for task status/priority

Historical feature tables and July 2026 status snapshots remain available in Git history and must not be treated as current truth.

## 2. Status vocabulary

When a task needs a feature matrix, classify each feature using evidence from the exact current state:

- `VERIFIED_PRODUCTION` — current Production evidence confirms the behavior
- `VERIFIED_CODE` — code/tests confirm behavior, but Production is not verified
- `PARTIAL` — some required behavior exists but acceptance criteria are not fully met
- `MISSING` — required behavior is absent from the verified current code/state
- `UNKNOWN` — evidence is insufficient; do not guess
- `SUPERSEDED` — older implementation/spec is no longer current
- `NOT_APPLICABLE` — intentionally outside current scope

Do not carry a status forward from an old document without re-verification.

## 3. Feature domains to verify

### Authentication and access
- login/logout/session handling
- authorization and permission enforcement
- user administration
- stable 401/403 behavior
- audit of permission-sensitive changes

### Product and party masters
- products/categories
- customers
- employees/users
- archive/deactivate/delete safety where applicable

### Buy workflow
- bill creation
- validation
- stock lot creation
- pricing/weight input
- credit/payable integration where applicable
- cancellation/reversal
- audit/history

### Sell workflow
- bill creation
- stock availability validation
- FIFO deduction
- cost/profit calculation
- credit/receivable integration where applicable
- cancellation/reversal
- audit/history

### Sorting / dismantling / transfer
- source stock deduction
- output stock creation
- waste/loss handling
- cost conservation/allocation
- cancellation/reversal
- partial-write protection
- retry/idempotency behavior where relevant

### Stock and inventory
- StockLot integrity
- stock totals
- average/FIFO cost evidence
- negative-stock protection according to Owner-approved rules
- ledger/history consistency

### Physical count / stock adjustment
- draft/preview
- apply/confirmation
- before/after evidence
- actor/time/reason audit
- reversal/compensation behavior

### Import
- parse/preview
- alias/mapping behavior
- duplicate detection
- progress/completion state
- partial-failure handling
- retry/idempotency
- auth/session failure behavior

### Credit / bonus / reporting
- receivable/payable tracking
- employee/bonus logic
- cancellation exclusions
- dashboard/reporting consistency

### History and audit
- bill history
- cancellation/reversal history
- AuditLog or equivalent evidence
- deterministic ordering/pagination where required
- permission-aware actions

## 4. Required evidence for a feature claim

A feature status should cite the smallest useful evidence set:

| Claim type | Minimum evidence |
|---|---|
| Present in code | path + symbol/route + exact head |
| Behavior fixed | regression test + implementation diff |
| CI verified | exact-head workflow/check result |
| Database ready | schema/migration evidence; Production readiness requires approved read-only verification |
| Production verified | deployment identity + runtime/API/data evidence appropriate to the behavior |
| Business rule approved | canonical `BUSINESS_RULES.md` and/or current Owner decision |

A UI screenshot or old worklog alone is not enough to prove current implementation state.

## 5. Standard verification matrix

For issue-specific discovery, use:

| Feature | Code status | Tests | DB readiness | Production status | Risk | Evidence | Next gate |
|---|---|---|---|---|---|---|---|
| `<feature>` | VERIFIED / PARTIAL / MISSING / UNKNOWN | PASS / MISSING / N/A | READY / NOT READY / UNKNOWN | VERIFIED / NOT VERIFIED / N/A | P0/P1/P2 | links/paths | bounded next action |

Populate this matrix from fresh evidence; do not maintain a global table here that becomes stale.

## 6. Rebuild/reference rule

`process/REBUILD_SPEC.md` and historical feature inventories are references, not proof of current behavior.

Before rebuilding or restoring a feature:

1. inspect current code/tests first
2. check for existing issue/PR/branch
3. identify the actual missing delta
4. confirm affected business rules
5. add tests that define the required behavior
6. avoid recreating functionality that already exists under a newer implementation

## 7. Hygiene rules

Do not store in this file:

- current user/account state
- current issue priorities
- current PR/branch SHAs
- Production row counts
- dated lists of “missing now” features
- sandbox-local paths
- migration instructions that bypass current Safety/Governance

Those belong in current evidence sources or historical Git records.

## Key takeaway

**Feature Inventory defines what to inspect and how to prove it. `CURRENT_STATE.md` + exact code/tests/CI/Production evidence define what is true now.**