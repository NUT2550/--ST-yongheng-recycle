# Current State — YH Stock System

> **Concise, current, dated. No progress diaries. No raw logs.**
> Last updated: 2026-08-20 (ST-76 Governance Reconciliation v2)

## Version Identity

> **Update this section after every merge to main.**
> Run `git log --oneline -1 origin/main` to get the current main SHA.

| Item | Value |
|---|---|
| **Current main SHA** | `85890b8df3514078a6f380d01f14d66080341734` (ST-75 merge, 2026-08-20) |
| **Current Production SHA** | `85890b8df3514078a6f380d01f14d66080341734` (verified by ChatGPT, read-only smoke) |
| **Production URL** | https://st-yongheng-recycle.vercel.app |
| **Production deployment state** | success |

## Recently Completed

| Task | PR | Merge SHA | Production Verified |
|---|---|---|---|
| ST-70 (sorting cancel) | #49 | `de9848e1f3` | ✅ Phases 1-3 |
| ST-71 P0 (cancel auth) | #51 | `132d21e` | ✅ 401 AUTH_REQUIRED (8/8 checks) |
| ST-71 reliability foundation | #52–#59 | various | n/a (docs, CI, tests) |
| ST-72 (branch protection) | — | — | ✅ Ruleset "Protect main" (ID 20102920) |
| ST-73 (Production 403) | — | — | ✅ Smoke run 30615346890, all 4 routes 403 |
| ST-75 (import reliability) | #81 | `85890b8` | ❌ Production import NOT verified (mutating) |

## Current Verified Behavior

- ✅ **Login + JWT auth** — works in Production
- ✅ **401 AUTH_REQUIRED** — all 4 cancel routes return 401 for no/invalid token
- ✅ **403 PERMISSION_DENIED** — verified in Production (smoke run 30615346890)
- ✅ **Sorting cancellation** — atomic, duplicate-safe, CAS delete (ST-70 Production verified)
- ✅ **Buy/Sell/Transfer cancellation** — PostgreSQL runtime tests pass; NOT tested in Production
- ✅ **CAS concurrency guard** — Buy/Sell/Transfer cancellation uses CAS; proven by PostgreSQL tests
- ✅ **FIFO cost** — deterministic ordering `dateAdded ASC → createdAt ASC → id ASC`
- ✅ **Excel import (Purchase + Sales)** — automated tests pass; production-path PostgreSQL tests pass
- ✅ **Import ambiguity handling** — 429/5xx/network error → AMBIGUOUS_RESULT with bounded delayed refresh
- ✅ **Import summary validation** — runtime validation of counters, arrays, elements, per-status consistency
- ✅ **Production CAS adapter** — `executeStockLotBulkCas` exercised in PostgreSQL CI tests
- ✅ **Post-deploy smoke test** — 401 + 403 checks verified

## Current Unverified Behavior

- ❌ **Production Excel import** — NOT tested in Production (mutating endpoint, not authorized)
- ❌ **Dashboard** — no automated test, not Production-verified
- ❌ **Stock page** — no automated test, not Production-verified

## Pending Owner Decisions

1. **weightExpression migration** — `prisma/migrations/add_weight_expression.sql` ready but NOT run. Owner decision required.

## Active Risks

| Risk | Priority | Status |
|---|---|---|
| Production import not verified | P2 | By design — no Production mutation authorized |
| Dashboard/Stock page untested | P3 | No automated coverage |

## References

- `AGENTS.md` — AI entry point
- `process/GOVERNANCE.md` — authority hierarchy and conflict resolution
- `process/DEFINITION_OF_DONE.md` — Task Completion Contract
- `knowledge/invariants/INV-ST75-IMPORT-RELIABILITY.md` — ST-75 import reliability contract
