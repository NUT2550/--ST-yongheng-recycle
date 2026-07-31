# Current State — YH Stock System

> **Concise, current, dated. No progress diaries. No raw logs.**
> Last updated: 2026-07-30 (ST-71 core closure — follow-ups tracked separately)

## Version Identity

> **Update this section after every merge to main.**
> Run `git log --oneline -1 origin/main` to get the current main SHA.

| Item | Value |
|---|---|
| **Current main SHA** | Check: `git log --oneline -1 origin/main` |
| **Current Production SHA** | Check: GitHub deployment API or Vercel dashboard |
| **Last verified Production SHA** | `132d21e13ccf5b9ccb9fbd5bc9235b1ee563a733` (verified 2026-07-30, ST-71 P0) |
| **Production URL** | https://st-yongheng-recycle.vercel.app |
| **Production deployment state** | success (as of 2026-07-30) |

## Active Issues

| Issue | Status | Summary |
|---|---|---|
| **ST-71 / Issue #50** | Core Complete (Linear: Done) | Core engineering work complete (PRs #51–#59). Owner-controlled follow-ups: ST-72 / GitHub #60 (branch protection), ST-73 / GitHub #61 (Production 403). |
| **ST-70 / PR #49** | Closed | Sorting cancellation atomic + duplicate-safe. Production verified (Phases 1-3). |
| **ST-71 P0 / PR #51** | Merged | 401/403 separation for Buy/Sell/Transfer cancel. Production 401 verified. |
| **ST-71 / PR #52** | Merged | Reliability foundation: AGENTS.md, DoD, PR template, smoke workflow. |
| **ST-71 / PR #53** | Merged | CI foundation validation enforcement + regression tests. |
| **ST-71 / PR #54** | Merged | Knowledge directory + seed records. |
| **ST-71 / PR #55** | Merged | Knowledge semantic validation (15 rules). |
| **ST-71 / PR #56** | Merged | Cancel route auth-wiring static coverage (39 tests). |
| **ST-71 / PR #57** | Merged | Cancel business-logic contract static coverage (47 tests, 321 expectations). Static CAS-presence verification added; CAS production code landed in PR #58. |
| **ST-71 / PR #58** | Merged | Cancel PostgreSQL runtime regression harness + CAS concurrency fix. |
| **ST-71 / PR #59** | Merged | CURRENT_STATE reconciliation after PR #58. |
| **ST-72 / GitHub #60** | Open | Configure and verify main branch protection. |
| **ST-73 / GitHub #61** | Open | Verify authenticated Production 403 cancellation authorization. |

## Recently Completed

| Incident | PR | Merge SHA | Production Verified |
|---|---|---|---|
| ST-70 (sorting cancel) | #49 | `de9848e1f3` | ✅ Phases 1-3 (incident read-only, history, controlled cancellation) |
| ST-71 P0 (cancel auth) | #51 | `132d21e` | ✅ 401 AUTH_REQUIRED (8/8 Production checks). ❌ 403 PERMISSION_DENIED (no staff credentials in sandbox) |
| ST-71 reliability foundation | #52 | `19d6171` | n/a (docs + workflow only) |
| ST-71 CI foundation enforcement | #53 | `b81da4a` | n/a (CI only) |
| ST-71 knowledge directory | #54 | `f77f138` | n/a (docs only) |
| ST-71 knowledge semantic validation | #55 | `e836b9f` | n/a (tests only) |
| ST-71 cancel route auth-wiring | #56 | `97eabee` | n/a (static tests only) |
| ST-71 cancel business-logic contract | #57 | `172929d` | n/a (static tests + CAS fix) |
| ST-71 cancel PostgreSQL runtime harness | #58 | `22fb3cb` | n/a (runtime tests in CI PostgreSQL; no Production cancellation test performed) |

## Current Verified Behavior

