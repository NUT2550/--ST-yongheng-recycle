# Current State — YH Stock System

> **Concise, current, dated. No progress diaries. No raw logs.**
> Last updated: 2026-08-20 (ST-76 separate Merge/Deploy gate follow-up)

## Version Identity

> **Dynamic identity rule:** the exact current `main` SHA must be read from GitHub (`origin/main` / branch API) at task start. Do not hardcode an “always current” main SHA in this file: any PR that edits this file receives a new merge SHA and would invalidate its own embedded value.
>
> This file records the **last reconciled baseline** and verified deployment/runtime evidence. GitHub remains authoritative for the live branch head; Vercel/Production evidence remains authoritative for deployment/runtime identity.

| Item | Value |
|---|---|
| **Last reconciled main baseline** | `18dccd1a22f4fdc4e5670e46feac0c7897b78d9a` (ST-76 PR #82 squash merge, 2026-08-20) |
| **Latest verified Vercel Production deployment identity** | `18dccd1a22f4fdc4e5670e46feac0c7897b78d9a` — Vercel deployment `dpl_9LhHsqeZgmQ76nsqM4iBdgqrj2XQ`, `target=production`, `READY`, source=`git` |
| **Production runtime verification after ST-76 merge** | **NOT performed** — deployment metadata only; no Production endpoint/query/write was used for this follow-up |
| **Production URL** | https://st-yongheng-recycle.vercel.app |

### Deployment-gate correction in progress

The ST-76 merge exposed that Vercel Git integration automatically created a Production deployment when `main` advanced. Owner decision on 2026-08-20: **Merge and Deploy must be separate enforced gates.**

Bounded follow-up branch `st-76-separate-deploy-gate` adds tracked Vercel Git configuration to disable automatic deployment from `main` while preserving non-main/preview Git deployments. Production deployment must require a separate explicit Owner Deploy approval.

## Recently Completed

| Task | PR | Merge SHA | Production Verified |
|---|---|---|---|
| ST-70 (sorting cancel) | #49 | `de9848e1f3` | ✅ Phases 1-3 |
| ST-71 P0 (cancel auth) | #51 | `132d21e` | ✅ 401 AUTH_REQUIRED (8/8 checks) |
| ST-71 reliability foundation | #52–#59 | various | n/a (docs, CI, tests) |
| ST-72 (branch protection) | — | — | ✅ Ruleset "Protect main" (ID 20102920) |
| ST-73 (Production 403) | — | — | ✅ Smoke run 30615346890, all 4 routes 403 |
| ST-75 (import reliability) | #81 | `85890b8` | ❌ Production import NOT verified (mutating) |
| ST-76 governance reconciliation | #82 | `18dccd1` | n/a for behavior; merge caused an automatic Vercel Production deployment, runtime not re-verified |

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
- ✅ **Post-deploy smoke test** — 401 + 403 checks verified from prior release evidence

## Current Unverified Behavior

- ❌ **Production Excel import** — NOT tested in Production (mutating endpoint, not authorized)
- ❌ **Dashboard** — no automated test, not Production-verified
- ❌ **Stock page** — no automated test, not Production-verified
- ❌ **Post-ST-76 Production runtime behavior** — no new runtime smoke/query was performed after automatic deployment `18dccd1`; only Vercel deployment metadata was inspected

## Pending Owner Decisions

1. **weightExpression migration** — `prisma/migrations/add_weight_expression.sql` ready but NOT run. Owner decision required.

## Active Risks

| Risk | Priority | Status |
|---|---|---|
| Automatic Vercel Production deployment on `main` merge bypasses separate Deploy gate | P1 | Correction in progress under ST-76 follow-up; `vercel.json` will disable Git deployment for `main` |
| Production import not verified | P2 | By design — no Production mutation authorized |
| Dashboard/Stock page untested | P3 | No automated coverage |

## References

- `AGENTS.md` — AI entry point
- `process/GOVERNANCE.md` — authority hierarchy and conflict resolution
- `process/DEPLOYMENT_RUNBOOK.md` — Merge/Deploy release gates and Vercel deployment flow
- `process/DEFINITION_OF_DONE.md` — Task Completion Contract
- `knowledge/invariants/INV-ST75-IMPORT-RELIABILITY.md` — ST-75 import reliability contract
