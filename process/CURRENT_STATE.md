# Current State — YH Stock System

> **Concise, current, dated. No progress diaries. No raw logs.**
> Last updated: 2026-07-30 (ST-71 runtime harness)

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
| **ST-71 / Issue #50** | In Progress | Reliability foundation + regression prevention. Static contract coverage released (PR #57). Runtime PostgreSQL harness in progress. |
| **ST-70 / PR #49** | Closed | Sorting cancellation atomic + duplicate-safe. Production verified (Phases 1-3). |
| **ST-71 P0 / PR #51** | Merged | 401/403 separation for Buy/Sell/Transfer cancel. Production 401 verified. |
| **ST-71 / PR #52** | Merged | Reliability foundation: AGENTS.md, DoD, PR template, smoke workflow. |
| **ST-71 / PR #53** | Merged | CI foundation validation enforcement + regression tests. |
| **ST-71 / PR #54** | Merged | Knowledge directory + seed records. |
| **ST-71 / PR #55** | Merged | Knowledge semantic validation (15 rules). |
| **ST-71 / PR #56** | Merged | Cancel route auth-wiring static coverage (39 tests). |
| **ST-71 / PR #57** | Merged | Cancel business-logic contract static coverage (47 tests). CAS guard added. |
| **ST-71 runtime harness** | Draft PR pending | PostgreSQL runtime regression harness for Buy/Sell/Transfer cancellation. |

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

## Current Verified Behavior

- ✅ **Login + JWT auth** — works in Production (ST-10 tests + ST-70 unauth gate verification)
- ✅ **401 AUTH_REQUIRED** — all 4 cancel routes (Buy, Sell, Transfer, Sorting) return 401 for no/invalid token
- ✅ **Sorting cancellation** — atomic, duplicate-safe, cost evidence, CAS delete (ST-70 Production verified)
- ✅ **Combined sorting history** — server-side merge, deterministic ordering, bounded pagination (ST-70 Phase 2 verified)
- ✅ **401/403 separation** — shared `resolveHistoryEditAuth` helper in `src/lib/cancel-auth.ts` (ST-71 automated tests)
- ✅ **FIFO cost** — deterministic ordering `dateAdded ASC → createdAt ASC → id ASC` (ST-39 tests)
- ✅ **StockMovement ledger** — reversal identity, idempotency keys (ST-47 tests)

## Current Unverified Behavior

- ❌ **403 PERMISSION_DENIED** — not tested in Production (no staff credentials in sandbox; verified by automated tests only)
- ❌ **Buy bill cancel** — not tested in Production (no regression test)
- ❌ **Sell bill cancel** — not tested in Production (no regression test)
- ❌ **Transfer cancel** — not tested in Production (no regression test)
- ❌ **Dashboard** — no automated test, not Production-verified
- ❌ **Stock page** — no automated test, not Production-verified
- ✅ **Post-deploy smoke test** — production-smoke.yml workflow (PR #52); 401 checks verified, 403 pending secret

## Active Blockers and Risks

| Risk | Priority | Status |
|---|---|---|
| Buy/Sell/Transfer cancel runtime PostgreSQL coverage | P0 | ✅ Static contract coverage released (PR #57). Runtime harness in progress (Draft PR pending). CAS guard added. |
| Buy/Sell/Transfer concurrent cancellation race | P0 | ✅ CAS guard added in extracted services (PR #57 merge). Runtime verification pending (ST-71 harness). |
| 403 PERMISSION_DENIED not Production-verified | P1 | Requires Owner to test with staff account |
| Direct route-handler import blocked by `server-only` | P1 | ✅ Resolved: cancellation logic extracted to service functions (PR #57). Runtime tests import services directly. |
| Production 403 verification | P1 | Pending (no staff credentials in sandbox) |
| Branch protection not configured | P1 | Pending Owner action |
| weightExpression migration not run | P0 | Pending Owner decision |

## Pending Owner Decisions

1. **weightExpression migration** — `prisma/migrations/add_weight_expression.sql` ready but NOT run. Owner decision required.
2. **403 Production verification** — Owner should test cancel routes with a staff account (no `history.edit`).
3. **ST-71 runtime PostgreSQL harness** — Draft PR pending Owner review. Extends ST-70 CI infrastructure to Buy/Sell/Transfer.
4. **Branch protection** — Foundation Validation CI check not yet required. Owner action needed.

## Next Safe Work Item

Review and merge the ST-71 PostgreSQL runtime harness Draft PR. This extends the ST-70 CI infrastructure to Buy/Sell/Transfer cancellation, proving runtime behavior including concurrent cancellation safety via the CAS guard.

## References

- `AGENTS.md` — AI entry point
- `process/DEFINITION_OF_DONE.md` — Task Completion Contract
- `process/BUSINESS_RULES.md` — Section 8.5: Stable Error Codes
- `src/lib/cancel-auth.ts` — Shared 401/403 auth helper
- `tests/st71-cancel-auth-regression.test.ts` — 11 regression tests
- PR #49 (ST-70), PR #51 (ST-71 P0), Issue #50 (ST-71)