- ✅ **Login + JWT auth** — works in Production (ST-10 tests + ST-70 unauth gate verification)
- ✅ **401 AUTH_REQUIRED** — all 4 cancel routes (Buy, Sell, Transfer, Sorting) return 401 for no/invalid token
- ✅ **Sorting cancellation** — atomic, duplicate-safe, cost evidence, CAS delete (ST-70 Production verified)
- ✅ **Combined sorting history** — server-side merge, deterministic ordering, bounded pagination (ST-70 Phase 2 verified)
- ✅ **401/403 separation** — shared `resolveHistoryEditAuth` helper in `src/lib/cancel-auth.ts` (ST-71 automated tests)
- ✅ **Buy/Sell/Transfer cancellation services** — extracted from route handlers into testable service functions (PR #58). CAS guard, downstream-use rejection, reversal, audit, credit settlement all inside `$transaction`.
- ✅ **CAS concurrency guard** — Buy/Sell/Transfer cancellation uses `updateMany` with `isCancelled: false` + `count !== 1` check (PR #58). Concurrent cancellation proven safe by PostgreSQL runtime tests (21 tests, 104 expectations, 0 skipped).
- ✅ **Buy/Sell/Transfer rollback** — proven at 3 fault-injection stages (afterClaim, beforeReversal, beforeAudit) via PostgreSQL runtime tests (PR #58).
- ✅ **FIFO cost** — deterministic ordering `dateAdded ASC → createdAt ASC → id ASC` (ST-39 tests)
- ✅ **StockMovement ledger** — reversal identity, idempotency keys (ST-47 tests)

## Current Unverified Behavior

- ❌ **403 PERMISSION_DENIED** — not tested in Production (requires `STAFF_TOKEN_NO_HISTORY_EDIT` GitHub Actions secret; Owner credential setup pending). Automated tests + PostgreSQL runtime tests cover the contract.
- ✅ **Buy/Sell/Transfer cancellation** — covered by PostgreSQL runtime tests (PR #58: successful, duplicate, downstream rejection, rollback, concurrent). NOT tested in Production (no live cancellation performed).
- ❌ **Buy/Sell/Transfer Production cancellation** — not tested in Production (by design — no Production mutation performed)
- ❌ **Dashboard** — no automated test, not Production-verified
- ❌ **Stock page** — no automated test, not Production-verified
- ✅ **Post-deploy smoke test** — production-smoke.yml workflow (PR #52); 401 checks verified, 403 pending `STAFF_TOKEN_NO_HISTORY_EDIT` secret

## Active Blockers and Risks

| Risk | Priority | Status |
|---|---|---|
| Buy/Sell/Transfer cancel runtime PostgreSQL coverage | P0 | ✅ Resolved: PostgreSQL runtime coverage released (PR #58). 21 tests, 104 expectations, 0 skipped in CI. Covers successful, duplicate, downstream rejection, rollback, concurrent. |
| Buy/Sell/Transfer concurrent cancellation race | P0 | ✅ Resolved: CAS guard (`updateMany` + `isCancelled: false` + `count !== 1`) proven effective by PostgreSQL concurrent tests (PR #58). Exactly one winner, loser gets 409, zero duplicate writes. |
| 403 PERMISSION_DENIED not Production-verified | P2 | Moved to ST-73 / GitHub #61. Owner acceptance test (not regression gate). 71 automated + runtime tests cover contract. |
| Direct route-handler import blocked by `server-only` | P1 | ✅ Resolved: cancellation logic extracted to service functions (PR #58). Runtime tests import services directly. |
| Production 403 verification | P2 | Moved to ST-73 / GitHub #61. `STAFF_TOKEN_NO_HISTORY_EDIT` secret not configured. |
| Branch protection not configured | P2 | Moved to ST-72 / GitHub #60. Governance follow-up (not engineering). Owner UI action. |
| weightExpression migration not run | P0 | Pending Owner decision |

## Pending Owner Decisions

1. **weightExpression migration** — `prisma/migrations/add_weight_expression.sql` ready but NOT run. Owner decision required.
2. **ST-72 / GitHub #60**: Configure main branch protection (GitHub UI action)
3. **ST-73 / GitHub #61**: Verify Production 403 (requires `STAFF_TOKEN_NO_HISTORY_EDIT` secret + temporary staff account)

## Current Status

`ST-71 CORE WORK COMPLETE — OWNER-CONTROLLED FOLLOW-UPS TRACKED SEPARATELY`

**Owner decision**: `APPROVED — CLOSE ST-71 CORE WORK AND CREATE TWO FOLLOW-UP ISSUES` (2026-07-30)
**Linear status**: Done (core engineering complete)

**Accepted residual risks** (P2, Owner-controlled):
1. Production 403 not executed — ST-73 / GitHub #61
2. Branch protection absent — ST-72 / GitHub #60
3. JWT valid after account deactivation (applies only after #61)
4. Main push CI excluded by design — pre-merge exact-head CI is evidence of record
5. Path-filtered PostgreSQL checks not universally required — by design

**No P0/P1 technical findings remain.**

## Next Safe Work Item

Two Owner-controlled follow-ups are tracked separately:
1. **ST-72 / GitHub #60**: Configure and verify main branch protection (GitHub UI)
2. **ST-73 / GitHub #61**: Verify authenticated Production 403 (requires `STAFF_TOKEN_NO_HISTORY_EDIT` secret + temporary staff account)

ST-71 core engineering work is complete. No further code changes are required for ST-71 closure.

## ST-72 Branch Protection Verification

- ST-72 branch protection verification PR in progress.

## References

- `AGENTS.md` — AI entry point
- `process/DEFINITION_OF_DONE.md` — Task Completion Contract
- `process/BUSINESS_RULES.md` — Section 8.5: Stable Error Codes
- `src/lib/cancel-auth.ts` — Shared 401/403 auth helper
- `src/lib/buy-cancellation-service.ts`, `sell-cancellation-service.ts`, `transfer-cancellation-service.ts` — extracted cancellation services with CAS guard (PR #58)
- `tests/st71-postgres-runtime-harness.test.ts` — 21 PostgreSQL runtime tests (PR #58)
- `tests/st71-cancel-auth-regression.test.ts` — 11 regression tests
- `tests/st71-cancel-business-logic.test.ts` — 53 static contract tests (PR #57)
- `.github/workflows/st71-postgres-runtime.yml` — PostgreSQL runtime CI workflow (PR #58)
- `.github/workflows/production-smoke.yml` — Production smoke (401 + optional 403 with `STAFF_TOKEN_NO_HISTORY_EDIT`)
- PR #49 (ST-70), PR #51 (ST-71 P0), PR #55–#58 (ST-71), Issue #50 (ST-71)
